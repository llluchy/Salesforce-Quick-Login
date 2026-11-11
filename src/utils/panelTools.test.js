import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  canOpenObjectSearch,
  isObjectSearchPage,
  openObjectSearchMessage,
  openToolWindowMessage,
  pageHostname,
  planPanelToolOpen
} from './panelTools.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PANEL_KEYS = [
  'log',
  'query',
  'object',
  'logTitle',
  'queryTitle',
  'objectTitle',
  'panelHint',
  'openPageFirst',
  'openFailed'
]

function tab(url, id = 7) {
  return { id, url }
}

describe('panel tool open plan', () => {
  it('opens logs and queries without an extension session or a Salesforce page', () => {
    for (const toolId of ['apex-log', 'soql']) {
      const plan = planPanelToolOpen(toolId, null)
      assert.deepEqual(plan, { type: 'open-window', toolId, hostname: '' })
      assert.deepEqual(openToolWindowMessage(plan.toolId, plan.hostname), {
        action: 'openToolWindow',
        toolId,
        hostname: ''
      })
    }
    const elsewhere = planPanelToolOpen('soql', tab('https://example.com/inbox'))
    assert.equal(elsewhere.type, 'open-window')
    assert.equal(elsewhere.hostname, '')
  })

  it('passes the Salesforce host so the tool window uses this browser session', () => {
    const lightning = tab('https://acme.lightning.force.com/lightning/page/home', 3)
    const plan = planPanelToolOpen('apex-log', lightning)
    assert.deepEqual(plan, {
      type: 'open-window',
      toolId: 'apex-log',
      hostname: 'acme.lightning.force.com'
    })
    assert.equal(pageHostname(tab('https://acme.my.salesforce.com/')), 'acme.my.salesforce.com')
    assert.equal(pageHostname(tab('https://example.com/')), '')
    assert.equal(pageHostname(null), '')
  })

  it('tells the panel to ask for a Salesforce page before object search', () => {
    const blocked = [
      null,
      {},
      { id: 1 },
      tab(''),
      tab('https://example.com/'),
      tab('https://mail.google.com/mail'),
      tab('chrome://newtab'),
      tab('about:blank'),
      tab('chrome-extension://abc/index.html'),
      tab('http://acme.lightning.force.com/lightning'),
      tab('https://salesforce.com/'),
      tab('https://notsalesforce.com/'),
      { url: 'https://acme.lightning.force.com/lightning/o/Account/home' }
    ]
    for (const candidate of blocked) {
      assert.equal(canOpenObjectSearch(candidate), false, JSON.stringify(candidate))
      assert.deepEqual(planPanelToolOpen('object-search', candidate), {
        type: 'need-salesforce-page'
      })
    }
    assert.equal(isObjectSearchPage('https://example.com/'), false)
  })

  it('opens object search on the Salesforce page in front of the user', () => {
    const pages = [
      'https://acme.lightning.force.com/lightning/o/Account/home',
      'https://acme.my.salesforce.com/setup/home',
      'https://acme.my.site.com/s/',
      'https://acme.cloudforce.com/home'
    ]
    for (const url of pages) {
      assert.equal(isObjectSearchPage(url), true, url)
      const plan = planPanelToolOpen('object-search', tab(url, 12))
      assert.deepEqual(plan, { type: 'open-object-search', tabId: 12 })
    }
    assert.deepEqual(openObjectSearchMessage(), { action: 'openObjectSearch' })
    assert.deepEqual(planPanelToolOpen('missing', tab(pages[0])), { type: 'unknown' })
  })
})

describe('panel tool copy and wiring', () => {
  it('has the same new panel copy in zh-CN, en, and ja', () => {
    const locales = ['zh-CN', 'en', 'ja'].map((name) => ({
      name,
      messages: JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${name}.json`), 'utf8'))
    }))
    const bundles = locales.map((locale) => locale.messages.toolsHub)
    for (const bundle of bundles) {
      for (const key of PANEL_KEYS) {
        assert.equal(typeof bundle[key], 'string', key)
        assert.ok(bundle[key].trim().length > 0, key)
      }
    }
    for (const key of PANEL_KEYS) {
      const values = new Set(bundles.map((bundle) => bundle[key]))
      assert.equal(values.size, 3, key)
    }

    const vue = readFileSync(resolve(root, 'src/components/PanelTools.vue'), 'utf8')
    for (const key of PANEL_KEYS) {
      assert.match(vue, new RegExp(`toolsHub\\.${key}`))
    }
    const template = vue.slice(vue.indexOf('<template>'), vue.indexOf('</template>'))
    assert.doesNotMatch(template, /[\u3400-\u9fff]/)
    assert.doesNotMatch(vue, /useToolFloat|toolFloatPref|chrome\.storage|show_tool_float/)
    assert.match(vue, /planPanelToolOpen/)
    assert.match(vue, /openToolWindowMessage/)
    assert.match(vue, /openObjectSearchMessage/)

    const auth = readFileSync(resolve(root, 'src/components/AuthScreen.vue'), 'utf8')
    assert.match(auth, /<PanelTools variant="auth" \/>/)
    const app = readFileSync(resolve(root, 'src/App.vue'), 'utf8')
    const signedIn = app.slice(app.indexOf('v-else'), app.indexOf('class="env-list"'))
    assert.match(signedIn, /<PanelTools variant="app" \/>/)

    const content = readFileSync(resolve(root, 'content.js'), 'utf8')
    assert.match(content, /data-tool="apex-log"/)
    assert.match(content, /data-tool="soql"/)
    assert.match(content, /data-tool="object-search"/)
    assert.match(content, /openObjectSearchModal\(\)/)
    assert.match(content, /if \(state\.toolId\) openTool\(state\.toolId\)/)
    assert.match(content, /action === 'openObjectSearch'/)
    assert.match(content, /action !== 'toolFloatVisibility'/)

    const logic = readFileSync(resolve(root, 'src/utils/panelTools.js'), 'utf8')
    assert.doesNotMatch(logic, /chrome\.storage|show_tool_float|user_metadata|TOOL_FLOAT_SESSION_KEY/)
    const pref = readFileSync(resolve(root, 'src/utils/toolFloatPref.js'), 'utf8')
    assert.match(pref, /TOOL_FLOAT_SESSION_KEY = 'sfql_tool_float_session_visible'/)
    assert.match(pref, /不写入扩展的 local 或 sync 存储/)
  })
})
