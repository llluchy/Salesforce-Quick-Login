/**
 * Apex Log 工具 · Service Worker 侧逻辑
 * 会话发现统一走 tools/_shared/sfSessionBg（与 SOQL / Soql Creator 对齐）
 * 消息 action 统一前缀 apexLog:
 * 注意：关窗不清会话
 */

import {
  discoverSfSessions,
  extractSessionFromTab,
  getSession,
  normalizeSfHostname
} from '../_shared/sfSessionBg.js'
import {
  TRACE_ALARM_NAME,
  TRACE_DURATION_MINUTES,
  TRACE_LEASE_KEY,
  apexLogWindowIsOpen,
  applyTraceAlarm,
  applyTraceUnwatch,
  applyTraceWatch,
  earliestExpiration,
  rearmTraceRenewFromLease,
  writeTraceLease
} from './traceRenew.js'

const API_VERSION = 'v59.0'
const STORAGE_KEY_ENVS = 'sfql_apex_environments'
const STORAGE_KEY_ACTIVE = 'sfql_apex_active_env'
const STORAGE_KEY_TRACKED = 'sfql_apex_tracked_users'

/** @type {Record<string, any>} */
let environments = {}
/** @type {string|null} */
let activeEnvId = null
/** @type {Record<string, Array<{id:string,name:string,username?:string,email?:string}>>} */
let trackedUsersByEnv = {}
let pollingTimer = null

function escapeSoql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function saveState() {
  const payload = {
    [STORAGE_KEY_ENVS]: environments,
    [STORAGE_KEY_ACTIVE]: activeEnvId,
    [STORAGE_KEY_TRACKED]: trackedUsersByEnv
  }
  await chrome.storage.session.set(payload).catch(async () => {
    await chrome.storage.local.set(payload)
  })
}

async function loadState() {
  try {
    const keys = [STORAGE_KEY_ENVS, STORAGE_KEY_ACTIVE, STORAGE_KEY_TRACKED]
    let data = await chrome.storage.session.get(keys)
    if (!data?.[STORAGE_KEY_ENVS]) {
      data = await chrome.storage.local.get(keys)
    }
    environments = data[STORAGE_KEY_ENVS] || {}
    activeEnvId = data[STORAGE_KEY_ACTIVE] || null
    trackedUsersByEnv = data[STORAGE_KEY_TRACKED] || {}
  } catch (e) {
    environments = {}
    activeEnvId = null
    trackedUsersByEnv = {}
  }
}

function getTrackedUsers(envId) {
  return trackedUsersByEnv[envId] || []
}

function upsertTrackedUser(envId, user) {
  if (!envId || !user?.id) return getTrackedUsers(envId)
  const list = [...getTrackedUsers(envId)]
  const idx = list.findIndex((u) => u.id === user.id)
  const next = {
    id: user.id,
    name: user.name || user.Name || user.id,
    username: user.username || user.Username || '',
    email: user.email || user.Email || ''
  }
  if (idx >= 0) list[idx] = { ...list[idx], ...next }
  else list.push(next)
  trackedUsersByEnv[envId] = list
  return list
}

async function discoverAllSalesforceTabs() {
  const list = await discoverSfSessions()
  const next = {}
  for (const env of list) {
    const prev = environments[env.id]
    next[env.id] = {
      id: env.id,
      orgId: env.orgId,
      name: env.name || env.label,
      sessionId: env.sessionId,
      instanceUrl: env.instanceUrl,
      hostname: env.hostname,
      connectedAt: env.connectedAt || Date.now(),
      userName: prev?.userName,
      sessionExpired: false
    }
  }
  environments = next
  if (activeEnvId && !environments[activeEnvId]) {
    activeEnvId = null
  }
  await saveState()
  return Object.values(environments)
}

