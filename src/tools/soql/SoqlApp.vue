<template>
  <div class="soql-app theme-soql" @contextmenu="onAppContextMenu" @click="onAppClick">
    <header class="soql-header">
      <h1>{{ t('soql.productTitle') }}</h1>
      <div class="soql-header-actions">
        <LocaleSwitcher variant="dark" />
        <select
          v-model="selectedEnvId"
          class="env-select"
          :disabled="loadingEnvs || envs.length === 0"
          @change="onEnvChange"
        >
          <option disabled value="">
            {{ loadingEnvs ? t('soql.scanningEnvs') : (envs.length ? t('soql.selectLoggedInEnv') : t('soql.noLoggedInEnv')) }}
          </option>
          <option v-for="env in envs" :key="env.id" :value="env.id">
            {{ env.label }} · {{ env.hostname }}
          </option>
        </select>
        <button type="button" class="btn btn-light" :disabled="loadingEnvs" @click="refreshEnvs">
          {{ t('soql.refreshEnvs') }}
        </button>
      </div>
    </header>

    <div v-if="!selectedEnv" class="soql-empty">
      <div class="empty-card">
        <h2>{{ t('soql.emptyTitle') }}</h2>
        <p>{{ t('soql.emptyDesc') }}</p>
        <button type="button" class="btn btn-primary" :disabled="loadingEnvs" @click="refreshEnvs">
          {{ loadingEnvs ? t('soql.scanning') : t('soql.refreshEnvList') }}
        </button>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      </div>
    </div>

    <div v-else class="soql-workspace">
      <div class="soql-tabs" role="tablist" :aria-label="t('soql.queryTabs')">
        <div
          v-for="tab in queryTabs"
          :key="tab.id"
          :class="['soql-tab', { active: tab.id === activeTabId }]"
          role="tab"
          :aria-selected="tab.id === activeTabId"
          @click="switchQueryTab(tab.id)"
        >
          <span class="soql-tab-title">{{ queryTabTitle(tab) }}</span>
          <button
            v-if="queryTabs.length > 1"
            type="button"
            class="soql-tab-close"
            :title="t('soql.closeTab')"
            :aria-label="t('soql.closeTab')"
            @click.stop="closeQueryTab(tab.id)"
          >×</button>
        </div>
        <button
          type="button"
          class="soql-tab-add"
          :title="t('soql.addTab')"
          :aria-label="t('soql.addTab')"
          @click="addQueryTab"
        >+</button>
      </div>
      <div class="soql-body">
      <section class="query-panel">
        <div class="panel-head">
          <span>SOQL</span>
          <div class="query-actions">
            <label class="limit-toggle">
              <input v-model="limitEnabled" type="checkbox" />
              <span>LIMIT</span>
            </label>
            <input
              v-model.number="queryLimit"
              type="number"
              min="1"
              max="2000"
              class="limit-input"
              :disabled="!limitEnabled"
            />
            <button type="button" class="btn btn-sm" :disabled="!soqlText.trim()" @click="copySoql">{{ t('soql.copy') }}</button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="!canExecute || executing"
              @click="executeQuery"
            >
              {{ executing ? t('soql.executing') : t('soql.execute') }}
            </button>
            <button
              v-if="executing"
              type="button"
              class="btn btn-sm btn-stop"
              @click="stopQuery"
            >{{ t('soql.stop') }}</button>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="!canCountObject || countingTotal || executing"
              :title="t('soql.countOnlyTitle')"
              @click="countObjectRows"
            >{{ countingTotal ? t('soql.counting') : t('soql.countOnly') }}</button>
            <span v-if="objectCountHint" class="object-count-hint">{{ objectCountHint }}</span>
          </div>
        </div>
        <div class="soql-editor-wrap">
          <button
            type="button"
            class="soql-fold-btn"
            :title="soqlEditorOpen ? t('soql.foldManualSoql') : t('soql.expandManualSoql')"
            @click="soqlEditorOpen = !soqlEditorOpen"
          >
            <span class="fold-caret">{{ soqlEditorOpen ? '▾' : '▸' }}</span>
            <span>{{ soqlEditorOpen ? t('soql.collapse') : t('soql.manual') }}</span>
          </button>
          <div v-if="soqlEditorOpen" class="soql-editor-block">
            <textarea
              ref="soqlEditorEl"
              v-model="soqlText"
              class="soql-editor"
              spellcheck="false"
              placeholder="SELECT Id, Name FROM Account"
              @input="onSoqlEditorActivity"
              @click="onSoqlEditorActivity"
              @keyup="onSoqlEditorActivity"
              @keydown="onSoqlSuggestKeydown"
            />
            <div v-if="fieldSuggestions.length" class="soql-suggest">
              <div class="suggest-list">
                <button
                  v-for="(item, idx) in fieldSuggestions"
                  :key="`${item.kind || 'item'}:${item.name}`"
                  type="button"
                  :class="['suggest-item', { active: idx === suggestIndex }]"
                  @mousedown.prevent="applyFieldSuggestion(item)"
                >
                  <span class="suggest-name">{{ item.name }}</span>
                  <span class="suggest-label">{{ suggestItemLabel(item) }}</span>
                </button>
              </div>
              <div class="suggest-hint">{{ t('soql.suggestHint') }}</div>
            </div>
          </div>
          <button
            v-else
            type="button"
            class="soql-preview"
            :title="soqlText || t('soql.expandManualSoql')"
            @click="soqlEditorOpen = true"
          >
            <span class="soql-preview-text">{{ soqlText || t('soql.soqlPreviewEmpty') }}</span>
          </button>
        </div>
        <p v-if="errorMessage" class="error-text inline-error">{{ errorMessage }}</p>


        <div class="results-head">
          <span>{{ t('soql.queryResults') }}</span>
          <span class="count" v-if="resultRows.length || resultTotalSize != null">
            {{
              resultTotalSize != null
                ? t('soql.rowsLoadedOfTotal', { loaded: resultRows.length, total: resultTotalSize })
                : t('soql.rowsCount', { count: resultRows.length })
            }}{{ resultDone === false ? t('soql.rowsIncomplete') : '' }}
          </span>
          <div class="results-actions">
            <button
              type="button"
              class="btn btn-sm"
              :disabled="!canLoadMore || executing"
              @click="loadMoreResults"
            >{{ t('soql.loadMore') }}</button>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="!resultRows.length || executing"
              @click="exportResultsCsv"
            >{{ t('soql.exportCsv') }}</button>
          </div>
        </div>
        <div ref="resultsWrapEl" class="results-wrap">
          <table v-if="resultColumns.length" class="results-table">
            <thead>
              <tr>
                <th class="col-detail">{{ t('soql.detailShort') }}</th>
                <th v-for="col in resultColumns" :key="col" class="col-head">
                  <button
                    type="button"
                    class="th-label th-copy"
                    :title="fieldLabel(col)"
                    @click="copyText(fieldLabel(col))"
                  >{{ fieldLabel(col) }}</button>
                  <button
                    type="button"
                    class="th-api th-copy"
                    :title="col"
                    @click="copyText(col)"
                  >{{ col }}</button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in resultRows" :key="idx">
                <td class="col-detail">
                  <button
                    type="button"
                    class="obj-detail-btn"
                    :title="t('soql.viewRecordDetail')"
                    :disabled="!rowRecordId(row)"
                    @click="openRecordDetail(row)"
                  >{{ t('soql.detailShort') }}</button>
                </td>
                <td
                  v-for="col in resultColumns"
                  :key="col"
                  class="result-cell"
                  :data-row="idx"
                  :data-col="col"
                  :class="{
                    selected: isCellSelected(idx, col),
                    dirty: isCellDirty(idx, col),
                    editing: isCellEditing(idx, col)
                  }"
                  @click.stop="selectResultCell(idx, col)"
                  @dblclick.stop="startEditCell(idx, col)"
                >
                  <template v-if="isCellEditing(idx, col)">
                    <select
                      v-if="cellFieldKind(col) === 'boolean'"
                      :ref="(el) => setCellEditorRef(el)"
                      class="cell-editor"
                      :value="cellEditorValue(idx, col)"
                      @change="onCellEditorChange(idx, col, $event.target.value)"
                      @keydown.esc.prevent="cancelEditCell"
                      @blur="onCellEditorBlur"
                      @click.stop
                    >
                      <option v-if="isFieldNillable(col)" value="">{{ t('soql.emptyValue') }}</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                    <select
                      v-else-if="cellFieldKind(col) === 'picklist' && fieldType(col) !== 'multipicklist'"
                      :ref="(el) => setCellEditorRef(el)"
                      class="cell-editor"
                      :value="cellEditorValue(idx, col)"
                      @change="onCellEditorChange(idx, col, $event.target.value)"
                      @keydown.esc.prevent="cancelEditCell"
                      @blur="onCellEditorBlur"
                      @click.stop
                    >
                      <option v-if="isFieldNillable(col)" value="">{{ t('soql.emptyValue') }}</option>
                      <option
                        v-for="opt in picklistOptions(col)"
                        :key="opt.value"
                        :value="opt.value"
                      >{{ opt.label || opt.value }}</option>
                    </select>
                    <select
                      v-else-if="fieldType(col) === 'multipicklist'"
                      :ref="(el) => setCellEditorRef(el)"
                      class="cell-editor cell-editor-multi"
                      multiple
                      @change="onCellEditorMultiChange(idx, col, $event.target)"
                      @keydown.esc.prevent="cancelEditCell"
                      @blur="onCellEditorBlur"
                      @click.stop
                    >
                      <option
                        v-for="opt in picklistOptions(col)"
                        :key="opt.value"
                        :value="opt.value"
                        :selected="cellEditorMultiValues(idx, col).includes(opt.value)"
                      >{{ opt.label || opt.value }}</option>
                    </select>
                    <input
                      v-else-if="cellFieldKind(col) === 'date'"
                      :ref="(el) => setCellEditorRef(el)"
                      class="cell-editor"
                      type="date"
                      :value="cellEditorValue(idx, col)"
                      @input="onCellEditorInput(idx, col, $event.target.value)"
                      @keydown.enter.prevent="commitEditCell"
                      @keydown.esc.prevent="cancelEditCell"
                      @blur="onCellEditorBlur"
                      @click.stop
                    />
                    <input
                      v-else-if="cellFieldKind(col) === 'datetime'"
                      :ref="(el) => setCellEditorRef(el)"
                      class="cell-editor"
                      type="datetime-local"
                      :value="cellEditorValue(idx, col)"
                      @input="onCellEditorInput(idx, col, $event.target.value)"
                      @keydown.enter.prevent="commitEditCell"
                      @keydown.esc.prevent="cancelEditCell"
                      @blur="onCellEditorBlur"
                      @click.stop
                    />
                    <input
                      v-else-if="cellFieldKind(col) === 'time'"
                      :ref="(el) => setCellEditorRef(el)"
                      class="cell-editor"
                      type="time"
                      step="1"
                      :value="cellEditorValue(idx, col)"
                      @input="onCellEditorInput(idx, col, $event.target.value)"
                      @keydown.enter.prevent="commitEditCell"
                      @keydown.esc.prevent="cancelEditCell"
                      @blur="onCellEditorBlur"
                      @click.stop
                    />
                    <input
                      v-else-if="cellFieldKind(col) === 'number'"
                      :ref="(el) => setCellEditorRef(el)"
                      class="cell-editor"
                      type="number"
                      :step="fieldType(col) === 'int' || fieldType(col) === 'long' ? '1' : 'any'"
                      :value="cellEditorValue(idx, col)"
                      @input="onCellEditorInput(idx, col, $event.target.value)"
                      @keydown.enter.prevent="commitEditCell"
                      @keydown.esc.prevent="cancelEditCell"
                      @blur="onCellEditorBlur"
                      @click.stop
                    />
                    <textarea
                      v-else-if="fieldType(col) === 'textarea'"
                      :ref="(el) => setCellEditorRef(el)"
                      class="cell-editor cell-editor-area"
                      rows="3"
                      :value="cellEditorValue(idx, col)"
                      @input="onCellEditorInput(idx, col, $event.target.value)"
                      @keydown.esc.prevent="cancelEditCell"
                      @blur="onCellEditorBlur"
                      @click.stop
                    />
                    <input
                      v-else
                      :ref="(el) => setCellEditorRef(el)"
                      class="cell-editor"
                      :type="textInputType(col)"
                      :value="cellEditorValue(idx, col)"
                      @input="onCellEditorInput(idx, col, $event.target.value)"
                      @keydown.enter.prevent="commitEditCell"
                      @keydown.esc.prevent="cancelEditCell"
                      @blur="onCellEditorBlur"
                      @click.stop
                    />
                  </template>
                  <span v-else class="cell-text">{{ cellDisplayValue(idx, col) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="list-hint results-empty">{{ t('soql.resultsEmpty') }}</p>
        </div>
        <div v-if="hasDirtyCells" class="results-edit-bar">
          <span class="edit-hint">{{ t('soql.editHint') }}</span>
          <button type="button" class="btn btn-sm" :disabled="submittingEdits" @click="revertAllEdits">{{ t('soql.revert') }}</button>
          <button type="button" class="btn btn-primary btn-sm" :disabled="submittingEdits" @click="openSubmitConfirm">
            {{ submittingEdits ? t('soql.submitting') : t('soql.submit') }}
          </button>
        </div>
      </section>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="ctxMenu.show"
        class="ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <button type="button" class="ctx-item" :disabled="!ctxMenu.canCopy" @click="ctxCopyCell">{{ t('soql.copy') }}</button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="submitConfirmOpen" class="confirm-overlay" @click.self="submitConfirmOpen = false">
        <div class="confirm-dialog" role="dialog" aria-modal="true">
          <h3>{{ t('soql.confirmSubmitTitle') }}</h3>
          <p>{{ t('soql.confirmSubmitBody', { count: dirtyEditCount }) }}</p>
          <ul class="confirm-list">
            <li v-for="item in dirtyEditPreview" :key="item.key">
              <code>{{ item.objectApi }}</code>
              · {{ item.field }}
              · <span class="dim">{{ item.from }}</span>
              →
              <strong>{{ item.to }}</strong>
            </li>
            <li v-if="dirtyEditCount > dirtyEditPreview.length" class="dim">
              {{ t('soql.confirmSubmitMore', { count: dirtyEditCount - dirtyEditPreview.length }) }}
            </li>
          </ul>
          <div class="confirm-actions">
            <button type="button" class="btn btn-sm" @click="submitConfirmOpen = false">{{ t('common.cancel') }}</button>
            <button type="button" class="btn btn-primary btn-sm" :disabled="submittingEdits" @click="confirmSubmitEdits">
              {{ submittingEdits ? t('soql.submitting') : t('soql.confirmSubmit') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    <ToolToast
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      @close="closeToast"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '../../components/LocaleSwitcher.vue'
import ToolToast from '../_shared/ToolToast.vue'
import { useToolToast } from '../_shared/useToolToast.js'
import { SfRestClient, listSfEnvironments, fetchSfSession, pickEnvForPage, readPageEnvPreferFromUrl } from '../_shared/sfApi.js'
import { DEFAULT_STANDARD_WHITELIST, getObjectKind } from './soqlConstants.js'
import { openObjectDetailTab } from '../_shared/toolWindows.js'
import { activePicklistOptions, valueKind } from './soqlWhere.js'
import { flattenSoqlRecord } from './flattenSoqlRecord.js'
import { parseManualSoql } from './parseManualSoql.js'
import { buildSoqlSuggestions } from './soqlSuggest/index.js'
import { mapDescribe } from './soqlSuggest/relationships.js'
import '../_shared/toolThemes.css'

const { t } = useI18n()
const { toastVisible, toastMessage, toastType, showToast, closeToast } = useToolToast()

const envs = ref([])
const selectedEnvId = ref('')
const loadingEnvs = ref(false)
const pagePrefer = ref(readPageEnvPreferFromUrl())

const objects = ref([])
const loadingObjects = ref(false)

/** @type {Map<string, { fields: Record<string, any>, children: Array }>} */
const describeCache = new Map()
const describeFailed = new Set()
/** @type {Map<string, Promise<void>>} */
const describeInflight = new Map()
const resultsWrapEl = ref(null)

let queryTabSeq = 0
/** 切换标签时抑制 watch，避免把另一张标签的 SOQL 重写或重新 describe */
let switchingTab = false

function createQueryTabState() {
  queryTabSeq += 1
  return {
    id: queryTabSeq,
    title: '',
    titled: false,
    resultsScroll: 0,
    editorStart: null,
    editorEnd: null,
    abortController: null,
    queryRunId: 0,
    currentObject: null,
    fieldsMap: {},
    childRelationships: [],
    soqlText: '',
    soqlEditorOpen: true,
    limitEnabled: false,
    queryLimit: 10,
    executing: false,
    countingTotal: false,
    objectCountHint: '',
    resultColumns: [],
    resultRows: [],
    resultDone: true,
    resultTotalSize: null,
    resultNextUrl: '',
    cellEdits: {},
    selectedCell: null,
    editingCell: null,
    errorMessage: ''
  }
}

const queryTabs = ref([createQueryTabState()])
const activeTabId = ref(queryTabs.value[0].id)

function activeState() {
  return queryTabs.value.find((tab) => tab.id === activeTabId.value) || queryTabs.value[0]
}

function tabField(key) {
  return computed({
    get() {
      return activeState()[key]
    },
    set(value) {
      activeState()[key] = value
    }
  })
}

const currentObject = tabField('currentObject')
const fieldsMap = tabField('fieldsMap')
const childRelationships = tabField('childRelationships')
const soqlText = tabField('soqlText')
const soqlEditorOpen = tabField('soqlEditorOpen')
const soqlEditorEl = ref(null)
/** 编辑器联想：字段（SELECT）或对象（FROM），项形如 { name, label } */
const fieldSuggestions = ref([])
/** 'field' | 'object' */
const suggestKind = ref('field')
const suggestIndex = ref(0)
const suggestReplace = ref(null) // { start, end }
const limitEnabled = tabField('limitEnabled')
const queryLimit = tabField('queryLimit')
const executing = tabField('executing')
const countingTotal = tabField('countingTotal')
const objectCountHint = tabField('objectCountHint')
const resultColumns = tabField('resultColumns')
const resultRows = tabField('resultRows')
const resultDone = tabField('resultDone')
const resultTotalSize = tabField('resultTotalSize')
const resultNextUrl = tabField('resultNextUrl')
const cellEdits = tabField('cellEdits')
const selectedCell = tabField('selectedCell')
const editingCell = tabField('editingCell')
const errorMessage = tabField('errorMessage')
/** 表格内最多继续加载到的行数，防止一次塞太多导致卡顿 */
const RESULT_SOFT_CAP = 10000

/** 单元格编辑：key = `${rowIdx}::${col}` → { original, current } */
const cellEditorEl = ref(null)
const ctxMenu = ref({ show: false, x: 0, y: 0, canCopy: false, row: -1, col: '' })
const submitConfirmOpen = ref(false)
const submittingEdits = ref(false)

let client = null

const selectedEnv = computed(() => envs.value.find((e) => e.id === selectedEnvId.value) || null)

const canExecute = computed(() => !!selectedEnv.value && !!soqlText.value.trim())
const canCountObject = computed(() => !!selectedEnv.value && !!parseManualSoql(soqlText.value, {}).objectName)
/** 软上限只约束自动续拉；手动「继续加载」只要还有下一页就可用 */
const canLoadMore = computed(
  () =>
    !!selectedEnv.value &&
    resultDone.value === false &&
    !!resultNextUrl.value &&
    resultRows.value.length > 0
)

function fieldLabel(apiName) {
  return fieldsMap.value[apiName]?.label || apiName
}

function picklistOptions(apiName) {
  return activePicklistOptions(fieldsMap.value[apiName])
}

async function copyText(text) {
  const value = String(text || '')
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    showToast(t('soql.copied', { value }))
  } catch {
    errorMessage.value = t('soql.copyFailed')
  }
}

function formatCell(val) {
  if (val == null) return ''
  if (typeof val === 'object') {
    if (val.records) return `[${val.records.length} records]`
    return JSON.stringify(val)
  }
  return String(val)
}

function cellKey(rowIdx, col) {
  return `${rowIdx}::${col}`
}

function isCellSelected(rowIdx, col) {
  return selectedCell.value?.row === rowIdx && selectedCell.value?.col === col
}

function isCellEditing(rowIdx, col) {
  return editingCell.value?.row === rowIdx && editingCell.value?.col === col
}

function isCellDirty(rowIdx, col) {
  return !!cellEdits.value[cellKey(rowIdx, col)]
}

function cellRawOriginal(rowIdx, col) {
  return resultRows.value[rowIdx]?.[col]
}

function fieldType(col) {
  return fieldsMap.value[col]?.type || 'string'
}

function cellFieldKind(col) {
  return valueKind(fieldType(col))
}

function isFieldNillable(col) {
  return fieldsMap.value[col]?.nillable !== false
}

function textInputType(col) {
  const t = fieldType(col)
  if (t === 'email') return 'email'
  if (t === 'url') return 'url'
  if (t === 'phone') return 'tel'
  return 'text'
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Salesforce datetime → datetime-local（本地时区） */
function sfDatetimeToLocal(iso) {
  const s = String(iso || '').trim()
  if (!s) return ''
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)
  return m ? m[1] : s
}

function localToSfDatetime(local) {
  const v = String(local || '').trim()
  if (!v) return null
  const d = new Date(v)
  if (!Number.isNaN(d.getTime())) return d.toISOString()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return `${v}:00.000Z`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
    return v.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`
  }
  return v
}

function sfTimeToInput(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  // 17:30:00.000Z / 17:30:00
  const m = s.match(/^(\d{2}:\d{2}(?::\d{2})?)/)
  return m ? m[1] : s.slice(0, 8)
}

/** 原始值 → 编辑控件字符串（与控件 value 对齐） */
function rawToEditString(col, raw) {
  const kind = cellFieldKind(col)
  if (raw == null || raw === '') return ''
  if (kind === 'boolean') return raw === true || String(raw).toLowerCase() === 'true' ? 'true' : 'false'
  if (kind === 'datetime') return sfDatetimeToLocal(raw)
  if (kind === 'date') return String(raw).slice(0, 10)
  if (kind === 'time') return sfTimeToInput(raw)
  if (kind === 'number') return String(raw)
  if (fieldType(col) === 'multipicklist') return String(raw)
  return formatCell(raw)
}

function cellEditorValue(rowIdx, col) {
  const edit = cellEdits.value[cellKey(rowIdx, col)]
  if (edit) return edit.current
  return rawToEditString(col, cellRawOriginal(rowIdx, col))
}

function cellEditorMultiValues(rowIdx, col) {
  const raw = cellEditorValue(rowIdx, col)
  if (!raw) return []
  return String(raw).split(';').map((s) => s.trim()).filter(Boolean)
}

function cellDisplayValue(rowIdx, col) {
  const edit = cellEdits.value[cellKey(rowIdx, col)]
  if (edit) {
    if (cellFieldKind(col) === 'boolean') {
      if (edit.current === '') return ''
      return edit.current === 'true' ? 'true' : 'false'
    }
    return edit.current
  }
  return formatCell(cellRawOriginal(rowIdx, col))
}

const hasDirtyCells = computed(() => Object.keys(cellEdits.value).length > 0)
const dirtyEditCount = computed(() => Object.keys(cellEdits.value).length)

const dirtyEditPreview = computed(() => {
  const list = []
  for (const [key, edit] of Object.entries(cellEdits.value)) {
    const [rowStr, col] = key.split('::')
    const rowIdx = Number(rowStr)
    const row = resultRows.value[rowIdx]
    list.push({
      key,
      objectApi: rowObjectType(row) || currentObject.value?.name || '?',
      field: col,
      from: edit.original,
      to: edit.current
    })
  }
  return list.slice(0, 12)
})

function clearCellEdits() {
  cellEdits.value = {}
  selectedCell.value = null
  editingCell.value = null
}

function setCellEditorRef(el) {
  if (el) cellEditorEl.value = el
}

function selectResultCell(rowIdx, col) {
  if (editingCell.value && !isCellEditing(rowIdx, col)) {
    commitEditCell()
  }
  selectedCell.value = { row: rowIdx, col }
}

function canEditColumn(col) {
  if (!col || col === 'Id' || col === 'attributes' || col.includes('.')) return false
  const meta = fieldsMap.value[col]
  if (meta && meta.updateable === false) return false
  return true
}

function startEditCell(rowIdx, col) {
  if (!canEditColumn(col)) {
    showToast(t('soql.fieldNotEditable', { field: col }))
    return
  }
  const raw = cellRawOriginal(rowIdx, col)
  if (raw != null && typeof raw === 'object') {
    showToast(t('soql.fieldComplexType', { field: col }))
    return
  }
  selectedCell.value = { row: rowIdx, col }
  editingCell.value = { row: rowIdx, col }
  nextTick(() => {
    const el = cellEditorEl.value
    if (el) {
      el.focus()
      el.select?.()
    }
  })
}

function applyCellEdit(rowIdx, col, value) {
  const key = cellKey(rowIdx, col)
  const existing = cellEdits.value[key]
  const original = existing ? existing.original : rawToEditString(col, cellRawOriginal(rowIdx, col))
  const current = String(value ?? '')
  const next = { ...cellEdits.value }
  if (current === String(original)) {
    delete next[key]
  } else {
    next[key] = { original, current }
  }
  cellEdits.value = next
}

function onCellEditorInput(rowIdx, col, value) {
  applyCellEdit(rowIdx, col, value)
}

function onCellEditorChange(rowIdx, col, value) {
  applyCellEdit(rowIdx, col, value)
  // 下拉类改完即退出编辑，减少二次点击
  if (cellFieldKind(col) === 'boolean' || cellFieldKind(col) === 'picklist') {
    commitEditCell()
  }
}

function onCellEditorMultiChange(rowIdx, col, selectEl) {
  const values = Array.from(selectEl.selectedOptions || []).map((o) => o.value)
  applyCellEdit(rowIdx, col, values.join(';'))
}

function commitEditCell() {
  editingCell.value = null
}

function onCellEditorBlur(e) {
  const cell = e.currentTarget?.closest?.('td.result-cell')
  if (cell && e.relatedTarget && cell.contains(e.relatedTarget)) return
  // 等 change/input 先落盘（日期面板、下拉）
  setTimeout(() => {
    if (!editingCell.value) return
    const active = document.activeElement
    if (active?.closest?.('.cell-editor')) return
    commitEditCell()
  }, 0)
}

function cancelEditCell() {
  if (!editingCell.value) return
  const { row, col } = editingCell.value
  const key = cellKey(row, col)
  const next = { ...cellEdits.value }
  delete next[key]
  cellEdits.value = next
  editingCell.value = null
}

function revertAllEdits() {
  clearCellEdits()
  showToast(t('soql.revertedEdits'))
}

function openSubmitConfirm() {
  if (!hasDirtyCells.value) return
  commitEditCell()
  submitConfirmOpen.value = true
}

async function confirmSubmitEdits() {
  if (!client || !hasDirtyCells.value) return
  submittingEdits.value = true
  errorMessage.value = ''
  try {
    const env = selectedEnv.value
    if (env) {
      const res = await fetchSfSession(env.hostname)
      if (res?.success && res.session?.sessionId) {
        client.sessionId = res.session.sessionId
        client.hostname = res.session.hostname || client.hostname
      }
    }

    // 按记录聚合 PATCH 字段
    const byRecord = new Map()
    for (const [key, edit] of Object.entries(cellEdits.value)) {
      const [rowStr, col] = key.split('::')
      const rowIdx = Number(rowStr)
      const row = resultRows.value[rowIdx]
      const id = rowRecordId(row)
      const objectApi = rowObjectType(row) || currentObject.value?.name
      if (!id || !objectApi) {
        throw new Error(t('soql.rowMissingId', { row: rowIdx + 1 }))
      }
      const mapKey = `${objectApi}::${id}`
      if (!byRecord.has(mapKey)) {
        byRecord.set(mapKey, { objectApi, id, rowIdx, fields: {} })
      }
      byRecord.get(mapKey).fields[col] = coerceEditValue(col, edit.current)
    }

    for (const item of byRecord.values()) {
      await client.updateSObject(item.objectApi, item.id, item.fields)
      // 回写本地行，保持与服务器一致
      const row = resultRows.value[item.rowIdx]
      if (row) {
        Object.assign(row, item.fields)
      }
    }

    clearCellEdits()
    submitConfirmOpen.value = false
    showToast(t('soql.submittedRecords', { count: byRecord.size }))
  } catch (e) {
    errorMessage.value = e?.message || String(e)
  } finally {
    submittingEdits.value = false
  }
}

function coerceEditValue(col, text) {
  const type = fieldType(col)
  const kind = valueKind(type)
  const raw = String(text ?? '')
  if (kind === 'boolean') {
    if (raw === '') return null
    return raw === 'true'
  }
  if (kind === 'datetime') {
    return localToSfDatetime(raw)
  }
  if (kind === 'date' || kind === 'time') {
    if (raw === '') return null
    return raw
  }
  if (type === 'int' || type === 'long') {
    if (raw === '') return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? n : raw
  }
  if (type === 'double' || type === 'currency' || type === 'percent') {
    if (raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  if (raw === '') return null
  return raw
}

function onAppContextMenu(e) {
  // 编辑中：交给原生菜单（只复制选中文本）
  if (e.target.closest('.cell-editor')) {
    ctxMenu.value = { ...ctxMenu.value, show: false }
    return
  }
  e.preventDefault()
  const td = e.target.closest('td.result-cell')
  if (!td) {
    ctxMenu.value = { ...ctxMenu.value, show: false }
    return
  }
  // 从 DOM 找行列：用选中逻辑 —— 右键时根据最近的 cell
  // 通过遍历不太优雅；在 template 上 data-row/data-col
  const row = Number(td.dataset.row)
  const col = td.dataset.col
  if (!Number.isFinite(row) || !col) {
    ctxMenu.value = { ...ctxMenu.value, show: false }
    return
  }
  if (editingCell.value) commitEditCell()
  selectedCell.value = { row, col }
  const pad = 4
  let x = e.clientX
  let y = e.clientY
  const menuW = 120
  const menuH = 40
  if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - pad
  if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - pad
  ctxMenu.value = {
    show: true,
    x,
    y,
    canCopy: true,
    row,
    col
  }
}

function onAppClick() {
  if (ctxMenu.value.show) ctxMenu.value = { ...ctxMenu.value, show: false }
}

async function ctxCopyCell() {
  const { row, col, canCopy } = ctxMenu.value
  ctxMenu.value = { ...ctxMenu.value, show: false }
  if (!canCopy) return
  await copyText(cellDisplayValue(row, col))
}

function closeCtxOnScroll() {
  if (ctxMenu.value.show) ctxMenu.value = { ...ctxMenu.value, show: false }
}

function onDocPointerDown(e) {
  if (!ctxMenu.value.show) return
  if (e.target?.closest?.('.ctx-menu')) return
  ctxMenu.value = { ...ctxMenu.value, show: false }
}

async function applyPreferredEnv() {
  const preferred = pickEnvForPage(envs.value, pagePrefer.value)
  if (!preferred) return false
  if (selectedEnvId.value === preferred.id && client) return true
  selectedEnvId.value = preferred.id
  await connectSelectedEnv()
  return true
}

async function refreshEnvs() {
  loadingEnvs.value = true
  errorMessage.value = ''
  try {
    const res = await listSfEnvironments()
    if (!res?.success) throw new Error(res?.error || t('soql.scanEnvsFailed'))
    envs.value = res.environments || []
    const preferredApplied = await applyPreferredEnv()
    if (!preferredApplied && !envs.value.find((e) => e.id === selectedEnvId.value)) {
      selectedEnvId.value = envs.value[0]?.id || ''
      if (selectedEnvId.value) await connectSelectedEnv()
      else {
        resetWorkspace()
      }
    }
    if (envs.value.length === 0) {
      showToast(t('soql.noEnvsFound'))
    } else {
      showToast(t('soql.envsFound', { count: envs.value.length }))
    }
  } catch (e) {
    errorMessage.value = e.message || String(e)
  } finally {
    loadingEnvs.value = false
  }
}

function queryTabTitle(tab) {
  if (tab?.titled && tab.title) return tab.title
  return t('soql.newTab')
}

function rememberTabScroll(state) {
  state.resultsScroll = resultsWrapEl.value?.scrollTop || 0
  if (soqlEditorEl.value) {
    state.editorStart = soqlEditorEl.value.selectionStart
    state.editorEnd = soqlEditorEl.value.selectionEnd
  }
}

function restoreTabScroll(state) {
  if (resultsWrapEl.value) resultsWrapEl.value.scrollTop = state.resultsScroll || 0
  if (soqlEditorEl.value && state.editorStart != null) {
    const end = state.editorEnd ?? state.editorStart
    soqlEditorEl.value.setSelectionRange(state.editorStart, end)
  }
}

function resetQueryTabs() {
  for (const tab of queryTabs.value) abortWorkspace(tab)
  const fresh = createQueryTabState()
  switchingTab = true
  queryTabs.value = [fresh]
  activeTabId.value = fresh.id
  nextTick(() => {
    switchingTab = false
  })
}

function switchQueryTab(id) {
  if (id === activeTabId.value) return
  const current = activeState()
  rememberTabScroll(current)
  if (current.editingCell) current.editingCell = null
  clearFieldSuggestions()
  submitConfirmOpen.value = false
  ctxMenu.value = { ...ctxMenu.value, show: false }
  switchingTab = true
  activeTabId.value = id
  nextTick(() => {
    restoreTabScroll(activeState())
    switchingTab = false
  })
}

function addQueryTab() {
  rememberTabScroll(activeState())
  const tab = createQueryTabState()
  queryTabs.value = [...queryTabs.value, tab]
  switchQueryTab(tab.id)
}

function closeQueryTab(id) {
  const list = queryTabs.value
  if (list.length <= 1) return
  const index = list.findIndex((tab) => tab.id === id)
  if (index < 0) return
  abortWorkspace(list[index])
  if (activeTabId.value === id) {
    const neighbor = list[index === list.length - 1 ? index - 1 : index + 1]
    switchQueryTab(neighbor.id)
  }
  queryTabs.value = queryTabs.value.filter((tab) => tab.id !== id)
}

function nameTabFromQuery(state) {
  const raw = parseManualSoql(state.soqlText, state.fieldsMap).objectName
  if (!raw) return
  const listed = objects.value.find((obj) => obj.name.toLowerCase() === raw.toLowerCase())
  state.title = listed?.name || raw
  state.titled = true
}

function resetWorkspace() {
  objects.value = []
  resetQueryTabs()
  clearFieldSuggestions()
  describeCache.clear()
  describeFailed.clear()
  client = null
}

async function connectSelectedEnv() {
  const env = selectedEnv.value
  if (!env) {
    resetWorkspace()
    return
  }
  errorMessage.value = ''
  showToast(t('soql.fetchingSession'))
  try {
    const res = await fetchSfSession(env.hostname)
    if (!res?.success || !res.session?.sessionId) {
      throw new Error(res?.error || t('soql.sessionFailed'))
    }
    client = new SfRestClient({
      hostname: res.session.hostname || env.hostname,
      sessionId: res.session.sessionId
    })
    showToast(t('soql.connected', { hostname: client.hostname }))
    await loadObjects()
  } catch (e) {
    client = null
    objects.value = []
    errorMessage.value = e.message || String(e)
    showToast('')
  }
}

async function onEnvChange() {
  resetQueryTabs()
  clearFieldSuggestions()
  describeCache.clear()
  describeFailed.clear()
  await connectSelectedEnv()
}

function filterApplicationObjects(sobjects) {
  const whitelist = new Set(DEFAULT_STANDARD_WHITELIST)
  return (sobjects || [])
    .filter((obj) => obj.queryable && obj.retrieveable)
    .filter((obj) => getObjectKind(obj.name) !== 'share')
    .filter((obj) => {
      const kind = getObjectKind(obj.name)
      if (kind === 'custom') return true
      if (kind === 'standard') return whitelist.has(obj.name)
      // metadata / system：默认隐藏，避免列表过长
      return false
    })
    .map((obj) => ({
      name: obj.name,
      label: obj.label || obj.name,
      custom: !!obj.custom
    }))
    .sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name))
}

async function loadObjects() {
  if (!client) return
  loadingObjects.value = true
  errorMessage.value = ''
  try {
    const data = await client.getSObjects()
    objects.value = filterApplicationObjects(data?.sobjects)
  } catch (e) {
    objects.value = []
    errorMessage.value = e.message || String(e)
  } finally {
    loadingObjects.value = false
  }
}

function rowRecordId(row) {
  if (!row) return ''
  if (row.Id || row.id) return row.Id || row.id
  // REST 查询即使未 SELECT Id，也会在 attributes.url 中带上记录 Id
  // 形如 /services/data/v64.0/sobjects/Account/001xxxxxxxxxxxx
  const url = row.attributes?.url || ''
  const m = String(url).match(/\/sobjects\/[^/]+\/([a-zA-Z0-9]{15,18})(?:\/|$|\?)/)
  return m?.[1] || ''
}

function rowObjectType(row) {
  return row?.attributes?.type || currentObject.value?.name || ''
}

async function openRecordDetail(row) {
  const objectApi = rowObjectType(row)
  const id = rowRecordId(row)
  const hostname = selectedEnv.value?.hostname || client?.hostname
  if (!hostname) {
    errorMessage.value = t('soql.selectEnvFirst')
    return
  }
  if (!objectApi || !id) {
    errorMessage.value = t('soql.openRecordDetailFailed')
    return
  }
  try {
    showToast(t('soql.openingRecordDetail', { id }))
    await openObjectDetailTab({ objectName: objectApi, hostname, recordId: id })
    showToast(t('soql.openedRecordDetail', { id }))
  } catch (e) {
    errorMessage.value = e?.message || t('soql.openObjectDetailFailed')
    showToast('')
  }
}

function syncLimitInSoql(state = activeState()) {
  const raw = String(state.soqlText || '')
  const stripped = raw.replace(/\s+LIMIT\s+\d+\s*$/i, '').trimEnd()
  if (!state.limitEnabled) {
    if (stripped !== raw.trimEnd()) state.soqlText = stripped
    return
  }
  const limit = Math.min(Math.max(Number(state.queryLimit) || 10, 1), 2000)
  const next = stripped ? `${stripped} LIMIT ${limit}` : ''
  if (next && next !== raw.trimEnd()) state.soqlText = next
}

function clearFieldSuggestions() {
  fieldSuggestions.value = []
  suggestKind.value = 'field'
  suggestIndex.value = 0
  suggestReplace.value = null
}

function commitSuggestionList(list, kind, range) {
  const prevNames = fieldSuggestions.value.map((i) => i.name).join('\0')
  const nextNames = list.map((i) => i.name).join('\0')
  const prevKind = suggestKind.value
  fieldSuggestions.value = list
  suggestKind.value = kind
  suggestReplace.value = list.length ? range : null
  if (prevNames !== nextNames || prevKind !== kind) {
    suggestIndex.value = 0
  } else if (suggestIndex.value >= list.length) {
    suggestIndex.value = Math.max(0, list.length - 1)
  }
}

function rememberDescribe(name, desc) {
  const packed = mapDescribe(desc)
  describeCache.set(String(name || '').toLowerCase(), packed)
  describeFailed.delete(String(name || '').toLowerCase())
  return packed
}

function relatedDescribeSnapshot() {
  const currentKey = String(currentObject.value?.name || '').toLowerCase()
  /** @type {Record<string, { fields: Record<string, any>, children: Array }>} */
  const snapshot = {}
  for (const [name, packed] of describeCache) {
    if (name === currentKey) continue
    snapshot[name] = packed
  }
  return snapshot
}

function ensureRelatedDescribe(name) {
  const key = String(name || '').toLowerCase()
  if (!key || !client || describeCache.has(key) || describeFailed.has(key)) return
  if (describeInflight.has(key)) return
  const task = client
    .describeSObject(name)
    .then((desc) => {
      rememberDescribe(name, desc)
    })
    .catch(() => {
      describeFailed.add(key)
    })
    .finally(() => {
      describeInflight.delete(key)
      refreshFieldSuggestions()
    })
  describeInflight.set(key, task)
}

/** 编辑器联想：对象 / 字段 / 关键字 / WHERE / 关系路径 */
function refreshFieldSuggestions() {
  if (!soqlEditorOpen.value) {
    clearFieldSuggestions()
    return
  }
  const el = soqlEditorEl.value
  const cursor = el ? el.selectionStart : soqlText.value.length
  const result = buildSoqlSuggestions({
    text: soqlText.value,
    cursor,
    objects: objects.value,
    fieldsMap: fieldsMap.value,
    currentObjectName: currentObject.value?.name || '',
    childRelationships: childRelationships.value,
    relatedDescribes: relatedDescribeSnapshot()
  })
  if (result.pendingDescribe) ensureRelatedDescribe(result.pendingDescribe)
  if (!result.items.length) {
    clearFieldSuggestions()
    return
  }
  commitSuggestionList(result.items, result.kind, result.range)
}

function onSoqlEditorActivity(e) {
  // 导航键由 keydown 处理，keyup 再刷新会重置选中项
  if (e?.type === 'keyup') {
    const k = e.key
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === 'Tab' || k === 'Escape') {
      return
    }
  }
  nextTick(refreshFieldSuggestions)
}

/** 选中 FROM 对象时：加载 describe 供后续字段联想，不重写用户手写 SOQL */
async function hydrateObjectFromSuggest(obj) {
  if (!client || !obj?.name) return
  const state = activeState()
  if (
    state.currentObject?.name === obj.name &&
    Object.keys(state.fieldsMap).length > 0
  ) {
    return
  }
  state.currentObject = obj
  try {
    const desc = await client.describeSObject(obj.name)
    if (state.currentObject?.name !== obj.name) return
    const packed = rememberDescribe(obj.name, desc)
    state.fieldsMap = packed.fields
    state.childRelationships = packed.children
  } catch (e) {
    state.fieldsMap = {}
    state.childRelationships = []
    state.errorMessage = e.message || String(e)
  }
}

function suggestItemLabel(item) {
  if (item?.kind === 'keyword') return t('soql.suggestKindKeyword')
  if (item?.kind === 'operator') return t('soql.suggestKindOperator')
  if (item?.kind === 'relationship') {
    return item.label || t('soql.suggestKindRelationship')
  }
  if (item?.kind === 'child') return item.label || t('soql.suggestKindChild')
  if (item?.kind === 'function') return t('soql.suggestKindFunction')
  if (item?.kind === 'value') {
    if (
      item.label &&
      item.label !== 'boolean' &&
      item.label !== 'picklist' &&
      item.label !== 'date literal'
    ) {
      return item.label
    }
    if (item.label === 'date literal') return item.label
    return t('soql.suggestKindValue')
  }
  return item?.label || ''
}

function applyFieldSuggestion(item) {
  if (!item?.name || !suggestReplace.value) return
  const { start, end } = suggestReplace.value
  const insert = item.insertText != null ? item.insertText : item.name
  const text = soqlText.value
  soqlText.value = text.slice(0, start) + insert + text.slice(end)
  const appliedKind = item.kind || suggestKind.value
  clearFieldSuggestions()
  if (appliedKind === 'object') {
    void hydrateObjectFromSuggest(item._obj || { name: item.name, label: item.label })
  }
  nextTick(() => {
    const el = soqlEditorEl.value
    if (!el) return
    const pos = start + insert.length
    el.focus()
    el.setSelectionRange(pos, pos)
    refreshFieldSuggestions()
  })
}

function onSoqlSuggestKeydown(e) {
  if (!fieldSuggestions.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    suggestIndex.value = (suggestIndex.value + 1) % fieldSuggestions.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    suggestIndex.value =
      (suggestIndex.value - 1 + fieldSuggestions.value.length) % fieldSuggestions.value.length
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    applyFieldSuggestion(fieldSuggestions.value[suggestIndex.value])
  } else if (e.key === 'Escape') {
    clearFieldSuggestions()
  }
}

async function copySoql() {
  try {
    await navigator.clipboard.writeText(soqlText.value)
    showToast(t('soql.soqlCopied'))
  } catch {
    errorMessage.value = t('soql.copyFailed')
  }
}

function mergeResultColumns(records, state = activeState()) {
  const cols = new Set(state.resultColumns)
  for (const rec of records) {
    Object.keys(rec || {}).forEach((k) => {
      if (k !== 'attributes') cols.add(k)
    })
  }
  state.resultColumns = Array.from(cols)
}

function csvEscape(val) {
  if (val == null) return ''
  let s
  if (typeof val === 'object') {
    s = val.records ? `[${val.records.length} records]` : JSON.stringify(val)
  } else {
    s = String(val)
  }
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function exportResultsCsv() {
  if (!resultRows.value.length || !resultColumns.value.length) return
  const cols = resultColumns.value
  const lines = [cols.map(csvEscape).join(',')]
  for (const row of resultRows.value) {
    lines.push(cols.map((c) => csvEscape(row?.[c])).join(','))
  }
  const bom = '\uFEFF'
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  a.href = url
  a.download = `soql-results-${stamp}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  showToast(t('soql.csvExported', { count: resultRows.value.length }))
}

async function refreshSessionIfNeeded() {
  const env = selectedEnv.value
  if (!env || !client) return
  const res = await fetchSfSession(env.hostname)
  if (res?.success && res.session?.sessionId) {
    client.sessionId = res.session.sessionId
    client.hostname = res.session.hostname || client.hostname
  }
}

/**
 * 基于当前对象 + WHERE 条件生成 COUNT，不读也不改 soqlText
 */
function buildObjectCountSoql(state = activeState()) {
  const name = parseManualSoql(state.soqlText, {}).objectName
  if (!name) return ''
  const src = String(state.soqlText || '')
  const where = src.match(/\bWHERE\b[\s\S]*?(?=\b(?:GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET|HAVING|WITH|FOR)\b|$)/i)
  let soql = `SELECT COUNT() FROM ${name}`
  if (where && where[0].trim()) soql += ` ${where[0].trim()}`
  return soql
}

function yieldToUi() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })
}

