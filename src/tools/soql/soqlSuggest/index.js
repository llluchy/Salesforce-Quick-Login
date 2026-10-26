/**
 * SOQL 编辑器联想
 * Phase A–D: 对象、字段、关键字、WHERE、ORDER/GROUP/LIMIT
 * Phase E: 父关系路径（含 __r）、子查询子关系、SELECT 函数
 */
import { detectSuggestContext } from './detectContext.js'
import {
  provideChildSuggestions,
  provideFieldSuggestions,
  provideFunctionSuggestions,
  provideKeywordSuggestions,
  provideObjectSuggestions,
  provideOperatorSuggestions,
  provideRelationshipSuggestions,
  provideValueSuggestions
} from './providers.js'
import {
  MAX_RELATION_HOPS,
  findChildRelationship,
  relationshipTarget,
  splitFieldPath
} from './relationships.js'

export {
  detectSuggestContext,
  detectFromObjectContext,
  detectSelectFieldContext,
  detectClauseKeywordContext,
  detectWhereFieldContext,
  detectWhereOperatorContext,
  detectWhereValueContext,
  detectSortGroupFieldContext,
  detectSubqueryFromContext
} from './detectContext.js'
export { rankFuzzy, fuzzyScore } from './rankFuzzy.js'
export {
  provideObjectSuggestions,
  provideFieldSuggestions,
  provideKeywordSuggestions,
  provideOperatorSuggestions,
  provideValueSuggestions,
  provideRelationshipSuggestions,
  provideChildSuggestions,
  provideFunctionSuggestions
} from './providers.js'
export { SOQL_KEYWORDS, SELECT_FUNCTIONS } from './keywords.js'
export { isInOpenSoqlString, extractFromObjectName, fromMatchInRegion } from './strings.js'
export { mapDescribe, splitFieldPath } from './relationships.js'

const MAX_ITEMS = 12

/**
 * @param {object} opts
 * @param {string} opts.text
 * @param {number} opts.cursor
 * @param {Array<{ name: string, label?: string }>} opts.objects
 * @param {Record<string, any>} opts.fieldsMap 当前对象字段
 * @param {string} [opts.currentObjectName]
 * @param {Array<{ name: string, childSObject?: string }>} [opts.childRelationships]
 * @param {Record<string, { fields?: Record<string, any>, children?: Array }>} [opts.relatedDescribes]
 *   key 为对象 API 名（大小写不敏感）
 */
export function buildSoqlSuggestions({
  text,
  cursor,
  objects,
  fieldsMap,
  currentObjectName,
  childRelationships = [],
  relatedDescribes = {}
}) {
  const context = detectSuggestContext(text, cursor)
  const describedName = String(currentObjectName || '')
  const lookup = createLookup({
    currentObjectName: describedName,
    fieldsMap,
    childRelationships,
    relatedDescribes
  })

  if (context.role === 'object') {
    if (!objects?.length) {
      return pack([], 'none', context)
    }
    return pack(provideObjectSuggestions(context.prefix, objects), 'object', context)
  }

  if (context.role === 'child') {
    const resolved = lookup.childrenOf(context.outerObject || describedName)
    if (resolved.pendingDescribe) {
      return pack([], 'none', context, resolved.pendingDescribe)
    }
    const items = provideChildSuggestions(context.prefix, resolved.children)
    return pack(items, items.length ? 'child' : 'none', context)
  }

  if (context.role === 'operator' || context.role === 'value') {
    const located = lookup.locateField(context.objectName || describedName, context.fieldName)
    if (located.pendingDescribe) return pack([], 'none', context, located.pendingDescribe)
    if (!located.field) return pack([], 'none', context)
    if (context.role === 'operator') {
      const items = provideOperatorSuggestions(context.prefix, located.field.type)
      return pack(items, items.length ? 'operator' : 'none', context)
    }
    const items = provideValueSuggestions(context.prefix, located.field, {
      inString: !!context.inString
    })
    return pack(items, items.length ? 'value' : 'none', context)
  }

  if (context.role === 'field') {
    const baseName = context.objectName || describedName
    const opened = lookup.openObject(baseName)
    if (opened.pendingDescribe) return pack([], 'none', context, opened.pendingDescribe)
    if (!opened.fields) {
      const keywordsOnly = context.keywordNames?.length
        ? provideKeywordSuggestions(context.prefix, context.keywordNames)
        : []
      return pack(keywordsOnly, markKind(keywordsOnly), context)
    }

    const { segments, leaf } = splitFieldPath(context.prefix)
    if (segments.length > MAX_RELATION_HOPS) return pack([], 'none', context)

    const walked = lookup.walkRelationships(opened.fields, segments)
    if (walked.pendingDescribe) return pack([], 'none', context, walked.pendingDescribe)
    if (walked.blocked) return pack([], 'none', context)

    const relationships = provideRelationshipSuggestions(leaf, walked.fields)
    const fields = provideFieldSuggestions(leaf, walked.fields)
    let items = leaf ? [...relationships, ...fields] : [...fields, ...relationships]
    if (!segments.length && context.fieldScope === 'select') {
      items = [...provideFunctionSuggestions(leaf), ...items]
    }
    if (!segments.length && context.keywordNames?.length) {
      items = [...provideKeywordSuggestions(leaf, context.keywordNames), ...items]
    }
    if (segments.length) {
      const head = `${segments.join('.')}.`
      items = items.map((item) => ({
        ...item,
        name: head + item.name,
        insertText: head + (item.insertText || item.name)
      }))
    }
    items = items.slice(0, MAX_ITEMS)
    return pack(items, markKind(items), context)
  }

  if (context.role === 'keyword') {
    const items = provideKeywordSuggestions(context.prefix, context.keywordNames || [])
    return pack(items, items.length ? 'keyword' : 'none', context)
  }

  return pack([], 'none', context)
}

