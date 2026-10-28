<template>
  <div class="od-app theme-object">
    <header class="od-header">
      <div class="od-header-main">
        <h1>{{ headerTitle }}</h1>
        <div class="od-header-meta">
          <button
            v-if="describe?.name"
            type="button"
            class="meta-copy"
            :title="describe.name"
            @click="copyText(describe.name)"
          >{{ describe.name }}</button>
          <span v-if="describe?.keyPrefix" class="meta-chip">{{ t('objectDetail.prefix') }} {{ describe.keyPrefix }}</span>
          <span v-if="hostname" class="meta-chip muted">{{ hostname }}</span>
          <span v-if="recordId" class="meta-chip">Id {{ recordId }}</span>
          <span v-if="describe?.custom" class="meta-chip accent">{{ t('objectDetail.custom') }}</span>
          <span v-else-if="describe" class="meta-chip">{{ t('objectDetail.standard') }}</span>
        </div>
      </div>
      <div class="od-header-right">
        <button
          v-if="recordId"
          type="button"
          class="od-delete"
          :disabled="!canDeleteRecord"
          :title="deleteDisabledTitle"
          @click="openDeleteConfirm"
        >{{ deletingRecord ? t('objectDetail.deleting') : t('objectDetail.deleteRecord') }}</button>
        <LocaleSwitcher variant="dark" />
        <div v-if="capabilityChips.length" class="od-caps">
          <span
            v-for="cap in capabilityChips"
            :key="cap.key"
            :class="['cap', { on: cap.on }]"
          >{{ cap.label }}</span>
        </div>
      </div>
    </header>

    <div v-if="recordWarning" class="od-warning" role="alert">{{ recordWarning }}</div>

    <div v-if="bootError" class="od-empty">
      <div class="empty-card">
        <h2>{{ t('objectDetail.loadFailedTitle') }}</h2>
        <p>{{ bootError }}</p>
      </div>
    </div>

    <div v-else-if="loading" class="od-empty">
      <p class="list-hint">{{ t('objectDetail.loadingMetadata') }}</p>
    </div>

    <div v-else class="od-body">
      <nav class="od-nav panel">
        <button
          v-for="sec in sections"
          :key="sec.id"
          type="button"
          :class="['nav-item', { active: activeSection === sec.id }]"
          @click="activeSection = sec.id"
        >
          <span>{{ sec.label }}</span>
          <span v-if="sec.count != null" class="count">{{ sec.count }}</span>
        </button>
      </nav>

      <section class="od-content panel">
        <!-- 概览 -->
        <div v-if="activeSection === 'overview'" class="section-scroll">
          <h2 class="section-title">{{ t('objectDetail.overviewTitle') }}</h2>
          <div class="kv-grid">
            <div class="kv"><span class="k">{{ t('objectDetail.label') }}</span><span class="v">{{ describe.label }}</span></div>
            <div class="kv"><span class="k">{{ t('objectDetail.labelPlural') }}</span><span class="v">{{ describe.labelPlural }}</span></div>
            <div class="kv"><span class="k">API Name</span>
              <button type="button" class="v copyable" @click="copyText(describe.name)">{{ describe.name }}</button>
            </div>
            <div class="kv"><span class="k">Key Prefix</span><span class="v mono">{{ describe.keyPrefix || '—' }}</span></div>
            <div class="kv"><span class="k">{{ t('objectDetail.type') }}</span><span class="v">{{ objectKindLabel }}</span></div>
            <div class="kv"><span class="k">{{ t('objectDetail.customSetting') }}</span><span class="v">{{ yesNo(describe.customSetting) }}</span></div>
          </div>

          <h3 class="section-sub">{{ t('objectDetail.capabilities') }}</h3>
          <div class="od-caps inline">
            <span v-for="cap in allCapabilityChips" :key="cap.key" :class="['cap', { on: cap.on }]">{{ cap.label }}</span>
          </div>

          <h3 class="section-sub">{{ t('objectDetail.stats') }}</h3>
          <div class="stat-row">
            <div class="stat"><strong>{{ fieldStats.total }}</strong><span>{{ t('objectDetail.statFields') }}</span></div>
            <div class="stat"><strong>{{ fieldStats.custom }}</strong><span>{{ t('objectDetail.statCustom') }}</span></div>
            <div class="stat"><strong>{{ fieldStats.reference }}</strong><span>{{ t('objectDetail.statReference') }}</span></div>
            <div class="stat"><strong>{{ fieldStats.picklist }}</strong><span>{{ t('objectDetail.statPicklist') }}</span></div>
            <div class="stat"><strong>{{ (describe.childRelationships || []).length }}</strong><span>{{ t('objectDetail.statChildRels') }}</span></div>
            <div class="stat"><strong>{{ (describe.recordTypeInfos || []).length }}</strong><span>{{ t('objectDetail.statRecordTypes') }}</span></div>
          </div>
        </div>

        <!-- 字段 -->
        <div v-else-if="activeSection === 'fields'" class="fields-section">
          <div class="fields-toolbar">
            <input
              v-model.trim="fieldSearch"
              class="search-input"
              type="search"
              :placeholder="t('objectDetail.searchFieldsPlaceholder')"
            />
            <div class="chips">
              <button type="button" :class="['chip', { active: fieldKind === 'all' }]" @click="fieldKind = 'all'">{{ t('soql.chipAll') }}</button>
              <button type="button" :class="['chip', { active: fieldKind === 'standard' }]" @click="fieldKind = 'standard'">{{ t('soql.chipStandard') }}</button>
              <button type="button" :class="['chip', { active: fieldKind === 'custom' }]" @click="fieldKind = 'custom'">{{ t('soql.chipCustom') }}</button>
            </div>
            <span class="toolbar-count">{{ filteredFields.length }} / {{ fields.length }}</span>
          </div>
          <div class="table-wrap">
            <table class="meta-table fields-table">
              <thead>
                <tr>
                  <th class="col-expand"></th>
                  <th>{{ t('objectDetail.tableLabel') }}</th>
                  <th>API Name</th>
                  <th>{{ t('objectDetail.type') }}</th>
                  <th>{{ t('objectDetail.tableRequired') }}</th>
                  <th>{{ t('objectDetail.custom') }}</th>
                  <th>{{ t('objectDetail.tableValue') }}</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="field in filteredFields" :key="field.name">
                  <tr
                    :class="['field-row', { open: expandedField === field.name }]"
                    @click="toggleExpand(field.name)"
                  >
                    <td class="col-expand">{{ expandedField === field.name ? '▾' : '▸' }}</td>
                    <td :title="field.label">{{ field.label }}</td>
                    <td>
                      <button
                        type="button"
                        class="cell-copy"
                        :title="field.name"
                        @click.stop="copyText(field.name)"
                      >{{ field.name }}</button>
                    </td>
                    <td :title="typeWithSize(field)">{{ typeWithSize(field) }}</td>
                    <td>{{ field.nillable ? '' : '✓' }}</td>
                    <td>{{ field.custom ? '✓' : '' }}</td>
                    <td class="col-value">
                      <button
                        v-if="fieldValueText(field.name)"
                        type="button"
                        class="cell-copy value-copy"
                        :title="fieldValueText(field.name)"
                        @click.stop="copyText(fieldValueText(field.name))"
                      >{{ fieldValueText(field.name) }}</button>
                    </td>
                  </tr>
                  <tr v-if="expandedField === field.name" class="expand-row">
                    <td colspan="7">
                      <div class="expand-body">
                        <div v-if="field.inlineHelpText" class="expand-block">
                          <h4>{{ t('objectDetail.helpText') }}</h4>
                          <p>{{ field.inlineHelpText }}</p>
                        </div>
                        <div v-if="field.calculated || field.calculatedFormula" class="expand-block">
                          <h4>{{ t('objectDetail.formula') }}</h4>
                          <pre>{{ field.calculatedFormula || '(calculated)' }}</pre>
                        </div>
                        <div class="expand-kv">
                          <span>{{ t('objectDetail.defaultValue') }}：{{ formatDefault(field) }}</span>
                          <span>{{ t('objectDetail.defaultedOnCreate') }}：{{ yesNo(field.defaultedOnCreate) }}</span>
                          <span>{{ t('objectDetail.unique') }}：{{ yesNo(field.unique) }}</span>
                          <span>External Id：{{ yesNo(field.externalId) }}</span>
                          <span>{{ t('objectDetail.autoNumber') }}：{{ yesNo(field.autoNumber) }}</span>
                          <span>Id Lookup：{{ yesNo(field.idLookup) }}</span>
                          <span>Groupable：{{ yesNo(field.groupable) }}</span>
                          <span>Aggregatable：{{ yesNo(field.aggregatable) }}</span>
                          <span>Encrypted：{{ yesNo(field.encrypted) }}</span>
                          <span>Deprecated：{{ yesNo(field.deprecatedAndHidden) }}</span>
                          <span>Createable：{{ yesNo(field.createable) }}</span>
                          <span>Updateable：{{ yesNo(field.updateable) }}</span>
                          <span>Filterable：{{ yesNo(field.filterable) }}</span>
                          <span>Sortable：{{ yesNo(field.sortable) }}</span>
                        </div>
                        <div v-if="field.type === 'reference' || field.relationshipName" class="expand-block">
                          <h4>{{ t('objectDetail.relationships') }}</h4>
                          <p>
                            relationshipName：<code>{{ field.relationshipName || '—' }}</code>
                            · referenceTo：<code>{{ (field.referenceTo || []).join(', ') || '—' }}</code>
                            · cascadeDelete：{{ yesNo(field.cascadeDelete) }}
                            · polymorphic：{{ yesNo(field.polymorphicForeignKey) }}
                          </p>
                        </div>
                        <div v-if="(field.picklistValues || []).length" class="expand-block">
                          <h4>{{ t('objectDetail.picklistCount', { count: field.picklistValues.length }) }}</h4>
                          <ul class="pick-list">
                            <li v-for="(pv, i) in field.picklistValues" :key="i">
                              <code>{{ pv.value }}</code>
                              <span v-if="pv.label !== pv.value"> — {{ pv.label }}</span>
                              <span v-if="!pv.active" class="dim">{{ t('objectDetail.picklistInactive') }}</span>
                              <span v-if="pv.defaultValue" class="accent-text">{{ t('objectDetail.picklistDefault') }}</span>
                            </li>
                          </ul>
                        </div>
                        <p v-if="!hasExpandContent(field)" class="dim">{{ t('objectDetail.noExtraDetail') }}</p>
                        </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
            <p v-if="filteredFields.length === 0" class="list-hint">{{ t('objectDetail.noMatchingFields') }}</p>
          </div>
        </div>

        <!-- 子关系 -->
        <div v-else-if="activeSection === 'children'" class="list-section">
          <div class="list-section-head">
            <h2 class="section-title">{{ t('objectDetail.childrenTitle') }}</h2>
          </div>
          <div class="table-wrap">
            <table v-if="childRels.length" class="meta-table">
              <thead>
                <tr>
                  <th>Relationship Name</th>
                  <th>Child SObject</th>
                  <th>Field</th>
                  <th>Cascade Delete</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(rel, idx) in childRels" :key="idx">
                  <td>
                    <button
                      v-if="rel.relationshipName"
                      type="button"
                      class="cell-copy"
                      @click="copyText(rel.relationshipName)"
                    >{{ rel.relationshipName }}</button>
                    <span v-else class="dim">—</span>
                  </td>
                  <td>{{ rel.childSObject }}</td>
                  <td class="mono">{{ rel.field }}</td>
                  <td>{{ yesNo(rel.cascadeDelete) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="list-hint">{{ t('objectDetail.noChildRels') }}</p>
          </div>
        </div>

        <!-- 记录类型 -->
        <div v-else-if="activeSection === 'recordTypes'" class="list-section">
          <div class="list-section-head">
            <h2 class="section-title">{{ t('objectDetail.recordTypesTitle') }}</h2>
          </div>
          <div class="table-wrap">
            <table v-if="recordTypes.length" class="meta-table">
              <thead>
                <tr>
                  <th>{{ t('objectDetail.label') }}</th>
                  <th>Developer Name</th>
                  <th>Record Type Id</th>
                  <th>Available</th>
                  <th>Default</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rt in recordTypes" :key="rt.recordTypeId">
                  <td>{{ rt.name }}</td>
                  <td class="mono">{{ rt.developerName || '—' }}</td>
                  <td>
                    <button type="button" class="cell-copy" @click="copyText(rt.recordTypeId)">{{ rt.recordTypeId }}</button>
                  </td>
                  <td>{{ yesNo(rt.available) }}</td>
                  <td>{{ yesNo(rt.defaultRecordTypeMapping) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="list-hint">{{ t('objectDetail.noRecordTypes') }}</p>
          </div>
        </div>
      </section>
    </div>
    <ToolToast
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      @close="closeToast"
    />

    <div v-if="deleteConfirmOpen" class="confirm-overlay" @click.self="closeDeleteConfirm">
      <div class="confirm-dialog" role="dialog" aria-modal="true">
        <h3>{{ t('objectDetail.confirmDeleteTitle') }}</h3>
        <p>{{ t('objectDetail.confirmDeleteBody', { object: describe?.name || objectName, id: recordId }) }}</p>
        <div class="confirm-actions">
          <button type="button" class="od-dialog-btn" :disabled="deletingRecord" @click="closeDeleteConfirm">{{ t('common.cancel') }}</button>
          <button type="button" class="od-dialog-btn danger" :disabled="deletingRecord" @click="confirmDeleteRecord">
            {{ deletingRecord ? t('objectDetail.deleting') : t('objectDetail.confirmDelete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '../../components/LocaleSwitcher.vue'
import ToolToast from '../_shared/ToolToast.vue'
import { useToolToast } from '../_shared/useToolToast.js'
import { SfRestClient, fetchSfSession, isSalesforceId, isSalesforceObjectApi } from '../_shared/sfApi.js'
import '../_shared/toolThemes.css'

const { t } = useI18n()
const { toastVisible, toastMessage, toastType, showToast, closeToast } = useToolToast()

const params = new URLSearchParams(location.search)
const objectName = params.get('object') || ''
const hostnameParam = params.get('hostname') || ''
const recordId = params.get('id') || ''

const hostname = ref(hostnameParam)
const describe = ref(null)
const loading = ref(true)
const bootError = ref('')
const recordWarning = ref('')
const recordValues = ref(null)
const recordDeleted = ref(false)
const deleteConfirmOpen = ref(false)
const deletingRecord = ref(false)
let sfClient = null
const activeSection = ref('fields')
const fieldSearch = ref('')
const fieldKind = ref('all')
const expandedField = ref('')

const fields = computed(() => describe.value?.fields || [])
const childRels = computed(() => describe.value?.childRelationships || [])
const recordTypes = computed(() => describe.value?.recordTypeInfos || [])

const headerTitle = computed(() => {
  if (describe.value?.label) return describe.value.label
  return objectName || t('objectDetail.defaultTitle')
})

const objectKindLabel = computed(() => {
  if (!describe.value) return '—'
  if (describe.value.customSetting) return t('objectDetail.kindCustomSetting')
  if (describe.value.custom) return t('objectDetail.kindCustomObject')
  return t('objectDetail.kindStandardObject')
})

const CAP_DEFS = [
  { key: 'queryable', label: 'Query' },
  { key: 'createable', label: 'Create' },
  { key: 'updateable', label: 'Update' },
  { key: 'deletable', label: 'Delete' },
  { key: 'searchable', label: 'Search' },
  { key: 'undeletable', label: 'Undelete' },
  { key: 'mergeable', label: 'Merge' },
  { key: 'triggerable', label: 'Trigger' },
  { key: 'feedEnabled', label: 'Feed' }
]

const allCapabilityChips = computed(() => {
  const d = describe.value
  if (!d) return []
  return CAP_DEFS.map((c) => ({ ...c, on: !!d[c.key] }))
})

const capabilityChips = computed(() => allCapabilityChips.value.filter((c) => c.on))

function loadedRecordId(values) {
  const direct = String(values?.Id ?? values?.id ?? '').trim()
  const url = String(values?.attributes?.url || '')
  const fromUrl = url.match(/\/sobjects\/([A-Za-z][A-Za-z0-9_]*)\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)(?:\/|$|\?)/)
  if (fromUrl) {
    if (direct && direct !== fromUrl[2]) return ''
    return fromUrl[2]
  }
  return isSalesforceId(direct) ? direct : ''
}

function deleteTargetReady() {
  const objectApi = describe.value?.name || ''
  const id = String(recordId || '').trim()
  const loadedId = loadedRecordId(recordValues.value)
  const sameObject = objectApi.toLowerCase() === String(objectName || '').trim().toLowerCase()
  return (
    sameObject &&
    isSalesforceObjectApi(objectApi) &&
    isSalesforceId(id) &&
    loadedId === id &&
    !!describe.value?.deletable &&
    !recordDeleted.value
  )
}

const canDeleteRecord = computed(() => deleteTargetReady() && !deletingRecord.value)

const deleteDisabledTitle = computed(() => {
  if (recordDeleted.value) return t('objectDetail.recordDeleted', { id: recordId })
  if (describe.value && !describe.value.deletable) return t('objectDetail.notDeletable')
  if (loading.value) return t('objectDetail.loadingMetadata')
  if (!recordValues.value) return recordWarning.value || bootError.value || t('objectDetail.recordMissing', { id: recordId })
  if (!deleteTargetReady()) return t('objectDetail.deleteRejected')
  return t('objectDetail.deleteRecord')
})

const fieldStats = computed(() => {
  const list = fields.value
  return {
    total: list.length,
    custom: list.filter((f) => f.custom).length,
    reference: list.filter((f) => f.type === 'reference').length,
    picklist: list.filter((f) => f.type === 'picklist' || f.type === 'multipicklist').length
  }
})

const sections = computed(() => [
  { id: 'overview', label: t('objectDetail.sectionOverview'), count: null },
  { id: 'fields', label: t('objectDetail.sectionFields'), count: fields.value.length },
  { id: 'children', label: t('objectDetail.sectionChildren'), count: childRels.value.length },
  { id: 'recordTypes', label: t('objectDetail.sectionRecordTypes'), count: recordTypes.value.length }
])

const filteredFields = computed(() => {
  let list = fields.value
  if (fieldKind.value === 'standard') {
    list = list.filter((f) => !String(f.name).endsWith('__c'))
  } else if (fieldKind.value === 'custom') {
    list = list.filter((f) => String(f.name).endsWith('__c'))
  }
  const q = fieldSearch.value.toLowerCase()
  if (q) {
    list = list.filter(
      (f) =>
        (f.label || '').toLowerCase().includes(q) ||
        (f.name || '').toLowerCase().includes(q) ||
        (f.type || '').toLowerCase().includes(q)
    )
  }
  return list
})

function yesNo(v) {
  return v ? t('objectDetail.yes') : t('objectDetail.no')
}

function sizeDisplay(field) {
  const t = field.type
  if (t === 'double' || t === 'currency' || t === 'percent') {
    if (field.precision == null && field.scale == null) return ''
    return `${field.precision ?? 0},${field.scale ?? 0}`
  }
  if (t === 'int') {
    const n = field.digits || field.length
    return n ? String(n) : ''
  }
  if (field.length) return String(field.length)
  return ''
}

function typeWithSize(field) {
  let base = field.type || ''
  if (field.type === 'reference' && field.referenceTo?.length) {
    base = `reference → ${field.referenceTo.join(', ')}`
  }
  const size = sizeDisplay(field)
  return size ? `${base}(${size})` : base
}

function fieldValueText(fieldName) {
  if (!recordValues.value) return ''
  const v = recordValues.value[fieldName]
  if (v == null) return ''
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function formatDefault(field) {
  if (field.defaultValue != null && field.defaultValue !== '') {
    return typeof field.defaultValue === 'object'
      ? JSON.stringify(field.defaultValue)
      : String(field.defaultValue)
  }
  if (field.defaultValueFormula) return field.defaultValueFormula
  return '—'
}

function hasExpandContent(field) {
  return !!(
    field.inlineHelpText ||
    field.calculated ||
    field.calculatedFormula ||
    field.defaultValue != null ||
    field.defaultValueFormula ||
    field.type === 'reference' ||
    field.relationshipName ||
    (field.picklistValues || []).length ||
    field.unique ||
    field.externalId ||
    field.autoNumber ||
    field.encrypted ||
    field.deprecatedAndHidden
  )
}

function toggleExpand(name) {
  expandedField.value = expandedField.value === name ? '' : name
}

async function copyText(text) {
  const value = String(text || '')
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    showToast(t('objectDetail.copied', { value }))
  } catch {
    showToast(t('objectDetail.copyFailed'), 'error')
  }
}

function escapeSoqlLiteral(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function selectableFieldNames(fieldList) {
  return (fieldList || [])
    .filter((f) => !f.deprecatedAndHidden)
    .filter((f) => f.type !== 'address' && f.type !== 'location' && f.type !== 'base64')
    .map((f) => f.name)
    .filter(Boolean)
}

async function loadRecordById(client, objectApiName, id, fieldList) {
  recordValues.value = null
  recordWarning.value = ''
  const safeId = escapeSoqlLiteral(id)

  const applyEmpty = (msg) => {
    recordValues.value = null
    recordWarning.value = msg
  }

  try {
    const soql = `SELECT FIELDS(ALL) FROM ${objectApiName} WHERE Id = '${safeId}' LIMIT 1`
    const data = await client.query(soql)
    if (!data?.records?.length) {
      applyEmpty(t('objectDetail.recordMissing', { id }))
      return
    }
    recordValues.value = data.records[0]
    return
  } catch {
    // FIELDS(ALL) 不可用时回退为显式字段列表
  }

  const names = selectableFieldNames(fieldList)
  if (!names.includes('Id')) names.unshift('Id')

  const chunkSize = 80
  const merged = {}
  let found = false
  try {
    for (let i = 0; i < names.length; i += chunkSize) {
      const chunk = names.slice(i, i + chunkSize)
      if (!chunk.includes('Id')) chunk.unshift('Id')
      const soql = `SELECT ${[...new Set(chunk)].join(',')} FROM ${objectApiName} WHERE Id = '${safeId}' LIMIT 1`
      const data = await client.query(soql)
      if (!data?.records?.length) {
        applyEmpty(t('objectDetail.recordMissing', { id }))
        return
      }
      found = true
      Object.assign(merged, data.records[0])
    }
    recordValues.value = found ? merged : null
    if (!found) {
      applyEmpty(t('objectDetail.recordMissing', { id }))
    }
  } catch (e) {
    applyEmpty(t('objectDetail.recordQueryFailed', { msg: e?.message || e }))
  }
}

function closeDeleteConfirm() {
  if (deletingRecord.value) return
  deleteConfirmOpen.value = false
}

function openDeleteConfirm() {
  if (!canDeleteRecord.value) return
  deleteConfirmOpen.value = true
}

async function confirmDeleteRecord() {
  if (!sfClient || !recordId || deletingRecord.value || recordDeleted.value) return
  deletingRecord.value = true
  try {
    const res = await fetchSfSession(hostname.value || hostnameParam)
    if (res?.success && res.session?.sessionId) {
      sfClient.sessionId = res.session.sessionId
      sfClient.hostname = res.session.hostname || sfClient.hostname
      hostname.value = sfClient.hostname
    }
    const objectApi = describe.value?.name || ''
    const id = String(recordId || '').trim()
    if (!deleteTargetReady() || loadedRecordId(recordValues.value) !== id) {
      throw Object.assign(new Error('Invalid delete target'), { name: 'InvalidDeleteTarget' })
    }
    await sfClient.deleteSObject(objectApi, id)
    recordDeleted.value = true
    recordValues.value = null
    recordWarning.value = t('objectDetail.recordDeleted', { id })
    deleteConfirmOpen.value = false
    showToast(t('objectDetail.deletedRecord', { object: objectApi, id }))
  } catch (e) {
    const msg = e?.name === 'InvalidDeleteTarget'
      ? t('objectDetail.deleteRejected')
      : (e?.message || t('objectDetail.deleteFailed'))
    recordWarning.value = msg
    showToast(msg, 'error')
  } finally {
    deletingRecord.value = false
  }
}

async function load() {
  loading.value = true
  bootError.value = ''
  recordWarning.value = ''
  recordValues.value = null
  recordDeleted.value = false
  deleteConfirmOpen.value = false
  sfClient = null
  if (!objectName) {
    bootError.value = t('objectDetail.missingObjectParam')
    loading.value = false
    return
  }
  if (!hostnameParam) {
    bootError.value = t('objectDetail.missingHostnameParam')
    loading.value = false
    return
  }
  try {
    const res = await fetchSfSession(hostnameParam)
    if (!res?.success || !res.session?.sessionId) {
      throw new Error(res?.error || t('objectDetail.sessionFailed'))
    }
    hostname.value = res.session.hostname || hostnameParam
    const client = new SfRestClient({
      hostname: hostname.value,
      sessionId: res.session.sessionId
    })
    sfClient = client
    describe.value = await client.describeSObject(objectName)
    document.title = recordId
      ? `${describe.value.label || objectName} · ${recordId}`
      : `${describe.value.label || objectName} · ${t('objectDetail.titleSuffix')}`

    if (recordId) {
      await loadRecordById(client, objectName, recordId, describe.value.fields || [])
      showToast(
        recordValues.value
          ? t('objectDetail.recordLoaded', { id: recordId })
          : t('objectDetail.objectOnlyLoaded')
      )
    } else {
      showToast(t('objectDetail.objectLoaded', { name: objectName }))
    }
  } catch (e) {
    bootError.value = e?.message || String(e)
    describe.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 主题色：.theme-object → src/tools/_shared/toolThemes.css（淡紫，对齐浮动入口） */
.od-app {
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  padding: var(--gap);
  box-sizing: border-box;
  background: var(--page);
  color: var(--text);
}

.od-header {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
  border-radius: var(--radius);
  box-shadow: var(--header-shadow);
  color: #fff;
}

.od-header-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.od-delete {
  border: 1px solid #ffcdd2;
  background: #ffebee;
  color: #c62828;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.od-delete:hover:not(:disabled) {
  background: #ffcdd2;
}

.od-delete:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(40, 20, 60, 0.35);
}

.confirm-dialog {
  width: min(420px, 100%);
  background: #fff;
  color: var(--text);
  border-radius: 10px;
  border: 1px solid var(--border);
  box-shadow: 0 12px 40px rgba(40, 20, 60, 0.22);
  padding: 16px 18px;
}

.confirm-dialog h3 {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--accent-deep);
}

.confirm-dialog p {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.45;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.od-dialog-btn {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.od-dialog-btn.danger {
  border-color: #ef9a9a;
  background: #ffebee;
  color: #c62828;
  font-weight: 600;
}

.od-dialog-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.od-warning {
  flex-shrink: 0;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid #ef9a9a;
  border-radius: 8px;
  background: #ffebee;
  color: #c62828;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
}

.od-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--title-on-header);
}

.od-header-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  align-items: center;
}

.meta-copy {
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  font-family: Consolas, 'Courier New', monospace;
  cursor: copy;
}

.meta-copy:hover {
  background: rgba(255, 255, 255, 0.28);
}

.meta-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
}

.meta-chip.muted {
  opacity: 0.85;
}

.meta-chip.accent {
  background: rgba(255, 255, 255, 0.35);
  font-weight: 600;
}

.od-caps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  max-width: 420px;
}

.od-caps.inline {
  max-width: none;
  justify-content: flex-start;
  margin-bottom: 8px;
}

.cap {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.55);
  border: 1px solid transparent;
}

.od-header .cap.on {
  background: rgba(255, 255, 255, 0.95);
  color: var(--accent-deep);
}

.od-caps.inline .cap {
  background: #eceff1;
  color: #90a4ae;
}

.od-caps.inline .cap.on {
  background: var(--soft);
  color: var(--accent-deep);
  border-color: var(--border-hover);
}

.od-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 28px 32px;
  max-width: 440px;
  text-align: center;
  box-shadow: var(--shadow);
}

.empty-card h2 {
  margin: 0 0 10px;
  font-size: 16px;
  color: var(--accent-deep);
}

.empty-card p {
  margin: 0;
  font-size: 13px;
  color: #607d8b;
  line-height: 1.5;
}

.od-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 10px;
}

.panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-height: 0;
  overflow: hidden;
  box-shadow: var(--shadow);
}

