<template>
  <div class="shell">
    <SideNavTabs v-model="activeTab" />

    <!-- 标签「登录」：扩展账户鉴权仅锁此区域 -->
    <div v-show="activeTab === 'login'" class="tab-panel tab-panel-login">
      <AuthScreen v-if="!isAuthed" @authed="onAuthed" />
      <div v-else class="app-container">
        <Toolbar
          :env-count="environments.length"
          :max-environments="MAX_ENVIRONMENTS"
          :account-email="currentUser?.email || ''"
          @add-env="openEditModal"
          @add-group="openGroupModal"
          @share="shareDialogVisible = true"
          @account="accountDialogVisible = true"
        />

        <div class="env-list" ref="envListRef">
          <GroupSection
            v-for="group in displayGroups"
            :key="group.id"
            :group="group"
            :environments="getEnvsByGroup(group.id)"
            :groups="groups"
            @toggle-collapse="toggleGroupCollapse"
            @edit-group="openEditGroupModal"
            @delete-group="confirmDeleteGroup"
            @login="handleLogin"
            @edit-env="openEditModal"
            @clone-env="handleCloneEnv"
            @delete-env="confirmDeleteEnv"
            @copy-success="handleCopySuccess"
            @drag-env="handleEnvDrag"
          />
        </div>

        <EditModal
          :visible="editModalVisible"
          :env="editingEnv"
          :groups="groups"
          :is-slave="false"
          @close="closeEditModal"
          @save="handleSaveEnv"
          @add-group="handleAddGroupFromModal"
        />

        <GroupModal
          :visible="groupModalVisible"
          :group="editingGroup"
          @close="closeGroupModal"
          @save="handleSaveGroup"
        />

        <DeleteModal
          :visible="deleteModalVisible"
          :type="deleteType"
          :name="deleteName"
          @close="closeDeleteModal"
          @confirm="handleConfirmDelete"
        />

        <AccountDialog
          :visible="accountDialogVisible"
          @close="accountDialogVisible = false"
          @signed-out="onSignedOut"
        />

        <ShareDialog
          :visible="shareDialogVisible"
          :environments="environments"
          @close="shareDialogVisible = false"
          @accepted="handleShareAccepted"
        />

        <!-- Passkey 选择对话框（v4：Side Panel 集中处理） -->
        <div v-if="pkDialog.visible" class="pk-overlay" @click.self="cancelPasskeyDialog">
          <div class="pk-dialog">
            <div class="pk-header">
              <span>{{ pkDialog.type === 'get' ? t('passkey.selectVerify') : t('passkey.selectBind') }}</span>
            </div>

            <div v-if="pkDialog.showCreateForm" class="pk-body">
              <p class="pk-desc">{{ t('passkey.createHint') }}</p>
              <input
                ref="pkAliasInput"
                v-model="pkDialog.newAlias"
                class="pk-input"
                :placeholder="t('passkey.aliasPlaceholder')"
                @keyup.enter="createQuickEnv"
              />
              <div class="pk-create-btns">
                <button class="pk-btn pk-btn-cancel" @click="pkDialog.showCreateForm = false">{{ t('passkey.backToList') }}</button>
                <button class="pk-btn pk-btn-primary" @click="createQuickEnv">{{ t('passkey.saveAndBind') }}</button>
              </div>
            </div>

            <div v-else class="pk-body">
              <p class="pk-desc">
                {{ pkDialog.type === 'get' ? t('passkey.descGet') : t('passkey.descCreate') }}
              </p>
              <div
                v-for="env in pkDialog.environments"
                :key="env.id"
                class="pk-item"
                @click="selectPasskeyEnv(env)"
              >
                <div class="pk-item-name">{{ env.alias || t('common.unnamed') }}</div>
                <div class="pk-item-user">{{ env.username || t('env.noUsername') }}</div>
                <div class="pk-item-tags">
                  <span class="pk-item-tag">{{ env.type === 'production' ? t('type.production') : env.type === 'sandbox' ? t('type.sandbox') : t('type.custom') }}</span>
                  <span v-if="!env.username || !env.password" class="pk-item-tag pk-item-tag-warn">{{ t('passkey.incomplete') }}</span>
                </div>
              </div>
              <p v-if="pkDialog.environments.length === 0" class="pk-empty">
                <template v-if="pkDialog.type === 'get'">
                  <span>{{ t('passkey.emptyGet') }}</span>
                  <span class="pk-empty-sub">{{ t('passkey.emptyGetSub') }}</span>
                </template>
                <template v-else>{{ t('passkey.emptyCreate') }}</template>
              </p>
            </div>

            <div class="pk-footer" v-if="!pkDialog.showCreateForm">
              <button
                v-if="pkDialog.type !== 'get'"
                class="pk-btn pk-btn-link"
                @click="pkDialog.showCreateForm = true; pkDialog.newAlias = ''"
              >{{ t('passkey.createNew') }}</button>
              <button class="pk-btn pk-btn-cancel" @click="cancelPasskeyDialog">
                {{ t('passkey.cancelOther') }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="passkeySaving" class="pk-saving-overlay">
          <div class="pk-saving-box">
            <div class="pk-spinner"></div>
            <span class="pk-saving-text">{{ passkeySavingStage }}</span>
          </div>
        </div>
      </div>

      <!-- 启动 / 同步遮罩仅覆盖登录标签，不挡工具宫格 -->
      <div v-if="bootOverlay.visible" class="boot-overlay boot-overlay-login">
        <div class="boot-box">
          <div class="pk-spinner"></div>
          <span class="boot-message">{{ bootOverlay.message }}</span>
          <span v-if="bootOverlay.detail" class="boot-detail">{{ bootOverlay.detail }}</span>
        </div>
      </div>
    </div>

    <!-- 标签「工具」：不依赖扩展账户 -->
    <div v-show="activeTab === 'tools'" class="tab-panel">
      <ToolHub @open-tool="openToolWindow" />
    </div>

    <!-- Toast 提升到壳层，工具标签也能看到错误提示 -->
    <Toast
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      @close="closeToast"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Sortable from 'sortablejs'
import { MAX_ENVIRONMENTS } from './utils/constants'
import { generateUuid } from './utils/crypto'
import { useStorage } from './composables/useStorage'
import { useAuth } from './composables/useAuth'
import { migrateLocalToSupabase } from './utils/migration'
import { useLogin } from './composables/useLogin'
import { initPasskeyBridge, destroyPasskeyBridge, passkeyRequest, passkeyError, passkeySaving, passkeySavingStage } from './composables/usePasskeyBridge'
import { useTotp } from './composables/useTotp'
import { t as tt } from './i18n'
import syncLog from './utils/syncLogger'
import Toolbar from './components/Toolbar.vue'
import GroupSection from './components/GroupSection.vue'
import EditModal from './components/EditModal.vue'
import GroupModal from './components/GroupModal.vue'
import DeleteModal from './components/DeleteModal.vue'
import Toast from './components/Toast.vue'
import AuthScreen from './components/AuthScreen.vue'
import AccountDialog from './components/AccountDialog.vue'
import ShareDialog from './components/ShareDialog.vue'
import SideNavTabs from './components/SideNavTabs.vue'
import ToolHub from './components/ToolHub.vue'
import { getToolWindowDef, buildToolWindowUrl } from './tools/_shared/toolWindows.js'

const { t } = useI18n()
const { loadEnvironments, saveEnvironments, deleteEnvironment, loadGroups, saveGroups, deleteGroup } = useStorage()
const { isAuthed, getCryptoKeyRaw, currentUser, getSession, getUnlockStatus } = useAuth()
const { login, fillTotpCode } = useLogin()
const { generateCode, scanQR } = useTotp()

const environments = ref([])
const groups = ref([])
const envListRef = ref(null)
const toolbarRef = ref(null)
/** 工具导航：login | tools；默认登录标签 */
const activeTab = ref('login')

const toastVisible = ref(false)
const toastMessage = ref('')
const toastType = ref('success')

const showToast = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  toastVisible.value = true
  setTimeout(() => {
    toastVisible.value = false
  }, 3000)
}

