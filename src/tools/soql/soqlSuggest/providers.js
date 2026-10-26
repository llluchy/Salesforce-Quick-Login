import { activePicklistOptions, operatorsForKind, valueKind } from '../soqlWhere.js'
import { SELECT_FUNCTIONS, keywordMatchesPrefix, keywordsByNames } from './keywords.js'
import { rankFuzzy } from './rankFuzzy.js'

/**
 * @typedef {{ name: string, label: string, kind: string, insertText?: string, [k: string]: any }} SuggestItem
 */

/**
 * @param {string} prefix
 * @param {string[]} keywordNames
 * @returns {SuggestItem[]}
 */
export function provideKeywordSuggestions(prefix, keywordNames) {
  return keywordsByNames(keywordNames)
    .filter((k) => keywordMatchesPrefix(prefix, k.name))
    .map((k) => ({
      name: k.name,
      label: k.label,
      kind: 'keyword',
      insertText: k.insertText
    }))
}

/**
 * FROM 对象列表。
 * @param {string} prefix
 * @param {Array<{ name: string, label?: string }>} objects
 * @returns {SuggestItem[]}
 */
export function provideObjectSuggestions(prefix, objects) {
  return rankFuzzy(objects || [], prefix, (o) => ({
    name: o.name,
    label: o.label || o.name
  })).map((o) => ({
    name: o.name,
    label: o.label,
    kind: 'object',
    // 保留原始对象引用供 hydrate（去掉打分字段）
    _obj: { name: o.name, label: o.label, custom: o.custom }
  }))
}

/**
 * SELECT 字段列表（需已 describe）。
 * @param {string} prefix
 * @param {Record<string, { name: string, label?: string, type?: string }>} fieldsMap
 * @returns {SuggestItem[]}
 */
export function provideFieldSuggestions(prefix, fieldsMap) {
  const fields = Object.values(fieldsMap || {})
  return rankFuzzy(fields, prefix, (f) => ({
    name: f.name,
    label: f.label || f.name
  }))    .map((f) => ({
    name: f.name,
    label: f.label || f.name,
    kind: 'field',
    type: f.type
  }))
}

/**
 * 父关系名（Account、Custom__r）。
 * @param {string} prefix
 * @param {Record<string, any>} fieldsMap
 */
export function provideRelationshipSuggestions(prefix, fieldsMap) {
  const rels = Object.values(fieldsMap || {}).filter((field) => field.relationshipName)
  return rankFuzzy(rels, prefix, (field) => ({
    name: field.relationshipName,
    label: field.label || field.relationshipName
  })).map((field) => ({
    name: field.relationshipName,
    label: (field.referenceTo || []).join(', ') || field.label || field.relationshipName,
    kind: 'relationship',
    insertText: field.relationshipName
  }))
}

/**
 * 子查询 FROM 的子关系名。
 * @param {string} prefix
 * @param {Array<{ name: string, label?: string, childSObject?: string }>} children
 */
export function provideChildSuggestions(prefix, children) {
  return rankFuzzy(children || [], prefix, (rel) => ({
    name: rel.name,
    label: rel.childSObject || rel.label || rel.name
  })).map((rel) => ({
    name: rel.name,
    label: rel.childSObject || rel.label || rel.name,
    kind: 'child',
    insertText: rel.name
  }))
}

/**
 * @param {string} prefix
 */
export function provideFunctionSuggestions(prefix) {
  const q = String(prefix || '').toLowerCase().replace(/[()]/g, '')
  if (!q) return []
  return SELECT_FUNCTIONS.filter((fn) => {
    const name = fn.name.toLowerCase().replace(/[()]/g, '')
    return name.startsWith(q) || name.includes(q)
  }).map((fn) => ({
    name: fn.name,
    label: 'function',
    kind: 'function',
    insertText: fn.insertText
  }))
}

/**
 * WHERE 运算符（与 soqlWhere.operatorsForKind 对齐）。
 * @param {string} prefix
 * @param {string} [fieldType]
 * @returns {SuggestItem[]}
 */
