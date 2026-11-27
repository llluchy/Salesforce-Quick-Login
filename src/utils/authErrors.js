/**
 * 将 Supabase Auth 英文错误转为当前语言可读文案。
 * @param {unknown} error
 * @param {(key: string) => string} translate vue-i18n / 项目 t
 */
export function localizeAuthErrorMessage(error, translate) {
  const t = typeof translate === 'function' ? translate : (k) => k
  const raw = String(error?.message || error || '').trim()
  const code = String(error?.code || '').toLowerCase()
  const lower = raw.toLowerCase()

  if (
    code === 'invalid_credentials' ||
    lower.includes('invalid login credentials')
  ) {
    return t('auth.invalidCredentials')
  }

  if (
    code === 'email_not_confirmed' ||
    lower.includes('email not confirmed')
  ) {
    return t('auth.emailNotConfirmed')
  }

  if (
    code === 'user_already_exists' ||
    lower.includes('user already registered') ||
    lower.includes('already been registered')
  ) {
    return t('auth.emailAlreadyRegistered')
  }

  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    lower.includes('rate limit')
  ) {
    return t('auth.rateLimited')
  }

  // 我们自己 throw 的 Error（已 i18n、通常无 Auth code）原样返回
  if (!error?.code && raw) {
    return raw
  }

  return t('auth.loginFailedGeneric')
}
