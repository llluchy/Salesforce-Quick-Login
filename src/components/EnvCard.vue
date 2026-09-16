<template>
  <div class="env-card-wrapper" :class="{ 'expanded': showTotpCard }">
  <div class="env-card" :class="{ 'env-card-warning': !hasCredentials }">
    <div class="env-card-main">
      <div class="env-drag-handle">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="#999"><circle cx="4" cy="3" r="1.5"/><circle cx="12" cy="3" r="1.5"/><circle cx="4" cy="8" r="1.5"/><circle cx="12" cy="8" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="13" r="1.5"/></svg>
      </div>
      
      <div class="env-content">
        <div class="env-header">
          <span class="env-alias">{{ env.alias }}</span>
          <span class="env-type" :class="`type-${env.type}`">
            {{ getTypeLabel(env.type) }}
          </span>
          <span v-if="!hasCredentials" class="env-warning-badge" :title="t('env.noCredentialsTitle')">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="7"/><path d="M8 5v4"/><path d="M8 12h.01"/></svg>
          </span>
        </div>
        <div class="env-username">{{ displayUsername }}</div>
        <div v-if="!hasCredentials" class="env-warning-hint">{{ t('env.noCredentialsHint') }}</div>
      </div>
      
      <div class="env-actions">
        <button v-if="hasCredentials" class="action-btn" :title="t('env.login')" @click.stop="handleLogin">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 2h3a2 2 0 012 2v8a2 2 0 01-2 2H9"/><path d="M2 8h7"/><path d="M6 5l3 3-3 3"/></svg>
        </button>
        <button v-if="env.totpSecret && hasCredentials" class="action-btn" :title="t('env.getTotp')" @click.stop="toggleTotpCard">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="8" width="6" height="6" rx="1"/><path d="M6 8V5.5a2 2 0 114 0V8"/></svg>
        </button>
        <button class="action-btn" :title="t('env.edit')" @click.stop="$emit('edit')">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
        </button>
        <button class="action-btn" :title="t('env.clone')" @click.stop="$emit('clone')">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/></svg>
        </button>
        <button class="action-btn action-delete" :title="t('env.delete')" @click.stop="$emit('delete')">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12"/><path d="M5 4v9a2 2 0 002 2h2a2 2 0 002-2V4"/><path d="M6 2h4"/><path d="M7 7v4"/><path d="M9 7v4"/></svg>
        </button>
      </div>
    </div>
  </div>
    
    <div class="totp-card" v-if="showTotpCard">
      <div class="totp-card-inner">
        <div class="totp-code" :title="t('env.copyTotp')" @click="copyTotpCode">{{ currentTotpCode || '---' }}</div>
        <div class="totp-timer">
          <div class="totp-progress" :class="{ 'no-transition': !animationEnabled }" :style="{ width: timerProgress + '%' }"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTotp } from '../composables/useTotp'