function abortWorkspace(state) {
  if (!state?.abortController) return
  try {
    state.abortController.abort()
  } catch {
    /* ignore */
  }
}

function stopQuery() {
  abortWorkspace(activeState())
}

function stopAllQueries() {
  for (const tab of queryTabs.value) abortWorkspace(tab)
}

function beginQueryRun(state = activeState()) {
  abortWorkspace(state)
  state.abortController = new AbortController()
  state.queryRunId += 1
  return { signal: state.abortController.signal, runId: state.queryRunId, state }
}

function isAbortError(e) {
  return e?.name === 'AbortError' || /abort|取消/i.test(String(e?.message || ''))
}

function applyQueryPage(data, { append = false, state = activeState() } = {}) {
  const records = (data?.records || []).map(flattenSoqlRecord)
  if (!append) {
    state.resultColumns = []
    state.resultRows = []
  }
  mergeResultColumns(records, state)
  // 整页追加，不在页内截断，避免丢掉本页后半段却丢掉 nextUrl 对应关系
  state.resultRows = append ? state.resultRows.concat(records) : records

  const serverDone = data?.done !== false
  const next = data?.nextRecordsUrl || ''
  state.resultDone = serverDone
  state.resultNextUrl = serverDone ? '' : next

  if (typeof data?.totalSize === 'number') state.resultTotalSize = data.totalSize
  else if (!append) state.resultTotalSize = records.length
}

