<template>
  <div class="soql-app" @contextmenu="onAppContextMenu" @click="onAppClick">
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

    <div v-else class="soql-body">
      <aside class="panel objects-panel">
        <div class="panel-head">
          <span>{{ t('soql.objects') }}</span>
          <span class="count">{{ filteredObjects.length }}</span>
        </div>
        <input
          v-model.trim="objectSearch"
          class="search-input"
          type="search"
          :placeholder="t('soql.searchObjectPlaceholder')"
        />
        <div class="list-scroll">
          <div
            v-for="obj in filteredObjects"
            :key="obj.name"
            :class="['list-item', { active: currentObject?.name === obj.name }]"
            role="button"
            tabindex="0"
            @click="selectObject(obj)"
            @keydown.enter.prevent="selectObject(obj)"
          >
            <div class="item-top">
              <span class="item-label">{{ obj.label }}</span>
              <button
                type="button"
                class="obj-detail-btn"
                :title="t('soql.viewObjectDetail')"
                @click.stop="openObjectDetail(obj)"
              >{{ t('soql.detailShort') }}</button>
            </div>
            <span class="item-api">{{ obj.name }}</span>
          </div>
          <p v-if="loadingObjects" class="list-hint">{{ t('soql.loadingObjects') }}</p>
          <p v-else-if="filteredObjects.length === 0" class="list-hint">{{ t('soql.noMatchingObjects') }}</p>
        </div>
      </aside>

      <section :class="['panel', 'fields-panel', `mode-${fieldPanelMode}`]">
        <div class="panel-head">
          <div class="panel-head-left">
            <span>{{ t('soql.fields') }}{{ currentObject ? ` · ${currentObject.label}` : '' }}</span>
            <span class="mode-badge">{{ fieldPanelMode === 'where' ? t('soql.modeWhere') : t('soql.modeSelect') }}</span>
          </div>
          <span class="count">{{ selectedFieldNames.length }}/{{ filteredFields.length }}</span>
        </div>
        <div class="field-toolbar">
          <input
            v-model.trim="fieldSearch"
            class="search-input"
            type="search"
            :placeholder="t('soql.searchFieldPlaceholder')"
            :disabled="!currentObject"
          />
          <div class="field-filter-chips">
            <button
              type="button"
              :class="['chip', { active: fieldKindFilter === 'all' }]"
              :disabled="!currentObject"
              @click="fieldKindFilter = 'all'"
            >{{ t('soql.chipAll') }}</button>
            <button
              type="button"
              :class="['chip', { active: fieldKindFilter === 'standard' }]"
              :disabled="!currentObject"
              @click="fieldKindFilter = 'standard'"
            >{{ t('soql.chipStandard') }}</button>
            <button
              type="button"
              :class="['chip', { active: fieldKindFilter === 'custom' }]"
              :disabled="!currentObject"
              @click="fieldKindFilter = 'custom'"
            >{{ t('soql.chipCustom') }}</button>
          </div>
          <div class="field-mode-chips">
            <button
              type="button"
              :class="['chip', 'chip-select', { active: fieldPanelMode === 'select' }]"
              :disabled="!currentObject"
              @click="fieldPanelMode = 'select'"
            >{{ t('soql.modeSelect') }}</button>
            <button
              type="button"
              :class="['chip', 'chip-where', { active: fieldPanelMode === 'where' }]"
              :disabled="!currentObject"
              @click="fieldPanelMode = 'where'"
            >{{ t('soql.modeWhere') }}</button>
          </div>
          <div class="field-actions">
            <button type="button" class="btn btn-sm" :disabled="!currentObject || fieldPanelMode !== 'select'" @click="selectAllFields">{{ t('soql.selectAll') }}</button>
            <button type="button" class="btn btn-sm" :disabled="!currentObject || fieldPanelMode !== 'select'" @click="clearFields">{{ t('soql.clear') }}</button>
          </div>
        </div>
        <div class="list-scroll fields-list">
          <button
            v-for="field in filteredFields"
            :key="field.name"
            type="button"
            :class="['field-item', {
              selected: fieldPanelMode === 'select' && selectedFieldSet.has(field.name),
              whereable: fieldPanelMode === 'where' && field.filterable,
              unfilterable: fieldPanelMode === 'where' && !field.filterable
            }]"
            :title="fieldTooltip(field)"
            :disabled="fieldPanelMode === 'where' && !field.filterable"
            @click="onFieldCardClick(field)"
            @dblclick.stop="copyFieldText(field)"
          >
            <span
              class="field-line1 field-copyable"
              :title="field.label"
              @click.stop="onFieldTextClick(field.name, field.label)"
            >{{ field.label }}</span>
            <span class="field-line2">
              <span
                class="field-api field-copyable"
                :title="field.name"
                @click.stop="onFieldTextClick(field.name, field.name)"
              >{{ field.name }}</span>
              <span class="field-type">{{ field.type }}</span>
            </span>
          </button>
          <p v-if="loadingFields" class="list-hint">{{ t('soql.loadingFields') }}</p>
          <p v-else-if="!currentObject" class="list-hint">{{ t('soql.selectObjectFirst') }}</p>
          <p v-else-if="filteredFields.length === 0" class="list-hint">{{ t('soql.noMatchingFields') }}</p>
        </div>
      </section>

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
            <button type="button" class="btn btn-primary btn-sm" :disabled="!canExecute || executing" @click="executeQuery">
              {{ executing ? t('soql.executing') : t('soql.execute') }}
            </button>
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
              <button
                v-for="(item, idx) in fieldSuggestions"
                :key="item.name"
                type="button"
                :class="['suggest-item', { active: idx === suggestIndex }]"
                @mousedown.prevent="applyFieldSuggestion(item)"
              >
                <span class="suggest-name">{{ item.name }}</span>
                <span class="suggest-label">{{ item.label }}</span>
              </button>
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
        <div class="where-panel">
          <div class="where-head">
            <span>WHERE</span>
            <span class="count" v-if="whereConditions.length">{{ validWhereCount }}/{{ whereConditions.length }}</span>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="whereConditions.length === 0"
              @click="clearWhereConditions"
            >{{ t('soql.clearConditions') }}</button>
          </div>
          <p v-if="whereConditions.length === 0" class="where-empty">{{ t('soql.whereEmpty') }}</p>
          <div v-else class="where-list">
            <div
              v-for="cond in whereConditions"
              :key="cond.id"
              :class="['where-row', { wide: isMultiValue(cond.operator) && whereKind(cond) === 'picklist' }]"
            >
              <div class="where-field">
                <span class="where-label">{{ fieldLabel(cond.fieldApiName) }}</span>
                <span class="where-api">{{ cond.fieldApiName }}</span>
              </div>
              <select v-model="cond.operator" class="where-op" @change="onWhereOperatorChange(cond)">
                <option v-for="op in operatorsForField(cond.fieldApiName)" :key="op" :value="op">{{ op }}</option>
              </select>
              <div class="where-values" @change="syncSoqlFromBuilder" @input="syncSoqlFromBuilder">
                <template v-if="needsValue(cond.operator)">
                  <select
                    v-if="whereKind(cond) === 'boolean'"
                    v-model="cond.value"
                    class="where-input"
                  >
                    <option disabled value="">{{ t('soql.selectOption') }}</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                  <select
                    v-else-if="whereKind(cond) === 'picklist' && !isMultiValue(cond.operator)"
                    v-model="cond.value"
                    class="where-input"
                  >
                    <option disabled value="">{{ t('soql.selectPicklist') }}</option>
                    <option
                      v-for="opt in picklistOptions(cond.fieldApiName)"
                      :key="opt.value"
                      :value="opt.value"
                    >{{ opt.label || opt.value }}</option>
                  </select>
                  <select
                    v-else-if="whereKind(cond) === 'picklist' && isMultiValue(cond.operator)"
                    v-model="cond.value"
                    class="where-input where-multi"
                    multiple
                  >
                    <option
                      v-for="opt in picklistOptions(cond.fieldApiName)"
                      :key="opt.value"
                      :value="opt.value"
                    >{{ opt.label || opt.value }}</option>
                  </select>
                  <input
                    v-else-if="whereKind(cond) === 'date'"
                    v-model="cond.value"
                    type="date"
                    class="where-input"
                  />
                  <input
                    v-else-if="whereKind(cond) === 'datetime'"
                    v-model="cond.value"
                    type="datetime-local"
                    class="where-input"
                  />
                  <input
                    v-else-if="whereKind(cond) === 'time'"
                    v-model="cond.value"
                    type="time"
                    class="where-input"
                  />
                  <input
                    v-else-if="whereKind(cond) === 'number'"
                    v-model="cond.value"
                    type="number"
                    class="where-input"
                  />
                  <input
                    v-else
                    v-model.trim="cond.value"
                    type="text"
                    class="where-input"
                    :placeholder="cond.operator === 'IN' ? 'a, b, c' : (cond.operator === 'LIKE' ? '%text%' : '')"
                  />
                  <template v-if="needsValue2(cond.operator)">
                    <span class="where-to">{{ t('soql.to') }}</span>
                    <input
                      v-if="whereKind(cond) === 'date'"
                      v-model="cond.value2"
                      type="date"
                      class="where-input"
                    />
                    <input
                      v-else-if="whereKind(cond) === 'datetime'"
                      v-model="cond.value2"
                      type="datetime-local"
                      class="where-input"
                    />
                    <input
                      v-else-if="whereKind(cond) === 'number'"
                      v-model="cond.value2"
                      type="number"
                      class="where-input"
                    />
                    <input
                      v-else
                      v-model.trim="cond.value2"
                      type="text"
                      class="where-input"
                    />
                  </template>
                </template>
              </div>
              <button type="button" class="where-remove" :title="t('soql.removeCondition')" @click="removeWhereCondition(cond.id)">×</button>
            </div>
          </div>
        </div>
        <p v-if="errorMessage" class="error-text inline-error">{{ errorMessage }}</p>
        <p v-if="statusMessage" class="status-text">{{ statusMessage }}</p>

        <div class="results-head">
          <span>{{ t('soql.queryResults') }}</span>
          <span class="count" v-if="resultRows.length">{{ t('soql.rowsCount', { count: resultRows.length }) }}{{ resultDone === false ? t('soql.rowsIncomplete') : '' }}</span>
        </div>
        <div class="results-wrap">
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
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '../../components/LocaleSwitcher.vue'
import { SfRestClient, listSfEnvironments, fetchSfSession } from '../_shared/sfApi.js'
import { DEFAULT_STANDARD_WHITELIST, getObjectKind } from './soqlConstants.js'
import { openObjectDetailTab } from '../_shared/toolWindows.js'
import {
  activePicklistOptions,
  buildWhereClause,
  defaultOperator,
  formatCondition,
  isMultiValue,
  needsValue,
  needsValue2,
  nextConditionId,
  operatorsForKind,
  valueKind
} from './soqlWhere.js'

