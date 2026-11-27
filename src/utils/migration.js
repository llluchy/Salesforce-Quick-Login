// ============================================
// 一次性迁移工具：本地 chrome.storage → Supabase
// ============================================
// 触发时机：用户首次登录成功后（App.vue onAuthed 中调用一次）
// 触发条件：
//   1. 本地 chrome.storage.local 存在旧数据（chrome.storage.sync 时代遗留）
//   2. Supabase 云端对应表为空（避免覆盖云端已有数据）
//   3. 未标记过迁移完成（__sf_migrated_to_supabase !== true）
// 行为：
//   - 读取本地旧 environments / groups / passkey_credentials
//   - 复用 useStorage 的 saveEnvironments / saveGroups / savePasskeyCredential
//     （内部会加密 + upsert Supabase + 更新本地缓存）
//   - 标记迁移完成，避免重复执行
//   - 不删除本地旧数据（作为离线只读缓存保留）
// ============================================

import { useStorage } from '../composables/useStorage'
import { getSupabase } from '../composables/useSupabase'
import { STORAGE_KEY, STORAGE_KEY_GROUPS } from './constants'

const MIGRATION_FLAG_KEY = '__sf_migrated_to_supabase'

/**
 * 直接查云端行数（head count），勿经 loadEnvironments——
 * 后者在失败/付费门时会回落本机缓存，不能当作「云端已有数据」。
 */
async function cloudHasEnvironmentRows() {
  const supabase = getSupabase()
  if (!supabase) {
    return { ok: false, hasRows: false, error: 'supabase not init' }
  }
  const { count, error } = await supabase
    .from('environments')
    .select('id', { count: 'exact', head: true })
    .eq('is_deleted', false)
  if (error) {
    return { ok: false, hasRows: false, error: error.message }
  }
  return { ok: true, hasRows: (count || 0) > 0 }
}

/** Path A/B 已 purge：付费后按空新用户，禁止把本机旧快照迁回云端 */
async function readOwnPurgeFlags() {
  const supabase = getSupabase()
  if (!supabase) return { ok: false, purged: false, error: 'supabase not init' }
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr) return { ok: false, purged: false, error: sessionErr.message }
  const userId = sessionData?.session?.user?.id
  if (!userId) return { ok: false, purged: false, error: 'not authenticated' }
  const { data, error } = await supabase
    .from('user_billing')
    .select('unpaid_purged_at,deactivate_purged_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { ok: false, purged: false, error: error.message }
  const purged = !!(data?.unpaid_purged_at || data?.deactivate_purged_at)
  return { ok: true, purged }
}

const isChromeExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local

