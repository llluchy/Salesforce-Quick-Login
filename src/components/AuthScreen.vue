<template>
  <div class="auth-container">
    <div class="auth-locale">
      <LocaleSwitcher variant="light" />
    </div>
    <!-- 顶部品牌区 -->
    <div class="auth-header">
      <div class="auth-logo">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
      </div>
      <h1 class="auth-title">{{ t('common.productName') }}</h1>
      <p class="auth-subtitle">{{ subtitleText }}</p>
    </div>

    <!-- 已登录账户提示（仅在 session 存在但需解锁时显示） -->
    <div class="auth-user-info" v-if="hasSession">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M10 2a4 4 0 100 8 4 4 0 000-8zM3 18a7 7 0 0114 0v-1a1 1 0 00-1-1H4a1 1 0 00-1 1v1z"/></svg>
      <span>{{ sessionEmail }}</span>
    </div>

    <!-- Tab 切换（仅在无 session 时显示） -->
    <div class="auth-tabs" v-if="!hasSession">
      <button
        :class="['auth-tab', { active: isLoginMode }]"
        @click="switchMode('login')">
        {{ t('auth.login') }}
      </button>
      <button
        :class="['auth-tab', { active: !isLoginMode }]"
        @click="switchMode('register')">
        {{ t('auth.register') }}
      </button>
    </div>

    <!-- 表单 -->
    <form class="auth-form" @submit.prevent="handleSubmit" @keydown="handleFormKeydown">
      <!-- 邮箱（仅在无 session 时显示） -->
      <div class="form-field" v-if="!hasSession">
        <label>{{ t('auth.email') }}</label>
        <input
          v-model.trim="email"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          :disabled="isLoading"
          tabindex="1"
          required />
      </div>

      <!-- 密码 -->
      <div class="form-field">
        <label>{{ t('auth.password') }}</label>
        <input
          v-model="password"
          type="password"
          :autocomplete="isLoginMode ? 'current-password' : 'new-password'"
          :placeholder="t('auth.passwordPlaceholder')"
          :disabled="isLoading"
          tabindex="2"
          minlength="8"
          required />
      </div>

      <!-- 确认密码（仅注册） -->
      <div class="form-field" v-if="!isLoginMode && !hasSession">
        <label>{{ t('auth.confirmPassword') }}</label>
        <input
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          :placeholder="t('auth.confirmPasswordPlaceholder')"
          :disabled="isLoading"
          tabindex="3"
          minlength="8"
          required />
      </div>

      <!-- 错误提示 -->
      <div class="auth-error" v-if="errorMessage">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13a1 1 0 112 0 1 1 0 01-2 0zm1-3a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z"/></svg>
        <span>{{ errorMessage }}</span>
      </div>

      <!-- 成功提示（注册后等待邮件确认） -->
      <div class="auth-success" v-if="successMessage">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13l-4-4 1.5-1.5L9 11l4.5-4.5L15 8l-6 6z"/></svg>
        <span>{{ successMessage }}</span>
      </div>

      <!-- 提交按钮 -->
      <button type="submit" class="btn-submit" :disabled="isLoading">
        <span v-if="isLoading" class="spinner-mini"></span>
        <span>{{ submitButtonText }}</span>
      </button>

      <!-- 操作链接 -->
      <div class="auth-footer" v-if="hasSession">
        <a href="#" @click.prevent="handleSignOut">{{ t('auth.switchAccount') }}</a>
      </div>
      <div class="auth-footer" v-else-if="isLoginMode">
        <a href="#" @click.prevent="showRecoveryDialog = true">{{ t('auth.forgotPassword') }}</a>
      </div>
    </form>

    <!-- 安全说明 -->
    <div class="auth-notice">
      <div class="notice-title">
        <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13a1 1 0 112 0 1 1 0 01-2 0zm1-3a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z"/></svg>
        <span>{{ t('auth.noticeTitle') }}</span>
      </div>
      <ul>
        <li>{{ t('auth.notice1') }}</li>
        <li>{{ t('auth.notice2Before') }}<strong>{{ t('auth.notice2Strong') }}</strong></li>
        <li>{{ t('auth.notice3Before') }}<strong>{{ t('auth.notice3Strong') }}</strong>{{ t('auth.notice3After') }}</li>
        <li>{{ t('auth.notice4') }}</li>
      </ul>
    </div>

    <!-- 忘记密码弹窗（发送恢复邮件） -->
    <Transition name="modal">
      <div class="recovery-overlay" v-if="showRecoveryDialog" @click.self="showRecoveryDialog = false">
        <div class="recovery-modal">
          <div class="recovery-header">
            <h3>{{ t('auth.recoveryTitle') }}</h3>
            <button class="recovery-close" @click="showRecoveryDialog = false">×</button>
          </div>
          <div class="recovery-body">
            <div class="recovery-info">
              {{ t('auth.recoveryInfo') }}
            </div>
            <div class="form-field">
              <label>{{ t('auth.recoveryEmail') }}</label>
              <input v-model.trim="recoveryEmail" type="email" placeholder="you@example.com" @keydown.enter="handleSendRecoveryEmail" />
            </div>
            <button class="btn-submit" @click="handleSendRecoveryEmail" :disabled="recoverySending">
              {{ recoverySending ? t('auth.sending') : t('auth.sendRecovery') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import LocaleSwitcher from './LocaleSwitcher.vue'

const emit = defineEmits(['authed'])

const { t } = useI18n()
const { signIn, signUp, signOut, unlockWithPassword, sendRecoveryEmail, isLoading, currentUser, authError } = useAuth()

// 监听 authError 变化（因为 getSession 是异步的，可能在组件挂载后才设置错误）
watch(authError, (newVal) => {
  if (newVal) {
    errorMessage.value = newVal
  }
}, { immediate: false })

// 模式：'login' | 'register'（有 session 时只解锁，不允许切换）
const mode = ref('login')
const isLoginMode = computed(() => mode.value === 'login')

// 是否有持久 session（用于切换为「解锁」模式）
const hasSession = computed(() => !!currentUser.value?.id)
const sessionEmail = computed(() => currentUser.value?.email || '')

const subtitleText = computed(() => {
  if (hasSession.value) return t('auth.subtitleUnlock')
  return isLoginMode.value ? t('auth.subtitleLogin') : t('auth.subtitleRegister')
})

const submitButtonText = computed(() => {
  if (isLoading.value) return t('common.loading')
  if (hasSession.value) return t('auth.unlock')
  return isLoginMode.value ? t('auth.login') : t('auth.register')
})

// 表单字段
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMessage = ref('')
const successMessage = ref('')

// 忘记密码（发送恢复邮件）
const showRecoveryDialog = ref(false)
const recoveryEmail = ref('')
const recoverySending = ref(false)

const switchMode = (m) => {
  mode.value = m
  errorMessage.value = ''
  successMessage.value = ''
  confirmPassword.value = ''
}

const validate = () => {
  if (!hasSession.value && !email.value) {
    errorMessage.value = t('auth.emailRequired')
    return false
  }
  if (!hasSession.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    errorMessage.value = t('auth.emailInvalid')
    return false
  }
  if (!password.value || password.value.length < 8) {
    errorMessage.value = t('auth.passwordMin')
    return false
  }
  if (!isLoginMode.value && !hasSession.value && password.value !== confirmPassword.value) {
    errorMessage.value = t('auth.passwordMismatch')
    return false
  }
  return true
}

const handleSubmit = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  if (!validate()) return

  try {
    if (hasSession.value) {
      // 已有 session，只需输入密码派生密钥
      await unlockWithPassword(password.value)
      password.value = ''
      emit('authed')
    } else if (isLoginMode.value) {
      await signIn({ email: email.value, password: password.value })
      emit('authed')
    } else {
      const result = await signUp({ email: email.value, password: password.value })
      if (result.needsEmailConfirm) {
        successMessage.value = t('auth.emailConfirmSent', { email: email.value })
      } else {
        emit('authed')
      }
    }
  } catch (e) {
    errorMessage.value = e.message || t('common.operationFailed')
  }
}

// Tab 焦点陷阱：防止 Tab 键逃逸到浏览器地址栏
const handleFormKeydown = (e) => {
  if (e.key === 'Tab') {
    const form = e.currentTarget
    const focusable = form.querySelectorAll('input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])')
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
}

const handleSignOut = async () => {
  try {
    await signOut()
    password.value = ''
    errorMessage.value = ''
    successMessage.value = ''
  } catch (e) {
    errorMessage.value = e.message || t('auth.signOutFailed')
  }
}

const handleSendRecoveryEmail = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  if (!recoveryEmail.value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail.value)) {
    errorMessage.value = t('auth.validEmailRequired')
    return
  }
  recoverySending.value = true
  try {
    await sendRecoveryEmail(recoveryEmail.value)
    successMessage.value = t('auth.recoverySent', { email: recoveryEmail.value })
    showRecoveryDialog.value = false
  } catch (e) {
    errorMessage.value = e.message || t('auth.sendFailed')
  } finally {
    recoverySending.value = false
  }
}

