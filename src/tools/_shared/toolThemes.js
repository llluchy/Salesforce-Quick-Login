/**
 * 工具窗口 / 浮动入口主题色（单一数据源）。
 * CSS 见同目录 toolThemes.css（.theme-soql / .theme-object / .theme-apex）。
 *
 * 用法：
 *   import { TOOL_THEMES, getToolTheme } from './toolThemes.js'
 *   getToolTheme('soql').accent
 *   el.style.setProperty('--accent', getToolTheme('soql').accent)
 */

/** @typedef {'apex' | 'soql' | 'object'} ToolThemeId */

/**
 * @typedef {object} ToolTheme
 * @property {string} id
 * @property {string} accent
 * @property {string} accent2
 * @property {string} accentDeep
 * @property {string} page
 * @property {string} card
 * @property {string} border
 * @property {string} borderHover
 * @property {string} soft
 * @property {string} panel
 * @property {string} text
 * @property {string} muted
 * @property {string} titleOnHeader
 * @property {string} softTint
 * @property {string} accentRgb  e.g. "239, 108, 0"
 * @property {string} railGradient
 * @property {string} railBorder
 * @property {string} railText
 */

/** @type {Record<ToolThemeId, ToolTheme>} */
export const TOOL_THEMES = {
  /** Apex Log — 蓝，对齐浮动栏 .apex */
  apex: {
    id: 'apex',
    accent: '#0277bd',
    accent2: '#01579b',
    accentDeep: '#014f86',
    page: '#eef5fc',
    card: '#ffffff',
    border: '#90caf9',
    borderHover: '#64b5f6',
    soft: '#e3f2fd',
    panel: '#f5f9ff',
    text: '#333333',
    muted: '#607d8b',
    titleOnHeader: '#e1f5fe',
    softTint: '#fafcff',
    accentRgb: '2, 119, 189',
    railGradient: 'linear-gradient(180deg, #0277bd 0%, #01579b 100%)',
    railBorder: '#4fc3f7',
    railText: '#e1f5fe'
  },
  /** SOQL — 橙黄，对齐浮动栏 .soql */
  soql: {
    id: 'soql',
    accent: '#f9a825',
    accent2: '#ef6c00',
    accentDeep: '#e65100',
    page: '#fff8e1',
    card: '#ffffff',
    border: '#ffe082',
    borderHover: '#ffcc80',
    soft: '#ffecb3',
    panel: '#fffde7',
    text: '#333333',
    muted: '#8d6e63',
    titleOnHeader: '#fffde7',
    softTint: '#fffbf0',
    accentRgb: '239, 108, 0',
    railGradient: 'linear-gradient(180deg, #f9a825 0%, #ef6c00 100%)',
    railBorder: '#ffe082',
    railText: '#fff8e1'
  },
  /** Object Detail / 对象搜索 — 淡紫 */
  object: {
    id: 'object',
    accent: '#9575cd',
    accent2: '#7e57c2',
    accentDeep: '#5e35b1',
    page: '#f7f3fb',
    card: '#ffffff',
    border: '#d1c4e9',
    borderHover: '#b39ddb',
    soft: '#ede7f6',
    panel: '#faf5ff',
    text: '#333333',
    muted: '#7e6b9a',
    titleOnHeader: '#f3e5f5',
    softTint: '#faf7fc',
    accentRgb: '126, 87, 194',
    railGradient: 'linear-gradient(180deg, #9575cd 0%, #5e35b1 100%)',
    railBorder: '#b39ddb',
    railText: '#f3e5f5'
  }
}

/**
 * @param {string} id
 * @returns {ToolTheme}
 */
export function getToolTheme(id) {
  if (id === 'object-detail' || id === 'object-search') return TOOL_THEMES.object
  if (id === 'soql') return TOOL_THEMES.soql
  if (id === 'apex-log' || id === 'apex') return TOOL_THEMES.apex
  return TOOL_THEMES.apex
}

/**
 * 把主题写入元素（或 :root）的 CSS 变量，便于非 .theme-* 场景直接调用。
 * @param {ToolThemeId | string} themeId
 * @param {HTMLElement | CSSStyleDeclaration} [target=document.documentElement]
 */
export function applyToolThemeVars(themeId, target = document.documentElement) {
  const theme = getToolTheme(themeId)
  const style = target instanceof CSSStyleDeclaration ? target : target.style
  style.setProperty('--accent', theme.accent)
  style.setProperty('--accent-2', theme.accent2)
  style.setProperty('--accent-deep', theme.accentDeep)
  style.setProperty('--page', theme.page)
  style.setProperty('--card', theme.card)
  style.setProperty('--border', theme.border)
  style.setProperty('--border-hover', theme.borderHover)
  style.setProperty('--soft', theme.soft)
  style.setProperty('--panel', theme.panel)
  style.setProperty('--text', theme.text)
  style.setProperty('--muted', theme.muted)
  style.setProperty('--title-on-header', theme.titleOnHeader)
  style.setProperty('--soft-tint', theme.softTint)
  style.setProperty('--accent-rgb', theme.accentRgb)
  style.setProperty('--shadow', `0 2px 8px rgba(${theme.accentRgb}, 0.10)`)
  style.setProperty('--header-shadow', `0 2px 8px rgba(${theme.accentRgb}, 0.28)`)
  style.setProperty('--card-shadow', `0 8px 24px rgba(${theme.accentRgb}, 0.12)`)
  style.setProperty('--focus-ring', `0 0 0 2px rgba(${theme.accentRgb}, 0.22)`)
  return theme
}
