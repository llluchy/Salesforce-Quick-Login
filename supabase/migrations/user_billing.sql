-- ============================================================
-- user_billing：账号付费状态 + 幂等 Stripe 记账
-- 说明：仅仓库备份。线上 apply 需产品明确批准后再执行。
-- 价格：一次性 ¥5 CNY（Stripe Price 在 Dashboard 创建，见 docs/stripe-setup.md）
-- ============================================================

create table if not exists public.user_billing (
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
  constraint user_billing_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

create index if not exists idx_user_billing_unpaid_grace
  on public.user_billing using btree (unpaid_grace_expires_at)
  where (is_paid = false and unpaid_purged_at is null);

drop trigger if exists trg_user_billing_touch on public.user_billing;
create trigger trg_user_billing_touch
  before update on public.user_billing
  for each row
  execute function public.touch_updated_at();

create or replace function public.ensure_user_billing_row()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.user_billing (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
  after insert on auth.users
  for each row
  execute function public.ensure_user_billing_row();

-- 存量用户补空行（幂等）
insert into public.user_billing (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.claim_payment_from_stripe(
  p_user_id uuid,
  p_session_id text,
  p_customer_id text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.user_billing%rowtype;
begin
  if p_user_id is null or p_session_id is null or length(trim(p_session_id)) = 0 then
    return false;
  end if;

  insert into public.user_billing (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_row
  from public.user_billing
  where user_id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  if v_row.stripe_checkout_session_id is not null
     and v_row.stripe_checkout_session_id = p_session_id then
    return true;
  end if;

  if v_row.is_paid is true then
    return true;
  end if;

  update public.user_billing
  set
    is_paid = true,
    paid_at = coalesce(paid_at, now()),
    stripe_checkout_session_id = p_session_id,
    stripe_customer_id = coalesce(nullif(p_customer_id, ''), stripe_customer_id),
    unpaid_grace_expires_at = null
  where user_id = p_user_id;

  return true;
end;
$function$;

alter table public.user_billing enable row level security;

drop policy if exists "user_billing_select_own" on public.user_billing;
create policy "user_billing_select_own" on public.user_billing
  as permissive for select to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.user_billing from public, anon, authenticated;
grant select on public.user_billing to authenticated;

revoke all on function public.claim_payment_from_stripe(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_payment_from_stripe(uuid, text, text) to service_role;
