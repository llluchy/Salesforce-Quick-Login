/** 父关系路径最多跳几段（Account.Owner.Name = 2） */
export const MAX_RELATION_HOPS = 2

/**
 * @param {object} desc Salesforce describe
 */
export function mapDescribe(desc) {
  const fields = {}
  for (const field of desc?.fields || []) {
    if (field?.deprecatedAndHidden) continue
    fields[field.name] = {
      name: field.name,
      label: field.label || field.name,
      type: field.type || 'string',
      custom: !!field.custom,
      updateable: field.updateable !== false,
      filterable: field.filterable === true,
      nillable: !!field.nillable,
      picklistValues: field.picklistValues || [],
      relationshipName: field.relationshipName || '',
      referenceTo: Array.isArray(field.referenceTo) ? field.referenceTo.filter(Boolean) : []
    }
  }
  const children = []
  for (const rel of desc?.childRelationships || []) {
    if (!rel?.relationshipName) continue
    children.push({
      name: rel.relationshipName,
      label: rel.childSObject || rel.relationshipName,
      childSObject: rel.childSObject || '',
      field: rel.field || ''
    })
  }
  return { fields, children }
}

/**
 * `Account.Owner.Na` → segments ['Account','Owner'], leaf 'Na'
 * `Account.` → segments ['Account'], leaf ''
 * @param {string} prefix
 */
export function splitFieldPath(prefix) {
  const raw = String(prefix || '')
  if (!raw.includes('.')) return { segments: [], leaf: raw }
  const parts = raw.split('.')
  return {
    segments: parts.slice(0, -1).filter((part) => part.length > 0),
    leaf: parts[parts.length - 1] || ''
  }
}

/**
 * @param {Record<string, any>} fields
 * @param {string} relationshipName
 * @returns {{ objectName: string } | { polymorphic: true, referenceTo: string[] } | null}
 */
export function relationshipTarget(fields, relationshipName) {
  const seg = String(relationshipName || '').toLowerCase()
  if (!seg) return null
  const field = Object.values(fields || {}).find(
    (item) => String(item.relationshipName || '').toLowerCase() === seg
  )
  if (!field) return null
  const refs = field.referenceTo || []
  if (refs.length !== 1) return { polymorphic: true, referenceTo: refs }
  return { objectName: refs[0] }
}

/**
 * @param {Array<{ name: string, childSObject?: string }>} children
 * @param {string} relationshipName
 */
export function findChildRelationship(children, relationshipName) {
  const seg = String(relationshipName || '').toLowerCase()
  if (!seg) return null
  return (
    (children || []).find((rel) => String(rel.name || '').toLowerCase() === seg) || null
  )
}