export function provideOperatorSuggestions(prefix, fieldType) {
  const kind = valueKind(fieldType)
  const ops = operatorsForKind(kind)
  const q = String(prefix || '').toLowerCase().trim()
  return ops
    .filter((op) => {
      if (!q) return true
      const o = op.toLowerCase()
      return o.startsWith(q) || o.includes(q) || o.replace(/\s+/g, '').startsWith(q.replace(/\s+/g, ''))
    })
    .map((op) => {
      let insertText = op
      if (op === 'IN') insertText = 'IN ('
      else if (op === 'BETWEEN') insertText = 'BETWEEN '
      else if (op === 'LIKE') insertText = 'LIKE '
      else if (op === '= null' || op === '!= null') insertText = `${op} `
      else insertText = `${op} `
      return {
        name: op,
        label: kind,
        kind: 'operator',
        insertText
      }
    })
}

/** SOQL 承认的日期字面量（无引号） */
const SOQL_DATE_LITERALS = [
  'TODAY',
  'YESTERDAY',
  'TOMORROW',
  'THIS_WEEK',
  'LAST_WEEK',
  'NEXT_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'NEXT_MONTH',
  'THIS_YEAR',
  'LAST_YEAR',
  'NEXT_YEAR'
]

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** @returns {{ date: string, datetime: string }} UTC 参考格式 */
function soqlDateTimeSamples(now = new Date()) {
  const y = now.getUTCFullYear()
  const m = pad2(now.getUTCMonth() + 1)
  const d = pad2(now.getUTCDate())
  const date = `${y}-${m}-${d}`
  const datetime = `${date}T00:00:00Z`
  return { date, datetime }
}

/**
 * WHERE 值：boolean / picklist / date / datetime。
 * @param {string} prefix
 * @param {object|null|undefined} field
 * @param {{ inString?: boolean }} [opts]
 * @returns {SuggestItem[]}
 */
export function provideValueSuggestions(prefix, field, opts = {}) {
  const inString = !!opts.inString
  const kind = valueKind(field?.type)
  const q = String(prefix || '').toLowerCase()

  if (kind === 'boolean') {
    return ['true', 'false']
      .filter((v) => !q || v.startsWith(q))
      .map((v) => ({
        name: v,
        label: 'boolean',
        kind: 'value',
        insertText: inString ? v : `${v} `
      }))
  }

  if (kind === 'picklist') {
    const optsList = activePicklistOptions(field)
    return optsList
      .filter((p) => {
        const val = String(p.value ?? '')
        const lab = String(p.label || val)
        if (!q) return true
        return (
          val.toLowerCase().includes(q) ||
          lab.toLowerCase().includes(q)
        )
      })
      .slice(0, 12)
      .map((p) => {
        const val = String(p.value ?? '')
        const lab = String(p.label || val)
        return {
          name: val,
          label: lab === val ? 'picklist' : lab,
          kind: 'value',
          insertText: inString ? val : `'${val.replace(/'/g, "\\'")}' `
        }
      })
  }

  if (kind === 'date' || kind === 'datetime') {
    const samples = soqlDateTimeSamples()
    /** @type {SuggestItem[]} */
    const items = []
    if (kind === 'date') {
      items.push({
        name: samples.date,
        label: 'YYYY-MM-DD',
        kind: 'value',
        insertText: inString ? samples.date : `${samples.date} `
      })
    } else {
      items.push({
        name: samples.datetime,
        label: 'YYYY-MM-DDThh:mm:ssZ',
        kind: 'value',
        insertText: inString ? samples.datetime : `${samples.datetime} `
      })
      items.push({
        name: samples.date,
        label: 'date only',
        kind: 'value',
        insertText: inString ? samples.date : `${samples.date} `
      })
    }
    for (const lit of SOQL_DATE_LITERALS) {
      if (q && !lit.toLowerCase().startsWith(q) && !lit.toLowerCase().includes(q)) {
        continue
      }
      items.push({
        name: lit,
        label: 'date literal',
        kind: 'value',
        insertText: inString ? lit : `${lit} `
      })
    }
    return items
      .filter((it) => {
        if (!q) return true
        return (
          it.name.toLowerCase().includes(q) ||
          String(it.label).toLowerCase().includes(q)
        )
      })
      .slice(0, 12)
  }

  return []
}
