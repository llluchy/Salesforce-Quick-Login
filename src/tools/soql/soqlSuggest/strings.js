/**
 * SOQL 单引号字符串：是否处于未闭合字面量内（'' 为转义）。
 * @param {string} textBeforeCursor
 */
export function isInOpenSoqlString(textBeforeCursor) {
  const s = String(textBeforeCursor || '')
  let open = false
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "'") continue
    if (open && s[i + 1] === "'") {
      i += 1
      continue
    }
    open = !open
  }
  return open
}

/**
 * 从全文解析 FROM 对象 API 名。
 * @param {string} text
 * @returns {string}
 */
export function extractFromObjectName(text) {
  const m = String(text || '').match(/\bFROM\s+([A-Za-z_][\w]*)/i)
  return m ? m[1] : ''
}

/**
 * 光标所在括号层级的区间。nested 表示位于子查询内部。
 * @param {string} text
 * @param {number} cursor
 */
export function regionBounds(text, cursor) {
  const src = String(text || '')
  const pos = Math.max(0, Math.min(cursor ?? 0, src.length))
  const stack = []
  for (let i = 0; i < pos; i++) {
    if (src[i] === '(') stack.push(i)
    else if (src[i] === ')' && stack.length) stack.pop()
  }
  const start = stack.length ? stack[stack.length - 1] + 1 : 0
  let end = src.length
  let depth = 0
  for (let i = pos; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      if (depth === 0) {
        end = i
        break
      }
      depth--
    }
  }
  return { start, end, nested: stack.length > 0 }
}

/**
 * 当前括号层级里的 FROM 对象名（跳过更内层子查询）。
 * @param {string} text
 * @param {number} cursor
 * @returns {{ name: string, index: number } | null}
 */
export function fromMatchInRegion(text, cursor) {
  const src = String(text || '')
  const { start, end } = regionBounds(src, cursor)
  let depth = 0
  for (let i = start; i < end; i++) {
    const ch = src[i]
    if (ch === '(') {
      depth++
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0) continue
    const boundary = i === start || !/[A-Za-z0-9_]/.test(src[i - 1] || '')
    if (!boundary) continue
    const m = src.slice(i, end).match(/^FROM\s+([A-Za-z_][\w]*)/i)
    if (m) return { name: m[1], index: i }
  }
  return null
}
