import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { localizeAuthErrorMessage } from './authErrors.js'

const catalog = {
  'auth.invalidCredentials': '邮箱或密码不正确',
  'auth.emailNotConfirmed': '请先完成邮箱验证',
  'auth.emailAlreadyRegistered': '该邮箱已注册',
  'auth.rateLimited': '操作太频繁',
  'auth.loginFailedGeneric': '登录失败'
}

function t(key) {
  return catalog[key] || key
}

describe('localizeAuthErrorMessage', () => {
  it('maps Invalid login credentials by message and code', () => {
    assert.equal(
      localizeAuthErrorMessage({ message: 'Invalid login credentials' }, t),
      '邮箱或密码不正确'
    )
    assert.equal(
      localizeAuthErrorMessage({ code: 'invalid_credentials', message: 'x' }, t),
      '邮箱或密码不正确'
    )
  })

  it('maps other common auth API errors', () => {
    assert.equal(
      localizeAuthErrorMessage({ message: 'Email not confirmed' }, t),
      '请先完成邮箱验证'
    )
    assert.equal(
      localizeAuthErrorMessage({ message: 'User already registered' }, t),
      '该邮箱已注册'
    )
    assert.equal(
      localizeAuthErrorMessage({ code: 'over_request_rate_limit', message: 'x' }, t),
      '操作太频繁'
    )
  })

  it('keeps already-localized app errors without Auth code', () => {
    assert.equal(
      localizeAuthErrorMessage(new Error('请输入邮箱'), t),
      '请输入邮箱'
    )
  })

  it('falls back to generic for unknown Auth API errors', () => {
    assert.equal(
      localizeAuthErrorMessage({ code: 'unexpected_failure', message: 'Boom' }, t),
      '登录失败'
    )
  })
})
