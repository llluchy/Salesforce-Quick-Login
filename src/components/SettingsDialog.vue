<template>
  <Transition name="modal">
    <div class="modal-overlay" v-if="visible" @click.self="handleClose">
      <div class="modal-content settings-modal" role="dialog" :aria-label="t('settings.title')">
        <div class="modal-header">
          <h2>{{ t('settings.title') }}</h2>
          <button type="button" class="modal-close" @click="handleClose" :aria-label="t('common.cancel')">×</button>
        </div>

        <div class="modal-body">
          <div class="setting-row">
            <div class="setting-copy">
              <span class="setting-label">{{ t('settings.floatRail') }}</span>
              <span class="setting-hint">{{ t('settings.floatRailHint') }}</span>
            </div>
            <button
              type="button"
              class="setting-switch"
              role="switch"
              :aria-checked="showToolFloat ? 'true' : 'false'"
              :aria-label="t('settings.floatRail')"
              :disabled="saving || !ready || blocked"
              @click="onToggle"
            >
              <span class="setting-knob"></span>
            </button>
          </div>
          <p v-if="errorText" class="setting-error">{{ errorText }}</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isMissingUserMetadataTable, preferenceErrorText, useUserPreferences } from '../composables/useUserPreferences'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const { showToolFloat, saving, loadShowToolFloat, setShowToolFloat } = useUserPreferences()
const errorText = ref('')
const ready = ref(false)
const blocked = ref(false)

function handleClose() {
  emit('close')
}

async function refresh() {
  errorText.value = ''
  blocked.value = false
  ready.value = false
  try {
    await loadShowToolFloat()
  } catch (e) {
    errorText.value = preferenceErrorText(e)
    blocked.value = isMissingUserMetadataTable(e)
  } finally {
    ready.value = true
  }
}

async function onToggle() {
  if (saving.value || !ready.value || blocked.value) return
  errorText.value = ''
  try {
    await setShowToolFloat(!showToolFloat.value)
  } catch (e) {
    errorText.value = preferenceErrorText(e)
    blocked.value = isMissingUserMetadataTable(e)
  }
}

watch(() => props.visible, (open) => {
  if (open) refresh()
})
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

.settings-modal {
  background: white;
  border-radius: 8px;
  width: 100%;
  max-width: 380px;
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

.modal-body {
  padding: 16px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.setting-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-label {
  font-size: 13px;
  font-weight: 600;
  color: #0d47a1;
  line-height: 1.3;
}

.setting-hint {
  font-size: 11px;
  color: #5c6b7a;
  line-height: 1.35;
}

.setting-error {
  margin: 10px 0 0;
  font-size: 11px;
  color: #c62828;
  line-height: 1.4;
}

.setting-switch {
  position: relative;
  flex-shrink: 0;
  width: 36px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: #b0bec5;
  cursor: pointer;
}

.setting-switch[aria-checked='true'] {
  background: #1976d2;
}

.setting-switch:disabled {
  opacity: 0.6;
  cursor: default;
}

.setting-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
}

.setting-switch[aria-checked='true'] .setting-knob {
  transform: translateX(16px);
}
</style>
