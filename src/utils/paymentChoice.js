// 提醒阶段一次性「继续 / 停用」。已登录以 public.user_metadata 为真相源。
// 选定后不可在应用内改选；不做改选 UI。不写入 chrome.storage.local / sync。

export const PAYMENT_CHOICE_CONTINUE = 'continue'
export const PAYMENT_CHOICE_DEACTIVATE = 'deactivate'

export const CONTACT_EMAILS = Object.freeze([
  'llluchy@outlook.com',
  'llluchy@qq.com'
])

const CHOICES = new Set([PAYMENT_CHOICE_CONTINUE, PAYMENT_CHOICE_DEACTIVATE])

export function toError(error) {
  if (error instanceof Error) return error
  const err = new Error(error?.message || 'user_metadata request failed')
  if (error?.code) err.code = error.code
  if (error?.status) err.status = error.status
  return err
}

export function normalizePaymentChoice(value) {
  return CHOICES.has(value) ? value : null
}

/**
 * 是否应强制弹出提醒。
 * - 未登录：否
 * - 开关 ON（收费阶段）：否（由收费门 PR 处理）
 * - 开关 OFF 且 choice 为 null：是
 * - 已选定：否
 */
export function shouldShowPaymentReminder({ isAuthed, switchEnabled, paymentChoice }) {
  if (!isAuthed) return false
  if (switchEnabled !== false) return false
  return normalizePaymentChoice(paymentChoice) == null
}

export function supabasePaymentChoiceIo(client) {
  return {
    async selectOwn(userId) {
      const { data, error } = await client
        .from('user_metadata')
        .select('payment_choice, payment_choice_at')
        .eq('user_id', userId)
        .maybeSingle()
      return { data, error }
    },
    async insertOwn(userId, choice, choiceAt) {
      const row = {
        user_id: userId,
        payment_choice: choice,
        payment_choice_at: choiceAt
      }
      const { data, error } = await client
        .from('user_metadata')
        .insert(row)
        .select('payment_choice, payment_choice_at')
        .single()
      return { data, error }
    },
    async updateOwnIfNull(userId, choice, choiceAt) {
      const { data, error } = await client
        .from('user_metadata')
        .update({
          payment_choice: choice,
          payment_choice_at: choiceAt
        })
        .eq('user_id', userId)
        .is('payment_choice', null)
        .select('payment_choice, payment_choice_at')
      const row = Array.isArray(data) ? data[0] : data
      return { data: row ?? null, error }
    }
  }
}

export async function readPaymentChoice(io, userId) {
  const selected = await io.selectOwn(userId)
  if (selected.error) throw toError(selected.error)
  if (!selected.data) return null
  return normalizePaymentChoice(selected.data.payment_choice)
}

/**
 * 一次性写入。已有非 null 选择时原样返回，绝不覆盖。
 */
export async function writePaymentChoiceOnce(io, userId, choice, nowIso) {
  const next = normalizePaymentChoice(choice)
  if (!next) throw toError({ message: 'payment_choice invalid' })
  const at = typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString()

  const selected = await io.selectOwn(userId)
  if (selected.error) throw toError(selected.error)

  if (selected.data) {
    const existing = normalizePaymentChoice(selected.data.payment_choice)
    if (existing) return existing

    const updated = await io.updateOwnIfNull(userId, next, at)
    if (updated.error) throw toError(updated.error)
    if (updated.data) {
      const saved = normalizePaymentChoice(updated.data.payment_choice)
      if (saved) return saved
    }

    const again = await io.selectOwn(userId)
    if (again.error) throw toError(again.error)
    const raced = normalizePaymentChoice(again.data?.payment_choice)
    if (raced) return raced
    throw toError({ message: 'payment_choice update failed' })
  }

  const inserted = await io.insertOwn(userId, next, at)
  if (inserted.error?.code === '23505') {
    const again = await io.selectOwn(userId)
    if (again.error) throw toError(again.error)
    const existing = normalizePaymentChoice(again.data?.payment_choice)
    if (existing) return existing
    const updated = await io.updateOwnIfNull(userId, next, at)
    if (updated.error) throw toError(updated.error)
    const saved = normalizePaymentChoice(updated.data?.payment_choice)
    if (saved) return saved
    throw toError({ message: 'payment_choice update failed' })
  }
  if (inserted.error) throw toError(inserted.error)
  const saved = normalizePaymentChoice(inserted.data?.payment_choice)
  if (!saved) throw toError({ message: 'payment_choice missing' })
  return saved
}
