<template>
  <div class="settings-gear" :class="`is-${variant}`">
    <button
      type="button"
      class="settings-gear-btn"
      :title="t('settings.open')"
      :aria-label="t('settings.open')"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="dialog"
      @click="open = true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>

    <Transition name="settings-modal">
      <div v-if="open" class="settings-overlay" @click.self="open = false">
        <div
          class="settings-modal"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
        >
          <div class="settings-header">
            <h2 :id="titleId">{{ t('settings.title') }}</h2>
            <button
              ref="closeBtn"
              type="button"
              class="settings-close"
              :aria-label="t('common.close')"
              @click="open = false"
            >×</button>
          </div>
          <div class="settings-body">
            <ToolFloatToggle variant="modal" />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolFloatToggle from './ToolFloatToggle.vue'

defineProps({
  variant: {
    type: String,
    default: 'light',
    validator: (value) => ['light', 'action'].includes(value)
  }
})

const { t } = useI18n()
const open = ref(false)
const closeBtn = ref(null)
const titleId = 'settings-dialog-title'

function onKeydown(event) {
  if (event.key === 'Escape' && open.value) open.value = false
}

watch(open, async (value) => {
  if (!value) return
  await nextTick()
  closeBtn.value?.focus()
})

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.settings-gear {
  display: inline-flex;
  align-items: center;
}

.settings-gear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
}

.settings-gear-btn svg {
  width: 16px;
  height: 16px;
}

.settings-gear-btn:focus-visible {
  outline: 2px solid #1976d2;
  outline-offset: 2px;
}

.is-light .settings-gear-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(25, 118, 210, 0.18);
  background: rgba(255, 255, 255, 0.7);
  color: #0d47a1;
  opacity: 0.78;
}

.is-light .settings-gear-btn:hover {
  opacity: 1;
  background: #fff;
  border-color: rgba(25, 118, 210, 0.35);
}

.is-action .settings-gear-btn {
  box-sizing: border-box;
  min-width: 28px;
  padding: 4px 10px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  background: #ffffff;
  color: #0d47a1;
}

.is-action .settings-gear-btn svg {
  width: 14px;
  height: 14px;
}

.is-action .settings-gear-btn:hover {
  background: #bbdefb;
  border-color: #1976d2;
}

.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  background: rgba(13, 71, 161, 0.4);
}

.settings-modal {
  width: 100%;
  max-width: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: #fff;
}

.settings-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.settings-close {
  padding: 0;
  border: none;
  background: none;
  color: #fff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.settings-close:hover {
  color: #fff;
}

.settings-body {
  padding: 14px 16px 16px;
  background: #f5f9ff;
}

.settings-modal-enter-active,
.settings-modal-leave-active {
  transition: opacity 0.2s;
}

.settings-modal-enter-from,
.settings-modal-leave-to {
  opacity: 0;
}
</style>
