// ============================================
// 用户认证状态管理
// ============================================
// 职责：
// 1. 注册 / 登录 / 登出 / 修改密码 / 忘记密码
// 2. 派生并持有 AES 主密钥（CryptoKey, non-extractable）
// 3. 同步 Supabase session 到 chrome.storage.local（供 background.js 使用）
// 4. 暴露 currentUser / cryptoKey / isAuthed 响应式状态
// ============================================

import { ref, readonly } from 'vue'
import { getSupabase } from './useSupabase'
import { deriveKey, generateSalt, bytesToBase64, exportKeyToJwk, importKeyFromJwk, getDeviceCode } from '../utils/crypto'
import { STORAGE_KEY_SESSION } from '../utils/constants'
import { WELCOME_PAGE_URL, RECOVERY_PAGE_URL } from '../utils/supabaseConfig'
import { t } from '../i18n'

const CRYPTO_KEY_KEY = '__sf_crypto_key'
const LAST_LOGIN_DATE_KEY = '__sf_last_login_date'
const LOGIN_COUNT_KEY = '__sf_login_count'

const SESSION_KEY_USER_KEY_JWK = 'sf_userKeyJwk'
const SESSION_KEY_LOGGED_IN = 'sf_isLoggedIn'

// ============================================
// 全局单例状态（多个组件共享同一份认证态）
// ============================================
const currentUser = ref(null)        // { id, email }
const cryptoKey = ref(null)          // CryptoKey（AES-256-GCM 主密钥）
const isAuthed = ref(false)
const isLoading = ref(false)
const authError = ref(null)
let _saltBytes = null                // 当前用户的 salt（Uint8Array，内存中）

// 标记是否已初始化 onAuthStateChange 监听
let _listenerInitialized = false

// ============================================
// 每日密码计数器（用于「每日至少输入一次密码」）
// ============================================
const UNLOCK_COUNT_KEY = '__sf_pwd_unlock_count'
const UNLOCK_DATE_KEY = '__sf_pwd_unlock_date'

/**
 * 读取浏览器存储（兼容 chrome.storage.local 和 localStorage）
 */
function getStorage() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return {
      type: 'chrome',
      get: async (keys) => {
        const r = await chrome.storage.local.get(keys)
        return r
      },
      set: async (obj) => {
        await chrome.storage.local.set(obj)
      }
    }
  }
  return {
    type: 'local',
    get: async (keys) => {
      const r = {}
      const keyArr = Array.isArray(keys) ? keys : [keys]
      for (const k of keyArr) {
        const v = localStorage.getItem(k)
        if (v !== null) {
          try { r[k] = JSON.parse(v) } catch { r[k] = v }
        }
      }
      return r
    },
    set: async (obj) => {
      for (const [k, v] of Object.entries(obj)) {
        try { localStorage.setItem(k, JSON.stringify(v)) } catch {}
      }
    }
  }
}

/**
 * 读取每日解锁计数（自动处理跨天重置）
 * @returns {Promise<{count: number, date: string, needPassword: boolean}>}
 */
async function getUnlockStatus() {
  const s = getStorage()
  const r = await s.get([UNLOCK_COUNT_KEY, UNLOCK_DATE_KEY])
  const today = new Date().toISOString().slice(0, 10)
  const lastDate = r[UNLOCK_DATE_KEY] || null
  const lastCount = typeof r[UNLOCK_COUNT_KEY] === 'number' ? r[UNLOCK_COUNT_KEY] : 0

  if (!lastDate) {
    // 第一次使用，无记录
    return { count: 0, date: today, needPassword: true, isFirstTime: true }
  }
  if (lastDate !== today) {
    // 跨天，计数归零
    return { count: 0, date: today, needPassword: true, isFirstTime: false }
  }
  // 同一天
  return {
    count: lastCount,
    date: today,
    needPassword: lastCount <= 0,
    isFirstTime: false
  }
}

/**
 * 密码输入成功时调用：count + 1
 */
async function incrementUnlockCount() {
  const s = getStorage()
  const status = await getUnlockStatus()
  await s.set({
    [UNLOCK_COUNT_KEY]: status.count + 1,
    [UNLOCK_DATE_KEY]: status.date
  })
}

/**
 * 登出时清除解锁记录
 */
