// 扩展面板里的日志、查询、对象搜索。与页面浮动栏开关无关，不读写它的保存位置。

import { isSalesforceUrl } from '../tools/_shared/sfSessionBg.js'

/** 与 manifest content_scripts 的主机一致：只有这些页面能打开对象搜索。 */
const OBJECT_SEARCH_SUFFIXES = ['salesforce.com', 'force.com', 'cloudforce.com', 'my.site.com']

export const PANEL_WINDOW_TOOLS = ['apex-log', 'soql']

export function isObjectSearchPage(url) {
  if (!url || !/^https:\/\//i.test(url)) return false
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (!host) return false
  return OBJECT_SEARCH_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`))
}

/** 当前标签是 Salesforce 页面时带上主机名，工具窗口仍用这台浏览器里的会话。 */
export function pageHostname(tab) {
  const url = tab?.url || ''
  if (!isSalesforceUrl(url)) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function canOpenObjectSearch(tab) {
  return Number.isInteger(tab?.id) && tab.id >= 0 && isObjectSearchPage(tab.url)
}

/**
 * 面板点击一个工具后该做什么。不看扩展账号是否登录，也不看浮动栏开关。
 * @returns {{ type: 'open-window', toolId: string, hostname: string }
 *   | { type: 'open-object-search', tabId: number }
 *   | { type: 'need-salesforce-page' }
 *   | { type: 'unknown' }}
 */
export function planPanelToolOpen(toolId, tab) {
  if (PANEL_WINDOW_TOOLS.includes(toolId)) {
    return {
      type: 'open-window',
      toolId,
      hostname: pageHostname(tab)
    }
  }
  if (toolId === 'object-search') {
    if (!canOpenObjectSearch(tab)) return { type: 'need-salesforce-page' }
    return { type: 'open-object-search', tabId: tab.id }
  }
  return { type: 'unknown' }
}

export function openToolWindowMessage(toolId, hostname) {
  return {
    action: 'openToolWindow',
    toolId,
    hostname: hostname || ''
  }
}

export function openObjectSearchMessage() {
  return { action: 'openObjectSearch' }
}
