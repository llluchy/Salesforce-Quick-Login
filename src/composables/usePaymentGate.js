// 读管理员总开关。本 PR 只暴露读取能力，不接提醒 UI / 付费门 / 清数据。
import { readonly, ref } from 'vue'
import { getSupabase } from './useSupabase'
import {
  clearPaymentMasterCache,
  getPaymentMasterEnabled,
  supabaseAppConfigIo
} from '../utils/paymentMaster.js'

const paymentEnabled = ref(false)
const failed = ref(false)
const ready = ref(false)

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

/**
 * @param {{ force?: boolean }} [options]
 */
async function refresh(options = {}) {
  const force = options.force === true
  const supabase = getSupabase()
  if (!supabase) {
    failed.value = true
    ready.value = true
    return
  }
  try {
    if (force) {
      try {
        await clearPaymentMasterCache(sessionArea())
      } catch {
        /* ignore */
      }
    }
    const enabled = await getPaymentMasterEnabled({
      io: supabaseAppConfigIo(supabase),
      sessionArea: sessionArea(),
      force
    })
    paymentEnabled.value = enabled === true
    failed.value = false
  } catch {
    failed.value = true
  } finally {
    ready.value = true
  }
}

export function usePaymentGate() {
  return {
    /** true = 收费阶段；false = 提醒阶段（默认） */
    paymentEnabled: readonly(paymentEnabled),
    failed: readonly(failed),
    ready: readonly(ready),
    refresh
  }
}
