import { extractFromObjectName, fromMatchInRegion, isInOpenSoqlString, regionBounds } from './strings.js'

/**
 * SOQL 联想上下文检测。
 * Phase A: object / field
 * Phase B: keyword（子句关键字）
 * Phase C: WHERE field / operator / value
 * Phase D: ORDER BY / GROUP BY 字段，LIMIT 数字后的 OFFSET
 *
 * @typedef {'object' | 'field' | 'keyword' | 'operator' | 'value' | 'none'} SuggestRole
 * @typedef {{
 *   role: SuggestRole,
 *   prefix: string,
 *   start: number,
 *   end: number,
 *   objectName?: string,
 *   fieldName?: string,
 *   operator?: string,
 *   inString?: boolean,
 *   keywordNames?: string[]
 * }} SuggestContext
 */

/**
 * @param {string} text
 * @param {number} cursor
 */
function sliceCursor(text, cursor) {
  const src = String(text || '')
  const pos = Math.max(0, Math.min(cursor ?? 0, src.length))
  return { src, pos, before: src.slice(0, pos) }
}

/**
 * 光标是否在 FROM 后的对象名位置。
 * @returns {SuggestContext | null}
 */
export function detectFromObjectContext(text, cursor) {
  const { src, pos, before } = sliceCursor(text, cursor)
  const tokenMatch = before.match(/\bFROM\s+([A-Za-z_][\w]*)$/i)
  const emptyMatch = before.match(/\bFROM\s*$/i)
  if (!tokenMatch && !emptyMatch) return null

  const cont = src.slice(pos).match(/^[A-Za-z0-9_]*/)
  const prefix = tokenMatch ? tokenMatch[1] : ''
  const start = tokenMatch ? pos - prefix.length : pos
  const end = pos + (cont ? cont[0].length : 0)
  return { role: 'object', prefix, start, end }
}

/**
 * 光标是否在 SELECT 字段列表中，且语句已有 FROM 对象名。
 * @returns {SuggestContext | null}
 */
export function detectSelectFieldContext(text, cursor) {
  const { pos, before } = sliceCursor(text, cursor)
  const src = String(text || '')
  const fromMatch = fromMatchInRegion(src, pos)
  if (!fromMatch) return null
  if (pos > fromMatch.index) return null

  const { start: regionStart } = regionBounds(src, pos)
  const regionBefore = before.slice(regionStart)
  if (!/\bSELECT\b/i.test(regionBefore)) return null
  const selectMatch = regionBefore.match(/\bSELECT\b/i)
  if (!selectMatch || pos <= regionStart + selectMatch.index + 6) return null

  const tokenMatch = regionBefore.match(/(?:SELECT\b|,)\s*([A-Za-z_][\w.]*)$/i)
  const emptyMatch = regionBefore.match(/(?:SELECT\b|,)\s*$/i)
  if (!tokenMatch && !emptyMatch) return null

  const prefix = tokenMatch ? tokenMatch[1] : ''
  const start = tokenMatch ? pos - prefix.length : pos
  const cont = src.slice(pos).match(/^[A-Za-z0-9_.]*/)
  return {
    role: 'field',
    fieldScope: 'select',
    objectName: fromMatch.name,
    prefix,
    start,
    end: pos + (cont ? cont[0].length : 0)
  }
}

/**
 * SELECT 列表但尚未写 FROM：字段位 + FROM 关键字。
 * 例：`SELECT Id, |` / `SELECT Na|`
 * @returns {SuggestContext | null}
 */
