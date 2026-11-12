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
-- 本文件只备份结构。ui_locale 只加在这里，不改线上数据。
create table public.user_metadata (
  user_id uuid not null,
  show_tool_float boolean not null default true,
  ui_locale text not null default 'system'::text,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint user_metadata_pkey primary key (user_id),
  constraint user_metadata_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint user_metadata_ui_locale_check check (
    ui_locale in ('system', 'zh-CN', 'en', 'ja')
  )
) TABLESPACE pg_default;

create trigger trg_user_metadata_touch BEFORE
update on user_metadata for EACH row
execute FUNCTION touch_updated_at ();

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
-- 说明：environments、groups、user_metadata、saved_soql_queries 表 BEFORE UPDATE 触发器调用，自动刷新 updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$

-- ------------------------------------------------------------
-- RLS 策略（Row Level Security）
-- 说明：以下需确认各表已执行 enable row level security
-- ------------------------------------------------------------

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