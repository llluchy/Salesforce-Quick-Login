// ============================================
// 客户端加密模块（AES-256-GCM + PBKDF2）
// ============================================
// 设计原则：
// 1. 密钥永不离开内存（CryptoKey, extractable=false）
// 2. 每条密文使用独立随机 IV（12 字节）
// 3. AES-GCM 自带完整性校验
// 4. 密文格式统一为 JSON: {"iv": "<base64>", "ct": "<base64>"}
// ============================================

import { PBKDF2_ITERATIONS, SALT_LENGTH, IV_LENGTH } from './supabaseConfig'

const subtle = (() => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return crypto.subtle
  }
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle
  }
  throw new Error('Web Crypto API 不可用')
})()

// ============================================
// 编码辅助
// ============================================
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function generateUuid() {
  return crypto.randomUUID()
}

export function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ============================================
// 随机盐生成
// ============================================
export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

// ============================================
// 安装实例 ID（单点登录：一账户一安装）
// 不依赖 UA / 屏幕等易变属性，避免同机误报
// ============================================

const INSTALL_ID_KEY = 'sf_install_id'

let _cachedInstallId = null
let _installIdPromise = null

function createInstallId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  } catch {
    /* fall through */
  }
  return `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

async function readStoredInstallId() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
    try {
      const data = await chrome.storage.local.get(INSTALL_ID_KEY)
      if (data?.[INSTALL_ID_KEY]) return String(data[INSTALL_ID_KEY])
    } catch {
      /* fall through */
    }
  }
  try {
    return localStorage.getItem(INSTALL_ID_KEY) || ''
  } catch {
    return ''
  }
}

async function writeStoredInstallId(id) {
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
    try {
      await chrome.storage.local.set({ [INSTALL_ID_KEY]: id })
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.setItem(INSTALL_ID_KEY, id)
  } catch {
    /* ignore */
  }
}

/**
 * 本扩展安装实例的稳定 ID。
 * 一次生成后写入 chrome.storage.local（失败则降级 localStorage），之后只读。
 */
export async function getInstallId() {
  if (_cachedInstallId) return _cachedInstallId
  if (_installIdPromise) return _installIdPromise

  _installIdPromise = (async () => {
    let id = await readStoredInstallId()
    if (!id) {
      id = createInstallId()
      await writeStoredInstallId(id)
    }
    _cachedInstallId = id
    return id
  })()

  try {
    return await _installIdPromise
  } finally {
    _installIdPromise = null
  }
}

/** 兼容旧调用名：返回安装实例 ID，用作服务端 device_code */
export async function getDeviceCode() {
  return getInstallId()
}

// ============================================
// 密钥派生：PBKDF2-SHA256 → AES-256-GCM
// ============================================
export async function deriveKey(password, saltBytes, extractable = false) {
  if (!password) throw new Error('密码不能为空')
  if (!saltBytes || saltBytes.length < 16) throw new Error('salt 至少 16 字节')

  const baseKey = await subtle.importKey(
    'raw',
    textEncoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  const derivedKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  )

  return derivedKey
}

export async function exportKeyToJwk(key) {
  return subtle.exportKey('jwk', key)
}

export async function importKeyFromJwk(jwk) {
  return subtle.importKey(
    'jwk',
    jwk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// ============================================
// 加密单个字符串字段
// 返回 JSON 字符串：{"iv": "<base64>", "ct": "<base64>"}
// ============================================
export async function encryptField(plaintext, key) {
  if (plaintext === null || plaintext === undefined) return null
  if (plaintext === '') return ''
  if (!key) throw new Error('加密密钥未初始化')

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoded = textEncoder.encode(String(plaintext))

  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )

  return JSON.stringify({
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertext))
  })
}

// ============================================
// 解密单个字段
// ============================================
export async function decryptField(ciphertext, key) {
  if (ciphertext === null || ciphertext === undefined) return null
  if (ciphertext === '') return ''
  if (!key) throw new Error('解密密钥未初始化')

  let parsed
  try {
    parsed = typeof ciphertext === 'string' ? JSON.parse(ciphertext) : ciphertext
  } catch (e) {
    throw new Error('密文格式无效（非 JSON）')
  }

  if (!parsed.iv || !parsed.ct) {
    throw new Error('密文格式无效（缺 iv/ct）')
  }

  const iv = base64ToBytes(parsed.iv)
  const ct = base64ToBytes(parsed.ct)

  try {
    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ct
    )
    return textDecoder.decode(decrypted)
  } catch (e) {
    console.error('[decryptField] 解密失败', {
      ivLength: iv.length,
      ctLength: ct.length,
      keyAlgorithm: key?.algorithm?.name,
      keyLength: key?.algorithm?.length,
      errorName: e.name,
      errorMessage: e.message
    })
    throw new Error('解密失败：密钥不匹配或数据损坏')
  }
}

// ============================================
// 加密整个对象（序列化为 JSON 后加密）
// ============================================
export async function encryptJson(obj, key) {
  if (obj === null || obj === undefined) return null
  if (!key) throw new Error('加密密钥未初始化')
  return encryptField(JSON.stringify(obj), key)
}

// ============================================
// 解密为对象
// ============================================
export async function decryptJson(ciphertext, key) {
  if (ciphertext === null || ciphertext === undefined) return null
  if (ciphertext === '' || ciphertext === '[]') return []
  const plaintext = await decryptField(ciphertext, key)
  if (!plaintext) return null
  return JSON.parse(plaintext)
}

// ============================================
// 加密整个 Environment 对象
// 仅加密敏感字段，非敏感字段保留明文
// 统一使用 userKey 加密
// ============================================
export async function encryptEnv(env, key, userId) {
  if (!env) return null
  const encrypted = {
    alias: env.alias || '',
    type: env.type || 'production',
    group_id: env.group_id || env.groupId || 'ungrouped',
    sort_order: env.sort_order || env.sortOrder || 0
  }

  if (!userId) throw new Error('user_id 为空，无法保存环境')
  encrypted.user_id = userId

  encrypted.username = await encryptField(env.username || '', key)
  encrypted.password = await encryptField(env.password || '', key)
  encrypted.custom_url = env.custom_url ? await encryptField(env.custom_url, key) : (env.customUrl ? await encryptField(env.customUrl, key) : null)
  encrypted.totp_secret = env.totp_secret ? await encryptField(env.totp_secret, key) : (env.totpSecret ? await encryptField(env.totpSecret, key) : null)
  encrypted.passkeys = (env.passkeys && env.passkeys.length > 0)
    ? await encryptJson(env.passkeys, key)
    : '[]'

  if (env.id) {
    encrypted.id = env.id
  }

  if (env.created_at) encrypted.created_at = env.created_at
  else if (env.createdAt) encrypted.created_at = new Date(env.createdAt).toISOString()
  if (env.updated_at) encrypted.updated_at = env.updated_at
  else if (env.updatedAt) encrypted.updated_at = new Date(env.updatedAt).toISOString()

  return encrypted
}

// ============================================
// 解密 Environment 行（数据库行 → 前端对象）
// ============================================
export async function decryptEnv(row, key) {
  if (!row) return null
  let passkeys = []
  try {
    if (row.passkeys && row.passkeys !== '[]') {
      if (typeof row.passkeys === 'string') {
        passkeys = await decryptJson(row.passkeys, key) || []
      } else if (Array.isArray(row.passkeys)) {
        passkeys = row.passkeys
      }
    }
  } catch (e) {
    passkeys = []
  }
  return {
    id: row.id,
    alias: row.alias || '',
    username: await decryptField(row.username, key),
    password: await decryptField(row.password, key),
    type: row.type || 'production',
    customUrl: row.custom_url ? await decryptField(row.custom_url, key) : '',
    groupId: row.group_id || 'ungrouped',
    totpSecret: row.totp_secret ? await decryptField(row.totp_secret, key) : '',
    passkeys: Array.isArray(passkeys) ? passkeys : [],
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  }
}

// ============================================
// 加密 Group 对象（无敏感字段，仅做格式转换）
// ============================================
export function encryptGroup(group, userId) {
  if (!group) return null
  const encrypted = {
    name: group.name || '',
    sort_order: group.sortOrder || 0,
    collapsed: !!group.collapsed
  }
  // 必须显式写入 user_id（RLS 策略 auth.uid() = user_id 要求）
  if (userId) encrypted.user_id = userId
  // ID（前端已生成 UUID，直接保留；编辑时保留原 ID）
  if (group.id) {
    encrypted.id = group.id
  }
  if (group.createdAt) encrypted.created_at = new Date(group.createdAt).toISOString()
  if (group.updatedAt) encrypted.updated_at = new Date(group.updatedAt).toISOString()
  return encrypted
}

// ============================================
// 解密 Group 行
// ============================================
export function decryptGroup(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name || '',
    isVirtual: false,
    collapsed: !!row.collapsed,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  }
}

// ============================================
// 分享功能：分享码派生密钥 + 环境数据加解密
// ============================================

/**
 * 用分享码+验证码派生临时密钥（A 和 B 派生出的密钥相同）
 * 用于加密/解密 env_shares 中的环境数据
 */
export async function deriveShareKey(shareCode, verifyCode) {
  const combined = shareCode + verifyCode
  const fixedSalt = new Uint8Array(16)
  return await deriveKey(combined, fixedSalt, true)
}

/**
 * 用分享密钥加密完整环境数据（明文 env 对象 → JSON 密文字符串）
 * 用于 createShare 时存入 env_shares
 */
export async function encryptEnvForShare(env, shareKey) {
  const payload = {
    alias: env.alias || '',
    type: env.type || 'production',
    username: env.username || '',
    password: env.password || '',
    customUrl: env.customUrl || env.custom_url || '',
    totpSecret: env.totpSecret || env.totp_secret || '',
    passkeys: env.passkeys || []
  }
  return await encryptJson(payload, shareKey)
}

/**
 * 用分享密钥解密环境数据（env_shares 中的密文 → 明文 env 对象）
 * 用于 acceptShare 时获取原始环境数据
 */
export async function decryptEnvFromShare(encryptedEnv, shareKey) {
  return await decryptJson(encryptedEnv, shareKey)
}

/**
 * 重加密所有环境数据（改密码时调用）
 * @param {Array} rows - environments 表的行数组（密文）
 * @param {CryptoKey} oldUserKey - 旧用户密钥
 * @param {CryptoKey} newUserKey - 新用户密钥
 * @returns {Array} 更新后的行数组（密文）
 */
export async function reencryptEnvs(rows, oldUserKey, newUserKey) {
  return Promise.all(rows.map(async (row) => {
    const env = await decryptEnv(row, oldUserKey)
    return await encryptEnv(env, newUserKey, row.user_id)
  }))
}

// ============================================
// EC P-256 非对称加密（密码恢复用，ECIES 模式）
// ============================================
// 设计：
// - 公钥存入数据库（recovery_public_key），用于加密密码
// - 私钥仅 d 值（43 字符 base64url）交给用户本地保存
// - 改密码时用公钥加密新密码（不需要私钥）
// - 恢复密码时用私钥解密得到旧密码明文，再重加密所有数据
// ============================================

/**
 * 生成 EC P-256 密钥对（ECDH 用途）
 */
export async function generateRecoveryKeyPair() {
  return await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  )
}

/**
 * 导出公钥为 JWK 字符串（含 x, y 坐标，存入 DB）
 */
export async function exportPublicKeyJwk(publicKey) {
  const jwk = await subtle.exportKey('jwk', publicKey)
  return JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y })
}

/**
 * 导出私钥的 d 值（43 字符 base64url，交给用户保存）
 */
export async function exportPrivateKeyD(privateKey) {
  const jwk = await subtle.exportKey('jwk', privateKey)
  // 返回 { d, x, y }，导入时带上 x,y 确保浏览器正确重建密钥
  return JSON.stringify({ d: jwk.d, x: jwk.x, y: jwk.y })
}

/**
 * 从导出数据导入私钥（恢复页面用）
 * 支持新格式 JSON { d, x, y } 和旧格式纯 d 字符串（兼容旧密钥）
 */
export async function importPrivateKeyFromD(input) {
  let d, x, y

  try {
    const parsed = JSON.parse(input)
    if (parsed.d) {
      d = parsed.d
      x = parsed.x
      y = parsed.y
    } else {
      // JSON 但不是我们的格式，当纯 d 处理
      d = input
    }
  } catch {
    // 纯字符串 d（旧格式兼容）
    d = input
  }

  const jwk = { kty: 'EC', crv: 'P-256', d }
  if (x && y) {
    jwk.x = x
    jwk.y = y
  }

  return await subtle.importKey(
    'jwk', jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  )
}

/**
 * 从 JWK 字符串导入公钥
 */
export async function importPublicKeyFromJwk(jwkStr) {
  const jwk = typeof jwkStr === 'string' ? JSON.parse(jwkStr) : jwkStr
  return await subtle.importKey(
    'jwk', jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
}

/**
 * 用公钥加密（ECIES 模式）
 * 1. 生成临时 EC P-256 密钥对
 * 2. ECDH(临时私钥, 公钥) → 派生 AES-256 共享密钥
 * 3. AES-GCM 加密明文
 * 4. 返回 JSON: {ephemPubKey:{x,y}, iv, ct}
 */
export async function encryptWithPublicKey(plaintext, publicKey) {
  const ephemeralKeyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  )

  const sharedKey = await subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    ephemeralKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = textEncoder.encode(String(plaintext))
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded)

  const ephemPubJwk = await subtle.exportKey('jwk', ephemeralKeyPair.publicKey)

  return JSON.stringify({
    ephemPubKey: { x: ephemPubJwk.x, y: ephemPubJwk.y },
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ct))
  })
}

/**
 * 用私钥解密（ECIES 模式）
 * 1. 从密文中取出临时公钥 → importKey
 * 2. ECDH(私钥, 临时公钥) → 派生相同的共享密钥
 * 3. AES-GCM 解密
 */
export async function decryptWithPrivateKey(ciphertextJson, privateKey) {
  const data = typeof ciphertextJson === 'string' ? JSON.parse(ciphertextJson) : ciphertextJson

  const ephemPubKey = await subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: data.ephemPubKey.x, y: data.ephemPubKey.y },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )

  const sharedKey = await subtle.deriveKey(
    { name: 'ECDH', public: ephemPubKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  const iv = base64ToBytes(data.iv)
  const ct = base64ToBytes(data.ct)
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ct)
  return textDecoder.decode(decrypted)
}
