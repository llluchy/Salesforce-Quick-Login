/**
 * 收费门纯函数：各入口（Side Panel / PanelTools / background / content / 工具窗）共用。
 * 开关 OFF 时不挡功能（提醒阶段由 sibling PR 负责）。
 */

export const PAYMENT_GATE_REASONS = Object.freeze({
  ALLOWED: 'allowed',
  LOGIN_REQUIRED: 'login_required',
  PAYMENT_REQUIRED: 'payment_required',
  /** 收费阶段拉取失败：fail-closed */
  UNKNOWN_BLOCKED: 'unknown_blocked'
})

/**
 * @param {{
 *   switchEnabled: boolean | null | undefined,
 *   isAuthed: boolean,
 *   isPaid: boolean,
 *   fetchFailed?: boolean
 * }} input
 * @returns {{
 *   allow: boolean,
 *   reason: string,
 *   requireLogin: boolean,
 *   requirePayment: boolean
 * }}
 */
export function resolvePaymentAccess({
  switchEnabled,
  isAuthed,
  isPaid,
  fetchFailed = false
} = {}) {
  // 提醒阶段：不挡
  if (switchEnabled !== true) {
    return {
      allow: true,
      reason: PAYMENT_GATE_REASONS.ALLOWED,
      requireLogin: false,
      requirePayment: false
    }
  }

  // 收费阶段网络/配置失败：fail-closed
  if (fetchFailed) {
    return {
      allow: false,
      reason: PAYMENT_GATE_REASONS.UNKNOWN_BLOCKED,
      requireLogin: !isAuthed,
      requirePayment: !!isAuthed
    }
  }

  if (!isAuthed) {
    return {
      allow: false,
      reason: PAYMENT_GATE_REASONS.LOGIN_REQUIRED,
      requireLogin: true,
      requirePayment: false
    }
  }

  if (!isPaid) {
    return {
      allow: false,
      reason: PAYMENT_GATE_REASONS.PAYMENT_REQUIRED,
      requireLogin: false,
      requirePayment: true
    }
  }

  return {
    allow: true,
    reason: PAYMENT_GATE_REASONS.ALLOWED,
    requireLogin: false,
    requirePayment: false
  }
}

/**
 * PanelTools / 浮动栏点击前：在发 open 消息前拦截。
 * @returns {'proceed' | 'need-login' | 'need-payment' | 'blocked'}
 */
export function planPaymentToolGate(access) {
  if (!access || access.allow === true) return 'proceed'
  if (access.reason === PAYMENT_GATE_REASONS.LOGIN_REQUIRED) return 'need-login'
  if (access.reason === PAYMENT_GATE_REASONS.PAYMENT_REQUIRED) return 'need-payment'
  return 'blocked'
}