const closeToast = () => {
  toastVisible.value = false
}

const openToolWindow = async (toolId) => {
  const def = getToolWindowDef(toolId)
  if (!def) {
    showToast(t('app.unknownTool', { id: toolId }), 'error')
    return
  }
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    showToast(t('app.notExtension'), 'error')
    return
  }

  // 优先走 Service Worker（便于聚焦已开窗口）；失败则 Side Panel 直开
  try {
    const response = await chrome.runtime.sendMessage({ action: 'openToolWindow', toolId })
    if (response?.success) return
    if (response && response.success === false) {
      console.warn('[ToolHub] SW 开窗失败，尝试直开', response)
    }
  } catch (e) {
    console.warn('[ToolHub] SW 消息失败，尝试直开', e)
  }

  if (!chrome.windows?.create) {
    showToast(t('app.noWindowApi'), 'error')
    return
  }

  try {
    await chrome.windows.create({
      url: buildToolWindowUrl(toolId),
      type: def.type || 'popup',
      width: def.width,
      height: def.height,
      focused: true
    })
  } catch (e) {
    showToast(e.message || t('app.openToolFailed'), 'error')
  }
}

const editModalVisible = ref(false)
const groupModalVisible = ref(false)
const deleteModalVisible = ref(false)
const manualBindVisible = ref(false)
const accountDialogVisible = ref(false)
const shareDialogVisible = ref(false)

