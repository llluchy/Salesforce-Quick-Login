<template>
  <Transition name="modal">
    <div class="modal-overlay" v-if="visible">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ env ? t('env.editTitle') : t('env.addTitle') }}</h2>
          <button class="modal-close" @click="$emit('close')">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('env.alias') }}</label>
            <input type="text" v-model="form.alias" :placeholder="t('env.aliasPlaceholder')" required />
          </div>
          
          <div class="form-group">
            <label>{{ t('env.username') }}</label>
            <input type="text" v-model="form.username" :placeholder="t('env.usernamePlaceholder')" required />
          </div>
          
          <div class="form-group">
            <label>{{ t('env.password') }}</label>
            <div class="password-input-wrapper">
              <input :type="showPassword ? 'text' : 'password'" v-model="form.password" :placeholder="t('env.passwordPlaceholder')" required />
              <button type="button" class="password-toggle" @click="showPassword = !showPassword" :title="showPassword ? t('env.hidePassword') : t('env.showPassword')">
                <svg v-if="showPassword" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/>
                </svg>
                <svg v-else viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/><path d="M2.5 2.5l11 11"/>
                </svg>
              </button>
            </div>
          </div>
          
          <div class="form-group">
            <label>{{ t('env.type') }}</label>
            <select v-model="form.type" @change="handleTypeChange">
              <option value="production">{{ t('type.production') }}</option>
              <option value="sandbox">{{ t('type.sandbox') }}</option>
              <option value="custom">{{ t('type.custom') }}</option>
            </select>
          </div>
          
          <div class="form-group" v-if="form.type === 'custom'">
            <label>{{ t('env.customUrl') }}</label>
            <input type="text" v-model="form.customUrl" placeholder="https://xxx.salesforce.com" />
          </div>
          
          <div class="form-group">
            <label>{{ t('env.group') }}</label>
            <div class="group-select-wrapper">
              <select v-model="form.groupId">
                <option value="ungrouped">{{ t('group.ungrouped') }}</option>
                <option v-for="group in groups" :key="group.id" :value="group.id">
                  {{ group.name }}
                </option>
              </select>
              <button class="btn btn-sm btn-outline" @click="openQuickAddGroup">{{ t('env.addGroupQuick') }}</button>
            </div>
          </div>
          
          <div class="form-divider"><span>{{ t('env.mfaSection') }}</span></div>

          <div class="form-group">
            <label>TOTP Secret</label>
            <input type="text" v-model="form.totpSecret" :placeholder="t('env.totpPlaceholder')" />
          </div>

          <div class="form-group qr-actions">
            <button class="btn btn-sm btn-outline" @click="handleScanQR" :title="t('env.scanQrTitle')">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="10" y="1" width="5" height="5" rx="1"/><rect x="1" y="10" width="5" height="5" rx="1"/><rect x="10" y="10" width="3" height="3" rx="0.5"/><rect x="14" y="10" width="1" height="1"/><rect x="10" y="14" width="1" height="1"/><rect x="14" y="14" width="1" height="1"/></svg>
              {{ t('env.scanQr') }}
            </button>
            <button class="btn btn-sm btn-outline" @click="triggerFileInput" :title="t('env.scanImageTitle')">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="14" height="10" rx="2"/><circle cx="5" cy="7" r="1.5"/><path d="M15 11l-3-3-4 4-2-2-5 5"/></svg>
              {{ t('env.scanImage') }}
            </button>
            <input ref="fileInputRef" type="file" accept="image/*" style="display:none" @change="handleFileSelect" />
          </div>

          <div class="form-group" v-if="firstPasskey">
            <label>{{ t('env.boundPasskey') }}</label>
            <div class="passkey-tag">
              <svg v-if="firstPasskey.type === 'system'" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M8 1a3 3 0 00-3 3v3H4a2 2 0 00-2 2v4a2 2 0 002 2h8a2 2 0 002-2v-4a2 2 0 00-2-2h-1V4a3 3 0 00-3-3z"/>
              </svg>
              <svg v-else viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1" y="2" width="14" height="10" rx="1.5"/><path d="M5 14h6M8 12v2"/>
              </svg>
              <span class="passkey-tag-label">{{ firstPasskeyLabel }}</span>
            </div>
          </div>
          
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="$emit('close')">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" @click="handleSave">{{ t('common.save') }}</button>
        </div>
      </div>

      <!-- 快速创建分组（嵌套弹窗，替代浏览器 prompt） -->
      <Transition name="modal">
        <div
          v-if="quickGroupVisible"
          class="nested-modal-overlay"
          @click.self="closeQuickAddGroup"
        >
          <div class="nested-modal-content">
            <div class="modal-header">
              <h2>{{ t('group.createTitle') }}</h2>
              <button class="modal-close" type="button" @click="closeQuickAddGroup">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l10 10M13 3L3 13"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label>{{ t('group.name') }}</label>
                <input
                  ref="quickGroupInputRef"
                  type="text"
                  v-model="quickGroupName"
                  :placeholder="t('group.namePlaceholder')"
                  maxlength="50"
                  @keydown.enter.prevent="confirmQuickAddGroup"
                  @keydown.esc.prevent="closeQuickAddGroup"
                />
              </div>
              <p v-if="quickGroupError" class="field-error">{{ quickGroupError }}</p>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" type="button" @click="closeQuickAddGroup">{{ t('common.cancel') }}</button>
              <button class="btn btn-primary" type="button" @click="confirmQuickAddGroup">{{ t('common.save') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTotp } from '../composables/useTotp'
import { t as tt } from '../i18n'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  env: {
    type: Object,
    default: null
  },
  groups: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'save', 'add-group'])

