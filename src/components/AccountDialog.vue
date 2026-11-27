<template>
  <Transition name="modal">
    <div class="modal-overlay" v-if="visible" @click.self="handleClose">
      <div class="modal-content account-modal">
        <div class="modal-header">
          <h2>{{ t('account.title') }}</h2>
          <button class="modal-close" @click="handleClose" :disabled="loading">×</button>
        </div>

        <div class="modal-body">
          <!-- 当前账户信息 -->
          <div class="account-info-card">
            <div class="account-avatar">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div class="account-meta">
              <div class="account-label">{{ t('account.currentAccount') }}</div>
              <div class="account-email">{{ email || t('common.unknown') }}</div>
            </div>
          </div>

          <!-- 模式切换 -->
          <div class="mode-tabs" v-if="!loading">
            <button :class="['mode-tab', { active: mode === 'menu' }]" @click="mode = 'menu'">{{ t('account.tabMenu') }}</button>
            <button :class="['mode-tab', { active: mode === 'password' }]" @click="mode = 'password'">{{ t('account.tabPassword') }}</button>
          </div>

          <!-- 菜单模式 -->
          <div class="menu-section" v-if="mode === 'menu'">
            <button class="btn-action btn-danger" @click="handleSignOut" :disabled="loading">
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 7V5a3 3 0 00-3-3H5a3 3 0 00-3 3v10a3 3 0 003 3h6a3 3 0 003-3v-2"/>
                <path d="M18 10h-9"/>
                <path d="M11 7l-3 3 3 3"/>
              </svg>
              <span>{{ t('account.signOut') }}</span>
            </button>
            <button class="btn-action btn-secondary" @click="mode = 'reencrypt'" :disabled="loading">
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M2 10a8 8 0 018-8v8h8a8 8 0 01-8 8v-8H2z"/>
              </svg>
              <span>{{ t('account.reencrypt') }}</span>
            </button>
          </div>

          <!-- 修改密码模式 -->
          <div class="password-section" v-if="mode === 'password'">
            <div class="password-warn">
              {{ t('account.passwordWarn') }}
            </div>

            <div class="form-field">
              <label>{{ t('account.oldPassword') }}</label>
              <input
                v-model="oldPassword"
                type="password"
                autocomplete="current-password"
                :placeholder="t('account.oldPasswordPlaceholder')"
                :disabled="loading"
                minlength="8" />
            </div>

            <div class="form-field">
              <label>{{ t('account.newPassword') }}</label>
              <input
                v-model="newPassword"
                type="password"
                autocomplete="new-password"
                :placeholder="t('auth.passwordPlaceholder')"
                :disabled="loading"
                minlength="8" />
            </div>

            <div class="form-field">
              <label>{{ t('account.confirmNewPassword') }}</label>
              <input
                v-model="confirmNewPassword"
                type="password"
                autocomplete="new-password"
                :placeholder="t('account.confirmNewPasswordPlaceholder')"
                :disabled="loading"
                minlength="8" />
            </div>

            <div class="auth-error" v-if="errorMessage">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13a1 1 0 112 0 1 1 0 01-2 0zm1-3a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z"/></svg>
              <span>{{ errorMessage }}</span>
            </div>

            <div class="auth-success" v-if="successMessage">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13l-4-4 1.5-1.5L9 11l4.5-4.5L15 8l-6 6z"/></svg>
              <span>{{ successMessage }}</span>
            </div>

            <div class="password-actions">
              <button class="btn btn-outline" @click="cancelPassword" :disabled="loading">{{ t('common.cancel') }}</button>
              <button class="btn btn-primary" @click="handleChangePassword" :disabled="loading">
                <span v-if="loading" class="spinner-mini"></span>
                <span>{{ loading ? t('account.reencrypting') : t('account.confirmChange') }}</span>
              </button>
            </div>
          </div>

          <!-- 重加密模式 -->
          <div class="password-section" v-if="mode === 'reencrypt'">
            <div class="password-warn">
              {{ t('account.reencryptWarn') }}
            </div>

            <div class="form-field">
              <label>{{ t('account.currentPassword') }}</label>
              <input
                v-model="reencryptPassword"
                type="password"
                autocomplete="current-password"
                :placeholder="t('account.oldPasswordPlaceholder')"
                :disabled="loading"
                minlength="8" />
            </div>

            <div class="auth-error" v-if="errorMessage">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13a1 1 0 112 0 1 1 0 01-2 0zm1-3a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z"/></svg>
              <span>{{ errorMessage }}</span>
            </div>

            <div class="auth-success" v-if="successMessage">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13l-4-4 1.5-1.5L9 11l4.5-4.5L15 8l-6 6z"/></svg>
              <span>{{ successMessage }}</span>
            </div>

            <div class="password-actions">
              <button class="btn btn-outline" @click="cancelReencrypt" :disabled="loading">{{ t('common.cancel') }}</button>
              <button class="btn btn-primary" @click="handleReencrypt" :disabled="loading">
                <span v-if="loading" class="spinner-mini"></span>
                <span>{{ loading ? t('account.reencrypting') : t('account.startReencrypt') }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 退出登录确认（替代浏览器 confirm） -->
      <Transition name="modal">
        <div
          v-if="signOutConfirmVisible"
          class="confirm-overlay"
          @click.self="closeSignOutConfirm"
        >
          <div class="confirm-modal">
            <div class="modal-header">
              <h2>{{ t('account.signOutTitle') }}</h2>
              <button class="modal-close" type="button" @click="closeSignOutConfirm" :disabled="loading">×</button>
            </div>
            <div class="confirm-body">
              <div class="confirm-warning">
                <span class="confirm-icon">⚠️</span>
                <p>{{ t('account.signOutConfirm') }}</p>
                <p class="confirm-hint">{{ t('account.signOutHint') }}</p>
              </div>
              <div class="auth-error" v-if="errorMessage && signOutConfirmVisible">
                <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13a1 1 0 112 0 1 1 0 01-2 0zm1-3a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z"/></svg>
                <span>{{ errorMessage }}</span>
              </div>
            </div>
            <div class="confirm-footer">
              <button class="btn btn-outline" type="button" @click="closeSignOutConfirm" :disabled="loading">{{ t('common.cancel') }}</button>
              <button class="btn btn-danger-solid" type="button" @click="confirmSignOut" :disabled="loading">
                <span v-if="loading" class="spinner-mini"></span>
                <span>{{ loading ? t('account.signingOut') : t('account.signOut') }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'signed-out'])

