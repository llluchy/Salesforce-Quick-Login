<template>
  <div class="tool-window">
    <header class="tool-header">
      <div class="tool-header-text">
        <h1>{{ title }}</h1>
        <p>{{ subtitle }}</p>
      </div>
      <span class="tool-badge">{{ t('toolWindow.preview') }}</span>
    </header>

    <main class="tool-body">
      <div class="tool-placeholder">
        <div class="tool-icon-wrap">
          <slot name="icon">
            <svg v-if="toolId === 'apex-log'" viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="8" y="10" width="32" height="28" rx="4"/>
              <path d="M14 18h20M14 24h16M14 30h12"/>
            </svg>
            <svg v-else viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
              <ellipse cx="24" cy="16" rx="14" ry="6"/>
              <path d="M10 16v16c0 3.3 6.3 6 14 6s14-2.7 14-6V16"/>
              <path d="M10 24c0 3.3 6.3 6 14 6s14-2.7 14-6"/>
            </svg>
          </slot>
        </div>
        <h2>{{ title }}</h2>
        <p class="tool-status">{{ statusText }}</p>
        <p class="tool-hint">{{ t('toolWindow.closeHint') }}</p>
      </div>
    </main>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

defineProps({
  toolId: { type: String, default: '' },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  statusText: { type: String, default: '' }
})

const { t } = useI18n()
</script>

<style scoped>
.tool-window {
  --accent: #1976d2;
  --accent-2: #1565c0;
  --page: #eef5fc;
  --border: #bbdefb;
  min-height: 100vh;
  box-sizing: border-box;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--page);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.25);
  color: #fff;
}

.tool-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.tool-header p {
  margin: 4px 0 0;
  font-size: 12px;
  opacity: 0.9;
}

.tool-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  color: #fff;
  background: rgba(255, 255, 255, 0.2);
}

.tool-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-placeholder {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 36px 28px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(25, 118, 210, 0.1);
}

.tool-icon-wrap {
  width: 72px;
  height: 72px;
  margin: 0 auto 16px;
  border-radius: 12px;
  background: #e3f2fd;
  color: var(--accent-2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-placeholder h2 {
  margin: 0 0 10px;
  font-size: 18px;
  color: #0d47a1;
}

.tool-status {
  margin: 0 0 12px;
  font-size: 13px;
  color: #455a64;
  line-height: 1.5;
}

.tool-hint {
  margin: 0;
  font-size: 12px;
  color: #90a4ae;
  line-height: 1.5;
}
</style>
