import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildEnvListView, envMatchesSearch, normalizeEnvSearchQuery } from './envListSearch.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const COPY_KEYS = ['label', 'placeholder', 'clear', 'noMatch']

function env(partial) {
  return {
    id: partial.id,
    alias: partial.alias ?? '',
    username: partial.username ?? '',
    password: partial.password ?? 'secret-exam',
    customUrl: partial.customUrl ?? 'https://exam.example.com',
    groupId: partial.groupId
  }
}

function sample() {
  const collapsed = {
    id: 'g-prod',
    name: 'Finance',
    isVirtual: false,
    collapsed: true
  }
  const empty = {
    id: 'g-empty',
    name: '空分组',
    isVirtual: false,
    collapsed: false
  }
  const sandbox = {
    id: 'g-sb',
    name: 'Sandbox',
    isVirtual: false,
    collapsed: false
  }
  const environments = [
    env({ id: 'u1', alias: '杂项', username: 'misc@example.com' }),
    env({ id: 'p1', alias: '生产环境', username: 'admin@acme.com', groupId: 'g-prod', password: 'exam-only-password' }),
    env({ id: 'p2', alias: 'Billing', username: 'billing@acme.com', groupId: 'g-prod' }),
    env({ id: 's1', alias: 'UAT', username: 'uat.user@partner.com', groupId: 'g-sb' })
  ]
  return { groups: [collapsed, empty, sandbox], environments, collapsed }
}

describe('normalizeEnvSearchQuery', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeEnvSearchQuery('  AbC  '), 'abc')
    assert.equal(normalizeEnvSearchQuery('   '), '')
    assert.equal(normalizeEnvSearchQuery(null), '')
  })
})

describe('envMatchesSearch', () => {
  it('matches a part of the alias or username, ignoring case', () => {
    const row = env({ id: '1', alias: '生产环境', username: 'Admin@Acme.com', groupId: 'g-prod' })
    assert.equal(envMatchesSearch(row, '生产'), true)
    assert.equal(envMatchesSearch(row, 'ADMIN@'), true)
    assert.equal(envMatchesSearch(row, '  acme  '), true)
  })

  it('does not match password, url, or unrelated text', () => {
    const row = env({ id: '1', alias: '生产环境', username: 'admin@acme.com', groupId: 'g-prod' })
    assert.equal(envMatchesSearch(row, 'exam'), false)
    assert.equal(envMatchesSearch(row, 'secret'), false)
    assert.equal(envMatchesSearch(row, 'Finance'), false)
  })

  it('treats an empty query as matching everything', () => {
    const row = env({ id: '1', alias: '', username: '' })
    assert.equal(envMatchesSearch(row, ''), true)
    assert.equal(envMatchesSearch(row, '   '), true)
  })
})

describe('buildEnvListView', () => {
  it('keeps every group and the original collapse state when the query is empty', () => {
    const { groups, environments, collapsed } = sample()
    const view = buildEnvListView({
      groups,
      environments,
      query: '   ',
      ungroupedName: '未选择分组'
    })
    assert.equal(view.queryActive, false)
    assert.equal(view.noMatch, false)
    assert.equal(view.matchedCount, 4)
    assert.deepEqual(view.sections.map((section) => section.group.id), ['ungrouped', 'g-prod', 'g-empty', 'g-sb'])
    assert.equal(view.sections[1].group, collapsed)
    assert.equal(view.sections[1].group.collapsed, true)
    assert.deepEqual(view.sections[2].environments, [])
    assert.equal(view.sections[0].group.name, '未选择分组')
    assert.deepEqual(view.sections[1].environments.map((row) => row.id), ['p1', 'p2'])
  })

  it('keeps matching rows in their groups and hides groups with nothing to show', () => {
    const { groups, environments, collapsed } = sample()
    const view = buildEnvListView({
      groups,
      environments,
      query: 'Acme',
      ungroupedName: '未选择分组'
    })
    assert.equal(view.queryActive, true)
    assert.equal(view.noMatch, false)
    assert.deepEqual(view.sections.map((section) => section.group.id), ['g-prod'])
    assert.deepEqual(view.sections[0].environments.map((row) => row.id), ['p1', 'p2'])
    assert.equal(view.sections[0].group.collapsed, false)
    assert.equal(collapsed.collapsed, true)
    assert.notEqual(view.sections[0].group, collapsed)
  })

  it('can match one account inside an otherwise untouched group', () => {
    const { groups, environments } = sample()
    const view = buildEnvListView({ groups, environments, query: 'partner' })
    assert.deepEqual(view.sections.map((section) => section.group.id), ['g-sb'])
    assert.deepEqual(view.sections[0].environments.map((row) => row.id), ['s1'])
  })

  it('reports a clear miss when nothing matches', () => {
    const { groups, environments } = sample()
    const view = buildEnvListView({ groups, environments, query: '不存在' })
    assert.equal(view.noMatch, true)
    assert.equal(view.matchedCount, 0)
    assert.deepEqual(view.sections, [])
  })

  it('brings every group back after the query is cleared', () => {
    const { groups, environments } = sample()
    const filtered = buildEnvListView({ groups, environments, query: 'UAT' })
    assert.equal(filtered.sections.length, 1)
    const cleared = buildEnvListView({ groups, environments, query: '' })
    assert.equal(cleared.noMatch, false)
    assert.equal(cleared.matchedCount, 4)
    assert.deepEqual(cleared.sections.map((section) => section.group.id), ['ungrouped', 'g-prod', 'g-empty', 'g-sb'])
  })
})

describe('env search copy', () => {
  it('has the same keys in zh-CN, en, and ja, and the panel uses them', () => {
    const locales = ['zh-CN', 'en', 'ja'].map((name) => ({
      name,
      messages: JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${name}.json`), 'utf8'))
    }))
    const bundles = locales.map((locale) => locale.messages.envSearch)
    for (const bundle of bundles) {
      assert.deepEqual(Object.keys(bundle).sort(), [...COPY_KEYS].sort())
      for (const key of COPY_KEYS) {
        assert.equal(typeof bundle[key], 'string')
        assert.ok(bundle[key].trim().length > 0)
      }
    }
    for (const key of COPY_KEYS) {
      const values = new Set(bundles.map((bundle) => bundle[key]))
      assert.equal(values.size, 3, key)
    }

    const app = readFileSync(resolve(root, 'src/App.vue'), 'utf8')
    for (const key of COPY_KEYS) {
      assert.match(app, new RegExp(`t\\('envSearch\\.${key}'\\)`))
    }
    const template = app.slice(app.indexOf('<template>'), app.indexOf('</template>'))
    const searchStart = template.indexOf('class="env-search"')
    const listStart = template.indexOf('class="env-list"')
    assert.ok(searchStart !== -1 && listStart > searchStart)
    const searchBlock = template.slice(searchStart, listStart)
    assert.doesNotMatch(searchBlock, /[\u3400-\u9fff]/)
    assert.match(searchBlock, /envSearchQuery/)
    assert.match(app, /buildEnvListView/)
    assert.match(app, /:drag-enabled="!envListView\.queryActive"/)
  })
})
