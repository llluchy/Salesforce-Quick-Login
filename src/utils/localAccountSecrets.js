// ============================================
// 退出扩展账号时，清掉这台电脑上的环境机密
// ============================================
// 只删本地镜像：环境账号 / 密码 / 验证器（TOTP、Passkey）、主密钥、会话副本。
// 不碰云端，不碰浏览器里已经打开的 Salesforce Cookie，也不碰语言、浮动栏、安装 ID、
// 以及已打开页面上的 Apex 工具状态。已登录网站的主机名只活在本地环境镜像里，
// 随镜像一起删掉，不会写到云端，因此不会跟到另一台电脑。

import { STORAGE_KEY, STORAGE_KEY_GROUPS, STORAGE_KEY_SESSION } from './constants.js'

/** 旧版单独存放的 Passkey，迁移后仍可能留在本机。 */
export const LEGACY_PASSKEY_STORAGE_KEY = '__sf_passkey_credentials'

/** 主密钥 JWK。和 useAuth 里的存储键相同。 */
export const CRYPTO_KEY_STORAGE_KEY = '__sf_crypto_key'

/** chrome.storage.local 里要删掉的账号机密。 */
export const LOCAL_ACCOUNT_SECRET_KEYS = [
  STORAGE_KEY,
  STORAGE_KEY_GROUPS,
  LEGACY_PASSKEY_STORAGE_KEY,
  CRYPTO_KEY_STORAGE_KEY,
  STORAGE_KEY_SESSION
]

/** chrome.storage.session 里要删掉的账号机密。 */
export const SESSION_ACCOUNT_SECRET_KEYS = [
  'sf_userKeyJwk',
  'sf_isLoggedIn',
  'sf_environments',
  'pendingLoginEnv'
]

/**
 * 退出后仍留在本机的键。测试用这份名单锁住「不要误删」。
 * 已打开的 Salesforce 网站靠浏览器 Cookie，不在这些键里。
 */
export const LOCAL_KEYS_KEPT_ON_LOGOUT = [
  'ui_locale',
  'sfql_tool_float_pos',
  'sf_install_id',
  '__sf_migrated_to_supabase',
  '__sf_pwd_unlock_count',
  '__sf_pwd_unlock_date',
  '__sf_last_login_date',
  '__sf_login_count',
  'sfql_apex_environments',
  'sfql_apex_active_env',
  'sfql_apex_tracked_users'
]

export const SESSION_KEYS_KEPT_ON_LOGOUT = [
  'sfql_tool_float_session_visible',
  'ui_locale_session',
  'sfql_apex_trace_lease'
]

function removeFromLocalStorage(keys) {
  if (typeof localStorage === 'undefined' || !localStorage?.removeItem) return
  for (const key of keys) {
    try { localStorage.removeItem(key) } catch { /* 隐私模式等 */ }
  }
}

async function defaultLocalRemove(keys) {
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.remove) {
    await chrome.storage.local.remove(keys)
  }
  // 扩展里环境缓存在 chrome.storage.local；无 chrome 时才落在 localStorage。
  // 两边同名键都清掉，避免只清一边时另一边还留着密码。
  removeFromLocalStorage(keys)
}

async function defaultSessionRemove(keys) {
  if (typeof chrome !== 'undefined' && chrome.storage?.session?.remove) {
    await chrome.storage.session.remove(keys)
  }
}

/**
 * 清掉本机上的环境账号、密码和验证器。
 * 传入 local / session 时只动这两块（测试用），不再碰全局存储。
 * 没有任何云端客户端参数：这里写不了 Supabase，也碰不到 Cookie。
 */
export async function clearLocalAccountSecrets({ local, session } = {}) {
  if (local) {
    if (typeof local.remove === 'function') await local.remove(LOCAL_ACCOUNT_SECRET_KEYS)
  } else {
    await defaultLocalRemove(LOCAL_ACCOUNT_SECRET_KEYS)
  }

  if (session) {
    if (typeof session.remove === 'function') await session.remove(SESSION_ACCOUNT_SECRET_KEYS)
  } else {
    await defaultSessionRemove(SESSION_ACCOUNT_SECRET_KEYS)
  }
}
