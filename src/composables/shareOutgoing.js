// 已发出、对方还没收下的分享。
// 作废只改 env_shares.status，不删除记录，也不碰 environments。
// 接受查询只认 status = active，所以作废后原来的码不能再被收下。

export const REVOKED_SHARE_STATUS = 'revoked'

/** 列出未收下分享时读取的列。不含验证码。 */
export const UNCLAIMED_SHARE_COLUMNS =
  'id, env_ids, share_code, status, expires_at, consumed_by, created_at, encrypted_envs'

function translate(deps, key, params) {
  if (typeof deps?.t === 'function') return deps.t(key, params)
  return key
}

function requireClient(deps) {
  if (!deps?.supabase) throw new Error(translate(deps, 'share.supabaseNotInit'))
  if (!deps.userId) throw new Error(translate(deps, 'share.keyNotDerived'))
  return deps
}

/**
 * 对方还没收下：仍是 active，且没有收下人。
 * 已过期但还没被作废的也算，界面显示剩余时间为 0。
 */
export function isUnclaimedShare(row) {
  return !!row && row.status === 'active' && row.consumed_by == null
}

/** 只保留分享时的环境名称，丢掉密文。 */
export function publicShareRow(row) {
  const items = Array.isArray(row?.encrypted_envs) ? row.encrypted_envs : []
  return {
    id: row.id,
    env_ids: row.env_ids || [],
    share_code: row.share_code,
    status: row.status,
    expires_at: row.expires_at,
    consumed_by: row.consumed_by,
    created_at: row.created_at,
    encrypted_envs: items.map((item) => ({ alias: item?.alias ? String(item.alias) : '' }))
  }
}

export function shareAliases(row) {
  const items = Array.isArray(row?.encrypted_envs) ? row.encrypted_envs : []
  return items
    .map((item) => (item && item.alias != null ? String(item.alias).trim() : ''))
    .filter(Boolean)
}

export function shareRemainingMs(expiresAt, now = Date.now()) {
  const expires = new Date(expiresAt).getTime()
  if (Number.isNaN(expires)) return 0
  return Math.max(0, expires - now)
}

/** 剩余时间对应的文案 key。分钟向下取整；不足 1 分钟单独提示。 */
export function describeShareRemaining(remainingMs) {
  const ms = Number(remainingMs) || 0
  if (ms <= 0) return { key: 'share.remainingExpired', params: {} }
  if (ms < 60 * 1000) return { key: 'share.remainingUnderMinute', params: {} }
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) {
    return { key: 'share.remainingHoursMinutes', params: { hours, minutes } }
  }
  if (hours > 0) return { key: 'share.remainingHours', params: { hours } }
  return { key: 'share.remainingMinutes', params: { minutes } }
}

/** 自己发出、对方还没收下的分享，按最快过期排在前面。 */
export function pendingOutgoingShares(rows, now = Date.now()) {
  return (rows || [])
    .filter(isUnclaimedShare)
    .map((row) => {
      const remainingMs = shareRemainingMs(row.expires_at, now)
      return {
        id: row.id,
        shareCode: row.share_code,
        aliases: shareAliases(row),
        expiresAt: row.expires_at,
        remainingMs,
        expired: remainingMs <= 0
      }
    })
    .sort((a, b) => {
      const at = new Date(a.expiresAt).getTime()
      const bt = new Date(b.expiresAt).getTime()
      if (at !== bt) return at - bt
      return String(a.id).localeCompare(String(b.id))
    })
}

/**
 * 作废一份还没被收下的分享。
 * 只把这条记录标成 revoked。已经收下的环境不在这里，也不会被改到。
 * @param {string} shareId - env_shares.id
 */
export async function revokeOutgoingShare(shareId, deps = {}) {
  const { supabase, userId } = requireClient(deps)
  if (!shareId) throw new Error(translate(deps, 'share.revokeFailed', { msg: 'id' }))

  const { data, error } = await supabase
    .from('env_shares')
    .update({ status: REVOKED_SHARE_STATUS })
    .eq('id', shareId)
    .eq('owner_user_id', userId)
    .eq('status', 'active')
    .select('id')

  if (error) throw new Error(translate(deps, 'share.revokeFailed', { msg: error.message }))
  if (!data || data.length === 0) throw new Error(translate(deps, 'share.revokeAlreadyGone'))
  return { success: true }
}

/**
 * 当前用户发出、对方还没收下的分享（含已过期但仍是 active 的）。
 * 返回前去掉环境密文，只留名称。
 */
export async function listUnclaimedShares(deps = {}) {
  const { supabase, userId } = requireClient(deps)
  const { data, error } = await supabase
    .from('env_shares')
    .select(UNCLAIMED_SHARE_COLUMNS)
    .eq('owner_user_id', userId)
    .eq('status', 'active')
    .is('consumed_by', null)
    .order('expires_at', { ascending: true })

  if (error) throw new Error(translate(deps, 'share.querySharesFailed', { msg: error.message }))
  return (data || []).map(publicShareRow)
}