async function clearUnlockRecord() {
  const s = getStorage()
  await s.set({
    [UNLOCK_COUNT_KEY]: 0,
    [UNLOCK_DATE_KEY]: ''
  })
}

/**
 * 保存密钥到 chrome.storage.local（导出为 JWK 格式）
 */
async function saveCryptoKey(key) {
  try {
    const jwk = await exportKeyToJwk(key)
    const s = getStorage()
    await s.set({ [CRYPTO_KEY_KEY]: jwk })
    log('密钥已保存到 chrome.storage.local')
  } catch (e) {
    logError('保存密钥失败', e)
  }
}

/**
 * 从 chrome.storage.local 加载密钥（导入为 CryptoKey）
 */
async function loadCryptoKey() {
  try {
    const s = getStorage()
    const r = await s.get([CRYPTO_KEY_KEY])
    if (!r[CRYPTO_KEY_KEY]) {
      log('未找到保存的密钥')
      return null
    }
    const key = await importKeyFromJwk(r[CRYPTO_KEY_KEY])
    log('密钥已从 chrome.storage.local 恢复')
    return key
  } catch (e) {
    logError('加载密钥失败', e)
    return null
  }
}

/**
 * 清除保存的密钥
 */
async function clearCryptoKey() {
  const s = getStorage()
  await s.set({ [CRYPTO_KEY_KEY]: null })
}

/**
 * 导出当前 userKey 到 chrome.storage.session（供 passkeyUI 使用）
 * Side Panel 关闭后 session 仍然存在（内存存储，浏览器关闭才清除）
 */
async function exportUserKeyToSession() {
  if (!cryptoKey.value) {
    return
  }
  try {
    const jwk = await exportKeyToJwk(cryptoKey.value)
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const payload = {
        [SESSION_KEY_USER_KEY_JWK]: jwk,
        [SESSION_KEY_LOGGED_IN]: true
      }
      await chrome.storage.session.set(payload)
      // 验证一下是否存储成功
      const verify = await chrome.storage.session.get([SESSION_KEY_LOGGED_IN, SESSION_KEY_USER_KEY_JWK])
    }
  } catch (e) {
    logError('导出 userKey 到 session 失败', e)
  }
}

/**
 * 清除 session storage 中的 userKey（登出时调用）
 */
async function clearSessionKeys() {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    await chrome.storage.session.remove([
      SESSION_KEY_USER_KEY_JWK,
      SESSION_KEY_LOGGED_IN,
      'sf_environments',
      'pendingLoginEnv'
    ])
    log('session storage 已清除')
  }
}

// ============================================
// 设备码相关（单点登录：一账户一设备）
// ============================================

/**
 * 从数据库读取用户的设备码
 */
async function fetchDeviceCode(userId) {
  const supabase = getSupabase()
  if (!supabase) throw new Error(t('auth.supabaseNotInit'))

  const { data, error } = await supabase
    .from('user_secrets')
    .select('device_code')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    logError('读取设备码失败', error)
    return null
  }
  if (!data || !data.device_code) return null
  return data.device_code
}

/**
 * 更新数据库中的设备码
 */
async function updateDeviceCode(userId, deviceCode) {
  const supabase = getSupabase()
  if (!supabase) throw new Error(t('auth.supabaseNotInit'))

  log('准备更新设备码', { userId, deviceCodePreview: deviceCode.slice(0, 8) + '...' })

  // 尝试 update
  const { data: updateData, error: updateError } = await supabase
    .from('user_secrets')
    .update({ device_code: deviceCode })
    .eq('user_id', userId)
    .select('user_id, device_code')

  if (updateError) {
    logError('update 设备码失败', updateError)
    if (updateError.code === '42703') {
      log('device_code 列不存在，跳过更新')
      return false
    }
    return false
  }
  
  log('update 设备码返回', { updateData })
  
  // update 返回空数组 = RLS 阻止了更新 或 用户记录不存在
  // 不再尝试 upsert（因为 salt 是 NOT NULL，upsert 必然失败）
  if (!updateData || updateData.length === 0) {
    logError('update 设备码未命中任何行（可能 RLS 策略阻止了 UPDATE，或 user_id 不存在）', {
      userId,
      hint: '请在 Supabase 控制台检查 user_secrets 表是否有 UPDATE 策略：CREATE POLICY ... FOR UPDATE USING (auth.uid() = user_id)'
    })
    return false
  }
  
  log('设备码已更新到数据库')
  return true
}