function createLookup({ currentObjectName, fieldsMap, childRelationships, relatedDescribes }) {
  const cache = new Map()
  const currentKey = String(currentObjectName || '').toLowerCase()
  for (const [name, packed] of Object.entries(relatedDescribes || {})) {
    cache.set(String(name).toLowerCase(), packed || {})
  }
  if (currentKey && fieldsMap && Object.keys(fieldsMap).length) {
    cache.set(currentKey, {
      fields: fieldsMap,
      children: childRelationships || []
    })
  }

  function entry(objectName) {
    const key = String(objectName || '').toLowerCase()
    if (!key) return null
    return cache.get(key) || null
  }

  return {
    childrenOf(objectName) {
      const named = String(objectName || '')
      if (!named) return { children: childRelationships || [] }
      const hit = entry(named)
      if (hit) return { children: hit.children || [] }
      if (named.toLowerCase() === currentKey) return { children: childRelationships || [] }
      return { children: [], pendingDescribe: named }
    },
    openObject(objectName) {
      const named = String(objectName || '')
      if (!named) {
        return currentKey ? { fields: fieldsMap || {}, children: childRelationships || [] } : { fields: null }
      }
      const direct = entry(named)
      if (direct?.fields && Object.keys(direct.fields).length) return direct
      const child = findChildRelationship(childRelationships, named)
      if (child?.childSObject) {
        const childEntry = entry(child.childSObject)
        if (childEntry?.fields) return childEntry
        return { fields: null, pendingDescribe: child.childSObject }
      }
      if (direct) return direct
      if (named.toLowerCase() === currentKey) {
        return { fields: fieldsMap || {}, children: childRelationships || [] }
      }
      return { fields: null, pendingDescribe: named }
    },
    walkRelationships(fields, segments) {
      let currentFields = fields
      for (const segment of segments) {
        const target = relationshipTarget(currentFields, segment)
        if (!target) return { blocked: true }
        if (target.polymorphic) return { blocked: true }
        const next = entry(target.objectName)
        if (!next?.fields) return { pendingDescribe: target.objectName }
        currentFields = next.fields
      }
      return { fields: currentFields }
    },
    locateField(objectName, fieldPath) {
      const opened = this.openObject(objectName)
      if (opened.pendingDescribe) return opened
      if (!opened.fields) return { field: null }
      const { segments, leaf } = splitFieldPath(fieldPath)
      if (!leaf) return { field: null }
      const walked = segments.length ? this.walkRelationships(opened.fields, segments) : { fields: opened.fields }
      if (walked.pendingDescribe || walked.blocked) return walked
      const field = walked.fields?.[leaf] || null
      return { field }
    }
  }
}

/** @param {Array<{ kind?: string }>} items */
function markKind(items) {
  if (!items.length) return 'none'
  if (items.every((item) => item.kind === 'keyword')) return 'keyword'
  if (items.every((item) => item.kind === 'object')) return 'object'
  if (items.every((item) => item.kind === 'operator')) return 'operator'
  if (items.every((item) => item.kind === 'value')) return 'value'
  if (items.every((item) => item.kind === 'child')) return 'child'
  if (items.every((item) => item.kind === 'function')) return 'function'
  if (items.every((item) => item.kind === 'relationship')) return 'relationship'
  return 'field'
}

function pack(items, kind, context, pendingDescribe) {
  const list = items.slice(0, MAX_ITEMS)
  return {
    items: list,
    kind: list.length ? kind : 'none',
    range: list.length ? { start: context.start, end: context.end } : null,
    context,
    pendingDescribe: pendingDescribe || ''
  }
}
