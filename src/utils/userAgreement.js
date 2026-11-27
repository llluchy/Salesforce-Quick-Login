// 付费模式开启后：一次性用户协议同意。已登录以 public.user_metadata 为真相源。
// 同意后写入 user_agreement_accepted_at；不可应用内反复弹 / 改回。

export function toError(error) {
  if (error instanceof Error) return error
  const err = new Error(error?.message || 'user_metadata request failed')
  if (error?.code) err.code = error.code
  if (error?.status) err.status = error.status
  return err
}

export function normalizeAgreementAcceptedAt(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  return value
}

/**
 * 启动时是否再弹协议窗。
 * 2026-11-27 起：协议在注册页勾选完成，打开插件不再弹协议，只查付费状态。
 * 保留函数供旧调用方；恒为 false。
 */
export function shouldShowUserAgreement(_args) {
  return false
}

/** 从 auth.user_metadata 取出注册时写入的同意时间 */
export function agreementAtFromAuthUser(user) {
  const raw = user?.user_metadata?.user_agreement_accepted_at
  return normalizeAgreementAcceptedAt(raw)
}

export function supabaseUserAgreementIo(client) {
  return {
    async selectOwn(userId) {
      const { data, error } = await client
        .from('user_metadata')
        .select('user_agreement_accepted_at')
        .eq('user_id', userId)
        .maybeSingle()
      return { data, error }
    },
    async insertOwn(userId, acceptedAt) {
      const row = {
        user_id: userId,
        user_agreement_accepted_at: acceptedAt
      }
      const { data, error } = await client
        .from('user_metadata')
        .insert(row)
        .select('user_agreement_accepted_at')
        .single()
      return { data, error }
    },
    async updateOwnIfNull(userId, acceptedAt) {
      const { data, error } = await client
        .from('user_metadata')
        .update({ user_agreement_accepted_at: acceptedAt })
        .eq('user_id', userId)
        .is('user_agreement_accepted_at', null)
        .select('user_agreement_accepted_at')
      const row = Array.isArray(data) ? data[0] : data
      return { data: row ?? null, error }
    }
  }
}

export async function readUserAgreementAcceptedAt(io, userId) {
  const selected = await io.selectOwn(userId)
  if (selected.error) throw toError(selected.error)
  if (!selected.data) return null
  return normalizeAgreementAcceptedAt(selected.data.user_agreement_accepted_at)
}

/**
 * 注册/登录后：若 auth 元数据带有同意时间且业务表尚未写入，则幂等写入。
 * @returns {Promise<string|null>} 写入或已有的时间；无需写入时 null
 */
export async function ensureUserAgreementFromAuthMeta(io, user) {
  const userId = user?.id
  const fromMeta = agreementAtFromAuthUser(user)
  if (!userId || !fromMeta) return null
  return writeUserAgreementOnce(io, userId, fromMeta)
}

/** 一次性写入同意时间。已有值则原样返回。 */
export async function writeUserAgreementOnce(io, userId, nowIso) {
  const at = typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString()

  const selected = await io.selectOwn(userId)
  if (selected.error) throw toError(selected.error)

  if (selected.data) {
    const existing = normalizeAgreementAcceptedAt(selected.data.user_agreement_accepted_at)
    if (existing) return existing

    const updated = await io.updateOwnIfNull(userId, at)
    if (updated.error) throw toError(updated.error)
    if (updated.data) {
      const saved = normalizeAgreementAcceptedAt(updated.data.user_agreement_accepted_at)
      if (saved) return saved
    }

    const again = await io.selectOwn(userId)
    if (again.error) throw toError(again.error)
    const raced = normalizeAgreementAcceptedAt(again.data?.user_agreement_accepted_at)
    if (raced) return raced
    throw toError({ message: 'user_agreement_accepted_at update failed' })
  }

  const inserted = await io.insertOwn(userId, at)
  if (inserted.error?.code === '23505') {
    const again = await io.selectOwn(userId)
    if (again.error) throw toError(again.error)
    const existing = normalizeAgreementAcceptedAt(again.data?.user_agreement_accepted_at)
    if (existing) return existing
    const updated = await io.updateOwnIfNull(userId, at)
    if (updated.error) throw toError(updated.error)
    const saved = normalizeAgreementAcceptedAt(updated.data?.user_agreement_accepted_at)
    if (saved) return saved
    throw toError({ message: 'user_agreement_accepted_at update failed' })
  }
  if (inserted.error) throw toError(inserted.error)
  const saved = normalizeAgreementAcceptedAt(inserted.data?.user_agreement_accepted_at)
  if (!saved) throw toError({ message: 'user_agreement_accepted_at missing' })
  return saved
}