/**
 * 分阶段拉取后续页。
 * @param maxRows 本轮最多加载到的行数（自动查询用软上限；手动继续 = 当前行数 + 软上限）
 */
async function continueQueryPages(signal, runId, { maxRows = RESULT_SOFT_CAP, state = activeState() } = {}) {
  let guard = 0
  while (
    runId === state.queryRunId &&
    !signal.aborted &&
    state.resultDone === false &&
    state.resultNextUrl &&
    state.resultRows.length < maxRows &&
    guard < 200
  ) {
    guard += 1
    await yieldToUi()
    if (signal.aborted || runId !== state.queryRunId) break
    const data = await client.queryMore(state.resultNextUrl, { signal })
    if (signal.aborted || runId !== state.queryRunId) break
    applyQueryPage(data, { append: true, state })
    if (state.resultRows.length >= maxRows && !state.resultDone && state.resultNextUrl) {
      if (state === activeState()) {
        showToast(t('soql.loadMoreCapped', {
          loaded: state.resultRows.length,
          total: state.resultTotalSize ?? state.resultRows.length
        }))
      }
      break
    }
  }
}

function toastOnTab(state, message) {
  if (state === activeState()) showToast(message)
}

async function countObjectRows() {
  const state = activeState()
  if (!state.currentObject || !selectedEnv.value) return
  if (!client) {
    state.errorMessage = t('soql.selectEnvFirst')
    return
  }
  const countSoql = buildObjectCountSoql(state)
  if (!countSoql) {
    state.errorMessage = t('soql.countSoqlFailed')
    return
  }
  state.countingTotal = true
  state.errorMessage = ''
  // 不碰 soqlText / 结果区
  try {
    await refreshSessionIfNeeded()
    const total = await client.countQuery(countSoql)
    const label = state.currentObject?.label || state.currentObject?.name
    state.objectCountHint = t('soql.objectCountHint', {
      object: label,
      total
    })
    toastOnTab(state, t('soql.countResult', { total }))
  } catch (e) {
    state.errorMessage = e.message || String(e)
  } finally {
    state.countingTotal = false
  }
}