const editingEnv = ref(null)
const editingGroup = ref(null)
const deleteType = ref('env')
const deleteName = ref('')
const deleteId = ref(null)
const manualBindEnv = ref(null)

// 启动 / 登录后数据同步遮罩（默认开启，避免自动跳过登录时闪一下空界面）
const bootOverlay = ref({
  visible: true,
  message: tt('boot.starting'),
  detail: ''
})

function showBoot(message, detail = '') {
  bootOverlay.value = { visible: true, message, detail }
}

function hideBoot() {
  bootOverlay.value = { visible: false, message: '', detail: '' }
}

// ========== Passkey 选择对话框（v4） ==========
const pkAliasInput = ref(null)
const pkDialog = ref({
  visible: false,
  type: 'get',
  environments: [],
  showCreateForm: false,
  newAlias: '',
  _request: null
})

function cancelPasskeyDialog() {
  if (pkDialog.value._request) {
    pkDialog.value._request.resolve(null)
    pkDialog.value._request = null
  }
  pkDialog.value.visible = false
  pkDialog.value.showCreateForm = false
}

function selectPasskeyEnv(env) {
  if (pkDialog.value._request) {
    pkDialog.value._request.resolve(env)
    pkDialog.value._request = null
  }
  pkDialog.value.visible = false
  pkDialog.value.showCreateForm = false
}

async function createQuickEnv() {
  const alias = (pkDialog.value.newAlias || '').trim()
  if (!alias) {
    showToast(t('toast.aliasRequired'), 'error')
    return
  }
  const { saveEnvironments, loadEnvironments } = useStorage()
  const now = Date.now()
  const newEnv = {
    id: generateUuid(),
    alias: alias,
    username: '',
    password: '',
    type: 'production',
    customUrl: '',
    groupId: 'ungrouped',
    totpSecret: '',
    passkeys: [],
    createdAt: now,
    updatedAt: now
  }
  try {
    await saveEnvironments([newEnv])
    // 更新本地环境列表
    environments.value = await loadEnvironments()
    // 选中新环境
    selectPasskeyEnv(newEnv)
    showToast(t('toast.tempEnvCreated'))
  } catch (e) {
    showToast(t('toast.createFailed', { msg: e.message || '' }), 'error')
  }
}

// 监听 passkeyRequest 变化
watch(passkeyRequest, (req) => {
  if (!req) {
    pkDialog.value.visible = false
    pkDialog.value.showCreateForm = false
    return
  }

  pkDialog.value = {
    visible: true,
    type: req.type,
    environments: req.environments || [],
    showCreateForm: false,
    newAlias: '',
    _request: req
  }
}, { deep: false })

// 监听 passkey 保存错误
watch(passkeyError, (err) => {
  if (err) {
    showToast(err, 'error')
    passkeyError.value = null
  }
})

// 监听 passkey 保存完成（从 true → false 且无错误 = 成功）
watch(passkeySaving, (saving, prev) => {
  if (prev && !saving && !passkeyError.value) {
    showToast(t('toast.passkeyBound'))
  }
})

const displayGroups = computed(() => {
  const ungroupedCount = environments.value.filter(e => !e.groupId || e.groupId === 'ungrouped').length
  
  const result = []
  
  if (ungroupedCount > 0) {
    result.push({
      id: 'ungrouped',
      name: t('group.ungrouped'),
      isVirtual: true,
      collapsed: false
    })
  }
  
  result.push(...groups.value)
  
  return result
})

const getEnvsByGroup = (groupId) => {
  return environments.value.filter(env => {
    if (groupId === 'ungrouped') {
      return !env.groupId || env.groupId === 'ungrouped'
    }
    return env.groupId === groupId
  })
}

const openEditModal = async (env = null) => {
  if (env?.id) {
    // 从存储加载最新数据，避免绑定 Passkey 后本地列表未刷新导致编辑时覆盖丢失
    try {
      const fresh = await loadEnvironments()
      const freshEnv = fresh.find(e => e.id === env.id)
      editingEnv.value = freshEnv ? { ...freshEnv } : { ...env }
    } catch (e) {
      editingEnv.value = { ...env }
    }
  } else {
    editingEnv.value = env ? { ...env } : null
  }
  editModalVisible.value = true
}

const closeEditModal = () => {
  editingEnv.value = null
  editModalVisible.value = false
}

const openGroupModal = (group = null) => {
  editingGroup.value = group ? { ...group } : null
  groupModalVisible.value = true
}

const openEditGroupModal = (group) => {
  openGroupModal(group)
}

