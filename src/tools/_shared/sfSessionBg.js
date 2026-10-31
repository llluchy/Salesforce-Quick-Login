/**
 * Cookie 会话路径：Service Worker 中发现 / 读取 Salesforce sid
 * 对齐 vendor Soql Creator（getSfHost / getSession / getMyDomain）
 * Apex Log / SOQL 共用，勿再维护第二套发现逻辑
 *
 * 注意：Chrome / Salesforce 已启用 Cookie 分区（CHIPS）。
 * getAll/get 若不带 partitionKey，默认只返回未分区 Cookie，会导致扫不到 sid。
 * 使用 partitionKey: {} 可同时拿到分区与未分区存储中的 Cookie。
 * 且应优先用 domain 查询，避免 url + partitionKey 在部分 Chrome 版本被错误过滤。
 */

/** 与 Soql Creator background 一致，并补充常见实例域 */
const ORDERED_DOMAINS = [
  'salesforce.com',
  'my.salesforce.com',
  'lightning.force.com',
  'cloudforce.com',
  'salesforce.mil',
  'cloudforce.mil',
  'sfcrmproducts.cn',
  'force.com',
  'salesforce-setup.com',
  'visualforce.com'
]

export function isSalesforceUrl(url) {
  if (!url || url.startsWith('chrome') || url.startsWith('about:')) return false
  try {
    const host = new URL(url).hostname
    return (
      host.endsWith('salesforce.com') ||
      host.endsWith('force.com') ||
      host.endsWith('cloudforce.com') ||
      host.endsWith('visualforce.com') ||
      host.endsWith('salesforce-setup.com') ||
      host.endsWith('sfcrmproducts.cn')
    )
  } catch {
    return false
  }
}

function isSalesforceCookieDomain(domain) {
  if (!domain) return false
  const d = String(domain).replace(/^\./, '').toLowerCase()
  return (
    d.endsWith('salesforce.com') ||
    d.endsWith('force.com') ||
    d.endsWith('cloudforce.com') ||
    d.endsWith('visualforce.com') ||
    d.endsWith('salesforce-setup.com') ||
    d.endsWith('sfcrmproducts.cn')
  )
}

/** API 用主机名（与 Soql SalesforceConnection.getMyDomain 一致） */
export function normalizeSfHostname(host) {
  if (!host) return host
  return String(host)
    .replace(/^\./, '')
    .replace(/\.lightning\.force\./, '.my.salesforce.')
    .replace(/\.mcas\.ms$/, '')
}

export function guessEnvLabel(hostname) {
  const h = (hostname || '').toLowerCase()
  if (h.includes('sandbox') || h.includes('.cs') || h.includes('--')) return 'Sandbox'
  if (h.includes('test') || h.includes('scratch')) return 'Test'
  return 'Production'
}

function cookieOpts(extra = {}) {
  const opts = { ...extra }
  if (opts.storeId == null) delete opts.storeId
  return opts
}

/**
 * 构造 cookies 查询参数：默认带 partitionKey:{}，兼容分区 sid。
 * 旧版 Chrome 若不认 partitionKey，调用方应 catch 后降级。
 */
function sidQuery(extra = {}) {
  return cookieOpts({
    name: 'sid',
    partitionKey: {},
    ...extra
  })
}

async function getAllSidCookies(details) {
  const primary = sidQuery(details)
  try {
    return await chrome.cookies.getAll(primary)
  } catch (e) {
    // 极旧 Chrome：不支持 partitionKey 时降级
    const { partitionKey, ...rest } = primary
    try {
      return await chrome.cookies.getAll(rest)
    } catch {
      console.warn('[SfSession] cookies.getAll failed', e)
      return []
    }
  }
}

function hostPreferenceScore(hostname) {
  const h = normalizeSfHostname(hostname)
  if (h.includes('.my.salesforce.')) return 100
  if (h.endsWith('salesforce.com') && !h.includes('help.')) return 80
  if (h.includes('cloudforce.com')) return 70
  if (h.includes('lightning.force')) return 40
  if (h.includes('visualforce.com')) return 10
  return 50
}

