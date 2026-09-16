<template>
  <div class="group-header" @click="$emit('toggle')">
    <div class="group-header-left">
      <div class="group-drag-handle">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><circle cx="4" cy="3" r="1.5"/><circle cx="12" cy="3" r="1.5"/><circle cx="4" cy="8" r="1.5"/><circle cx="12" cy="8" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="13" r="1.5"/></svg>
      </div>
      <button class="collapse-btn" :class="{ collapsed: group.collapsed }">
        <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      <span class="group-name">{{ displayName }}</span>
      <span class="group-count">({{ count }})</span>
    </div>
    <div class="group-header-right" v-if="!group.isVirtual">
      <button class="group-action-btn" :title="t('group.editTitleAttr')" @click.stop="$emit('edit')">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3z"/></svg>
      </button>
      <button class="group-action-btn" :title="t('group.deleteTitleAttr')" @click.stop="$emit('delete')">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { isUngroupedName } from '../i18n'

const props = defineProps({
  group: {
    type: Object,
    required: true
  },
  count: {
    type: Number,
    default: 0
  }
})

const { t } = useI18n()
const displayName = computed(() =>
  isUngroupedName(props.group?.name) ? t('group.ungrouped') : props.group.name
)

defineEmits(['toggle', 'edit', 'delete'])
</script>

<style scoped>
.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: linear-gradient(135deg, #2196f3 0%, #1976d2 100%);
  color: #ffffff;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  transition: background 0.15s;
}

.group-header:hover {
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
}

.group-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.group-drag-handle {
  cursor: grab;
  padding: 2px;
  opacity: 0.4;
  transition: opacity 0.15s;
  display: flex;
}

.group-header:hover .group-drag-handle {
  opacity: 0.8;
}

.group-drag-handle:active {
  cursor: grabbing;
}

.collapse-btn {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
  display: flex;
  transition: transform 0.2s;
}

.collapse-btn.collapsed {
  transform: rotate(-90deg);
}

.group-name {
  font-weight: 600;
  font-size: 13px;
}

.group-count {
  font-size: 11px;
  opacity: 0.6;
}

.group-header-right {
  display: flex;
  gap: 2px;
}

.group-action-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  padding: 4px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.15s;
  display: flex;
  color: inherit;
}

.group-action-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}
</style>