const closeGroupModal = () => {
  editingGroup.value = null
  groupModalVisible.value = false
}

const confirmDeleteEnv = (env) => {
  deleteType.value = 'env'
  deleteName.value = env.alias || env.username
  deleteId.value = env.id
  deleteModalVisible.value = true
}

const confirmDeleteGroup = (group) => {
  deleteType.value = 'group'
  deleteName.value = group.name
  deleteId.value = group.id
  deleteModalVisible.value = true
}

const closeDeleteModal = () => {
  deleteType.value = 'env'
  deleteName.value = ''
  deleteId.value = null
  deleteModalVisible.value = false
}

const handleSaveEnv = async (env) => {
  syncLog.group('App.handleSaveEnv 保存环境')
  syncLog.info('输入', syncLog.envSummary(env))
  const isUpdate = !!env.id
  if (env.id) {
    const index = environments.value.findIndex(e => e.id === env.id)
    if (index !== -1) {
      environments.value[index] = env
    }
  } else {
    if (environments.value.length >= MAX_ENVIRONMENTS) {
      showToast(t('toast.envLimit', { max: MAX_ENVIRONMENTS }), 'error')
      syncLog.groupEnd()
      return
    }
    env.id = generateUuid()
    environments.value.push(env)
  }

  // 只保存当前新增/编辑的环境，避免全量 upsert 带来副作用
  const targetEnv = environments.value.find(e => e.id === env.id)
  const result = await saveEnvironments([targetEnv])
  syncLog.info('saveEnvironments 返回', {
    success: result?.success,
    error: result?.error
  })
  if (result?.success) {
    showToast(isUpdate ? t('toast.envUpdated') : t('toast.envCreated'))
  } else {
    showToast(t('toast.saveFailed', { msg: result?.error || '' }), 'error')
  }
  closeEditModal()
  syncLog.groupEnd()
}

const handleSaveGroup = async (group) => {
  const isUpdate = !!group.id
  if (group.id) {
    const index = groups.value.findIndex(g => g.id === group.id)
    if (index !== -1) {
      groups.value[index] = group
    }
  } else {
    group.id = generateUuid()
    groups.value.push(group)
  }
  const result = await saveGroups(groups.value)
  closeGroupModal()
  if (result?.success) {
    showToast(isUpdate ? t('toast.groupUpdated') : t('toast.groupCreated'))
  } else {
    showToast(t('toast.saveFailed', { msg: result?.error || '' }), 'error')
  }
}

const handleConfirmDelete = async () => {
  if (deleteType.value === 'env') {
    // 伪删除：仅标记数据库中的 is_deleted=true
    const result = await deleteEnvironment(deleteId.value)
    if (result?.success) {
      // 同时从本地视图移除
      environments.value = environments.value.filter(e => e.id !== deleteId.value)
      showToast(t('toast.envDeleted'))
    } else {
      showToast(t('toast.deleteFailed', { msg: result?.error || '' }), 'error')
    }
  } else {
    const delResult = await deleteGroup(deleteId.value)
    if (!delResult?.success) {
      showToast(t('toast.deleteGroupFailed', { msg: delResult?.error || '' }), 'error')
      closeDeleteModal()
      return
    }
    environments.value.forEach(e => {
      if (e.groupId === deleteId.value) {
        e.groupId = 'ungrouped'
      }
    })
    groups.value = groups.value.filter(g => g.id !== deleteId.value)
    await saveEnvironments(environments.value)
    showToast(t('toast.groupDeleted'))
  }
  closeDeleteModal()
}

const handleCloneEnv = async (env) => {
  const now = Date.now()
  const cloned = {
    ...env,
    id: generateUuid(),
    alias: t('env.cloneSuffix', { alias: env.alias }),
    createdAt: now,
    updatedAt: now
  }
  environments.value.push(cloned)
  const result = await saveEnvironments(environments.value)
  if (result?.success) {
    showToast(t('toast.envCloned'))
  } else {
    showToast(t('toast.cloneFailed', { msg: result?.error || '' }), 'error')
  }
}

const handleLogin = async (env) => {
  try {
    try {
      let passkeysToStore = [];
      if (Array.isArray(env.passkeys)) {
        passkeysToStore = env.passkeys;
      } else if (env.passkeys && typeof env.passkeys === 'object') {
        passkeysToStore = Object.values(env.passkeys);
      }
      const hasPrivateKey = passkeysToStore.length > 0 && passkeysToStore.every(pk => !!pk.privateKeyJwk);
      await chrome.storage.session.set({
        pendingLoginEnv: {
          id: env.id,
          alias: env.alias,
          username: env.username,
          password: env.password,
          type: env.type,
          customUrl: env.customUrl,
          totpSecret: env.totpSecret,
          passkeys: passkeysToStore,
          createdAt: Date.now()
        }
      })
    } catch (e) {
      console.warn('暂存 loginEnv 失败', e)
    }

    await login(env)
    showToast(t('toast.loginSuccess'))
  } catch (error) {
    showToast(error.message || t('toast.loginFailed'), 'error')
  }
}

