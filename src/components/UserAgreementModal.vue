<template>
  <Transition name="modal">
    <div
      v-if="visible"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <div class="modal-content">
        <div class="modal-header">
          <h2 :id="titleId">{{ t('userAgreement.title') }}</h2>
        </div>

        <div class="modal-body">
          <p class="body">{{ t('userAgreement.body') }}</p>
          <p v-if="error" class="error" role="alert">{{ t('userAgreement.saveFailed') }}</p>
        </div>

        <div class="modal-footer">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="saving"
            @click="$emit('disagree')"
          >{{ t('userAgreement.disagree') }}</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="saving"
            @click="$emit('agree')"
          >{{ t('userAgreement.agree') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const titleId = 'sfql-user-agreement-title'

defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  saving: {
    type: Boolean,
    default: false
  },
  error: {
    type: [String, Object],
    default: null
  }
})

defineEmits(['agree', 'disagree'])
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1110;
}

.modal-content {
  background-color: white;
  border-radius: 8px;
  width: 92%;
  max-width: 400px;
  max-height: 90vh;
  overflow: auto;
  box-shadow: 0 4px 20px rgba(25, 118, 210, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #bbdefb;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: #ffffff;
}

.modal-header h2 {
  margin: 0;
  font-size: 16px;
  color: #ffffff;
}

.modal-body {
  padding: 16px;
  background: #f5f9ff;
}

.body {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: #334155;
}

.error {
  margin: 12px 0 0;
  font-size: 12px;
  color: #c62828;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  padding: 16px;
  border-top: 1px solid #bbdefb;
  background: #f5f9ff;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background-color: #e3f2fd;
  color: #0d47a1;
  border: 1px solid #bbdefb;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #bbdefb;
}

.btn-primary {
  background-color: #1976d2;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #1565c0;
}

.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.9);
}
</style>