/**
 * 检查当前设备是否匹配
 * @returns {Promise<{matched: boolean, serverDeviceCode: string|null, localDeviceCode: string}>}
 */
async function checkDeviceMatch(userId) {
  const localCode = getDeviceCode()
  const serverCode = await fetchDeviceCode(userId)
  
  // 服务器没有记录设备码（首次登录或旧数据），视为匹配
  if (!serverCode) {
    log('服务器无设备码记录，视为匹配')
    return { matched: true, serverDeviceCode: null, localDeviceCode: localCode }
  }
  
  const matched = serverCode === localCode
  log('设备码检查结果', { matched, localCode: localCode.slice(0, 8) + '...', serverCode: serverCode.slice(0, 8) + '...' })
  return { matched, serverDeviceCode: serverCode, localDeviceCode: localCode }
}

/**
 * 获取今日登录状态
 * @returns {Promise<{needPassword: boolean, count: number}>}
 */
async function getDailyLoginStatus() {
  const s = getStorage()
  const r = await s.get([LAST_LOGIN_DATE_KEY, LOGIN_COUNT_KEY])
  const today = new Date().toISOString().slice(0, 10)
  const lastDate = r[LAST_LOGIN_DATE_KEY] || ''
  const count = typeof r[LOGIN_COUNT_KEY] === 'number' ? r[LOGIN_COUNT_KEY] : 0

  if (lastDate !== today) {
    return { needPassword: true, count: 0, reset: true }
  }
  return { needPassword: count <= 0, count, reset: false }
}

/**
 * 记录登录（count + 1）
 */
async function recordLogin() {
  const s = getStorage()
  const today = new Date().toISOString().slice(0, 10)
  const status = await getDailyLoginStatus()
  await s.set({
    [LAST_LOGIN_DATE_KEY]: today,
    [LOGIN_COUNT_KEY]: status.count + 1
  })
}

// ============================================
// 内部辅助
// ============================================

const TAG = '[Supabase/Auth]'

function log(action, detail) {
}

function logError(action, err) {
}

/**
 * 从 Supabase 拉取用户 salt
 * 若不存在（首次注册后登录）则返回 null
 *
 * 防御性设计：
 * - salt 列应为 TEXT 类型，存储 base64 字符串
 * - 若列被误建为 BYTEA，Supabase 可能返回 hex 格式 \x...，此处做回退解码
 */
async function fetchUserSalt(userId) {
  const supabase = getSupabase()
  if (!supabase) throw new Error(t('auth.supabaseNotInit'))

  const { data, error } = await supabase
    .from('user_secrets')
    .select('salt')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(t('auth.readSaltFailed', { msg: error.message }))
  if (!data || !data.salt) return null

  const raw = data.salt

  // 防御性：检查类型
  if (typeof raw !== 'string') {
    logError('salt 类型异常', { type: typeof raw, value: raw })
    throw new Error(
      `salt 类型异常：期望字符串，实际为 ${typeof raw}。` +
      '请在 Supabase 控制台检查 user_secrets 表的 salt 列类型是否为 TEXT。'
    )
  }

  // 尝试 1：标准 base64 解码（TEXT 列的正常情况）

  try {
    const binary = atob(raw)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch (atobErr) {
    // 尝试 2：hex 格式回退（BYTEA 列的 \x... 格式）
    if (raw.startsWith('\\x')) {
      try {
        const hex = raw.slice(2)
        const bytes = new Uint8Array(hex.length / 2)
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
        }
        log('salt 以 hex 格式解码成功', { length: bytes.length })
        return bytes
      } catch (hexErr) {
        logError('salt hex 解码也失败', hexErr)
      }
    }

    // 尝试 3：JSON Buffer 格式（BYTEA 列被 Supabase 序列化为 {"type":"Buffer","data":[...]}）
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed.type === 'Buffer' && Array.isArray(parsed.data)) {
          const bytes = new Uint8Array(parsed.data)
          log('salt 以 JSON Buffer 格式解码成功', { length: bytes.length })
          return bytes
        }
      } catch (jsonErr) {
        logError('salt JSON Buffer 解码也失败', jsonErr)
      }
    }

    logError('salt 解码失败', {
      saltPreview: raw.substring(0, 40),
      length: raw.length,
      error: atobErr.message
    })
    throw new Error(
      `salt 格式无法识别（长度 ${raw.length}）。` +
      '可能原因：1) 数据库中 salt 列类型不是 TEXT；2) 数据在传输中被篡改。' +
      '请在 Supabase 控制台检查 user_secrets 表的 salt 值。'
    )
  }
}

