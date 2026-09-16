// ============================================
// 数据存储层（Supabase + 本地缓存）
// ============================================
// 设计要点：
// 1. Supabase 是唯一真相源（single source of truth）
// 2. chrome.storage.local 仅作离线只读缓存（断网时仍可显示）
// 3. 敏感字段在客户端加密后写入 Supabase（密钥来自 useAuth.cryptoKey）
// 4. EditModal / EnvCard 不感知加密，加解密在 saveEnvironments/loadEnvironments 内部完成
// 5. saveEnvironments(envs) 保留数组接口，内部做 diff：upsert 新增/修改 + delete 删除
// ============================================

import { STORAGE_KEY, STORAGE_KEY_GROUPS } from '../utils/constants'
import { getSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import {
  encryptEnv, decryptEnv,
  encryptGroup, decryptGroup
} from '../utils/crypto'
import { t } from '../i18n'

const isChromeExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
const isChromeSession = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session

const TAG = '[Supabase/Storage]'
const log = (action, detail) => {
}
const logError = (action, err) => console.error(`${TAG} ✗ ${action}`, err)
const logWarn = (action, detail) => console.warn(`${TAG} ⚠ ${action}`, detail)

// ============================================
// 本地缓存辅助（chrome.storage.local）
// ============================================
async function cacheSet(key, value) {
  if (!isChromeExt) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) {}
    return
  }
  try {
    await chrome.storage.local.set({ [key]: value })
  } catch (e) {
    logWarn('cacheSet 失败', { key, error: e.message })
  }
}

async function cacheGet(key) {
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
    logWarn('cacheGet 失败', { key, error: e.message })
    return null
  }
}

async function cacheRemove(key) {
  if (!isChromeExt) {
    try { localStorage.removeItem(key) } catch (e) {}
    return
  }
  try {
    await chrome.storage.local.remove(key)
  } catch (e) {
    logWarn('cacheRemove 失败', { key, error: e.message })
  }
}

async function syncEnvsToSession(envs) {
  if (!isChromeSession) return
  try {
    await chrome.storage.session.set({ sf_environments: envs })
    log('已同步 environments 到 session storage', { count: envs?.length || 0 })
  } catch (e) {
    logWarn('同步 environments 到 session 失败', e.message)
  }
}

// ============================================
// 当前 cryptoKey 获取（来自 useAuth）
// 使用 getCryptoKeyRaw() 避免 readonly Proxy 导致 Web Crypto API 拒绝
// ============================================
function getCryptoKey() {
  const { getCryptoKeyRaw } = useAuth()
  return getCryptoKeyRaw ? getCryptoKeyRaw() : null
}

// ============================================
// 当前 userId 获取（来自 useAuth）
// 用于 RLS 策略 auth.uid() = user_id
// ============================================
function getUserId() {
  const { currentUser } = useAuth()
  return currentUser.value?.id || null
}