// ========== Passkey 备份与恢复 ==========

const handleExportBackup = async () => {
  try {
    const [creds, envs] = await Promise.all([
      loadPasskeyCredentials(),
      loadEnvironments()
    ])

    if (creds.length === 0 && envs.length === 0) {
      showToast(t('toast.noBackupData'), 'error')
      return
    }

    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      credentials: creds,
      environments: envs
    }

    const json = JSON.stringify(backup, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `salesforce-passkey-backup-${dateStr}.json`

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    showToast(t('toast.exported', { creds: creds.length, envs: envs.length }), 'success')
  } catch (error) {
    console.error('Export backup error:', error)
    showToast(error.message || t('toast.exportFailed'), 'error')
  }
}

const handleImportBackupClick = () => {
  const input = toolbarRef.value?.fileInputRef
  if (input) {
    input.value = ''
    input.click()
  }
}

const handleImportBackup = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const backup = JSON.parse(text)

    if (!backup.credentials || !Array.isArray(backup.credentials)) {
      showToast(t('toast.invalidBackup'), 'error')
      return
    }

    let credCount = 0
    for (const cred of backup.credentials) {
      const r = await savePasskeyCredential(cred)
      if (r?.success) credCount++
    }

    let envCount = 0
    if (Array.isArray(backup.environments) && backup.environments.length > 0) {
      const existing = await loadEnvironments()
      const merged = [...existing]
      for (const env of backup.environments) {
        if (!merged.find(e => e.id === env.id)) {
          merged.push(env)
          envCount++
        }
      }
      await saveEnvironments(merged)
    }

    environments.value = await loadEnvironments()
    groups.value = await loadGroups()

    showToast(t('toast.imported', { creds: credCount, envs: envCount }), 'success')
  } catch (error) {
    console.error('Import backup error:', error)
    showToast(error.message || t('toast.importFailed'), 'error')
  }
}



const handleShowTotp = async (env) => {
  if (env.totpSecret) {
    const code = await generateCode(env.totpSecret)
    if (code) {
      showToast(t('toast.totpCode', { code }), 'info')
      try {
        await fillTotpCode(code)
      } catch (e) {
        console.log('Auto-fill failed, code:', code)
      }
    } else {
      showToast(t('toast.totpGenerateFailed'), 'error')
    }
  }
}

const handleAddGroupFromModal = async (groupName) => {
  const newGroup = {
    id: generateUuid(),
    name: groupName,
    isVirtual: false,
    collapsed: false
  }
  groups.value.push(newGroup)
  await saveGroups(groups.value)
  return newGroup
}

const handleCopySuccess = (code) => {
  showToast(t('toast.totpCopied', { code }), 'success')
}

const handleScanQR = async () => {
  try {
    const result = await scanQR()
    if (result && result.success === false) {
      showToast(result.error || t('toast.scanFailed'), 'error')
      return
    }
    if (result && result.secret) {
      if (editingEnv.value) {
        editingEnv.value.totpSecret = result.secret
      }
      showToast(t('toast.scanSuccess'))
    }
  } catch (error) {
    // 用户主动取消（ESC / 框太小）不算失败
    const cancelReasons = ['cancelled', 'too small', 'user cancelled', '已取消', 'Cancelled']
    if (typeof error === 'string' && cancelReasons.some(r => error.includes(r))) {
      showToast(t('toast.scanCancelled'))
      return
    }
    showToast(error || t('toast.scanFailed'), 'error')
  }
}

const toggleGroupCollapse = async (groupId) => {
  if (groupId === 'ungrouped') return
  const group = groups.value.find(g => g.id === groupId)
  if (group) {
    group.collapsed = !group.collapsed
    await saveGroups(groups.value)
  }
}

const handleEnvDrag = async ({ fromGroupId, toGroupId, fromIndex, toIndex }) => {
  const fromEnvs = getEnvsByGroup(fromGroupId)
  const toEnvs = getEnvsByGroup(toGroupId)

  const movedEnv = fromEnvs[fromIndex]
  if (!movedEnv) return

  movedEnv.groupId = toGroupId

  const allEnvs = []

  displayGroups.value.forEach(group => {
    const groupEnvs = getEnvsByGroup(group.id)

    if (group.id === fromGroupId && group.id === toGroupId) {
      // 同一分组内移动
      const [removed] = groupEnvs.splice(fromIndex, 1)
      groupEnvs.splice(toIndex, 0, removed)
      allEnvs.push(...groupEnvs)
    } else if (group.id === fromGroupId) {
      // 从该分组移出
      const filtered = groupEnvs.filter(e => e.id !== movedEnv.id)
      allEnvs.push(...filtered)
    } else if (group.id === toGroupId) {
      // 移入该分组
      const before = toEnvs.slice(0, toIndex)
      const after = toEnvs.slice(toIndex)
      allEnvs.push(...before, movedEnv, ...after)
    } else {
      allEnvs.push(...groupEnvs)
    }
  })

  environments.value = allEnvs
  await saveEnvironments(environments.value)
}