onMounted(() => {
  // 检查是否有设备不匹配等错误
  if (authError?.value) {
    errorMessage.value = authError.value
  }
})
</script>

<style scoped>
.auth-container {
  position: relative;
  min-height: 100vh;
  background-color: #eef5fc;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px 24px;
  box-sizing: border-box;
}

.auth-locale {
  position: absolute;
  top: 10px;
  right: 10px;
}

.auth-header {
  text-align: center;
  margin-bottom: 20px;
}

.auth-logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
  margin-bottom: 12px;
}

.auth-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
  color: #0d47a1;
  letter-spacing: 0.3px;
}

.auth-subtitle {
  margin: 0;
  font-size: 12px;
  color: #5c7a9b;
}

.auth-tabs {
  display: flex;
  background: #ffffff;
  border: 1px solid #bbdefb;
  border-radius: 8px;
  padding: 3px;
  width: 100%;
  max-width: 360px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(25, 118, 210, 0.08);
}

.auth-tab {
  flex: 1;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: #5c7a9b;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.auth-tab.active {
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  box-shadow: 0 2px 6px rgba(25, 118, 210, 0.3);
}

.auth-form {
  width: 100%;
  max-width: 360px;
  background: white;
  padding: 20px;
  border-radius: 8px;
  border: 1px solid #bbdefb;
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.1);
  box-sizing: border-box;
}