const { t } = useI18n()

const envs = ref([])
const selectedEnvId = ref('')
const loadingEnvs = ref(false)

const objects = ref([])
const objectSearch = ref('')
const currentObject = ref(null)
const loadingObjects = ref(false)

const fieldsMap = ref({})
const fieldSearch = ref('')
const fieldKindFilter = ref('all') // all | standard | custom
const selectedFieldSet = ref(new Set())
const selectedFieldNames = ref([])
const loadingFields = ref(false)
const fieldPanelMode = ref('select') // select | where
const whereConditions = ref([])

const soqlText = ref('')
const soqlEditorOpen = ref(false)
const soqlEditorEl = ref(null)
const fieldSuggestions = ref([])
const suggestIndex = ref(0)
const suggestReplace = ref(null) // { start, end }
const limitEnabled = ref(false)
const queryLimit = ref(10)
const executing = ref(false)
const resultColumns = ref([])
const resultRows = ref([])
const resultDone = ref(true)

/** 单元格编辑：key = `${rowIdx}::${col}` → { original, current } */
const cellEdits = ref({})
const selectedCell = ref(null) // { row, col }
const editingCell = ref(null)
const cellEditorEl = ref(null)
const ctxMenu = ref({ show: false, x: 0, y: 0, canCopy: false, row: -1, col: '' })
const submitConfirmOpen = ref(false)
const submittingEdits = ref(false)

