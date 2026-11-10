import { readonly, ref } from 'vue'
import { getSupabase } from './useSupabase'
import {
  commitToolFloatChange,
  loadToolFloatState,
  readOrInsertShowToolFloat,
  supabaseUserMetadataIo,
  writeShowToolFloat
} from '../utils/toolFloatPref.js'

const visible = ref(true)
const failed = ref(false)
const saving = ref(false)
const ready = ref(false)

function send(payload) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        resolve({ success: false, error: 'runtime' })
        return
      }
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message })
          return
        }
        resolve(response || { success: false, error: 'empty' })
      })
    } catch (error) {
      resolve({ success: false, error: error?.message || String(error) })
    }
  })
}

async function currentAuth() {
  const supabase = getSupabase()
  if (!supabase) return { kind: 'out' }
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) return { kind: 'error' }
    if (!data?.session?.user?.id) return { kind: 'out' }
    return { kind: 'in', id: data.session.user.id, client: supabase }
  } catch {
    return { kind: 'error' }
  }
}

async function refresh() {
  const auth = await currentAuth()
  if (auth.kind === 'error') {
    failed.value = true
    ready.value = true
    return
  }
  try {
    const result = await loadToolFloatState({
      loggedIn: auth.kind === 'in',
      read: () => readOrInsertShowToolFloat(supabaseUserMetadataIo(auth.client), auth.id),
      getSession: () => send({ action: 'getToolFloatVisible' }),
      applyCloud: (shown) => send({ action: 'applyToolFloatCloud', visible: shown })
    })
    if (!result.ok) {
      failed.value = true
    } else {
      visible.value = result.visible
      failed.value = false
    }
  } catch {
    failed.value = true
  } finally {
    ready.value = true
  }
}

async function setVisible(next) {
  if (saving.value || !ready.value) return
  const previous = visible.value
  saving.value = true
  const auth = await currentAuth()
  if (auth.kind === 'error') {
    visible.value = previous
    failed.value = true
    saving.value = false
    return
  }
  const result = await commitToolFloatChange({
    loggedIn: auth.kind === 'in',
    previous,
    next: next === true,
    write: (value) => writeShowToolFloat(supabaseUserMetadataIo(auth.client), auth.id, value),
    setSession: (value) => send({ action: 'setToolFloatSession', visible: value }),
    applyCloud: (shown) => send({ action: 'applyToolFloatCloud', visible: shown })
  })
  visible.value = result.visible
  failed.value = !result.ok
  saving.value = false
}

export function useToolFloat() {
  return {
    visible: readonly(visible),
    failed: readonly(failed),
    saving: readonly(saving),
    ready: readonly(ready),
    refresh,
    setVisible
  }
}
