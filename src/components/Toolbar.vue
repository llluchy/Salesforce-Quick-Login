<template>
  <div class="toolbar">
    <div class="toolbar-title-row">
      <h1 class="toolbar-title">{{ t('common.productName') }}</h1>
      <div class="toolbar-right">
        <span class="toolbar-count">{{ envCount }}/{{ maxEnvironments }}</span>
        <LocaleSwitcher variant="dark" />
      </div>
    </div>
  </div>
  <div class="toolbar-actions">
    <button class="btn-action" @click="$emit('add-env')">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="16" height="16" rx="3"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/></svg>
      <span>{{ t('toolbar.addEnv') }}</span>
    </button>
    <button class="btn-action" @click="$emit('add-group')">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6h16v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/><path d="M6 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="9" x2="10" y2="14"/><line x1="7.5" y1="11.5" x2="12.5" y2="11.5"/></svg>
      <span>{{ t('toolbar.addGroup') }}</span>
    </button>
    <button class="btn-action btn-share" @click="$emit('share')" :title="t('toolbar.shareTitle')">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="12" r="2"/><circle cx="14" cy="6" r="2"/><circle cx="14" cy="14" r="2"/><line x1="8" y1="11" x2="12" y2="7"/><line x1="8" y1="13" x2="12" y2="13"/></svg>
      <span>{{ t('toolbar.share') }}</span>
    </button>
    <button class="btn-action btn-account" @click="$emit('account')" :title="t('toolbar.accountTitle')">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="7" r="3"/><path d="M3 17a7 7 0 0114 0"/></svg>
    </button>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from './LocaleSwitcher.vue'

const { t } = useI18n()

defineProps({
  envCount: {
    type: Number,
    default: 0
  },
  maxEnvironments: {
    type: Number,
    default: 50
  },
  accountEmail: {
    type: String,
    default: ''
  }
})

defineEmits(['add-env', 'add-group', 'share', 'account'])
</script>

<style scoped>
.toolbar {
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  padding: 8px 12px;
  box-shadow: 0 2px 6px rgba(25, 118, 210, 0.25);
}

.toolbar-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toolbar-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.3px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-count {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 8px;
  border-radius: 10px;
}

.toolbar-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 12px;
  background: #e3f2fd;
  border-bottom: 1px solid #bbdefb;
  flex-wrap: wrap;
}

.btn-action {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  background: #ffffff;
  color: #0d47a1;
  cursor: pointer;
  transition: all 0.15s;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
}

.btn-action:hover {
  background: #bbdefb;
  border-color: #1976d2;
  color: #0d47a1;
}

.btn-backup {
  border-color: #90caf9;
  color: #1565c0;
}

.btn-backup:hover {
  background: #e3f2fd;
  border-color: #1565c0;
}

.btn-account {
  border-color: #64b5f6;
  color: #0d47a1;
  background: #bbdefb;
}

.btn-account:hover {
  background: #90caf9;
  border-color: #0d47a1;
}

.btn-share {
  border-color: #66bb6a;
  color: #1b5e20;
  background: #c8e6c9;
}

.btn-share:hover {
  background: #a5d6a7;
  border-color: #1b5e20;
}

.btn-manual {
  border-color: #90caf9;
  color: #1565c0;
}

.btn-manual:hover {
  background: #e3f2fd;
  border-color: #1565c0;
}

.account-email-text {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