let groupSortable = null

const initGroupSortable = () => {
  if (!envListRef.value) return

  if (groupSortable) {
    groupSortable.destroy()
    groupSortable = null
  }

  groupSortable = new Sortable(envListRef.value, {
    handle: '.group-drag-handle',
    animation: 150,
    ghostClass: 'group-ghost',
    chosenClass: 'group-chosen',
    dragClass: 'group-drag',
    filter: '.group-section[data-group-id="ungrouped"], .group-content',
    preventOnFilter: true,
    onMove: (evt) => {
      const related = evt.related
      if (related) {
        const content = related.closest('.group-content')
        if (content) {
          return false
        }
      }
      return true
    },
    onEnd: (evt) => {
      if (evt.to && evt.to !== envListRef.value) {
        return
      }

      const ungroupedCount = environments.value.filter(e => !e.groupId || e.groupId === 'ungrouped').length
      const offset = ungroupedCount > 0 ? 1 : 0
      
      const fromIndex = evt.oldIndex - offset
      const toIndex = evt.newIndex - offset

      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return

      const realGroups = [...groups.value]
      if (fromIndex >= 0 && fromIndex < realGroups.length &&
          toIndex >= 0 && toIndex < realGroups.length) {
        const [moved] = realGroups.splice(fromIndex, 1)
        realGroups.splice(toIndex, 0, moved)
        groups.value = realGroups
        saveGroups(groups.value)
      }
    }
  })
}

// ========== 登录态与数据加载 ==========

const sourceLabel = (source) => {
  const map = {
    remote: t('boot.sourceRemote'),
    cache: t('boot.sourceCache'),
    empty: t('boot.sourceEmpty')
  }
  return map[source] || source
}

const loadData = async () => {
  syncLog.group('App.loadData 加载数据')
  try {
    showBoot(t('boot.connecting'), t('boot.connectingDetail'))

    showBoot(t('boot.loadingEnvs'), t('boot.loadingEnvsDetail'))
    const envResult = await loadEnvironments({ detailed: true })
    environments.value = envResult.data
    const envSourceLabel = sourceLabel(envResult.source)
    showBoot(
      t('boot.envsLoaded', { count: envResult.count }),
      envResult.error
        ? t('boot.sourceFail', { source: envSourceLabel, error: envResult.error })
        : t('boot.sourceOk', { source: envSourceLabel })
    )

    showBoot(t('boot.loadingGroups'), t('boot.loadingGroupsDetail'))
    const groupResult = await loadGroups({ detailed: true })
    groups.value = groupResult.data
    const groupSourceLabel = sourceLabel(groupResult.source)
    showBoot(
      t('boot.groupsLoaded', { count: groupResult.count }),
      groupResult.error
        ? t('boot.sourceFail', { source: groupSourceLabel, error: groupResult.error })
        : t('boot.sourceOk', { source: groupSourceLabel })
    )

    syncLog.info('加载完成', {
      envs: environments.value.length,
      groups: groups.value.length,
      envSource: envResult.source,
      groupSource: groupResult.source,
      envError: envResult.error,
      groupError: groupResult.error
    })

    // 若走了缓存回退，给用户明确提示，便于排查网络/缓存问题
    if (envResult.source === 'cache' || groupResult.source === 'cache') {
      const reason = envResult.error || groupResult.error || t('toast.unknownReason')
      showToast(t('toast.syncCacheFallback', { reason }), 'error')
    } else if (envResult.source === 'empty' && envResult.error) {
      showToast(t('toast.syncFailed', { msg: envResult.error }), 'error')
    }

    nextTick(() => {
      initGroupSortable()
    })
  } catch (e) {
    syncLog.error('加载数据失败', e)
    showBoot(t('boot.loadFailed'), e.message || String(e))
    showToast(t('toast.loadFailed', { msg: e.message || '' }), 'error')
  } finally {
    syncLog.groupEnd()
  }
}

// 防止 onAuthed 被重复触发（emit + watch 可能同时触发）
let _onAuthedRunning = false
// onAuthed 是否已完成至少一次数据加载（避免 onMounted 与 watch 竞态导致遮罩卡住）
let _dataLoadDone = false

