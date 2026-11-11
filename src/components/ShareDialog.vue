<template>
  <Transition name="modal">
    <div class="modal-overlay" v-if="visible" @click.self="handleClose">
      <div class="modal-content share-modal">
        <div class="modal-header">
          <h2>{{ t('share.title') }}</h2>
          <button class="modal-close" @click="handleClose" :disabled="loading">×</button>
        </div>

        <div class="modal-body">
          <!-- Tab 切换 -->
          <div class="mode-tabs">
            <button :class="['mode-tab', { active: mode === 'share' }]" @click="mode = 'share'">{{ t('share.tabShare') }}</button>
            <button :class="['mode-tab', { active: mode === 'sent' }]" @click="mode = 'sent'">{{ t('share.tabSent') }}</button>
            <button :class="['mode-tab', { active: mode === 'accept' }]" @click="mode = 'accept'">{{ t('share.tabAccept') }}</button>
          </div>

          <!-- 分享出去 -->
          <div class="share-section" v-if="mode === 'share'">
            <div class="form-hint">
              {{ t('share.shareHint') }}
              <br>{{ t('share.shareHintExpire') }}
              <br>{{ t('share.shareHintRevoke') }}
            </div>

            <div class="env-list" v-if="environments.length > 0">
              <label
                v-for="env in environments"
                :key="env.id"
                :class="['env-item', { selected: selectedEnvs.includes(env.id) }]"
              >
                <input
                  type="checkbox"
                  :value="env.id"
                  v-model="selectedEnvs"
                  :disabled="loading"
                />
                <div class="env-info">
                  <div class="env-alias">{{ env.alias }}</div>
                  <div class="env-meta">
                    <span class="env-type">{{ env.type }}</span>
                  </div>
                </div>
              </label>
            </div>
            <div v-else class="empty-tip">{{ t('share.empty') }}</div>

            <button
              class="btn-primary"
              @click="handleCreateShare"
              :disabled="loading || selectedEnvs.length === 0"
            >
              {{ loading ? t('share.generating') : t('share.generate') }}
            </button>

            <!-- 分享码展示 -->
            <div class="codes-display" v-if="generatedCodes">
              <div class="code-block">
                <div class="code-label">{{ t('share.shareCodeLabel') }}</div>
                <div class="code-value">{{ generatedCodes.shareCode }}</div>
              </div>
              <div class="code-block">
                <div class="code-label">{{ t('share.verifyCodeLabel') }}</div>
                <div class="code-value">{{ generatedCodes.verifyCode }}</div>
              </div>
              <div class="code-warn">
                {{ t('share.securityHint') }}
                <br>{{ t('share.securityHintExpire') }}
              </div>
            </div>

            <div class="error-message" v-if="errorMessage">{{ errorMessage }}</div>
          </div>

          <!-- 已发出、对方还没收下 -->
          <div class="sent-section" v-if="mode === 'sent'">
            <div class="form-hint">{{ t('share.sentHint') }}</div>

            <div v-if="sentLoading" class="empty-tip">{{ t('share.sentLoading') }}</div>
            <div v-else-if="pendingView.length === 0 && !errorMessage" class="empty-tip">{{ t('share.sentEmpty') }}</div>
            <div v-else-if="pendingView.length > 0" class="sent-list">
              <div v-for="item in pendingView" :key="item.id" class="sent-item">
                <div class="sent-code">
                  <span class="sent-code-label">{{ t('share.sentCodeLabel') }}</span>
                  <span class="sent-code-digits">{{ item.shareCode }}</span>
                </div>
                <div class="sent-aliases">{{ aliasText(item) }}</div>
                <div :class="['sent-remaining', { expired: item.expired }]">{{ remainingText(item) }}</div>

                <div v-if="confirmingId === item.id" class="revoke-confirm">
                  <p class="revoke-hint">{{ t('share.revokeHint') }}</p>
                  <div class="sent-actions">
                    <button
                      class="btn-danger"
                      @click="handleRevoke(item)"
                      :disabled="revokingId === item.id"
                    >
                      {{ revokingId === item.id ? t('share.revoking') : t('share.revokeConfirm') }}
                    </button>
                    <button
                      class="btn-ghost"
                      @click="confirmingId = ''"
                      :disabled="revokingId === item.id"
                    >
                      {{ t('share.revokeCancel') }}
                    </button>
                  </div>
                </div>
                <div v-else class="sent-actions">
                  <button
                    class="btn-danger-outline"
                    @click="confirmingId = item.id"
                    :disabled="!!revokingId"
                  >
                    {{ t('share.revoke') }}
                  </button>
                </div>
              </div>
            </div>

            <div class="error-message" v-if="errorMessage">{{ errorMessage }}</div>
            <div class="success-message" v-if="successMessage">{{ successMessage }}</div>
          </div>

          <!-- 接受分享 -->
          <div class="accept-section" v-if="mode === 'accept'">
            <div class="form-hint">
              {{ t('share.acceptHint') }}
            </div>

            <div class="form-field">
              <label>{{ t('share.shareCode') }}</label>
              <input
                v-model="inputShareCode"
                type="text"
                maxlength="6"
                :placeholder="t('share.codePlaceholder')"
                :disabled="loading"
                @input="inputShareCode = inputShareCode.replace(/\D/g, '')"
              />
            </div>

            <div class="form-field">
              <label>{{ t('share.verifyCode') }}</label>
              <input
                v-model="inputVerifyCode"
                type="text"
                maxlength="6"
                :placeholder="t('share.codePlaceholder')"
                :disabled="loading"
                @input="inputVerifyCode = inputVerifyCode.replace(/\D/g, '')"
              />
            </div>

            <button
              class="btn-primary"
              @click="handleAcceptShare"
              :disabled="loading || !inputShareCode || !inputVerifyCode"
            >
              {{ loading ? t('share.accepting') : t('share.accept') }}
            </button>

            <div class="error-message" v-if="errorMessage">{{ errorMessage }}</div>
            <div class="success-message" v-if="successMessage">{{ successMessage }}</div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { describeShareRemaining, pendingOutgoingShares } from '../composables/shareOutgoing'
