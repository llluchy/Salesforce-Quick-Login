import { t } from '../../i18n'

/**
 * Salesforce Apex Debug Log 解析
 * 行格式：timestamp (elapsed_ns)|EVENT|...payload
 * 参考：https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_debugging_debug_log.htm
 */

const TIME_RE = /^\d{2}:\d{2}:\d{2}\.\d+\s*\(\d+\)/

/** @typedef {'debug'|'error'|'db'|'code'|'flow'|'callout'|'limit'|'system'|'other'|'header'} LogKind */

/**
 * @param {string} type
 * @returns {LogKind}
 */
export function classifyEvent(type) {
  const t = String(type || '').toUpperCase()
  if (!t) return 'other'
  if (
    t.includes('EXCEPTION') ||
    t.includes('FATAL') ||
    t.includes('ERROR') ||
    t === 'VALIDATION_FAIL'
  ) {
    return 'error'
  }
  if (t.includes('USER_DEBUG') || t === 'DEBUG') return 'debug'
  if (
    t.startsWith('SOQL_') ||
    t.startsWith('SOSL_') ||
    t.startsWith('DML_') ||
    t.includes('HEAP_DUMP')
  ) {
    return 'db'
  }
  if (t.startsWith('CALLOUT_') || t.includes('NAMED_CREDENTIAL')) {
    return 'callout'
  }
  if (
    t.startsWith('FLOW_') ||
    t.startsWith('WORKFLOW_') ||
    t.startsWith('VALIDATION_') ||
    t.startsWith('WF_')
  ) {
    return 'flow'
  }
  if (
    t.includes('LIMIT_USAGE') ||
    t.includes('CUMULATIVE_LIMIT') ||
    t.includes('CUMULATIVE_PROFILING')
  ) {
    return 'limit'
  }
  if (
    t.startsWith('CODE_UNIT_') ||
    t.startsWith('METHOD_') ||
    t.startsWith('CONSTRUCTOR_') ||
    t.startsWith('SYSTEM_METHOD_') ||
    t.startsWith('VARIABLE_') ||
    t.startsWith('STATEMENT_')
  ) {
    return 'code'
  }
  if (
    t.startsWith('EXECUTION_') ||
    t === 'USER_INFO' ||
    t.includes('TRACE_FLAG')
  ) {
    return 'system'
  }
  return 'other'
}

/**
 * @param {string} line
 * @param {number} index
 */
export function parseLogLine(line, index) {
  const raw = line ?? ''
  const parts = raw.split('|')
  if (parts.length >= 2 && TIME_RE.test(parts[0].trim())) {
    const time = parts[0].trim()
    const type = (parts[1] || '').trim()
    const content = parts.slice(2).join('|')
    return {
      index,
      time,
      type,
      content,
      kind: classifyEvent(type),
      raw,
      structured: true
    }
  }
  const isHeader =
    /^\d+(\.\d+)?\s+APEX_/i.test(raw.trim()) ||
    /^[A-Z_]+,[A-Z]+;/i.test(raw.trim())
  return {
    index,
    time: '',
    type: isHeader ? 'HEADER' : '',
    content: raw,
    kind: isHeader ? 'header' : 'other',
    raw,
    structured: false
  }
}

/**
 * @param {string} body
 */
export function parseApexLogBody(body) {
  const text = String(body || '')
  const lines = text.length ? text.split(/\r?\n/) : []
  const parsed = lines.map((line, i) => parseLogLine(line, i))

  const counts = {
    total: parsed.length,
    debug: 0,
    error: 0,
    db: 0,
    code: 0,
    flow: 0,
    callout: 0,
    limit: 0
  }
  for (const row of parsed) {
    if (counts[row.kind] != null) counts[row.kind] += 1
  }

  let apiVersion = ''
  let categories = []
  const headerLine = parsed.find((r) => r.kind === 'header')
  if (headerLine) {
    const m = headerLine.content.match(/^(\d+(?:\.\d+)?)\s+(.+)$/)
    if (m) {
      apiVersion = m[1]
      categories = m[2]
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const [name, level] = pair.split(',')
          return { name: name || pair, level: level || '' }
        })
    }
  }

  return { lines: parsed, counts, apiVersion, categories }
}

/**
 * @param {ReturnType<typeof parseLogLine>[]} lines
 * @param {string} filter  all|debug|error|db|code|flow|callout
 */
export function filterParsedLines(lines, filter) {
  if (!filter || filter === 'all') return lines
  if (filter === 'debug') {
    return lines.filter((l) => l.kind === 'debug' || /USER_DEBUG/i.test(l.type))
  }
  return lines.filter((l) => l.kind === filter)
}

/** @param {LogKind|string} kind */
export function getKindLabel(kind) {
  const key = `apexLog.kind.${kind}`
  const translated = t(key)
  return translated !== key ? translated : String(kind)
}

/** Localized display labels keyed by log kind (recomputed when locale changes). */
export function getKindLabels() {
  return {
    debug: getKindLabel('debug'),
    error: getKindLabel('error'),
    db: getKindLabel('db'),
    code: getKindLabel('code'),
    flow: getKindLabel('flow'),
    callout: getKindLabel('callout'),
    limit: getKindLabel('limit'),
    system: getKindLabel('system'),
    header: getKindLabel('header'),
    other: getKindLabel('other')
  }
}

/** @deprecated Use getKindLabel / getKindLabels */
export const KIND_LABELS = getKindLabels()
