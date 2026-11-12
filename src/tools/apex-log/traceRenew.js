/**
 * 调试跟踪续期。
 * 日志窗口开着并正在看某个组织时，在到期前续上。
 * 关掉窗口后不再续。手动续一次仍然走原来的续期入口。
 * 租约只写这台浏览器的 session，不跟着账号走到别的电脑，
 * 因此不会把 Salesforce 登录状态同步过去。
 */

export const TRACE_DURATION_MS = 60 * 60 * 1000
export const TRACE_DURATION_MINUTES = 60
/** 到期前提前续，留出闹钟延迟和接口耗时 */
export const RENEW_LEAD_MS = 5 * 60 * 1000
export const RENEW_RETRY_MS = 60 * 1000
export const TRACE_ALARM_NAME = 'sfql-apex-trace-renew'
export const TRACE_LEASE_KEY = 'sfql_apex_trace_lease'

export function isApexLogWindowUrl(url) {
  try {
    const parsed = new URL(String(url || ''), 'https://extension.local')
    const path = parsed.pathname || ''
    const file = path.slice(path.lastIndexOf('/') + 1)
    return file === 'tool-window.html' && parsed.searchParams.get('tool') === 'apex-log'
  } catch {
    return false
  }
}

export function apexLogWindowIsOpen(tabs) {
  return (tabs || []).some(
    (tab) => isApexLogWindowUrl(tab?.url) || isApexLogWindowUrl(tab?.pendingUrl)
  )
}

function asMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value == null || value === '') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** @param {Array<string|number|null|undefined>} values */
export function earliestExpiration(values) {
  let min = null
  for (const value of values || []) {
    const ms = asMillis(value)
    if (ms == null) continue
    if (min == null || ms < min) min = ms
  }
  return min
}

/**
 * @returns {{ due: boolean, delayMs: number, renewAt: number }}
 */
export function planTraceRenewal({ expiresAt, now, leadMs = RENEW_LEAD_MS } = {}) {
  const nowMs = asMillis(now)
  if (nowMs == null) throw new Error('now required')
  const expires = asMillis(expiresAt)
  if (expires == null) return { due: true, delayMs: 0, renewAt: nowMs }
  const renewAt = expires - leadMs
  const delayMs = renewAt - nowMs
  if (delayMs <= 0) return { due: true, delayMs: 0, renewAt }
  return { due: false, delayMs, renewAt }
}

export function toIsoTime(value) {
  const ms = asMillis(value)
  if (ms == null) return null
  return new Date(ms).toISOString()
}

/** 只保留续期调度需要的字段，丢掉 session、cookie、主机名等登录材料 */
export function sanitizeTraceLease(lease) {
  if (!lease || typeof lease !== 'object') return null
  const viewers = {}
  if (lease.viewers && typeof lease.viewers === 'object') {
    for (const [id, seen] of Object.entries(lease.viewers)) {
      const ms = asMillis(seen)
      if (!id || ms == null) continue
      viewers[id] = ms
    }
  }
  const expiresAt = asMillis(lease.expiresAt)
  const renewAt = asMillis(lease.renewAt)
  return {
    envId: lease.envId ? String(lease.envId) : '',
    expiresAt,
    renewAt,
    phase: lease.phase === 'error' ? 'error' : 'scheduled',
    error: lease.error ? String(lease.error) : '',
    viewers
  }
}

export async function writeTraceLease(storage, lease) {
  if (!storage?.session?.set || !storage?.session?.remove) {
    throw new Error('session storage required')
  }
  if (lease == null) {
    await storage.session.remove(TRACE_LEASE_KEY)
    return
  }
  await storage.session.set({ [TRACE_LEASE_KEY]: sanitizeTraceLease(lease) })
}

function statusOf(fields) {
  return {
    success: fields.success !== false,
    phase: fields.phase,
    envId: fields.envId || '',
    expiresAt: fields.expiresAt == null ? null : toIsoTime(fields.expiresAt),
    renewAt: fields.renewAt == null ? null : toIsoTime(fields.renewAt),
    error: fields.error || ''
  }
}

async function rememberLease(saveLease, lease) {
  const safe = sanitizeTraceLease(lease)
  await saveLease(safe)
  return safe
}

/**
 * 窗口开始看某个组织，或手动续期之后重排下一次。
 * 已经进到提前期、或还没有跟踪时，立刻续一次。
 */
export async function applyTraceWatch({
  envId,
  viewerId,
  now,
  loadLease,
  saveLease,
  readExpiration,
  renew,
  scheduleAlarm,
  clearAlarm,
  leadMs = RENEW_LEAD_MS,
  retryMs = RENEW_RETRY_MS
}) {
  if (!envId || !viewerId) {
    await clearAlarm()
    await saveLease(null)
    return statusOf({ success: true, phase: 'stopped' })
  }

  const previous = await loadLease()
  const viewers =
    previous?.envId === envId && previous.viewers ? { ...previous.viewers } : {}
  viewers[viewerId] = now

  let expiresAt = null
  try {
    expiresAt = await readExpiration(envId)
  } catch (error) {
    const renewAt = now + retryMs
    await rememberLease(saveLease, {
      envId,
      expiresAt: null,
      renewAt,
      phase: 'error',
      error: error?.message || String(error),
      viewers
    })
    await scheduleAlarm(renewAt)
    return statusOf({
      success: false,
      phase: 'error',
      envId,
      renewAt,
      error: error?.message || String(error)
    })
  }

  let phase = 'scheduled'
  let plan = planTraceRenewal({ expiresAt, now, leadMs })
  if (plan.due) {
    try {
      const result = await renew(envId)
      expiresAt = asMillis(result?.expiresAt) ?? now + TRACE_DURATION_MS
      phase = 'renewed'
      plan = planTraceRenewal({ expiresAt, now, leadMs })
    } catch (error) {
      const renewAt = now + retryMs
      await rememberLease(saveLease, {
        envId,
        expiresAt,
        renewAt,
        phase: 'error',
        error: error?.message || String(error),
        viewers
      })
      await scheduleAlarm(renewAt)
      return statusOf({
        success: false,
        phase: 'error',
        envId,
        expiresAt,
        renewAt,
        error: error?.message || String(error)
      })
    }
  }

  const renewAt = plan.due ? now + retryMs : plan.renewAt
  await rememberLease(saveLease, {
    envId,
    expiresAt,
    renewAt,
    phase: 'scheduled',
    error: '',
    viewers
  })
  await scheduleAlarm(renewAt)
  return statusOf({ success: true, phase, envId, expiresAt, renewAt })
}

