import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildObjectManagerUrl,
  buildRecordPageUrl,
  createObjectDetailLinks,
  fetchFieldAuditMap,
  shownFieldAudit
} from './objectDetailModel.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const HOST = 'acme.my.salesforce.com'
const RECORD_ID = '001A00000000001AAA'
const COPY_KEYS = [
  'fieldCreatedBy',
  'fieldLastUpdatedBy',
  'fieldAuditUnknown',
  'fieldAuditFailed',
  'openObjectManager',
  'openObjectManagerTitle',
  'openRecord',
  'openRecordTitle',
  'openRecordDisabled'
]

function soqlOf(path) {
  const marker = 'q='
  const idx = String(path).indexOf(marker)
  if (idx < 0) return ''
  return decodeURIComponent(String(path).slice(idx + marker.length))
}

describe('field creator and updater', () => {
  it('shows who created and last updated the field from CustomField metadata', async () => {
    const calls = []
    const client = {
      apiVersion: '64.0',
      async rest(path) {
        calls.push(path)
        const soql = soqlOf(path)
        if (soql.includes('FROM EntityDefinition')) {
          assert.match(soql, /QualifiedApiName = 'Account'/)
          return { done: true, records: [{ DurableId: 'Account' }] }
        }
        if (soql.includes('FROM CustomField')) {
          assert.match(soql, /TableEnumOrId = 'Account'/)
          assert.match(soql, /CreatedBy\.Name/)
          assert.match(soql, /LastModifiedBy\.Name/)
          assert.doesNotMatch(soql, /FROM Account\b/)
          return {
            done: true,
            records: [
              {
                DeveloperName: 'Region',
                NamespacePrefix: null,
                CreatedBy: { Name: 'Field Author' },
                LastModifiedBy: { Name: 'Field Editor' }
              },
              {
                DeveloperName: 'Score',
                NamespacePrefix: 'pkg',
                CreatedBy: { Name: 'Pkg Author' },
                LastModifiedBy: { Name: 'Pkg Editor' }
              }
            ]
          }
        }
        throw new Error(`unexpected ${path}`)
      }
    }

    const audit = await fetchFieldAuditMap(client, 'Account')
    const custom = shownFieldAudit(
      { name: 'Region__c', CreatedBy: { Name: 'Record Owner' } },
      audit,
      '—'
    )
    assert.equal(custom.createdBy, 'Field Author')
    assert.equal(custom.updatedBy, 'Field Editor')

    const packaged = shownFieldAudit({ name: 'pkg__Score__c' }, audit, '—')
    assert.equal(packaged.createdBy, 'Pkg Author')
    assert.equal(packaged.updatedBy, 'Pkg Editor')

    const standard = shownFieldAudit(
      { name: 'CreatedById', CreatedBy: { Name: 'Record Owner' } },
      audit,
      '—'
    )
    assert.equal(standard.createdBy, '—')
    assert.equal(standard.updatedBy, '—')
    assert.ok(calls.length > 0)
    assert.ok(calls.every((path) => path.includes('/tooling/query/')))
  })

  it('follows tooling query pages and still shows both people', async () => {
    const client = {
      apiVersion: '64.0',
      async rest(path) {
        const soql = soqlOf(path)
        if (soql.includes('FROM EntityDefinition')) {
          return { done: true, records: [{ DurableId: '01I000000000001AAA' }] }
        }
        if (soql.includes('FROM CustomField')) {
          return {
            done: false,
            nextRecordsUrl: '/services/data/v64.0/tooling/query/01gNEXT',
            records: [
              {
                DeveloperName: 'Region',
                CreatedBy: { Name: 'Field Author' },
                LastModifiedBy: { Name: 'Field Editor' }
              }
            ]
          }
        }
        if (path.includes('01gNEXT')) {
          return {
            done: true,
            records: [
              {
                DeveloperName: 'Score',
                NamespacePrefix: 'pkg',
                CreatedBy: { Name: 'Pkg Author' },
                LastModifiedBy: { Name: 'Pkg Editor' }
              }
            ]
          }
        }
        throw new Error(`unexpected ${path}`)
      }
    }
    const audit = await fetchFieldAuditMap(client, 'Deal__c')
    assert.deepEqual(shownFieldAudit({ name: 'Region__c' }, audit), {
      createdBy: 'Field Author',
      updatedBy: 'Field Editor'
    })
    assert.deepEqual(shownFieldAudit({ name: 'pkg__Score__c' }, audit), {
      createdBy: 'Pkg Author',
      updatedBy: 'Pkg Editor'
    })
  })

  it('uses the custom object id when field metadata is not keyed by API name', async () => {
    const client = {
      apiVersion: '64.0',
      async rest(path) {
        const soql = soqlOf(path)
        if (soql.includes('FROM EntityDefinition')) {
          return { done: true, records: [{ DurableId: 'Deal__c' }] }
        }
        if (soql.includes('FROM CustomObject')) {
          assert.match(soql, /DeveloperName = 'Deal'/)
          assert.match(soql, /NamespacePrefix = null/)
          return { done: true, records: [{ Id: '01I000000000001AAA' }] }
        }
        if (soql.includes('FROM CustomField')) {
          assert.match(soql, /TableEnumOrId = '01I000000000001AAA'/)
          return {
            done: true,
            records: [
              {
                DeveloperName: 'Region',
                CreatedBy: { Name: 'Field Author' },
                LastModifiedBy: { Name: 'Field Editor' }
              }
            ]
          }
        }
        throw new Error(`unexpected ${path}`)
      }
    }
    const audit = await fetchFieldAuditMap(client, 'Deal__c')
    assert.equal(shownFieldAudit({ name: 'Region__c' }, audit, '—').createdBy, 'Field Author')
    assert.equal(shownFieldAudit({ name: 'Region__c' }, audit, '—').updatedBy, 'Field Editor')
  })

  it('does not call Salesforce when the object name is not an API name', async () => {
    let called = false
    const audit = await fetchFieldAuditMap(
      {
        apiVersion: '64.0',
        rest() {
          called = true
          return { done: true, records: [] }
        }
      },
      "Account' OR Name != null"
    )
    assert.deepEqual(audit, {})
    assert.equal(called, false)
  })

  it('rejects when field metadata cannot be read', async () => {
    await assert.rejects(() =>
      fetchFieldAuditMap(
        {
          apiVersion: '64.0',
          rest() {
            throw new Error('no setup access')
          }
        },
        'Account'
      )
    )
  })
})

