/**
 * 对象详情里的字段元数据与标准页面链接。
 * 创建人 / 最后更新人来自 Tooling CustomField，不是记录上的 CreatedBy。
 * 只在当前页面使用，不写入扩展存储。
 */
import { isSalesforceApiHost, isSalesforceObjectApi, normalizeSfHostname } from '../_shared/sfApi.js'

const SAFE_TOKEN = /^[A-Za-z0-9_]{1,120}$/

function bareHostname(hostname) {
  let raw = String(hostname || '').trim()
  if (!raw) return ''
  raw = raw.replace(/^https?:\/\//i, '')
  raw = raw.split('/')[0].split('?')[0]
  raw = raw.replace(/:\d+$/, '')
  return normalizeSfHostname(raw)
}

export function toLightningHostname(hostname) {
  const host = String(bareHostname(hostname) || '').toLowerCase()
  if (!host || !isSalesforceApiHost(host)) return ''
  if (host === 'login.salesforce.com' || host === 'test.salesforce.com') return ''
  if (host.endsWith('.my.salesforce.com')) {
    return host.replace(/\.my\.salesforce\.com$/, '.lightning.force.com')
  }
  if (host.endsWith('.cloudforce.com')) {
    return host.replace(/\.cloudforce\.com$/, '.lightning.force.com')
  }
  if (host.endsWith('.lightning.force.com')) return host
  if (host.endsWith('.salesforce.com')) {
    return host.replace(/\.salesforce\.com$/, '.lightning.force.com')
  }
  return ''
}

export function buildObjectManagerUrl(hostname, objectApiName) {
  const host = toLightningHostname(hostname)
  const objectApi = String(objectApiName || '').trim()
  if (!host || !isSalesforceObjectApi(objectApi)) return ''
  return `https://${host}/lightning/setup/ObjectManager/${encodeURIComponent(objectApi)}/Details/view`
}

export function hasRecordId(recordId) {
  return String(recordId ?? '').trim() !== ''
}

export function buildRecordPageUrl(hostname, objectApiName, recordId) {
  const host = toLightningHostname(hostname)
  const objectApi = String(objectApiName || '').trim()
  const id = String(recordId ?? '').trim()
  if (!host || !isSalesforceObjectApi(objectApi) || !id) return ''
  return `https://${host}/lightning/r/${encodeURIComponent(objectApi)}/${encodeURIComponent(id)}/view`
}

function windowOpen(url) {
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(url, '_blank', 'noopener')
  }
}

export function openSalesforcePage(url) {
  if (!url) return
  const openTab = typeof chrome !== 'undefined' ? chrome.tabs?.create : null
  if (typeof openTab === 'function') {
    try {
      const maybe = openTab({ url })
      if (maybe && typeof maybe.catch === 'function') maybe.catch(() => windowOpen(url))
      return
    } catch {
      // 非扩展页面继续用 window.open
    }
  }
  windowOpen(url)
}

export function createObjectDetailLinks({ hostname, objectApiName, recordId, open } = {}) {
  const objectManagerUrl = buildObjectManagerUrl(hostname, objectApiName)
  const idPresent = hasRecordId(recordId)
  const recordPageUrl = idPresent ? buildRecordPageUrl(hostname, objectApiName, recordId) : ''
  const opener = typeof open === 'function' ? open : openSalesforcePage
  return {
    objectManagerUrl,
    objectManagerEnabled: Boolean(objectManagerUrl),
    recordEnabled: Boolean(idPresent && recordPageUrl),
    recordPageUrl,
    openObjectManager() {
      if (objectManagerUrl) opener(objectManagerUrl)
    },
    openRecord() {
      if (idPresent && recordPageUrl) opener(recordPageUrl)
    }
  }
}

function soqlQuote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function isCustomEntity(objectApi) {
  return String(objectApi || '').includes('__')
}

export function customFieldApiName(row) {
  const dev = String(row?.DeveloperName || '').trim().replace(/__c$/i, '')
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(dev)) return ''
  const ns = String(row?.NamespacePrefix || '').trim()
  if (ns && !/^[A-Za-z][A-Za-z0-9]*$/.test(ns)) return ''
  return ns ? `${ns}__${dev}__c` : `${dev}__c`
}

function userLabel(user, id) {
  const name = String(user?.Name || '').trim()
  if (name) return name
  return String(id || '').trim()
}

