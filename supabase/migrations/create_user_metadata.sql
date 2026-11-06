-- ============================================================
-- 表：user_metadata 扩展账户的个人配置
-- ============================================================
-- 这不是 Auth 的 raw_user_meta_data。
-- 每个扩展账户一行，用来做云同步（换设备登录后还能读回）。
--
-- 请在 Supabase 控制台 → SQL Editor 中整段执行一次。
-- 执行完刷新 Side Panel。浮动栏开关会读写本表的 show_tool_float。
-- ============================================================

create table if not exists public.user_metadata (
  user_id uuid not null,
  show_tool_float boolean not null default true,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint user_metadata_pkey primary key (user_id),
  constraint user_metadata_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

drop trigger if exists trg_user_metadata_touch on public.user_metadata;
create trigger trg_user_metadata_touch
  before update on public.user_metadata
  for each row
  execute function touch_updated_at();

alter table public.user_metadata enable row level security;

drop policy if exists "user_metadata_select" on public.user_metadata;
drop policy if exists "user_metadata_insert" on public.user_metadata;
drop policy if exists "user_metadata_update" on public.user_metadata;

create policy "user_metadata_select" on public.user_metadata
  as permissive for select to authenticated
  using (auth.uid() = user_id);

create policy "user_metadata_insert" on public.user_metadata
  as permissive for insert to authenticated
  with check (auth.uid() = user_id);

create policy "user_metadata_update" on public.user_metadata
  as permissive for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on table public.user_metadata to authenticated;
