import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN.json'
import en from './locales/en.json'
import ja from './locales/ja.json'
import {
  DEFAULT_LOCALE,
  LOCALE_PREF_SYSTEM,
  SUPPORTED_LOCALES,
  effectiveLocale
} from '../utils/localePref.js'

export { DEFAULT_LOCALE, LOCALE_PREF_SYSTEM, SUPPORTED_LOCALES }

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
 * 已登录读账号上的语言；未登录只读本次浏览器会话。不读 local / sync。
 * @returns {Promise<{ ok?: boolean, preference: string, locale: string }>}
 */
export async function resolveLocale() {
  const { refreshLocale } = await import('../composables/useLocale.js')
  return refreshLocale()
}

/** preference: 'system' | 'zh-CN' | 'en' | 'ja'。保存失败时界面停在上次成功的语言。 */
export async function setLocalePreference(preference) {
  const { setLocale } = await import('../composables/useLocale.js')
  const result = await setLocale(preference)
  const pref = result?.preference || LOCALE_PREF_SYSTEM
  return {
    ok: result?.ok === true,
    preference: pref,
    locale: effectiveLocale(pref, detectBrowserLocale())
  }
}

export async function getLocalePreference() {
  const { getLocale } = await import('../composables/useLocale.js')
  return getLocale()
}

/** Display label for group names; maps stored default ungrouped name. */
export function displayGroupName(name) {
  if (!name || UNGROUPED_NAMES.has(name)) return t('group.ungrouped')
  return name
}

export function isUngroupedName(name) {
  return !name || UNGROUPED_NAMES.has(name)
}
