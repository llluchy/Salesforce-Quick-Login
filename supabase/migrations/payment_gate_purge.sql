-- ============================================================
-- 收费门 + 停用/未付费清数据（workstream 4）
-- ============================================================
-- 依赖（sibling PR，线上需先或同批 apply）：
--   - public.app_config（payment_master）
--   - public.user_metadata.payment_choice / payment_choice_at
--   - public.user_billing（is_paid、宽限与 purge 时间戳）
--
-- 冲突说明：若 sibling 迁移已创建同名对象，本文件用 IF NOT EXISTS /
--   OR REPLACE；合并时以「功能等价」为准手工去重。
--
-- ★ 线上 apply：等产品确认后再在 Dashboard SQL / apply_migration 执行。
--   本仓库只存放定义，不自动改线上库、不自动挂 cron。
-- ============================================================

-- ---------- 依赖桩（幂等；sibling 已建则跳过）----------
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz null default now(),
  updated_by uuid null references auth.users (id)
);

alter table public.app_config enable row level security;

drop policy if exists "app_config_select_all" on public.app_config;
create policy "app_config_select_all" on public.app_config
  as PERMISSIVE for SELECT to anon, authenticated
  using (true);
-- 无 INSERT/UPDATE/DELETE 策略：仅 service_role / Dashboard 可写

insert into public.app_config (key, value)
values ('payment_master', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

alter table public.user_metadata
  add column if not exists payment_choice text null,
  add column if not exists payment_choice_at timestamptz null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_metadata_payment_choice_check'
  ) then
    alter table public.user_metadata
      add constraint user_metadata_payment_choice_check
      check (payment_choice is null or payment_choice in ('continue', 'deactivate'));
  end if;
end $$;

create table if not exists public.user_billing (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_paid boolean not null default false,
  paid_at timestamptz null,
  stripe_customer_id text null,
  stripe_checkout_session_id text null,
  deactivate_purged_at timestamptz null,
  pay_phase_started_at timestamptz null,
  unpaid_grace_expires_at timestamptz null,
  unpaid_purged_at timestamptz null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now()
);

alter table public.user_billing enable row level security;

drop policy if exists "user_billing_select_own" on public.user_billing;
create policy "user_billing_select_own" on public.user_billing
  as PERMISSIVE for SELECT to authenticated
  using (auth.uid() = user_id);
-- 用户无 INSERT/UPDATE：Webhook / 批处理 / 触发器用 service_role

-- ---------- 辅助：总开关是否 ON ----------
create or replace function public.is_payment_master_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select (value->>'enabled')::boolean
     from public.app_config
     where key = 'payment_master'),
    false
  );
$function$;

-- 显式收回 named role（Supabase CREATE 时 ALTER DEFAULT PRIVILEGES 会授给 anon/authenticated）
revoke all on function public.is_payment_master_enabled() from public;
revoke all on function public.is_payment_master_enabled() from anon;
revoke all on function public.is_payment_master_enabled() from authenticated;
grant execute on function public.is_payment_master_enabled() to anon, authenticated, service_role;

-- ---------- 辅助：当前用户是否已付费（收费阶段业务表 RLS）----------
create or replace function public.payment_business_access_allowed()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when not public.is_payment_master_enabled() then true
    when auth.uid() is null then false
    when exists (
      select 1 from public.user_billing b
      where b.user_id = auth.uid() and b.is_paid = true
    ) then true
    else false
  end;
$function$;

revoke all on function public.payment_business_access_allowed() from public;
revoke all on function public.payment_business_access_allowed() from anon;
revoke all on function public.payment_business_access_allowed() from authenticated;
grant execute on function public.payment_business_access_allowed() to authenticated, service_role;

-- ---------- 共用删除清单（路径 A / B）----------
create or replace function public.purge_user_business_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_user_id is null then
    raise exception 'p_user_id required';
  end if;

  delete from public.environments where user_id = p_user_id;
  delete from public.groups where user_id = p_user_id;
  delete from public.env_shares where owner_user_id = p_user_id;
  delete from public.saved_soql_queries where user_id = p_user_id;
  delete from public.user_secrets where user_id = p_user_id;

  -- 重置业务偏好，保留 payment_choice，避免重复提醒语义混乱
  update public.user_metadata
  set
    show_tool_float = true,
    ui_locale = 'system',
    updated_at = now()
  where user_id = p_user_id;
