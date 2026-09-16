<template>
  <div class="locale-switcher" :class="[`is-${variant}`]" ref="rootRef">
    <button
      type="button"
      class="locale-trigger"
      :title="t('locale.label')"
      :aria-label="t('locale.label')"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <span class="locale-flag" aria-hidden="true">{{ currentOption.flag }}</span>
      <span class="locale-abbr">{{ currentOption.abbr }}</span>
    </button>

    <Transition name="locale-pop">
      <div v-if="open" class="locale-pop" role="dialog" :aria-label="t('locale.label')">
        <div class="locale-pop-title">{{ t('locale.label') }}</div>
        <button
          v-for="opt in options"
          :key="opt.code"
          type="button"
          class="locale-option"
          :class="{ active: effectiveLocale === opt.code }"
          @click="select(opt.code)"
        >
          <span class="locale-flag">{{ opt.flag }}</span>
          <span class="locale-text">{{ opt.label }}</span>
          <span v-if="effectiveLocale === opt.code" class="locale-check" aria-hidden="true">✓</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  detectBrowserLocale,
  getLocalePreference,
  LOCALE_PREF_SYSTEM,
  SUPPORTED_LOCALES,
  setLocalePreference
} from '../i18n'

defineProps({
  /** light: 登录页浅色底；dark: 蓝色工具栏 */
  variant: {
    type: String,
    default: 'light',
    validator: (v) => ['light', 'dark'].includes(v)
  }
})

const { t, locale } = useI18n()
const open = ref(false)
const rootRef = ref(null)
const preference = ref(LOCALE_PREF_SYSTEM)

const options = computed(() => [
  { code: 'zh-CN', flag: '🇨🇳', abbr: '中', label: t('locale.zhCN') },
  { code: 'en', flag: '🇺🇸', abbr: 'EN', label: t('locale.en') },
  { code: 'ja', flag: '🇯🇵', abbr: '日', label: t('locale.ja') }
])

const effectiveLocale = computed(() => {
  const pref = preference.value
  if (pref === LOCALE_PREF_SYSTEM || !SUPPORTED_LOCALES.includes(pref)) {
    return locale.value || detectBrowserLocale()
  }
  return pref
})

const currentOption = computed(() => {
  return options.value.find((o) => o.code === effectiveLocale.value) || options.value[0]
})

async function refreshPreference() {
  preference.value = await getLocalePreference()
}

function toggle() {
  open.value = !open.value
}

async function select(code) {
  preference.value = code
  await setLocalePreference(code)
  open.value = false
}

function onDocPointerDown(e) {
  if (!open.value) return
  const el = rootRef.value
  if (el && !el.contains(e.target)) open.value = false
}

onMounted(async () => {
  await refreshPreference()
  document.addEventListener('pointerdown', onDocPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
})
</script>

<style scoped>
.locale-switcher {
  position: relative;
  z-index: 20;
}

.locale-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  opacity: 0.78;
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
}

.locale-trigger:hover {
  opacity: 1;
}

.locale-abbr {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.2px;
}

.is-light .locale-trigger {
  border-color: rgba(25, 118, 210, 0.18);
  background: rgba(255, 255, 255, 0.7);
  color: #0d47a1;
}

.is-light .locale-trigger:hover {
  background: #fff;
  border-color: rgba(25, 118, 210, 0.35);
}

.is-light .locale-abbr {
  color: #0d47a1;
}

.is-dark .locale-trigger {
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.is-dark .locale-trigger:hover {
  background: rgba(255, 255, 255, 0.22);
}

.is-dark .locale-abbr {
  color: #fff;
}

.locale-flag {
  font-size: 14px;
  line-height: 1;
}

.locale-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 9999;
  min-width: 148px;
  padding: 8px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #bbdefb;
  box-shadow: 0 8px 24px rgba(13, 71, 161, 0.18);
}

.locale-pop-title {
  font-size: 11px;
  font-weight: 600;
  color: #5c7a9b;
  padding: 2px 6px 8px;
  letter-spacing: 0.2px;
}

.locale-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: #0d47a1;
  font-size: 13px;
  transition: background 0.12s;
}

.locale-option:hover {
  background: #e3f2fd;
}

.locale-option.active {
  background: #e8f1fb;
  font-weight: 600;
}

.locale-text {
  flex: 1;
}

.locale-check {
  font-size: 12px;
  color: #1976d2;
}

.locale-pop-enter-active,
.locale-pop-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.locale-pop-enter-from,
.locale-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
