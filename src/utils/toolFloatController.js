import { STORAGE_KEY_SESSION } from './constants.js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig.js'
import {
  clearSessionOverride,
  createUserMetadataRestIo,
  readOrInsertShowToolFloat,
  setLoggedOutVisible,
  signOutToolFloat
} from './toolFloatPref.js'

const ACTIONS = new Set([
  'getToolFloatVisible',
  'setToolFloatSession',
  'applyToolFloatCloud',
  'toolFloatSignedOut'
])

const FLOAT_TAB_URLS = [
  'https://*.salesforce.com/*',
  'https://*.force.com/*',
  'https://*.my.salesforce.com/*',
  'https://*.my.site.com/*',
  'https://*.cloudforce.com/*'
]

export async function broadcastToolFloatVisibility(visible) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return
  let tabs = []
  try {
    tabs = await chrome.tabs.query({ url: FLOAT_TAB_URLS })
  } catch {
    return
  }
  await Promise.all(tabs.map((tab) => {
    if (tab?.id == null) return Promise.resolve()
    try {
      const sent = chrome.tabs.sendMessage(tab.id, {
        action: 'toolFloatVisibility',
        visible: visible === true
      })
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

export function createToolFloatMessageHandler(options = {}) {
  const storage = options.storage || chrome.storage
  const broadcast = options.broadcast || broadcastToolFloatVisibility
  const ioForSession = options.ioForSession || ((session) => createUserMetadataRestIo({
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

  async function getVisible() {
    const auth = await resolveAuth()
    // 未登录（或 session 无效）：不注入页面浮动工具入口
    if (!auth) {
      return { success: true, visible: false, source: 'session', loginRequired: true }
    }
    try {
      const visible = await readOrInsertShowToolFloat(ioForSession(auth), auth.user.id)
      await clearSessionOverride(storage.session)
      return { success: true, visible, source: 'cloud' }
    } catch (error) {
      if (isUnauthorized(error)) {
        return { success: true, visible: false, source: 'session', loginRequired: true }
      }
      return { success: false, error: error?.message || String(error), source: 'cloud' }
    }
  }

  async function setSession(visible) {
    const auth = await resolveAuth()
    if (auth) return getVisible()
    // 未登录可改 session 偏好，但对外可见性始终 false
    await setLoggedOutVisible(storage.session, visible === true)
    return { success: true, visible: false, source: 'session', loginRequired: true }
  }

  async function applyCloud(visible) {
    await clearSessionOverride(storage.session)
    return { success: true, visible: visible === true, source: 'cloud' }
  }

  async function signedOut() {
    await signOutToolFloat(storage.session)
    // 登出后强制隐藏浮动栏并广播
    return { success: true, visible: false, source: 'session', loginRequired: true }
  }

  function handleToolFloatMessage(request, _sender, sendResponse) {
    const action = request?.action
    if (!ACTIONS.has(action)) return false

    const run = async () => {
      if (action === 'getToolFloatVisible') return getVisible()
      if (action === 'setToolFloatSession') {
        const result = await setSession(request.visible)
        if (result.success) await broadcast(result.visible)
        return result
      }
      if (action === 'applyToolFloatCloud') {
        const result = await applyCloud(request.visible)
        if (result.success) await broadcast(result.visible)
        return result
      }
      const result = await signedOut()
      if (result.success) await broadcast(result.visible)
      return result
    }

    run()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }))
    return true
  }

  handleToolFloatMessage.getVisible = getVisible
  handleToolFloatMessage.setSession = setSession
  handleToolFloatMessage.applyCloud = applyCloud
  handleToolFloatMessage.signedOut = signedOut
  return handleToolFloatMessage
}
