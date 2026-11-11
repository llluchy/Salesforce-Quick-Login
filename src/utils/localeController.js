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

function acknowledge(send, args) {
  try {
    const maybe = send(...args, () => {
      void chrome.runtime.lastError
    })
    if (maybe && typeof maybe.then === 'function') {
      maybe.then(() => {}, () => {})
    }
  } catch {
    /* 没有接收页面时不要抛到后台控制台 */
  }
}

export async function broadcastUiLocale(preference) {
  const pref = normalizeLocalePreference(preference) || 'system'
  if (typeof chrome === 'undefined') return
  const message = { action: 'uiLocaleChanged', preference: pref }
  if (chrome.runtime?.sendMessage) {
    acknowledge(chrome.runtime.sendMessage.bind(chrome.runtime), [message])
  }
  if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) return
  let tabs = []
  try {
    tabs = await chrome.tabs.query({ url: LOCALE_TAB_URLS })
  } catch {
    return
  }
  for (const tab of tabs) {
    if (tab?.id == null) continue
    acknowledge(chrome.tabs.sendMessage.bind(chrome.tabs), [tab.id, message])
  }
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
      if (action === 'setUiLocaleSession') return setSession(request.preference)
      if (action === 'applyUiLocaleCloud') return applyCloud(request.preference)
      return signedOut()
    }

    const reply = (payload) => {
      try {
        sendResponse(payload)
      } catch {
        /* 页面已经关掉时，回复失败不能再抛到后台 */
      }
      void globalThis.chrome?.runtime?.lastError
    }

    run()
      .then(async (result) => {
        reply(result)
        if (result?.success && action !== 'getUiLocale') {
          try {
            await broadcast(result.preference)
          } catch {
            /* 通知其它页面失败时，这次选择仍然算数 */
          }
        }
      })
      .catch((error) => {
        reply({ success: false, error: error?.message || String(error) })
      })
    return true
  }

  handleLocaleMessage.getPreference = getPreference
  handleLocaleMessage.setSession = setSession
  handleLocaleMessage.applyCloud = applyCloud
  handleLocaleMessage.signedOut = signedOut
  return handleLocaleMessage
}

export { LEGACY_LOCALE_LOCAL_KEY }
