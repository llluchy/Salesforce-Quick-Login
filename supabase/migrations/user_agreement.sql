-- ============================================================
-- 付费模式：user_metadata.user_agreement_accepted_at
-- ============================================================
-- 作用：
--   用户协议同意时间。2026-11-27 起在注册页勾选并写入；打开插件不再弹协议窗。
--   同意写入本列后不可改回（见下方 immutable 触发器）。
--
-- 说明：
--   - 仓库备份 + 可 apply 的迁移。
--   - 2026-11-26：与 payment_choice 同风格，可对线上 apply。
-- ============================================================

alter table public.user_metadata
  add column if not exists user_agreement_accepted_at timestamp with time zone null;

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

drop trigger if exists trg_user_metadata_user_agreement_immutable on public.user_metadata;

create trigger trg_user_metadata_user_agreement_immutable BEFORE
update on user_metadata for EACH row
execute FUNCTION prevent_user_agreement_change ();
