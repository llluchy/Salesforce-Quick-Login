/**
 * background 第二道门：openToolWindow / 对象搜索 / 浮动栏可见性。
 */

import { STORAGE_KEY_SESSION } from './constants.js'
import { loadPaymentGateSnapshot } from './paymentGateApi.js'
import { planPaymentToolGate, resolvePaymentAccess } from './paymentAccess.js'

export const PAYMENT_GATE_ACTIONS = new Set([
  'getPaymentAccess',
  'refreshPaymentGate'
])

export function createPaymentGateMessageHandler(options = {}) {
  const storage = options.storage || (typeof chrome !== 'undefined' ? chrome.storage : null)

  async function resolveSnapshot(force = false) {
    return loadPaymentGateSnapshot({
      storage,
      force,
      supabaseUrl: options.supabaseUrl,
      anonKey: options.anonKey,
      fetchImpl: options.fetchImpl,
      skipSideEffects: options.skipSideEffects === true
    })
  }

  async function assertToolsAllowed() {
    let snapshot
    try {
      snapshot = await resolveSnapshot(false)
    } catch (error) {
      // 工具入口：读门异常一律 fail-closed，不可当开关 OFF
      return {
        ok: false,
        snapshot: null,
        decision: 'blocked',
        success: false,
        error: 'blocked',
        reason: error?.message || 'switch_fetch_failed'
      }
    }
    const decision = planPaymentToolGate(snapshot.access)
    if (decision === 'proceed') {
      return { ok: true, snapshot, decision }
    }
    return {
      ok: false,
      snapshot,
      decision,
      success: false,
      error: decision,
      reason: snapshot.access?.reason || decision
    }
  }

  function handlePaymentGateMessage(request, _sender, sendResponse) {
    const action = request?.action
    if (!PAYMENT_GATE_ACTIONS.has(action)) return false

    const run = async () => {
      if (action === 'refreshPaymentGate') {
        const snapshot = await resolveSnapshot(true)
        return { success: true, ...snapshot }
      }
      const snapshot = await resolveSnapshot(false)
      return {
        success: true,
        allow: snapshot.access?.allow === true,
        reason: snapshot.access?.reason,
        switchEnabled: snapshot.switchEnabled,
        isAuthed: snapshot.isAuthed,
        isPaid: snapshot.isPaid,
        access: snapshot.access
      }
    }

    run()
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          success: false,
          allow: false,
          error: error?.message || String(error),
          access: resolvePaymentAccess({
            switchEnabled: true,
            isAuthed: false,
            isPaid: false,
            fetchFailed: true
          })
        })
      )
    return true
  }

  handlePaymentGateMessage.assertToolsAllowed = assertToolsAllowed
  handlePaymentGateMessage.resolveSnapshot = resolveSnapshot
  return handlePaymentGateMessage
}

/** 供 toolFloat 合成：收费阶段未授权时强制隐藏浮动栏。 */
export async function resolveToolFloatVisibleWithPaymentGate(getVisible, assertToolsAllowed) {
  const base = await getVisible()
  if (!base?.success) return base
  try {
    const gate = await assertToolsAllowed()
    if (!gate.ok) {
      return { ...base, visible: false, paymentBlocked: true, paymentReason: gate.reason }
    }
  } catch {
    // 读门失败：工具表面 fail-closed，隐藏浮动栏
    return { ...base, visible: false, paymentBlocked: true, paymentReason: 'switch_fetch_failed' }
  }
  return base
}

export async function readLocalSession(storage) {
  const store = storage || chrome.storage
  const data = await store.local.get(STORAGE_KEY_SESSION)
  return data?.[STORAGE_KEY_SESSION] || null
}
