// 账号付费状态。真相源：public.user_billing。客户端不可写 is_paid。

export function toError(error) {
  if (error instanceof Error) return error
  const err = new Error(error?.message || 'user_billing request failed')
  if (error?.code) err.code = error.code
  if (error?.status) err.status = error.status
  return err
}

export function normalizeBillingRow(row) {
  if (!row || typeof row !== 'object') {
    return {
      isPaid: false,
      paidAt: null,
      stripeCheckoutSessionId: null
    }
  }
  return {
    isPaid: row.is_paid === true,
    paidAt: row.paid_at ?? null,
    stripeCheckoutSessionId: row.stripe_checkout_session_id ?? null
  }
}

export function supabaseUserBillingIo(client) {
  return {
    async selectOwn(userId) {
      const { data, error } = await client
        .from('user_billing')
        .select('is_paid, paid_at, stripe_checkout_session_id')
        .eq('user_id', userId)
        .maybeSingle()
      return { data, error }
    }
  }
}

/**
 * 拉取本人付费状态。无行视为未付费（触发器未跑时不由客户端 INSERT）。
 */
export async function fetchOwnBilling(io, userId) {
  if (!userId) throw toError({ message: 'user id required' })
  const { data, error } = await io.selectOwn(userId)
  if (error) throw toError(error)
  return normalizeBillingRow(data)
}

/**
 * 调 Edge create-checkout，返回 Checkout URL。
 * invokeFn(name, options) → { data, error }，与 supabase.functions.invoke 对齐。
 */
export async function createCheckoutSession(invokeFn) {
  if (typeof invokeFn !== 'function') {
    throw toError({ message: 'checkout invoke missing' })
  }
  const { data, error } = await invokeFn('create-checkout', { method: 'POST', body: {} })
  if (error) throw toError(error)
  const url = data?.url
  if (!url || typeof url !== 'string') {
    throw toError({ message: data?.error || 'checkout url missing' })
  }
  return url
}

export function openCheckoutUrl(url, openTab = defaultOpenTab) {
  if (!url) throw toError({ message: 'checkout url missing' })
  return openTab(url)
}

function defaultOpenTab(url) {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    return chrome.tabs.create({ url })
  }
  if (typeof window !== 'undefined' && window.open) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return Promise.resolve()
  }
  throw toError({ message: 'cannot open checkout tab' })
}