.od-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--panel);
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--accent-deep);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.nav-item:hover {
  background: #fff;
  border-color: #90caf9;
}

.nav-item.active {
  background: var(--soft);
  border-color: #90caf9;
}

.count {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: #fff;
  padding: 1px 7px;
  border-radius: 999px;
}

.od-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.section-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
}

.section-title {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--accent-deep);
}

.list-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list-section-head {
  flex-shrink: 0;
  padding: 12px 16px 8px;
  background: #fff;
  border-bottom: 1px solid var(--border);
}

.list-section-head .section-title {
  margin: 0;
}

.section-sub {
  margin: 16px 0 8px;
  font-size: 12px;
  color: var(--accent-2);
}

.kv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.kv {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: var(--panel);
  border: 1px solid var(--soft);
  border-radius: 6px;
}

.kv .k {
  font-size: 11px;
  color: #78909c;
}

.kv .v {
  font-size: 13px;
  font-weight: 600;
  color: #263238;
  text-align: left;
}

.kv .v.copyable {
  border: none;
  background: transparent;
  padding: 0;
  cursor: copy;
  color: var(--accent-2);
  font-family: Consolas, 'Courier New', monospace;
}

.kv .v.copyable:hover {
  text-decoration: underline;
}

.mono {
  font-family: Consolas, 'Courier New', monospace;
}

