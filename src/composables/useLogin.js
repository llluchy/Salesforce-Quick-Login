import { TYPE_URLS } from '../utils/constants'
import { t } from '../i18n'

const isChromeExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage

function buildFrontdoorUrl(serverUrl, sessionId) {
  const domainMatch = serverUrl.match(/https:\/\/[^/]+/)
  if (!domainMatch) {
    throw new Error(t('login.cannotParseUrl'))
  }
  const domain = domainMatch[0]
  return `${domain}/secur/frontdoor.jsp?sid=${encodeURIComponent(sessionId)}&retURL=%2Flightning%2Fpage%2Fhome`
}

function hostnameFromServerUrl(serverUrl) {
  try {
    return new URL(serverUrl.match(/https:\/\/[^/]+/)?.[0] || serverUrl).hostname
  } catch {
    return ''
  }
}

function orgIdFromSessionId(sessionId) {
  const sid = String(sessionId || '')
  if (!sid.includes('!')) return ''
  return sid.split('!')[0]
}

function parseSOAPResponse(xmlText) {
  try {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml')
    const sessionIdEl = xmlDoc.querySelector('sessionId')
    const serverUrlEl = xmlDoc.querySelector('serverUrl')
    if (sessionIdEl && serverUrlEl) {
      return {
        sessionId: sessionIdEl.textContent,
        serverUrl: serverUrlEl.textContent
      }
    }
    const faultstring = xmlDoc.querySelector('faultstring')
    if (faultstring) {
      const msg = faultstring.textContent
      if (msg.includes('MFA') || msg.includes('Multi-Factor') || msg.includes('multi-factor')) {
        throw new Error(t('login.mfaManual'))
      }
      if (msg.includes('Invalid username') || msg.includes('Invalid password')) {
        throw new Error(t('login.badCredentials'))
      }
      throw new Error(msg)
    }
  } catch (e) {
    if (e instanceof Error) throw e
  }
  return null
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message })
          return
        }
        resolve(response)
      })
    } catch (e) {
      resolve({ success: false, error: e?.message || String(e) })
    }
  })
}

export function useLogin() {
  const getLoginUrl = (env) => {
    if (env.type === 'custom') {
      return env.customUrl || TYPE_URLS.production
    }
    return TYPE_URLS[env.type] || TYPE_URLS.production
  }

  const getSoapUrl = (env) => {
    const loginUrl = getLoginUrl(env)
    const domainMatch = loginUrl.match(/https?:\/\/[^/]+/)
    if (!domainMatch) {
      throw new Error(t('login.badUrl'))
    }
    const domain = domainMatch[0]
    return `${domain}/services/Soap/c/64.0/`
  }

  /**
   * 官方已有会话入口：浏览器里仍有该账号有效 sid 时，
   * 用 frontdoor / singleaccess 直开，跳过账密与验证码。
   */
  const tryReuseExistingSession = async (env) => {
    if (!isChromeExt) return null
    const response = await sendMessage({
      action: 'reuseSfSessionLogin',
      env: {
        id: env.id,
        username: env.username,
        type: env.type,
        customUrl: env.customUrl,
        lastSfHostname: env.lastSfHostname || '',
        lastSfOrgId: env.lastSfOrgId || ''
      }
    })
    if (response?.success && response?.reused) {
      return {
        success: true,
        method: response.method || 'session',
        reused: true,
        hostname: response.hostname || '',
        orgId: response.orgId || ''
      }
    }
    return null
  }

  const login = async (env) => {
    if (!env.username || !env.password) {
      throw new Error(t('login.missingInfo'))
    }

    if (!isChromeExt) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ success: true, mock: true })
        }, 500)
      })
    }

    // 1) 已登录 Org：复用 Cookie 会话（官方 frontdoor）
    const reused = await tryReuseExistingSession(env)
    if (reused) return reused

    // 2) SOAP login → frontdoor
    const soapResponse = await sendMessage({
      action: 'soapLogin',
      type: env.type,
      url: env.customUrl,
      username: env.username,
      password: env.password
    })

    const soapOk = soapResponse && typeof soapResponse === 'object' && soapResponse.success
    if (soapOk) {
      try {
        const result = parseSOAPResponse(soapResponse.xmlText)
        if (result) {
          const frontdoorUrl = buildFrontdoorUrl(result.serverUrl, result.sessionId)
          await chrome.tabs.create({ url: frontdoorUrl })
          return {
            success: true,
            method: 'soap',
            reused: false,
            hostname: hostnameFromServerUrl(result.serverUrl),
            orgId: orgIdFromSessionId(result.sessionId)
          }
        }
      } catch {
        // fall through to form post
      }
    }

    // 3) 表单回退（含 MFA 等）
    return new Promise((resolve, reject) => {
      fallbackToFormPost(env, resolve, reject)
    })
  }

  const fallbackToFormPost = (env, resolve, reject) => {
    const loginUrl = getLoginUrl(env)

    chrome.runtime.sendMessage({
      action: 'formPostLogin',
      loginUrl,
      username: env.username,
      password: env.password,
      totpCode: env.totpCode || null
    }, (response) => {
      if (response && response.success) {
        resolve({ success: true, method: 'formPost', reused: false })
      } else {
        reject(response ? response.error : t('login.formLoginFailed'))
      }
    })
  }

  const fillTotpCode = async (code) => {
    if (isChromeExt) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'fillTotpCode',
          code: code
        }, (response) => {
          if (response && response.success) {
            resolve(response)
          } else {
            reject(response ? response.error : 'Failed to fill TOTP')
          }
        })
      })
    } else {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ success: true, mock: true })
        }, 200)
      })
    }
  }

  return {
    getLoginUrl,
    login,
    fillTotpCode
  }
}
