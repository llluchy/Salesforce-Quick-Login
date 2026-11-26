// 付费模式（开关 ON）：登录后强制一次性用户协议。
// 同意写入 user_metadata.user_agreement_accepted_at；不同意由调用方登出。
// 开关 ON 且读失败 → 视为未同意（fail-closed，挡住使用）。

import { ref, readonly } from 'vue'
import { getSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import {
  readUserAgreementAcceptedAt,
  shouldShowUserAgreement,
  supabaseUserAgreementIo,
  writeUserAgreementOnce
} from '../utils/userAgreement'
import {
  getPaymentMasterEnabled,
  supabaseAppConfigIo
} from '../utils/paymentMaster'
import syncLog from '../utils/syncLogger'

const visible = ref(false)
const saving = ref(false)
const error = ref(null)
const acceptedAt = ref(null)

let _refreshing = false
/** reset / 登出时递增，使进行中的 refresh 结果作废 */
let _refreshEpoch = 0

function sessionArea() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      return chrome.storage.session
    }
  } catch {
    /* 非扩展环境 */
  }
  return null
}

export function useUserAgreement() {
  const { isAuthed, currentUser } = useAuth()

  function hide() {
    visible.value = false
    saving.value = false
    error.value = null
  }

  function reset() {
    _refreshEpoch += 1
    _refreshing = false
    hide()
    acceptedAt.value = null
  }

  function isStale(epoch) {
    return epoch !== _refreshEpoch
  }

  async function refresh() {
    if (_refreshing) return
    _refreshing = true
    const epoch = _refreshEpoch
    error.value = null
    try {
      if (!isAuthed.value || !currentUser.value?.id) {
        if (!isStale(epoch)) {
          hide()
          acceptedAt.value = null
        }
        return
      }

      const client = getSupabase()
      if (!client) {
        if (!isStale(epoch)) visible.value = true
        return
      }

      let switchEnabled
      try {
        switchEnabled = await getPaymentMasterEnabled({
          io: supabaseAppConfigIo(client),
          sessionArea: sessionArea(),
          force: true
        })
      } catch (e) {
        syncLog.warn('user agreement: master switch read failed', e?.message || e)
        if (!isStale(epoch)) hide()
        return
      }
      if (isStale(epoch)) return

      if (switchEnabled !== true) {
        hide()
        return
      }

      let at = null
      try {
        at = await readUserAgreementAcceptedAt(
          supabaseUserAgreementIo(client),
          currentUser.value.id
        )
      } catch (e) {
        syncLog.warn('user agreement: read failed', e?.message || e)
        if (!isStale(epoch)) {
          acceptedAt.value = null
          visible.value = true
        }
        return
      }
      if (isStale(epoch)) return

      acceptedAt.value = at
      const show = shouldShowUserAgreement({
        isAuthed: true,
        switchEnabled: true,
        acceptedAt: at
      })
      visible.value = show
      syncLog.info('user agreement: refresh', { acceptedAt: at, show })
    } finally {
      if (!isStale(epoch)) _refreshing = false
    }
  }

  async function agree() {
    if (!currentUser.value?.id || saving.value) return { ok: false }
    const client = getSupabase()
    if (!client) {
      error.value = 'no_client'
      return { ok: false }
    }

    saving.value = true
    error.value = null
    try {
      const saved = await writeUserAgreementOnce(
        supabaseUserAgreementIo(client),
        currentUser.value.id
      )
      acceptedAt.value = saved
      visible.value = false
      return { ok: true, acceptedAt: saved }
    } catch (e) {
      error.value = e?.message || 'save_failed'
      syncLog.warn('user agreement: save failed', e?.message || e)
      saving.value = false
      return { ok: false }
    }
    // 成功时保持 saving=true 至 reset，或已 visible=false；同意成功后不必再点
  }

  /**
   * 不同意：先锁住按钮（saving），再登出。登出成功由 onSignedOut→reset 清状态；
   * 登出失败则解锁以便重试。
   */
  async function disagree(signOutFn) {
    if (saving.value) return { ok: false }
    saving.value = true
    error.value = null
    try {
      await signOutFn()
      return { ok: true }
    } catch (e) {
      error.value = e?.message || 'sign_out_failed'
      syncLog.warn('user agreement: disagree signOut failed', e?.message || e)
      saving.value = false
      return { ok: false }
    }
  }

  return {
    visible: readonly(visible),
    saving: readonly(saving),
    error: readonly(error),
    acceptedAt: readonly(acceptedAt),
    refresh,
    agree,
    disagree,
    reset
  }
}
