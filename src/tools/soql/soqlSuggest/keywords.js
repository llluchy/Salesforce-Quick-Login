/**
 * SOQL 常用子句关键字（Phase B）。
 * insertText 带尾随空格，便于继续输入。
 */

/** @typedef {{ name: string, insertText: string, label: string }} KeywordDef */

/** @type {KeywordDef[]} */
export const SOQL_KEYWORDS = [
  { name: 'SELECT', insertText: 'SELECT ', label: 'clause' },
  { name: 'FROM', insertText: 'FROM ', label: 'clause' },
  { name: 'WHERE', insertText: 'WHERE ', label: 'clause' },
  { name: 'AND', insertText: 'AND ', label: 'logic' },
  { name: 'OR', insertText: 'OR ', label: 'logic' },
  { name: 'ORDER BY', insertText: 'ORDER BY ', label: 'clause' },
  { name: 'GROUP BY', insertText: 'GROUP BY ', label: 'clause' },
  { name: 'HAVING', insertText: 'HAVING ', label: 'clause' },
  { name: 'LIMIT', insertText: 'LIMIT ', label: 'clause' },
  { name: 'OFFSET', insertText: 'OFFSET ', label: 'clause' },
  { name: 'WITH SECURITY_ENFORCED', insertText: 'WITH SECURITY_ENFORCED ', label: 'clause' },
  { name: 'FOR UPDATE', insertText: 'FOR UPDATE', label: 'clause' },
  { name: 'ASC', insertText: 'ASC ', label: 'order' },
  { name: 'DESC', insertText: 'DESC ', label: 'order' },
  { name: 'NULLS FIRST', insertText: 'NULLS FIRST ', label: 'order' },
  { name: 'NULLS LAST', insertText: 'NULLS LAST ', label: 'order' }
]

const BY_NAME = new Map(SOQL_KEYWORDS.map((k) => [k.name, k]))

/**
 * @param {string[]} names
 * @returns {KeywordDef[]}
 */
export function keywordsByNames(names) {
  return (names || []).map((n) => BY_NAME.get(n)).filter(Boolean)
}

/**
 * @param {string} prefix
 * @param {string} keyword
 */
/** SELECT 列表里的常用函数。仅当前缀能对上时才出现。 */
export const SELECT_FUNCTIONS = [
  { name: 'COUNT()', insertText: 'COUNT(' },
  { name: 'COUNT_DISTINCT()', insertText: 'COUNT_DISTINCT(' },
  { name: 'SUM()', insertText: 'SUM(' },
  { name: 'AVG()', insertText: 'AVG(' },
  { name: 'MIN()', insertText: 'MIN(' },
  { name: 'MAX()', insertText: 'MAX(' },
  { name: 'CALENDAR_YEAR()', insertText: 'CALENDAR_YEAR(' },
  { name: 'CALENDAR_MONTH()', insertText: 'CALENDAR_MONTH(' },
  { name: 'DAY_ONLY()', insertText: 'DAY_ONLY(' }
]

export function keywordMatchesPrefix(prefix, keyword) {
  const q = String(prefix || '').toLowerCase().trim()
  if (!q) return true
  const k = String(keyword || '').toLowerCase()
  const kCompact = k.replace(/\s+/g, '')
  const qCompact = q.replace(/\s+/g, '')
  return (
    k.startsWith(q) ||
    kCompact.startsWith(qCompact) ||
    k.split(/\s+/).some((part) => part.startsWith(q))
  )
}
