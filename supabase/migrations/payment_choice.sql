-- ============================================================
-- 提醒阶段：user_metadata.payment_choice / payment_choice_at
-- ============================================================
-- 作用：
--   扩展账号在总开关 OFF 时强制一次性选择「继续」或「停用」。
--   选定后不可由普通客户端改回；改选只能邮件联系所有者后由管理员手工改。
--
-- 说明：
--   - 仓库备份 + 可 apply 的迁移脚本。
--   - 2026-11-26：已对线上项目 Salesforce Quick Login apply（缺列会导致提醒弹窗静默不出现）。
--   - 依赖约定：总开关表 public.app_config（key=payment_master）由「管理员总开关」维护；
--     本迁移不创建 app_config。
-- ============================================================

alter table public.user_metadata
  add column if not exists payment_choice text null;

alter table public.user_metadata
  add column if not exists payment_choice_at timestamp with time zone null;

alter table public.user_metadata
  drop constraint if exists user_metadata_payment_choice_check;

alter table public.user_metadata
  add constraint user_metadata_payment_choice_check check (
    payment_choice is null
    or payment_choice = any (array['continue'::text, 'deactivate'::text])
  );

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

drop trigger if exists trg_user_metadata_payment_choice_immutable on public.user_metadata;

create trigger trg_user_metadata_payment_choice_immutable BEFORE
update on user_metadata for EACH row
execute FUNCTION prevent_payment_choice_change ();
