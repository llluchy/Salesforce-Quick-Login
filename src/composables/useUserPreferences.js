// ============================================
// 扩展账户的个人配置
// ============================================
// 浮动栏开关存在 Supabase Auth 的 user_metadata（auth.users.raw_user_meta_data）。
// 它跟着扩展账户走：换设备登录后 getUser 能拉回同一份值。
// chrome.storage.local 只是给 content script 用的本地镜像，不作为真相源。
// ============================================

import { readonly, ref } from 'vue'
import { getSupabase } from './useSupabase'
import { STORAGE_KEY_SHOW_TOOL_FLOAT } from '../utils/constants'
import { t } from '../i18n'

const META_KEY = 'show_tool_float'

const showToolFloat = ref(true)
const saving = ref(false)

function parseFlag(value) {
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return true
}

async function mirrorLocal(enabled) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  await chrome.storage.local.set({ [STORAGE_KEY_SHOW_TOOL_FLOAT]: enabled })
}

export function useUserPreferences() {
  async function loadShowToolFloat() {
    const supabase = getSupabase()
    if (!supabase) throw new Error(t('auth.supabaseNotInit'))

    const { data, error } = await supabase.auth.getUser()
    if (error) throw error

    const enabled = parseFlag(data.user?.user_metadata?.[META_KEY])
    showToolFloat.value = enabled
    await mirrorLocal(enabled)
    return enabled
  }

  async function setShowToolFloat(enabled) {
    const next = !!enabled
    const previous = showToolFloat.value
    showToolFloat.value = next
    saving.value = true
    try {
      const supabase = getSupabase()
      if (!supabase) throw new Error(t('auth.supabaseNotInit'))

      const { data, error } = await supabase.auth.updateUser({
        data: { [META_KEY]: next }
      })
      if (error) throw error

      const confirmed = parseFlag(data.user?.user_metadata?.[META_KEY])
      showToolFloat.value = confirmed
      await mirrorLocal(confirmed)
      return confirmed
    } catch (e) {
      showToolFloat.value = previous
      throw e
    } finally {
      saving.value = false
    }
  }

  return {
    showToolFloat: readonly(showToolFloat),
    saving: readonly(saving),
    loadShowToolFloat,
    setShowToolFloat
  }
}