async function loadMoreResults() {
  const state = activeState()
  if (!client || !state.resultNextUrl || state.resultDone !== false || state.executing) return
  if (!state.resultRows.length) return
  const { signal, runId } = beginQueryRun(state)
  state.executing = true
  state.errorMessage = ''
  toastOnTab(state, t('soql.loadingMore'))
  const batchTarget = state.resultRows.length + RESULT_SOFT_CAP
  try {
    await refreshSessionIfNeeded()
    await continueQueryPages(signal, runId, { maxRows: batchTarget, state })
    if (signal.aborted) {
      toastOnTab(state, t('soql.queryCancelled', {
        loaded: state.resultRows.length,
        total: state.resultTotalSize ?? state.resultRows.length
      }))
    } else if (state.resultDone || !state.resultNextUrl) {
      toastOnTab(state, t('soql.rowsLoadedOfTotal', {
        loaded: state.resultRows.length,
        total: state.resultTotalSize ?? state.resultRows.length
      }))
    } else {
      toastOnTab(state, t('soql.loadMoreCapped', {
        loaded: state.resultRows.length,
        total: state.resultTotalSize ?? state.resultRows.length
      }))
    }
  } catch (e) {
    if (isAbortError(e)) {
      toastOnTab(state, t('soql.queryCancelled', {
        loaded: state.resultRows.length,
        total: state.resultTotalSize ?? state.resultRows.length
      }))
    } else {
      state.errorMessage = e.message || String(e)
    }
  } finally {
    if (runId === state.queryRunId) {
      state.executing = false
      state.abortController = null
    }
  }
}

