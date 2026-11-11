/**
 * 日志行筛选。不依赖界面文案，供日志窗口和测试共用。
 */

/**
 * @param {{ kind?: string, type?: string, raw?: string }[]} lines
 * @param {string} filter  all|debug|error|db|code|flow|callout
 */
export function filterParsedLines(lines, filter) {
  if (!filter || filter === 'all') return lines
  if (filter === 'debug') {
    return lines.filter((l) => l.kind === 'debug' || /USER_DEBUG/i.test(l.type))
  }
  return lines.filter((l) => l.kind === filter)
}

/**
 * 分类筛选之后，再按正文是否包含这段文字收窄。
 * 查询为空或只有空白时，结果与只做分类筛选相同。匹配不区分大小写，看整行原文。
 * @param {{ kind?: string, type?: string, raw?: string }[]} lines
 * @param {string} filter
 * @param {string} [query]
 */
export function filterLogLines(lines, filter, query) {
  const byCategory = filterParsedLines(lines, filter)
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return byCategory
  return byCategory.filter((line) => String(line?.raw ?? '').toLowerCase().includes(needle))
}

/**
 * 把一段可见文字按查询拆开，命中片段保持原文大小写。
 * 查询为空时整段都不标记。特殊字符按字面匹配。
 * @param {string} text
 * @param {string} [query]
 * @returns {{ text: string, match: boolean }[]}
 */
export function highlightParts(text, query) {
  const source = String(text ?? '')
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle || !source) return [{ text: source, match: false }]
  const lower = source.toLowerCase()
  const parts = []
  let cursor = 0
  while (cursor < source.length) {
    const index = lower.indexOf(needle, cursor)
    if (index === -1) {
      parts.push({ text: source.slice(cursor), match: false })
      break
    }
    if (index > cursor) parts.push({ text: source.slice(cursor, index), match: false })
    parts.push({ text: source.slice(index, index + needle.length), match: true })
    cursor = index + needle.length
  }
  return parts.length ? parts : [{ text: source, match: false }]
}
