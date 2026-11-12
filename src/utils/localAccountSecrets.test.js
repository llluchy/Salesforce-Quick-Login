import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CRYPTO_KEY_STORAGE_KEY,
  LEGACY_PASSKEY_STORAGE_KEY,
  LOCAL_ACCOUNT_SECRET_KEYS,
  LOCAL_KEYS_KEPT_ON_LOGOUT,
  SESSION_ACCOUNT_SECRET_KEYS,
  SESSION_KEYS_KEPT_ON_LOGOUT,
  clearLocalAccountSecrets
} from './localAccountSecrets.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function pick(data, keys) {
  if (keys == null) return { ...data }
  const list = Array.isArray(keys) ? keys : [keys]
  const out = {}
  for (const key of list) {
    if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key]
  }
  return out
}

function createMemoryArea(initial = {}) {
  const data = { ...initial }
  return {
    data,
    async get(keys) {
      return pick(data, keys)
    },
    async set(obj) {
      Object.assign(data, obj)
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const key of list) delete data[key]
    }
  }
}

function sampleLocal() {
  return {
    salesforce_environments: [{
      id: 'env-1',
      alias: '生产',
      username: 'user@example.com',
      password: 'sf-password',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      passkeys: [{ credentialId: 'pk-1', privateKeyJwk: { k: 'pk-priv' } }],
      lastSfHostname: 'org.my.salesforce.com',
      lastSfOrgId: '00D000000000001'
    }],
    salesforce_groups: [{ id: 'group-1', name: '工作' }],
    [LEGACY_PASSKEY_STORAGE_KEY]: [{ credentialId: 'legacy-pk', privateKeyJwk: { k: 'legacy' } }],
    [CRYPTO_KEY_STORAGE_KEY]: { k: 'master-key', kty: 'oct' },
    __sf_supabase_session: { access_token: 'access-token', user: { id: 'user-1' } },
    ui_locale: 'ja',
    sfql_tool_float_pos: { top: 80, right: 0 },
    sf_install_id: 'install-1',
    __sf_migrated_to_supabase: true,
    __sf_pwd_unlock_count: 2,
    __sf_pwd_unlock_date: '2026-11-11',
    __sf_last_login_date: '2026-11-11',
    __sf_login_count: 3,
    sfql_apex_environments: { 'org.my.salesforce.com': { username: 'sf-user' } },
    sfql_apex_active_env: 'org.my.salesforce.com',
    sfql_apex_tracked_users: { 'org.my.salesforce.com': ['005xx'] }
  }
}

function sampleSession() {
  return {
    sf_userKeyJwk: { k: 'session-master' },
    sf_isLoggedIn: true,
    sf_environments: [{ id: 'env-1', password: 'sf-password', totpSecret: 'JBSWY3DPEHPK3PXP' }],
    pendingLoginEnv: {
      username: 'user@example.com',
      password: 'sf-password',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      lastSfHostname: 'org.my.salesforce.com'
    },
    sfql_tool_float_session_visible: false,
    ui_locale_session: 'ja',
    sfql_apex_trace_lease: { hostname: 'org.my.salesforce.com', expiresAt: 1 }
  }
}