const { t } = useI18n()
const { parseQRCode, scanQR } = useTotp()

const fileInputRef = ref(null)
const quickGroupInputRef = ref(null)

const showPassword = ref(false)
const quickGroupVisible = ref(false)
const quickGroupName = ref('')
const quickGroupError = ref('')
const pendingSelectGroupName = ref(null)

const form = ref({
  alias: '',
  username: '',
  password: '',
  type: 'production',
  customUrl: '',
  groupId: 'ungrouped',
  totpSecret: '',
  passkeys: []
})

const validPasskeys = computed(() => {
  if (!Array.isArray(form.value.passkeys)) return []
  return form.value.passkeys.filter(pk => {
    return pk && typeof pk === 'object' && (pk.id || pk.credentialId) && pk.rpId
  })
})

const firstPasskey = computed(() => {
  return validPasskeys.value[0] || null
})

const firstPasskeyLabel = computed(() => {
  const pk = firstPasskey.value
  if (!pk) return ''
  return pk.label || pk.userName || pk.userDisplayName || pk.rpId || t('env.boundPasskeyFallback')
})

const handleTypeChange = () => {
  if (form.value.type !== 'custom') {
    form.value.customUrl = ''
  }
}

const openQuickAddGroup = () => {
  quickGroupName.value = ''
  quickGroupError.value = ''
  quickGroupVisible.value = true
  nextTick(() => {
    quickGroupInputRef.value?.focus()
  })
}

const closeQuickAddGroup = () => {
  quickGroupVisible.value = false
  quickGroupName.value = ''
  quickGroupError.value = ''
}

const confirmQuickAddGroup = () => {
  const name = quickGroupName.value.trim()
  if (!name) {
    quickGroupError.value = t('group.nameRequired')
    quickGroupInputRef.value?.focus()
    return
  }
  if (props.groups.some(g => g.name === name)) {
    quickGroupError.value = t('group.nameExists')
    quickGroupInputRef.value?.focus()
    return
  }
  pendingSelectGroupName.value = name
  emit('add-group', name)
  closeQuickAddGroup()
}

const triggerFileInput = () => {
  fileInputRef.value?.click()
}

const handleScanQR = async () => {
  try {
    const result = await scanQR()
    if (result && result.success === false) {
      alert(result.error || t('env.scanFailed'))
      return
    }
    if (result && result.secret) {
      form.value.totpSecret = result.secret
    } else {
      alert(t('env.qrNotFound'))
    }
  } catch (error) {
    const cancelReasons = ['cancelled', 'too small', 'user cancelled', '已取消', 'Cancelled']
    if (typeof error === 'string' && cancelReasons.some(r => error.includes(r))) {
      return
    }
    alert(error || t('env.scanFailed'))
  }
}

const handleFileSelect = async (e) => {
  const file = e.target.files?.[0]
  if (!file) return

  try {
    const dataUrl = await readFileAsDataUrl(file)
    const result = await parseQRCode(dataUrl)
    if (result) {
      const secret = extractSecretFromOtpUri(result)
      form.value.totpSecret = secret || result
    } else {
      alert(t('env.qrNotFoundImage'))
    }
  } catch (err) {
    console.error('QR parse error:', err)
    alert(t('env.qrRecognizeFailed', { msg: err.message }))
  }

  // 清空 file input 以便重复选择同一文件
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

const readFileAsDataUrl = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error(tt('env.readFileFailed')))
    reader.readAsDataURL(file)
  })
}

