<template>
  <Teleport to="body">
    <Transition name="tool-toast">
      <div v-if="visible" class="tool-toast-wrap" role="status" aria-live="polite">
        <div class="tool-toast" :class="`tool-toast--${type}`">
          <span class="tool-toast-icon">{{ icon }}</span>
          <span class="tool-toast-msg">{{ message }}</span>
          <button type="button" class="tool-toast-close" :aria-label="'close'" @click="$emit('close')">×</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  message: { type: String, default: '' },
  type: {
    type: String,
    default: 'success',
    validator: (v) => ['success', 'error', 'info'].includes(v)
  }
})

defineEmits(['close'])

const icon = computed(() => {
  if (props.type === 'error') return '✗'
  if (props.type === 'info') return 'ℹ'
  return '✓'
})
</script>

<style scoped>
.tool-toast-wrap {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10050;
  pointer-events: none;
  max-width: min(520px, calc(100vw - 24px));
}

.tool-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(13, 71, 161, 0.18);
  border: 1px solid transparent;
  font-size: 13px;
  line-height: 1.4;
}

.tool-toast--success {
  background: #e8f5e9;
  border-color: #a5d6a7;
  color: #1b5e20;
}

.tool-toast--error {
  background: #ffebee;
  border-color: #ef9a9a;
  color: #b71c1c;
}

.tool-toast--info {
  background: #e3f2fd;
  border-color: #90caf9;
  color: #0d47a1;
}

.tool-toast-icon {
  flex-shrink: 0;
  font-weight: 700;
  line-height: 1.4;
}

.tool-toast-msg {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.tool-toast-close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0.7;
}

.tool-toast-close:hover {
  opacity: 1;
}

.tool-toast-enter-active,
.tool-toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.tool-toast-enter-from,
.tool-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>