/**
 * 为新用户创建 salt 并写入 user_secrets 表
 */
async function createUserSalt(userId) {
  const supabase = getSupabase()
  if (!supabase) throw new Error(t('auth.supabaseNotInit'))

  const salt = generateSalt()
  const saltB64 = bytesToBase64(salt)

  const { error } = await supabase
    .from('user_secrets')
    .insert({ user_id: userId, salt: saltB64 })

  if (error) {
    // 可能是并发注册时另一个会话已创建，再次拉取
    if (error.code === '23505') {
      return await fetchUserSalt(userId)
    }
    throw new Error(t('auth.saveSaltFailed', { msg: error.message }))
  }

  return salt
}

/**
 * 同步 session 到 chrome.storage.local（供 background.js 使用）
 */
async function syncSessionToBg(session) {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY_SESSION]: session })
      log('session 已同步到 chrome.storage.local')
    }
  } catch (e) {
    logError('同步 session 到 background 失败', e)
  }
}

/**
 * 从 chrome.storage.local 清除 session
 */
async function clearSessionFromBg() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove(STORAGE_KEY_SESSION)
    }
  } catch (e) {
    logError('清除 background session 失败', e)
  }
}

/**
 * 初始化 onAuthStateChange 监听（仅一次）
 * 把 session 持久化到 chrome.storage.local
 */
function ensureListener() {
  if (_listenerInitialized) return
  const supabase = getSupabase()
  if (!supabase) return

  supabase.auth.onAuthStateChange((event, session) => {
    log('auth state changed', { event, hasSession: !!session })

    if (event === 'SIGNED_OUT' || !session) {
      currentUser.value = null
      cryptoKey.value = null
      _saltBytes = null
      isAuthed.value = false
      clearSessionFromBg()
      clearSessionKeys()
      return
    }

    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      if (session.user) {
        currentUser.value = {
          id: session.user.id,
          email: session.user.email
        }
        syncSessionToBg(session)
      }
    }
  })
  _listenerInitialized = true
}

// ============================================
// 对外 API
// ============================================

/**
 * 注册
 * 流程：
 * 1. 生成 salt + EC P-256 密钥对
 * 2. 用公钥加密密码（用于密码恢复）
 * 3. supabase.auth.signUp({email, password, emailRedirectTo: welcome.html?rk=d})
 * 4. INSERT user_secrets（salt + 公钥 + 加密密码）
 * 5. 邮件确认后跳转 welcome.html 显示恢复密钥；即时登录则用 chrome.tabs.create 打开
 */
async function signUp({ email, password }) {
  authError.value = null
  isLoading.value = true
  try {
    const supabase = getSupabase()
    if (!supabase) throw new Error(t('auth.supabaseNotInit'))

    // 先生成 EC 密钥对 + salt + 加密密码
    const {
      generateRecoveryKeyPair, exportPublicKeyJwk, exportPrivateKeyD,
      encryptWithPublicKey, generateSalt, bytesToBase64, deriveKey
    } = await import('../utils/crypto')

    const salt = generateSalt()
    const saltB64 = bytesToBase64(salt)
    const keyPair = await generateRecoveryKeyPair()
    const encryptedPassword = await encryptWithPublicKey(password, keyPair.publicKey)
    const publicKeyJwk = await exportPublicKeyJwk(keyPair.publicKey)
    const privateKeyD = await exportPrivateKeyD(keyPair.privateKey)

    // 将所有数据打包为单个 base64url 参数传给 welcome.html
    // （多参数在 Supabase redirect 链路中可能被截断，单参数更可靠）
    const payload = JSON.stringify({
      rk: privateKeyD,                          // 私钥 {d, x, y}
      salt: saltB64,                             // PBKDF2 salt
      rp: encryptedPassword,                     // 公钥加密后的密码
      rpk: publicKeyJwk                          // 公钥 JWK JSON
    })
    // base64url 编码（避免 +/= 字符在 URL 中被误处理）
    const payloadB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const welcomeUrl = `${WELCOME_PAGE_URL}?d=${payloadB64}`

    log('注册', { email })
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: welcomeUrl }
    })

    if (error) throw error

    // 注册时无法写入 user_secrets（邮件确认前 auth.users 尚未创建，外键约束会失败）
    // user_secrets 的创建移至 welcome.html 首次访问时执行

    if (data.session && data.user) {
      log('注册即登录（无邮件确认）')
      _saltBytes = salt
      cryptoKey.value = await deriveKey(password, salt, true)
      currentUser.value = { id: data.user.id, email: data.user.email }
      isAuthed.value = true
      ensureListener()
      syncSessionToBg(data.session)
      await saveCryptoKey(cryptoKey.value)
      await recordLogin()
      await exportUserKeyToSession()
      // 更新设备码到数据库
      const deviceCode = getDeviceCode()
      await updateDeviceCode(data.user.id, deviceCode)

      // 打开 welcome.html 显示恢复密钥
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url: welcomeUrl })
      } else {
        window.open(welcomeUrl, '_blank')
      }

      return { needsEmailConfirm: false }
    }

    log('注册成功，等待邮件确认（恢复密钥将在确认邮件链接中展示）')
    return { needsEmailConfirm: true }
  } catch (e) {
    logError('注册失败', e)
    authError.value = e.message || String(e)
    throw e
  } finally {
    isLoading.value = false
  }
}