describe('object manager and record links', () => {
  it('builds an Object Manager URL for the object currently being viewed', () => {
    assert.equal(
      buildObjectManagerUrl(HOST, 'Account'),
      'https://acme.lightning.force.com/lightning/setup/ObjectManager/Account/Details/view'
    )
    assert.equal(
      buildObjectManagerUrl('https://Acme.my.salesforce.com/lightning/o/Account/list', 'MyObj__c'),
      'https://acme.lightning.force.com/lightning/setup/ObjectManager/MyObj__c/Details/view'
    )
    assert.equal(
      buildObjectManagerUrl('acme--qa.sandbox.my.salesforce.com', 'Deal__c'),
      'https://acme--qa.sandbox.lightning.force.com/lightning/setup/ObjectManager/Deal__c/Details/view'
    )
    assert.equal(
      buildObjectManagerUrl(HOST, 'Contact'),
      'https://acme.lightning.force.com/lightning/setup/ObjectManager/Contact/Details/view'
    )
  })

  it('keeps Object Manager available without a record Id, and disables the record button', () => {
    const opened = []
    const links = createObjectDetailLinks({
      hostname: HOST,
      objectApiName: 'Account',
      recordId: '',
      open: (url) => opened.push(url)
    })
    assert.equal(links.objectManagerEnabled, true)
    assert.equal(
      links.objectManagerUrl,
      'https://acme.lightning.force.com/lightning/setup/ObjectManager/Account/Details/view'
    )
    assert.equal(links.recordEnabled, false)
    assert.equal(links.recordPageUrl, '')
    links.openRecord()
    links.openObjectManager()
    assert.deepEqual(opened, [links.objectManagerUrl])

    const blank = createObjectDetailLinks({
      hostname: HOST,
      objectApiName: 'Account',
      recordId: '   ',
      open: (url) => opened.push(url)
    })
    assert.equal(blank.recordEnabled, false)
    blank.openRecord()
    assert.deepEqual(opened, [links.objectManagerUrl])
  })

  it('navigates to that record when an Id is present', () => {
    const opened = []
    const links = createObjectDetailLinks({
      hostname: HOST,
      objectApiName: 'Contact',
      recordId: RECORD_ID,
      open: (url) => opened.push(url)
    })
    assert.equal(links.recordEnabled, true)
    assert.equal(links.objectManagerEnabled, true)
    assert.equal(
      links.objectManagerUrl,
      buildObjectManagerUrl(HOST, 'Contact')
    )
    assert.equal(links.objectManagerUrl.includes(RECORD_ID), false)
    assert.equal(
      links.recordPageUrl,
      buildRecordPageUrl(HOST, 'Contact', RECORD_ID)
    )
    assert.equal(
      links.recordPageUrl,
      `https://acme.lightning.force.com/lightning/r/Contact/${RECORD_ID}/view`
    )
    links.openRecord()
    assert.deepEqual(opened, [
      `https://acme.lightning.force.com/lightning/r/Contact/${RECORD_ID}/view`
    ])
  })
})