async function executeQuery() {
  const state = activeState()
  if (!client || !state.soqlText.trim() || state.executing) return
  const { signal, runId } = beginQueryRun(state)
  const soql = state.soqlText.trim()
  state.executing = true
  state.errorMessage = ''
  toastOnTab(state, t('soql.executing'))
  state.resultColumns = []
  state.resultRows = []
  state.resultDone = true
  state.resultTotalSize = null
  state.resultNextUrl = ''
  state.cellEdits = {}
  state.selectedCell = null
  state.editingCell = null
  try {
    await refreshSessionIfNeeded()
    const data = await client.query(soql, { signal })
    if (signal.aborted || runId !== state.queryRunId) return
    applyQueryPage(data, { append: false, state })
    nameTabFromQuery(state)

    if (!state.resultDone && state.resultNextUrl) {
      await continueQueryPages(signal, runId, { maxRows: RESULT_SOFT_CAP, state })
    }

    if (signal.aborted) {
      toastOnTab(state, t('soql.queryCancelled', {
        loaded: state.resultRows.length,
        total: state.resultTotalSize ?? state.resultRows.length
      }))
    } else if (!state.resultDone && state.resultNextUrl) {
      toastOnTab(state, t('soql.loadMoreCapped', {
        loaded: state.resultRows.length,
        total: state.resultTotalSize ?? state.resultRows.length
      }))
    } else {
      toastOnTab(state, t('soql.rowsLoadedOfTotal', {
        loaded: state.resultRows.length,
        total: state.resultTotalSize ?? state.resultRows.length
      }))
    }
  } catch (e) {
    if (isAbortError(e)) {
      toastOnTab(state, t('soql.queryCancelled', {
        loaded: state.resultRows.length,
        total: state.resultTotalSize ?? state.resultRows.length
      }))
    } else {
      state.errorMessage = e.message || String(e)
      if (state === activeState()) showToast('')
    }
  } finally {
    if (runId === state.queryRunId) {
      state.executing = false
      state.abortController = null
    }
  }
}

