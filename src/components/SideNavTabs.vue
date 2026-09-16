<template>
  <div class="side-tabs">
    <button
      type="button"
      :class="['side-tab', { active: modelValue === 'login' }]"
      @click="$emit('update:modelValue', 'login')"
    >
      {{ t('nav.login') }}
    </button>
    <button
      type="button"
      :class="['side-tab', { active: modelValue === 'tools' }]"
      @click="$emit('update:modelValue', 'tools')"
    >
      {{ t('nav.tools') }}
    </button>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

defineProps({
  modelValue: {
    type: String,
    default: 'login'
  }
})

defineEmits(['update:modelValue'])

const { t } = useI18n()
</script>

<style scoped>
.side-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  background: #eef5fc;
  border-bottom: 1px solid #bbdefb;
}

.side-tab {
  flex: 1;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: #5c7a9b;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 10px;
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  transition: all 0.15s;
}

.side-tab:hover {
  color: #0d47a1;
  background: rgba(25, 118, 210, 0.06);
}

.side-tab.active {
  color: #0d47a1;
  background: #fff;
  border-color: #bbdefb;
  box-shadow: 0 -1px 0 #fff;
  position: relative;
  z-index: 1;
  margin-bottom: -1px;
  padding-bottom: 10px;
}
</style>