async function makeApiRequestForEnv(envId, endpoint, options = {}) {
  const env = environments[envId]
  if (!env) throw new Error('No active environment')

  const url = env.instanceUrl + endpoint
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.sessionId}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })

  if (response.status === 401) {
    environments[envId].sessionExpired = true
    await saveState()
    const refreshed = await tryRefreshSession(envId)
    if (refreshed) return makeApiRequestForEnv(envId, endpoint, options)
    throw new Error('Session expired')
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API ${response.status}: ${errorText.slice(0, 200)}`)
  }

  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function tryRefreshSession(envId) {
  try {
    const env = environments[envId]
    if (!env) return false

    // 优先按 hostname 重新读 Cookie（与 SOQL getSfSession 同路径）
    const host = normalizeSfHostname(env.hostname || '')
    if (host) {
      const session = await getSession(host)
      if (session?.key) {
        environments[envId] = {
          ...environments[envId],
          sessionId: session.key,
          hostname: session.hostname,
          instanceUrl: `https://${session.hostname}`,
          sessionExpired: false,
          connectedAt: Date.now()
        }
        await saveState()
        return true
      }
    }

    const sessions = await discoverSfSessions()
    const match = sessions.find((s) => s.id === envId || s.orgId === envId)
    if (match?.sessionId) {
      environments[envId] = {
        ...environments[envId],
        sessionId: match.sessionId,
        hostname: match.hostname,
        instanceUrl: match.instanceUrl,
        sessionExpired: false,
        connectedAt: Date.now()
      }
      await saveState()
      return true
    }

    // 标签页兜底
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (!tab.url) continue
      const session = await extractSessionFromTab(tab.id)
      if (!session) continue
      if (session.id === envId || session.orgId === envId) {
        environments[envId] = {
          ...environments[envId],
          sessionId: session.sessionId,
          hostname: session.hostname,
          instanceUrl: session.instanceUrl,
          sessionExpired: false,
          connectedAt: Date.now()
        }
        await saveState()
        return true
      }
    }
  } catch (_) { /* ignore */ }
  return false
}

async function fetchCurrentUserName(envId) {
  try {
    const result = await makeApiRequestForEnv(
      envId,
      `/services/data/${API_VERSION}/chatter/users/me`
    )
    return result?.displayName || result?.name || null
  } catch {
    return null
  }
}

async function getOrCreateDebugLevel(envId) {
  const soql = encodeURIComponent(
    "SELECT Id, DeveloperName FROM DebugLevel WHERE DeveloperName = 'SFQL_ApexLog' LIMIT 1"
  )
  const queryResult = await makeApiRequestForEnv(
    envId,
    `/services/data/${API_VERSION}/tooling/query/?q=${soql}`
  )
  if (queryResult?.records?.length) return queryResult.records[0].Id

  const createResult = await makeApiRequestForEnv(
    envId,
    `/services/data/${API_VERSION}/tooling/sobjects/DebugLevel`,
    {
      method: 'POST',
      body: JSON.stringify({
        DeveloperName: 'SFQL_ApexLog',
        MasterLabel: 'SFQL Apex Log',
        ApexCode: 'FINEST',
        ApexProfiling: 'FINEST',
        Callout: 'FINEST',
        Database: 'FINEST',
        System: 'DEBUG',
        Validation: 'INFO',
        Visualforce: 'INFO',
        Workflow: 'INFO'
      })
    }
  )
  return createResult?.id || null
}

