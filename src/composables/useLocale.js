import { readonly, ref } from 'vue'
import { getSupabase } from './useSupabase'
import { applyDocumentLang, detectBrowserLocale, i18n } from '../i18n'
import {
  SESSION_LOCALE_KEY,
  commitLocaleChange,
  effectiveLocale,
  loadLocaleState,
  normalizeLocalePreference,
  readUiLocale,
  removeLegacyLocalePreference,
  supabaseLocaleIo,
  writeUiLocale
} from '../utils/localePref.js'

const preference = ref('system')
const failed = ref(false)
const saving = ref(false)

function applyPreference(pref) {
  const next = normalizeLocalePreference(pref) || 'system'
  const locale = effectiveLocale(next, detectBrowserLocale())
  i18n.global.locale.value = locale
  applyDocumentLang(locale)
  return { preference: next, locale }
}

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

async function dropLegacy() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    await removeLegacyLocalePreference(chrome.storage.local)
  } catch {
    /* 旧键删不掉时也不读取它 */
  }
}

let listenerInstalled = false
function installListener() {
  if (listenerInstalled) return
  listenerInstalled = true
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return
  chrome.runtime.onMessage.addListener((request) => {
    if (request?.action !== 'uiLocaleChanged') return
    const pref = normalizeLocalePreference(request.preference)
    if (!pref) return
    preference.value = pref
    failed.value = false
    applyPreference(pref)
  })
}

installListener()

export async function refreshLocale() {
  await dropLegacy()
  const auth = await currentAuth()
  if (auth.kind === 'error') {
    failed.value = true
    return { ok: false, preference: preference.value, locale: i18n.global.locale.value }
  }
  const result = await loadLocaleState({
    loggedIn: auth.kind === 'in',
    read: () => readUiLocale(supabaseLocaleIo(auth.client), auth.id),
    getSession: () => send({ action: 'getUiLocale' }),
    applyCloud: (pref) => send({ action: 'applyUiLocaleCloud', preference: pref })
  })
  if (!result.ok) {
    failed.value = true
    return { ok: false, preference: preference.value, locale: i18n.global.locale.value }
  }
  preference.value = result.preference
  failed.value = false
  return { ok: true, ...applyPreference(result.preference) }
}

export async function setLocale(next) {
  if (saving.value) return { ok: false, preference: preference.value }
  const previous = preference.value
  saving.value = true
  await dropLegacy()
  const auth = await currentAuth()
  if (auth.kind === 'error') {
    failed.value = true
    saving.value = false
    return { ok: false, preference: previous }
  }
  const result = await commitLocaleChange({
    loggedIn: auth.kind === 'in',
    previous,
    next,
    write: (value) => writeUiLocale(supabaseLocaleIo(auth.client), auth.id, value),
    setSession: (value) => send({ action: 'setUiLocaleSession', preference: value }),
    applyCloud: (value) => send({ action: 'applyUiLocaleCloud', preference: value })
  })
  preference.value = result.preference
  failed.value = !result.ok
  if (result.ok) applyPreference(result.preference)
  saving.value = false
  return result
}

export async function resetLocaleAfterLogout() {
  preference.value = 'system'
  failed.value = false
  applyPreference('system')
  const res = await send({ action: 'uiLocaleSignedOut' })
  if (res?.success) return
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.remove(SESSION_LOCALE_KEY)
    }
  } catch {
    /* 后台已经负责清会话覆盖 */
  }
}

export function getLocale() {
  return preference.value
}

export function useLocale() {
  return {
    preference: readonly(preference),
    failed: readonly(failed),
    saving: readonly(saving),
    refresh: refreshLocale,
    setLocale
  }
}