// ============================================
// 主 API
// ============================================
export function useStorage() {
  // ----------------------------------------
  // 环境列表
  // ----------------------------------------

  /**
   * 加载所有环境（解密后）
   * 流程：
   * 1. 从 Supabase 拉取
   * 2. 用 cryptoKey 解密
   * 3. 写入 chrome.storage.local 缓存
   * 4. 返回明文 env 数组
   * 失败时 fallback 到 local 缓存（离线场景）
   * @param {{ detailed?: boolean }} [opts] detailed=true 时返回 { data, source, error }
   *   source: 'remote' | 'cache' | 'empty'
   */
  const loadEnvironments = async (opts = {}) => {
    log('loadEnvironments')
    const detailed = !!opts.detailed
    const wrap = (data, source, error = null) =>
      detailed ? { data, source, error, count: data.length } : data

    const supabase = getSupabase()
    const key = getCryptoKey()

    if (!supabase) {
      logWarn('Supabase 未初始化，使用本地缓存')
      const cached = await cacheGet(STORAGE_KEY)
      const result = Array.isArray(cached) ? cached : []
      await syncEnvsToSession(result)
      return wrap(result, result.length ? 'cache' : 'empty', t('storage.supabaseNotInit'))
    }
    if (!key) {
      logWarn('cryptoKey 未派生（未解锁），使用本地缓存')
      const cached = await cacheGet(STORAGE_KEY)
      const result = Array.isArray(cached) ? cached : []
      await syncEnvsToSession(result)
      return wrap(result, result.length ? 'cache' : 'empty', t('storage.keyNotDerived'))
    }

    try {
      const { data, error } = await supabase
        .from('environments')
        .select('*')
        .eq('is_deleted', false)
        .order('sort_order', { ascending: true })

      if (error) throw new Error(t('storage.queryFailed', { msg: error.message }))

      const { decryptEnv } = await import('../utils/crypto')

      const envs = []
      for (const row of data || []) {
        try {
          const env = await decryptEnv(row, key)
          envs.push(env)
        } catch (decryptErr) {
          console.error('[Storage] 环境解密失败', {
            id: row.id,
            error: decryptErr.message
          })
          logError(`环境解密失败，跳过: ${row.id}`, decryptErr.message)
        }
      }

      log('读取成功', { count: envs.length, total: data?.length, ids: envs.map(e => e.id) })

      await cacheSet(STORAGE_KEY, envs)
      await syncEnvsToSession(envs)
      return wrap(envs, 'remote')
    } catch (e) {
      logError('从 Supabase 读取失败，fallback 到本地缓存', e)
      console.error('[Storage] loadEnvironments 异常', e)
      const cached = await cacheGet(STORAGE_KEY)
      const result = Array.isArray(cached) ? cached : []
      await syncEnvsToSession(result)
      return wrap(result, result.length ? 'cache' : 'empty', e.message || String(e))
    }
  }

  /**
   * 保存环境列表（upsert 增量更新）
   * 流程：
   * 1. 对传入的 envs 数组逐个加密并 upsert
   * 2. 更新本地缓存
   * 删除操作通过 deleteEnvironment() 单独触发，避免本地数据不同步时误删
   */
  const saveEnvironments = async (envs) => {
    log('saveEnvironments', { count: envs?.length || 0 })
    const supabase = getSupabase()
    const userKey = getCryptoKey()

    if (!supabase) return { success: false, error: t('storage.supabaseNotInit') }
    if (!userKey) return { success: false, error: t('storage.keyNotDerivedUnlock') }

    const envList = Array.isArray(envs) ? envs : []

    const rowsToUpsert = []
    for (let i = 0; i < envList.length; i++) {
      const env = envList[i]
      // 单条保存（如编辑单个环境）时不更新排序，避免将 sortOrder 重置为 0
      if (envList.length > 1) {
        env.sortOrder = i
      }
      env.updatedAt = Date.now()
      if (!env.createdAt) env.createdAt = Date.now()

      const encrypted = await encryptEnv(env, userKey, getUserId())
      rowsToUpsert.push(encrypted)
    }

    // 2. 批量 upsert
    if (rowsToUpsert.length > 0) {
      const { data: upserted, error: upsertErr } = await supabase
        .from('environments')
        .upsert(rowsToUpsert, { onConflict: 'id' })
        .select('id, created_at, updated_at')
      if (upsertErr) {
        logError('upsert 失败', upsertErr)
        return { success: false, error: t('storage.writeFailed', { msg: upsertErr.message }) }
      }

      if (upserted && upserted.length === envList.length) {
        for (let i = 0; i < envList.length; i++) {
          if (upserted[i].created_at) envList[i].createdAt = new Date(upserted[i].created_at).getTime()
          if (upserted[i].updated_at) envList[i].updatedAt = new Date(upserted[i].updated_at).getTime()
        }
      }
    }

    // 3. 更新本地缓存（合并到现有缓存，避免单条保存时覆盖其他环境）
    const cached = await cacheGet(STORAGE_KEY)
    const merged = Array.isArray(cached) ? [...cached] : []
    for (const env of envList) {
      const idx = merged.findIndex(e => e.id === env.id)
      if (idx !== -1) {
        merged[idx] = env
      } else {
        merged.push(env)
      }
    }
    await cacheSet(STORAGE_KEY, merged)
    await syncEnvsToSession(merged)
    log('保存成功', { count: envList.length })
    return { success: true }
  }

  /**
   * 删除单个环境（伪删除：仅标记 is_deleted=true 和 deleted_at=now()）
   */
  const deleteEnvironment = async (id) => {
    log('deleteEnvironment (soft)', { id })
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: t('storage.supabaseNotInit') }

    const { error } = await supabase
      .from('environments')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      logError('伪删除失败', error)
      return { success: false, error: error.message }
    }
    // 更新本地缓存
    const cached = await cacheGet(STORAGE_KEY)
    if (Array.isArray(cached)) {
      await cacheSet(STORAGE_KEY, cached.filter(e => e.id !== id))
    }
    return { success: true }
  }

  // ----------------------------------------
  // 分组列表
  // ----------------------------------------

  /**
   * @param {{ detailed?: boolean }} [opts] detailed=true 时返回 { data, source, error }
   */
  const loadGroups = async (opts = {}) => {
    log('loadGroups')
    const detailed = !!opts.detailed
    const wrap = (data, source, error = null) =>
      detailed ? { data, source, error, count: data.length } : data

    const supabase = getSupabase()
    const key = getCryptoKey()

    if (!supabase) {
      logWarn('Supabase 未初始化，使用本地缓存')
      const cached = await cacheGet(STORAGE_KEY_GROUPS)
      const result = Array.isArray(cached) ? cached : []
      return wrap(result, result.length ? 'cache' : 'empty', t('storage.supabaseNotInit'))
    }
    if (!key) {
      logWarn('cryptoKey 未派生（未解锁），使用本地缓存')
      const cached = await cacheGet(STORAGE_KEY_GROUPS)
      const result = Array.isArray(cached) ? cached : []
      return wrap(result, result.length ? 'cache' : 'empty', t('storage.keyNotDerived'))
    }

    try {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('sort_order', { ascending: true })
      if (error) throw new Error(t('storage.queryFailed', { msg: error.message }))

      const groups = (data || []).map(decryptGroup)
      log('读取成功', { count: groups.length, ids: groups.map(g => g.id) })
      await cacheSet(STORAGE_KEY_GROUPS, groups)
      return wrap(groups, 'remote')
    } catch (e) {
      logError('从 Supabase 读取分组失败，fallback 到本地缓存', e)
      console.error('[Storage] loadGroups 失败详情:', e)
      const cached = await cacheGet(STORAGE_KEY_GROUPS)
      console.log('[Storage] loadGroups fallback 到缓存，缓存数据:', cached ? cached.length : 0, '条')
      const result = Array.isArray(cached) ? cached : []
      return wrap(result, result.length ? 'cache' : 'empty', e.message || String(e))
    }
  }

  const saveGroups = async (groups) => {
    log('saveGroups', { count: groups?.length || 0 })
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: t('storage.supabaseNotInit') }

    const groupList = Array.isArray(groups) ? groups : []

    // 1. 加密（分组无敏感字段，仅格式转换）+ upsert
    const rowsToUpsert = []
    for (let i = 0; i < groupList.length; i++) {
      const g = groupList[i]
      g.sortOrder = i
      g.updatedAt = Date.now()
      if (!g.createdAt) g.createdAt = Date.now()
      const encrypted = encryptGroup(g, getUserId())
      rowsToUpsert.push(encrypted)
    }

    if (rowsToUpsert.length > 0) {
      const { data: upserted, error: upsertErr } = await supabase
        .from('groups')
        .upsert(rowsToUpsert, { onConflict: 'id' })
        .select('id, created_at, updated_at')
      if (upsertErr) {
        logError('upsert 分组失败', upsertErr)
        return { success: false, error: upsertErr.message }
      }
      if (upserted && upserted.length === groupList.length) {
        for (let i = 0; i < groupList.length; i++) {
          if (upserted[i].created_at) groupList[i].createdAt = new Date(upserted[i].created_at).getTime()
          if (upserted[i].updated_at) groupList[i].updatedAt = new Date(upserted[i].updated_at).getTime()
        }
      }
    }

    // 2. 更新本地缓存
    await cacheSet(STORAGE_KEY_GROUPS, groupList)
    log('保存分组成功', { count: groupList.length })
    return { success: true }
  }

  const deleteGroup = async (id) => {
    log('deleteGroup', { id })
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: t('storage.supabaseNotInit') }

    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('id', id)
    if (error) return { success: false, error: error.message }
    const cached = await cacheGet(STORAGE_KEY_GROUPS)
    if (Array.isArray(cached)) {
      await cacheSet(STORAGE_KEY_GROUPS, cached.filter(g => g.id !== id))
    }
    return { success: true }
  }

  // ----------------------------------------
  // Passkey 凭证（统一存储在 environments.passkeys 中）
  // ----------------------------------------

  /**
   * 加载所有 Passkey 凭证（从 environments.passkeys 聚合）
   */
  const loadPasskeyCredentials = async () => {
    log('loadPasskeyCredentials')
    try {
      const envs = await loadEnvironments()
      const creds = []
      for (const env of envs) {
        for (const pk of (env.passkeys || [])) {
          if (pk.credentialId && pk.privateKeyJwk) {
            creds.push({
              credentialId: pk.credentialId,
              rpId: pk.rpId,
              privateKeyJwk: pk.privateKeyJwk,
              publicKeyJwk: pk.publicKeyJwk,
              userId: pk.userId,
              userName: pk.userName,
              userDisplayName: pk.userDisplayName,
              envId: env.id,
              signCount: pk.signCount || 0,
              createdAt: pk.createdAt || Date.now()
            })
          }
        }
      }
      log('读取 Passkey 凭证成功', { count: creds.length })
      return creds
    } catch (e) {
      logError('读取 Passkey 凭证失败', e)
      return []
    }
  }

  /**
   * 保存单个 Passkey 凭证到对应环境的 passkeys 数组
   */
  const savePasskeyCredential = async (cred) => {
    log('savePasskeyCredential', { credentialId: cred?.credentialId, envId: cred?.envId })
    if (!cred?.envId) return { success: false, error: t('storage.missingEnvId') }

    try {
      const envs = await loadEnvironments()
      const idx = envs.findIndex(e => e.id === cred.envId)
      if (idx === -1) return { success: false, error: t('storage.envNotFound') }

      const env = envs[idx]
      env.passkeys = env.passkeys || []
      const pkIdx = env.passkeys.findIndex(pk => pk.credentialId === cred.credentialId)
      const pk = {
        credentialId: cred.credentialId,
        rpId: cred.rpId,
        privateKeyJwk: cred.privateKeyJwk,
        publicKeyJwk: cred.publicKeyJwk || null,
        userId: cred.userId || '',
        userName: cred.userName,
        userDisplayName: cred.userDisplayName,
        signCount: cred.signCount || 0,
        createdAt: cred.createdAt || Date.now()
      }
      if (pkIdx !== -1) {
        env.passkeys[pkIdx] = pk
      } else {
        env.passkeys.push(pk)
      }

      const result = await saveEnvironments(envs)
      log('保存 Passkey 凭证成功')
      return result
    } catch (e) {
      logError('保存 Passkey 凭证失败', e)
      return { success: false, error: e.message }
    }
  }

  /**
   * 按 credentialId 查询单个 Passkey 凭证
   */
  const getPasskeyCredentialById = async (credentialId) => {
    log('getPasskeyCredentialById', { credentialId })
    try {
      const envs = await loadEnvironments()
      for (const env of envs) {
        const pk = (env.passkeys || []).find(p => p.credentialId === credentialId)
        if (pk) {
          return {
            credentialId: pk.credentialId,
            rpId: pk.rpId,
            privateKeyJwk: pk.privateKeyJwk,
            publicKeyJwk: pk.publicKeyJwk,
            userId: pk.userId,
            userName: pk.userName,
            userDisplayName: pk.userDisplayName,
            envId: env.id,
            signCount: pk.signCount || 0,
            createdAt: pk.createdAt || Date.now()
          }
        }
      }
      return null
    } catch (e) {
      logError('查询 Passkey 凭证失败', e)
      return null
    }
  }

  /**
   * 按 rpId 过滤 Passkey 凭证
   */
  const getPasskeyCredentialsByRpId = async (rpId) => {
    log('getPasskeyCredentialsByRpId', { rpId })
    try {
      const envs = await loadEnvironments()
      const creds = []
      for (const env of envs) {
        for (const pk of (env.passkeys || [])) {
          if (pk.rpId === rpId && pk.credentialId && pk.privateKeyJwk) {
            creds.push({
              credentialId: pk.credentialId,
              rpId: pk.rpId,
              privateKeyJwk: pk.privateKeyJwk,
              publicKeyJwk: pk.publicKeyJwk,
              userId: pk.userId,
              userName: pk.userName,
              userDisplayName: pk.userDisplayName,
              envId: env.id,
              signCount: pk.signCount || 0,
              createdAt: pk.createdAt || Date.now()
            })
          }
        }
      }
      return creds
    } catch (e) {
      logError('按 rpId 查询 Passkey 凭证失败', e)
      return []
    }
  }

  /**
   * 更新 Passkey 凭证的 signCount（防重放）
   */
  const updatePasskeySignCount = async (credentialId, newSignCount) => {
    try {
      const envs = await loadEnvironments()
      let found = false
      for (const env of envs) {
        const pk = (env.passkeys || []).find(p => p.credentialId === credentialId)
        if (pk) {
          pk.signCount = newSignCount
          found = true
          break
        }
      }
      if (!found) {
        logWarn('更新 signCount 失败', '未找到 credentialId: ' + credentialId)
        return { success: false, error: t('storage.credNotFound') }
      }
      await saveEnvironments(envs)
      return { success: true }
    } catch (e) {
      logWarn('更新 signCount 失败', e.message)
      return { success: false, error: e.message }
    }
  }

  /**
   * 清空本地缓存（登出时调用）
   */
  const clearCache = async () => {
    await cacheRemove(STORAGE_KEY)
    await cacheRemove(STORAGE_KEY_GROUPS)
    log('本地缓存已清空')
  }

  return {
    // 环境
    loadEnvironments,
    saveEnvironments,
    deleteEnvironment,
    // 分组
    loadGroups,
    saveGroups,
    deleteGroup,
    // Passkey 凭证
    loadPasskeyCredentials,
    savePasskeyCredential,
    getPasskeyCredentialById,
    getPasskeyCredentialsByRpId,
    updatePasskeySignCount,
    // 缓存
    clearCache
  }
}
