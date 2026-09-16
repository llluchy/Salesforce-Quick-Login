import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN.json'
import en from './locales/en.json'
import ja from './locales/ja.json'

export const LOCALE_STORAGE_KEY = 'ui_locale'
export const SUPPORTED_LOCALES = ['zh-CN', 'en', 'ja']
export const DEFAULT_LOCALE = 'zh-CN'
/** Preference: follow browser, or a fixed locale */
export const LOCALE_PREF_SYSTEM = 'system'

const UNGROUPED_NAMES = new Set(['未选择分组', 'Ungrouped', '未分類'])

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    'zh-CN': zhCN,
    en,
    ja
  }
})

/** Translate outside setup() (composables, App script). */
export function t(key, ...args) {
  return i18n.global.t(key, ...args)
}

export function getLocalePreference() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([LOCALE_STORAGE_KEY], (result) => {
        resolve(result[LOCALE_STORAGE_KEY] || LOCALE_PREF_SYSTEM)
      })
    } catch {
      resolve(LOCALE_PREF_SYSTEM)
    }
  })
}

export function mapBrowserLanguage(lang) {
  if (!lang) return DEFAULT_LOCALE
  const lower = String(lang).toLowerCase().replace('_', '-')
  if (lower.startsWith('zh')) return 'zh-CN'
  if (lower.startsWith('ja')) return 'ja'
  if (lower.startsWith('en')) return 'en'
  return DEFAULT_LOCALE
}

export function detectBrowserLocale() {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
      return mapBrowserLanguage(chrome.i18n.getUILanguage())
    }
  } catch {
    /* ignore */
  }
  if (typeof navigator !== 'undefined') {
    return mapBrowserLanguage(navigator.language || navigator.languages?.[0])
  }
  return DEFAULT_LOCALE
}

export function applyDocumentLang(locale) {
  if (typeof document !== 'undefined') {
    const lang =
      locale === 'zh-CN' ? 'zh-CN' : locale === 'ja' ? 'ja' : 'en'
    document.documentElement.lang = lang
  }
}

/**
 * Resolve effective locale from preference and apply to vue-i18n.
 * @returns {Promise<{ preference: string, locale: string }>}
 */
export async function resolveLocale() {
  const preference = await getLocalePreference()
  const locale =
    preference === LOCALE_PREF_SYSTEM || !SUPPORTED_LOCALES.includes(preference)
      ? detectBrowserLocale()
      : preference
  i18n.global.locale.value = locale
  applyDocumentLang(locale)
  return { preference, locale }
}

/**
 * Persist preference and apply. preference: 'system' | 'zh-CN' | 'en' | 'ja'
 */
export async function setLocalePreference(preference) {
  const pref = preference || LOCALE_PREF_SYSTEM
  try {
    await chrome.storage.local.set({ [LOCALE_STORAGE_KEY]: pref })
  } catch {
    /* ignore */
  }
  const locale =
    pref === LOCALE_PREF_SYSTEM || !SUPPORTED_LOCALES.includes(pref)
      ? detectBrowserLocale()
      : pref
  i18n.global.locale.value = locale
  applyDocumentLang(locale)
  return { preference: pref, locale }
}

/** Display label for group names; maps stored default ungrouped name. */
export function displayGroupName(name) {
  if (!name || UNGROUPED_NAMES.has(name)) return t('group.ungrouped')
  return name
}

export function isUngroupedName(name) {
  return !name || UNGROUPED_NAMES.has(name)
}