import { useShare } from '../composables/useShare'

const props = defineProps({
  visible: { type: Boolean, default: false },
  environments: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'accepted'])

const { t } = useI18n()
const { createShare, acceptShare, listUnclaimedShares, revokeOutgoingShare } = useShare()

const mode = ref('share')
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

// 分享相关
const selectedEnvs = ref([])
const generatedCodes = ref(null)

// 接受相关
const inputShareCode = ref('')
const inputVerifyCode = ref('')

// 已发出、尚未被收下
const pendingRows = ref([])
const sentLoading = ref(false)
const confirmingId = ref('')
watch(confirmingId, async (id) => {
  if (!id) return
  await nextTick()
  document.querySelector('.revoke-confirm')?.scrollIntoView({ block: 'nearest' })
})
const revokingId = ref('')
const nowTick = ref(Date.now())
let remainingTimer = null

const pendingView = computed(() => pendingOutgoingShares(pendingRows.value, nowTick.value))

function stopRemainingTimer() {
  if (remainingTimer) {
    clearInterval(remainingTimer)
    remainingTimer = null
  }
}

function startRemainingTimer() {
  stopRemainingTimer()
  remainingTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
}

function aliasText(item) {
  if (!item.aliases.length) return t('share.sentNoAlias')
  return item.aliases.join(t('share.aliasSeparator'))
}

function remainingText(item) {
  const described = describeShareRemaining(item.remainingMs)
  return t(described.key, described.params)
}

async function loadSent() {
  sentLoading.value = true
  try {
    pendingRows.value = await listUnclaimedShares()
    nowTick.value = Date.now()
  } catch (e) {
    pendingRows.value = []
    errorMessage.value = e.message || t('share.querySharesFailed', { msg: '' })
  } finally {
    sentLoading.value = false
  }
}

// 切换 Tab 时重置
watch(mode, (next) => {
  errorMessage.value = ''
  successMessage.value = ''
  generatedCodes.value = null
  confirmingId.value = ''
  if (next === 'sent') loadSent()
})

watch(
  () => props.visible && mode.value === 'sent',
  (active) => {
    if (active) {
      nowTick.value = Date.now()
      startRemainingTimer()
    } else {
      stopRemainingTimer()
    }
  }
)

onUnmounted(stopRemainingTimer)

// 关闭时重置
watch(() => props.visible, (v) => {
  if (v) {
    selectedEnvs.value = []
    generatedCodes.value = null
    inputShareCode.value = ''
    inputVerifyCode.value = ''
    errorMessage.value = ''
    successMessage.value = ''
    pendingRows.value = []
    confirmingId.value = ''
    revokingId.value = ''
    sentLoading.value = false
    mode.value = 'share'
  } else {
    stopRemainingTimer()
  }
})

const handleClose = () => {
  if (loading.value) return
  emit('close')
}

const handleCreateShare = async () => {
  if (loading.value) return
  if (selectedEnvs.value.length === 0) {
    errorMessage.value = t('share.selectAtLeastOne')
    return
  }

  loading.value = true
  errorMessage.value = ''
  generatedCodes.value = null

  try {
    const result = await createShare(selectedEnvs.value)
    generatedCodes.value = result
  } catch (e) {
    errorMessage.value = e.message || t('share.generateFailed')
  } finally {
    loading.value = false
  }
}

