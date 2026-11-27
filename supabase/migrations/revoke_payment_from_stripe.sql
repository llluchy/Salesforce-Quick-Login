-- ============================================================
-- revoke_payment_from_stripe：Stripe 退款后取消付费授权
-- 说明：仅 service_role / stripe-webhook 可调用；authenticated 不可改 is_paid。
-- 幂等：重复 Webhook（charge.refunded / refund.created / charge.refund.updated）安全。
-- ============================================================

alter table public.user_billing
  add column if not exists refunded_at timestamp with time zone null;

-- 重新付款成功时清掉退款痕迹，避免 is_paid=true 仍带 refunded_at
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
    unpaid_grace_expires_at = null,
    refunded_at = null
  where user_id = p_user_id;

  return true;
end;
$function$;

create or replace function public.revoke_payment_from_stripe(
  p_user_id uuid,
  p_refund_id text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.user_billing%rowtype;
begin
  if p_user_id is null then
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

  -- 已撤销：幂等成功（仍补写 refunded_at，不清 paid_at 作审计痕迹）
  if v_row.is_paid is not true then
    if v_row.refunded_at is null then
      update public.user_billing
      set
        refunded_at = now(),
        stripe_checkout_session_id = null
      where user_id = p_user_id;
    end if;
    return true;
  end if;

  update public.user_billing
  set
    is_paid = false,
    refunded_at = coalesce(refunded_at, now()),
    stripe_checkout_session_id = null
  where user_id = p_user_id;

  return true;
end;
$function$;

revoke all on function public.revoke_payment_from_stripe(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_payment_from_stripe(uuid, text) to service_role;