async function createOrRenewTraceFlagForUser(envId, userId, durationMinutes = TRACE_DURATION_MINUTES) {
  if (!userId) throw new Error('缺少用户 Id')
  const debugLevelId = await getOrCreateDebugLevel(envId)
  if (!debugLevelId) throw new Error('无法创建 DebugLevel')

  const expiresAt = Date.now() + durationMinutes * 60 * 1000
  const expiration = new Date(expiresAt).toISOString()
  const start = new Date().toISOString()
  const soql = encodeURIComponent(
    `SELECT Id, DebugLevelId FROM TraceFlag WHERE TracedEntityId = '${escapeSoql(userId)}' LIMIT 1`
  )
  const existing = await makeApiRequestForEnv(
    envId,
    `/services/data/${API_VERSION}/tooling/query/?q=${soql}`
  )

  if (existing?.records?.length) {
    const existingId = existing.records[0].Id
    await makeApiRequestForEnv(
      envId,
      `/services/data/${API_VERSION}/tooling/sobjects/TraceFlag/${existingId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          DebugLevelId: debugLevelId,
          ExpirationDate: expiration,
          StartDate: start
        })
      }
    )
    return { success: true, renewed: true, userId, debugLevelId, traceFlagId: existingId, expiresAt }
  }

  const createResult = await makeApiRequestForEnv(
    envId,
    `/services/data/${API_VERSION}/tooling/sobjects/TraceFlag`,
    {
      method: 'POST',
      body: JSON.stringify({
        TracedEntityId: userId,
        DebugLevelId: debugLevelId,
        LogType: 'USER_DEBUG',
        StartDate: start,
        ExpirationDate: expiration
      })
    }
  )
  const traceFlagId = createResult?.id || null
  if (!traceFlagId) throw new Error('无法创建 TraceFlag')
  return { success: true, created: true, userId, debugLevelId, traceFlagId, expiresAt }
}

async function createTraceFlag(envId, debugLevelId, durationMinutes = TRACE_DURATION_MINUTES) {
  const userInfo = await makeApiRequestForEnv(
    envId,
    `/services/data/${API_VERSION}/chatter/users/me`
  )
  const userId = userInfo?.id
  if (!userId) throw new Error('无法获取当前用户')
  // debugLevelId 参数保留兼容；内部会再取/建
  return createOrRenewTraceFlagForUser(envId, userId, durationMinutes)
}

async function enableDebugLogging(envId, durationMinutes = TRACE_DURATION_MINUTES) {
  try {
    const debugLevelId = await getOrCreateDebugLevel(envId)
    if (!debugLevelId) return { success: false, error: '无法创建 DebugLevel' }
    const created = await createTraceFlag(envId, debugLevelId, durationMinutes)
    if (!created?.traceFlagId) return { success: false, error: '无法创建 TraceFlag' }

    const written = []
    if (Number.isFinite(created.expiresAt)) written.push(created.expiresAt)
    // 同步续期本环境已追踪的自定义用户
    const tracked = getTrackedUsers(envId)
    const extras = []
    for (const u of tracked) {
      try {
        const extra = await createOrRenewTraceFlagForUser(envId, u.id, durationMinutes)
        extras.push(extra)
        if (Number.isFinite(extra.expiresAt)) written.push(extra.expiresAt)
      } catch (e) {
        extras.push({ success: false, userId: u.id, error: e.message || String(e) })
      }
    }
    const finite = written.filter((n) => Number.isFinite(n))
    const expiresAt = finite.length ? Math.min(...finite) : Date.now() + durationMinutes * 60 * 1000
    return {
      success: true,
      debugLevelId,
      traceFlagId: created.traceFlagId,
      tracked: extras,
      expiresAt
    }
  } catch (e) {
    return { success: false, error: e.message || String(e) }
  }
}

async function fetchApexLogs(limit = 100) {
  if (!activeEnvId) throw new Error('No active environment')
  const soql = `
    SELECT Id, Status, Request, Operation, Application,
           StartTime, Location, LogUserId, LogUser.Name,
           DurationMilliseconds, LogLength
    FROM ApexLog
    ORDER BY StartTime DESC, Id DESC
    LIMIT ${limit}
  `.replace(/\s+/g, ' ').trim()

  return makeApiRequestForEnv(
    activeEnvId,
    `/services/data/${API_VERSION}/query/?q=${encodeURIComponent(soql)}`
  )
}

async function fetchLogBody(logId) {
  if (!activeEnvId) throw new Error('No active environment')
  const env = environments[activeEnvId]
  const url = `${env.instanceUrl}/services/data/${API_VERSION}/sobjects/ApexLog/${logId}/Body`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.sessionId}` }
  })
  if (response.status === 401) {
    environments[activeEnvId].sessionExpired = true
    await saveState()
    throw new Error('Session expired')
  }
  if (!response.ok) throw new Error(`获取日志正文失败: ${response.status}`)
  return await response.text()
}