const onAuthed = async () => {
  if (_onAuthedRunning) {
    return
  }
  _onAuthedRunning = true
  _dataLoadDone = false
  syncLog.info('App.onAuthed 登录成功，开始加载数据')
  accountDialogVisible.value = false
  showBoot(t('boot.loginSuccess'), t('boot.syncing'))

  // 首次登录时尝试迁移本地旧数据到 Supabase（云端有数据则自动跳过）
  try {
    showBoot(t('boot.migrating'), t('boot.migratingDetail'))
    const result = await migrateLocalToSupabase()
    if (result?.success) {
      const m = result.migrated
      showToast(t('toast.migrated', { envs: m.environments, groups: m.groups, passkeys: m.passkeys }), 'success')
    }
  } catch (e) {
    syncLog.error('迁移本地数据失败', e)
    console.error('[App] onAuthed 迁移异常', e)
  }

  try {
    initPasskeyBridge()
  } catch (e) {
    syncLog.error('初始化 Passkey Bridge 失败', e)
    console.error('[App] onAuthed Passkey Bridge 异常', e)
  }

  try {
    await loadData()
  } catch (e) {
    syncLog.error('加载数据失败', e)
    console.error('[App] onAuthed loadData 异常', e)
  } finally {
    _dataLoadDone = true
    hideBoot()
    _onAuthedRunning = false
  }
}

// 监听 isAuthed 变化，当登录状态变为 true 时自动触发数据加载
// 解决 AuthScreen 在 signIn 后立即销毁导致 emit('authed') 失效的问题
let _authTriggered = false
watch(isAuthed, (newVal, oldVal) => {
  if (newVal === true && oldVal === false && !_authTriggered) {
    _authTriggered = true
    showBoot(t('boot.syncConfirmed'), t('boot.syncConfirmedDetail'))
    onAuthed().catch(err => {
      console.error('[App] watch onAuthed 异常', err)
    }).finally(() => {
      _authTriggered = false
    })
  }
})

const onSignedOut = () => {
  syncLog.info('App.onSignedOut 退出登录，清空本地视图')
  destroyPasskeyBridge()
  accountDialogVisible.value = false
  environments.value = []
  groups.value = []
  _dataLoadDone = false
  hideBoot()
  if (groupSortable) {
    groupSortable.destroy()
    groupSortable = null
  }
}

// 接受分享成功后刷新环境列表
const handleShareAccepted = async () => {
  syncLog.info('App.handleShareAccepted 接受分享成功，刷新环境列表')
  try {
    const envs = await loadEnvironments()
    environments.value = envs
    showToast(t('toast.shareAccepted'))
  } catch (e) {
    console.error('[App] handleShareAccepted 刷新失败', e)
  }
}

onMounted(async () => {
  syncLog.group('App.onMounted 应用启动')
  showBoot(t('boot.restoring'), t('boot.restoringDetail'))

  // 输出当前扩展运行环境概览
  try {
    const runtimeInfo = {
      extensionId: chrome.runtime?.id,
      manifestVersion: chrome.runtime?.getManifest?.()?.manifest_version,
      extensionVersion: chrome.runtime?.getManifest?.()?.version,
      extensionName: chrome.runtime?.getManifest?.()?.name,
      isDev: !('update_url' in (chrome.runtime?.getManifest?.() || {})),
      hasStorageLocal: !!(chrome.storage && chrome.storage.local)
    }
    runtimeInfo.isFromWebStore = !runtimeInfo.isDev
    syncLog.info('扩展运行环境', runtimeInfo)
  } catch (e) {
    syncLog.warn('获取运行时信息失败', e.message)
  }

  // 检查 Supabase 登录态
  // 流程：
  //   1. getSession 恢复 currentUser（如有持久 session）
  //   2. 检查今日解锁计数器
  //   3. 若今日已解锁且 session 有效 → 自动进入主页（但需要密码才能解密数据）
  //   4. 否则 → AuthScreen 显示要求输入密码
  try {
    await getSession()
    const unlockStatus = await getUnlockStatus()
    syncLog.info('会话检查完成', {
      isAuthed: isAuthed.value,
      hasCryptoKey: !!getCryptoKeyRaw(),
      hasCurrentUser: !!currentUser.value,
      unlockStatus
    })

    if (isAuthed.value) {
      // 已自动恢复登录：遮罩交给 onAuthed（watch）关闭
      // 若 watch 尚未跑完，仅更新文案；若已完成则不再重新打开遮罩
      if (!_dataLoadDone) {
        showBoot(t('boot.restored'), t('boot.restoredDetail'))
      }
    } else if (currentUser.value && !unlockStatus.needPassword) {
      // 有 session 但密钥未恢复，仍需输入密码
      syncLog.info('今日已解锁过密码，等待用户输入密码派生密钥')
      hideBoot()
    } else {
      // 需要登录/解锁：关闭遮罩，显示 AuthScreen
      hideBoot()
    }
  } catch (e) {
    syncLog.error('会话检查失败', e)
    hideBoot()
  }

  syncLog.groupEnd()
})

