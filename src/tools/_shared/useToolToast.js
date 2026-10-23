/**
 * 工具窗口统一 Toast（Apex / SOQL / 后续新工具共用）。
 * 状态提示请用 showToast，不要再写页面内 status-text。
 */
import { onUnmounted, ref } from 'vue'

const DEFAULT_DURATION = {
  success: 2800,
  info: 2800,
  error: 4000
}

export function useToolToast() {
  const toastVisible = ref(false)
  const toastMessage = ref('')
  const toastType = ref('success')
  let timer = null

  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function closeToast() {
    clearTimer()
    toastVisible.value = false
  }

  /**
   * @param {string} message
   * @param {'success'|'error'|'info'} [type='success']
   * @param {{ duration?: number }} [opts] duration<=0 表示不自动关闭
   */
  function showToast(message, type = 'success', opts = {}) {
    const text = String(message ?? '').trim()
    if (!text) return
    clearTimer()
    toastMessage.value = text
    toastType.value = type
    toastVisible.value = true
    const duration = opts.duration ?? DEFAULT_DURATION[type] ?? 2800
    if (duration > 0) {
      timer = setTimeout(() => {
        toastVisible.value = false
        timer = null
      }, duration)
    }
  }

  onUnmounted(closeToast)

  return {
    toastVisible,
    toastMessage,
    toastType,
    showToast,
    closeToast
  }
}
