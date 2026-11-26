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

const isChromeExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local

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

  // 2. 读取本地旧数据
  const oldEnvs = await readLocal('salesforce_environments')
  const oldGroups = await readLocal('salesforce_groups')
  const oldPasskeys = await readLocal('__sf_passkey_credentials')

  const envCount = Array.isArray(oldEnvs) ? oldEnvs.length : 0
  const groupCount = Array.isArray(oldGroups) ? oldGroups.length : 0
  const passkeyCount = Array.isArray(oldPasskeys) ? oldPasskeys.length : 0

  if (envCount === 0 && groupCount === 0 && passkeyCount === 0) {
    // 无本地数据，直接标记迁移完成（避免后续重复检查）
    await setLocal(MIGRATION_FLAG_KEY, true)
    return { skipped: true, reason: '本地无旧数据' }
  }

  // 3. 检查云端是否已有真实行（避免覆盖）；查询失败则中止，勿误标已迁移
  const cloud = await cloudHasEnvironmentRows()
  if (!cloud.ok) {
    return { success: false, reason: '检查云端失败：' + (cloud.error || '') }
  }
  if (cloud.hasRows) {
    await setLocal(MIGRATION_FLAG_KEY, true)
    return { skipped: true, reason: '云端已有数据' }
  }

  // 4. 加密 + upsert 到 Supabase
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

    // 5. 标记迁移完成
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
    return { success: false, reason: e.message || String(e) }
  }
}