function isSessionSid(value, domain) {
  if (!value?.includes('!')) return false
  if ((domain || '').includes('help.salesforce.com')) return false
  return true
}

/**
 * 根据页面 URL 定位会话 Cookie 所在 domain
 * 返回值可能带前导点（与 Soql Creator 一致），供 getSession 原样使用
 */
export async function getSfHost(url, cookieStoreId) {
  try {
    const currentDomain = new URL(url).hostname

    // 优先用 domain 枚举（含分区 Cookie）；url 查询在部分 Chrome 会漏掉分区 Cookie
    let currentSid = null
    try {
      const pageCookies = await getAllSidCookies({
        domain: currentDomain,
        storeId: cookieStoreId
      })
      currentSid = pageCookies.find((c) => isSessionSid(c.value, c.domain)) || null
    } catch {
      // ignore
    }

    if (!currentSid) {
      try {
        currentSid = await chrome.cookies.get(
          cookieOpts({ url, name: 'sid', storeId: cookieStoreId })
        )
      } catch {
        currentSid = null
      }
    }

    if (!currentSid?.value || currentDomain.endsWith('.mcas.ms')) {
      return currentDomain
    }

    const [orgId] = currentSid.value.split('!')
    for (const domain of ORDERED_DOMAINS) {
      try {
        const cookies = await getAllSidCookies({
          domain,
          storeId: cookieStoreId
        })
        const sessionCookie = cookies.find(
          (c) => c.value.startsWith(orgId + '!') && !(c.domain || '').includes('help.salesforce.com')
        )
        if (sessionCookie) return sessionCookie.domain
      } catch {
        // continue
      }
    }
    return currentDomain
  } catch (e) {
    console.error('[SfSession] getSfHost', e)
    try {
      return new URL(url).hostname
    } catch {
      return null
    }
  }
}

/**
 * 读取 sid。sfHost 可带前导点（Soql 原样拼接 https:// + sfHost）
 * 返回的 hostname 已 normalize，可直接作 API instance host
 */
export async function getSession(sfHost, cookieStoreId) {
  if (!sfHost) return null

  const candidates = [
    sfHost,
    String(sfHost).replace(/^\./, ''),
    normalizeSfHostname(sfHost),
    // 若传入已是 my.salesforce，也试 lightning（Cookie 可能只挂在 lightning）
    String(sfHost)
      .replace(/^\./, '')
      .replace(/\.my\.salesforce\./, '.lightning.force.')
  ]
  const unique = [...new Set(candidates.filter(Boolean))]

  for (const host of unique) {
    const urlHost = String(host).replace(/^\./, '')
    try {
      // 1) domain + partitionKey（推荐，能拿到分区 sid）
      const byDomain = await getAllSidCookies({
        domain: urlHost,
        storeId: cookieStoreId
      })
      const matched =
        byDomain.find((c) => isSessionSid(c.value, c.domain)) ||
        byDomain.find((c) => c?.value)
      if (matched?.value) {
        return {
          key: matched.value,
          hostname: normalizeSfHostname(matched.domain || urlHost)
        }
      }

      // 2) 兼容旧路径：url get（可能读不到分区 Cookie）
      let cookie = await chrome.cookies.get(
        cookieOpts({
          name: 'sid',
          storeId: cookieStoreId,
          url: 'https://' + urlHost
        })
      )
      if (!cookie && String(host).startsWith('.')) {
        cookie = await chrome.cookies.get(
          cookieOpts({
            name: 'sid',
            storeId: cookieStoreId,
            url: 'https://' + host
          })
        )
      }
      if (cookie?.value) {
        return {
          key: cookie.value,
          hostname: normalizeSfHostname(cookie.domain || urlHost)
        }
      }
    } catch (e) {
      // try next
    }
  }
  return null
}

function buildEnv(sessionId, hostname, extras = {}) {
  const host = normalizeSfHostname(hostname)
  if (!sessionId || !host || !sessionId.includes('!')) return null
  const orgId = sessionId.split('!')[0]
  return {
    id: orgId,
    orgId,
    name: guessEnvLabel(host),
    label: guessEnvLabel(host),
    sessionId,
    hostname: host,
    instanceUrl: `https://${host}`,
    connectedAt: Date.now(),
    hasSession: true,
    ...extras
  }
}

