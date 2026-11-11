<template>
  <section class="panel-tools" :class="`panel-tools-${variant}`">
    <div class="panel-tools-row">
      <button
        v-for="tool in tools"
        :key="tool.id"
        type="button"
        class="panel-tool"
        :style="buttonStyle(tool.id)"
        :title="t(tool.titleKey)"
        :aria-label="t(tool.titleKey)"
        :disabled="busy"
        @click="openTool(tool.id)"
      >
        {{ t(tool.labelKey) }}
      </button>
    </div>
    <p v-if="notice" class="panel-tools-notice" role="status">{{ notice }}</p>
  </section>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getToolTheme } from '../tools/_shared/toolThemes.js'
import {
  openObjectSearchMessage,
  openToolWindowMessage,
  planPanelToolOpen
} from '../utils/panelTools.js'

defineProps({
  variant: {
    type: String,
    default: 'app'
  }
})

const { t } = useI18n()
const notice = ref('')
const busy = ref(false)

const tools = [
  { id: 'apex-log', labelKey: 'toolsHub.log', titleKey: 'toolsHub.logTitle' },
  { id: 'soql', labelKey: 'toolsHub.query', titleKey: 'toolsHub.queryTitle' },
  { id: 'object-search', labelKey: 'toolsHub.object', titleKey: 'toolsHub.objectTitle' }
]

function buttonStyle(id) {
  const theme = getToolTheme(id)
  return {
    background: theme.soft,
    color: theme.accentDeep,
    borderColor: theme.border
  }
}

function queryActiveTab() {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
        resolve(null)
        return
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) {
          resolve(null)
          return
        }
        resolve(tabs?.[0] || null)
      })
    } catch {
      resolve(null)
    }
  })
}

function sendRuntime(payload) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        resolve({ success: false })
        return
      }
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message })
          return
        }
        resolve(response || { success: false })
      })
    } catch (error) {
      resolve({ success: false, error: error?.message || String(error) })
    }
  })
}

function sendToTab(tabId, payload) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
        resolve({ success: false })
        return
      }
      chrome.tabs.sendMessage(tabId, payload, { frameId: 0 }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message })
          return
        }
        resolve(response || { success: false })
      })
    } catch (error) {
      resolve({ success: false, error: error?.message || String(error) })
    }
  })
}

async function openTool(toolId) {
  if (busy.value) return
  busy.value = true
  notice.value = ''
  try {
    const tab = await queryActiveTab()
    const plan = planPanelToolOpen(toolId, tab)
    if (plan.type === 'need-salesforce-page') {
      notice.value = t('toolsHub.openPageFirst')
      return
    }
    if (plan.type === 'open-window') {
      const res = await sendRuntime(openToolWindowMessage(plan.toolId, plan.hostname))
      if (!res?.success) notice.value = t('toolsHub.openFailed')
      return
    }
    if (plan.type === 'open-object-search') {
      const res = await sendToTab(plan.tabId, openObjectSearchMessage())
      if (!res?.success) notice.value = t('toolsHub.openFailed')
      return
    }
    notice.value = t('toolsHub.openFailed')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.panel-tools {
  box-sizing: border-box;
  background: #ffffff;
  padding: 8px;
}

.panel-tools-app {
}

.panel-tools-auth {
  width: 100%;
  max-width: 360px;
  margin: 0 0 14px;
}

.panel-tools-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.panel-tool {
  min-width: 0;
  padding: 8px 4px;
  border: 1px solid;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
}

.panel-tool:hover:not(:disabled) {
  filter: brightness(0.97);
}

.panel-tool:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.panel-tool:focus-visible {
  outline: 2px solid #1976d2;
  outline-offset: 2px;
}

.panel-tools-notice {
  margin: 8px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: #f3e5f5;
  color: #4a148c;
  font-size: 11px;
  line-height: 1.4;
}
</style>
