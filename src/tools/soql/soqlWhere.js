/** WHERE 条件：运算符、值控件类型、SOQL 片段拼接 */

const NULL_OPS = new Set(['= null', '!= null'])

export function valueKind(type) {
  const t = String(type || '')
  if (t === 'boolean') return 'boolean'
  if (t === 'picklist' || t === 'multipicklist' || t === 'combobox') return 'picklist'
  if (t === 'date') return 'date'
  if (t === 'datetime') return 'datetime'
  if (t === 'time') return 'time'
  if (t === 'int' || t === 'double' || t === 'currency' || t === 'percent' || t === 'long') return 'number'
  return 'string'
}

export function operatorsForKind(kind) {
  if (kind === 'boolean') return ['=', '!=']
  if (kind === 'picklist') return ['=', '!=', 'IN']
  if (kind === 'date' || kind === 'datetime' || kind === 'time' || kind === 'number') {
    return ['=', '!=', '>', '>=', '<', '<=', 'BETWEEN']
  }
  return ['=', '!=', 'LIKE', 'IN', '= null', '!= null']
}

export function defaultOperator() {
  return '='
}

export function needsValue(operator) {
  return !NULL_OPS.has(operator)
}

export function needsValue2(operator) {
  return operator === 'BETWEEN'
}

export function isMultiValue(operator) {
  return operator === 'IN'
}

export function activePicklistOptions(field) {
  return (field?.picklistValues || []).filter((p) => p && p.active !== false)
}

function escapeSoqlString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function quote(value) {
  return `'${escapeSoqlString(value)}'`
}

function splitList(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** datetime-local → SOQL datetime literal (no quotes) */
export function datetimeLocalToSoql(value) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return `${v}:00Z`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
    return v.endsWith('Z') ? v : `${v}Z`
  }
  return v
}

function formatAtom(kind, value) {
  if (value == null || value === '') return ''
  if (kind === 'boolean') return value === true || value === 'true' ? 'true' : 'false'
  if (kind === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? String(n) : ''
  }
  if (kind === 'date' || kind === 'time') return String(value)
  if (kind === 'datetime') return datetimeLocalToSoql(value)
  return quote(value)
}

function formatInList(kind, value) {
  const items = Array.isArray(value) ? value.filter((x) => x !== '' && x != null) : splitList(value)
  if (!items.length) return ''
  return items.map((item) => formatAtom(kind, item)).filter(Boolean).join(', ')
}

/** 单条条件 → SOQL 片段；无效则返回空串 */
export function formatCondition(cond, field) {
  if (!cond?.fieldApiName || !cond.operator) return ''
  const kind = valueKind(field?.type)
  const name = cond.fieldApiName
  const op = cond.operator

  if (op === '= null') return `${name} = null`
  if (op === '!= null') return `${name} != null`

  if (op === 'IN') {
    const list = formatInList(kind, cond.value)
    if (!list) return ''
    return `${name} IN (${list})`
  }

  if (op === 'BETWEEN') {
    const a = formatAtom(kind, cond.value)
    const b = formatAtom(kind, cond.value2)
    if (!a || !b) return ''
    return `${name} >= ${a} AND ${name} <= ${b}`
  }

  const atom = formatAtom(kind, cond.value)
  if (!atom) return ''
  if (op === 'LIKE') return `${name} LIKE ${atom}`
  return `${name} ${op} ${atom}`
}

export function buildWhereClause(conditions, fieldsMap) {
  const parts = []
  for (const cond of conditions || []) {
    const field = fieldsMap?.[cond.fieldApiName]
    const frag = formatCondition(cond, field)
    if (frag) parts.push(frag)
  }
  if (!parts.length) return ''
  return ` WHERE ${parts.join(' AND ')}`
}

export function nextConditionId(list) {
  const max = (list || []).reduce((m, c) => Math.max(m, Number(c.id) || 0), 0)
  return max + 1
}

/** 空值或 yyyy-mm-dd 才用 date 控件，TODAY 等字面量留在文本框 */
export function isDateInputValue(value) {
  const v = String(value ?? '')
  return v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)
}

/** 空值或 datetime-local（可带秒）才用 datetime-local 控件 */
export function isDatetimeLocalValue(value) {
  const v = String(value ?? '')
  return v === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)
}

export function isTimeInputValue(value) {
  const v = String(value ?? '')
  return v === '' || /^\d{2}:\d{2}/.test(v)
}