.form-field {
  margin-bottom: 14px;
}

.form-field label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #0d47a1;
}

.form-field input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #bbdefb;
  border-radius: 5px;
  font-size: 13px;
  background: #f5f9ff;
  color: #0d47a1;
  box-sizing: border-box;
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
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%);
  border: 2px solid #ef5350;
  color: #c62828;
  border-radius: 8px;
  font-size: 12px;
  margin-bottom: 14px;
  line-height: 1.6;
  animation: shake 0.4s ease-in-out;
  box-shadow: 0 2px 8px rgba(229, 57, 53, 0.2);
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

.auth-error svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.auth-success {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  background: #e8f5e9;
  border: 1px solid #81c784;
  color: #2e7d32;
  border-radius: 5px;
  font-size: 12px;
  margin-bottom: 12px;
  line-height: 1.5;
}

.auth-success svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.btn-submit {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 5px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.15s;
  box-shadow: 0 2px 6px rgba(25, 118, 210, 0.25);
}

.btn-submit:hover:not(:disabled) {
  background: linear-gradient(135deg, #1565c0 0%, #0d47a1 100%);
  box-shadow: 0 4px 10px rgba(25, 118, 210, 0.35);
}

.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinner-mini {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.auth-footer {
  text-align: center;
  margin-top: 12px;
}

.auth-footer a {
  font-size: 12px;
  color: #1976d2;
  text-decoration: none;
}

.auth-footer a:hover {
  text-decoration: underline;
}

.auth-notice {
  width: 100%;
  max-width: 360px;
  margin-top: 16px;
  padding: 12px 14px;
  background: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 6px;
  box-sizing: border-box;
}

.notice-title {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #0d47a1;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 8px;
}

.auth-notice ul {
  margin: 0;
  padding-left: 16px;
  color: #5c7a9b;
  font-size: 11px;
  line-height: 1.7;
}

.auth-notice li strong {
  color: #0d47a1;
}

.auth-user-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 18px;
  color: #0d47a1;
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 14px;
  max-width: 360px;
  width: 100%;
  box-sizing: border-box;
  justify-content: center;
}

.auth-user-info svg {
  flex-shrink: 0;
}

.auth-user-info span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 忘记密码弹窗 */
.recovery-overlay {
  position: fixed;
  inset: 0;
  background: rgba(13, 71, 161, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
  box-sizing: border-box;
}

.recovery-modal {
  background: white;
  border-radius: 8px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.recovery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  border-radius: 8px 8px 0 0;
}

.recovery-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.recovery-close {
  background: none;
  border: none;
  color: white;
  font-size: 22px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.recovery-body {
  padding: 16px;
}

.recovery-info {
  padding: 10px 12px;
  background: #e8f4fc;
  border: 1px solid #b3d9f2;
  color: #01579b;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1.6;
  margin-bottom: 12px;
}

/* Transition */
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s;
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
</style>
