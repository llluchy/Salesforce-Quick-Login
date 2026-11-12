// 误删环境的回收规则。
// 已登录时，回收中的环境只存在于 Supabase。这里不读写 chrome.storage.local / sync。

export const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

export function trashCutoffIso(now = Date.now()) {
  return new Date(now - TRASH_RETENTION_MS).toISOString()
}

/**
 * 七天内（含刚好满七天）可恢复。超过七天、没有删除时间、或并未删除，都不可恢复。
 */
export function isRecoverableTrash(row, now = Date.now()) {
  if (!row || row.is_deleted !== true || !row.deleted_at) return false
  const deleted = Date.parse(row.deleted_at)
  if (Number.isNaN(deleted)) return false
  return now - deleted <= TRASH_RETENTION_MS
}

export function daysRemaining(deletedAt, now = Date.now()) {
  const deleted = Date.parse(deletedAt)
  if (Number.isNaN(deleted)) return 0
  const remain = deleted + TRASH_RETENTION_MS - now
  if (remain <= 0) return 1
  return Math.ceil(remain / DAY_MS)
}

/** 软删除只改标记，不碰别名、账号、密码、验证器、分组。 */
export function softDeletePatch(now = Date.now()) {
  return {
    is_deleted: true,
    deleted_at: new Date(now).toISOString()
  }
}

/** 放回只清标记。其余列留在原行，分组不变。 */
export function restorePatch() {
  return {
    is_deleted: false,
    deleted_at: null
  }
}

/**
 * 改密码重加密时把回收标记原样带回，避免 upsert 把回收中的环境写成未删除或丢掉删除时间。
 */
export function carryTrashFlags(originalRows, nextRows) {
  if (!Array.isArray(originalRows) || !Array.isArray(nextRows)) {
    throw new Error('rows required')
  }
  if (originalRows.length !== nextRows.length) {
    throw new Error('row count mismatch')
  }
  return nextRows.map((row, index) => {
    const source = originalRows[index] || {}
    const deleted = source.is_deleted === true
    return {
      ...row,
      is_deleted: deleted,
      deleted_at: deleted ? (source.deleted_at ?? null) : null
    }
  })
}

export class TrashGoneError extends Error {
  constructor() {
    super('NOT_FOUND')
    this.code = 'NOT_FOUND'
  }
}

async function finish(query) {
  const result = await query
  if (result?.error) {
    throw new Error(result.error.message || 'query failed')
  }
  return result
}

/**
 * 物理删除已超过七天的回收行，以及没有删除时间的回收行。
 * 只操作 environments，不碰 env_shares，也不影响接收者已经收下的独立副本。
 */
export async function purgeExpiredTrash(supabase, { now = Date.now() } = {}) {
  const cutoff = trashCutoffIso(now)
  await finish(
    supabase
      .from('environments')
      .delete()
      .eq('is_deleted', true)
      .lt('deleted_at', cutoff)
  )
  await finish(
    supabase
      .from('environments')
      .delete()
      .eq('is_deleted', true)
      .is('deleted_at', null)
  )
  return { cutoff }
}

export async function listRecoverableTrash(supabase, { now = Date.now(), decrypt }) {
  const cutoff = trashCutoffIso(now)
  const { data } = await finish(
    supabase
      .from('environments')
      .select('*')
      .eq('is_deleted', true)
      .gte('deleted_at', cutoff)
      .order('deleted_at', { ascending: false })
  )
  const items = []
  for (const row of data || []) {
    if (!isRecoverableTrash(row, now)) continue
    const env = await decrypt(row)
    if (!env) continue
    env.deletedAt = row.deleted_at
    items.push(env)
  }
  return items
}

export async function restoreTrashedEnvironment(supabase, { id, decrypt }) {
  const { data } = await finish(
    supabase
      .from('environments')
      .update(restorePatch())
      .eq('id', id)
      .eq('is_deleted', true)
      .select('*')
  )
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new TrashGoneError()
  const env = await decrypt(row)
  if (!env) throw new Error('decrypt failed')
  env.deletedAt = null
  return env
}