const { t } = useI18n()
const { signOut, changePassword, reencryptAll, currentUser } = useAuth()
const email = computed(() => currentUser.value?.email || '')

const mode = ref('menu')
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const signOutConfirmVisible = ref(false)

// 修改密码表单
const oldPassword = ref('')
const newPassword = ref('')
const confirmNewPassword = ref('')

// 重加密表单
const reencryptPassword = ref('')

watch(() => props.visible, (val) => {
  if (val) {
    mode.value = 'menu'
    errorMessage.value = ''
    successMessage.value = ''
    oldPassword.value = ''
    newPassword.value = ''
    confirmNewPassword.value = ''
    reencryptPassword.value = ''
    signOutConfirmVisible.value = false
  } else {
    signOutConfirmVisible.value = false
  }
})

const handleClose = () => {
  if (loading.value) return
  signOutConfirmVisible.value = false
  emit('close')
}

const handleSignOut = () => {
  if (loading.value) return
  errorMessage.value = ''
  signOutConfirmVisible.value = true
}

const closeSignOutConfirm = () => {
  if (loading.value) return
  signOutConfirmVisible.value = false
}

const confirmSignOut = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    await signOut()
    signOutConfirmVisible.value = false
    emit('signed-out')
  } catch (e) {
    errorMessage.value = e.message || t('account.signOutFailed')
  } finally {
    loading.value = false
  }
}

const cancelPassword = () => {
  mode.value = 'menu'
  oldPassword.value = ''
  newPassword.value = ''
  confirmNewPassword.value = ''
  errorMessage.value = ''
  successMessage.value = ''
}

const cancelReencrypt = () => {
  mode.value = 'menu'
  reencryptPassword.value = ''
  errorMessage.value = ''
  successMessage.value = ''
}

const handleChangePassword = async () => {
  errorMessage.value = ''
  successMessage.value = ''

  if (!oldPassword.value) {
    errorMessage.value = t('account.oldPasswordRequired')
    return
  }
  if (!newPassword.value || newPassword.value.length < 8) {
    errorMessage.value = t('account.newPasswordMin')
    return
  }
  if (newPassword.value !== confirmNewPassword.value) {
    errorMessage.value = t('account.newPasswordMismatch')
    return
  }
  if (oldPassword.value === newPassword.value) {
    errorMessage.value = t('account.newPasswordSame')
    return
  }

  loading.value = true
  try {
    await changePassword({
      oldPassword: oldPassword.value,
      newPassword: newPassword.value
    })
    successMessage.value = t('account.changePasswordSuccess')
    oldPassword.value = ''
    newPassword.value = ''
    confirmNewPassword.value = ''
    // 3 秒后回到菜单
    setTimeout(() => {
      mode.value = 'menu'
      successMessage.value = ''
    }, 3000)
  } catch (e) {
    errorMessage.value = e.message || t('account.changeFailed')
  } finally {
    loading.value = false
  }
}

