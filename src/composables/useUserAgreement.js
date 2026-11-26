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
    hide()
    acceptedAt.value = null
  }

  async function refresh() {
    if (_refreshing) return
    _refreshing = true
    error.value = null
    try {
      if (!isAuthed.value || !currentUser.value?.id) {
        hide()
        acceptedAt.value = null
        return
      }

      const client = getSupabase()
      if (!client) {
        // 付费模式无法确认协议时挡住
        visible.value = true
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
        // 读不到开关时不当作付费模式强制协议
        hide()
        return
      }

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
        // 付费模式读失败 → 未同意，强制弹窗
        acceptedAt.value = null
        visible.value = true
        return
      }

      acceptedAt.value = at
      const show = shouldShowUserAgreement({
        isAuthed: true,
        switchEnabled: true,
        acceptedAt: at
      })
      visible.value = show
      syncLog.info('user agreement: refresh', { acceptedAt: at, show })
    } finally {
      _refreshing = false
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
      return { ok: false }
    } finally {
      saving.value = false
    }
  }

  return {
    visible: readonly(visible),
    saving: readonly(saving),
    error: readonly(error),
    acceptedAt: readonly(acceptedAt),
    refresh,
    agree,
    reset
  }
}