/**
 * 登录
 * 流程：
 * 1. supabase.auth.signInWithPassword
 * 2. 拉 user_secrets.salt
 * 3. 用 password + salt 派生 AES 主密钥
 * 4. 触发 onAuthStateChange（在 ensureListener 中处理状态）
 */
async function signIn({ email, password }) {
  authError.value = null
  isLoading.value = true
  try {
    const supabase = getSupabase()
    if (!supabase) throw new Error(t('auth.supabaseNotInit'))

    log('登录', { email })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (!data.session || !data.user) {
      throw new Error(t('auth.loginNoSession'))
    }

    // 拉 salt
    let salt = await fetchUserSalt(data.user.id)
    if (!salt) {
      // salt 不存在：可能是注册时未创建（如通过 OAuth 注册或其他途径）
      // 此时为新用户首次登录，创建 salt
      log('salt 不存在，自动创建')
      salt = await createUserSalt(data.user.id)
    }

    _saltBytes = salt
    cryptoKey.value = await deriveKey(password, salt, true)
    currentUser.value = { id: data.user.id, email: data.user.email }
    isAuthed.value = true
    ensureListener()
    syncSessionToBg(data.session)
    await saveCryptoKey(cryptoKey.value)
    await recordLogin()
    await exportUserKeyToSession()

    // 更新设备码到数据库
    const deviceCode = getDeviceCode()
    await updateDeviceCode(data.user.id, deviceCode)

    // 旧用户迁移：若无 recovery 密钥则自动生成
    await migrateRecoveryKeyIfNeeded(data.user.id, password)

    log('登录成功', { userId: data.user.id, email: data.user.email })
    return { success: true }
  } catch (e) {
    logError('登录失败', e)
    authError.value = e.message || String(e)
    throw e
  } finally {
    isLoading.value = false
  }
}

/**
 * 登出
 */
async function signOut() {
  isLoading.value = true
  try {
    const supabase = getSupabase()
    if (supabase) {
      await supabase.auth.signOut()
    }
  } catch (e) {
    logError('登出失败', e)
  } finally {
    currentUser.value = null
    cryptoKey.value = null
    _saltBytes = null
    isAuthed.value = false
    isLoading.value = false
    clearSessionFromBg()
    clearUnlockRecord()
    clearCryptoKey()
    clearSessionKeys()
    log('已登出')
  }
}

/**
 * 启动时恢复 session 和密钥
 * 1. 从 Supabase SDK 持久化的 localStorage 中读取 session
 * 2. 检查设备码是否匹配（单点登录：一账户一设备）
 * 3. 从 chrome.storage.local 加载保存的密钥（如有）
 * 4. 检查今日登录状态：若今日已登录过且密钥存在，直接进入主页
 * @returns {Promise<{hasSession: boolean, hasKey: boolean, needPassword: boolean, deviceMismatch: boolean}>}
 */