.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.stat {
  min-width: 72px;
  padding: 10px 12px;
  background: var(--panel);
  border: 1px solid var(--soft);
  border-radius: 6px;
  text-align: center;
}

.stat strong {
  display: block;
  font-size: 18px;
  color: var(--accent-deep);
}

.stat span {
  font-size: 11px;
  color: #78909c;
}

.fields-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fields-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.search-input {
  flex: 1;
  min-width: 160px;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  background: #fff;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.12);
}

.chips {
  display: flex;
  gap: 4px;
}

.chip {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  color: #5c7a9b;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.chip.active {
  background: var(--soft);
  border-color: var(--accent);
  color: var(--accent-deep);
}

.toolbar-count {
  font-size: 11px;
  color: #78909c;
  margin-left: auto;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #fff;
}

.meta-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}

.meta-table th,
.meta-table td {
  border-bottom: 1px solid var(--soft);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
  background: #fff;
}

.meta-table th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--soft);
  color: var(--accent-deep);
  font-weight: 600;
  white-space: nowrap;
  /* 遮住下方滚动行，避免透视 */
  box-shadow: 0 1px 0 var(--border);
}

.fields-table td {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fields-table .col-value {
  max-width: 280px;
}

.fields-table .value-copy {
  max-width: 100%;
  display: inline-block;
}

.col-expand {
  width: 22px;
  color: #90a4ae;
}

.field-row {
  cursor: pointer;
}

.field-row:hover {
  background: #fafcff;
}

.field-row.open {
  background: var(--soft);
}

.cell-copy {
  display: inline;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  font: inherit;
  font-family: Consolas, 'Courier New', monospace;
  color: var(--accent-2);
  cursor: copy;
  text-align: left;
}

.cell-copy:hover {
  text-decoration: underline;
}

.expand-row td {
  background: #f7fbff;
  white-space: normal;
  max-width: none;
  overflow: visible;
}

.expand-body {
  padding: 4px 8px 8px;
  font-size: 12px;
  color: #455a64;
}

.expand-block {
  margin-bottom: 8px;
}

.expand-block h4 {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--accent-deep);
}

.expand-block pre {
  margin: 0;
  padding: 8px;
  background: #fff;
  border: 1px solid var(--soft);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
}

.expand-kv {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-bottom: 8px;
  font-size: 11px;
}

.pick-list {
  margin: 0;
  padding-left: 18px;
  max-height: 200px;
  overflow: auto;
}

.pick-list li {
  margin: 2px 0;
}

.dim {
  color: #90a4ae;
}

.accent-text {
  margin-left: 6px;
  color: var(--accent);
  font-weight: 600;
  font-size: 10px;
}

.list-hint {
  margin: 16px;
  font-size: 12px;
  color: #90a4ae;
  text-align: center;
}

@media (max-width: 800px) {
  .od-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .od-nav {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .nav-item {
    width: auto;
  }
}
</style>
