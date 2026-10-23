<template>
  <div class="apex-app">
    <header class="apex-header">
      <div class="apex-header-left">
        <h1>{{ t('apexLog.productTitle') }}</h1>
        <span class="apex-user" v-if="currentUserName">{{ currentUserName }}</span>
      </div>
      <div class="apex-header-right">
        <LocaleSwitcher variant="dark" />
        <select v-model="selectedEnvId" class="apex-select" @change="onEnvChange">
          <option value="">{{ t('apexLog.selectLoggedInEnv') }}</option>
          <option v-for="env in environments" :key="env.id" :value="env.id">
            {{ env.name }} · {{ env.hostname }}
          </option>
        </select>
        <button class="apex-btn apex-btn-icon" :title="t('apexLog.refreshEnvList')" :disabled="busy" @click="refreshEnvs">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 4v5h-5M3 16v-5h5"/>
            <path d="M4.5 9A7 7 0 0116 6.5M15.5 11A7 7 0 014 13.5"/>
          </svg>
        </button>
      </div>
    </header>

    <ToolToast
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      @close="closeToast"
    />

    <!-- 欢迎 / 无环境 -->
    <div v-if="!activeEnvId" class="apex-welcome">
      <div class="apex-welcome-card">
        <div class="apex-welcome-icon">
          <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="8" y="10" width="32" height="28" rx="4"/>
            <path d="M14 18h20M14 24h16M14 30h12"/>
          </svg>
        </div>
        <h2>{{ t('apexLog.welcomeTitle') }}</h2>
        <p>{{ t('apexLog.welcomeDesc') }}</p>
        <p v-if="!environments.length && !busy" class="apex-hint">{{ t('apexLog.welcomeHint') }}</p>
        <button class="apex-btn apex-btn-primary" :disabled="busy" @click="refreshEnvs">
          {{ busy ? t('apexLog.scanning') : t('apexLog.scanLoggedInEnvs') }}
        </button>
      </div>
    </div>

    <!-- 主界面 -->
    <div v-else class="apex-main">
      <aside class="apex-sidebar">
        <div class="apex-toolbar">
          <div class="apex-toolbar-row">
            <button class="apex-btn apex-btn-secondary apex-btn-sm" @click="markAllRead">{{ t('apexLog.markAllRead') }}</button>
            <span class="apex-count">{{ filteredLogs.length }}{{ filteredLogs.length !== logs.length ? '/' + logs.length : '' }}</span>
          </div>
          <div class="apex-filters">
            <div class="apex-filter-group">
              <span>{{ t('apexLog.filterApp') }}</span>
              <button
                v-for="f in appFilters"
                :key="'app-' + f.value"
                type="button"
                :class="['apex-chip', { active: appFilter === f.value }]"
                @click="appFilter = f.value"
              >{{ f.label }}</button>
            </div>
            <div class="apex-filter-group">
              <span>{{ t('apexLog.filterStatus') }}</span>
              <button
                v-for="f in statusFilters"
                :key="'st-' + f.value"
                type="button"
                :class="['apex-chip', { active: statusFilter === f.value }]"
                @click="statusFilter = f.value"
              >{{ f.label }}</button>
            </div>
            <div class="apex-filter-group">
              <span>{{ t('apexLog.filterUser') }}</span>
              <button type="button" :class="['apex-chip', { active: userFilter === 'all' }]" @click="userFilter = 'all'">{{ t('apexLog.filterAll') }}</button>
              <button type="button" :class="['apex-chip', { active: userFilter === 'current' }]" @click="userFilter = 'current'">
                {{ currentUserName || t('apexLog.currentUser') }}
              </button>
              <button
                v-for="u in trackedUsers"
                :key="'tu-' + u.id"
                type="button"
                :class="['apex-chip', 'apex-chip-tracked', { active: userFilter === u.id }]"
                :title="[u.username, u.email].filter(Boolean).join(' · ')"
                @click="userFilter = u.id"
              >{{ u.name }}</button>
            </div>
            <div class="apex-filter-actions">
              <button class="apex-btn apex-btn-outline apex-btn-sm" :disabled="busy" @click="onTrackAutomated">
                {{ t('apexLog.trackProcessAutomated') }}
              </button>
              <button class="apex-btn apex-btn-outline apex-btn-sm" :disabled="busy" @click="openUserModal">
                {{ t('apexLog.addCustomUser') }}
              </button>
              <button class="apex-btn apex-btn-outline apex-btn-sm" :disabled="busy" @click="onRenewTrace">
                {{ t('apexLog.renewTraceFlag') }}
              </button>
            </div>
          </div>
          <div class="apex-poll-bar"><div class="apex-poll-fill" :style="{ width: pollProgress + '%' }"></div></div>
        </div>

        <div class="apex-log-list">
          <div v-if="loadingLogs" class="apex-empty">{{ t('apexLog.loadingLogs') }}</div>
          <div v-else-if="!filteredLogs.length" class="apex-empty">{{ t('apexLog.noLogs') }}</div>
          <button
            v-for="log in filteredLogs"
            :key="log.Id"
            type="button"
            :class="['apex-log-card', { selected: selectedLog?.Id === log.Id, read: readIds.has(log.Id) }]"
            @click="openDetail(log)"
          >
            <span :class="['apex-status', isSuccess(log.Status) ? 'ok' : 'bad']">
              {{ isSuccess(log.Status) ? '✓' : '✗' }}
            </span>
            <span class="apex-op">{{ log.Operation || 'Unknown' }}</span>
            <span class="apex-app-tag">{{ log.Application || 'System' }}</span>
            <span class="apex-meta">{{ formatTime(log.StartTime) }}</span>
            <span class="apex-meta">{{ formatDuration(log.DurationMilliseconds) }}</span>
          </button>
        </div>
      </aside>

      <section class="apex-detail">
        <div v-if="!selectedLog" class="apex-detail-empty">
          <p>{{ t('apexLog.selectLogHint') }}</p>
        </div>
        <template v-else>
          <div class="apex-detail-head">
            <div class="apex-detail-title">
              <strong>{{ selectedLog.Operation || 'Log' }}</strong>
              <span :class="['apex-status-pill', isSuccess(selectedLog.Status) ? 'ok' : 'bad']">
                {{ selectedLog.Status }}
              </span>
            </div>
            <div class="apex-detail-actions">
              <button class="apex-btn apex-btn-secondary apex-btn-sm" :disabled="!logBody" @click="copyBody">{{ t('apexLog.copyFiltered') }}</button>
              <button class="apex-btn apex-btn-secondary apex-btn-sm" :disabled="!logBody" @click="copyRawBody">{{ t('apexLog.copyFull') }}</button>
              <button class="apex-btn apex-btn-secondary apex-btn-sm" :disabled="!logBody" @click="downloadBody">{{ t('apexLog.download') }}</button>
            </div>
          </div>
          <div class="apex-detail-meta">
            <span>{{ t('apexLog.metaUser') }}：{{ selectedLog.LogUser?.Name || '-' }}</span>
            <span>{{ t('apexLog.metaApp') }}：{{ selectedLog.Application || '-' }}</span>
            <span>{{ t('apexLog.metaTime') }}：{{ formatTime(selectedLog.StartTime) }}</span>
            <span>{{ t('apexLog.metaDuration') }}：{{ formatDuration(selectedLog.DurationMilliseconds) }}</span>
            <span>{{ t('apexLog.metaSize') }}：{{ formatSize(selectedLog.LogLength) }}</span>
            <span v-if="parsedLog.apiVersion">API {{ parsedLog.apiVersion }}</span>
          </div>

          <div v-if="loadingBody" class="apex-empty">{{ t('apexLog.loadingBody') }}</div>
          <template v-else-if="logBody">
            <div class="apex-summary">
              <button
                v-for="chip in summaryChips"
                :key="chip.id"
                type="button"
                :class="['apex-summary-chip', chip.kind, { active: detailFilter === chip.id }]"
                @click="detailFilter = chip.id"
              >
                <span class="apex-summary-label">{{ chip.label }}</span>
                <strong>{{ chip.count }}</strong>
              </button>
              <span class="apex-detail-count">{{ t('apexLog.linesCount', { visible: visibleLines.length, total: parsedLog.counts.total }) }}</span>
            </div>

            <div v-if="parsedLog.categories.length" class="apex-levels">
              <span
                v-for="cat in parsedLog.categories"
                :key="cat.name"
                class="apex-level-pill"
                :title="cat.name + ' = ' + cat.level"
              >{{ cat.name }} · {{ cat.level }}</span>
            </div>

            <div class="apex-log-view">
              <div class="apex-log-cols">
                <span>#</span>
                <span>{{ t('apexLog.colTime') }}</span>
                <span>{{ t('apexLog.colEvent') }}</span>
                <span>{{ t('apexLog.colContent') }}</span>
              </div>
              <div v-if="!visibleLines.length" class="apex-empty apex-empty-inline">{{ t('apexLog.noMatchingLines') }}</div>
              <div
                v-for="row in visibleLines"
                :key="row.index"
                :class="['apex-log-row', 'kind-' + row.kind]"
              >
                <span class="apex-ln">{{ row.index + 1 }}</span>
                <span class="apex-lt" :title="row.time">{{ compactTime(row.time) }}</span>
                <span class="apex-le">
                  <span v-if="row.type" :class="['apex-event', 'kind-' + row.kind]">{{ shortEvent(row.type) }}</span>
                  <span v-else class="apex-event kind-other">—</span>
                </span>
                <span class="apex-lc" :title="row.content || row.raw">{{ row.content || row.raw }}</span>
              </div>
            </div>
          </template>
          <div v-else class="apex-empty">{{ t('apexLog.emptyBody') }}</div>
        </template>
      </section>
    </div>
  </div>

  <!-- 添加自定义用户 -->
  <Teleport to="body">
    <Transition name="apex-modal">
      <div v-if="userModalOpen" class="apex-modal-overlay">
        <div class="apex-modal" role="dialog" aria-labelledby="apex-user-modal-title">
          <div class="apex-modal-head">
            <h2 id="apex-user-modal-title">{{ t('apexLog.modalAddUser') }}</h2>
            <button type="button" class="apex-modal-close" @click="closeUserModal">×</button>
          </div>
          <div class="apex-modal-body">
            <p class="apex-modal-hint">{{ t('apexLog.modalHint') }}</p>

            <section class="apex-user-section apex-user-section-filters">
              <div class="apex-user-section-head">{{ t('apexLog.searchCriteria') }}</div>
              <div class="apex-user-form">
                <label>Name<input v-model.trim="userSearch.name" type="text" :placeholder="t('apexLog.placeholderDisplayName')" @keydown.enter.prevent="runUserSearch" /></label>
                <label>Email<input v-model.trim="userSearch.email" type="text" :placeholder="t('apexLog.placeholderEmail')" @keydown.enter.prevent="runUserSearch" /></label>
                <label>Username<input v-model.trim="userSearch.username" type="text" :placeholder="t('apexLog.placeholderUsername')" @keydown.enter.prevent="runUserSearch" /></label>
                <label>Alias<input v-model.trim="userSearch.alias" type="text" :placeholder="t('apexLog.placeholderAlias')" @keydown.enter.prevent="runUserSearch" /></label>
                <label>First Name<input v-model.trim="userSearch.firstName" type="text" @keydown.enter.prevent="runUserSearch" /></label>
                <label>Last Name<input v-model.trim="userSearch.lastName" type="text" @keydown.enter.prevent="runUserSearch" /></label>
                <label class="apex-user-check">
                  <input v-model="userSearch.isActive" type="checkbox" />
                  {{ t('apexLog.activeUsersOnly') }}
                </label>
              </div>
              <span v-if="userSearchError" class="apex-modal-error">{{ userSearchError }}</span>
            </section>

            <section class="apex-user-section apex-user-section-results">
              <div class="apex-user-section-head">
                {{ t('apexLog.searchResults') }}
                <span v-if="userResults.length" class="apex-user-section-count">{{ userResults.length }}</span>
                <span v-if="selectedUserIds.length" class="apex-user-section-picked">{{ t('apexLog.selectedCount', { count: selectedUserIds.length }) }}</span>
              </div>
              <div class="apex-user-results">
                <div v-if="searchingUsers" class="apex-empty apex-empty-inline">{{ t('apexLog.searching') }}</div>
                <div v-else-if="!userResults.length" class="apex-empty apex-empty-inline">
                  {{ userSearched ? t('apexLog.noMatchingUsers') : t('apexLog.enterCriteriaToSearch') }}
                </div>
                <label
                  v-for="u in userResults"
                  :key="u.id"
                  :class="['apex-user-result', { selected: selectedUserIds.includes(u.id) }]"
                >
                  <input
                    type="checkbox"
                    class="apex-user-result-check"
                    :checked="selectedUserIds.includes(u.id)"
                    @change="toggleUserSelect(u.id)"
                  />
                  <div class="apex-user-result-body">
                    <div class="apex-user-result-main">
                      <strong>{{ u.name }}</strong>
                      <span v-if="!u.isActive" class="apex-user-inactive">{{ t('apexLog.inactive') }}</span>
                    </div>
                    <div class="apex-user-result-meta">
                      <span v-if="u.username">{{ u.username }}</span>
                      <span v-if="u.email">{{ u.email }}</span>
                      <span v-if="u.alias">Alias: {{ u.alias }}</span>
                      <span v-if="u.profileName">{{ u.profileName }}</span>
                    </div>
                  </div>
                </label>
              </div>
            </section>
          </div>
          <div class="apex-modal-footer">
            <button
              type="button"
              class="apex-btn apex-btn-primary apex-search-btn"
              :disabled="searchingUsers || confirmingUsers"
              @click="runUserSearch"
            >
              {{ searchingUsers ? t('apexLog.searching') : t('apexLog.search') }}
            </button>
            <button
              type="button"
              class="apex-btn apex-btn-primary apex-confirm-btn"
              :disabled="!selectedUserIds.length || confirmingUsers || searchingUsers"
              @click="confirmSelectedUsers"
            >
              {{ confirmingUsers ? t('apexLog.adding') : (selectedUserIds.length ? t('apexLog.confirmWithCount', { count: selectedUserIds.length }) : t('common.confirm')) }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '../../components/LocaleSwitcher.vue'
import ToolToast from '../_shared/ToolToast.vue'
import { useToolToast } from '../_shared/useToolToast.js'
import { useApexLogApi } from './useApexLogApi'
import {
  parseApexLogBody,
  filterParsedLines,
  getKindLabel
} from './parseApexLog.js'
import {
  searchUsersClient,
  createOrRenewUserTraceFlag,
  persistTrackedUser
} from './sfUserTrace.js'
import { pickEnvForPage, readPageEnvPreferFromUrl } from '../_shared/sfApi.js'

const { t, locale } = useI18n()
const { toastVisible, toastMessage, toastType, showToast, closeToast } = useToolToast()
const api = useApexLogApi()

/** ApexLog.Status：英文 Org 为 Success；中文界面常为「成功」 */
const SUCCESS_STATUSES = ['Success', 'SUCCESS', 'Completed', '成功']

const environments = ref([])
const selectedEnvId = ref('')
const activeEnvId = ref('')
const pagePrefer = ref(readPageEnvPreferFromUrl())
const currentUserName = ref('')
const logs = ref([])
const selectedLog = ref(null)
const logBody = ref('')
const readIds = ref(new Set())
const busy = ref(false)
const loadingLogs = ref(false)
const loadingBody = ref(false)
const appFilter = ref('')
const statusFilter = ref('')
const userFilter = ref('current')
const trackedUsers = ref([])
const detailFilter = ref('all')
const pollProgress = ref(0)

const userModalOpen = ref(false)
const searchingUsers = ref(false)
const userSearched = ref(false)
const userSearchError = ref('')
const userResults = ref([])
const selectedUserIds = ref([])
const confirmingUsers = ref(false)
const userSearch = ref({
  name: '',
  email: '',
  username: '',
  alias: '',
  firstName: '',
  lastName: '',
  isActive: true
})

let pollUiTimer = null
let renewTimer = null

const appFilters = computed(() => [
  { label: t('apexLog.filterAll'), value: '' },
  { label: 'API', value: 'Api' },
  { label: 'Browser', value: 'Browser' },
  { label: 'System', value: 'System' }
])
const statusFilters = computed(() => [
  { label: t('apexLog.filterAll'), value: '' },
  { label: t('apexLog.filterSuccess'), value: 'success' },
  { label: t('apexLog.filterError'), value: 'error' }
])

const filteredLogs = computed(() => {
  return logs.value.filter((log) => {
    const matchesApp = !appFilter.value || log.Application === appFilter.value
    let matchesStatus = true
    if (statusFilter.value === 'success') matchesStatus = isSuccess(log.Status)
    if (statusFilter.value === 'error') matchesStatus = !isSuccess(log.Status)
    let matchesUser = true
    if (userFilter.value === 'current' && currentUserName.value) {
      matchesUser = log.LogUser?.Name === currentUserName.value
    } else if (userFilter.value && userFilter.value !== 'all' && userFilter.value !== 'current') {
      const tracked = trackedUsers.value.find((u) => u.id === userFilter.value)
      matchesUser = log.LogUserId === userFilter.value || log.LogUser?.Name === tracked?.name
    }
    return matchesApp && matchesStatus && matchesUser
  })
})

const parsedLog = computed(() => parseApexLogBody(logBody.value))

const visibleLines = computed(() =>
  filterParsedLines(parsedLog.value.lines, detailFilter.value)
)

const summaryChips = computed(() => {
  const c = parsedLog.value.counts
  return [
    { id: 'all', label: t('apexLog.summaryAll'), count: c.total, kind: 'other' },
    { id: 'debug', label: getKindLabel('debug'), count: c.debug, kind: 'debug' },
    { id: 'error', label: t('apexLog.summaryError'), count: c.error, kind: 'error' },
    { id: 'db', label: t('apexLog.summaryDb'), count: c.db, kind: 'db' },
    { id: 'code', label: t('apexLog.summaryCode'), count: c.code, kind: 'code' },
    { id: 'flow', label: getKindLabel('flow'), count: c.flow, kind: 'flow' },
    { id: 'callout', label: getKindLabel('callout'), count: c.callout, kind: 'callout' }
  ]
})

const displayBody = computed(() =>
  visibleLines.value.map((r) => r.raw).join('\n')
)

function compactTime(time) {
  if (!time) return ''
  // 11:47:46.038 (38296000) → 11:47:46.038
  return String(time).replace(/\s*\(\d+\)\s*$/, '')
}

function shortEvent(type) {
  if (!type) return ''
  return String(type).replace(/^USER_/, '')
}

function isSuccess(status) {
  if (status == null || status === '') return false
  const s = String(status).trim()
  if (SUCCESS_STATUSES.includes(s)) return true
  const lower = s.toLowerCase()
  return lower === 'success' || lower === 'completed'
}

function formatTime(dateStr) {
  if (!dateStr) return '-'
  const loc =
    locale.value === 'zh-CN' ? 'zh-CN' : locale.value === 'ja' ? 'ja' : 'en'
  return new Date(dateStr).toLocaleTimeString(loc, { hour12: false })
}

function formatDuration(ms) {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatSize(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes}B`
  return `${(bytes / 1024).toFixed(1)}KB`
}

async function refreshEnvs() {
  busy.value = true
  try {
    const res = await api.discover()
    if (!res.success) throw new Error(res.error || t('apexLog.toastScanFailed'))
    environments.value = res.environments || []
    const preferred = pickEnvForPage(environments.value, pagePrefer.value)
    if (preferred) {
      selectedEnvId.value = preferred.id
      if (activeEnvId.value !== preferred.id) {
        await onEnvChange()
      } else {
        const env = environments.value.find((e) => e.id === preferred.id)
        currentUserName.value = env?.userName || currentUserName.value
      }
    } else if (res.activeEnvId && environments.value.some((e) => e.id === res.activeEnvId)) {
      selectedEnvId.value = res.activeEnvId
      activeEnvId.value = res.activeEnvId
      const env = environments.value.find((e) => e.id === res.activeEnvId)
      currentUserName.value = env?.userName || ''
    }
    if (!environments.value.length) {
      showToast(t('apexLog.toastNoEnvs'), 'error')
    } else {
      showToast(t('apexLog.toastEnvsFound', { count: environments.value.length }))
    }
  } catch (e) {
    showToast(e.message || t('apexLog.toastScanFailed'), 'error')
  } finally {
    busy.value = false
  }
}

async function onEnvChange() {
  const envId = selectedEnvId.value
  if (!envId) {
    await stopRuntime()
    activeEnvId.value = ''
    currentUserName.value = ''
    trackedUsers.value = []
    userFilter.value = 'current'
    logs.value = []
    selectedLog.value = null
    logBody.value = ''
    return
  }
  busy.value = true
  try {
    const res = await api.switchEnv(envId)
    if (!res.success) throw new Error(res.error || t('apexLog.toastSwitchFailed'))
    activeEnvId.value = envId
    currentUserName.value = res.userName || ''
    environments.value = res.environments || environments.value
    trackedUsers.value = res.trackedUsers || []
    userFilter.value = 'current'
    logs.value = []
    selectedLog.value = null
    logBody.value = ''
    showToast(t('apexLog.toastConnected'))
    await loadLogs(true)
    startRuntime()
  } catch (e) {
    selectedEnvId.value = activeEnvId.value || ''
    showToast(e.message || t('apexLog.toastSwitchFailed'), 'error')
  } finally {
    busy.value = false
  }
}

async function loadLogs(replace = false) {
  if (!activeEnvId.value) return
  loadingLogs.value = replace && logs.value.length === 0
  try {
    const res = await api.fetchLogs(100)
    if (!res.success) {
      if (res.error === 'Session expired') {
        showToast(t('apexLog.toastSessionExpired'), 'error')
        await stopRuntime()
        return
      }
      throw new Error(res.error || t('apexLog.toastFetchFailed'))
    }
    const records = res.data?.records || []
    if (replace) {
      logs.value = records
    } else {
      const existing = new Set(logs.value.map((l) => l.Id))
      const newer = records.filter((l) => !existing.has(l.Id))
      if (newer.length) {
        logs.value = [...newer, ...logs.value]
          .sort((a, b) => new Date(b.StartTime) - new Date(a.StartTime))
          .slice(0, 200)
      }
    }
  } catch (e) {
    if (replace) showToast(e.message || t('apexLog.toastLoadLogsFailed'), 'error')
  } finally {
    loadingLogs.value = false
  }
}

async function openDetail(log) {
  selectedLog.value = log
  detailFilter.value = 'all'
  const next = new Set(readIds.value)
  next.add(log.Id)
  readIds.value = next
  loadingBody.value = true
  logBody.value = ''
  try {
    const res = await api.fetchLogBody(log.Id)
    if (!res.success) throw new Error(res.error || t('apexLog.toastLoadBodyFailed'))
    logBody.value = res.body || ''
  } catch (e) {
    showToast(e.message || t('apexLog.toastLoadBodyFailed'), 'error')
  } finally {
    loadingBody.value = false
  }
}

function markAllRead() {
  readIds.value = new Set(filteredLogs.value.map((l) => l.Id))
}

async function onRenewTrace() {
  busy.value = true
  try {
    const res = await api.renewTraceFlag(60)
    if (!res.success) throw new Error(res.error || t('apexLog.toastRenewFailed'))
    const extra = Array.isArray(res.tracked) ? res.tracked.filter((tr) => tr.success !== false).length : 0
    showToast(extra ? t('apexLog.toastRenewWithTracked', { count: extra }) : t('apexLog.toastRenewOk'))
  } catch (e) {
    showToast(e.message || t('apexLog.toastRenewFailed'), 'error')
  } finally {
    busy.value = false
  }
}

async function onTrackAutomated() {
  busy.value = true
  try {
    const res = await api.trackProcessAutomated(60)
    if (!res.success) throw new Error(res.error || t('apexLog.toastTrackFailed'))
    if (res.trackedUsers) trackedUsers.value = res.trackedUsers
    const uid = res.userId
    if (uid) userFilter.value = uid
    showToast(t('apexLog.toastTrackAutomatedOk'))
  } catch (e) {
    showToast(e.message || t('apexLog.toastTrackFailed'), 'error')
  } finally {
    busy.value = false
  }
}

function openUserModal() {
  userModalOpen.value = true
  userSearchError.value = ''
  selectedUserIds.value = []
}

function closeUserModal() {
  userModalOpen.value = false
  confirmingUsers.value = false
  selectedUserIds.value = []
}

function currentEnvHostname() {
  const env =
    environments.value.find((e) => e.id === activeEnvId.value) ||
    environments.value.find((e) => e.id === selectedEnvId.value)
  return env?.hostname || ''
}

function toggleUserSelect(id) {
  const set = new Set(selectedUserIds.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  selectedUserIds.value = [...set]
}

async function runUserSearch() {
  userSearchError.value = ''
  searchingUsers.value = true
  userSearched.value = true
  selectedUserIds.value = []
  try {
    const host = currentEnvHostname()
    if (!host) throw new Error(t('apexLog.toastSelectEnvFirst'))
    userResults.value = await searchUsersClient(host, { ...userSearch.value }, 40)
  } catch (e) {
    userResults.value = []
    userSearchError.value = e.message || String(e)
  } finally {
    searchingUsers.value = false
  }
}

async function confirmSelectedUsers() {
  if (!selectedUserIds.value.length || confirmingUsers.value) return
  confirmingUsers.value = true
  userSearchError.value = ''
  try {
    const host = currentEnvHostname()
    if (!host) throw new Error(t('apexLog.toastSelectEnvFirst'))
    if (!activeEnvId.value) throw new Error(t('apexLog.toastNoActiveEnv'))

    const picked = userResults.value.filter((u) => selectedUserIds.value.includes(u.id))
    if (!picked.length) throw new Error(t('apexLog.toastSelectUsersFirst'))

    let lastId = ''
    for (const user of picked) {
      await createOrRenewUserTraceFlag(host, user.id, 60)
      trackedUsers.value = await persistTrackedUser(activeEnvId.value, user)
      api.trackUser(user, 60, { skipTraceFlag: true }).then((res) => {
        if (res?.trackedUsers) trackedUsers.value = res.trackedUsers
      }).catch(() => {})
      lastId = user.id
    }

    if (lastId) userFilter.value = lastId
    closeUserModal()
    showToast(t('apexLog.toastAddUsersOk', { count: picked.length }))
  } catch (e) {
    userSearchError.value = e.message || String(e)
    showToast(e.message || t('apexLog.toastAddFailed'), 'error')
  } finally {
    confirmingUsers.value = false
  }
}

function copyBody() {
  if (!displayBody.value) return
  navigator.clipboard.writeText(displayBody.value).then(
    () => showToast(t('apexLog.toastCopyFilteredOk')),
    () => showToast(t('apexLog.toastCopyFailed'), 'error')
  )
}

function copyRawBody() {
  if (!logBody.value) return
  navigator.clipboard.writeText(logBody.value).then(
    () => showToast(t('apexLog.toastCopyFullOk')),
    () => showToast(t('apexLog.toastCopyFailed'), 'error')
  )
}

function downloadBody() {
  if (!logBody.value || !selectedLog.value) return
  const blob = new Blob([logBody.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `apex-log-${selectedLog.value.Id}.log`
  a.click()
  URL.revokeObjectURL(url)
}

function startRuntime() {
  stopRuntimeTimersOnly()
  api.startPolling(3000).catch(() => {})
  let tick = 0
  pollUiTimer = setInterval(() => {
    tick = (tick + 1) % 30
    pollProgress.value = (tick / 30) * 100
  }, 100)
  renewTimer = setInterval(() => {
    api.renewTraceFlag(60).catch(() => {})
  }, 25 * 60 * 1000)
}

function stopRuntimeTimersOnly() {
  if (pollUiTimer) clearInterval(pollUiTimer)
  if (renewTimer) clearInterval(renewTimer)
  pollUiTimer = null
  renewTimer = null
  pollProgress.value = 0
}

async function stopRuntime() {
  stopRuntimeTimersOnly()
  await api.stopPolling().catch(() => {})
}

function onPollingTick() {
  loadLogs(false)
}

function onMessage(message) {
  if (message?.action === 'apexLog:pollingTick') onPollingTick()
  if (message?.action === 'toolPreferEnvironment' && message.toolId === 'apex-log') {
    pagePrefer.value = {
      hostname: message.hostname || '',
      orgId: message.orgId || ''
    }
    const preferred = pickEnvForPage(environments.value, pagePrefer.value)
    if (!preferred) {
      refreshEnvs().catch(() => {})
      return
    }
    if (selectedEnvId.value === preferred.id && activeEnvId.value === preferred.id) return
    selectedEnvId.value = preferred.id
    onEnvChange().catch(() => {})
  }
}

onMounted(async () => {
  chrome.runtime?.onMessage?.addListener(onMessage)
  busy.value = true
  try {
    const state = await api.getState()
    if (state.success) {
      environments.value = state.environments || []
      trackedUsers.value = state.trackedUsers || []
      const preferred = pickEnvForPage(environments.value, pagePrefer.value)
      if (preferred) {
        selectedEnvId.value = preferred.id
      } else if (state.activeEnvId) {
        selectedEnvId.value = state.activeEnvId
        activeEnvId.value = state.activeEnvId
        const env = environments.value.find((e) => e.id === state.activeEnvId)
        currentUserName.value = env?.userName || ''
      }
    }
    await refreshEnvs()
    if (activeEnvId.value) {
      const again = await api.getState().catch(() => null)
      if (again?.trackedUsers) trackedUsers.value = again.trackedUsers
      await loadLogs(true)
      startRuntime()
    }
  } finally {
    busy.value = false
  }
})

onBeforeUnmount(() => {
  chrome.runtime?.onMessage?.removeListener(onMessage)
  stopRuntime()
})

watch([appFilter, statusFilter, userFilter], () => {
  /* filteredLogs is computed */
})
</script>

<style scoped>
/* Quick Login 蓝白 + 圆角分块布局 */
.apex-app {
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
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  padding: var(--gap);
  box-sizing: border-box;
  background: var(--page);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.apex-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
  border: 1px solid transparent;
  border-radius: var(--radius);
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.25);
  color: #fff;
}

.apex-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  /* 与 SOQL 区分：冰蓝，贴合 Log/Debug */
  color: #b3e5fc;
  text-shadow: 0 1px 1px rgba(0, 40, 80, 0.25);
}

.apex-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.apex-user {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: rgba(255, 255, 255, 0.2);
  padding: 3px 10px;
  border-radius: 999px;
}

.apex-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.apex-select {
  min-width: 220px;
  max-width: 360px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.95);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 500;
}

.apex-select:focus {
  outline: none;
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
}

.apex-btn {
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 7px 12px;
  transition: all 0.15s ease;
}

.apex-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.apex-btn-primary {
  background: var(--accent);
  color: #fff;
}

.apex-btn-primary:hover:not(:disabled) {
  background: var(--accent-deep);
}

.apex-btn-secondary {
  background: var(--soft);
  color: var(--accent-deep);
  border: 1px solid var(--border);
}

.apex-btn-secondary:hover:not(:disabled) {
  background: #d6eafb;
}

.apex-btn-outline {
  background: #fff;
  color: var(--accent);
  border: 1px solid var(--border);
}

.apex-btn-outline:hover:not(:disabled) {
  background: var(--panel);
}

.apex-btn-sm {
  padding: 4px 8px;
  font-size: 11px;
}

.apex-btn-icon {
  width: 32px;
  height: 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

.apex-btn-icon:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.28);
}

.apex-welcome {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.apex-welcome-card {
  width: 100%;
  max-width: 440px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px 28px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(25, 118, 210, 0.1);
}

.apex-welcome-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 14px;
  border-radius: 12px;
  background: var(--soft);
  color: var(--accent-2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.apex-welcome-card h2 {
  margin: 0 0 8px;
  color: var(--accent-deep);
  font-size: 18px;
}

.apex-welcome-card p {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}

.apex-hint {
  color: #c62828 !important;
}

.apex-main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: var(--gap);
}

.apex-sidebar,
.apex-detail {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.apex-toolbar {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: #fff;
}

.apex-toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.apex-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: var(--soft);
  padding: 2px 8px;
  border-radius: 999px;
}

.apex-filters {
  padding: 4px 0 0;
}

.apex-filter-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  margin-bottom: 6px;
}

.apex-filter-group > span {
  font-size: 11px;
  color: #78909c;
  width: 32px;
}

.apex-chip {
  border: 1px solid var(--border);
  background: #fff;
  color: #5c7a9b;
  border-radius: 999px;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.apex-chip:hover {
  border-color: #90caf9;
  color: var(--accent);
}

.apex-chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.apex-filter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.apex-poll-bar {
  margin-top: 8px;
  height: 3px;
  background: var(--soft);
  border-radius: 3px;
  overflow: hidden;
}

.apex-poll-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.1s linear;
}

.apex-log-list {
  flex: 1;
  overflow: auto;
  padding: 10px;
  background: var(--panel);
}

.apex-log-card {
  width: 100%;
  display: grid;
  grid-template-columns: 16px 1fr auto;
  grid-template-rows: auto auto;
  gap: 2px 6px;
  text-align: left;
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
}

.apex-log-card:hover {
  border-color: #90caf9;
}

.apex-log-card.read {
  opacity: 0.72;
}

.apex-log-card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(25, 118, 210, 0.25);
}

.apex-status {
  grid-row: 1 / span 2;
  font-size: 12px;
  font-weight: 700;
  padding-top: 2px;
}

.apex-status.ok,
.apex-status-pill.ok {
  color: #2e7d32;
}

.apex-status.bad,
.apex-status-pill.bad {
  color: #c62828;
}

.apex-op {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-deep);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.apex-app-tag {
  font-size: 10px;
  color: var(--accent-2);
  background: var(--soft);
  border-radius: 4px;
  padding: 1px 5px;
  justify-self: end;
}

.apex-meta {
  font-size: 10px;
  color: #90a4ae;
}

.apex-detail-empty,
.apex-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #90a4ae;
  font-size: 13px;
  padding: 24px;
}

.apex-detail-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.apex-detail-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.apex-detail-title strong {
  color: var(--accent-deep);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.apex-status-pill {
  font-size: 11px;
  font-weight: 600;
}

.apex-detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.apex-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #5c7a9b;
}

.apex-detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  padding: 8px 14px;
  font-size: 11px;
  color: var(--muted);
  border-bottom: 1px solid #e3f2fd;
  background: #fafcff;
  flex-shrink: 0;
}

.apex-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #e3f2fd;
  background: #fff;
  flex-shrink: 0;
}

.apex-summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  transition: all 0.15s ease;
}

.apex-summary-chip:hover {
  border-color: #90caf9;
}

.apex-summary-chip.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(25, 118, 210, 0.2);
  background: var(--soft);
}

.apex-summary-label {
  font-size: 11px;
  color: var(--muted);
}

.apex-summary-chip strong {
  font-size: 13px;
  color: var(--accent-deep);
  font-variant-numeric: tabular-nums;
}

.apex-summary-chip.kind-debug strong { color: #2e7d32; }
.apex-summary-chip.kind-error strong { color: #c62828; }
.apex-summary-chip.kind-db strong { color: #1565c0; }
.apex-summary-chip.kind-code strong { color: #6a1b9a; }
.apex-summary-chip.kind-flow strong { color: #ef6c00; }
.apex-summary-chip.kind-callout strong { color: #00897b; }

.apex-levels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid #e3f2fd;
  background: #fafcff;
  flex-shrink: 0;
}

.apex-level-pill {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--border);
  color: #5c7a9b;
}

.apex-detail-count {
  margin-left: auto;
  font-size: 11px;
  color: #90a4ae;
  white-space: nowrap;
}

.apex-log-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #f7fbff;
}

.apex-log-cols,
.apex-log-row {
  display: grid;
  grid-template-columns: 44px 96px 148px minmax(0, 1fr);
  gap: 0 8px;
  align-items: start;
  padding: 0 10px;
}

.apex-log-cols {
  position: sticky;
  top: 0;
  z-index: 2;
  padding-top: 8px;
  padding-bottom: 8px;
  border-left: 3px solid transparent;
  box-sizing: border-box;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #78909c;
  background: #eef5fc;
  border-bottom: 1px solid var(--border);
}

.apex-log-row {
  padding-top: 7px;
  padding-bottom: 7px;
  border-bottom: 1px solid #e8f1fa;
  /* 未分类也占位，避免与有色条行错位 */
  border-left: 3px solid transparent;
  font-size: 11px;
  background: #fff;
  box-sizing: border-box;
}

.apex-log-row:hover {
  background: #f5f9ff;
}

.apex-log-row.kind-debug {
  border-left-color: #66bb6a;
}

.apex-log-row.kind-error {
  border-left-color: #ef5350;
  background: #fff8f8;
}

.apex-log-row.kind-db {
  border-left-color: #42a5f5;
}

.apex-log-row.kind-code {
  border-left-color: #ab47bc;
}

.apex-log-row.kind-flow {
  border-left-color: #ffa726;
}

.apex-log-row.kind-callout {
  border-left-color: #26a69a;
}

.apex-log-row.kind-limit {
  border-left-color: #78909c;
}

.apex-log-row.kind-header,
.apex-log-row.kind-system {
  border-left-color: #90a4ae;
  background: #fafcff;
}

.apex-log-row.kind-other {
  border-left-color: transparent;
}

.apex-ln {
  color: #b0bec5;
  font-variant-numeric: tabular-nums;
  text-align: right;
  padding-top: 2px;
}

.apex-lt {
  color: #78909c;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 10px;
  padding-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.apex-le {
  min-width: 0;
}

.apex-event {
  display: inline-block;
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  font-family: Consolas, 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: top;
}

.apex-event.kind-debug { background: #e8f5e9; color: #2e7d32; }
.apex-event.kind-error { background: #ffebee; color: #c62828; }
.apex-event.kind-db { background: #e3f2fd; color: #1565c0; }
.apex-event.kind-code { background: #f3e5f5; color: #6a1b9a; }
.apex-event.kind-flow { background: #fff3e0; color: #ef6c00; }
.apex-event.kind-callout { background: #e0f2f1; color: #00695c; }
.apex-event.kind-limit { background: #eceff1; color: #546e7a; }
.apex-event.kind-system,
.apex-event.kind-header { background: #eceff1; color: #607d8b; }
.apex-event.kind-other { background: #f5f5f5; color: #757575; }

.apex-lc {
  color: #37474f;
  font-family: Consolas, 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
}

.apex-log-row.kind-debug .apex-lc {
  color: #1b5e20;
}

.apex-log-row.kind-error .apex-lc {
  color: #b71c1c;
  font-weight: 600;
}

.apex-empty-inline {
  min-height: 120px;
}

.apex-body {
  flex: 1;
  margin: 0;
  padding: 12px 14px;
  overflow: auto;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  background: #fff;
  color: #37474f;
}

.apex-chip-tracked {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-color: #90caf9;
  background: #e3f2fd;
  color: #0d47a1;
}

.apex-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(13, 71, 161, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.apex-modal {
  width: min(640px, 100%);
  max-height: min(860px, 92vh);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #bbdefb;
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(25, 118, 210, 0.22);
}

.apex-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: #fff;
  flex-shrink: 0;
}

.apex-modal-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.apex-modal-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.apex-modal-close:hover {
  background: rgba(255, 255, 255, 0.28);
}

.apex-modal-body {
  padding: 14px 16px 12px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.apex-modal-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #607d8b;
  line-height: 1.5;
}

.apex-user-section {
  border: 1px solid #bbdefb;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.apex-user-section + .apex-user-section {
  margin-top: 14px;
}

.apex-user-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #0d47a1;
  background: #e3f2fd;
  border-bottom: 1px solid #bbdefb;
}

.apex-user-section-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: #1976d2;
  background: #fff;
  border: 1px solid #90caf9;
  border-radius: 999px;
  padding: 1px 8px;
}

.apex-user-section-picked {
  font-size: 11px;
  font-weight: 600;
  color: #2e7d32;
  background: #e8f5e9;
  border: 1px solid #a5d6a7;
  border-radius: 999px;
  padding: 1px 8px;
}

.apex-user-section-filters .apex-user-form {
  padding: 12px;
  background: #fafcff;
}

.apex-user-section-results .apex-user-results {
  margin: 0;
  border: none;
  border-radius: 0;
  background: #f5f9ff;
  max-height: 240px;
}

.apex-user-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
}

.apex-user-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #546e7a;
}

.apex-user-form input[type='text'] {
  padding: 7px 8px;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 400;
  color: #333;
}

.apex-user-form input[type='text']:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.12);
}

.apex-user-check {
  flex-direction: row !important;
  align-items: center;
  gap: 6px !important;
  margin-top: 18px;
  font-weight: 500 !important;
}

.apex-modal-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid #e3f2fd;
  background: #fff;
}

.apex-search-btn,
.apex-confirm-btn {
  width: auto;
  min-width: 72px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  background: #1976d2 !important;
  border: 1px solid #1565c0 !important;
  color: #fff !important;
  border-radius: 6px;
  box-shadow: none;
}

.apex-search-btn:hover:not(:disabled),
.apex-confirm-btn:hover:not(:disabled) {
  background: #0d47a1 !important;
}

.apex-search-btn:disabled,
.apex-confirm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.apex-modal-error {
  display: block;
  font-size: 12px;
  color: #c62828;
  margin: 0;
  padding: 8px 12px 10px;
  background: #fff8f8;
  border-top: 1px solid #ffcdd2;
}

.apex-user-results {
  border: 1px solid #e3f2fd;
  border-radius: 8px;
  background: #f5f9ff;
  max-height: 280px;
  overflow: auto;
  padding: 6px;
}

.apex-user-result {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #fff;
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
}

.apex-user-result:hover {
  border-color: #90caf9;
  background: #eef5fc;
}

.apex-user-result.selected {
  border-color: #1976d2;
  background: #e3f2fd;
  box-shadow: 0 0 0 1px rgba(25, 118, 210, 0.2);
}

.apex-user-result-check {
  margin-top: 3px;
  flex-shrink: 0;
}

.apex-user-result-body {
  min-width: 0;
  flex: 1;
}

.apex-user-result-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.apex-user-result-main strong {
  font-size: 13px;
  color: #0d47a1;
}

.apex-user-inactive {
  font-size: 10px;
  color: #c62828;
  background: #ffebee;
  border-radius: 999px;
  padding: 1px 6px;
}

.apex-user-result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 11px;
  color: #78909c;
}

.apex-modal-enter-active,
.apex-modal-leave-active {
  transition: opacity 0.15s ease;
}

.apex-modal-enter-from,
.apex-modal-leave-to {
  opacity: 0;
}

@media (max-width: 860px) {
  .apex-main {
    grid-template-columns: 1fr;
    grid-template-rows: 42vh 1fr;
  }
  .apex-user-form {
    grid-template-columns: 1fr;
  }
}
</style>
