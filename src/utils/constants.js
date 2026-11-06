// 环境列表的本地缓存 key（仅用于离线只读缓存）
export const STORAGE_KEY = 'salesforce_environments'
// 分组列表的本地缓存 key
export const STORAGE_KEY_GROUPS = 'salesforce_groups'

// Supabase session 在 chrome.storage.local 中的同步 key（供 background.js 使用）
export const STORAGE_KEY_SESSION = '__sf_supabase_session'

// 页面浮动栏开关的本地镜像。真相源是 Supabase 表 public.user_metadata.show_tool_float。
// content.js 不能读 Supabase，只听这个 key。两边字符串必须一致。
export const STORAGE_KEY_SHOW_TOOL_FLOAT = 'sf_show_tool_float'

export const MAX_ENVIRONMENTS = 50

export const TYPE_URLS = {
  production: 'https://login.salesforce.com',
  sandbox: 'https://test.salesforce.com',
  custom: ''
}

export const TYPE_LABELS = {
  production: 'Production',
  sandbox: 'SandBox',
  // Prefer EnvCard / UI t('type.*'); kept for any legacy reference
  custom: '自定义'
}
