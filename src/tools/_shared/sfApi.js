/**
 * 窗口内 Salesforce REST 客户端（Cookie 会话路径）
 * session 由 Service Worker 提供，此处只负责 Bearer 调用
 */

export const SF_API_VERSION = '64.0'
const CLIENT_ID = 'Salesforce Quick Login SOQL'

/** 15 或 18 位 Salesforce Id，不允许空串、引号、空格或 SOQL 片段 */
const SF_RECORD_ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/
/** 单个对象 API 名，不允许斜杠、空格、引号 */
const SF_OBJECT_API_RE = /^[A-Za-z][A-Za-z0-9_]*$/
const SF_API_VERSION_RE = /^\d+\.\d+$/

export function isSalesforceId(value) {
  return SF_RECORD_ID_RE.test(String(value ?? '').trim())
}

export function isSalesforceObjectApi(value) {
  return SF_OBJECT_API_RE.test(String(value ?? '').trim())
}

/**
 * 只生成「删除这一条记录」的路径。
 * 对象名或 Id 缺了、短了、带了空格/引号/斜杠，直接抛错，不发请求。
 */
export function buildSingleRecordDeletePath(apiVersion, objectApiName, recordId) {
  const version = String(apiVersion ?? '').trim()
  const objectApi = String(objectApiName ?? '').trim()
  const id = String(recordId ?? '').trim()
  if (!SF_API_VERSION_RE.test(version) || !SF_OBJECT_API_RE.test(objectApi) || !SF_RECORD_ID_RE.test(id)) {
    const err = new Error('Invalid delete target')
    err.name = 'InvalidDeleteTarget'
    throw err
  }
  const path = `/services/data/v${version}/sobjects/${objectApi}/${id}`
  const parts = path.split('/')
  const singleRecord =
    parts.length === 7 &&
    parts[1] === 'services' &&
    parts[2] === 'data' &&
    parts[3] === `v${version}` &&
    parts[4] === 'sobjects' &&
    parts[5] === objectApi &&
    parts[6] === id &&
    !path.includes('?') &&
    !path.includes('&')
  if (!singleRecord) {
    const err = new Error('Invalid delete target')
    err.name = 'InvalidDeleteTarget'
    throw err
  }
  return path
}

export function normalizeSfHostname(host) {
  if (!host) return host
  return String(host)
    .replace(/^\./, '')
    .replace(/\.lightning\.force\./, '.my.salesforce.')
    .replace(/\.mcas\.ms$/, '')
}

export class SfRestClient {
  constructor({ hostname, sessionId, apiVersion = SF_API_VERSION } = {}) {
    this.hostname = normalizeSfHostname(hostname)
    this.sessionId = sessionId
    this.apiVersion = apiVersion
  }

  get baseUrl() {
    return `https://${this.hostname}`
  }

  async rest(path, { method = 'GET', body, headers = {}, signal } = {}) {
    if (!this.hostname) throw new Error('未设置 Salesforce 主机')
    if (!this.sessionId) throw new Error('无有效 Session，请重新选择已登录环境')

    const url = path.startsWith('http')
      ? path
      : new URL(path, this.baseUrl).toString()

    const init = {
      method,
      headers: {
        Accept: 'application/json; charset=UTF-8',
        Authorization: `Bearer ${this.sessionId}`,
        'Sforce-Call-Options': `client=${CLIENT_ID}`,
        ...headers
      }
    }
    if (signal) init.signal = signal
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json; charset=UTF-8'
      init.body = typeof body === 'string' ? body : JSON.stringify(body)
    }

