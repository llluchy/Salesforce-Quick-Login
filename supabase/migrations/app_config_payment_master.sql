-- ============================================================
-- app_config：管理员总开关（payment_master）
-- ============================================================
-- 作用：
--   新增全局配置表，种子行 key=payment_master、value={"enabled":false}。
--   enabled=false → 提醒阶段；enabled=true → 收费阶段。
--   扩展用 anon / authenticated 只读；写入仅 Dashboard SQL / service_role。
--
-- 线上 apply：
--   本文件只进仓库。等产品确认后再在 Supabase SQL Editor / Dashboard 执行。
--   拨开关示例（勿在本迁移默认执行）：
--     update public.app_config
--     set value = '{"enabled": true}'::jsonb, updated_at = now()
--     where key = 'payment_master';
-- ============================================================

create table if not exists public.app_config (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone null default now(),
  updated_by uuid null,
  constraint app_config_pkey primary key (key),
  constraint app_config_updated_by_fkey foreign key (updated_by) references auth.users (id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_app_config_touch'
  ) then
    create trigger trg_app_config_touch
      before update on public.app_config
      for each row
      execute function public.touch_updated_at();
  end if;
end $$;

insert into public.app_config (key, value)
values ('payment_master', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

alter table public.app_config enable row level security;

drop policy if exists "app_config_select" on public.app_config;
create policy "app_config_select" on public.app_config
  as permissive for select to anon, authenticated
  using (true);

grant select on public.app_config to anon, authenticated;
