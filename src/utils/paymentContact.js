// 纠纷 / Webhook 延迟 / 改选诉求：UI 凡联系处同时展示这两个邮箱（已锁定）。

export const PAYMENT_CONTACT_EMAILS = Object.freeze([
  'llluchy@outlook.com',
  'llluchy@qq.com'
])

export function mailtoHref(email) {
  return `mailto:${email}`
}