const extractSecretFromOtpUri = (uri) => {
  try {
    if (uri.startsWith('otpauth://')) {
      const url = new URL(uri)
      return url.searchParams.get('secret') || ''
    }
  } catch (e) {
    // 不是 URI 格式，直接返回原始值
  }
  return ''
}

const handleSave = () => {
  if (!form.value.alias) {
    alert(t('env.aliasRequired'))
    return
  }

  if (!form.value.username || !form.value.password) {
    alert(t('env.fieldsRequired'))
    return
  }

  const now = Date.now()

  const envData = {
    id: props.env ? props.env.id : null,
    alias: form.value.alias,
    username: form.value.username,
    password: form.value.password,
    type: form.value.type,
    customUrl: form.value.customUrl,
    groupId: form.value.groupId,
    totpSecret: form.value.totpSecret,
    passkeys: form.value.passkeys || [],
    createdAt: props.env?.createdAt || now,
    updatedAt: now
  }

  emit('save', envData)
}

watch(() => props.visible, (val) => {
  if (val) {
    closeQuickAddGroup()
    pendingSelectGroupName.value = null
    if (props.env) {
      form.value = {
        alias: props.env.alias || '',
        username: props.env.username || '',
        password: props.env.password || '',
        type: props.env.type || 'production',
        customUrl: props.env.customUrl || '',
        groupId: props.env.groupId || 'ungrouped',
        totpSecret: props.env.totpSecret || '',
        passkeys: props.env.passkeys || []
      }
    } else {
      form.value = {
        alias: '',
        username: '',
        password: '',
        type: 'production',
        customUrl: '',
        groupId: 'ungrouped',
        totpSecret: '',
        passkeys: []
      }
    }
  } else {
    closeQuickAddGroup()
    pendingSelectGroupName.value = null
  }
})

// 父组件创建分组后更新 groups，自动选中新建项
watch(() => props.groups, (groups) => {
  if (!pendingSelectGroupName.value) return
  const created = groups.find(g => g.name === pendingSelectGroupName.value)
  if (created) {
    form.value.groupId = created.id
    pendingSelectGroupName.value = null
  }
}, { deep: true })
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background-color: white;
  border-radius: 8px;
  width: 90%;
  max-width: 380px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(25, 118, 210, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid #bbdefb;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: #ffffff;
}

.modal-header h2 {
  margin: 0;
  font-size: 14px;
  color: #ffffff;
}

.modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.85);
  padding: 2px;
  display: flex;
  border-radius: 3px;
}

.modal-close:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.15);
}

.modal-body {
  padding: 12px 14px;
}

.form-group {
  margin-bottom: 10px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #555;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
  background: #ffffff;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.password-input-wrapper {
  position: relative;
}

.password-input-wrapper input {
  padding-right: 30px;
}

.password-toggle {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  color: #999;
  padding: 4px;
  display: flex;
  border-radius: 3px;
}

.password-toggle:hover {
  color: #1976d2;
}

.group-select-wrapper {
  display: flex;
  gap: 6px;
}

.group-select-wrapper select {
  flex: 1;
}

.nested-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.nested-modal-content {
  background-color: white;
  border-radius: 8px;
  width: 90%;
  max-width: 300px;
  box-shadow: 0 8px 24px rgba(25, 118, 210, 0.25);
  overflow: hidden;
}

.field-error {
  margin: -4px 0 0;
  font-size: 12px;
  color: #c62828;
}

.form-divider {
  text-align: center;
  margin: 14px 0;
  position: relative;
}

.form-divider span {
  background-color: #ffffff;
  padding: 0 8px;
  font-size: 11px;
  color: #1976d2;
  font-weight: 500;
}

.form-divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background-color: #bbdefb;
  z-index: -1;
}

.qr-actions {
  display: flex;
  gap: 8px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid #bbdefb;
  background: #f5f9ff;
}

.btn {
  padding: 6px 14px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

.btn-primary {
  background-color: #1976d2;
  color: white;
}

.btn-primary:hover {
  background-color: #0d47a1;
}

.btn-secondary {
  background-color: #e3f2fd;
  color: #0d47a1;
  border: 1px solid #bbdefb;
}

.btn-secondary:hover {
  background-color: #bbdefb;
}

.btn-outline {
  background: white;
  color: #1976d2;
  border: 1px solid #bbdefb;
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-outline:hover {
  background: #e3f2fd;
  border-color: #64b5f6;
}

.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.passkey-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.passkey-tag {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #e3f2fd;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  font-size: 12px;
  color: #0d47a1;
}

.passkey-tag-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.9);
}
</style>
