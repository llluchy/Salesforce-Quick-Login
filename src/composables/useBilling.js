// 付费状态：读 user_billing；发起 Checkout；刷新。不写 is_paid。

import { ref, readonly, watch } from 'vue'
import { getSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import {
  createCheckoutSession,
  fetchOwnBilling,
  openCheckoutUrl,
  supabaseUserBillingIo
} from '../utils/userBilling'

const isPaid = ref(false)
const paidAt = ref(null)
const billingLoading = ref(false)
const billingError = ref(null)
const checkoutLoading = ref(false)
let _watched = false

async function refreshBilling() {
  const { currentUser, isAuthed } = useAuth()
  billingError.value = null

  if (!isAuthed.value || !currentUser.value?.id) {
    isPaid.value = false
    paidAt.value = null
    return { isPaid: false, paidAt: null }
  }

  const client = getSupabase()
  if (!client) {
    billingError.value = 'supabase_unavailable'
    return { isPaid: false, paidAt: null }
  }

  billingLoading.value = true
  try {
    const row = await fetchOwnBilling(supabaseUserBillingIo(client), currentUser.value.id)
    isPaid.value = row.isPaid
    paidAt.value = row.paidAt
    return row
  } catch (e) {
    billingError.value = e?.message || 'billing_fetch_failed'
    throw e
  } finally {
    billingLoading.value = false
  }
}

async function startCheckout() {
  const client = getSupabase()
  if (!client) throw new Error('supabase_unavailable')
  const { currentUser } = useAuth()
  const userId = currentUser.value?.id
  if (!userId) throw new Error('unauthorized')

  checkoutLoading.value = true
  billingError.value = null
  try {
    // 开单前再拉一次，已付费则不调 Checkout
    const latest = await fetchOwnBilling(supabaseUserBillingIo(client), userId)
    isPaid.value = latest.isPaid
    paidAt.value = latest.paidAt
    if (latest.isPaid) {
      billingError.value = 'already_paid'
      const err = new Error('already_paid')
      err.code = 'already_paid'
      throw err
    }

    const url = await createCheckoutSession((name, options) =>
      client.functions.invoke(name, options)
    )
    await openCheckoutUrl(url)
    return url
  } catch (e) {
    if (e?.code === 'already_paid' || e?.message === 'already_paid') {
      billingError.value = 'already_paid'
      isPaid.value = true
      try { await refreshBilling() } catch { /* ignore */ }
    } else {
      billingError.value = e?.message || 'checkout_failed'
    }
    throw e
  } finally {
    checkoutLoading.value = false
  }
}

function ensureWatch() {
  if (_watched) return
  _watched = true
  const { isAuthed, currentUser } = useAuth()
  watch(
    [isAuthed, () => currentUser.value?.id],
    ([authed, id]) => {
      if (authed && id) {
        refreshBilling().catch(() => {})
      } else {
        isPaid.value = false
        paidAt.value = null
        billingError.value = null
      }
    },
    { immediate: true }
  )
}

export function useBilling() {
  ensureWatch()
  return {
    isPaid: readonly(isPaid),
    paidAt: readonly(paidAt),
    billingLoading: readonly(billingLoading),
    billingError: readonly(billingError),
    checkoutLoading: readonly(checkoutLoading),
    refreshBilling,
    startCheckout
  }
}