async function getProcessAutomatedUserId(envId) {
  const soql = encodeURIComponent(
    "SELECT Id, Name, Username, Email FROM User WHERE Name = 'Process Automated' LIMIT 1"
  )
  const result = await makeApiRequestForEnv(
    envId,
    `/services/data/${API_VERSION}/query/?q=${soql}`
  )
  return result?.records?.[0] || null
}

async function trackProcessAutomated(envId, durationMinutes = 60) {
  const user = await getProcessAutomatedUserId(envId)
  if (!user?.Id) return { success: false, error: '未找到 Process Automated 用户' }
  const result = await createOrRenewTraceFlagForUser(envId, user.Id, durationMinutes)
  const tracked = upsertTrackedUser(envId, {
    id: user.Id,
    name: user.Name || 'Process Automated',
    username: user.Username,
    email: user.Email
  })
  await saveState()
  return { ...result, trackedUsers: tracked }
}

/**
 * 按可用字段检索 User（LIKE 模糊）
 * filters: { name, email, username, alias, firstName, lastName, isActive }
 */
async function searchUsers(envId, filters = {}, limit = 40) {
  if (!envId) throw new Error('无活动环境')
  const clauses = []
  const addLike = (field, value) => {
    const v = String(value || '').trim()
    if (!v) return
    clauses.push(`${field} LIKE '%${escapeSoql(v)}%'`)
  }
  addLike('Name', filters.name)
  addLike('Email', filters.email)
  addLike('Username', filters.username)
  addLike('Alias', filters.alias)
  addLike('FirstName', filters.firstName)
  addLike('LastName', filters.lastName)

  if (filters.isActive === true || filters.isActive === 'true') {
    clauses.push('IsActive = true')
  } else if (filters.isActive === false || filters.isActive === 'false') {
    clauses.push('IsActive = false')
  }

  if (!clauses.length) {
    throw new Error('请至少填写一个检索条件')
  }

  const soql = `
    SELECT Id, Name, Username, Email, Alias, FirstName, LastName,
           IsActive, UserType, Profile.Name
    FROM User
    WHERE ${clauses.join(' AND ')}
    ORDER BY Name
    LIMIT ${Math.min(Math.max(Number(limit) || 40, 1), 100)}
  `.replace(/\s+/g, ' ').trim()

  const result = await makeApiRequestForEnv(
    envId,
    `/services/data/${API_VERSION}/query/?q=${encodeURIComponent(soql)}`
  )
  return (result?.records || []).map((r) => ({
    id: r.Id,
    name: r.Name,
    username: r.Username,
    email: r.Email,
    alias: r.Alias,
    firstName: r.FirstName,
    lastName: r.LastName,
    isActive: r.IsActive,
    userType: r.UserType,
    profileName: r.Profile?.Name || ''
  }))
}

async function trackCustomUser(envId, user, durationMinutes = TRACE_DURATION_MINUTES) {
  if (!user?.id) return { success: false, error: '请选择用户' }
  const result = await createOrRenewTraceFlagForUser(envId, user.id, durationMinutes)
  const tracked = upsertTrackedUser(envId, user)
  await saveState()
  return { ...result, trackedUsers: tracked, user: tracked.find((u) => u.id === user.id) }
}

let memoryTraceLease = null

async function loadTraceLease() {
  try {
    const data = await chrome.storage.session.get(TRACE_LEASE_KEY)
    memoryTraceLease = data?.[TRACE_LEASE_KEY] || null
    return memoryTraceLease
  } catch {
    return memoryTraceLease
  }
}

async function saveTraceLease(lease) {
  memoryTraceLease = lease
  try {
    await writeTraceLease({ session: chrome.storage.session }, lease)
  } catch (e) {
    console.warn('[ApexLog] 跟踪续期只留在本机内存', e?.message || e)
  }
}

async function queryApexLogTabs() {
  try {
    return await chrome.tabs.query({})
  } catch {
    return []
  }
}