const props = defineProps({
  env: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['login', 'edit', 'clone', 'delete', 'copy-success'])

const { t } = useI18n()
const { generateCode, fillTotpCode } = useTotp()

const showTotpCard = ref(false)
  const currentTotpCode = ref('')
  const countdown = ref(30)
  const timerProgress = ref(100)
  const animationEnabled = ref(false)
  let timerInterval = null

  const getTypeLabel = (type) => {
    if (type === 'production') return t('type.production')
    if (type === 'sandbox') return t('type.sandbox')
    if (type === 'custom') return t('type.custom')
    return t('type.unknown')
  }

  const hasCredentials = computed(() => {
    return props.env.username && props.env.password
  })

  const displayUsername = computed(() => {
    return props.env.username || t('env.noUsername')
  })

const toggleTotpCard = async () => {
  if (showTotpCard.value) {
    showTotpCard.value = false
    stopTimer()
  } else {
    showTotpCard.value = true
    await refreshTotpCode()
    startTimer()
  }
}

const handleLogin = async () => {
  emit('login')

  // 如果绑定了 TOTP，自动展开并复制验证码
  if (props.env.totpSecret) {
    if (!showTotpCard.value) {
      showTotpCard.value = true
      await refreshTotpCode()
      startTimer()
    }
    // 复制验证码到剪贴板
    if (currentTotpCode.value && currentTotpCode.value !== '---') {
      try {
        await navigator.clipboard.writeText(currentTotpCode.value)
        emit('copy-success', currentTotpCode.value)
      } catch (e) {
        // 降级方案
        try {
          const textarea = document.createElement('textarea')
          textarea.value = currentTotpCode.value
          textarea.style.position = 'fixed'
          textarea.style.opacity = '0'
          document.body.appendChild(textarea)
          textarea.select()
          document.execCommand('copy')
          document.body.removeChild(textarea)
          emit('copy-success', currentTotpCode.value)
        } catch (fallbackErr) {
          // 静默处理
        }
      }
    }
  }
}

const refreshTotpCode = async () => {
  if (props.env.totpSecret) {
    currentTotpCode.value = await generateCode(props.env.totpSecret)
    try {
      await fillTotpCode(currentTotpCode.value)
    } catch (e) {
    }
  }
}

const getRemainingSeconds = () => {
  return 30 - (Math.floor(Date.now() / 1000) % 30)
}

const startTimer = async () => {
  stopTimer()

  // 根据当前时间计算剩余秒数，确保同步
  const remaining = getRemainingSeconds()

  // 首次设置时禁用动画，立即跳到正确位置
  animationEnabled.value = false
  countdown.value = remaining
  timerProgress.value = (remaining / 30) * 100

  // 下一帧启用动画
  requestAnimationFrame(() => {
    animationEnabled.value = true
  })

  // 如果刚好是周期开始，立即生成新验证码
  if (remaining === 30 || remaining === 0) {
    await refreshTotpCode()
    countdown.value = 30
    timerProgress.value = 100
  }

  // 每秒更新，与全局时间同步
  timerInterval = setInterval(async () => {
    const newRemaining = getRemainingSeconds()

    // 当进入新周期时刷新验证码
    if (newRemaining === 30 || (countdown.value > newRemaining && newRemaining > 0)) {
      if (newRemaining === 30 || countdown.value < newRemaining) {
        await refreshTotpCode()
      }
    }

    countdown.value = newRemaining
    timerProgress.value = (newRemaining / 30) * 100
  }, 1000)
}

const stopTimer = () => {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

const copyTotpCode = async () => {
  if (!currentTotpCode.value || currentTotpCode.value === '---') return

  try {
    await navigator.clipboard.writeText(currentTotpCode.value)
    emit('copy-success', currentTotpCode.value)
  } catch (e) {
    // 降级方案：创建临时 textarea
    try {
      const textarea = document.createElement('textarea')
      textarea.value = currentTotpCode.value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      emit('copy-success', currentTotpCode.value)
    } catch (fallbackErr) {
      // 复制失败静默处理
    }
  }
}

watch(() => props.env.totpSecret, () => {
  if (showTotpCard.value) {
    refreshTotpCode()
  }
})

onBeforeUnmount(() => {
  stopTimer()
})
</script>

<style scoped>
.env-card-wrapper {
  position: relative;
  background: transparent;
  margin-bottom: 6px;
}

.env-card-wrapper.expanded {
  z-index: 100;
}

.env-card {
  background: #fff;
  border-radius: 6px;
  box-shadow:
    0 1px 3px rgba(25, 118, 210, 0.08),
    0 2px 8px rgba(25, 118, 210, 0.05);
  transition: box-shadow 0.2s;
  overflow: hidden;
  position: relative;
  z-index: 2;
  border: 1px solid #e3f2fd;
}

.env-card-warning {
  border-left: 4px solid #f57c00;
}

.env-card-warning .env-card-main {
  background: linear-gradient(135deg, #fff8e1 0%, #fff3e0 100%);
}

.env-card:hover {
  box-shadow:
    0 2px 8px rgba(25, 118, 210, 0.15),
    0 4px 16px rgba(25, 118, 210, 0.1);
  border-color: #90caf9;
}

.env-card-main {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  background: linear-gradient(135deg, #ffffff 0%, #f5f9ff 100%);
}

.env-drag-handle {
  cursor: grab;
  padding: 4px;
  margin-right: 8px;
  opacity: 0.35;
  transition: opacity 0.2s;
  user-select: none;
  display: flex;
}

.env-card:hover .env-drag-handle {
  opacity: 0.7;
}

.env-drag-handle:active {
  cursor: grabbing;
}

.env-content {
  flex: 1;
  min-width: 0;
  margin-right: 10px;
}

.env-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.env-alias {
  font-weight: 600;
  font-size: 13px;
  color: #2d2d2d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.env-type {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
  flex-shrink: 0;
}

.type-production {
  background-color: #dc3545;
  color: white;
}

.type-sandbox {
  background-color: #1976d2;
  color: white;
}

.type-custom {
  background-color: #5c6bc0;
  color: white;
}

.env-username {
  font-size: 11px;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.env-warning-hint {
  font-size: 10px;
  color: #ff9800;
  margin-top: 2px;
}

.env-warning-badge {
  color: #ff9800;
  padding: 2px;
  border-radius: 3px;
  flex-shrink: 0;
}

.env-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
}

.env-badge-slave {
  background: #dbeafe;
  color: #1e40af;
  border: 1px solid #93c5fd;
}

.env-badge-shared {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #6ee7b7;
}

.env-card-slave {
  border-left: 3px solid #3b82f6;
  background: linear-gradient(to right, #eff6ff 0%, #ffffff 30%);
}

.env-card-shared {
  border-left: 3px solid #10b981;
}

.env-slave-hint {
  font-size: 11px;
  color: #6b7280;
  margin-top: 2px;
  font-style: italic;
}

.env-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.action-btn {
  background: none;
  border: none;
  padding: 4px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  color: #1976d2;
}

.action-btn:hover {
  background-color: #e3f2fd;
  color: #0d47a1;
}

.action-delete:hover {
  background-color: #ffebee;
  color: #dc3545;
}

.totp-card {
  position: relative;
  width: 95%;
  margin: 0 auto;
  top: -8px;
  z-index: 1;
  animation: bookmarkDrop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.totp-card-inner {
  background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
  padding: 16px 14px 8px 14px;
  border-radius: 6px;
  position: relative;
  box-shadow:
    0 4px 12px rgba(25, 118, 210, 0.2),
    0 8px 24px rgba(25, 118, 210, 0.1);
  display: flex;
  align-items: center;
  gap: 12px;
}

.totp-card-inner::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, #1976d2 0%, #64b5f6 100%);
  border-radius: 6px 0 0 6px;
}

.totp-code {
  font-size: 18px;
  font-weight: 700;
  color: #0d47a1;
  letter-spacing: 3px;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
  text-shadow: 0 1px 2px rgba(25, 118, 210, 0.08);
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
  transition: color 0.2s;
}

.totp-code:hover {
  color: #1976d2;
}

.totp-timer {
  height: 4px;
  background: #bbdefb;
  border-radius: 2px;
  overflow: hidden;
  flex: 1;
  min-width: 0;
}

.totp-progress {
  height: 100%;
  background: linear-gradient(90deg, #1976d2 0%, #64b5f6 100%);
  border-radius: 2px;
  transition: width 1s linear;
  box-shadow: 0 0 4px rgba(25, 118, 210, 0.4);
}

.totp-progress.no-transition {
  transition: none;
}

@keyframes bookmarkDrop {
  0% {
    opacity: 0;
    transform: translateY(-10px);
  }
  60% {
    opacity: 1;
    transform: translateY(3px);
  }
  80% {
    transform: translateY(-1px);
  }
  100% {
    transform: translateY(0);
  }
}

:global(.env-ghost) {
  opacity: 0.4;
  background-color: #e3f2fd !important;
  border: 2px dashed #1976d2 !important;
}

:global(.env-chosen) {
  background-color: #bbdefb;
}

:global(.env-drag) {
  opacity: 0.85;
  box-shadow: 0 8px 24px rgba(25, 118, 210, 0.25);
  transition: none !important;
}
</style>