async function getSession() {
  const supabase = getSupabase()
  if (!supabase) {
    return { hasSession: false, hasKey: false, needPassword: true, deviceMismatch: false }
  }

  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      logError('getSession 失败', error)
      return { hasSession: false, hasKey: false, needPassword: true, deviceMismatch: false }
    }

    if (!data?.session?.user) {
      log('无持久 session')
      return { hasSession: false, hasKey: false, needPassword: true, deviceMismatch: false }
    }

    log('发现持久 session', { userId: data.session.user.id, email: data.session.user.email })
    currentUser.value = {
      id: data.session.user.id,
      email: data.session.user.email
    }
    ensureListener()
    syncSessionToBg(data.session)

    // 检查设备码是否匹配
    const deviceCheck = await checkDeviceMatch(data.session.user.id)
    
    if (!deviceCheck.matched) {
      log('设备码不匹配，强制下线')
      // 强制登出
      try {
        await supabase.auth.signOut()
      } catch (e) {
        logError('设备不匹配时登出失败', e)
      }
      currentUser.value = null
      cryptoKey.value = null
      _saltBytes = null
      isAuthed.value = false
      clearSessionFromBg()
      clearUnlockRecord()
      clearCryptoKey()
      // 设置错误信息
      const errorMsg = t('auth.deviceMismatch')
      authError.value = errorMsg
      return { hasSession: false, hasKey: false, needPassword: true, deviceMismatch: true }
    }

    const dailyStatus = await getDailyLoginStatus()
    log('今日登录状态', dailyStatus)

    if (dailyStatus.needPassword) {
      log('今日未登录过，需要输入密码')
      return { hasSession: true, hasKey: false, needPassword: true, deviceMismatch: false }
    }

    const savedKey = await loadCryptoKey()
    if (savedKey) {
      cryptoKey.value = savedKey
      isAuthed.value = true
      log('密钥已恢复，直接进入主页')
      return { hasSession: true, hasKey: true, needPassword: false, deviceMismatch: false }
    }

    log('有 session 但无保存的密钥，需要输入密码')
    return { hasSession: true, hasKey: false, needPassword: true, deviceMismatch: false }

  } catch (e) {
    logError('getSession 异常', e)
    return { hasSession: false, hasKey: false, needPassword: true, deviceMismatch: false }
  }
}

/**
 * 使用持久 session 重新派生密钥（无需再次调用 signIn）
 * 用于：用户已有 session（SDK 自动恢复），但 cryptoKey 未派生
 * 此时需要用户重新输入密码来派生密钥
 */
async function unlockWithPassword(password) {
  if (!currentUser.value) throw new Error(t('auth.noCurrentUser'))
  authError.value = null
  isLoading.value = true
  try {
    const supabase = getSupabase()
    if (!supabase) throw new Error(t('auth.supabaseNotInit'))

    // 拉 salt
    let salt = await fetchUserSalt(currentUser.value.id)
    if (!salt) {
      // salt 丢失，无法解密旧数据
      throw new Error(t('auth.saltMissingDecrypt'))
    }

    _saltBytes = salt
    cryptoKey.value = await deriveKey(password, salt, true)
    isAuthed.value = true
    await saveCryptoKey(cryptoKey.value)
    await recordLogin()
    await exportUserKeyToSession()

    // 更新设备码到数据库
    const deviceCode = getDeviceCode()
    await updateDeviceCode(currentUser.value.id, deviceCode)

    // 旧用户迁移：若无 recovery 密钥则自动生成
    await migrateRecoveryKeyIfNeeded(currentUser.value.id, password)

    log('解锁成功（用密码派生密钥）')
    return { success: true }
  } catch (e) {
    logError('解锁失败', e)
    authError.value = e.message || String(e)
    throw e
  } finally {
    isLoading.value = false
  }
}

/**
 * 修改密码（关键流程，避免数据丢失）
 * 1. 用旧密码派生旧密钥
 * 2. 拉所有 environments（密文，含 passkeys）
 * 3. 用旧密钥解密 → 用新密码派生新密钥 → 重新加密
 * 4. 批量 upsert 新密文到 Supabase
 * 5. 调用 supabase.auth.updateUser({password}) 修改 auth 密码
 * 6. 更新内存中的 cryptoKey 为新密钥
 */