/**
 * 闹钟到点。窗口已经关掉（标签不在）就不再续，并清掉租约。
 * 不刷新查看者的心跳时间：关窗后不能靠闹钟把自己续活。
 */
export async function applyTraceAlarm({
  now,
  windowOpen,
  loadLease,
  saveLease,
  readExpiration,
  renew,
  scheduleAlarm,
  clearAlarm,
  leadMs = RENEW_LEAD_MS,
  retryMs = RENEW_RETRY_MS
}) {
  const lease = await loadLease()
  if (!lease?.envId || !windowOpen) {
    await clearAlarm()
    await saveLease(null)
    return { action: 'stop', ...statusOf({ success: true, phase: 'stopped' }) }
  }

  const viewers = { ...(lease.viewers || {}) }
  let expiresAt = asMillis(lease.expiresAt)
  try {
    const live = await readExpiration(lease.envId)
    if (live != null) expiresAt = asMillis(live)
  } catch (error) {
    const renewAt = now + retryMs
    await rememberLease(saveLease, {
      ...lease,
      viewers,
      renewAt,
      phase: 'error',
      error: error?.message || String(error)
    })
    await scheduleAlarm(renewAt)
    return {
      action: 'retry',
      ...statusOf({
        success: false,
        phase: 'error',
        envId: lease.envId,
        expiresAt,
        renewAt,
        error: error?.message || String(error)
      })
    }
  }

  const plan = planTraceRenewal({ expiresAt, now, leadMs })
  if (!plan.due) {
    await rememberLease(saveLease, {
      ...lease,
      viewers,
      expiresAt,
      renewAt: plan.renewAt,
      phase: 'scheduled',
      error: ''
    })
    await scheduleAlarm(plan.renewAt)
    return {
      action: 'wait',
      ...statusOf({
        success: true,
        phase: 'scheduled',
        envId: lease.envId,
        expiresAt,
        renewAt: plan.renewAt
      })
    }
  }

  try {
    const result = await renew(lease.envId)
    const nextExpires = asMillis(result?.expiresAt) ?? now + TRACE_DURATION_MS
    const nextPlan = planTraceRenewal({ expiresAt: nextExpires, now, leadMs })
    const renewAt = nextPlan.due ? now + retryMs : nextPlan.renewAt
    await rememberLease(saveLease, {
      ...lease,
      viewers,
      expiresAt: nextExpires,
      renewAt,
      phase: 'scheduled',
      error: ''
    })
    await scheduleAlarm(renewAt)
    return {
      action: 'renewed',
      ...statusOf({
        success: true,
        phase: 'renewed',
        envId: lease.envId,
        expiresAt: nextExpires,
        renewAt
      })
    }
  } catch (error) {
    const renewAt = now + retryMs
    await rememberLease(saveLease, {
      ...lease,
      viewers,
      expiresAt,
      renewAt,
      phase: 'error',
      error: error?.message || String(error)
    })
    await scheduleAlarm(renewAt)
    return {
      action: 'retry',
      ...statusOf({
        success: false,
        phase: 'error',
        envId: lease.envId,
        expiresAt,
        renewAt,
        error: error?.message || String(error)
      })
    }
  }
}

/** 关掉其中一个日志窗口。最后一个关掉后取消闹钟。 */
export async function applyTraceUnwatch({
  viewerId,
  loadLease,
  saveLease,
  clearAlarm
}) {
  if (!viewerId) {
    return statusOf({ success: true, phase: 'kept' })
  }
  const lease = await loadLease()
  if (!lease?.envId) {
    await clearAlarm()
    await saveLease(null)
    return statusOf({ success: true, phase: 'stopped' })
  }
  const viewers = { ...(lease.viewers || {}) }
  delete viewers[viewerId]
  if (Object.keys(viewers).length === 0) {
    await clearAlarm()
    await saveLease(null)
    return statusOf({ success: true, phase: 'stopped' })
  }
  await rememberLease(saveLease, { ...lease, viewers })
  return statusOf({
    success: true,
    phase: 'kept',
    envId: lease.envId,
    expiresAt: lease.expiresAt,
    renewAt: lease.renewAt
  })
}

/** Service Worker 被唤醒后，窗口还开着才把闹钟排回去。 */
export async function rearmTraceRenewFromLease({
  now,
  windowOpen,
  loadLease,
  saveLease,
  clearAlarm,
  scheduleAlarm,
  alarmPending,
  runDue
}) {
  const lease = await loadLease()
  if (!lease?.envId || !windowOpen) {
    await clearAlarm()
    if (lease) await saveLease(null)
    return { action: 'stop' }
  }
  const renewAt = asMillis(lease.renewAt)
  if (renewAt == null || renewAt <= now) return runDue()
  if (await alarmPending()) return { action: 'keep' }
  await scheduleAlarm(renewAt)
  return { action: 'rescheduled', renewAt }
}