describe('object detail i18n and wiring', () => {
  it('has creator, updater, and link copy in zh-CN, en, and ja, and shows them on the page', () => {
    const bundles = ['zh-CN', 'en', 'ja'].map((name) => {
      const messages = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${name}.json`), 'utf8'))
      return messages.objectDetail
    })
    for (const bundle of bundles) {
      for (const key of COPY_KEYS) {
        assert.equal(typeof bundle[key], 'string', key)
        assert.ok(bundle[key].trim().length > 0, key)
      }
    }
    for (const key of COPY_KEYS) {
      if (key === 'fieldAuditUnknown') continue
      const values = new Set(bundles.map((bundle) => bundle[key]))
      assert.equal(values.size, 3, key)
    }

    const vue = readFileSync(resolve(root, 'src/tools/soql/ObjectDetailApp.vue'), 'utf8')
    const model = readFileSync(resolve(root, 'src/tools/soql/objectDetailModel.js'), 'utf8')
    for (const src of [vue, model]) {
      assert.doesNotMatch(src, /chrome\.storage/)
    }
    assert.match(vue, /shownFieldAudit/)
    assert.match(vue, /fetchFieldAuditMap/)
    assert.doesNotMatch(vue, /fieldValueText\('CreatedBy/)
    assert.doesNotMatch(vue, /recordValues[^\n]{0,80}CreatedBy/)

    const template = vue.slice(vue.indexOf('<template>'), vue.indexOf('</template>'))
    const thead = template.slice(template.indexOf('<thead>'), template.indexOf('</thead>'))
    const auditAt = template.indexOf('class="expand-kv field-audit"')
    const expand = template.slice(auditAt, auditAt + 500)
    const listRow = template.slice(template.indexOf("field-row"), template.indexOf('class="expand-row"'))
    for (const key of ['openObjectManager', 'openRecord', 'openRecordDisabled']) {
      assert.match(template, new RegExp(`t\\('objectDetail\\.${key}'\\)`))
    }
    for (const key of ['fieldCreatedBy', 'fieldLastUpdatedBy']) {
      assert.match(expand, new RegExp(`t\\('objectDetail\\.${key}'\\)`))
      assert.doesNotMatch(thead, new RegExp(`objectDetail\\.${key}`))
    }
    assert.match(expand, /fieldAuditText\(field\)\.createdBy/)
    assert.match(expand, /fieldAuditText\(field\)\.updatedBy/)
    assert.doesNotMatch(thead, /fieldAuditText/)
    assert.doesNotMatch(listRow, /fieldAuditText|fieldCreatedBy|fieldLastUpdatedBy/)
    assert.match(template, /colspan="7"/)
    assert.doesNotMatch(template, /col-audit/)

    const recordAt = template.indexOf('data-od-action="record"')
    const recordEnd = template.indexOf('</button>', recordAt)
    const recordBtn = template.slice(recordAt - 80, recordEnd)
    assert.match(recordBtn, /:disabled="!links\.recordEnabled"/)
    assert.doesNotMatch(recordBtn, /v-if/)
    assert.match(template, /data-od-action="object-manager"/)
    assert.match(template, /:disabled="!links\.objectManagerEnabled"/)
    assert.match(template, /openObjectManager/)
    assert.match(template, /openRecordPage/)
  })
})