async function readTraceExpiration(envId) {
  const me = await makeApiRequestForEnv(
    envId,
    `/services/data/${API_VERSION}/chatter/users/me`
  )
  const ids = []
  if (me?.id) ids.push(me.id)
  for (const user of getTrackedUsers(envId)) {
    if (user?.id && !ids.includes(user.id)) ids.push(user.id)
  }
  if (!ids.length) return null
  const list = ids.map((id) => `'${escapeSoql(id)}'`).join(',')
  const soql = encodeURIComponent(
    `SELECT ExpirationDate FROM TraceFlag WHERE TracedEntityId IN (${list})`
  )
  const result = await makeApiRequestForEnv(
    envId,
    `/services/data/${API_VERSION}/tooling/query/?q=${soql}`
  )
  return earliestExpiration((result?.records || []).map((row) => row.ExpirationDate))
}

async function renewEnvTrace(envId) {
  const result = await enableDebugLogging(envId, TRACE_DURATION_MINUTES)
  if (!result?.success) throw new Error(result?.error || '续期失败')
  return { expiresAt: result.expiresAt }
}

function scheduleTraceAlarm(whenMs) {
  if (!chrome.alarms?.create) return
  const when = Math.max(Number(whenMs) || 0, Date.now() + 500)
  return chrome.alarms.create(TRACE_ALARM_NAME, { when })
}

function clearTraceAlarm() {
  if (!chrome.alarms?.clear) return
  return chrome.alarms.clear(TRACE_ALARM_NAME)
}

function publishTraceStatus(result) {
  if (!result || !chrome.runtime?.sendMessage) return
  chrome.runtime.sendMessage({
    action: 'apexLog:traceStatus',
    phase: result.phase || result.action,
    envId: result.envId || '',
    expiresAt: result.expiresAt || null,
    renewAt: result.renewAt || null,
    error: result.error || ''
  }).catch(() => {})
}

function tracePorts(now = Date.now()) {
  return {
    now,
    loadLease: loadTraceLease,
    saveLease: saveTraceLease,
    readExpiration: readTraceExpiration,
    renew: renewEnvTrace,
    scheduleAlarm: scheduleTraceAlarm,
    clearAlarm: clearTraceAlarm
  }
}

let traceAlarmTask = null

async function handleTraceAlarm() {
  if (traceAlarmTask) return traceAlarmTask
  traceAlarmTask = (async () => {
    try {
      await loadState()
      const tabs = await queryApexLogTabs()
      const result = await applyTraceAlarm({
        ...tracePorts(),
        windowOpen: apexLogWindowIsOpen(tabs)
      })
      publishTraceStatus(result)
      return result
    } finally {
      traceAlarmTask = null
    }
  })()
  return traceAlarmTask
}

