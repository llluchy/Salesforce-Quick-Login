/**
 * 读收费总开关 / billing / choice；短 TTL 缓存（非真相源）。
 * 表结构对齐 payment-developer-plan；依赖 sibling PR 的 DDL 线上落地。
 * 永不把 Salesforce 会话经此通道同步到其他设备。
 */

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig.js'
import { STORAGE_KEY_SESSION } from './constants.js'
import { resolvePaymentAccess } from './paymentAccess.js'

export const PAYMENT_MASTER_KEY = 'payment_master'
export const PAYMENT_GATE_CACHE_SESSION_KEY = 'sfql_payment_gate_cache'
export const PAYMENT_GATE_CACHE_TTL_MS = 120_000

function toError(error) {
  if (error instanceof Error) return error
  const err = new Error(error?.message || 'payment gate request failed')
  if (error?.code) err.code = error.code
  if (error?.status) err.status = error.status
  return err
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

function restHeaders(accessToken) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  else headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`
  return headers
}

export function parsePaymentMasterEnabled(row) {
  const value = row?.value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.enabled === true
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed?.enabled === true
    } catch {
      return false
    }
  }
  return false
}

/**
 * @param {{ supabaseUrl?: string, anonKey?: string, accessToken?: string | null, fetchImpl?: typeof fetch }} [options]
 */
export async function fetchPaymentMasterEnabled(options = {}) {
  const supabaseUrl = (options.supabaseUrl || SUPABASE_URL).replace(/\/$/, '')
  const fetchFn = options.fetchImpl || fetch
  const url =
    `${supabaseUrl}/rest/v1/app_config` +
    `?key=eq.${encodeURIComponent(PAYMENT_MASTER_KEY)}&select=key,value`
  const headers = {
    ...restHeaders(options.accessToken || null),
    apikey: options.anonKey || SUPABASE_ANON_KEY
  }
  if (!options.accessToken) {
    headers.Authorization = `Bearer ${options.anonKey || SUPABASE_ANON_KEY}`
  }
  const res = await fetchFn(url, { headers })
  const body = await parseRest(res)
  const row = Array.isArray(body) ? body[0] : body
  return parsePaymentMasterEnabled(row)
}

/**
 * @param {{ supabaseUrl?: string, anonKey?: string, accessToken: string, userId: string, fetchImpl?: typeof fetch }} options
 */
export async function fetchOwnBillingSnapshot(options) {
  const supabaseUrl = (options.supabaseUrl || SUPABASE_URL).replace(/\/$/, '')
  const fetchFn = options.fetchImpl || fetch
  const headers = {
    ...restHeaders(options.accessToken),
    apikey: options.anonKey || SUPABASE_ANON_KEY
  }

  const billingUrl =
    `${supabaseUrl}/rest/v1/user_billing` +
    `?user_id=eq.${encodeURIComponent(options.userId)}` +
    `&select=is_paid,paid_at,deactivate_purged_at,pay_phase_started_at,unpaid_grace_expires_at,unpaid_purged_at`

  const metaUrl =
    `${supabaseUrl}/rest/v1/user_metadata` +
    `?user_id=eq.${encodeURIComponent(options.userId)}` +
    `&select=payment_choice,payment_choice_at`

  const [billingRes, metaRes] = await Promise.all([
    fetchFn(billingUrl, { headers }),
    fetchFn(metaUrl, { headers })
  ])

  const billingBody = await parseRest(billingRes)
  const metaBody = await parseRest(metaRes)
  const billing = Array.isArray(billingBody) ? billingBody[0] : billingBody
  const meta = Array.isArray(metaBody) ? metaBody[0] : metaBody

  return {
    isPaid: billing?.is_paid === true,
    paidAt: billing?.paid_at || null,
    deactivatePurgedAt: billing?.deactivate_purged_at || null,
    payPhaseStartedAt: billing?.pay_phase_started_at || null,
    unpaidGraceExpiresAt: billing?.unpaid_grace_expires_at || null,
    unpaidPurgedAt: billing?.unpaid_purged_at || null,
    paymentChoice: meta?.payment_choice ?? null,
    paymentChoiceAt: meta?.payment_choice_at || null
  }
}

/**
 * 调用 SECURITY DEFINER RPC：停用用户在 ON 阶段自 purge（幂等）。
 */
export async function invokeTryPurgeOwnDeactivated(options) {
  const supabaseUrl = (options.supabaseUrl || SUPABASE_URL).replace(/\/$/, '')
  const fetchFn = options.fetchImpl || fetch
  const res = await fetchFn(`${supabaseUrl}/rest/v1/rpc/try_purge_own_deactivated`, {
    method: 'POST',
    headers: {
      ...restHeaders(options.accessToken),
      apikey: options.anonKey || SUPABASE_ANON_KEY,
      Prefer: 'return=representation'
    },
    body: '{}'
  })
  return parseRest(res)
}

/**
 * 未付费用户在 ON 阶段确保宽限起算（幂等）。
 */
export async function invokeEnsureOwnUnpaidGrace(options) {
  const supabaseUrl = (options.supabaseUrl || SUPABASE_URL).replace(/\/$/, '')
  const fetchFn = options.fetchImpl || fetch
  const res = await fetchFn(`${supabaseUrl}/rest/v1/rpc/ensure_own_unpaid_grace`, {
    method: 'POST',
    headers: {
      ...restHeaders(options.accessToken),
      apikey: options.anonKey || SUPABASE_ANON_KEY,
      Prefer: 'return=representation'
    },
    body: '{}'
  })
  return parseRest(res)
}

export async function readPaymentGateSessionCache(storageSession) {
  if (!storageSession?.get) return null
  try {
    const data = await storageSession.get(PAYMENT_GATE_CACHE_SESSION_KEY)
    return data?.[PAYMENT_GATE_CACHE_SESSION_KEY] || null
  } catch {
    return null
  }
}

export async function writePaymentGateSessionCache(storageSession, snapshot) {
  if (!storageSession?.set) return
  try {
    await storageSession.set({
      [PAYMENT_GATE_CACHE_SESSION_KEY]: {
        ...snapshot,
        fetchedAt: Date.now()
      }
    })
  } catch {
    /* ignore */
  }
}

export function isPaymentGateCacheFresh(cache, now = Date.now(), ttlMs = PAYMENT_GATE_CACHE_TTL_MS) {
  if (!cache || typeof cache.fetchedAt !== 'number') return false
  return now - cache.fetchedAt < ttlMs
}

/**
 * 组装完整门闩快照（background / Vue / 工具窗共用）。
 */
export async function loadPaymentGateSnapshot(options = {}) {
  const storage = options.storage || (typeof chrome !== 'undefined' ? chrome.storage : null)
  const force = options.force === true
  const sessionStore = storage?.session

  if (!force && sessionStore) {
    const cached = await readPaymentGateSessionCache(sessionStore)
    if (isPaymentGateCacheFresh(cached)) {
      return { ...cached, fromCache: true }
    }
  }

  let accessToken = options.accessToken || null
  let userId = options.userId || null
  let isAuthed = options.isAuthed

  if (accessToken == null || userId == null) {
    try {
      const data = await storage?.local?.get?.(STORAGE_KEY_SESSION)
      const session = data?.[STORAGE_KEY_SESSION]
      if (session?.access_token && session?.user?.id) {
        accessToken = session.access_token
        userId = session.user.id
      }
    } catch {
      /* ignore */
    }
  }

  if (typeof isAuthed !== 'boolean') {
    isAuthed = !!(accessToken && userId)
  }

  let switchEnabled = false
  let billing = {
    isPaid: false,
    paidAt: null,
    deactivatePurgedAt: null,
    payPhaseStartedAt: null,
    unpaidGraceExpiresAt: null,
    unpaidPurgedAt: null,
    paymentChoice: null,
    paymentChoiceAt: null
  }
  let fetchFailed = false

  try {
    switchEnabled = await fetchPaymentMasterEnabled({
      accessToken,
      supabaseUrl: options.supabaseUrl,
      anonKey: options.anonKey,
      fetchImpl: options.fetchImpl
    })
  } catch {
    // 提醒阶段默认关；收费阶段 fail-closed 需要知道开关。
    // 读开关失败：若无缓存则视为 OFF（不挡），与「提醒阶段网络失败不挡」一致；
    // 但若调用方声明 expectPayPhase，则 fail-closed。
    if (options.expectPayPhase === true) {
      fetchFailed = true
      switchEnabled = true
    } else {
      switchEnabled = false
    }
  }

  if (isAuthed && accessToken && userId && !fetchFailed) {
    try {
      billing = await fetchOwnBillingSnapshot({
        accessToken,
        userId,
        supabaseUrl: options.supabaseUrl,
        anonKey: options.anonKey,
        fetchImpl: options.fetchImpl
      })
    } catch {
      if (switchEnabled) fetchFailed = true
    }
  }

  const access = resolvePaymentAccess({
    switchEnabled,
    isAuthed,
    isPaid: billing.isPaid === true,
    fetchFailed
  })

  const snapshot = {
    switchEnabled,
    isAuthed,
    isPaid: billing.isPaid === true,
    paymentChoice: billing.paymentChoice,
    deactivatePurgedAt: billing.deactivatePurgedAt,
    unpaidGraceExpiresAt: billing.unpaidGraceExpiresAt,
    unpaidPurgedAt: billing.unpaidPurgedAt,
    fetchFailed,
    access,
    fetchedAt: Date.now(),
    fromCache: false
  }

  if (sessionStore) await writePaymentGateSessionCache(sessionStore, snapshot)

  // 路径 A：停用 + ON → 尝试自 purge（服务端幂等）
  if (
    switchEnabled &&
    isAuthed &&
    accessToken &&
    billing.paymentChoice === 'deactivate' &&
    !billing.deactivatePurgedAt &&
    !fetchFailed &&
    options.skipSideEffects !== true
  ) {
    try {
      await invokeTryPurgeOwnDeactivated({
        accessToken,
        supabaseUrl: options.supabaseUrl,
        anonKey: options.anonKey,
        fetchImpl: options.fetchImpl
      })
      if (typeof options.onPurged === 'function') await options.onPurged('deactivate')
    } catch {
      /* 线上未 apply RPC 时忽略；门闩仍挡功能 */
    }
  }

  // 路径 B 宽限起算：未付费非停用
  if (
    switchEnabled &&
    isAuthed &&
    accessToken &&
    !billing.isPaid &&
    billing.paymentChoice !== 'deactivate' &&
    !billing.unpaidGraceExpiresAt &&
    !fetchFailed &&
    options.skipSideEffects !== true
  ) {
    try {
      await invokeEnsureOwnUnpaidGrace({
        accessToken,
        supabaseUrl: options.supabaseUrl,
        anonKey: options.anonKey,
        fetchImpl: options.fetchImpl
      })
    } catch {
      /* ignore until live apply */
    }
  }

  return snapshot
}

/** 打开 Checkout（由 sibling「付费状态」PR 提供 Edge Function；此处只调）。 */
export async function createCheckoutSession(options) {
  const supabaseUrl = (options.supabaseUrl || SUPABASE_URL).replace(/\/$/, '')
  const fetchFn = options.fetchImpl || fetch
  const res = await fetchFn(`${supabaseUrl}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      apikey: options.anonKey || SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  })
  const body = await parseRest(res)
  if (!body?.url) throw toError({ message: 'checkout url missing', status: 502 })
  return body
}
