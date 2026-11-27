// 提醒阶段：登录后若总开关 OFF 且尚未选择，强制一次性弹窗。
// 读开关复用管理员总开关模块 paymentMaster。
// choice 真相源为 Supabase user_metadata。
// 提醒阶段读失败 → 不弹窗、不挡功能。不做应用内改选。

import { ref, readonly } from 'vue'
import { getSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import {
  CONTACT_EMAILS,
  normalizePaymentChoice,
  readPaymentChoice,
  shouldShowPaymentReminder,
  supabasePaymentChoiceIo,
  writePaymentChoiceOnce
} from '../utils/paymentChoice'
import {
  clearPaymentMasterCache,
  getPaymentMasterEnabled,
  supabaseAppConfigIo
} from '../utils/paymentMaster'
import syncLog from '../utils/syncLogger'

const visible = ref(false)
const saving = ref(false)
const error = ref(null)
const paymentChoice = ref(null)

/** 每次 refresh/reset 递增；旧请求收尾时若世代落后则丢弃，避免 OFF 结果盖过 ON */
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

export function usePaymentReminder() {
  const { isAuthed, currentUser } = useAuth()

  function hide() {
    visible.value = false
    saving.value = false
    error.value = null
  }

  function reset() {
    _refreshEpoch += 1
    hide()
    paymentChoice.value = null
  }

  function isStale(epoch) {
    return epoch !== _refreshEpoch
  }

  /**
   * @param {{ switchEnabled?: boolean, force?: boolean }} [options]
   * 收费阶段（switchEnabled===true）绝不弹提醒窗：立刻 hide 并返回。
   */
  async function refresh(options = {}) {
    // 写入选择过程中不打断；其余并发用世代号，后到的 ON 可盖掉进行中的 OFF
    if (saving.value) {
      syncLog.info('payment reminder: skip refresh while saving')
      return
    }
    const epoch = ++_refreshEpoch
    error.value = null
    const force = options.force !== false

    // 已知收费阶段：立刻收起，勿再读 choice（也避免与协议窗叠闪）
    if (options.switchEnabled === true) {
      if (!isStale(epoch)) hide()
      syncLog.info('payment reminder: skip in pay phase')
      return
    }

    try {
      if (!isAuthed.value || !currentUser.value?.id) {
        if (!isStale(epoch)) {
          hide()
          paymentChoice.value = null
        }
        return
      }

      const client = getSupabase()
      if (!client) {
        if (!isStale(epoch)) hide()
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
          syncLog.warn('payment reminder: master switch read failed', e?.message || e)
          if (!isStale(epoch)) hide()
          return
        }
      }
      if (isStale(epoch)) return

      syncLog.info('payment reminder: switch', { switchEnabled })

      // 读开关后若已是收费阶段：收起并返回
      if (switchEnabled === true) {
        if (!isStale(epoch)) hide()
        return
      }

      const io = supabasePaymentChoiceIo(client)
      let choice
      try {
        choice = await readPaymentChoice(io, currentUser.value.id)
      } catch (e) {
        syncLog.warn('payment reminder: payment_choice read failed', e?.message || e)
        if (!isStale(epoch)) hide()
        return
      }
      if (isStale(epoch)) return

      paymentChoice.value = choice
      const show = shouldShowPaymentReminder({
        isAuthed: true,
        switchEnabled,
        paymentChoice: choice
      })
      visible.value = show
      syncLog.info('payment reminder: refresh', {
        switchEnabled,
        paymentChoice: choice,
        show
      })
    } catch (e) {
      syncLog.warn('payment reminder: refresh failed', e?.message || e)
      if (!isStale(epoch)) hide()
    }
  }

  async function choose(choice) {
    const next = normalizePaymentChoice(choice)
    if (!next || !currentUser.value?.id) return { ok: false }
    if (saving.value) return { ok: false }

    const client = getSupabase()
    if (!client) {
      error.value = 'no_client'
      return { ok: false }
    }

    saving.value = true
    error.value = null
    try {
      const saved = await writePaymentChoiceOnce(
        supabasePaymentChoiceIo(client),
        currentUser.value.id,
        next
      )
      paymentChoice.value = saved
      visible.value = false
      return { ok: true, choice: saved }
    } catch (e) {
      error.value = e?.message || 'save_failed'
      return { ok: false }
    } finally {
      saving.value = false
    }
  }

  return {
    visible: readonly(visible),
    saving: readonly(saving),
    error: readonly(error),
    paymentChoice: readonly(paymentChoice),
    contactEmails: CONTACT_EMAILS,
    refresh,
    choose,
    reset
  }
}