/**
 * 探测 sid 是否仍可调用 API。Cookie 残留但服务端已过期时返回 false。
 * 网络异常时返回 true，避免离线把列表清空。
 */
export async function isSessionAlive(hostname, sessionId, { timeoutMs = 8000 } = {}) {
  const host = normalizeSfHostname(hostname)
  if (!host || !sessionId?.includes('!')) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`https://${host}/services/data/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionId}`,
        Accept: 'application/json'
      },
      redirect: 'manual',
      signal: controller.signal
    })

    // 过期会话常被重定向到登录页
    if (res.type === 'opaqueredirect') return false
    if (res.status >= 300 && res.status < 400) return false
    if (res.status === 401 || res.status === 403) return false

    if (res.status >= 200 && res.status < 300) {
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      if (ct.includes('text/html')) return false
      return true
    }

    // 限流等暂时性错误：保留，避免误杀
    return true
  } catch {
    return true
  } finally {
    clearTimeout(timer)
  }
}

async function filterAliveSessions(envs) {
  if (!envs?.length) return []
  const results = await Promise.all(
    envs.map(async (env) => {
      const alive = await isSessionAlive(env.hostname, env.sessionId)
      return alive ? env : null
    })
  )
  return results.filter(Boolean)
}

function upsertCookieEnv(byOrg, cookie) {
  if (!isSessionSid(cookie?.value, cookie?.domain)) return
  if (!isSalesforceCookieDomain(cookie.domain)) return
  const score = hostPreferenceScore(cookie.domain)
  const env = buildEnv(cookie.value, cookie.domain)
  if (!env) return
  const prev = byOrg.get(env.orgId)
  if (!prev || score > prev.score) {
    byOrg.set(env.orgId, { env, score })
  }
}

/**
 * 直接枚举 sid Cookie（主路径，不依赖是否打开 SF 页）
 */
export async function discoverFromCookies(cookieStoreId) {
  /** @type {Map<string, { env: any, score: number }>} */
  const byOrg = new Map()

  for (const domain of ORDERED_DOMAINS) {
    try {
      const cookies = await getAllSidCookies({
        domain,
        storeId: cookieStoreId
      })
      for (const c of cookies) upsertCookieEnv(byOrg, c)
    } catch {
      // continue
    }
  }

  // 兜底：不按 domain 过滤，拉全量 sid（含分区），再本地过滤 SF 域
  if (byOrg.size === 0) {
    try {
      const all = await getAllSidCookies({ storeId: cookieStoreId })
      for (const c of all) upsertCookieEnv(byOrg, c)
    } catch (e) {
      console.warn('[SfSession] fallback getAll sid failed', e)
    }
  }

  return [...byOrg.values()].map((x) => x.env)
}

export async function extractSessionFromTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab?.url || !isSalesforceUrl(tab.url)) return null
    const sfHost = await getSfHost(tab.url, tab.cookieStoreId)
    if (!sfHost) return null
    const session = await getSession(sfHost, tab.cookieStoreId)
    if (!session) return null
    return buildEnv(session.key, session.hostname, {
      tabId: tab.id,
      tabTitle: tab.title || session.hostname
    })
  } catch (e) {
    console.error('[SfSession] extractSessionFromTab', e)
    return null
  }
}

export async function discoverFromTabs() {
  const tabs = await chrome.tabs.query({})
  const envs = []
  for (const tab of tabs) {
    if (!tab?.url || !isSalesforceUrl(tab.url)) continue
    const env = await extractSessionFromTab(tab.id)
    if (env) envs.push(env)
  }
  return envs
}

/**
 * 完整会话发现（含 sessionId），供 Apex Log / 内部使用。
 * 默认会探测 sid 有效性，过期会话不进入列表。
 */