    let res
    try {
      res = await fetch(url, init)
    } catch (e) {
      if (e?.name === 'AbortError') {
        const err = new Error('已取消')
        err.name = 'AbortError'
        throw err
      }
      const err = new Error('网络错误，离线或超时')
      err.name = 'SalesforceRestError'
      throw err
    }

    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }

    if (res.status >= 200 && res.status < 300) return data

    if (res.status === 401) {
      const err = new Error(
        Array.isArray(data) && data[0]?.message ? data[0].message : 'Session 已过期，请重新登录该 Org'
      )
      err.name = 'Unauthorized'
      throw err
    }

    let message = `HTTP ${res.status}`
    if (Array.isArray(data)) {
      message = data
        .map((d) => `${d.errorCode || ''}: ${d.message || ''}`.trim())
        .join('\n')
    } else if (data?.message) {
      message = data.message
    }
    const err = new Error(message)
    err.name = 'SalesforceRestError'
    err.detail = data
    throw err
  }

  getSObjects() {
    return this.rest(`/services/data/v${this.apiVersion}/sobjects/`)
  }

  describeSObject(name) {
    return this.rest(`/services/data/v${this.apiVersion}/sobjects/${encodeURIComponent(name)}/describe/`)
  }

  query(soql, { signal } = {}) {
    return this.rest(`/services/data/v${this.apiVersion}/query/?q=${encodeURIComponent(soql)}`, {
      signal
    })
  }

  queryMore(nextRecordsUrl, { signal } = {}) {
    if (!nextRecordsUrl) throw new Error('缺少 nextRecordsUrl')
    return this.rest(nextRecordsUrl, { signal })
  }

  /** SELECT COUNT() … 返回 totalSize */
  async countQuery(soql, { signal } = {}) {
    const data = await this.query(soql, { signal })
    return typeof data?.totalSize === 'number' ? data.totalSize : 0
  }

  /** 更新单条记录（PATCH） */
  updateSObject(objectApiName, recordId, fields) {
    return this.rest(
      `/services/data/v${this.apiVersion}/sobjects/${encodeURIComponent(objectApiName)}/${encodeURIComponent(recordId)}`,
      { method: 'PATCH', body: fields }
    )
  }

  /** 删除单条记录。路径不合法时抛 InvalidDeleteTarget，不会发出请求。 */
  deleteSObject(objectApiName, recordId) {
    const path = buildSingleRecordDeletePath(this.apiVersion, objectApiName, recordId)
    return this.rest(path, { method: 'DELETE' })
  }
}

/** 通过 background 列出已登录环境 */
export function listSfEnvironments() {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('非扩展环境'))
      return
    }
    chrome.runtime.sendMessage({ action: 'listSfEnvironments' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response || { success: false, error: '无响应', environments: [] })
    })
  })
}

/** 通过 background 按 hostname 取最新 sid */
export function fetchSfSession(hostname) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('非扩展环境'))
      return
    }
    chrome.runtime.sendMessage({ action: 'getSfSession', hostname }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response || { success: false, error: '无响应' })
    })
  })
}

/**
 * 根据页面 hostname / orgId 在已发现环境中挑选最匹配项
 * @returns {object|null}
 */
export function pickEnvForPage(envs, { hostname, orgId } = {}) {
  if (!Array.isArray(envs) || envs.length === 0) return null
  const oid = orgId ? String(orgId) : ''
  if (oid) {
    const byOrg = envs.find((e) => e.id === oid || e.orgId === oid)
    if (byOrg) return byOrg
  }
  const host = normalizeSfHostname(hostname || '')
  if (!host) return null
  const exact = envs.find((e) => normalizeSfHostname(e.hostname) === host)
  if (exact) return exact
  const prefix = host.split('.')[0]
  if (!prefix) return null
  return (
    envs.find((e) => {
      const h = normalizeSfHostname(e.hostname || '')
      return h === host || h.startsWith(prefix + '.')
    }) || null
  )
}

/** 从当前工具窗口 URL 读取页面环境偏好 */
export function readPageEnvPreferFromUrl(search = typeof location !== 'undefined' ? location.search : '') {
  try {
    const params = new URLSearchParams(search || '')
    return {
      hostname: params.get('hostname') || '',
      orgId: params.get('orgId') || ''
    }
  } catch {
    return { hostname: '', orgId: '' }
  }
}