const errorMessage = ref('')
const statusMessage = ref('')

let client = null

const selectedEnv = computed(() => envs.value.find((e) => e.id === selectedEnvId.value) || null)

const filteredObjects = computed(() => {
  const q = objectSearch.value.toLowerCase()
  let list = objects.value
  if (q) {
    list = list.filter(
      (o) => o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
    )
  }
  return list
})

const filteredFields = computed(() => {
  let list = Object.values(fieldsMap.value)
  if (fieldKindFilter.value === 'standard') {
    list = list.filter((f) => !String(f.name).endsWith('__c'))
  } else if (fieldKindFilter.value === 'custom') {
    list = list.filter((f) => String(f.name).endsWith('__c'))
  }
  const q = fieldSearch.value.toLowerCase()
  if (q) {
    list = list.filter(
      (f) => f.label.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    )
  }
  return list
})

const canExecute = computed(() => !!selectedEnv.value && !!soqlText.value.trim())

const validWhereCount = computed(() => {
  let n = 0
  for (const cond of whereConditions.value) {
    const field = fieldsMap.value[cond.fieldApiName]
    if (formatCondition(cond, field)) n += 1
  }
  return n
})

function fieldLabel(apiName) {
  return fieldsMap.value[apiName]?.label || apiName
}

function whereKind(cond) {
  return valueKind(fieldsMap.value[cond.fieldApiName]?.type)
}

