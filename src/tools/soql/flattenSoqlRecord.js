/**
 * 只拆带 attributes 的关联记录（以及子查询里的记录）。
 * Address 这类没有 attributes 的复合字段保持为一个对象。
 * 根上的 attributes 留着，供打开记录详情，不作为结果列。
 */

/**
 * @param {object} record
 * @returns {object}
 */
export function flattenSoqlRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record
  const out = {}
  if (record.attributes) out.attributes = record.attributes
  writeFlat(record, '', out)
  return out
}

/**
 * @param {unknown} value
 * @param {string} prefix
 * @param {Record<string, unknown>} out
 */
function writeFlat(value, prefix, out) {
  if (value == null) {
    if (prefix) out[prefix] = null
    return
  }
  if (typeof value !== 'object') {
    if (prefix) out[prefix] = value
    return
  }
  if (Array.isArray(value)) {
    if (prefix) out[prefix] = value.map(joinItem).join('; ')
    return
  }
  if (Array.isArray(value.records)) {
    writeSubquery(value.records, prefix, out)
    return
  }
  if (!isRelatedRecord(value)) {
    if (prefix) out[prefix] = value
    return
  }
  const keys = Object.keys(value).filter((key) => key !== 'attributes')
  if (!keys.length) {
    if (prefix) out[prefix] = ''
    return
  }
  for (const key of keys) {
    writeFlat(value[key], prefix ? `${prefix}.${key}` : key, out)
  }
}

function isRelatedRecord(value) {
  return !!value.attributes && typeof value.attributes === 'object'
}

/**
 * 子查询多行时，同一父记录上把各子记录的字段用 | 拼成一格。
 * @param {object[]} records
 * @param {string} prefix
 * @param {Record<string, unknown>} out
 */
function writeSubquery(records, prefix, out) {
  /** @type {Map<string, unknown[]>} */
  const grouped = new Map()
  const order = []
  for (const rec of records || []) {
    const flat = {}
    writeFlat(rec, '', flat)
    for (const [key, val] of Object.entries(flat)) {
      if (key === 'attributes') continue
      const path = prefix ? `${prefix}.${key}` : key
      if (!grouped.has(path)) {
        grouped.set(path, [])
        order.push(path)
      }
      grouped.get(path).push(val)
    }
  }
  for (const path of order) {
    const values = grouped.get(path) || []
    out[path] = values.length === 1 ? values[0] : values.map(joinItem).join(' | ')
  }
}

function joinItem(value) {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
