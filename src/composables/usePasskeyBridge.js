// ============================================
// Passkey Bridge（v4 架构）
// - Side Panel 集中处理所有 Passkey 操作
// - 接收 page-world.js 的 WebAuthn 请求
// - 暴露 reactive state 供 App.vue 显示 UI
// - 保留 bg:* 消息用于数据管理
// ============================================

import { ref, readonly } from 'vue'
import { useStorage } from './useStorage'
import { useAuth } from './useAuth'
import { makeCredential, getAssertion, serializeCredential, base64urlToUint8Array } from '../utils/webauthn'
import { t } from '../i18n'

let _listener = null

// ============================================
// 全局状态：当前待处理的 Passkey 请求
// App.vue watch 此值来显示/隐藏 Passkey 选择对话框
// ============================================
export const passkeyRequest = ref(null) // { type, resolve, reject, data, environments }
export const passkeyError = ref(null)  // 保存失败时的错误信息，App.vue watch 显示警告
export const passkeySaving = ref(false) // 保存中加载态
export const passkeySavingStage = ref('') // 加载阶段文字：保存中 / 验证中

export function initPasskeyBridge() {
  if (_listener) return

  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    console.warn('[PasskeyBridge] 非扩展环境，跳过消息桥注册')
    return
  }

  const {
    loadEnvironments, saveEnvironments,
    loadPasskeyCredentials, savePasskeyCredential,
    getPasskeyCredentialById, getPasskeyCredentialsByRpId,
    updatePasskeySignCount
  } = useStorage()
  const { isAuthed, getCryptoKeyRaw, currentUser } = useAuth()

  const requireAuth = () => {
    if (!isAuthed.value || !getCryptoKeyRaw()) {
      return { success: false, error: t('passkey.needUnlock') }
    }
    return null
  }

  // ============================================
  // 向 content.js 发送响应（通过 sender.tab.id）
  // ============================================
  function respondToContent(msg, data) {
    if (!msg._senderTabId) {
      return
    }
    chrome.tabs.sendMessage(msg._senderTabId, {
      action: 'sf:passkeyResult',
      requestId: msg.requestId,
      data: data
    }).catch(e => { /* silent */ })
  }

  // ============================================
  // 处理 sf:passkeyGet — 认证断言
  // 所有业务判断在此完成：登录检查 / rpId检查 / 环境加载 / UI选择 / WebAuthn签名
  // ============================================
  async function handlePasskeyGet(msg) {
    const { rpId, challenge, allowCredentials, origin } = msg.data

    // 未登录 → 不处理，让页面走系统 Passkey
    if (!isAuthed.value || !getCryptoKeyRaw()) {
      respondToContent(msg, { fallback: true })
      return
    }

    try {
      // 加载有 Passkey 的环境
      const envs = await loadEnvironments()
      const envsWithPasskeys = (envs || []).filter(e => e.passkeys && e.passkeys.length > 0)

      // 等待用户在 Side Panel UI 中选择
      const selectedEnv = await new Promise((resolve, reject) => {
        passkeyRequest.value = {
          type: 'get',
          resolve: (env) => { passkeyRequest.value = null; resolve(env) },
          reject: (err) => { passkeyRequest.value = null; reject(err) },
          data: { rpId, challenge, allowCredentials, origin },
          environments: envsWithPasskeys
        }
      })

      // 用户取消 → 不处理
      if (!selectedEnv) {
        respondToContent(msg, { fallback: true })
        return
      }

      // 执行 WebAuthn getAssertion
      const result = await getAssertion(
        { rpId, challenge, allowCredentials: allowCredentials || [] },
        origin,
        Array.isArray(selectedEnv.passkeys) ? selectedEnv.passkeys : []
      )

      // 凭证不匹配 → 不处理
      if (!result) {
        respondToContent(msg, { fallback: true })
        return
      }

      // 更新 signCount
      try { await updatePasskeySignCount(result.updatedCredential.credentialId, result.updatedCredential.signCount) }
      catch (e) { /* silent */ }

      respondToContent(msg, { success: true, credential: serializeCredential(result.credential) })

    } catch (e) {
      passkeyRequest.value = null
      respondToContent(msg, { fallback: true })
    }
  }

  // ============================================
  // 处理 sf:passkeyCreate — 注册新凭证
  // ============================================
  async function handlePasskeyCreate(msg) {
    const data = msg.data

    // 未登录 → 不处理
    if (!isAuthed.value || !getCryptoKeyRaw()) {
      respondToContent(msg, { fallback: true })
      return
    }

    try {
      const envs = await loadEnvironments()

      // 等待用户选择/创建环境
      const selectedEnv = await new Promise((resolve, reject) => {
        passkeyRequest.value = {
          type: 'create',
          resolve: (env) => { passkeyRequest.value = null; resolve(env) },
          reject: (err) => { passkeyRequest.value = null; reject(err) },
          data: { ...data },
          environments: envs
        }
      })

      if (!selectedEnv) { respondToContent(msg, { fallback: true }); return }

      // 执行 WebAuthn makeCredential
      const createOptions = {
        rpId: data.rpId, rp: data.rp,
        user: data.user ? {
          id: base64urlToUint8Array(data.user.id).buffer,
          name: data.user.name, displayName: data.user.displayName
        } : undefined,
        challenge: base64urlToUint8Array(data.challenge).buffer,
        pubKeyCredParams: data.pubKeyCredParams,
        excludeCredentials: (data.excludeCredentials || []).map(c => ({ id: c.id, type: c.type })),
        authenticatorSelection: data.authenticatorSelection
      }

      const result = await makeCredential(createOptions, data.origin)
      if (!result || !result.credential) { respondToContent(msg, { fallback: true }); return }

      // 保存凭证
      const passkey = {
        id: 'pk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        credentialId: result.privateKeyData.credentialId,
        rpId: data.rpId, challenge: data.challenge,
        privateKeyJwk: result.privateKeyData.privateKeyJwk,
        publicKeyJwk: result.privateKeyData.publicKeyJwk || null,
        userId: result.privateKeyData.userId,
        userName: result.privateKeyData.userName,
        userDisplayName: result.privateKeyData.userDisplayName,
        envId: selectedEnv.id, signCount: 0, createdAt: Date.now()
      }

      passkeySaving.value = true
      passkeySavingStage.value = t('passkey.saving')

      const saveResult = await savePasskeyCredential(passkey)
      if (!saveResult?.success) {
        passkeySaving.value = false
        passkeySavingStage.value = ''
        passkeyError.value = t('passkey.saveFailed', { error: saveResult?.error || t('passkey.unknownError') })
        passkeyRequest.value = null
        respondToContent(msg, { fallback: true })
        return
      }

      // 验证：重新加载数据确认 passkey 已持久化
      passkeySavingStage.value = t('passkey.verifying')
      const verifyEnvs = await loadEnvironments()
      const verifyEnv = verifyEnvs.find(e => e.id === selectedEnv.id)
      const saved = (verifyEnv?.passkeys || []).some(pk => pk.credentialId === passkey.credentialId)
      if (!saved) {
        passkeySaving.value = false
        passkeySavingStage.value = ''
        passkeyError.value = t('passkey.verifyFailed')
        passkeyRequest.value = null
        respondToContent(msg, { fallback: true })
        return
      }

      passkeySaving.value = false
      passkeySavingStage.value = ''

      const serialized = serializeCredential(result.credential)
      respondToContent(msg, { success: true, credential: serialized })

    } catch (e) {
      passkeyRequest.value = null
      respondToContent(msg, { fallback: true })
    }
  }

  // ============================================
  // 消息处理器
  // ============================================
  const handlers = {
    // ====== 新 v4 消息：Passkey 操作 ======
    'sf:passkeyGet': handlePasskeyGet,
    'sf:passkeyCreate': handlePasskeyCreate,

    // ====== Ping：content.js 检测 Side Panel 是否可用 ======
    'bg:ping': async () => {
      return { open: true, authed: !!isAuthed.value && !!getCryptoKeyRaw() }
    },

    // ====== 数据管理（保留 bg:* 兼容） ======
    'bg:updatePasskeySignCount': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      return await updatePasskeySignCount(msg.credentialId, msg.signCount)
    },

    'bg:exportPasskeyBackup': async () => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const [creds, envs] = await Promise.all([
        loadPasskeyCredentials(),
        loadEnvironments()
      ])
      return {
        success: true,
        backup: {
          version: 2,
          exportedAt: new Date().toISOString(),
          credentials: creds,
          environments: envs
        }
      }
    },

    'bg:importPasskeyBackup': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const backup = msg.backup
      if (!backup || !Array.isArray(backup.credentials)) {
        return { success: false, error: t('passkey.invalidBackup') }
      }

      let credCount = 0
      for (const cred of backup.credentials) {
        const r = await savePasskeyCredential(cred)
        if (r?.success) credCount++
      }

      let envCount = 0
      if (Array.isArray(backup.environments) && backup.environments.length > 0) {
        const existing = await loadEnvironments()
        const merged = [...existing]
        for (const env of backup.environments) {
          if (!merged.find(e => e.id === env.id)) {
            merged.push(env)
            envCount++
          }
        }
        await saveEnvironments(merged)
      }

      return {
        success: true,
        imported: {
          credentials: credCount,
          environments: envCount
        }
      }
    },

    'bg:manualBindPasskey': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const cred = msg.credential
      if (!cred || !cred.credentialId) {
        return { success: false, error: t('passkey.incompleteCred') }
      }
      return await savePasskeyCredential(cred)
    },

    'bg:getPasskeyById': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const cred = await getPasskeyCredentialById(msg.credentialId)
      return cred
        ? { success: true, credential: cred }
        : { success: false, error: t('passkey.credNotFound') }
    },

    'bg:listPasskeys': async () => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const creds = await loadPasskeyCredentials()
      return {
        success: true,
        credentials: creds.map(c => ({
          credentialId: c.credentialId,
          rpId: c.rpId,
          userId: c.userId,
          userName: c.userName,
          envId: c.envId,
          createdAt: c.createdAt,
          hasPrivateKey: !!c.privateKeyJwk
        }))
      }
    },

    'bg:getEnvironments': async () => {
      const authErr = requireAuth()
      if (authErr) return authErr
      return { environments: await loadEnvironments() }
    },

    'bg:saveNewEnvironment': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const newEnv = msg.environment
      if (!newEnv) return { success: false, error: t('passkey.envEmpty') }
      const envs = await loadEnvironments()
      if (!envs.find(e => e.id === newEnv.id)) {
        envs.push(newEnv)
      }
      return await saveEnvironments(envs)
    },

    'bg:bindPasskeyToEnv': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const { envId, passkey } = msg
      if (!envId || !passkey) return { success: false, error: t('passkey.paramsIncomplete') }
      const envs = await loadEnvironments()
      const idx = envs.findIndex(e => e.id === envId)
      if (idx === -1) return { success: false, error: t('passkey.envNotFound') }
      if (!envs[idx].passkeys) envs[idx].passkeys = []
      if (!envs[idx].passkeys.find(pk => pk.rpId === passkey.rpId)) {
        envs[idx].passkeys.push(passkey)
      }
      return await saveEnvironments(envs)
    }
  }

  // ============================================
  // 注册 chrome.runtime.onMessage 监听
  // ============================================
  _listener = (msg, sender, sendResponse) => {
    if (!msg || typeof msg.action !== 'string') return

    const handler = handlers[msg.action]
    if (!handler) return

    // sf:* 消息使用 chrome.tabs.sendMessage 直接回复（不依赖 sendResponse 回调）
    if (msg.action.startsWith('sf:')) {
      msg._senderTabId = sender.tab?.id
      handler(msg).catch(err => {
        /* silent */
      })
      return // 不返回 true，Chrome 知道这是同步处理
    }

    // bg:* 消息使用传统的 sendResponse 回调
    Promise.resolve(handler(msg, sendResponse))
      .then(result => {
        if (result) sendResponse(result)
      })
      .catch(err => {
        console.error('[PasskeyBridge] 处理失败', msg.action, err)
        sendResponse({ success: false, error: err.message || String(err) })
      })
    return true
  }

  chrome.runtime.onMessage.addListener(_listener)
}

export function destroyPasskeyBridge() {
  if (_listener) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.removeListener(_listener)
    }
    _listener = null
  }
}