const handleAcceptShare = async () => {
  if (loading.value) return
  if (!inputShareCode.value || inputShareCode.value.length !== 6) {
    errorMessage.value = t('share.shareCodeDigits')
    return
  }
  if (!inputVerifyCode.value || inputVerifyCode.value.length !== 6) {
    errorMessage.value = t('share.verifyCodeDigits')
    return
  }
  if (inputShareCode.value === inputVerifyCode.value) {
    errorMessage.value = t('share.codesMustDiffer')
    return
  }

  loading.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    const result = await acceptShare(inputShareCode.value, inputVerifyCode.value)
    successMessage.value = t('share.acceptSuccess', { count: result.envIds.length })

    // 清空输入
    inputShareCode.value = ''
    inputVerifyCode.value = ''

    // 通知父组件刷新
    emit('accepted')

    // 3 秒后关闭
    setTimeout(() => {
      handleClose()
    }, 2000)
  } catch (e) {
    errorMessage.value = e.message || t('share.acceptFailed')
  } finally {
    loading.value = false
  }
}

const handleRevoke = async (item) => {
  if (!item?.id || revokingId.value) return
  revokingId.value = item.id
  errorMessage.value = ''
  successMessage.value = ''

  try {
    await revokeOutgoingShare(item.id)
    successMessage.value = t('share.revokeSuccess')
    confirmingId.value = ''
    pendingRows.value = pendingRows.value.filter((row) => row.id !== item.id)
  } catch (e) {
    errorMessage.value = e.message || t('share.revokeFailed', { msg: '' })
    try {
      pendingRows.value = await listUnclaimedShares()
      nowTick.value = Date.now()
    } catch {
      // 列表刷新失败时保留原来的错误提示
    }
  } finally {
    revokingId.value = ''
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #fff;
  border-radius: 12px;
  width: 420px;
  max-width: 92vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
}

.modal-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.modal-close {
  border: none;
  background: none;
  font-size: 22px;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  color: #1f2937;
}

.modal-close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.mode-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  background: #f3f4f6;
  border-radius: 8px;
  padding: 4px;
}

.mode-tab {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: 6px;
  font-size: 13px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-tab.active {
  background: #fff;
  color: #1f2937;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.form-hint {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: #f9fafb;
  border-radius: 6px;
}

.env-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  max-height: 240px;
  overflow-y: auto;
}

.env-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.env-item:hover {
  border-color: #3b82f6;
  background: #f0f7ff;
}

.env-item.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.env-item input[type="checkbox"] {
  cursor: pointer;
}

.env-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.env-alias {
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
}

.env-meta {
  display: flex;
  gap: 6px;
  align-items: center;
}

.env-type {
  font-size: 11px;
  color: #6b7280;
  padding: 1px 6px;
  background: #f3f4f6;
  border-radius: 4px;
}

.empty-tip {
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
  padding: 24px 0;
}

.btn-primary {
  width: 100%;
  padding: 10px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.codes-display {
  margin-top: 16px;
  padding: 12px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
}

.code-block {
  margin-bottom: 10px;
}

.code-label {
  font-size: 12px;
  color: #4b5563;
  margin-bottom: 4px;
}

.code-value {
  font-size: 20px;
  font-weight: 700;
  color: #059669;
  letter-spacing: 4px;
  font-family: 'Courier New', monospace;
}

.code-warn {
  font-size: 11px;
  color: #92400e;
  background: #fef3c7;
  padding: 6px 8px;
  border-radius: 4px;
  margin-top: 8px;
  line-height: 1.5;
}

.form-field {
  margin-bottom: 12px;
}

.form-field label {
  display: block;
  font-size: 13px;
  color: #374151;
  margin-bottom: 4px;
}

.form-field input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-field input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.alias-tip {
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
}

.error-message {
  color: #dc2626;
  font-size: 13px;
  margin-top: 10px;
  padding: 8px 10px;
  background: #fef2f2;
  border-radius: 6px;
}

.success-message {
  color: #059669;
  font-size: 13px;
  margin-top: 10px;
  padding: 8px 10px;
  background: #f0fdf4;
  border-radius: 6px;
}

.sent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sent-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
}

.sent-code {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
}

.sent-code-digits {
  font-family: 'Courier New', monospace;
  letter-spacing: 2px;
}

.sent-aliases {
  margin-top: 4px;
  font-size: 12px;
  color: #4b5563;
  word-break: break-word;
}

.sent-remaining {
  margin-top: 4px;
  font-size: 12px;
  color: #0369a1;
}

.sent-remaining.expired {
  color: #b45309;
}

.revoke-confirm {
  margin-top: 8px;
}

.revoke-hint {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #92400e;
}

.sent-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.btn-danger,
.btn-danger-outline,
.btn-ghost {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.btn-danger {
  border: none;
  background: #dc2626;
  color: #fff;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.btn-danger:disabled,
.btn-danger-outline:disabled,
.btn-ghost:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-danger-outline {
  border: 1px solid #fecaca;
  background: #fff;
  color: #dc2626;
}

.btn-danger-outline:hover:not(:disabled) {
  background: #fef2f2;
}

.btn-ghost {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}

.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s;
}

.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
</style>