export function detectSelectListBeforeFromContext(text, cursor) {
  const { src, pos, before } = sliceCursor(text, cursor)
  if (/\bFROM\b/i.test(src.slice(0, pos))) return null
  const selectMatch = before.match(/\bSELECT\b/i)
  if (!selectMatch || selectMatch.index == null) return null
  if (pos <= selectMatch.index + 6) return null

  const tokenMatch = before.match(/(?:SELECT\b|,)\s*([A-Za-z_][\w.]*)$/i)
  const emptyMatch = before.match(/(?:SELECT\b|,)\s*$/i)
  if (!tokenMatch && !emptyMatch) return null

  const prefix = tokenMatch ? tokenMatch[1] : ''
  const start = tokenMatch ? pos - prefix.length : pos
  const cont = src.slice(pos).match(/^[A-Za-z0-9_.]*/)
  return {
    role: 'field',
    fieldScope: 'select',
    objectName: '',
    prefix,
    start,
    end: pos + (cont ? cont[0].length : 0),
    keywordNames: ['FROM']
  }
}

/**
 * 子句关键字位（Phase B）。
 * @returns {SuggestContext | null}
 */
export function detectClauseKeywordContext(text, cursor) {
  const { pos, before } = sliceCursor(text, cursor)

  const tokenMatch = before.match(/([A-Za-z_][\w]*)$/)
  // 多词关键字：允许前缀含空格尾（ORDER / ORDER BY 输入中）
  const multiMatch = before.match(/((?:ORDER|GROUP|NULLS|WITH|FOR|SECURITY)(?:\s+[A-Za-z_][\w]*)*)$/i)
  let prefix = ''
  let start = pos
  let head = before

  if (multiMatch && (!tokenMatch || multiMatch.index <= (tokenMatch.index ?? 0))) {
    // 若 multi 覆盖更长前缀则用之
    const multiPrefix = multiMatch[1]
    if (!tokenMatch || multiPrefix.length >= tokenMatch[1].length) {
      prefix = multiPrefix
      start = pos - prefix.length
      head = before.slice(0, start)
    }
  }
  if (!prefix && tokenMatch) {
    prefix = tokenMatch[1]
    start = pos - prefix.length
    head = before.slice(0, start)
  } else if (!prefix) {
    head = before
    start = pos
  }

  const headTrim = head.trimEnd()
  /** 光标前原文以空白结尾（值写完后再敲空格才出下一子句） */
  const trailingSpace = /\s$/.test(head)

  // 1) 空语句 → SELECT
  if (!headTrim) {
    return {
      role: 'keyword',
      prefix,
      start,
      end: pos,
      keywordNames: ['SELECT']
    }
  }

  // 2) FROM 对象名已完成，其后 → 后续子句
  //    headTrim 以 `FROM ObjectName` 结尾，且其后还没有 WHERE/ORDER…（在 headTrim 内 FROM 之后）
  const fromObjEnd = headTrim.match(/\bFROM\s+([A-Za-z_][\w]*)$/i)
  if (fromObjEnd) {
    const fromIdx = headTrim.search(/\bFROM\b/i)
    const afterFrom = headTrim.slice(fromIdx)
    if (
      !/\bFROM\s+[A-Za-z_][\w]*\s+\S/i.test(afterFrom) // FROM 后只有对象名
    ) {
      return {
        role: 'keyword',
        prefix,
        start,
        end: pos,
        keywordNames: [
          'WHERE',
          'ORDER BY',
          'GROUP BY',
          'LIMIT',
          'OFFSET',
          'HAVING',
          'WITH SECURITY_ENFORCED',
          'FOR UPDATE'
        ]
      }
    }
  }

  // 3) 一条简单条件结束且已输入空格 → AND / OR / 下一子句
  //    例：... WHERE CreatedDate = 2026-10-23T00:00:00Z |
  //    headTrim 已去掉末尾空格，空格是否存在单独看原文 head
  const completedWhereValue =
    /(?:'(?:\\'|[^'])*'|\btrue\b|\bfalse\b|\bnull\b|\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|\b(?:TODAY|YESTERDAY|TOMORROW|THIS_WEEK|LAST_WEEK|NEXT_WEEK|THIS_MONTH|LAST_MONTH|NEXT_MONTH|THIS_QUARTER|LAST_QUARTER|NEXT_QUARTER|THIS_YEAR|LAST_YEAR|NEXT_YEAR|THIS_FISCAL_QUARTER|LAST_FISCAL_QUARTER|NEXT_FISCAL_QUARTER|THIS_FISCAL_YEAR|LAST_FISCAL_YEAR|NEXT_FISCAL_YEAR)\b|\d+(?:\.\d+)?)$/i
  if (
    trailingSpace &&
    /\bWHERE\b/i.test(headTrim) &&
    completedWhereValue.test(headTrim) &&
    !/\b(?:LIMIT|OFFSET)\s+\d+(?:\.\d+)?$/i.test(headTrim)
  ) {
    return {
      role: 'keyword',
      prefix,
      start,
      end: pos,
      keywordNames: ['AND', 'OR', 'ORDER BY', 'GROUP BY', 'LIMIT', 'OFFSET', 'HAVING']
    }
  }

  // 4) ORDER BY 字段写完并空格 → ASC / DESC / NULLS …
  //    正在输入字段名时由 detectSortGroupFieldContext 处理，不会进到这里
  if (
    trailingSpace &&
    /\bORDER\s+BY\s+[A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*$/i.test(headTrim)
  ) {
    return {
      role: 'keyword',
      prefix,
      start,
      end: pos,
      keywordNames: ['ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'LIMIT', 'OFFSET']
    }
  }

  // 4b) ORDER BY 字段 ASC/DESC 后再空格 → NULLS / LIMIT / OFFSET
  if (
    trailingSpace &&
    /\bORDER\s+BY\s+[A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*\s+(?:ASC|DESC)$/i.test(headTrim)
  ) {
    return {
      role: 'keyword',
      prefix,
      start,
      end: pos,
      keywordNames: ['NULLS FIRST', 'NULLS LAST', 'LIMIT', 'OFFSET']
    }
  }

  // 5) GROUP BY 字段写完并空格 → HAVING / ORDER BY / LIMIT
  if (
    trailingSpace &&
    /\bGROUP\s+BY\s+[A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*$/i.test(headTrim)
  ) {
    return {
      role: 'keyword',
      prefix,
      start,
      end: pos,
      keywordNames: ['HAVING', 'ORDER BY', 'LIMIT', 'OFFSET']
    }
  }

  // 6) LIMIT 数字写完并空格 → OFFSET；数字本身不联想
  if (trailingSpace && /\bLIMIT\s+\d+$/i.test(headTrim)) {
    return {
      role: 'keyword',
      prefix,
      start,
      end: pos,
      keywordNames: ['OFFSET']
    }
  }

  return null
}

/**
 * ORDER BY / GROUP BY 后的字段位（含逗号后的下一字段）。
 * 例：`ORDER BY |` / `ORDER BY Na|` / `GROUP BY Name, |`
 * 字段名后的空格交给关键字（ASC/DESC、HAVING…）。
 * @returns {SuggestContext | null}
 */
export function detectSortGroupFieldContext(text, cursor) {
  const { src, pos, before } = sliceCursor(text, cursor)
  if (isInOpenSoqlString(before)) return null

  const m = before.match(
    /\b(ORDER|GROUP)\s+BY\s+((?:[A-Za-z_][\w.]*(?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?\s*,\s*)*)([A-Za-z_][\w.]*)?$/i
  )
  if (!m) return null

  const prefix = m[3] || ''
  const start = pos - prefix.length
  const cont = src.slice(pos).match(/^[A-Za-z0-9_.]*/)
  const end = pos + (cont ? cont[0].length : 0)

  return {
    role: 'field',
    fieldScope: 'sort',
    objectName: fromMatchInRegion(src, pos)?.name || extractFromObjectName(src),
    prefix,
    start,
    end
  }
}

const WHERE_OP_RE =
  '(?:=|!=|<>|<=|>=|<|>|LIKE|IN|BETWEEN|=\\s*null|!=\\s*null)'

/**
 * WHERE 值位：字段 + 运算符之后（含未闭合引号内）。
 * @returns {SuggestContext | null}
 */
export function detectWhereValueContext(text, cursor) {
  const { src, pos, before } = sliceCursor(text, cursor)
  if (!/\bWHERE\b/i.test(before)) return null

  const objectName = fromMatchInRegion(src, pos)?.name || extractFromObjectName(src)
  const inString = isInOpenSoqlString(before)

  // ... Field OP 'partial|
  if (inString) {
    const m = before.match(
      new RegExp(
        `\\b([A-Za-z_][\\w.]*)\\s*(${WHERE_OP_RE})\\s*'((?:\\\\'|[^'])*)$`,
        'i'
      )
    )
    if (!m) return null
    const prefix = m[3].replace(/''/g, "'")
    return {
      role: 'value',
      objectName,
      fieldName: m[1],
      operator: m[2].replace(/\s+/g, ' ').trim(),
      prefix,
      start: pos - m[3].length,
      end: pos,
      inString: true
    }
  }

  // ... Field OP |
  const m2 = before.match(
    new RegExp(
      `\\b([A-Za-z_][\\w.]*)\\s*(${WHERE_OP_RE})\\s*$`,
      'i'
    )
  )
  if (m2) {
    const op = m2[2].replace(/\s+/g, ' ').trim().toLowerCase()
    if (op === '= null' || op === '!= null') return null
    return {
      role: 'value',
      objectName,
      fieldName: m2[1],
      operator: m2[2].replace(/\s+/g, ' ').trim(),
      prefix: '',
      start: pos,
      end: pos,
      inString: false
    }
  }

  // ... Field IN ( |
  const mIn = before.match(/\b([A-Za-z_][\w.]*)\s+IN\s*\(\s*$/i)
  if (mIn) {
    return {
      role: 'value',
      objectName,
      fieldName: mIn[1],
      operator: 'IN',
      prefix: '',
      start: pos,
      end: pos,
      inString: false
    }
  }

  // ... Field IN ( 'partial|
  const mInStr = before.match(/\b([A-Za-z_][\w.]*)\s+IN\s*\(\s*'((?:\\'|[^'])*)$/i)
  if (mInStr && isInOpenSoqlString(before)) {
    return {
      role: 'value',
      objectName,
      fieldName: mInStr[1],
      operator: 'IN',
      prefix: mInStr[2].replace(/''/g, "'"),
      start: pos - mInStr[2].length,
      end: pos,
      inString: true
    }
  }

  return null
}

/**
 * WHERE 运算符位：字段名之后。
 * 例：`WHERE Name |` / `WHERE Name =|`
 * @returns {SuggestContext | null}
 */
export function detectWhereOperatorContext(text, cursor) {
  const { src, pos, before } = sliceCursor(text, cursor)
  if (!/\bWHERE\b/i.test(before)) return null
  if (isInOpenSoqlString(before)) return null

  // 字段后已有完整运算符则交给 value；此处匹配「字段 + 可选不完整运算符前缀」
  // `WHERE Name ` 或 `WHERE Name Li`（LIKE）
  const m = before.match(/\b(WHERE|AND|OR)\s+([A-Za-z_][\w.]*)\s+([=!<>a-zA-Z]*)$/i)
  if (m) {
    // 若第三段已是完整字段名的一部分……实际上第三段是 op 前缀
    // 排除：WHERE AND Name — 第二段是字段
    const fieldName = m[2]
    const opPrefix = m[3] || ''
    // 避免把 `WHERE Name Name2` 误判：第二标识后若还有标识且无运算符字符，不当作 op
    // 当前正则第三段只含 =!<> 与字母，LIKE/IN/BETWEEN/null 可用
    const start = pos - opPrefix.length
    return {
      role: 'operator',
      objectName: fromMatchInRegion(src, pos)?.name || extractFromObjectName(src),
      fieldName,
      prefix: opPrefix,
      start,
      end: pos
    }
  }

  // `WHERE Name|` 仍是字段编辑，不在此
  // `WHERE Name ` 仅空格：第三段空
  const mSpace = before.match(/\b(WHERE|AND|OR)\s+([A-Za-z_][\w.]*)\s+$/i)
  if (mSpace) {
    return {
      role: 'operator',
      objectName: fromMatchInRegion(src, pos)?.name || extractFromObjectName(src),
      fieldName: mSpace[2],
      prefix: '',
      start: pos,
      end: pos
    }
  }

  return null
}

/**
 * WHERE / AND / OR 之后的字段位。
 * @returns {SuggestContext | null}
 */
export function detectWhereFieldContext(text, cursor) {
  const { src, pos, before } = sliceCursor(text, cursor)
  if (!/\bWHERE\b/i.test(before)) return null
  if (isInOpenSoqlString(before)) return null

  const tokenMatch = before.match(/\b(WHERE|AND|OR)\s+([A-Za-z_][\w.]*)$/i)
  const emptyMatch = before.match(/\b(WHERE|AND|OR)\s*$/i)
  if (!tokenMatch && !emptyMatch) return null

  const prefix = tokenMatch ? tokenMatch[2] : ''
  const start = tokenMatch ? pos - prefix.length : pos
  const cont = src.slice(pos).match(/^[A-Za-z0-9_.]*/)
  const end = pos + (cont ? cont[0].length : 0)

  return {
    role: 'field',
    fieldScope: 'where',
    objectName: fromMatchInRegion(src, pos)?.name || extractFromObjectName(src),
    prefix,
    start,
    end
    // WHERE/AND/OR 后只联想字段；AND/OR 等关键字在「条件值 + 空格」后再出
  }
}

/**
 * 子查询里的 FROM：联想外层对象的子关系名，而不是全部 SObject。
 * @returns {SuggestContext | null}
 */
export function detectSubqueryFromContext(text, cursor) {
  const { src, pos, before } = sliceCursor(text, cursor)
  const region = regionBounds(src, pos)
  if (!region.nested) return null
  const innerBefore = before.slice(region.start)
  if (!/\bSELECT\b/i.test(innerBefore)) return null
  const tokenMatch = innerBefore.match(/\bFROM\s+([A-Za-z_][\w]*)$/i)
  const emptyMatch = innerBefore.match(/\bFROM\s*$/i)
  if (!tokenMatch && !emptyMatch) return null
  const prefix = tokenMatch ? tokenMatch[1] : ''
  const start = tokenMatch ? pos - prefix.length : pos
  const cont = src.slice(pos).match(/^[A-Za-z0-9_]*/)
  const outer = fromMatchInRegion(src, Math.max(0, region.start - 1))
  return {
    role: 'child',
    prefix,
    start,
    end: pos + (cont ? cont[0].length : 0),
    outerObject: outer?.name || ''
  }
}

/**
 * 统一入口。
 * @param {string} text
 * @param {number} cursor
 * @returns {SuggestContext}
 */
export function detectSuggestContext(text, cursor) {
  return (
    detectSubqueryFromContext(text, cursor) ||
    detectFromObjectContext(text, cursor) ||
    detectSelectFieldContext(text, cursor) ||
    detectSelectListBeforeFromContext(text, cursor) ||
    detectWhereValueContext(text, cursor) ||
    detectWhereOperatorContext(text, cursor) ||
    detectWhereFieldContext(text, cursor) ||
    detectSortGroupFieldContext(text, cursor) ||
    detectClauseKeywordContext(text, cursor) ||
    { role: 'none', prefix: '', start: cursor ?? 0, end: cursor ?? 0 }
  )
}
