<template>
  <Transition name="modal">
    <div class="modal-overlay" v-if="visible" @click.self="$emit('close')">
      <div class="modal-content" role="dialog" :aria-label="t('trash.title')">
        <div class="modal-header">
          <h2>{{ t('trash.title') }}</h2>
          <button class="modal-close" type="button" @click="$emit('close')">×</button>
        </div>

        <div class="modal-body">
          <p class="trash-hint">{{ t('trash.hint') }}</p>
          <p class="trash-note">{{ t('trash.expiredHint') }} {{ t('trash.shareUnaffected') }}</p>

          <p v-if="loading" class="trash-status">{{ t('trash.loading') }}</p>
          <p v-else-if="error" class="trash-error">{{ error }}</p>
          <p v-else-if="items.length === 0" class="trash-status">{{ t('trash.empty') }}</p>

          <ul v-else class="trash-list">
            <li v-for="item in items" :key="item.id" class="trash-item">
              <div class="trash-main">
                <div class="trash-alias">{{ item.alias || t('common.unnamed') }}</div>
                <div class="trash-meta">{{ item.username || t('env.noUsername') }}</div>
                <div class="trash-meta">
                  {{ t('trash.groupLabel') }}{{ groupName(item.groupId) }}
                </div>
                <div class="trash-days">{{ t('trash.daysLeft', { days: daysRemaining(item.deletedAt) }) }}</div>
              </div>
              <button
                class="btn-restore"
                type="button"
                :disabled="restoringId === item.id"
                @click="$emit('restore', item.id)"
              >
                {{ restoringId === item.id ? t('trash.restoring') : t('trash.restore') }}
              </button>
            </li>
          </ul>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" type="button" @click="$emit('close')">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { daysRemaining } from '../utils/envTrash'

const { t } = useI18n()

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  items: {
    type: Array,
    default: () => []
  },
  groups: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  restoringId: {
    type: String,
    default: ''
  }
})

defineEmits(['close', 'restore'])

function groupName(groupId) {
  if (!groupId || groupId === 'ungrouped') return t('group.ungrouped')
  const group = props.groups.find((item) => item.id === groupId)
  return group?.name || t('group.ungrouped')
}
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
  max-height: 80vh;
  display: flex;
  flex-direction: column;
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
  padding: 16px;
  background: #f5f9ff;
  overflow: auto;
}

.trash-hint,
.trash-note,
.trash-status,
.trash-error {
  margin: 0 0 8px 0;
  font-size: 12px;
  line-height: 1.5;
}

.trash-hint {
  color: #0d47a1;
}

.trash-note,
.trash-status {
  color: #546e7a;
}

.trash-error {
  color: #c62828;
}

.trash-list {
  list-style: none;
  margin: 8px 0 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trash-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  background: #ffffff;
  border: 1px solid #bbdefb;
  border-radius: 6px;
}

.trash-alias {
  font-size: 13px;
  font-weight: 600;
  color: #0d47a1;
}

.trash-meta,
.trash-days {
  font-size: 12px;
  color: #546e7a;
  margin-top: 2px;
}

.btn-restore {
  flex: 0 0 auto;
  padding: 6px 10px;
  border: 1px solid #1976d2;
  border-radius: 4px;
  background: #e3f2fd;
  color: #0d47a1;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.btn-restore:hover:not(:disabled) {
  background: #bbdefb;
}

.btn-restore:disabled {
  opacity: 0.7;
  cursor: default;
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
}

.btn-secondary {
  background-color: #e3f2fd;
  color: #0d47a1;
  border: 1px solid #bbdefb;
}

.btn-secondary:hover {
  background-color: #bbdefb;
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
