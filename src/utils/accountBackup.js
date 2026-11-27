/**
 * 账户环境本地备份：可往返导入的加密文件格式。
 * 明文含用户名 / 密码 / TOTP / Passkey / 分组；落盘前用口令派生密钥密封。
 */
import {
  bytesToBase64,
  deriveKey,
  encryptJson,
  decryptJson,
  generateSalt,
  generateUuid
} from './crypto.js'

export const BACKUP_FORMAT = 'salesforce-quick-login-account-backup'
export const BACKUP_VERSION = 1

function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * 把当前账户的明文环境 / 分组整理成可序列化载荷（不含旧 id，导入时再分配）。
 */
export function buildBackupPlain({ environments = [], groups = [] } = {}) {
  const groupList = (Array.isArray(groups) ? groups : [])
    .filter((g) => g && g.id && g.id !== 'ungrouped' && !g.isVirtual)
    .map((g) => ({
      id: String(g.id),
      name: g.name || '',
      sortOrder: Number(g.sortOrder) || 0,
      collapsed: !!g.collapsed
    }))

  const groupIdSet = new Set(groupList.map((g) => g.id))

  const envList = (Array.isArray(environments) ? environments : []).map((env) => {
    const rawGroupId = env.groupId || env.group_id || 'ungrouped'
    const groupId = groupIdSet.has(rawGroupId) ? rawGroupId : 'ungrouped'
    return {
      alias: env.alias || '',
      type: env.type || 'production',
      username: env.username || '',
      password: env.password || '',
      customUrl: env.customUrl || env.custom_url || '',
      groupId,
      totpSecret: env.totpSecret || env.totp_secret || '',
      passkeys: Array.isArray(env.passkeys) ? env.passkeys : [],
      sortOrder: Number(env.sortOrder ?? env.sort_order) || 0
    }
  })

  return { groups: groupList, environments: envList }
}

/**
 * 用备份口令密封载荷 → 可下载的 JSON 对象。
 */
export async function sealAccountBackup(plain, passphrase) {
  if (!passphrase || String(passphrase).length < 8) {
    const err = new Error('PASSWORD_TOO_SHORT')
    err.code = 'PASSWORD_TOO_SHORT'
    throw err
  }
  const payload = {
    groups: plain?.groups || [],
    environments: plain?.environments || []
  }
  const salt = generateSalt()
  const key = await deriveKey(String(passphrase), salt, true)
  const ciphertext = await encryptJson(payload, key)
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    salt: bytesToBase64(salt),
    ciphertext,
    envCount: payload.environments.length,
    groupCount: payload.groups.length
  }
}

/**
 * 解开备份文件，得到明文载荷。
 */
export async function openAccountBackup(fileObj, passphrase) {
  if (!fileObj || fileObj.format !== BACKUP_FORMAT) {
    const err = new Error('INVALID_FORMAT')
    err.code = 'INVALID_FORMAT'
    throw err
  }
  if (Number(fileObj.version) !== BACKUP_VERSION) {
    const err = new Error('UNSUPPORTED_VERSION')
    err.code = 'UNSUPPORTED_VERSION'
    throw err
  }
  if (!fileObj.salt || !fileObj.ciphertext) {
    const err = new Error('INVALID_FORMAT')
    err.code = 'INVALID_FORMAT'
    throw err
  }
  if (!passphrase || String(passphrase).length < 8) {
    const err = new Error('PASSWORD_TOO_SHORT')
    err.code = 'PASSWORD_TOO_SHORT'
    throw err
  }

  let saltBytes
  try {
    saltBytes = base64ToBytes(String(fileObj.salt))
  } catch {
    const err = new Error('INVALID_FORMAT')
    err.code = 'INVALID_FORMAT'
    throw err
  }

  const key = await deriveKey(String(passphrase), saltBytes, true)
  let payload
  try {
    payload = await decryptJson(fileObj.ciphertext, key)
  } catch {
    const err = new Error('WRONG_PASSWORD')
    err.code = 'WRONG_PASSWORD'
    throw err
  }

  if (!payload || !Array.isArray(payload.environments) || !Array.isArray(payload.groups)) {
    const err = new Error('INVALID_FORMAT')
    err.code = 'INVALID_FORMAT'
    throw err
  }

  return {
    groups: payload.groups,
    environments: payload.environments
  }
}

/**
 * 为导入分配新 UUID，并重映射 groupId，避免与现有记录冲突。
 */
export function planAccountImport(plain, { now = Date.now() } = {}) {
  const groupIdMap = new Map()
  const groupsToSave = []

  for (const g of plain.groups || []) {
    const oldId = g?.id
    if (!oldId || oldId === 'ungrouped') continue
    const newId = generateUuid()
    groupIdMap.set(String(oldId), newId)
    groupsToSave.push({
      id: newId,
      name: g.name || '',
      sortOrder: Number(g.sortOrder) || 0,
      collapsed: !!g.collapsed,
      createdAt: now,
      updatedAt: now
    })
  }

  const envsToSave = (plain.environments || []).map((env, index) => {
    const oldGroupId = env.groupId || 'ungrouped'
    const groupId =
      oldGroupId === 'ungrouped'
        ? 'ungrouped'
        : (groupIdMap.get(String(oldGroupId)) || 'ungrouped')
    return {
      id: generateUuid(),
      alias: env.alias || '',
      type: env.type || 'production',
      username: env.username || '',
      password: env.password || '',
      customUrl: env.customUrl || '',
      groupId,
      totpSecret: env.totpSecret || '',
      passkeys: Array.isArray(env.passkeys) ? env.passkeys : [],
      sortOrder: Number(env.sortOrder) || index,
      createdAt: now,
      updatedAt: now
    }
  })

  return { groupsToSave, envsToSave }
}

export function backupFilename(date = new Date()) {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
  return `sfql-account-backup-${dateStr}.json`
}