async function changePassword({ oldPassword, newPassword }) {
  if (!currentUser.value) throw new Error(t('auth.notLoggedIn'))
  if (!oldPassword || !newPassword) throw new Error(t('auth.passwordEmpty'))
  if (oldPassword === newPassword) throw new Error(t('auth.passwordSameAsOld'))

  authError.value = null
  isLoading.value = true
  try {
    const supabase = getSupabase()
    if (!supabase) throw new Error(t('auth.supabaseNotInit'))

    log('开始修改密码流程')

    // 1. 用旧密码派生旧密钥（与当前 cryptoKey 应该一致）
    if (!_saltBytes) {
      // 内存中 salt 丢失（如页面刷新后），重新拉取
      _saltBytes = await fetchUserSalt(currentUser.value.id)
      if (!_saltBytes) throw new Error(t('auth.saltMissingChange'))
    }
    const oldKey = await deriveKey(oldPassword, _saltBytes, true)

    // 2. 拉取所有环境数据
    const { data: envRows, error: envErr } = await supabase
      .from('environments')
      .select('*')
      .eq('user_id', currentUser.value.id)
      .eq('is_deleted', false)
    if (envErr) throw new Error(t('auth.fetchEnvsFailed', { msg: envErr.message }))

    // 3. 验证旧密码是否正确（用旧密钥试解密一条环境记录）
    if (envRows && envRows.length > 0) {
      try {
        const { decryptEnv } = await import('../utils/crypto')
        await decryptEnv(envRows[0], oldKey)
      } catch (e) {
        throw new Error(t('auth.oldPasswordWrong'))
      }
    }

    const newKey = await deriveKey(newPassword, _saltBytes, true)

    // 4. 重加密所有环境数据
    if (envRows && envRows.length > 0) {
      const { reencryptEnvs } = await import('../utils/crypto')
      const newEnvRows = await reencryptEnvs(envRows, oldKey, newKey)
      const { error: envUpdateErr } = await supabase
        .from('environments').upsert(newEnvRows, { onConflict: 'id' })
      if (envUpdateErr) throw new Error(t('auth.updateEnvsFailed', { msg: envUpdateErr.message }))
    }

    // 5. 修改 auth 密码
    const { error: pwdErr } = await supabase.auth.updateUser({ password: newPassword })
    if (pwdErr) throw new Error(t('auth.changeAuthPasswordFailed', { msg: pwdErr.message }))

    // 6. 更新内存中的 cryptoKey 并保存到本地
    cryptoKey.value = newKey
    await saveCryptoKey(newKey)

    // 7. 用公钥加密新密码，更新 recovery_password（不需要私钥）
    try {
      const { data: secretRow } = await supabase
        .from('user_secrets')
        .select('recovery_public_key')
        .eq('user_id', currentUser.value.id)
        .maybeSingle()

      if (secretRow?.recovery_public_key) {
        const { importPublicKeyFromJwk, encryptWithPublicKey } = await import('../utils/crypto')
        const publicKey = await importPublicKeyFromJwk(secretRow.recovery_public_key)
        const encryptedPassword = await encryptWithPublicKey(newPassword, publicKey)
        await supabase
          .from('user_secrets')
          .update({ recovery_password: encryptedPassword })
          .eq('user_id', currentUser.value.id)
      }
    } catch (e) {
      logError('更新 recovery_password 失败（不影响改密码主流程）', e)
    }

    log('修改密码完成')
    return { success: true }
  } catch (e) {
    logError('修改密码失败', e)
    authError.value = e.message || String(e)
    throw e
  } finally {
    isLoading.value = false
  }
}

/**
 * 全量重加密（不修改密码）
 * 用当前密码重新加密所有数据
 */
