// 提醒阶段：登录后若总开关 OFF 且尚未选择，强制一次性弹窗。
// 读开关约定见 paymentMasterSwitch；choice 真相源为 Supabase user_metadata。
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
  readPaymentMasterEnabled,
  supabasePaymentMasterIo
} from '../utils/paymentMasterSwitch'

const visible = ref(false)
const saving = ref(false)
const error = ref(null)
const paymentChoice = ref(null)

let _refreshing = false

export function usePaymentReminder() {
  const { isAuthed, currentUser } = useAuth()

  function hide() {
    visible.value = false
    saving.value = false
    error.value = null
  }

  function reset() {
    hide()
    paymentChoice.value = null
  }

  async function refresh() {
    if (_refreshing) return
    _refreshing = true
    error.value = null
    try {
      if (!isAuthed.value || !currentUser.value?.id) {
        hide()
        paymentChoice.value = null
        return
      }

      const client = getSupabase()
      if (!client) {
        hide()
        return
      }

      let switchEnabled
      try {
        switchEnabled = await readPaymentMasterEnabled(supabasePaymentMasterIo(client))
      } catch {
        // 提醒阶段：读开关失败不弹、不挡
        hide()
        return
      }

      const io = supabasePaymentChoiceIo(client)
      let choice
      try {
        choice = await readPaymentChoice(io, currentUser.value.id)
      } catch {
        hide()
        return
      }

      paymentChoice.value = choice
      visible.value = shouldShowPaymentReminder({
        isAuthed: true,
        switchEnabled,
        paymentChoice: choice
      })
    } finally {
      _refreshing = false
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
