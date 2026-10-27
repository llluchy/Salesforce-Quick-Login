/**
 * 把手写 SOQL 解析成左侧对象 / 字段勾选 / WHERE 行。
 * 只认当前对象字段列表里的简单字段名。带点的路径、__r、函数、子查询不关联。
 */

const CLAUSE_RE = /^(SELECT|FROM|WHERE|LIMIT|OFFSET|HAVING|WITH|FOR)\b/i

/**
 * @param {string} text
 * @param {Record<string, { name: string, type?: string, picklistValues?: Array }>} [fieldsMap]
 */
export function parseManualSoql(text, fieldsMap) {
  const clauses = extractClauses(text)
  const map = fieldsMap || {}
  return {
    objectName: clauses.objectName,
    selectFields: matchSelectFields(clauses.selectItems, map),
    whereConditions: parseWhereConditions(clauses.whereBody, map)
  }
}

/**
 * @param {string} text
 */
function extractClauses(text) {
  const src = String(text || '')
  const marks = []
  let depth = 0
  let inStr = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === "'" && src[i + 1] === "'") {
        i += 1
        continue
      }
      if (ch === '\\' && src[i + 1] === "'") {
        i += 1
        continue
      }
      if (ch === "'") inStr = false
      continue
    }
    if (ch === "'") {
      inStr = true
      continue
    }
    if (ch === '(') {
      depth += 1
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0 || !isIdentBoundary(src, i)) continue
    const clause = matchClause(src.slice(i))
    if (!clause) continue
    marks.push({ kw: clause.kw, index: i, len: clause.len })
    i += clause.len - 1
  }

  const select = marks.find((mark) => mark.kw === 'SELECT')
  const from = marks.find((mark) => mark.kw === 'FROM')
  const where = marks.find((mark) => mark.kw === 'WHERE')
  const selectEnd = marks.find((mark) => select && mark.index > select.index)
  const selectBody = select
    ? src.slice(select.index + select.len, selectEnd ? selectEnd.index : src.length)
    : ''
  const whereEnd = where
    ? marks.find(
        (mark) =>
          mark.index > where.index &&
          mark.kw !== 'AND' &&
          mark.kw !== 'OR'
      )
    : null
  const whereBody = where
    ? src.slice(where.index + where.len, whereEnd ? whereEnd.index : src.length)
    : ''

  return {
    objectName: readFromName(src, from),
    selectItems: splitTopLevelComma(selectBody.replace(/^\s*DISTINCT\s+/i, '')),
    whereBody
  }
}

function matchClause(slice) {
  const simple = slice.match(CLAUSE_RE)
  if (simple) return { kw: simple[1].toUpperCase(), len: simple[1].length }
  const order = slice.match(/^ORDER\s+BY\b/i)
  if (order) return { kw: 'ORDER', len: order[0].length }
  const group = slice.match(/^GROUP\s+BY\b/i)
  if (group) return { kw: 'GROUP', len: group[0].length }
  return null
}

function readFromName(src, from) {
  if (!from) return ''
  const rest = src.slice(from.index + from.len)
  const m = rest.match(/^\s*([A-Za-z_][\w]*)/)
  return m ? m[1] : ''
}

function matchSelectFields(items, fieldsMap) {
  const out = []
  const seen = new Set()
  for (const raw of items) {
    const token = String(raw || '').trim()
    if (!/^[A-Za-z_][\w]*$/.test(token)) continue
    if (/__r$/i.test(token)) continue
    const field = lookupField(fieldsMap, token)
    if (!field || seen.has(field.name)) continue
    seen.add(field.name)
    out.push(field.name)
  }
  return out
}

function parseWhereConditions(body, fieldsMap) {
  const merged = []
  for (const piece of splitTopLevelAnd(body)) {
    const prev = merged[merged.length - 1]
    if (prev && /\bBETWEEN\b/i.test(maskStrings(prev)) && !/\bAND\b/i.test(maskStrings(prev))) {
      merged[merged.length - 1] = `${prev} AND ${piece}`
    } else {
      merged.push(piece)
    }
  }
  const out = []
  for (const piece of merged) {
    const cond = parseOneCondition(piece, fieldsMap)
    if (cond) out.push(cond)
  }
  return out
}

function parseOneCondition(piece, fieldsMap) {
  const s = String(piece || '').trim()
  if (!s) return null
  if (/\bOR\b/i.test(maskStrings(s))) return null

  const between = s.match(/^([A-Za-z_][\w]*)\s+BETWEEN\s+([\s\S]+?)\s+AND\s+([\s\S]+)$/i)
  if (between) {
    if (/__r$/i.test(between[1]) || between[1].includes('.')) return null
    const field = lookupField(fieldsMap, between[1])
    if (!field) return null
    const operator = canonicalOperator('BETWEEN', field.type)
    if (!operator) return null
    const value = parseAtom(between[2], field.type)
    const value2 = parseAtom(between[3], field.type)
    if (value == null || value2 == null) return null
    return { fieldApiName: field.name, operator, value, value2 }
  }

  const nullOp = s.match(/^([A-Za-z_][\w]*)\s*(!?=)\s*null$/i)
  if (nullOp) {
    if (/__r$/i.test(nullOp[1])) return null
    const field = lookupField(fieldsMap, nullOp[1])
    if (!field) return null
    const operator = canonicalOperator(nullOp[2] === '!=' ? '!= null' : '= null', field.type)
    if (!operator) return null
    return { fieldApiName: field.name, operator, value: '', value2: '' }
  }

  const inOp = s.match(/^([A-Za-z_][\w]*)\s+IN\s*\(([\s\S]*)\)$/i)
  if (inOp) {
    if (/__r$/i.test(inOp[1])) return null
    const field = lookupField(fieldsMap, inOp[1])
    if (!field) return null
    const operator = canonicalOperator('IN', field.type)
    if (!operator) return null
    const value = parseInValue(inOp[2], field.type)
    if (value == null) return null
    return { fieldApiName: field.name, operator, value, value2: '' }
  }

  const cmp = s.match(/^([A-Za-z_][\w]*)\s*(<=|>=|!=|<>|=|<|>|LIKE)\s*([\s\S]+)$/i)
  if (!cmp) return null
  if (/__r$/i.test(cmp[1]) || cmp[1].includes('.')) return null
  const field = lookupField(fieldsMap, cmp[1])
  if (!field) return null
  const operator = canonicalOperator(cmp[2], field.type)
  if (!operator) return null
  const value = parseAtom(cmp[3], field.type)
  if (value == null) return null
  return { fieldApiName: field.name, operator, value, value2: '' }
}

