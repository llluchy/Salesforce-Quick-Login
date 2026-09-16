<template>
  <Transition name="modal">
    <div
      class="modal-overlay"
      v-if="visible"
      @click.self="$emit('close')"
    >
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ group ? t('group.editTitle') : t('group.createTitle') }}</h2>
          <button class="modal-close" type="button" @click="$emit('close')">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('group.name') }}</label>
            <input
              ref="nameInputRef"
              type="text"
              v-model="groupName"
              :placeholder="t('group.namePlaceholder')"
              maxlength="50"
              @keydown.enter.prevent="handleSave"
              @keydown.esc.prevent="$emit('close')"
            />
          </div>
          <p v-if="errorMessage" class="field-error">{{ errorMessage }}</p>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" type="button" @click="$emit('close')">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" type="button" @click="handleSave">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  group: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'save'])

const groupName = ref('')
const errorMessage = ref('')
const nameInputRef = ref(null)

const handleSave = () => {
  const name = groupName.value.trim()
  if (!name) {
    errorMessage.value = t('group.nameRequired')
    nameInputRef.value?.focus()
    return
  }

  errorMessage.value = ''
  emit('save', {
    id: props.group ? props.group.id : null,
    name,
    isVirtual: false,
    collapsed: props.group ? props.group.collapsed : false
  })
}

watch(() => props.visible, (val) => {
  if (val) {
    groupName.value = props.group ? props.group.name : ''
    errorMessage.value = ''
    nextTick(() => {
      nameInputRef.value?.focus()
      nameInputRef.value?.select()
    })
  }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background-color: white;
  border-radius: 8px;
  width: 90%;
  max-width: 300px;
  box-shadow: 0 8px 24px rgba(25, 118, 210, 0.25);
  overflow: hidden;
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

.form-group input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
  background: #ffffff;
}

.form-group input:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.field-error {
  margin: -4px 0 0;
  font-size: 12px;
  color: #c62828;
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
