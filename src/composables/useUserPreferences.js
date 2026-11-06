// ============================================
// 扩展账户的个人配置
// ============================================
// 真相源是 Supabase 表 public.user_metadata（每个账户一行）。
// 这不是 Auth 的 raw_user_meta_data。
// chrome.storage.local 只是给 content script 用的本地镜像。
// ============================================

import { readonly, ref } from 'vue'
import { getSupabase } from './useSupabase'
import { STORAGE_KEY_SHOW_TOOL_FLOAT } from '../utils/constants'
import { t } from '../i18n'

const TABLE = 'user_metadata'

const showToolFloat = ref(true)
const saving = ref(false)

function parseFlag(value) {
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return true
}

export function isMissingUserMetadataTable(error) {
  const code = error?.code || ''
  const message = String(error?.message || error?.details || '')
  if (code === 'PGRST205' || code === '42P01' || code === 'PGRST204') return true
  return /user_metadata/i.test(message) && /schema cache|does not exist|找不到|Could not find/i.test(message)
}

export function preferenceErrorText(error) {
  if (isMissingUserMetadataTable(error)) return t('settings.tableMissing')
  return error?.message || String(error || '')
}

async function mirrorLocal(enabled) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  await chrome.storage.local.set({ [STORAGE_KEY_SHOW_TOOL_FLOAT]: enabled })
}

async function requireUserId() {
  const supabase = getSupabase()
  if (!supabase) throw new Error(t('auth.supabaseNotInit'))
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const userId = data.session?.user?.id
  if (!userId) throw new Error(t('auth.notLoggedIn'))
  return { supabase, userId }
}

export function useUserPreferences() {
  async function loadShowToolFloat() {
    const { supabase, userId } = await requireUserId()
    const { data, error } = await supabase
      .from(TABLE)
      .select('show_tool_float')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error

    const enabled = data ? parseFlag(data.show_tool_float) : true
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
      const { supabase, userId } = await requireUserId()
      const { data, error } = await supabase
        .from(TABLE)
        .upsert(
          { user_id: userId, show_tool_float: next },
          { onConflict: 'user_id' }
        )
        .select('show_tool_float')
        .single()
      if (error) throw error

      const confirmed = parseFlag(data?.show_tool_float)
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