watch([limitEnabled, queryLimit], () => {
  if (switchingTab) return
  syncLimitInSoql()
})

watch(soqlEditorOpen, (open) => {
  if (!open) clearFieldSuggestions()
})

watch(currentObject, () => {
  if (switchingTab) return
  objectCountHint.value = ''
})

function onPreferEnvironmentMessage(message) {
  if (message?.action !== 'toolPreferEnvironment' || message.toolId !== 'soql') return
  pagePrefer.value = {
    hostname: message.hostname || '',
    orgId: message.orgId || ''
  }
  applyPreferredEnv().catch(() => {})
}

onMounted(() => {
  refreshEnvs()
  window.addEventListener('scroll', closeCtxOnScroll, true)
  document.addEventListener('pointerdown', onDocPointerDown, true)
  try {
    chrome.runtime?.onMessage?.addListener(onPreferEnvironmentMessage)
  } catch {
    /* ignore */
  }
})

onUnmounted(() => {
  stopAllQueries()
  window.removeEventListener('scroll', closeCtxOnScroll, true)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  try {
    chrome.runtime?.onMessage?.removeListener(onPreferEnvironmentMessage)
  } catch {
    /* ignore */
  }
})
</script>

<style scoped>
/* 主题色：.theme-soql → src/tools/_shared/toolThemes.css（与浮动入口橙黄一致） */
.soql-app {
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  padding: var(--gap);
  box-sizing: border-box;
  color: var(--text);
  background: var(--page);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.soql-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
  border-radius: var(--radius);
  box-shadow: var(--header-shadow);
  color: #fff;
}