export async function discoverSfSessions({ validate = true } = {}) {
  /** @type {Map<string, { env: any, score: number }>} */
  const byOrg = new Map()

  const upsert = (env, scoreBoost = 0) => {
    if (!env?.orgId || !env.sessionId) return
    const score = hostPreferenceScore(env.hostname) + scoreBoost
    const prev = byOrg.get(env.orgId)
    if (!prev || score >= prev.score) {
      byOrg.set(env.orgId, {
        env: prev ? { ...prev.env, ...env, sessionId: env.sessionId } : env,
        score
      })
    }
  }

  for (const env of await discoverFromCookies()) upsert(env, 10)
  for (const env of await discoverFromTabs()) upsert(env, 20)

  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (active?.url && isSalesforceUrl(active.url)) {
      const env = await extractSessionFromTab(active.id)
      if (env) upsert(env, 40)
    }
  } catch {
    // ignore
  }

  const listed = [...byOrg.values()]
    .map((x) => x.env)
    .sort((a, b) => a.hostname.localeCompare(b.hostname))

  if (!validate) return listed
  return filterAliveSessions(listed)
}

/**
 * 列出已登录 Org（不把 sessionId 暴露给 UI；SOQL 再调 getSfSession）
 */
export async function listLoggedInSfEnvironments() {
  const sessions = await discoverSfSessions()
  return sessions.map(({ sessionId, ...rest }) => ({
    ...rest,
    hasSession: true
  }))
}

function normUsername(value) {
  return String(value || '').trim().toLowerCase()
}

function usernamesMatch(a, b) {
  const x = normUsername(a)
  const y = normUsername(b)
  if (!x || !y) return false
  if (x === y) return true
  const xLocal = x.split('@')[0]
  const yLocal = y.split('@')[0]
  return Boolean(xLocal && yLocal && (x === yLocal || y === xLocal))
}

function orgIdsMatch(a, b) {
  const x = String(a || '').trim()
  const y = String(b || '').trim()
  return Boolean(x && y && x === y)
}

function looksLikeSandboxHost(hostname) {
  const h = String(hostname || '').toLowerCase()
  return (
    h.includes('sandbox') ||
    h.includes('.cs') ||
    h.includes('--') ||
    h.includes('scratch') ||
    h.includes('test.salesforce')
  )
}

function hostMatchesEnvType(hostname, envType, customUrl) {
  const h = normalizeSfHostname(hostname)
  if (!h) return false
  if (envType === 'custom' && customUrl) {
    try {
      const customHost = normalizeSfHostname(new URL(customUrl).hostname)
      if (!customHost) return true
      // My Domain / 自定义登录域：同后缀或相等即可
      return h === customHost || h.endsWith(customHost) || customHost.endsWith(h)
    } catch {
      return true
    }
  }
  if (envType === 'sandbox') return looksLikeSandboxHost(h)
  if (envType === 'production') return !looksLikeSandboxHost(h)
  return true
}

/**
 * 用 sid 拉当前用户名（官方 Identity / userinfo）。
 * 失败返回空字符串，不抛错。
 */
export async function fetchSessionUsername(hostname, sessionId, { timeoutMs = 6000 } = {}) {
  const host = normalizeSfHostname(hostname)
  if (!host || !sessionId?.includes('!')) return ''

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`https://${host}/services/oauth2/userinfo`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionId}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    })
    if (!res.ok) return ''
    const data = await res.json().catch(() => null)
    return (
      data?.preferred_username ||
      data?.username ||
      data?.email ||
      ''
    )
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 官方 UI Bridge：优先 singleaccess（不在地址栏暴露 sid），
 * 失败则回退到 frontdoor.jsp?sid=…（Help: 000386254）。
 */
export async function buildUiBridgeUrl(hostname, sessionId, retURL = '/lightning/page/home') {
  const host = normalizeSfHostname(hostname)
  if (!host || !sessionId) throw new Error('missing session')

  try {
    // 官方 UI Bridge：多数示例 body 为空；成功则返回短时 frontdoor_uri
    const res = await fetch(`https://${host}/services/oauth2/singleaccess`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionId}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: ''
    })
    if (res.ok) {
      const data = await res.json().catch(() => null)
      if (data?.frontdoor_uri) {
        return { url: data.frontdoor_uri, method: 'singleaccess', hostname: host }
      }
    }
  } catch {
    // fall through
  }

  // Help 000386254：https://instance/secur/frontdoor.jsp?sid=…&retURL=…
  const encodedRet = encodeURIComponent(retURL || '/lightning/page/home')
  const url = `https://${host}/secur/frontdoor.jsp?sid=${encodeURIComponent(sessionId)}&retURL=${encodedRet}`
  return { url, method: 'frontdoor', hostname: host }
}

