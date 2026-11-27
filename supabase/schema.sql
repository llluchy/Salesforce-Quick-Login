-- ============================================================
-- Supabase 数据库 DDL 备份
-- 来源：Supabase 控制台 SQL Editor 逐表导出
-- 说明：仅备份结构（不含数据），用于审计与重建
-- ============================================================

-- ---------- 表：env_shares 分享记录 ----------
create table public.env_shares (
  id uuid not null default gen_random_uuid (),
  env_ids uuid[] not null,
  owner_user_id uuid not null,
  share_code text not null,
  verify_code text not null,
  encrypted_envs jsonb not null,
  status text not null default 'active'::text,
  expires_at timestamp with time zone not null,
  consumed_by uuid null,
  created_at timestamp with time zone null default now(),
  constraint env_shares_pkey primary key (id),
  constraint env_shares_share_code_key unique (share_code),
  constraint env_shares_owner_user_id_fkey foreign KEY (owner_user_id) references auth.users (id)
) TABLESPACE pg_default;

-- ---------- 表：environments 环境数据 ----------
create table public.environments (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  alias text not null,
  username text not null,
  password text not null,
  type text not null default 'production'::text,
  custom_url text null,
  group_id text null,
  totp_secret text null,
  passkeys jsonb null default '[]'::jsonb,
  sort_order integer null default 0,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  -- 误删恢复：is_deleted=true 且 deleted_at 起 7 日内可放回原分组。
  -- 别名、账号、密码、验证器、分组留在原行。超过 7 日由客户端物理删除该行。
  -- 已收下的分享是接收者自己的环境行，不随这里删除。本文件只记录结构，不改线上数据。
  is_deleted boolean not null default false,
  deleted_at timestamp with time zone null,
  constraint environments_pkey primary key (id),
  constraint environments_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_env_user on public.environments using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_env_group on public.environments using btree (user_id, group_id) TABLESPACE pg_default;

create index IF not exists idx_env_deleted on public.environments using btree (user_id, is_deleted) TABLESPACE pg_default;

create trigger trg_env_touch BEFORE
update on environments for EACH row
execute FUNCTION touch_updated_at ();

-- ---------- 表：groups 分组 ----------
create table public.groups (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  name text not null,
  sort_order integer null default 0,
  collapsed boolean null default false,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint groups_pkey primary key (id),
  constraint groups_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_grp_user on public.groups using btree (user_id) TABLESPACE pg_default;

create trigger trg_grp_touch BEFORE
update on groups for EACH row
execute FUNCTION touch_updated_at ();

-- ---------- 表：user_secrets 用户密钥 ----------
create table public.user_secrets (
  user_id uuid not null,
  salt text not null,
  created_at timestamp with time zone null default now(),
  device_code text null,
  recovery_password text null,
  recovery_public_key jsonb null,
  recovery_key_shown boolean null default false,
  constraint user_secrets_pkey primary key (user_id),
  constraint user_secrets_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

-- ---------- 表：user_metadata 用户设置 ----------
-- 说明：账户级偏好。show_tool_float 默认显示 Salesforce 页面浮动栏。
-- ui_locale 为界面语言：system / zh-CN / en / ja，默认跟随系统。
-- payment_choice：提醒阶段一次性「继续/停用」；null=未选；选定后不可由客户端改回。
-- payment_choice_at：选定时间。
-- user_agreement_accepted_at：付费模式开启后一次性用户协议同意时间；null=未同意。
-- 本文件只备份结构。新列与触发器只加在这里，不改线上数据（见 migrations/payment_choice.sql、user_agreement.sql）。
-- 冲突说明：管理员总开关 PR 拥有 app_config；本表 payment_choice* / user_agreement* 由「提醒与停用选择」PR 维护。
-- app_config（总开关）见下方。
create table public.user_metadata (
  user_id uuid not null,
  show_tool_float boolean not null default true,
  ui_locale text not null default 'system'::text,
  payment_choice text null,
  payment_choice_at timestamp with time zone null,
  user_agreement_accepted_at timestamp with time zone null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint user_metadata_pkey primary key (user_id),
  constraint user_metadata_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint user_metadata_ui_locale_check check (
    ui_locale in ('system', 'zh-CN', 'en', 'ja')
  ),
  constraint user_metadata_payment_choice_check check (
    payment_choice is null
    or payment_choice = any (array['continue'::text, 'deactivate'::text])
  )
) TABLESPACE pg_default;

create trigger trg_user_metadata_touch BEFORE
update on user_metadata for EACH row
execute FUNCTION touch_updated_at ();

-- payment_choice 一旦非 null，禁止客户端改成其他值或改回 null。
-- postgres / supabase_admin / service_role 角色可绕过（邮件改选由管理员在 Dashboard 手工改）。
-- 不用 auth.role()：schema 须能在无 Supabase auth 扩展的环境中加载（如本地 PGlite 测试）。
create or replace function public.prevent_payment_choice_change () returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if old.payment_choice is not null
     and (
       new.payment_choice is distinct from old.payment_choice
       or new.payment_choice_at is distinct from old.payment_choice_at
     ) then
    raise exception 'payment_choice is immutable once set'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_user_metadata_payment_choice_immutable BEFORE
update on user_metadata for EACH row
execute FUNCTION prevent_payment_choice_change ();

-- user_agreement_accepted_at 一旦非 null，禁止客户端改回 null 或改时间戳。
create or replace function public.prevent_user_agreement_change () returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if old.user_agreement_accepted_at is not null
     and new.user_agreement_accepted_at is distinct from old.user_agreement_accepted_at then
    raise exception 'user_agreement_accepted_at is immutable once set'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_user_metadata_user_agreement_immutable BEFORE
update on user_metadata for EACH row
execute FUNCTION prevent_user_agreement_change ();

-- ---------- 表：saved_soql_queries 常用查询 ----------
-- 说明：执行成功后留下的 SOQL。不含名称、Salesforce 主机名、Org 或会话。
-- 换电脑后仍须在该电脑重新登录 Salesforce 才能执行。
-- 本文件只备份结构，不改线上数据。
create table public.saved_soql_queries (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  soql text not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint saved_soql_queries_pkey primary key (id),
  constraint saved_soql_queries_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint saved_soql_queries_soql_len check (char_length(soql) between 1 and 20000)
) TABLESPACE pg_default;

create index IF not exists idx_saved_soql_user on public.saved_soql_queries using btree (user_id, created_at desc) TABLESPACE pg_default;

create trigger trg_saved_soql_touch BEFORE
update on saved_soql_queries for EACH row
execute FUNCTION touch_updated_at ();

-- ---------- 表：app_config 全局配置（管理员总开关等） ----------
-- 说明：扩展用 anon/authenticated 只读；写入仅 Dashboard SQL / service_role。
-- key=payment_master 时 value.enabled=false 为提醒阶段（默认），true 为收费阶段。
-- 本文件只备份结构与默认种子；线上 apply 等产品确认，不在此自动执行。
create table public.app_config (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone null default now(),
  updated_by uuid null,
  constraint app_config_pkey primary key (key),
  constraint app_config_updated_by_fkey foreign KEY (updated_by) references auth.users (id) on delete set null
) TABLESPACE pg_default;

create trigger trg_app_config_touch BEFORE
update on app_config for EACH row
execute FUNCTION touch_updated_at ();

insert into public.app_config (key, value)
values ('payment_master', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

-- ---------- 函数：accept_share_lookup 接受分享查询 ----------
-- 说明：根据分享码+验证码查询有效分享记录，SECURITY DEFINER 绕过 RLS 读取
CREATE OR REPLACE FUNCTION public.accept_share_lookup(p_share_code text, p_verify_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_share record;
BEGIN
  SELECT * INTO v_share
  FROM env_shares
  WHERE share_code = p_share_code
    AND status = 'active'
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_share.verify_code != p_verify_code THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'encrypted_envs', v_share.encrypted_envs,
    'owner_user_id', v_share.owner_user_id,
    'expires_at', v_share.expires_at
  );
END;
$function$

-- ---------- 函数：accept_share_mark_used 标记分享已使用 ----------
-- 说明：分享被接受后将其状态标记为 used，并记录使用者，SECURITY DEFINER 绕过 RLS 更新
CREATE OR REPLACE FUNCTION public.accept_share_mark_used(p_share_code text, p_consumed_by uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE env_shares
  SET status = 'used',
      consumed_by = p_consumed_by
  WHERE share_code = p_share_code
    AND status = 'active'
    AND expires_at > now();

  RETURN FOUND;
END;
$function$

-- ---------- 函数：touch_updated_at 自动更新 updated_at ----------
-- 说明：environments、groups、user_metadata、saved_soql_queries、app_config、user_billing 表 BEFORE UPDATE 触发器调用，自动刷新 updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$

-- ---------- 表：user_billing 账号付费状态 ----------
-- 说明：一次性付费永久免费。is_paid 等付费标记仅 service_role / Webhook 可写。
-- 用户仅可 SELECT 自己的行；无用户 INSERT/UPDATE/DELETE（见 RLS；表级 revoke 见 migrations/user_billing.sql）。
-- 本文件只备份结构，不改线上数据。线上 apply 需产品批准。
create table public.user_billing (
  user_id uuid not null,
  is_paid boolean not null default false,
  paid_at timestamp with time zone null,
  stripe_customer_id text null,
  stripe_checkout_session_id text null,
  deactivate_purged_at timestamp with time zone null,
  pay_phase_started_at timestamp with time zone null,
  unpaid_grace_expires_at timestamp with time zone null,
  unpaid_purged_at timestamp with time zone null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint user_billing_pkey primary key (user_id),
  constraint user_billing_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_user_billing_unpaid_grace on public.user_billing using btree (unpaid_grace_expires_at)
  TABLESPACE pg_default
  where (is_paid = false and unpaid_purged_at is null);

create trigger trg_user_billing_touch BEFORE
update on user_billing for EACH row
execute FUNCTION touch_updated_at ();

-- ---------- 函数：ensure_user_billing_row 新用户建空计费行 ----------
-- 说明：auth.users 插入后自动建 user_billing；SECURITY DEFINER；幂等
CREATE OR REPLACE FUNCTION public.ensure_user_billing_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_billing (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 触发器挂在 auth.users（线上 apply 时执行；本备份仅记录）
-- CREATE TRIGGER on_auth_user_created_billing
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.ensure_user_billing_row();

-- ---------- 函数：claim_payment_from_stripe 幂等标记已付费 ----------
-- 说明：仅 service_role / Webhook 调用。同一 session 重复投递安全；已付费用户保持 is_paid。
CREATE OR REPLACE FUNCTION public.claim_payment_from_stripe(
  p_user_id uuid,
  p_session_id text,
  p_customer_id text DEFAULT NULL
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.user_billing%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR length(trim(p_session_id)) = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_billing (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.user_billing
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- 同一 Checkout Session 重复 Webhook：幂等成功
  IF v_row.stripe_checkout_session_id IS NOT NULL
     AND v_row.stripe_checkout_session_id = p_session_id THEN
    RETURN true;
  END IF;

  -- 已付费（其它 session）：保持已付费，不覆盖 session（仍返回成功）
  IF v_row.is_paid IS TRUE THEN
    RETURN true;
  END IF;

  UPDATE public.user_billing
  SET
    is_paid = true,
    paid_at = coalesce(paid_at, now()),
    stripe_checkout_session_id = p_session_id,
    stripe_customer_id = coalesce(nullif(p_customer_id, ''), stripe_customer_id),
    unpaid_grace_expires_at = NULL
  WHERE user_id = p_user_id;

  RETURN true;
END;
$function$;

-- ------------------------------------------------------------
-- RLS 策略（Row Level Security）
-- 说明：以下需确认各表已执行 enable row level security
-- ------------------------------------------------------------

-- app_config：anon / authenticated 可读总开关；普通角色不可写（无写策略；仅 service_role / Dashboard）
-- 放在 RLS 区最前，避免后续表策略切片测试误执行本段（依赖 anon 角色）。
alter table public.app_config enable row level security;
create policy "app_config_select" on public.app_config
  as PERMISSIVE for SELECT to anon, authenticated
  using (true);
grant select on public.app_config to anon, authenticated;

-- env_shares：用户管理自己创建的分享
alter table public.env_shares enable row level security;
create policy "用户管理自己创建的分享" on public.env_shares
  as PERMISSIVE for ALL to public
  using (auth.uid() = owner_user_id);

-- environments
alter table public.environments enable row level security;
create policy "env_delete" on public.environments
  as PERMISSIVE for DELETE to public
  using (auth.uid() = user_id);
create policy "env_insert" on public.environments
  as PERMISSIVE for INSERT to public;
create policy "env_select" on public.environments
  as PERMISSIVE for SELECT to public
  using (auth.uid() = user_id);
create policy "env_update" on public.environments
  as PERMISSIVE for UPDATE to public
  using (auth.uid() = user_id);

-- groups
alter table public.groups enable row level security;
create policy "grp_delete" on public.groups
  as PERMISSIVE for DELETE to public
  using (auth.uid() = user_id);
create policy "grp_insert" on public.groups
  as PERMISSIVE for INSERT to public;
create policy "grp_select" on public.groups
  as PERMISSIVE for SELECT to public
  using (auth.uid() = user_id);
create policy "grp_update" on public.groups
  as PERMISSIVE for UPDATE to public
  using (auth.uid() = user_id);

-- user_secrets
alter table public.user_secrets enable row level security;
create policy "secret_insert" on public.user_secrets
  as PERMISSIVE for INSERT to public;
create policy "secret_select" on public.user_secrets
  as PERMISSIVE for SELECT to public
  using (auth.uid() = user_id);
create policy "用户可更新自己的 user_secrets" on public.user_secrets
  as PERMISSIVE for UPDATE to authenticated
  using (auth.uid() = user_id);

-- user_metadata：仅本人可读写自己的偏好
alter table public.user_metadata enable row level security;
create policy "user_metadata_insert" on public.user_metadata
  as PERMISSIVE for INSERT to authenticated
  with check (auth.uid() = user_id);
create policy "user_metadata_select" on public.user_metadata
  as PERMISSIVE for SELECT to authenticated
  using (auth.uid() = user_id);
create policy "user_metadata_update" on public.user_metadata
  as PERMISSIVE for UPDATE to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- saved_soql_queries：仅本人可读写自己记下的查询
alter table public.saved_soql_queries enable row level security;
create policy "saved_soql_select" on public.saved_soql_queries
  as PERMISSIVE for SELECT to authenticated
  using (auth.uid() = user_id);
create policy "saved_soql_insert" on public.saved_soql_queries
  as PERMISSIVE for INSERT to authenticated
  with check (auth.uid() = user_id);
create policy "saved_soql_update" on public.saved_soql_queries
  as PERMISSIVE for UPDATE to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "saved_soql_delete" on public.saved_soql_queries
  as PERMISSIVE for DELETE to authenticated
  using (auth.uid() = user_id);

-- user_billing：用户仅可读自己的付费状态；无 INSERT/UPDATE/DELETE 策略（客户端不可写 is_paid）
-- 表级 REVOKE / claim 函数 GRANT 见 migrations/user_billing.sql（线上 apply 时执行）
alter table public.user_billing enable row level security;
create policy "user_billing_select_own" on public.user_billing
  as PERMISSIVE for SELECT to authenticated
  using (auth.uid() = user_id);