function operatorsForField(apiName) {
  return operatorsForKind(valueKind(fieldsMap.value[apiName]?.type))
}

function picklistOptions(apiName) {
  return activePicklistOptions(fieldsMap.value[apiName])
}

function onWhereOperatorChange(cond) {
  if (cond.operator === 'IN' && whereKind(cond) === 'picklist') {
    cond.value = Array.isArray(cond.value) ? cond.value : cond.value ? [cond.value] : []
  } else if (Array.isArray(cond.value)) {
    cond.value = cond.value[0] ?? ''
  }
  if (!needsValue2(cond.operator)) cond.value2 = ''
  if (!needsValue(cond.operator)) {
    cond.value = ''
    cond.value2 = ''
  }
  syncSoqlFromBuilder()
}

function addWhereCondition(field) {
  if (!field?.filterable) return
  const kind = valueKind(field.type)
  whereConditions.value = [
    ...whereConditions.value,
    {
      id: nextConditionId(whereConditions.value),
      fieldApiName: field.name,
      operator: defaultOperator(kind),
      value: kind === 'boolean' ? 'true' : '',
      value2: ''
    }
  ]
  syncSoqlFromBuilder()
}

function removeWhereCondition(id) {
  whereConditions.value = whereConditions.value.filter((c) => c.id !== id)
  syncSoqlFromBuilder()
}

function clearWhereConditions() {
  whereConditions.value = []
  syncSoqlFromBuilder()
}

function onFieldCardClick(field) {
  if (fieldPanelMode.value === 'where') {
    addWhereCondition(field)
    return
  }
  toggleField(field.name)
}

function syncSelectedArray() {
  // 按字段列表（describe）顺序，而非点击顺序
  selectedFieldNames.value = Object.keys(fieldsMap.value).filter((name) =>
    selectedFieldSet.value.has(name)
  )
}

function fieldTooltip(field) {
  if (fieldPanelMode.value === 'where' && !field.filterable) {
    return t('soql.fieldTooltipNotFilterable', {
      label: field.label,
      name: field.name,
      type: field.type
    })
  }
  return t('soql.fieldTooltip', { label: field.label, name: field.name, type: field.type })
}

async function copyText(text) {
  const value = String(text || '')
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    statusMessage.value = t('soql.copied', { value })
  } catch {
    errorMessage.value = t('soql.copyFailed')
  }
}

async function copyFieldText(field) {
  await copyText(`${field.label} (${field.name})`)
}

/** 点标签/API：选字段模式下选中并复制；加条件模式下添加条件并复制 */
async function onFieldTextClick(name, text) {
  if (fieldPanelMode.value === 'where') {
    addWhereCondition(fieldsMap.value[name])
    await copyText(text)
    return
  }
  if (!selectedFieldSet.value.has(name)) {
    const next = new Set(selectedFieldSet.value)
    next.add(name)
    selectedFieldSet.value = next
    syncSelectedArray()
  }
  await copyText(text)
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
  if (!col || col === 'Id' || col === 'attributes') return false
  const meta = fieldsMap.value[col]
  if (meta && meta.updateable === false) return false
  return true
}

