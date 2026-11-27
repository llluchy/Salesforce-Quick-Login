// 付费模式（开关 ON）：登录后强制一次性用户协议。
// 同意写入 user_metadata.user_agreement_accepted_at；不同意由调用方登出。
// 开关 ON 且协议读失败 → 视为未同意（fail-closed，挡住使用）。

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
  clearPaymentMasterCache,
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

  /** 展示协议；不在 saving 中途调用（refresh 会跳过进行中的同意/拒绝）。 */
  function showModal() {
    visible.value = true
    saving.value = false
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

  /**
   * @param {{ switchEnabled?: boolean, force?: boolean, blockPending?: boolean }} [options]
   * switchEnabled 传入时跳过读开关（由 App 统一读一次）。
   * blockPending：确认开关 ON 后、读同意状态前先挡住（配合 boot / 登录路径）。
   */
  async function refresh(options = {}) {
    if (_refreshing) return
    // visibilitychange 等触发的 refresh 不得打断进行中的 agree/disagree
    if (saving.value) {
      syncLog.info('user agreement: skip refresh while saving')
      return
    }
    _refreshing = true
    const epoch = _refreshEpoch
    error.value = null
    const force = options.force !== false
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
        if (!isStale(epoch)) showModal()
        return
      }

      let switchEnabled = options.switchEnabled
      if (typeof switchEnabled !== 'boolean') {
        const area = sessionArea()
        try {
          if (force) await clearPaymentMasterCache(area)
          switchEnabled = await getPaymentMasterEnabled({
            io: supabaseAppConfigIo(client),
            sessionArea: area,
            force: true
          })
        } catch (e) {
          syncLog.warn('user agreement: master switch read failed', e?.message || e)
          // 读不到开关时无法确认付费模式；不弹协议（避免提醒阶段误挡）
          if (!isStale(epoch)) hide()
          return
        }
      }
      if (isStale(epoch)) return

      syncLog.info('user agreement: switch', { switchEnabled })

      if (switchEnabled !== true) {
        hide()
        return
      }

      // 登录路径：先挡住，再确认是否已同意
      if (options.blockPending === true && !isStale(epoch)) {
        showModal()
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
          showModal()
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
      if (show) showModal()
      else hide()
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
      return { ok: false }
    } finally {
      saving.value = false
    }
  }

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