function parseInValue(inner, type) {
  const kind = valueKindOf(type)
  const parts = splitTopLevelComma(inner).map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return null
  const values = []
  for (const part of parts) {
    const atom = parseAtom(part, type)
    if (atom == null || atom === '') return null
    values.push(atom)
  }
  if (kind === 'picklist') return values
  return values.join(', ')
}

function isSingleAtom(raw) {
  const s = String(raw || '').trim()
  if (!s) return false
  if (s.startsWith("'")) return /^'(?:\\'|''|[^'])*'$/.test(s)
  return !/\s/.test(s)
}

function parseAtom(raw, type) {
  const kind = valueKindOf(type)
  const s = String(raw || '').trim()
  if (!s) return ''
  if (!isSingleAtom(s)) return null
  if (kind === 'boolean') {
    if (/^true$/i.test(s)) return 'true'
    if (/^false$/i.test(s)) return 'false'
    return null
  }
  if (kind === 'number') {
    if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null
    return s
  }
  if (kind === 'datetime') {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
    if (m) return `${m[1]}T${m[2]}`
    return unquoteIfNeeded(s)
  }
  if (kind === 'date' || kind === 'time') return unquoteIfNeeded(s)
  return unquoteIfNeeded(s)
}

function unquoteIfNeeded(raw) {
  const s = String(raw || '').trim()
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/\\'/g, "'").replace(/''/g, "'")
  }
  return s
}

function canonicalOperator(raw, type) {
  const compact = String(raw || '').replace(/\s+/g, ' ').trim()
  let op = compact
  if (op === '<>') op = '!='
  if (/^like$/i.test(op)) op = 'LIKE'
  if (/^in$/i.test(op)) op = 'IN'
  if (/^between$/i.test(op)) op = 'BETWEEN'
  const allowed = operatorsFor(valueKindOf(type))
  return allowed.find((item) => item.toLowerCase() === op.toLowerCase()) || ''
}

function valueKindOf(type) {
  const t = String(type || '')
  if (t === 'boolean') return 'boolean'
  if (t === 'picklist' || t === 'multipicklist' || t === 'combobox') return 'picklist'
  if (t === 'date') return 'date'
  if (t === 'datetime') return 'datetime'
  if (t === 'time') return 'time'
  if (t === 'int' || t === 'double' || t === 'currency' || t === 'percent' || t === 'long') return 'number'
  return 'string'
}

function operatorsFor(kind) {
  if (kind === 'boolean') return ['=', '!=']
  if (kind === 'picklist') return ['=', '!=', 'IN']
  if (kind === 'date' || kind === 'datetime' || kind === 'time' || kind === 'number') {
    return ['=', '!=', '>', '>=', '<', '<=', 'BETWEEN']
  }
  return ['=', '!=', 'LIKE', 'IN', '= null', '!= null']
}

function lookupField(fieldsMap, name) {
  if (!fieldsMap || !name) return null
  if (fieldsMap[name]) return fieldsMap[name]
  const lower = String(name).toLowerCase()
  return Object.values(fieldsMap).find((field) => String(field?.name || '').toLowerCase() === lower) || null
}

function splitTopLevelComma(src) {
  return splitTopLevel(src, ',')
}

function splitTopLevelAnd(src) {
  return splitTopLevel(src, 'AND')
}

function splitTopLevel(src, separator) {
  const text = String(src || '')
  const parts = []
  let start = 0
  let depth = 0
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === "'" && text[i + 1] === "'") {
        i += 1
        continue
      }
      if (ch === '\\' && text[i + 1] === "'") {
        i += 1
        continue
      }
      if (ch === "'") inStr = false
      continue
    }
    if (ch === "'") {
      inStr = true
      continue
    }
    if (ch === '(') {
      depth += 1
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0) continue
    if (separator === ',') {
      if (ch !== ',') continue
      parts.push(text.slice(start, i))
      start = i + 1
      continue
    }
    if (!isIdentBoundary(text, i)) continue
    const m = text.slice(i).match(/^AND\b/i)
    if (!m) continue
    parts.push(text.slice(start, i))
    i += m[0].length - 1
    start = i + 1
  }
  parts.push(text.slice(start))
  return parts
}

function maskStrings(src) {
  const text = String(src || '')
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === "'" && text[i + 1] === "'") {
        out += '  '
        i += 1
        continue
      }
      if (ch === '\\' && text[i + 1] === "'") {
        out += '  '
        i += 1
        continue
      }
      if (ch === "'") {
        inStr = false
        out += ' '
        continue
      }
      out += ch === '\n' ? '\n' : ' '
      continue
    }
    if (ch === "'") {
      inStr = true
      out += ' '
      continue
    }
    out += ch
  }
  return out
}

function isIdentBoundary(src, index) {
  if (index <= 0) return true
  return !/[A-Za-z0-9_]/.test(src[index - 1] || '')
}
