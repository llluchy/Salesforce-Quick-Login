import { STORAGE_KEY_SESSION } from './constants.js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig.js'
import {
  LEGACY_LOCALE_LOCAL_KEY,
  clearSessionOverride,
  createLocaleRestIo,
  getLoggedOutPreference,
  normalizeLocalePreference,
  readUiLocale,
  removeLegacyLocalePreference,
  setLoggedOutPreference,
  signOutLocale
} from './localePref.js'

const ACTIONS = new Set([
  'getUiLocale',
  'setUiLocaleSession',
  'applyUiLocaleCloud',
  'uiLocaleSignedOut'
])

const LOCALE_TAB_URLS = [
  'https://*.salesforce.com/*',
  'https://*.force.com/*',
  'https://*.my.salesforce.com/*',
  'https://*.my.site.com/*',
  'https://*.cloudforce.com/*'
]

export async function broadcastUiLocale(preference) {
  const pref = normalizeLocalePreference(preference) || 'system'
  if (typeof chrome === 'undefined') return
  const message = { action: 'uiLocaleChanged', preference: pref }
  try {
    const sent = chrome.runtime?.sendMessage?.(message)
    if (sent && typeof sent.catch === 'function') sent.catch(() => {})
  } catch {
    /* 没有其它扩展页面在听 */
  }
  if (!chrome.tabs?.query) return
  let tabs = []
  try {
    tabs = await chrome.tabs.query({ url: LOCALE_TAB_URLS })
  } catch {
    return
  }
  await Promise.all(tabs.map((tab) => {
    if (tab?.id == null) return Promise.resolve()
    try {
      const sent = chrome.tabs.sendMessage(tab.id, message)
      if (sent && typeof sent.catch === 'function') return sent.catch(() => {})
    } catch {
      /* 标签没有 content script */
    }
    return Promise.resolve()
  }))
}

function isUnauthorized(error) {
  return error?.status === 401 || error?.code === 'PGRST301'
}

export function createLocaleMessageHandler(options = {}) {
  const storage = options.storage || chrome.storage
  const broadcast = options.broadcast || broadcastUiLocale
  const ioForSession = options.ioForSession || ((session) => createLocaleRestIo({
    supabaseUrl: options.supabaseUrl || SUPABASE_URL,
    anonKey: options.anonKey || SUPABASE_ANON_KEY,
    accessToken: session.access_token,
    fetchImpl: options.fetchImpl
  }))

  async function resolveAuth() {
    const data = await storage.local.get(STORAGE_KEY_SESSION)
    const session = data?.[STORAGE_KEY_SESSION]
    if (!session?.access_token || !session?.user?.id) return null
    return session
  }

  async function dropLegacy() {
    try {
      await removeLegacyLocalePreference(storage.local)
    } catch {
      /* 删不掉旧键也不改当前语言 */
    }
  }

  async function getPreference() {
    await dropLegacy()
    const auth = await resolveAuth()
    if (!auth) {
      const preference = await getLoggedOutPreference(storage.session)
      return { success: true, preference, source: 'session' }
    }
    try {
      const preference = await readUiLocale(ioForSession(auth), auth.user.id)
      await clearSessionOverride(storage.session)
      return { success: true, preference, source: 'cloud' }
    } catch (error) {
      if (isUnauthorized(error)) {
        const preference = await getLoggedOutPreference(storage.session)
        return { success: true, preference, source: 'session' }
      }
      return { success: false, error: error?.message || String(error), source: 'cloud' }
    }
  }

  async function setSession(preference) {
    const auth = await resolveAuth()
    if (auth) return getPreference()
    const pref = await setLoggedOutPreference(storage.session, preference)
    return { success: true, preference: pref, source: 'session' }
  }

  async function applyCloud(preference) {
    const pref = normalizeLocalePreference(preference) || 'system'
    await clearSessionOverride(storage.session)
    return { success: true, preference: pref, source: 'cloud' }
  }

  async function signedOut() {
    const result = await signOutLocale(storage.session)
    return { success: true, preference: result.preference, source: 'session' }
  }

  function handleLocaleMessage(request, _sender, sendResponse) {
    const action = request?.action
    if (!ACTIONS.has(action)) return false

    const run = async () => {
      if (action === 'getUiLocale') return getPreference()
      if (action === 'setUiLocaleSession') {
        const result = await setSession(request.preference)
        if (result.success) await broadcast(result.preference)
        return result
      }
      if (action === 'applyUiLocaleCloud') {
        const result = await applyCloud(request.preference)
        if (result.success) await broadcast(result.preference)
        return result
      }
      const result = await signedOut()
      if (result.success) await broadcast(result.preference)
      return result
    }

    run()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }))
    return true
  }

  handleLocaleMessage.getPreference = getPreference
  handleLocaleMessage.setSession = setSession
  handleLocaleMessage.applyCloud = applyCloud
  handleLocaleMessage.signedOut = signedOut
  return handleLocaleMessage
}

export { LEGACY_LOCALE_LOCAL_KEY }