.soql-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--title-on-header);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
  line-height: 1.2;
}

.soql-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.env-select {
  min-width: 260px;
  max-width: 360px;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.95);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 500;
}

.env-select:focus {
  outline: none;
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
}

.soql-empty {
  flex: 1;
  min-height: 0;
  overflow: auto;
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
  box-shadow: var(--card-shadow);
}

.empty-card h2 {
  margin: 0 0 10px;
  font-size: 16px;
  color: var(--accent-deep);
}

.empty-card p {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}

.soql-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.soql-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  overflow-x: auto;
  padding: 0 2px;
}

.soql-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  min-width: 72px;
  border: 1px solid var(--border);
  border-bottom: none;
  background: var(--panel);
  color: var(--muted);
  border-radius: 8px 8px 0 0;
  padding: 7px 8px 7px 12px;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
}

.soql-tab.active {
  background: var(--card);
  color: var(--accent-deep);
  font-weight: 600;
  box-shadow: var(--shadow);
}

.soql-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.soql-tab-close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
  font-size: 14px;
}

.soql-tab-close:hover {
  color: var(--accent-deep);
}

.soql-tab-add {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin: 0 0 2px 2px;
  border: 1px dashed var(--border-hover);
  border-radius: 8px;
  background: transparent;
  color: var(--accent-deep);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.soql-tab-add:hover {
  background: var(--soft);
  border-color: var(--accent);
}

.soql-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: var(--gap);
}

.panel,
.query-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  box-shadow: var(--shadow);
}

.panel-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-deep);
}

.count {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: var(--soft);
  padding: 2px 8px;
  border-radius: 999px;
}

.search-input {
  flex-shrink: 0;
  margin: 8px 10px 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  background: #fff;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.list-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
  background: var(--panel);
}

.list-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.12s ease, border-color 0.12s ease;
  box-sizing: border-box;
}

.list-item:hover {
  border-color: var(--border-hover);
  background: var(--soft-tint);
}

.list-item.active {
  background: var(--soft);
  border-color: var(--border-hover);
}

.item-top {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.item-label {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.obj-detail-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 0 5px;
  height: 18px;
  line-height: 16px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}

.obj-detail-btn:hover {
  background: var(--soft);
  border-color: var(--accent);
}

.obj-detail-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.item-api {
  font-size: 11px;
  color: #78909c;
  font-family: Consolas, 'Courier New', monospace;
}

.field-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-toolbar .search-input {
  margin-bottom: 0;
}

.field-filter-chips,
.field-mode-chips {
  display: flex;
  gap: 4px;
  padding: 0 10px;
}

.chip {
  flex: 1;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  color: #5c7a9b;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.chip:hover:not(:disabled) {
  border-color: var(--border-hover);
  background: var(--panel);
  color: var(--accent-2);
}

.chip.active {
  background: var(--soft);
  border-color: var(--accent);
  color: var(--accent-deep);
}

.chip-select.active {
  background: var(--soft);
  border-color: var(--accent);
  color: var(--accent-deep);
}

.chip-where.active {
  background: #e0f2f1;
  border-color: #00897b;
  color: #00695c;
}

.chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-actions {
  display: flex;
  gap: 4px;
  padding: 0 10px 2px;
}

.fields-panel .panel-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.fields-panel .mode-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.02em;
}

.fields-panel.mode-select .mode-badge {
  background: var(--soft);
  color: var(--accent-2);
  border: 1px solid var(--border-hover);
}

.fields-panel.mode-where .mode-badge {
  background: #e0f2f1;
  color: #00695c;
  border: 1px solid #80cbc4;
}

.fields-panel.mode-select .fields-list {
  background: var(--panel);
}

.fields-panel.mode-where .fields-list {
  background: #f1faf8;
}

.fields-panel.mode-where .panel-head {
  background: #e8f5f3;
  border-bottom-color: #b2dfdb;
  color: #00695c;
}

.fields-panel.mode-where .field-toolbar {
  background: #f1faf8;
}

.fields-list {
  padding: 4px 6px 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: background 0.15s ease;
}

.field-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  margin: 0;
  padding: 4px 7px;
  text-align: left;
  border: 1px solid var(--soft);
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  box-sizing: border-box;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.mode-select .field-item:hover {
  border-color: var(--border-hover);
  background: var(--panel);
}

.field-item.selected,
.mode-select .field-item.selected {
  background: var(--soft);
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.08);
}

.mode-select .field-item.selected:hover {
  background: var(--soft);
  border-color: var(--accent-2);
}

.mode-where .field-item {
  border-color: #c8e6e3;
  padding: 8px 10px;
  gap: 3px;
  min-height: 44px;
}

.mode-where .field-item.selected {
  background: var(--soft);
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.08);
  opacity: 1;
}

.mode-where .field-item.whereable:hover {
  border-color: #26a69a;
  background: #e0f2f1;
}

.mode-where .field-item.whereable .field-line1 {
  color: #00695c;
  display: block;
  width: 100%;
  max-width: none;
}

.mode-where .field-item.whereable .field-copyable {
  cursor: pointer;
}

.mode-where .field-item.whereable .field-line2 {
  width: 100%;
}

.mode-where .field-item.whereable .field-api {
  flex: 1;
}

.mode-where .field-item.unfilterable,
.mode-where .field-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: #f7faf9;
  border-color: #dde8e6;
}

.field-line1,
.field-api,
.field-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.field-line1 {
  display: inline-block;
  vertical-align: top;
  max-width: 100%;
  width: fit-content;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--accent-2);
}

.field-copyable {
  cursor: copy;
}

.field-copyable:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.field-line2 {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  line-height: 1.2;
}

.field-api {
  flex: 0 1 auto;
  max-width: calc(100% - 52px);
  font-size: 11px;
  color: #78909c;
  font-family: Consolas, 'Courier New', monospace;
}

.field-type {
  flex-shrink: 0;
  margin-left: auto;
  max-width: 42%;
  font-size: 10px;
  color: #90a4ae;
  text-align: right;
  pointer-events: none;
  user-select: none;
}

.query-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}

.limit-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: #5c7a9b;
  cursor: pointer;
  user-select: none;
}

.limit-toggle input {
  margin: 0;
  accent-color: var(--accent);
}

.limit-input {
  width: 56px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
}

.limit-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: #f5f7fa;
}

.btn-stop {
  border-color: #ef9a9a !important;
  color: #c62828 !important;
  background: #ffebee !important;
}

.btn-stop:hover {
  background: #ffcdd2 !important;
}

