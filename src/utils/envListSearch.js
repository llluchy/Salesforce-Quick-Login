// 环境列表筛选：只看别名和账号，分组顺序保持不变。

export function normalizeEnvSearchQuery(query) {
  return String(query ?? '').trim().toLowerCase()
}

export function envMatchesSearch(env, query) {
  const q = normalizeEnvSearchQuery(query)
  if (!q) return true
  const alias = String(env?.alias ?? '').toLowerCase()
  const username = String(env?.username ?? '').toLowerCase()
  return alias.includes(q) || username.includes(q)
}

/**
 * 空查询时保留全部分组（含空分组）和折叠状态。
 * 有查询时只留下对得上的环境，分组仍按原顺序，并展开以便能看见结果。
 * 展开只作用在返回的副本上，不改传入的分组对象。
 */
export function buildEnvListView({
  groups = [],
  environments = [],
  query = '',
  ungroupedName = ''
} = {}) {
  const active = normalizeEnvSearchQuery(query).length > 0
  const list = Array.isArray(environments) ? environments : []
  const realGroups = Array.isArray(groups) ? groups : []

  const grouped = new Map()
  for (const env of list) {
    if (!envMatchesSearch(env, query)) continue
    const groupId = !env?.groupId || env.groupId === 'ungrouped' ? 'ungrouped' : env.groupId
    if (!grouped.has(groupId)) grouped.set(groupId, [])
    grouped.get(groupId).push(env)
  }

  const sections = []
  const ungroupedEnvs = grouped.get('ungrouped') || []
  if (ungroupedEnvs.length > 0) {
    sections.push({
      group: {
        id: 'ungrouped',
        name: ungroupedName,
        isVirtual: true,
        collapsed: false
      },
      environments: ungroupedEnvs
    })
  }

  for (const group of realGroups) {
    const groupEnvs = grouped.get(group.id) || []
    if (active && groupEnvs.length === 0) continue
    sections.push({
      group: active ? { ...group, collapsed: false } : group,
      environments: groupEnvs
    })
  }

  const matchedCount = sections.reduce((sum, section) => sum + section.environments.length, 0)
  return {
    queryActive: active,
    sections,
    matchedCount,
    noMatch: active && matchedCount === 0
  }
}