end;
$function$;

-- service_role only：禁止 anon/authenticated 经 REST RPC 跨用户清数据
revoke all on function public.purge_user_business_data(uuid) from public;
revoke all on function public.purge_user_business_data(uuid) from anon;
revoke all on function public.purge_user_business_data(uuid) from authenticated;
grant execute on function public.purge_user_business_data(uuid) to service_role;

-- ---------- 路径 A：停用用户立即清数据 ----------
create or replace function public.purge_deactivated_user_data(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_choice text;
  v_purged timestamptz;
begin
  if not public.is_payment_master_enabled() then
    return false;
  end if;

  select payment_choice into v_choice
  from public.user_metadata
  where user_id = p_user_id;

  if v_choice is distinct from 'deactivate' then
    return false;
  end if;

  insert into public.user_billing (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select deactivate_purged_at into v_purged
  from public.user_billing
  where user_id = p_user_id;

  if v_purged is not null then
    return true; -- 幂等
  end if;

  perform public.purge_user_business_data(p_user_id);

  update public.user_billing
  set
    deactivate_purged_at = now(),
    -- 停用不适用 7 天宽限
    unpaid_grace_expires_at = null,
    pay_phase_started_at = null,
    updated_at = now()
  where user_id = p_user_id;

  return true;
end;
$function$;

revoke all on function public.purge_deactivated_user_data(uuid) from public;
revoke all on function public.purge_deactivated_user_data(uuid) from anon;
revoke all on function public.purge_deactivated_user_data(uuid) from authenticated;
grant execute on function public.purge_deactivated_user_data(uuid) to service_role;

-- 登录用户在 ON 阶段自 purge（仅本人 + 须已选 deactivate）
create or replace function public.try_purge_own_deactivated()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return public.purge_deactivated_user_data(auth.uid());
end;
$function$;

-- 仅本人：内部仍调 purge_deactivated_user_data，但绑定 auth.uid()；DEFINER 所有者可调用下游
revoke all on function public.try_purge_own_deactivated() from public;
revoke all on function public.try_purge_own_deactivated() from anon;
revoke all on function public.try_purge_own_deactivated() from authenticated;
grant execute on function public.try_purge_own_deactivated() to authenticated;

-- ---------- 路径 B：未付费宽限起算 + 到期清数据 ----------
create or replace function public.ensure_own_unpaid_grace()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  v_choice text;
  v_paid boolean;
  v_expires timestamptz;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_payment_master_enabled() then
    return jsonb_build_object('ok', false, 'reason', 'switch_off');
  end if;

  select payment_choice into v_choice
  from public.user_metadata where user_id = uid;

  if v_choice = 'deactivate' then
    return jsonb_build_object('ok', false, 'reason', 'deactivate_path_a');
  end if;

  insert into public.user_billing (user_id)
  values (uid)
  on conflict (user_id) do nothing;

  select is_paid, unpaid_grace_expires_at into v_paid, v_expires
  from public.user_billing where user_id = uid;

  if v_paid then
    return jsonb_build_object('ok', true, 'reason', 'already_paid');
  end if;

  if v_expires is not null then
    return jsonb_build_object('ok', true, 'unpaid_grace_expires_at', v_expires);
  end if;

  update public.user_billing
  set
    pay_phase_started_at = coalesce(pay_phase_started_at, now()),
    unpaid_grace_expires_at = coalesce(unpaid_grace_expires_at, now() + interval '7 days'),
    updated_at = now()
  where user_id = uid
  returning unpaid_grace_expires_at into v_expires;

  return jsonb_build_object('ok', true, 'unpaid_grace_expires_at', v_expires);
end;
$function$;

revoke all on function public.ensure_own_unpaid_grace() from public;
revoke all on function public.ensure_own_unpaid_grace() from anon;
revoke all on function public.ensure_own_unpaid_grace() from authenticated;
grant execute on function public.ensure_own_unpaid_grace() to authenticated;

create or replace function public.purge_unpaid_expired_user_data(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.user_billing%rowtype;
  v_choice text;
begin
  if not public.is_payment_master_enabled() then
    return false;
  end if;

  select * into v_row from public.user_billing where user_id = p_user_id;
  if not found then
    return false;
  end if;

  if v_row.is_paid then
    return false;
  end if;
  if v_row.unpaid_purged_at is not null then
    return true;
  end if;
  if v_row.unpaid_grace_expires_at is null or v_row.unpaid_grace_expires_at >= now() then
    return false;
  end if;

  select payment_choice into v_choice
  from public.user_metadata where user_id = p_user_id;

  -- 待路径 A 的停用用户不走 B
  if v_choice = 'deactivate' and v_row.deactivate_purged_at is null then
    return false;
  end if;

  perform public.purge_user_business_data(p_user_id);

  update public.user_billing
  set unpaid_purged_at = now(), updated_at = now()
  where user_id = p_user_id;

  return true;
end;
$function$;

revoke all on function public.purge_unpaid_expired_user_data(uuid) from public;
revoke all on function public.purge_unpaid_expired_user_data(uuid) from anon;
revoke all on function public.purge_unpaid_expired_user_data(uuid) from authenticated;
grant execute on function public.purge_unpaid_expired_user_data(uuid) to service_role;

-- 每日批处理：路径 A 扫漏 + 路径 B 到期
create or replace function public.run_payment_purge_daily(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_a integer := 0;
  v_b integer := 0;
  r record;
begin
  if not public.is_payment_master_enabled() then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'switch_off');
  end if;

  -- 路径 A：deactivate 且尚未 purge
  for r in
    select m.user_id
    from public.user_metadata m
    left join public.user_billing b on b.user_id = m.user_id
    where m.payment_choice = 'deactivate'
      and (b.deactivate_purged_at is null)
    limit greatest(p_limit, 1)
  loop
    if public.purge_deactivated_user_data(r.user_id) then
      v_a := v_a + 1;
    end if;
  end loop;

  -- 路径 B：宽限已过、未付费、未 purge
  for r in
    select b.user_id
    from public.user_billing b
    left join public.user_metadata m on m.user_id = b.user_id
    where b.is_paid = false
      and b.unpaid_purged_at is null
      and b.unpaid_grace_expires_at is not null
      and b.unpaid_grace_expires_at < now()
      and not (
        coalesce(m.payment_choice, '') = 'deactivate'
        and b.deactivate_purged_at is null
      )
    limit greatest(p_limit, 1)
  loop
    if public.purge_unpaid_expired_user_data(r.user_id) then
      v_b := v_b + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'deactivate_purged', v_a,
    'unpaid_purged', v_b
  );
end;
$function$;

revoke all on function public.run_payment_purge_daily(integer) from public;
revoke all on function public.run_payment_purge_daily(integer) from anon;
revoke all on function public.run_payment_purge_daily(integer) from authenticated;
grant execute on function public.run_payment_purge_daily(integer) to service_role;

-- ---------- 开关翻 ON 时批量打宽限戳（Dashboard 手工或运维调用）----------
create or replace function public.stamp_unpaid_grace_for_pay_phase(p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer := 0;
begin
  if not public.is_payment_master_enabled() then
    return 0;
  end if;

  with candidates as (
    select u.id as user_id
    from auth.users u
    left join public.user_metadata m on m.user_id = u.id
    left join public.user_billing b on b.user_id = u.id
    where coalesce(m.payment_choice, '') is distinct from 'deactivate'
      and (b.user_id is null or (b.is_paid = false and b.unpaid_grace_expires_at is null))
    order by u.created_at nulls last, u.id
    limit greatest(coalesce(p_limit, 5000), 1)
  )
  insert into public.user_billing (user_id, pay_phase_started_at, unpaid_grace_expires_at)
  select c.user_id, now(), now() + interval '7 days'
  from candidates c
  on conflict (user_id) do update
    set
      pay_phase_started_at = coalesce(public.user_billing.pay_phase_started_at, excluded.pay_phase_started_at),
      unpaid_grace_expires_at = coalesce(public.user_billing.unpaid_grace_expires_at, excluded.unpaid_grace_expires_at),
      updated_at = now()
    where public.user_billing.is_paid = false
      and public.user_billing.unpaid_grace_expires_at is null;

  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.stamp_unpaid_grace_for_pay_phase(integer) from public;
revoke all on function public.stamp_unpaid_grace_for_pay_phase(integer) from anon;
revoke all on function public.stamp_unpaid_grace_for_pay_phase(integer) from authenticated;
grant execute on function public.stamp_unpaid_grace_for_pay_phase(integer) to service_role;

-- ---------- RLS 收紧：业务表在收费阶段要求 is_paid ----------
-- environments
drop policy if exists "env_delete" on public.environments;
drop policy if exists "env_insert" on public.environments;
drop policy if exists "env_select" on public.environments;
drop policy if exists "env_update" on public.environments;
create policy "env_delete" on public.environments
  as PERMISSIVE for DELETE to public
  using (auth.uid() = user_id and public.payment_business_access_allowed());
create policy "env_insert" on public.environments
  as PERMISSIVE for INSERT to public
  with check (auth.uid() = user_id and public.payment_business_access_allowed());
create policy "env_select" on public.environments
  as PERMISSIVE for SELECT to public
  using (auth.uid() = user_id and public.payment_business_access_allowed());
create policy "env_update" on public.environments
  as PERMISSIVE for UPDATE to public
  using (auth.uid() = user_id and public.payment_business_access_allowed())
  with check (auth.uid() = user_id and public.payment_business_access_allowed());

-- groups
drop policy if exists "grp_delete" on public.groups;
drop policy if exists "grp_insert" on public.groups;
drop policy if exists "grp_select" on public.groups;
drop policy if exists "grp_update" on public.groups;
create policy "grp_delete" on public.groups
  as PERMISSIVE for DELETE to public
  using (auth.uid() = user_id and public.payment_business_access_allowed());
create policy "grp_insert" on public.groups
  as PERMISSIVE for INSERT to public
  with check (auth.uid() = user_id and public.payment_business_access_allowed());
create policy "grp_select" on public.groups
  as PERMISSIVE for SELECT to public
  using (auth.uid() = user_id and public.payment_business_access_allowed());
create policy "grp_update" on public.groups
  as PERMISSIVE for UPDATE to public
  using (auth.uid() = user_id and public.payment_business_access_allowed())
  with check (auth.uid() = user_id and public.payment_business_access_allowed());

-- env_shares
drop policy if exists "用户管理自己创建的分享" on public.env_shares;
create policy "用户管理自己创建的分享" on public.env_shares
  as PERMISSIVE for ALL to public
  using (auth.uid() = owner_user_id and public.payment_business_access_allowed())
  with check (auth.uid() = owner_user_id and public.payment_business_access_allowed());

-- saved_soql_queries
drop policy if exists "saved_soql_select" on public.saved_soql_queries;
drop policy if exists "saved_soql_insert" on public.saved_soql_queries;
drop policy if exists "saved_soql_update" on public.saved_soql_queries;
drop policy if exists "saved_soql_delete" on public.saved_soql_queries;
create policy "saved_soql_select" on public.saved_soql_queries
  as PERMISSIVE for SELECT to authenticated
  using (auth.uid() = user_id and public.payment_business_access_allowed());
create policy "saved_soql_insert" on public.saved_soql_queries
  as PERMISSIVE for INSERT to authenticated
  with check (auth.uid() = user_id and public.payment_business_access_allowed());
create policy "saved_soql_update" on public.saved_soql_queries
  as PERMISSIVE for UPDATE to authenticated
  using (auth.uid() = user_id and public.payment_business_access_allowed())
  with check (auth.uid() = user_id and public.payment_business_access_allowed());
create policy "saved_soql_delete" on public.saved_soql_queries
  as PERMISSIVE for DELETE to authenticated
  using (auth.uid() = user_id and public.payment_business_access_allowed());

-- ============================================================
-- 线上 apply 步骤（产品批准后手工执行）
-- ============================================================
-- 1) 在 SQL Editor 执行本文件全文（或 supabase migration apply）。
-- 2) 确认 sibling 的 app_config / user_billing / payment_choice 已存在且一致。
-- 3) 挂每日批处理（二选一，推荐 pg_cron）：
--
--    -- 需要扩展：create extension if not exists pg_cron with schema extensions;
--    select cron.schedule(
--      'payment-purge-daily',
--      '15 0 * * *',  -- 每天 00:15 UTC；可按需改
--      $$select public.run_payment_purge_daily(500);$$
--    );
--
-- 4) 将 payment_master.enabled 拨为 true 时，建议立即：
--      select public.stamp_unpaid_grace_for_pay_phase(5000);
--      select public.run_payment_purge_daily(500);  -- 路径 A 立即扫停用
-- 5) 验证：select * from cron.job where jobname = 'payment-purge-daily';
-- 6) 回滚 cron：select cron.unschedule('payment-purge-daily');
-- ============================================================
