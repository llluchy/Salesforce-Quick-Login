<template>
  <Transition name="modal">
    <div class="modal-overlay" v-if="visible">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ t('delete.title') }}</h2>
          <button class="modal-close" @click="$emit('close')">×</button>
        </div>
        
        <div class="modal-body">
          <div class="delete-warning">
            <span class="warning-icon">⚠️</span>
            <p>{{ t('delete.confirmBefore') }} <strong>{{ name }}</strong> {{ t('delete.confirmAfter') }}</p>
            <p v-if="type === 'group'" class="warning-hint">
              {{ t('delete.groupHint', { ungrouped: t('group.ungrouped') }) }}
            </p>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="$emit('close')">{{ t('common.cancel') }}</button>
          <button class="btn btn-danger" @click="$emit('confirm')">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    default: 'env',
    validator: (value) => ['env', 'group'].includes(value)
  },
  name: {
    type: String,
    default: ''
  }
})

defineEmits(['close', 'confirm'])
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
  max-width: 360px;
  box-shadow: 0 4px 20px rgba(25, 118, 210, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
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

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.85);
}

.modal-close:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.modal-body {
  padding: 20px 16px;
  background: #f5f9ff;
}

.delete-warning {
  text-align: center;
}

.warning-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
}

.delete-warning p {
  margin: 0 0 8px 0;
  color: #333;
  font-size: 14px;
}

.warning-hint {
  font-size: 12px !important;
  color: #1976d2 !important;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
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

.btn-secondary {
  background-color: #e3f2fd;
  color: #0d47a1;
  border: 1px solid #bbdefb;
}

.btn-secondary:hover {
  background-color: #bbdefb;
}

.btn-danger {
  background-color: #dc3545;
  color: white;
}

.btn-danger:hover {
  background-color: #c82333;
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