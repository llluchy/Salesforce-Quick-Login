/**
 * 模糊打分：前缀优先，其次 name/label 包含。
 * @param {string} prefix
 * @param {string} name
 * @param {string} [label]
 * @returns {number} 负分表示不匹配
 */
export function fuzzyScore(prefix, name, label = '') {
  const q = String(prefix || '').toLowerCase()
  const nl = String(name || '').toLowerCase()
  const ll = String(label || '').toLowerCase()
  if (!q) return 0
  if (nl.startsWith(q)) return 300 - Math.min(nl.length, 99)
  if (ll.startsWith(q)) return 200 - Math.min(ll.length, 99)
  if (nl.includes(q)) return 100 - nl.indexOf(q)
  if (ll.includes(q)) return 50 - ll.indexOf(q)
  return -1
}

/**
 * @template T
 * @param {T[]} items
 * @param {string} prefix
 * @param {(item: T) => { name: string, label?: string }} getMeta
 * @param {number} [limit=12]
 * @returns {Array<T & { score: number, name: string, label: string }>}
 */
export function rankFuzzy(items, prefix, getMeta, limit = 12) {
  const scored = []
  for (const item of items || []) {
    const meta = getMeta(item) || {}
    const name = meta.name || ''
    const label = meta.label || name
    const score = fuzzyScore(prefix, name, label)
    if (score < 0) continue
    scored.push({ ...item, score, name, label })
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return scored.slice(0, limit)
}
