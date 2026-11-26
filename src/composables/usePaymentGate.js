/**
 * Side Panel / 工具窗：读总开关 + paid + choice，短 TTL 缓存。
 * 与 sibling「管理员总开关 / 提醒选择 / 付费状态」PR 共享约定；冲突见 PR 说明。
 */

import { computed, readonly, ref } from 'vue'
import { getSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { STORAGE_KEY, STORAGE_KEY_GROUPS } from '../utils/constants.js'
import {
  createCheckoutSession,
  loadPaymentGateSnapshot
} from '../utils/paymentGateApi.js'
import { resolvePaymentAccess } from '../utils/paymentAccess.js'

/** Purge 后清本机环境列表缓存；保留扩展登录 session，以便仍能看到付费页。 */
async function clearLocalEnvCacheOnly() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.remove) {
      await chrome.storage.local.remove([STORAGE_KEY, STORAGE_KEY_GROUPS])
    }
  } catch {
    /* ignore */
  }
}

const switchEnabled = ref(false)
const isPaid = ref(false)
const paymentChoice = ref(null)
const unpaidGraceExpiresAt = ref(null)
const unpaidPurgedAt = ref(null)
const deactivatePurgedAt = ref(null)
const fetchFailed = ref(false)
const loading = ref(false)
const lastFetchedAt = ref(0)
let _inflight = null

function applySnapshot(snapshot) {
  switchEnabled.value = snapshot.switchEnabled === true
  isPaid.value = snapshot.isPaid === true
  paymentChoice.value = snapshot.paymentChoice ?? null
  unpaidGraceExpiresAt.value = snapshot.unpaidGraceExpiresAt || null
  unpaidPurgedAt.value = snapshot.unpaidPurgedAt || null
  deactivatePurgedAt.value = snapshot.deactivatePurgedAt || null
  fetchFailed.value = snapshot.fetchFailed === true
  lastFetchedAt.value = snapshot.fetchedAt || Date.now()
}

export function usePaymentGate() {
  const { isAuthed, currentUser, getSession } = useAuth()

  const access = computed(() =>
    resolvePaymentAccess({
      switchEnabled: switchEnabled.value,
      isAuthed: isAuthed.value === true,
      isPaid: isPaid.value === true,
      fetchFailed: fetchFailed.value
    })
  )

  const toolsBlocked = computed(() => access.value.allow !== true)
  const showPaymentRequired = computed(
    () =>
      switchEnabled.value === true &&
      isAuthed.value === true &&
      access.value.requirePayment === true
  )
  const forceLoginForTools = computed(
    () => switchEnabled.value === true && isAuthed.value !== true
  )

  async function refreshPaymentGate(options = {}) {
    if (_inflight && !options.force) return _inflight
    loading.value = true
    const run = (async () => {
      try {
        const session = options.session || null
        let accessToken = session?.access_token || null
        let userId = session?.user?.id || currentUser.value?.id || null

        if (!accessToken && isAuthed.value) {
          try {
            const supabase = getSupabase()
            const { data } = await supabase.auth.getSession()
            accessToken = data?.session?.access_token || null
            userId = data?.session?.user?.id || userId
          } catch {
            /* ignore */
          }
        }

        const snapshot = await loadPaymentGateSnapshot({
          force: options.force === true,
          accessToken,
          userId,
          isAuthed: isAuthed.value === true,
          onPurged: async () => {
            await clearLocalEnvCacheOnly()
          }
        })
        applySnapshot(snapshot)
        return snapshot
      } finally {
        loading.value = false
        _inflight = null
      }
    })()
    _inflight = run
    return run
  }

  async function openCheckout() {
    const supabase = getSupabase()
    const { data } = await supabase.auth.getSession()
    const accessToken = data?.session?.access_token
    if (!accessToken) throw new Error('not authenticated')
    const result = await createCheckoutSession({ accessToken })
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      await chrome.tabs.create({ url: result.url })
    } else if (typeof window !== 'undefined') {
      window.open(result.url, '_blank', 'noopener,noreferrer')
    }
    return result
  }

  async function refreshPaidStatus() {
    await refreshPaymentGate({ force: true })
    return isPaid.value === true
  }

  // 导出给测试 / sibling 合并时复用
  return {
    switchEnabled: readonly(switchEnabled),
    isPaid: readonly(isPaid),
    paymentChoice: readonly(paymentChoice),
    unpaidGraceExpiresAt: readonly(unpaidGraceExpiresAt),
    unpaidPurgedAt: readonly(unpaidPurgedAt),
    deactivatePurgedAt: readonly(deactivatePurgedAt),
    fetchFailed: readonly(fetchFailed),
    loading: readonly(loading),
    lastFetchedAt: readonly(lastFetchedAt),
    access,
    toolsBlocked,
    showPaymentRequired,
    forceLoginForTools,
    refreshPaymentGate,
    openCheckout,
    refreshPaidStatus,
    getSession
  }
}