function packReusable(session) {
  const sessionId = session.sessionId || session.key
  const hostname = normalizeSfHostname(session.hostname)
  const orgId = session.orgId || (sessionId ? sessionId.split('!')[0] : '')
  return { hostname, orgId, sessionId }
}

/** Cookie 已证明会话有效时，直接打开 Lightning 首页（同一浏览器会话会带上 sid） */
export function buildLoggedInHomeUrl(hostname) {
  const host = normalizeSfHostname(hostname)
  if (!host) return ''
  return `https://${host}/lightning/page/home`
}

function sessionLooksReusable(session, { username, hintOrgId, type, customUrl }) {
  if (!session?.sessionId && !session?.key) return false
  if (!session?.hostname) return false
  const sessionId = session.sessionId || session.key
  const orgId = session.orgId || sessionId.split('!')[0]
  if (hintOrgId && orgIdsMatch(orgId, hintOrgId)) return true
  if (!hostMatchesEnvType(session.hostname, type, customUrl)) return false
  return Boolean(username)
}

/**
 * 若浏览器里已有该账号的有效 sid，则复用会话进 UI，跳过账密 / MFA。
 * @returns {Promise<null | { url, method, hostname, orgId, sessionId, tabId }>}
 */
export async function findReusableSessionForEnv(env) {
  const username = normUsername(env?.username)
  if (!username) return null

  const type = env?.type || 'production'
  const customUrl = env?.customUrl || ''
  const hintHost = normalizeSfHostname(env?.lastSfHostname || '')
  const hintOrgId = String(env?.lastSfOrgId || '').trim()
  const matchOpts = { username, hintOrgId, type, customUrl }

  const toBridge = async (candidate) => {
    if (!candidate?.sessionId || !candidate?.hostname) return null
    const alive = await isSessionAlive(candidate.hostname, candidate.sessionId)
    if (!alive) return null
    const currentUser = await fetchSessionUsername(candidate.hostname, candidate.sessionId)
    if (currentUser && !usernamesMatch(currentUser, username)) return null
    if (!currentUser && hintOrgId && !orgIdsMatch(candidate.orgId, hintOrgId)) return null
    const homeUrl = buildLoggedInHomeUrl(candidate.hostname)
    if (homeUrl) {
      return {
        url: homeUrl,
        method: 'direct-home',
        hostname: candidate.hostname,
        orgId: candidate.orgId,
        sessionId: candidate.sessionId
      }
    }
    const bridge = await buildUiBridgeUrl(candidate.hostname, candidate.sessionId)
    return { ...bridge, orgId: candidate.orgId, sessionId: candidate.sessionId }
  }

  // 1) 已打开的 Org 标签：会话有效则新开首页，不关闭、不切换旧标签
  const fromTabs = await discoverFromTabs()
  const tabHit = fromTabs.find((s) => sessionLooksReusable(s, matchOpts))
  if (tabHit) {
    const reused = await toBridge(packReusable(tabHit))
    if (reused) return reused
  }

  // 2) 快路径：上次登录记下的 host
  if (hintHost) {
    const session = await getSession(hintHost)
    if (session?.key) {
      const reused = await toBridge(packReusable({
        ...session,
        orgId: session.key.split('!')[0]
      }))
      if (reused) return reused
    }
  }

  // 3) 扫描浏览器里仍有效的 sid
  const sessions = await discoverSfSessions({ validate: true })
  const ranked = sessions
    .filter((s) => sessionLooksReusable(s, matchOpts))
    .map((s) => {
      let score = hostPreferenceScore(s.hostname)
      if (hintOrgId && orgIdsMatch(s.orgId, hintOrgId)) score += 100
      return { s, score }
    })
    .sort((a, b) => b.score - a.score)

  for (const { s } of ranked) {
    const reused = await toBridge(packReusable(s))
    if (reused) return reused
  }

  return null
}