async function reencryptAll(password) {
  if (!currentUser.value) throw new Error(t('auth.notLoggedIn'))
  if (!password) throw new Error(t('auth.passwordEmpty'))

  authError.value = null
  isLoading.value = true
  try {
    const supabase = getSupabase()
    if (!supabase) throw new Error(t('auth.supabaseNotInit'))

    log('开始全量重加密')

    if (!_saltBytes) {
      _saltBytes = await fetchUserSalt(currentUser.value.id)
      if (!_saltBytes) throw new Error(t('auth.saltMissingReencrypt'))
    }

    const key = await deriveKey(password, _saltBytes, true)

    const { data: envRows, error: envErr } = await supabase
      .from('environments')
      .select('*')
      .eq('user_id', currentUser.value.id)
      .eq('is_deleted', false)
    if (envErr) throw new Error(t('auth.fetchEnvsFailed', { msg: envErr.message }))

    if (envRows && envRows.length > 0) {
      try {
        const { decryptEnv } = await import('../utils/crypto')
        await decryptEnv(envRows[0], key)
      } catch (e) {
        throw new Error(t('auth.passwordWrong'))
      }

      const { reencryptEnvs } = await import('../utils/crypto')
      const newEnvRows = await reencryptEnvs(envRows, key, key)
      const { error: envUpdateErr } = await supabase
        .from('environments').upsert(newEnvRows, { onConflict: 'id' })
      if (envUpdateErr) throw new Error(t('auth.updateEnvsFailed', { msg: envUpdateErr.message }))
    }

    cryptoKey.value = key
    await saveCryptoKey(key)
    log('全量重加密完成')
    return { success: true }
  } catch (e) {
    logError('全量重加密失败', e)
    authError.value = e.message || String(e)
    throw e
  } finally {
    isLoading.value = false
  }
}

/**
 * 旧用户迁移：若无 recovery 密钥则自动生成
 * 在 signIn / unlockWithPassword 成功后调用
 * @param {string} userId - 用户 ID
 * @param {string} password - 当前明文密码（用于加密）
 */
async function migrateRecoveryKeyIfNeeded(userId, password) {
  try {
    const supabase = getSupabase()
    if (!supabase) return

    const { data: secretRow } = await supabase
      .from('user_secrets')
      .select('recovery_password')
      .eq('user_id', userId)
      .maybeSingle()

    if (!secretRow || secretRow.recovery_password) return

    // 无 recovery 密钥，自动生成
    const {
      generateRecoveryKeyPair, exportPublicKeyJwk, exportPrivateKeyD, encryptWithPublicKey
    } = await import('../utils/crypto')

    const keyPair = await generateRecoveryKeyPair()
    const encryptedPassword = await encryptWithPublicKey(password, keyPair.publicKey)
    const publicKeyJwk = await exportPublicKeyJwk(keyPair.publicKey)
    const privateKeyD = await exportPrivateKeyD(keyPair.privateKey)

    await supabase
      .from('user_secrets')
      .update({
        recovery_password: encryptedPassword,
        recovery_public_key: publicKeyJwk,
        recovery_key_shown: false
      })
      .eq('user_id', userId)

    // 打开 welcome.html 显示恢复密钥
    const welcomeUrl = `${WELCOME_PAGE_URL}?rk=${encodeURIComponent(privateKeyD)}`
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: welcomeUrl })
    } else {
      window.open(welcomeUrl, '_blank')
    }
    log('旧用户迁移：已生成恢复密钥并打开展示页面')
  } catch (e) {
    logError('旧用户迁移生成恢复密钥失败', e)
  }
}

/**
 * 获取当前用户的 salt（供加解密使用）
 */
function getSalt() {
  return _saltBytes
}

/**
 * 发送密码恢复邮件（magic link）
 * 用户点击邮件中的链接后跳转到 recover.html，携带 session token
 */
async function sendRecoveryEmail(email) {
  authError.value = null
  try {
    const supabase = getSupabase()
    if (!supabase) throw new Error(t('auth.supabaseNotInit'))

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: RECOVERY_PAGE_URL
      },
      shouldCreateUser: false
    })
    if (error) throw error
    log('恢复邮件已发送', { email })
    return { success: true }
  } catch (e) {
    logError('发送恢复邮件失败', e)
    authError.value = e.message || String(e)
    throw e
  }
}

/**
 * 获取原始 CryptoKey（不经过 readonly Proxy，避免 Web Crypto API 拒绝）
 */
export function getCryptoKeyRaw() {
  return cryptoKey.value
}

// ============================================
// 导出 composable
// ============================================
export function useAuth() {
  return {
    currentUser: readonly(currentUser),
    isAuthed: readonly(isAuthed),
    isLoading: readonly(isLoading),
    authError: readonly(authError),

    signUp,
    signIn,
    signOut,
    getSession,
    unlockWithPassword,
    changePassword,
    reencryptAll,
    sendRecoveryEmail,
    getSalt,
    getCryptoKeyRaw,
    getDailyLoginStatus,
    getUnlockStatus
  }
}