async function rearmTraceRenewAlarm() {
  if (!chrome.alarms?.get) return
  const tabs = await queryApexLogTabs()
  await rearmTraceRenewFromLease({
    now: Date.now(),
    windowOpen: apexLogWindowIsOpen(tabs),
    loadLease: loadTraceLease,
    saveLease: saveTraceLease,
    clearAlarm: clearTraceAlarm,
    scheduleAlarm: scheduleTraceAlarm,
    alarmPending: async () => !!(await chrome.alarms.get(TRACE_ALARM_NAME)),
    runDue: handleTraceAlarm
  })
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

/**
 * @returns {boolean} true 表示已处理该消息
 */
export function handleApexLogMessage(message, sender, sendResponse) {
  const action = message?.action
  if (!action || !String(action).startsWith('apexLog:')) return false

  ;(async () => {
    try {
      switch (action) {
        case 'apexLog:discover': {
          const list = await discoverAllSalesforceTabs()
          sendResponse({ success: true, environments: list, activeEnvId })
          break
        }
        case 'apexLog:getState': {
          await loadState()
          sendResponse({
            success: true,
            environments: Object.values(environments),
            activeEnvId,
            trackedUsers: activeEnvId ? getTrackedUsers(activeEnvId) : []
          })
          break
        }
        case 'apexLog:switchEnv': {
          const envId = message.envId
          if (!envId || !environments[envId]) {
            sendResponse({ success: false, error: '环境不存在' })
            break
          }
          activeEnvId = envId
          environments[envId].sessionExpired = false
          const userName = await fetchCurrentUserName(envId)
          if (userName) environments[envId].userName = userName
          try {
            await enableDebugLogging(envId)
          } catch (e) {
            console.warn('[ApexLog] TraceFlag 失败', e.message)
          }
          await saveState()
          sendResponse({
            success: true,
            activeEnvId,
            userName: environments[envId].userName,
            environments: Object.values(environments),
            trackedUsers: getTrackedUsers(envId)
          })
          break
        }
        case 'apexLog:fetchLogs': {
          const data = await fetchApexLogs(message.limit || 100)
          sendResponse({ success: true, data })
          break
        }
        case 'apexLog:fetchLogBody': {
          const body = await fetchLogBody(message.logId)
          sendResponse({ success: true, body })
          break
        }
        case 'apexLog:renewTraceFlag': {
          if (!activeEnvId) {
            sendResponse({ success: false, error: '无活动环境' })
            break
          }
          await loadState()
          const result = await enableDebugLogging(activeEnvId, message.durationMinutes || TRACE_DURATION_MINUTES)
          sendResponse(result)
          break
        }
        case 'apexLog:traceWatch': {
          await loadState()
          const envId = message.envId || activeEnvId
          if (!envId || !environments[envId]) {
            sendResponse({ success: false, phase: 'error', error: '无活动环境' })
            break
          }
          const result = await applyTraceWatch({
            ...tracePorts(),
            envId,
            viewerId: message.viewerId
          })
          sendResponse(result)
          break
        }
        case 'apexLog:traceUnwatch': {
          const result = await applyTraceUnwatch({
            viewerId: message.viewerId,
            loadLease: loadTraceLease,
            saveLease: saveTraceLease,
            clearAlarm: clearTraceAlarm
          })
          sendResponse(result)
          break
        }
        case 'apexLog:trackProcessAutomated': {
          const envId = message.envId || activeEnvId
          if (!envId) {
            sendResponse({ success: false, error: '无活动环境' })
            break
          }
          await loadState()
          const result = await trackProcessAutomated(envId, message.durationMinutes || 60)
          sendResponse({
            ...result,
            trackedUsers: getTrackedUsers(envId)
          })
          break
        }
        case 'apexLog:searchUsers': {
          const envId = message.envId || activeEnvId
          if (!envId) {
            sendResponse({ success: false, error: '无活动环境' })
            break
          }
          await loadState()
          const users = await searchUsers(envId, message.filters || {}, message.limit || 40)
          sendResponse({ success: true, users })
          break
        }
        case 'apexLog:trackUser': {
          const envId = message.envId || activeEnvId
          if (!envId) {
            sendResponse({ success: false, error: '无活动环境' })
            break
          }
          await loadState()
          // 仅同步追踪列表；TraceFlag 可由窗口侧已创建
          if (message.user?.id && message.skipTraceFlag) {
            const tracked = upsertTrackedUser(envId, message.user)
            await saveState()
            sendResponse({ success: true, trackedUsers: tracked })
            break
          }
          const result = await trackCustomUser(
            envId,
            message.user,
            message.durationMinutes || 60
          )
          sendResponse({
            ...result,
            trackedUsers: getTrackedUsers(envId)
          })
          break
        }
        case 'apexLog:startPolling': {
          stopPolling()
          const interval = message.intervalMs || 3000
          pollingTimer = setInterval(() => {
            chrome.runtime.sendMessage({ action: 'apexLog:pollingTick' }).catch(() => {})
          }, interval)
          sendResponse({ success: true })
          break
        }
        case 'apexLog:stopPolling': {
          stopPolling()
          sendResponse({ success: true })
          break
        }
        default:
          sendResponse({ success: false, error: '未知 apexLog action: ' + action })
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message || String(e) })
    }
  })()

  return true
}

export async function initApexLogBackground() {
  await loadState()
  await rearmTraceRenewAlarm()
}

if (typeof chrome !== 'undefined' && chrome.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== TRACE_ALARM_NAME) return
    handleTraceAlarm().catch((e) => console.warn('[ApexLog] 自动续期失败', e?.message || e))
  })
}