function startEditCell(rowIdx, col) {
  if (!canEditColumn(col)) {
    statusMessage.value = t('soql.fieldNotEditable', { field: col })
    return
  }
  const raw = cellRawOriginal(rowIdx, col)
  if (raw != null && typeof raw === 'object') {
    statusMessage.value = t('soql.fieldComplexType', { field: col })
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
  statusMessage.value = t('soql.revertedEdits')
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
    statusMessage.value = t('soql.submittedRecords', { count: byRecord.size })
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

async function refreshEnvs() {
  loadingEnvs.value = true
  errorMessage.value = ''
  try {
    const res = await listSfEnvironments()
    if (!res?.success) throw new Error(res?.error || t('soql.scanEnvsFailed'))
    envs.value = res.environments || []
    if (!envs.value.find((e) => e.id === selectedEnvId.value)) {
      selectedEnvId.value = envs.value[0]?.id || ''
      if (selectedEnvId.value) await connectSelectedEnv()
      else {
        resetWorkspace()
      }
    }
    if (envs.value.length === 0) {
      statusMessage.value = t('soql.noEnvsFound')
    } else {
      statusMessage.value = t('soql.envsFound', { count: envs.value.length })
    }
  } catch (e) {
    errorMessage.value = e.message || String(e)
  } finally {
    loadingEnvs.value = false
  }
}

function resetWorkspace() {
  objects.value = []
  currentObject.value = null
  fieldsMap.value = {}
  selectedFieldSet.value = new Set()
  syncSelectedArray()
  whereConditions.value = []
  fieldPanelMode.value = 'select'
  soqlText.value = ''
  resultColumns.value = []
  resultRows.value = []
  clearCellEdits()
  client = null
}

async function connectSelectedEnv() {
  const env = selectedEnv.value
  if (!env) {
    resetWorkspace()
    return
  }
  errorMessage.value = ''
  statusMessage.value = t('soql.fetchingSession')
  try {
    const res = await fetchSfSession(env.hostname)
    if (!res?.success || !res.session?.sessionId) {
      throw new Error(res?.error || t('soql.sessionFailed'))
    }
    client = new SfRestClient({
      hostname: res.session.hostname || env.hostname,
      sessionId: res.session.sessionId
    })
    statusMessage.value = t('soql.connected', { hostname: client.hostname })
    await loadObjects()
  } catch (e) {
    client = null
    objects.value = []
    errorMessage.value = e.message || String(e)
    statusMessage.value = ''
  }
}

async function onEnvChange() {
  resultColumns.value = []
  resultRows.value = []
  currentObject.value = null
  fieldsMap.value = {}
  selectedFieldSet.value = new Set()
  syncSelectedArray()
  whereConditions.value = []
  fieldPanelMode.value = 'select'
  soqlText.value = ''
  clearCellEdits()
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
    statusMessage.value = t('soql.loadedObjects', { count: objects.value.length })
  } catch (e) {
    objects.value = []
    errorMessage.value = e.message || String(e)
  } finally {
    loadingObjects.value = false
  }
}

async function selectObject(obj) {
  if (!client || !obj) return
  currentObject.value = obj
  fieldSearch.value = ''
  fieldKindFilter.value = 'all'
  fieldPanelMode.value = 'select'
  whereConditions.value = []
  loadingFields.value = true
  errorMessage.value = ''
  try {
    const desc = await client.describeSObject(obj.name)
    const map = {}
    for (const field of desc.fields || []) {
      if (field.deprecatedAndHidden) continue
      map[field.name] = {
        name: field.name,
        label: field.label || field.name,
        type: field.type || 'string',
        custom: !!field.custom,
        updateable: field.updateable !== false,
        filterable: field.filterable === true,
        nillable: !!field.nillable,
        picklistValues: field.picklistValues || []
      }
    }
    fieldsMap.value = map
    // 默认只选 Id、Name（存在才选）
    const defaults = ['Id', 'Name'].filter((n) => map[n])
    selectedFieldSet.value = new Set(defaults)
    syncSelectedArray()
    syncSoqlFromBuilder()
  } catch (e) {
    fieldsMap.value = {}
    selectedFieldSet.value = new Set()
    syncSelectedArray()
    whereConditions.value = []
    errorMessage.value = e.message || String(e)
  } finally {
    loadingFields.value = false
  }
}

async function openObjectDetail(obj) {
  if (!obj?.name) return
  const hostname = selectedEnv.value?.hostname || client?.hostname
  if (!hostname) {
    errorMessage.value = t('soql.selectEnvFirst')
    return
  }
  try {
    statusMessage.value = t('soql.openingObjectDetail', { label: obj.label || obj.name })
    await openObjectDetailTab({ objectName: obj.name, hostname })
    statusMessage.value = t('soql.openedObjectDetail', { label: obj.label || obj.name })
  } catch (e) {
    errorMessage.value = e?.message || t('soql.openObjectDetailFailed')
    statusMessage.value = ''
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
    statusMessage.value = t('soql.openingRecordDetail', { id })
    await openObjectDetailTab({ objectName: objectApi, hostname, recordId: id })
    statusMessage.value = t('soql.openedRecordDetail', { id })
  } catch (e) {
    errorMessage.value = e?.message || t('soql.openObjectDetailFailed')
    statusMessage.value = ''
  }
}

function toggleField(name) {
  const next = new Set(selectedFieldSet.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selectedFieldSet.value = next
  syncSelectedArray()
  syncSoqlFromBuilder()
}

function selectAllFields() {
  const next = new Set(selectedFieldSet.value)
  for (const f of filteredFields.value) next.add(f.name)
  selectedFieldSet.value = next
  syncSelectedArray()
  syncSoqlFromBuilder()
}

function clearFields() {
  selectedFieldSet.value = new Set()
  syncSelectedArray()
  syncSoqlFromBuilder()
}

function buildSoql() {
  if (!currentObject.value || selectedFieldNames.value.length === 0) return ''
  const fields = selectedFieldNames.value.join(', ')
  let soql = `SELECT ${fields} FROM ${currentObject.value.name}`
  soql += buildWhereClause(whereConditions.value, fieldsMap.value)
  if (limitEnabled.value) {
    const limit = Math.min(Math.max(Number(queryLimit.value) || 10, 1), 2000)
    soql += ` LIMIT ${limit}`
  }
  return soql
}

/** 点选 / 条件 / LIMIT 变更后立刻同步 SOQL */
function syncSoqlFromBuilder() {
  const q = buildSoql()
  soqlText.value = q
  clearFieldSuggestions()
}

function clearFieldSuggestions() {
  fieldSuggestions.value = []
  suggestIndex.value = 0
  suggestReplace.value = null
}

/** 解析光标是否在 SELECT 字段列表中，且已有 FROM 对象 */
function getSelectFieldSuggestContext(text, cursor) {
  const src = String(text || '')
  const pos = Math.max(0, Math.min(cursor ?? 0, src.length))
  const fromMatch = src.match(/\bFROM\s+([A-Za-z_][\w]*)/i)
  if (!fromMatch) return null

  const fromIndex = src.search(/\bFROM\b/i)
  if (fromIndex < 0 || pos > fromIndex) return null

  const selectMatch = src.match(/\bSELECT\b/i)
  if (!selectMatch || selectMatch.index == null) return null
  if (pos <= selectMatch.index + 6) return null

  const before = src.slice(0, pos)
  const tokenMatch = before.match(/(?:SELECT\b|,)\s*([A-Za-z_][\w]*)$/i)
  const emptyMatch = before.match(/(?:SELECT\b|,)\s*$/i)
  if (!tokenMatch && !emptyMatch) return null

  const prefix = tokenMatch ? tokenMatch[1] : ''
  const start = tokenMatch ? pos - prefix.length : pos
  return {
    objectName: fromMatch[1],
    prefix,
    start,
    end: pos
  }
}

function refreshFieldSuggestions() {
  if (!soqlEditorOpen.value) {
    clearFieldSuggestions()
    return
  }
  const el = soqlEditorEl.value
  const cursor = el ? el.selectionStart : soqlText.value.length
  const ctx = getSelectFieldSuggestContext(soqlText.value, cursor)
  if (!ctx) {
    clearFieldSuggestions()
    return
  }

  const fromObj = ctx.objectName.toLowerCase()
  const current = (currentObject.value?.name || '').toLowerCase()
  // 仅当 FROM 对象与当前已 describe 的对象一致时提供联想
  if (!current || fromObj !== current) {
    clearFieldSuggestions()
    return
  }

  const q = ctx.prefix.toLowerCase()
  const list = Object.values(fieldsMap.value)
    .filter((f) => {
      if (!q) return true
      return (
        f.name.toLowerCase().startsWith(q) ||
        (f.label || '').toLowerCase().includes(q)
      )
    })
    .slice(0, 12)
    .map((f) => ({ name: f.name, label: f.label || f.name, type: f.type }))

  const prevNames = fieldSuggestions.value.map((i) => i.name).join('\0')
  const nextNames = list.map((i) => i.name).join('\0')
  fieldSuggestions.value = list
  suggestReplace.value = list.length ? { start: ctx.start, end: ctx.end } : null
  // 列表未变时保留当前高亮，避免 ↑↓ 后被 keyup 刷新打回第一项
  if (prevNames !== nextNames) {
    suggestIndex.value = 0
  } else if (suggestIndex.value >= list.length) {
    suggestIndex.value = Math.max(0, list.length - 1)
  }
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

function applyFieldSuggestion(item) {
  if (!item?.name || !suggestReplace.value) return
  const { start, end } = suggestReplace.value
  const text = soqlText.value
  soqlText.value = text.slice(0, start) + item.name + text.slice(end)
  clearFieldSuggestions()
  nextTick(() => {
    const el = soqlEditorEl.value
    if (!el) return
    const pos = start + item.name.length
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
    statusMessage.value = t('soql.soqlCopied')
  } catch {
    errorMessage.value = t('soql.copyFailed')
  }
}

async function executeQuery() {
  if (!client || !soqlText.value.trim()) return
  executing.value = true
  errorMessage.value = ''
  statusMessage.value = t('soql.executing')
  resultColumns.value = []
  resultRows.value = []
  clearCellEdits()
  try {
    // 若 Session 可能过期，执行前刷新一次
    const env = selectedEnv.value
    if (env) {
      const res = await fetchSfSession(env.hostname)
      if (res?.success && res.session?.sessionId) {
        client.sessionId = res.session.sessionId
        client.hostname = res.session.hostname || client.hostname
      }
    }
    const data = await client.query(soqlText.value.trim())
    const records = data?.records || []
    resultDone.value = data?.done !== false
    const cols = new Set()
    for (const rec of records) {
      Object.keys(rec).forEach((k) => {
        if (k !== 'attributes') cols.add(k)
      })
    }
    resultColumns.value = Array.from(cols)
    resultRows.value = records
    statusMessage.value =
      t('soql.queryReturned', { count: records.length }) +
      (resultDone.value ? '' : t('soql.queryMoreHint'))
  } catch (e) {
    errorMessage.value = e.message || String(e)
    statusMessage.value = ''
  } finally {
    executing.value = false
  }
}

watch([limitEnabled, queryLimit], () => {
  syncSoqlFromBuilder()
})

watch(soqlEditorOpen, (open) => {
  if (!open) clearFieldSuggestions()
})

onMounted(() => {
  refreshEnvs()
  window.addEventListener('scroll', closeCtxOnScroll, true)
  document.addEventListener('pointerdown', onDocPointerDown, true)
})

onUnmounted(() => {
  window.removeEventListener('scroll', closeCtxOnScroll, true)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<style scoped>
/* Quick Login 蓝白 + 圆角分块布局 */
.soql-app {
  --accent: #1976d2;
  --accent-2: #1565c0;
  --accent-deep: #0d47a1;
  --page: #eef5fc;
  --card: #fff;
  --border: #bbdefb;
  --soft: #e3f2fd;
  --panel: #f5f9ff;
  --text: #333;
  --muted: #607d8b;
  --radius: 10px;
  --gap: 12px;
  --shadow: 0 2px 8px rgba(25, 118, 210, 0.08);

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
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.25);
  color: #fff;
}

.soql-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  /* 与 Apex Log 区分：琥珀金，贴合 Query/数据 */
  color: #ffe082;
  text-shadow: 0 1px 1px rgba(0, 40, 80, 0.25);
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
  box-shadow: 0 8px 24px rgba(25, 118, 210, 0.1);
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

.soql-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 240px 280px minmax(0, 1fr);
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
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.12);
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
  border-color: #90caf9;
  background: #fafcff;
}

.list-item.active {
  background: var(--soft);
  border-color: #90caf9;
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
  border-color: #90caf9;
  background: #f5f9ff;
  color: var(--accent);
}

.chip.active {
  background: var(--soft);
  border-color: var(--accent);
  color: var(--accent-deep);
}

.chip-select.active {
  background: #e3f2fd;
  border-color: #1976d2;
  color: #0d47a1;
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
  background: #e3f2fd;
  color: #1565c0;
  border: 1px solid #90caf9;
}

.fields-panel.mode-where .mode-badge {
  background: #e0f2f1;
  color: #00695c;
  border: 1px solid #80cbc4;
}

.fields-panel.mode-select .fields-list {
  background: #f5f9ff;
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
  border: 1px solid #e3f2fd;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  box-sizing: border-box;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.mode-select .field-item:hover {
  border-color: #90caf9;
  background: #f5f9ff;
}

.mode-select .field-item.selected {
  background: var(--soft);
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(25, 118, 210, 0.08);
}

.mode-select .field-item.selected:hover {
  background: #d6eafb;
  border-color: var(--accent-2);
}

.mode-where .field-item {
  border-color: #c8e6e3;
}

.mode-where .field-item.whereable:hover {
  border-color: #26a69a;
  background: #e0f2f1;
}

.mode-where .field-item.whereable .field-line1 {
  color: #00695c;
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

.where-panel {
  flex-shrink: 0;
  max-height: 168px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin: 6px 10px 0;
  border: 1px solid #e3f2fd;
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
  border-bottom: 1px solid #e3f2fd;
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
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 3px 5px;
  background: #fff;
  border: 1px solid #e3f2fd;
  border-radius: 4px;
}

.where-row.wide {
  grid-column: 1 / -1;
}

.where-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 0 1 88px;
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
  width: 72px;
  padding: 3px 2px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  background: #fff;
}

.where-values {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.where-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 3px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  box-sizing: border-box;
}

.where-multi {
  min-height: 52px;
}

.where-to {
  font-size: 10px;
  color: #78909c;
  flex-shrink: 0;
}

.where-remove {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  color: #c62828;
  font-size: 14px;
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
  background: #fafcff;
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
  border-right: 1px solid #e3f2fd;
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
  background: #fafcff;
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
  background: #fafcff;
  box-sizing: border-box;
}

.soql-editor:focus {
  outline: none;
  background: #fff;
}

.soql-suggest {
  flex-shrink: 0;
  max-height: 120px;
  overflow: auto;
  border-top: 1px solid #e3f2fd;
  background: #fff;
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
  background: #fafcff;
  cursor: pointer;
  text-align: left;
  color: #546e7a;
}

.soql-preview:hover {
  background: #f0f7ff;
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
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-deep);
}

.results-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0 10px 10px;
  border: 1px solid #e3f2fd;
  border-radius: 6px;
  background: #fafcff;
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
  background: #fafcff;
  border: 1px solid #e3f2fd;
  border-radius: 6px;
  max-height: 200px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.5;
}

.confirm-list li + li {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed #e3f2fd;
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
  background: #fafcff;
  z-index: 1;
}

.results-table th,
.results-table td {
  border-bottom: 1px solid #e3f2fd;
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
  background: #e3f2fd;
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

.status-text {
  flex-shrink: 0;
  margin: 2px 12px 0;
  font-size: 12px;
  color: #2e7d32;
  max-height: 36px;
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
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1.2fr);
  }
  .query-panel {
    grid-column: 1 / -1;
  }
}
</style>