describe('clearLocalAccountSecrets', () => {
  it('退出后本机不再留有环境账号、密码和验证器', async () => {
    const local = createMemoryArea(sampleLocal())
    const session = createMemoryArea(sampleSession())
    const cookies = [{ name: 'sid', value: 'already-open-site', domain: 'org.my.salesforce.com' }]
    const cookiesBefore = JSON.stringify(cookies)
    const cloud = { deletes: 0, upserts: 0, delete() { cloud.deletes += 1 }, upsert() { cloud.upserts += 1 } }

    await clearLocalAccountSecrets({ local, session })

    for (const key of LOCAL_ACCOUNT_SECRET_KEYS) {
      assert.equal(Object.hasOwn(local.data, key), false, key)
    }
    for (const key of SESSION_ACCOUNT_SECRET_KEYS) {
      assert.equal(Object.hasOwn(session.data, key), false, key)
    }

    const dumped = JSON.stringify({ local: local.data, session: session.data })
    assert.equal(dumped.includes('sf-password'), false)
    assert.equal(dumped.includes('JBSWY3DPEHPK3PXP'), false)
    assert.equal(dumped.includes('user@example.com'), false)
    assert.equal(dumped.includes('pk-priv'), false)
    assert.equal(dumped.includes('master-key'), false)
    assert.equal(dumped.includes('access-token'), false)
    assert.equal(dumped.includes('00D000000000001'), false)
    assert.equal(Object.hasOwn(local.data, 'salesforce_environments'), false)
    assert.equal(local.data.sfql_apex_environments['org.my.salesforce.com'].username, 'sf-user')

    for (const key of LOCAL_KEYS_KEPT_ON_LOGOUT) {
      assert.equal(Object.hasOwn(local.data, key), true, key)
    }
    assert.equal(local.data.ui_locale, 'ja')
    assert.deepEqual(local.data.sfql_tool_float_pos, { top: 80, right: 0 })
    assert.equal(local.data.sf_install_id, 'install-1')
    assert.equal(local.data.__sf_migrated_to_supabase, true)
    assert.deepEqual(local.data.sfql_apex_environments, sampleLocal().sfql_apex_environments)

    for (const key of SESSION_KEYS_KEPT_ON_LOGOUT) {
      assert.deepEqual(session.data[key], sampleSession()[key], key)
    }

    assert.equal(JSON.stringify(cookies), cookiesBefore)
    assert.equal(cloud.deletes, 0)
    assert.equal(cloud.upserts, 0)
  })

  it('已登录的 Salesforce 网站主机不会写进云端环境行', () => {
    const cryptoSrc = readFileSync(resolve(root, 'src/utils/crypto.js'), 'utf8')
    const start = cryptoSrc.indexOf('export async function encryptEnv')
    const end = cryptoSrc.indexOf('export async function decryptEnv')
    assert.ok(start >= 0 && end > start)
    const fn = cryptoSrc.slice(start, end)
    assert.equal(fn.includes('lastSfHostname'), false)
    assert.equal(fn.includes('lastSfOrgId'), false)
    assert.equal(fn.includes('last_sf_hostname'), false)
    assert.equal(fn.includes('last_sf_org_id'), false)
    assert.equal(fn.includes('...env'), false)

    const storageSrc = readFileSync(resolve(root, 'src/composables/useStorage.js'), 'utf8')
    assert.match(storageSrc, /rowsToUpsert\.push\(encrypted\)/)
    assert.match(storageSrc, /\.upsert\(rowsToUpsert/)
    assert.equal(storageSrc.includes('chrome.cookies'), false)
  })
})

describe('退出路径会清本机机密，且不登出已打开的网站', () => {
  it('signOut、设备不匹配和会话结束都会调用清理', () => {
    const authSrc = readFileSync(resolve(root, 'src/composables/useAuth.js'), 'utf8')
    const calls = authSrc.match(/clearLocalAccountSecrets\(/g) || []
    assert.ok(calls.length >= 3, 'signOut、设备码不匹配、SIGNED_OUT 都要清')
    assert.equal(authSrc.includes('chrome.cookies'), false)
    assert.equal(authSrc.includes('cookies.remove'), false)

    const clearer = readFileSync(resolve(root, 'src/utils/localAccountSecrets.js'), 'utf8')
    assert.equal(clearer.includes('chrome.cookies'), false)
    assert.equal(clearer.includes('.from('), false)
    assert.equal(clearer.includes('lastSfHostname'), false)
  })

  it('退出说明覆盖简体中文、英文、日文', () => {
    const zh = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/zh-CN.json'), 'utf8'))
    const en = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/en.json'), 'utf8'))
    const ja = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/ja.json'), 'utf8'))
    const hints = [zh.account.signOutHint, en.account.signOutHint, ja.account.signOutHint]
    assert.equal(new Set(hints).size, 3)
    assert.match(zh.account.signOutHint, /账号/)
    assert.match(zh.account.signOutHint, /密码/)
    assert.match(zh.account.signOutHint, /验证器/)
    assert.match(zh.account.signOutHint, /云端/)
    assert.match(zh.account.signOutHint, /重新登录/)
    assert.match(zh.account.signOutHint, /Salesforce/)
    assert.match(en.account.signOutHint, /passwords/)
    assert.match(en.account.signOutHint, /authenticators/)
    assert.match(en.account.signOutHint, /cloud/)
    assert.match(en.account.signOutHint, /sign in again/)
    assert.match(en.account.signOutHint, /Salesforce/)
    assert.match(ja.account.signOutHint, /パスワード/)
    assert.match(ja.account.signOutHint, /認証器/)
    assert.match(ja.account.signOutHint, /クラウド/)
    assert.match(ja.account.signOutHint, /再ログイン/)
    assert.match(ja.account.signOutHint, /Salesforce/)
  })
})