export function indexCustomFieldAudit(records) {
  const out = {}
  for (const row of records || []) {
    const api = customFieldApiName(row)
    if (!api) continue
    out[api.toLowerCase()] = {
      createdBy: userLabel(row?.CreatedBy, row?.CreatedById),
      updatedBy: userLabel(row?.LastModifiedBy, row?.LastModifiedById)
    }
  }
  return out
}

/** 只读字段元数据索引。字段对象上的 CreatedBy（记录创建人）不参与显示。 */
export function shownFieldAudit(field, auditIndex, unknown = '—') {
  const key = String(field?.name || '').trim().toLowerCase()
  const hit = key ? auditIndex?.[key] : null
  const blank = unknown || '—'
  return {
    createdBy: hit?.createdBy || blank,
    updatedBy: hit?.updatedBy || blank
  }
}

function toolingQueryPath(client, soql) {
  const version = client?.apiVersion || '64.0'
  return `/services/data/v${version}/tooling/query/?q=${encodeURIComponent(soql)}`
}

async function toolingQueryAll(client, soql) {
  const records = []
  const seen = new Set()
  let path = toolingQueryPath(client, soql)
  for (let page = 0; page < 20 && path; page += 1) {
    if (seen.has(path)) break
    seen.add(path)
    const data = await client.rest(path)
    if (Array.isArray(data?.records)) records.push(...data.records)
    path = data?.done === false && data?.nextRecordsUrl ? String(data.nextRecordsUrl) : ''
  }
  return records
}

async function customObjectTableId(client, objectApi) {
  const match = /^(?:([A-Za-z][A-Za-z0-9]*)__)?([A-Za-z][A-Za-z0-9_]*)__c$/.exec(objectApi)
  if (!match) return ''
  const ns = match[1] || ''
  const dev = match[2]
  if (!SAFE_TOKEN.test(dev) || (ns && !SAFE_TOKEN.test(ns))) return ''
  const nsClause = ns ? `NamespacePrefix = ${soqlQuote(ns)}` : 'NamespacePrefix = null'
  const soql = `SELECT Id FROM CustomObject WHERE DeveloperName = ${soqlQuote(dev)} AND ${nsClause} LIMIT 1`
  const records = await toolingQueryAll(client, soql)
  const id = String(records?.[0]?.Id || '').trim()
  return SAFE_TOKEN.test(id) ? id : ''
}

function looksLikeSalesforceId(value) {
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(String(value || ''))
}

async function resolveTableEnumOrId(client, objectApi) {
  let durable = ''
  let entityError = null
  try {
    const records = await toolingQueryAll(
      client,
      `SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = ${soqlQuote(objectApi)} LIMIT 1`
    )
    const id = String(records?.[0]?.DurableId || '').trim()
    if (SAFE_TOKEN.test(id)) durable = id
  } catch (error) {
    entityError = error
  }
  // 标准对象的 DurableId 就是 API 名；自定义对象要 01I Id 才能查 CustomField。
  if (durable && (!isCustomEntity(objectApi) || looksLikeSalesforceId(durable))) return durable
  const fallback = await customObjectTableId(client, objectApi).catch(() => '')
  if (fallback) return fallback
  if (durable) return durable
  if (entityError && isCustomEntity(objectApi)) throw entityError
  if (isCustomEntity(objectApi)) {
    const err = new Error('Missing custom entity id')
    err.name = 'FieldAuditError'
    throw err
  }
  return objectApi
}

async function queryCustomFieldRows(client, tableEnumOrId) {
  if (!SAFE_TOKEN.test(tableEnumOrId)) {
    const err = new Error('Invalid field audit target')
    err.name = 'FieldAuditError'
    throw err
  }
  const quoted = soqlQuote(tableEnumOrId)
  const rich = `SELECT DeveloperName, NamespacePrefix, CreatedBy.Name, LastModifiedBy.Name, CreatedById, LastModifiedById FROM CustomField WHERE TableEnumOrId = ${quoted}`
  try {
    return await toolingQueryAll(client, rich)
  } catch {
    const plain = `SELECT DeveloperName, NamespacePrefix, CreatedById, LastModifiedById FROM CustomField WHERE TableEnumOrId = ${quoted}`
    return toolingQueryAll(client, plain)
  }
}

export async function fetchFieldAuditMap(client, objectApiName) {
  const objectApi = String(objectApiName || '').trim()
  if (!isSalesforceObjectApi(objectApi)) return {}
  const tableId = await resolveTableEnumOrId(client, objectApi)
  const rows = await queryCustomFieldRows(client, tableId)
  return indexCustomFieldAudit(rows)
}
