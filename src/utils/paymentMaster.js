// 管理员总开关（payment_master）。真相源为 public.app_config；
// chrome.storage.session 仅短 TTL 缓存，不是权威副本。不写入 local/sync。

export const PAYMENT_MASTER_KEY = 'payment_master'
export const PAYMENT_MASTER_CACHE_KEY = 'sfql_payment_master_cache'
/** 会话缓存 TTL（毫秒），落在计划建议的 60–300s 内 */
export const PAYMENT_MASTER_CACHE_TTL_MS = 120000

export function toError(error) {
  if (error instanceof Error) return error
  const err = new Error(error?.message || 'app_config request failed')
  if (error?.code) err.code = error.code
  if (error?.status) err.status = error.status
  return err
}

/**
 * 解析 app_config.value → 是否进入收费阶段。
 * 缺行 / 非法 JSON 形状时按默认关闭（提醒阶段）。
 */
export function parsePaymentMasterEnabled(value) {
  if (value == null) return false
  let obj = value
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value)
    } catch {
      return false
    }
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) return false
  return obj.enabled === true
}

export function supabaseAppConfigIo(client) {
  return {
    async selectPaymentMaster() {
      const { data, error } = await client
        .from('app_config')
        .select('key, value')
        .eq('key', PAYMENT_MASTER_KEY)
        .maybeSingle()
      return { data, error }
    }
  }
}

async function parseRest(res) {
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    throw toError({
      message: body?.message || body?.error || `HTTP ${res.status}`,
      code: body?.code,
      status: res.status
    })
  }
  return body
}

/**
 * REST 读开关。无用户 session 时用 anon key 作 Bearer（anon 可读）。
 * accessToken 可选；传入用户 JWT 亦可。
 */
export function createAppConfigRestIo({ supabaseUrl, anonKey, accessToken, fetchImpl }) {
  const fetchFn = fetchImpl || fetch
  const base = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/app_config`
  const token = accessToken || anonKey
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json'
  }
  const url =
    `${base}?key=eq.${encodeURIComponent(PAYMENT_MASTER_KEY)}&select=key,value`

  return {
    async selectPaymentMaster() {
      try {
        const res = await fetchFn(url, { headers })
        const body = await parseRest(res)
        const row = Array.isArray(body) ? body[0] : body
        return { data: row ?? null, error: null }
      } catch (error) {
        return { data: null, error: toError(error) }
      }
    }
  }
}

export async function fetchPaymentMasterEnabled(io) {
  const selected = await io.selectPaymentMaster()
  if (selected.error) throw toError(selected.error)
  return parsePaymentMasterEnabled(selected.data?.value)
}

async function readCache(sessionArea, now, ttlMs) {
  if (!sessionArea?.get) return null
  const data = await sessionArea.get(PAYMENT_MASTER_CACHE_KEY)
  const cached = data?.[PAYMENT_MASTER_CACHE_KEY]
  if (!cached || typeof cached !== 'object') return null
  if (typeof cached.enabled !== 'boolean') return null
  if (typeof cached.fetchedAt !== 'number') return null
  if (now - cached.fetchedAt > ttlMs) return null
  return cached.enabled
}

async function writeCache(sessionArea, enabled, now) {
  if (!sessionArea?.set) return
  await sessionArea.set({
    [PAYMENT_MASTER_CACHE_KEY]: { enabled: enabled === true, fetchedAt: now }
  })
}

/**
 * 读总开关。可选短 TTL session 缓存；force 时跳过缓存。
 * 网络失败时抛错，由调用方按阶段决定 fail-open / fail-closed（本 PR 不接门闩）。
 */
export async function getPaymentMasterEnabled({
  io,
  sessionArea,
  now = Date.now(),
  ttlMs = PAYMENT_MASTER_CACHE_TTL_MS,
  force = false
} = {}) {
  if (!io) throw toError({ message: 'app_config io missing' })
  if (!force) {
    const cached = await readCache(sessionArea, now, ttlMs)
    if (cached !== null) return cached
  }
  const enabled = await fetchPaymentMasterEnabled(io)
  try {
    await writeCache(sessionArea, enabled, now)
  } catch {
    /* 缓存失败不影响真相源结果 */
  }
  return enabled
}

/** 清掉会话缓存（例如调试或显式刷新前）。 */
export async function clearPaymentMasterCache(sessionArea) {
  if (!sessionArea?.remove) return
  await sessionArea.remove(PAYMENT_MASTER_CACHE_KEY)
}