.object-count-hint {
  font-size: 11px;
  font-weight: 600;
  color: #00695c;
  background: #e0f2f1;
  border: 1px solid #80cbc4;
  border-radius: 4px;
  padding: 3px 8px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.where-panel {
  flex-shrink: 0;
  max-height: 280px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin: 6px 10px 0;
  border: 1px solid var(--soft);
  border-radius: 6px;
  background: var(--panel);
  overflow: hidden;
}

.where-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-deep);
  border-bottom: 1px solid var(--soft);
}

.where-head .btn {
  margin-left: auto;
}

.where-empty {
  margin: 0;
  padding: 8px;
  font-size: 11px;
  color: #90a4ae;
  text-align: center;
}

.where-list {
  overflow: auto;
  padding: 4px 6px 6px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.where-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  padding: 6px 8px;
  background: #fff;
  border: 1px solid var(--soft);
  border-radius: 4px;
}

.where-row.wide {
  grid-column: 1 / -1;
}

.where-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 0 1 100px;
  padding-top: 4px;
}

.where-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.where-api {
  font-size: 10px;
  color: #78909c;
  font-family: Consolas, 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.where-op {
  flex-shrink: 0;
  width: 78px;
  margin-top: 2px;
  padding: 6px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  background: #fff;
}

.where-values {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.where-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  min-height: 30px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  box-sizing: border-box;
}

.where-multi-checks {
  flex: 1;
  min-width: 0;
  max-height: 160px;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fafcfe;
}

.where-check-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 28px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}

.where-check-item:hover {
  background: var(--soft);
}

.where-check-item input {
  margin: 3px 0 0;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  cursor: pointer;
}

.where-check-label {
  font-size: 12px;
  line-height: 1.35;
  color: var(--text);
  word-break: break-word;
}

.where-multi-empty {
  margin: 0;
  grid-column: 1 / -1;
  font-size: 11px;
  color: #90a4ae;
  text-align: center;
  padding: 8px;
}

.where-to {
  font-size: 10px;
  color: #78909c;
  flex-shrink: 0;
  padding-top: 8px;
}

.where-remove {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin-top: 2px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  color: #c62828;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.where-remove:hover {
  background: #ffebee;
}

.soql-editor-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  gap: 0;
  margin: 8px 10px 0;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--soft-tint);
}

.soql-fold-btn {
  flex-shrink: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 36px;
  padding: 4px 2px;
  border: none;
  border-right: 1px solid var(--soft);
  background: var(--panel);
  color: var(--accent-deep);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
}

.soql-fold-btn:hover {
  background: var(--soft);
}

.fold-caret {
  font-size: 12px;
  opacity: 0.9;
}

.soql-editor-block {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--soft-tint);
}

.soql-editor {
  flex-shrink: 0;
  height: 88px;
  max-height: 88px;
  margin: 0;
  resize: none;
  overflow: auto;
  padding: 8px 10px;
  border: none;
  border-radius: 0;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.45;
  color: #263238;
  background: var(--soft-tint);
  box-sizing: border-box;
}

.soql-editor:focus {
  outline: none;
  background: #fff;
}

.soql-suggest {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  max-height: 148px;
  border-top: 1px solid var(--soft);
  background: #fff;
}

.suggest-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.suggest-hint {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 10px;
  line-height: 1.3;
  color: #90a4ae;
  border-top: 1px solid #f0f4f8;
  background: var(--panel);
  user-select: none;
}

.suggest-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 4px 10px;
  border: none;
  border-bottom: 1px solid #f0f4f8;
  background: #fff;
  cursor: pointer;
}

.suggest-item:hover,
.suggest-item.active {
  background: var(--soft);
}

.suggest-name {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-2);
}

.suggest-label {
  font-size: 11px;
  color: #78909c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.soql-preview {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  margin: 0;
  padding: 6px 10px;
  border: none;
  border-radius: 0;
  background: var(--soft-tint);
  cursor: pointer;
  text-align: left;
  color: #546e7a;
}

.soql-preview:hover {
  background: var(--soft);
}

.soql-preview-text {
  flex: 1;
  min-width: 0;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.results-head {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-start;
  align-items: center;
  padding: 6px 12px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-deep);
}

.results-head .count {
  font-weight: 500;
  color: var(--muted);
}

.results-actions {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.results-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0 10px 10px;
  border: 1px solid var(--soft);
  border-radius: 6px;
  background: var(--soft-tint);
}

.query-panel:has(.results-edit-bar) .results-wrap {
  margin-bottom: 0;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.results-table td.result-cell {
  cursor: cell;
  user-select: none;
  position: relative;
}

.results-table td.result-cell.selected:not(.editing) {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: #e8f4ff;
}

.results-table td.result-cell.dirty:not(.editing) {
  background: #fff59d;
}

.results-table td.result-cell.dirty.selected:not(.editing) {
  background: #ffe082;
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.results-table td.result-cell.editing {
  padding: 2px 4px;
  overflow: visible;
  background: #fffde7;
  outline: 2px solid #f9a825;
  outline-offset: -2px;
  user-select: text;
}

.cell-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-editor {
  display: block;
  width: 100%;
  min-width: 80px;
  box-sizing: border-box;
  margin: 0;
  padding: 4px 6px;
  border: 1px solid #f9a825;
  border-radius: 3px;
  font: inherit;
  font-size: 11px;
  background: #fff;
  color: inherit;
}

.cell-editor-multi {
  min-width: 140px;
  min-height: 72px;
  max-height: 140px;
}

.cell-editor-area {
  min-width: 160px;
  min-height: 56px;
  resize: vertical;
  white-space: pre-wrap;
  line-height: 1.35;
}

select.cell-editor {
  cursor: pointer;
}

.results-edit-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 10px 10px;
  padding: 8px 10px;
  border: 1px solid #ffe082;
  border-top: none;
  border-radius: 0 0 6px 6px;
  background: #fffde7;
}

.results-edit-bar .edit-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #f57f17;
  font-weight: 600;
}

.ctx-menu {
  position: fixed;
  z-index: 10000;
  min-width: 120px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(25, 55, 90, 0.18);
}

.ctx-item {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 7px 10px;
  font-size: 12px;
  color: var(--accent-deep);
  border-radius: 4px;
  cursor: pointer;
}

.ctx-item:hover:not(:disabled) {
  background: var(--soft);
}

.ctx-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(20, 40, 70, 0.35);
}

.confirm-dialog {
  width: min(440px, 100%);
  max-height: min(70vh, 520px);
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  border: 1px solid var(--border);
  box-shadow: 0 12px 40px rgba(20, 40, 70, 0.22);
  padding: 16px 18px;
}

.confirm-dialog h3 {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--accent-deep);
}

.confirm-dialog > p {
  margin: 0 0 10px;
  font-size: 12px;
  color: #546e7a;
  line-height: 1.45;
}

.confirm-list {
  margin: 0 0 14px;
  padding: 8px 10px;
  list-style: none;
  background: var(--soft-tint);
  border: 1px solid var(--soft);
  border-radius: 6px;
  max-height: 200px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.5;
}

.confirm-list li + li {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--soft);
}

.confirm-list code {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 10px;
  color: var(--accent);
}

.confirm-list .dim {
  color: #90a4ae;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.results-table .col-detail {
  width: 36px;
  text-align: center;
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--soft);
  max-width: 40px;
}

.results-table tbody td.col-detail {
  background: var(--soft-tint);
  z-index: 1;
}

.results-table th,
.results-table td {
  border-bottom: 1px solid var(--soft);
  padding: 6px 8px;
  text-align: left;
  white-space: nowrap;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-table th {
  position: sticky;
  top: 0;
  background: var(--soft);
  color: var(--accent-deep);
  font-weight: 600;
  z-index: 1;
  vertical-align: bottom;
}

.results-table th.col-detail {
  z-index: 3;
  vertical-align: middle;
}

.results-table th.col-head {
  padding: 4px 8px;
  white-space: normal;
}

.th-copy {
  display: block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  text-align: left;
  cursor: copy;
}

.th-copy:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.th-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-deep);
  line-height: 1.25;
}

.th-api {
  margin-top: 1px;
  font-size: 10px;
  font-weight: 500;
  font-family: Consolas, 'Courier New', monospace;
  color: #5c7a9b;
  line-height: 1.2;
}

.results-empty {
  padding: 20px !important;
}

.list-hint {
  margin: 12px 8px;
  font-size: 12px;
  color: #90a4ae;
  text-align: center;
}

.error-text {
  color: #c62828;
  font-size: 12px;
  margin: 8px 0 0;
}

.inline-error {
  flex-shrink: 0;
  margin: 4px 12px 0;
  max-height: 40px;
  overflow: auto;
}

.btn {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--accent-deep);
  border-radius: 6px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn:hover:not(:disabled) {
  background: var(--soft);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 11px;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent-2);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-deep);
  color: #fff;
}

.btn-light {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
}

.btn-light:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
  color: #fff;
}

@media (max-width: 960px) {
  .soql-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
}
</style>