async function clearLocalEnvAndGroupCache() {
  if (!isChromeExt) return
  try {
    await chrome.storage.local.remove([STORAGE_KEY, STORAGE_KEY_GROUPS])
  } catch {
    /* ignore */
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUuid(str) {
  return typeof str === 'string' && UUID_REGEX.test(str)
}

async function readLocal(key) {
  if (!isChromeExt) {
    try {
      const v = localStorage.getItem(key)
      return v ? JSON.parse(v) : null
    } catch (e) { return null }
  }
  try {
    const result = await chrome.storage.local.get(key)
    return result[key]
  } catch (e) {
    console.warn('[Migration] 读取本地失败', key, e)
    return null
  }
}

async function setLocal(key, value) {
  if (!isChromeExt) return
  try {
    await chrome.storage.local.set({ [key]: value })
  } catch (e) {
    console.warn('[Migration] 写入本地失败', key, e)
  }
}

/**
 * 执行迁移
 * @returns {Promise<{skipped?: boolean, success?: boolean, reason?: string, migrated?: {environments: number, groups: number, passkeys: number}}>}
 */
export async function migrateLocalToSupabase() {

  // 1. 检查迁移标记
  const migrated = await readLocal(MIGRATION_FLAG_KEY)
  if (migrated === true) {
    return { skipped: true, reason: '已迁移过' }
  }

  // 2. 先读本地：无本地可保护 → 直接跳过（允许远端 loadData），勿因 purge 探测失败 deferred
  const oldEnvs = await readLocal('salesforce_environments')
  const oldGroups = await readLocal('salesforce_groups')
  const oldPasskeys = await readLocal('__sf_passkey_credentials')

  const envCount = Array.isArray(oldEnvs) ? oldEnvs.length : 0
  const groupCount = Array.isArray(oldGroups) ? oldGroups.length : 0
  const passkeyCount = Array.isArray(oldPasskeys) ? oldPasskeys.length : 0

  if (envCount === 0 && groupCount === 0 && passkeyCount === 0) {
    await setLocal(MIGRATION_FLAG_KEY, true)
    return { skipped: true, reason: '本地无旧数据' }
  }

  // 3. purge 标记（仅在有本地数据需保护时）：
  // - 确认已 purge → 空新用户，清本机并拒绝上传
  // - 确认未 purge → 继续迁移
  // - 读取失败 → deferred（勿当 purged；勿标已迁移；调用方勿用空云端盖本机）
  const purge = await readOwnPurgeFlags()
  if (!purge.ok) {
    return {
      deferred: true,
      skipped: true,
      hasLocalData: true,
      reason: '检查 purge 状态失败：' + (purge.error || '')
    }
  }
  if (purge.purged) {
    await clearLocalEnvAndGroupCache()
    await setLocal(MIGRATION_FLAG_KEY, true)
    return { skipped: true, reason: '已 purge，按空新用户' }
  }

  // 4. 检查云端是否已有真实行（避免覆盖）；查询失败则 defer，勿误标已迁移、勿随后空云端覆盖
  const cloud = await cloudHasEnvironmentRows()
  if (!cloud.ok) {
    return {
      deferred: true,
      skipped: true,
      hasLocalData: true,
      reason: '检查云端失败：' + (cloud.error || '')
    }
  }
  if (cloud.hasRows) {
    await setLocal(MIGRATION_FLAG_KEY, true)
    return { skipped: true, reason: '云端已有数据' }
  }

  // 5. 加密 + upsert 到 Supabase
  const { saveEnvironments, saveGroups, savePasskeyCredential } = useStorage()
  try {
    if (envCount > 0) {
      // 清理 env 的临时 id（让 Supabase 生成 UUID）
      // 旧数据的 id 可能是纯数字字符串，不是 UUID，需要转为 undefined
      const envsToMigrate = oldEnvs.map(e => ({
        ...e,
        id: e.id && !String(e.id).startsWith('tmp_') && isValidUuid(e.id) ? e.id : undefined
      }))
      const r = await saveEnvironments(envsToMigrate)
      if (!r?.success) {
        console.error('[Migration] 迁移 environments 失败', r)
        return { success: false, reason: '迁移 environments 失败：' + (r?.error || '') }
      }
    }

    if (groupCount > 0) {
      const groupsToMigrate = oldGroups.map(g => ({
        ...g,
        id: g.id && !String(g.id).startsWith('tmp_') && isValidUuid(g.id) ? g.id : undefined
      }))
      const r = await saveGroups(groupsToMigrate)
      if (!r?.success) {
        console.error('[Migration] 迁移 groups 失败', r)
        return { success: false, reason: '迁移 groups 失败：' + (r?.error || '') }
      }
    }

    let migratedPasskeys = 0
    if (passkeyCount > 0) {
      for (const cred of oldPasskeys) {
        const r = await savePasskeyCredential(cred)
        if (r?.success) migratedPasskeys++
      }
    }

    // 6. 标记迁移完成
    await setLocal(MIGRATION_FLAG_KEY, true)

    return {
      success: true,
      migrated: {
        environments: envCount,
        groups: groupCount,
        passkeys: migratedPasskeys
      }
    }
  } catch (e) {
    console.error('[Migration] 迁移异常', e)
    return { success: false, deferred: true, reason: e.message || String(e) }
  }
}

/**
 * migrateThenLoad 是否可安全走远端 loadData。
 * deferred/失败且有本机业务缓存（envs 或 groups）时禁止；全空才可安全拉云端。
 */
export function migrateAllowsRemoteLoad(result, { localCacheCount = 0 } = {}) {
  if (!result) return false
  if (result.deferred === true || result.success === false) {
    return localCacheCount === 0
  }
  return true
}