const handleReencrypt = async () => {
  errorMessage.value = ''
  successMessage.value = ''

  if (!reencryptPassword.value || reencryptPassword.value.length < 8) {
    errorMessage.value = t('account.currentPasswordRequired')
    return
  }

  loading.value = true
  try {
    await reencryptAll(reencryptPassword.value)
    successMessage.value = t('account.reencryptSuccess')
    reencryptPassword.value = ''
    setTimeout(() => {
      mode.value = 'menu'
      successMessage.value = ''
    }, 3000)
  } catch (e) {
    errorMessage.value = e.message || t('account.reencryptFailed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(13, 71, 161, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 12px;
  box-sizing: border-box;
}

.account-modal {
  background: white;
  border-radius: 8px;
  width: 100%;
  max-width: 380px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  border-radius: 8px 8px 0 0;
}

.modal-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.modal-close {
  background: none;
  border: none;
  color: white;
  font-size: 22px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.modal-close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-body {
  padding: 16px;
}

.account-info-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #e3f2fd;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  margin-bottom: 16px;
}

.account-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.account-meta {
  flex: 1;
  min-width: 0;
}

.account-label {
  font-size: 11px;
  color: #5c7a9b;
  margin-bottom: 2px;
}

.account-email {
  font-size: 13px;
  font-weight: 600;
  color: #0d47a1;
  word-break: break-all;
}

.mode-tabs {
  display: flex;
  background: #f5f9ff;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  padding: 3px;
  margin-bottom: 14px;
}

.mode-tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  background: transparent;
  color: #5c7a9b;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
}

.mode-tab.active {
  background: white;
  color: #0d47a1;
  box-shadow: 0 1px 3px rgba(25, 118, 210, 0.15);
}

.menu-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.menu-tip {
  padding: 10px 12px;
  background: #e8f5e9;
  border: 1px solid #a5d6a7;
  color: #2e7d32;
  border-radius: 5px;
  font-size: 12px;
  line-height: 1.5;
}

.btn-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  border: 1px solid;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-danger {
  border-color: #ef5350;
  background: #fff;
  color: #c62828;
}

.btn-danger:hover:not(:disabled) {
  background: #ef5350;
  color: white;
}

.btn-secondary {
  border-color: #78909c;
  background: #fff;
  color: #455a64;
}

.btn-secondary:hover:not(:disabled) {
  background: #78909c;
  color: white;
}

.btn-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.password-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.password-warn {
  padding: 8px 10px;
  background: #fff3e0;
  border: 1px solid #ffb74d;
  color: #e65100;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1.5;
  margin-bottom: 6px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-field label {
  font-size: 12px;
  font-weight: 500;
  color: #0d47a1;
}

.form-field input {
  padding: 8px 11px;
  border: 1px solid #bbdefb;
  border-radius: 5px;
  font-size: 13px;
  background: #f5f9ff;
  color: #0d47a1;
  transition: all 0.15s;
}

.form-field input:focus {
  outline: none;
  border-color: #1976d2;
  background: white;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.12);
}

.form-field input:disabled {
  background: #eef5fc;
  cursor: not-allowed;
}

.auth-error {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  background: #ffebee;
  border: 1px solid #ef9a9a;
  color: #c62828;
  border-radius: 5px;
  font-size: 12px;
}

.auth-success {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  padding: 7px 10px;
  background: #e8f5e9;
  border: 1px solid #81c784;
  color: #2e7d32;
  border-radius: 5px;
  font-size: 12px;
  line-height: 1.5;
}

.password-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.btn {
  flex: 1;
  padding: 9px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s;
  border: 1px solid;
}

.btn-primary {
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  border-color: #1565c0;
  box-shadow: 0 2px 6px rgba(25, 118, 210, 0.25);
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #1565c0 0%, #0d47a1 100%);
}

.btn-outline {
  background: white;
  color: #0d47a1;
  border-color: #bbdefb;
}

.btn-outline:hover:not(:disabled) {
  background: #e3f2fd;
  border-color: #1976d2;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinner-mini {
  width: 11px;
  height: 11px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 12px;
  box-sizing: border-box;
}

.confirm-modal {
  background: white;
  border-radius: 8px;
  width: 100%;
  max-width: 320px;
  box-shadow: 0 8px 24px rgba(25, 118, 210, 0.25);
  overflow: hidden;
}

.confirm-body {
  padding: 20px 16px 12px;
  background: #f5f9ff;
}

.confirm-warning {
  text-align: center;
}

.confirm-icon {
  font-size: 36px;
  display: block;
  margin-bottom: 10px;
}

.confirm-warning p {
  margin: 0 0 8px;
  color: #333;
  font-size: 14px;
}

.confirm-hint {
  font-size: 12px !important;
  color: #1976d2 !important;
  line-height: 1.5;
}

.confirm-body .auth-error {
  margin-top: 12px;
}

.confirm-footer {
  display: flex;
  gap: 8px;
  padding: 12px 16px 16px;
  background: #f5f9ff;
  border-top: 1px solid #bbdefb;
}

.btn-danger-solid {
  background: #dc3545;
  color: white;
  border-color: #dc3545;
}

.btn-danger-solid:hover:not(:disabled) {
  background: #c82333;
  border-color: #c82333;
}

.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s;
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
</style>
