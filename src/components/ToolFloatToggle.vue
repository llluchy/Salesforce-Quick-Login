<template>
  <div class="float-toggle" :class="`float-toggle-${variant}`">
    <div class="float-toggle-row">
      <div class="float-toggle-copy">
        <span class="float-toggle-title">{{ t('toolFloat.title') }}</span>
        <span class="float-toggle-hint">{{ t('toolFloat.hint') }}</span>
      </div>
      <button
        type="button"
        class="float-switch"
        role="switch"
        :aria-checked="visible ? 'true' : 'false'"
        :aria-label="t('toolFloat.switchLabel')"
        :disabled="saving || !ready"
        @click="onToggle"
      >
        <span class="float-switch-knob"></span>
      </button>
    </div>
    <p v-if="failed" class="float-toggle-error" role="alert">{{ t('toolFloat.syncFailed') }}</p>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToolFloat } from '../composables/useToolFloat'

defineProps({
  variant: {
    type: String,
    default: 'panel'
  }
})

const { t } = useI18n()
const { visible, failed, saving, ready, refresh, setVisible } = useToolFloat()

onMounted(() => {
  refresh()
})

function onToggle() {
  if (!ready.value || saving.value) return
  setVisible(visible.value !== true)
}
</script>

<style scoped>
.float-toggle {
  box-sizing: border-box;
  border-radius: 8px;
  padding: 8px 10px;
}

.float-toggle-auth {
  width: 100%;
  max-width: 360px;
  margin-bottom: 14px;
  background: #f5f9ff;
  border: 1px solid #bbdefb;
}

.float-toggle-panel {
  margin: 8px 12px 0;
  background: #ffffff;
  border: 1px solid #bbdefb;
}

.float-toggle-modal {
  width: 100%;
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

.float-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.float-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.float-toggle-title {
  font-size: 12px;
  font-weight: 600;
  color: #0d47a1;
}

.float-toggle-hint {
  font-size: 11px;
  line-height: 1.4;
  color: #5c7a9b;
}

.float-switch {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 11px;
  background: #cfd8dc;
  cursor: pointer;
}

.float-switch[aria-checked='true'] {
  background: #1976d2;
}

.float-switch:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.float-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.15s ease;
}

.float-switch[aria-checked='true'] .float-switch-knob {
  transform: translateX(18px);
}

.float-toggle-error {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: #c62828;
}
</style>