onBeforeUnmount(() => {
  destroyPasskeyBridge()
  if (groupSortable) {
    groupSortable.destroy()
    groupSortable = null
  }
})
</script>

<style scoped>
.shell {
  min-height: 100vh;
  background: #eef5fc;
  display: flex;
  flex-direction: column;
}

.tab-panel {
  flex: 1;
  min-height: 0;
  position: relative;
}

.tab-panel-login {
  background: #eef5fc;
}

.app-container {
  min-height: calc(100vh - 42px);
  background-color: #eef5fc;
}

.env-list {
  padding: 10px;
}

/* 启动 / 数据同步遮罩：仅盖住登录标签区域 */
.boot-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(238, 245, 252, 0.92);
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.boot-overlay-login {
  min-height: calc(100vh - 42px);
}
.boot-box {
  background: #fff;
  border-radius: 12px;
  padding: 28px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  box-shadow: 0 8px 28px rgba(13, 71, 161, 0.12);
  min-width: 220px;
  max-width: 320px;
  text-align: center;
}
.boot-message {
  font-size: 14px;
  font-weight: 600;
  color: #0d47a1;
}
.boot-detail {
  font-size: 12px;
  color: #607d8b;
  line-height: 1.4;
  word-break: break-all;
}

/* ========== Passkey 选择对话框样式 ========== */
.pk-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Passkey 保存加载遮罩 */
.pk-saving-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pk-saving-box {
  background: #fff;
  border-radius: 10px;
  padding: 24px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.pk-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e0e0e0;
  border-top-color: #1a73e8;
  border-radius: 50%;
  animation: pk-spin 0.8s linear infinite;
}
@keyframes pk-spin {
  to { transform: rotate(360deg); }
}
.pk-saving-text {
  font-size: 14px;
  color: #333;
}
.pk-dialog {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 380px;
  max-width: 90vw;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pk-header {
  padding: 14px 18px;
  background: linear-gradient(135deg, #1976d2, #1565c0);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}
.pk-body {
  padding: 14px 18px;
  overflow-y: auto;
  flex: 1;
}
.pk-desc {
  font-size: 13px;
  color: #555;
  margin: 0 0 12px 0;
}
.pk-item {
  padding: 6px 12px;
  border: 1px solid #e0e0e0;
  border-left: 3px solid #1976d2;
  border-radius: 6px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.pk-item:hover {
  background: #f5f9ff;
  border-color: #1976d2;
}
.pk-item-name {
  font-weight: 600;
  font-size: 13px;
  color: #0d47a1;
}
.pk-item-user {
  font-size: 11px;
  color: #777;
  margin-top: 1px;
}
.pk-item-tag {
  display: inline-block;
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 10px;
  background: #e3f2fd;
  color: #1565c0;
  margin-top: 2px;
}
.pk-empty {
  text-align: center;
  color: #999;
  font-size: 13px;
  padding: 20px 0;
}
.pk-empty-sub {
  display: block;
  color: #1976d2;
  font-size: 11px;
  margin-top: 6px;
}
.pk-footer {
  padding: 10px 18px;
  text-align: right;
  border-top: 1px solid #eee;
  background: #fafafa;
}
.pk-btn {
  border: none;
  border-radius: 4px;
  padding: 7px 18px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.pk-btn-cancel {
  background: #e0e0e0;
  color: #333;
}
.pk-btn-cancel:hover {
  background: #ccc;
}
.pk-btn-link {
  background: transparent;
  color: #1976d2;
  padding: 7px 12px;
}
.pk-btn-link:hover {
  background: #e3f2fd;
}
.pk-btn-primary {
  background: #1976d2;
  color: #fff;
  font-weight: 600;
}
.pk-btn-primary:hover {
  background: #0d47a1;
}
.pk-input {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
  outline: none;
  margin-bottom: 12px;
}
.pk-input:focus {
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}
.pk-create-btns {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.pk-item-tags {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.pk-item-tag-warn {
  background: #fff3e0 !important;
  color: #e65100 !important;
}

:global(.group-ghost) {
  opacity: 0.4;
  background-color: #e3f2fd !important;
  border: 2px dashed #1976d2 !important;
}

:global(.group-chosen) {
  background-color: #bbdefb;
}

:global(.group-drag) {
  opacity: 0.85;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transition: none !important;
}
</style>