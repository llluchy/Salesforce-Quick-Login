// ============================================
// 分享功能 composable
// 分享逻辑：复制一份完整环境数据给被分享者，各自独立管理
// 流程：
//   createShare: 解密环境 → 用分享密钥加密 → 存入 env_shares
//   acceptShare: 从 env_shares 解密 → 用自己的 userKey 重新加密 → 插入 environments
// ============================================
import { getSupabase } from './useSupabase'
import { getCryptoKeyRaw, useAuth } from './useAuth'
import {
  deriveShareKey,
  encryptEnvForShare,
  decryptEnvFromShare,
  encryptEnv,
  decryptEnv
} from '../utils/crypto'
import { t } from '../i18n'

function getCurrentUser() {
  const { currentUser } = useAuth()
  return currentUser.value
}

function generate6DigitCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
}

function generateShareCodes() {
  let shareCode = generate6DigitCode()
  let verifyCode = generate6DigitCode()
  while (verifyCode === shareCode) {
    verifyCode = generate6DigitCode()
  }
  return { shareCode, verifyCode }
}

/**
 * 发起分享：将环境数据用分享密钥加密后存入 env_shares
 * @param {Array<string>} envIds - 要分享的环境 ID 数组
 * @returns {Promise<{shareCode, verifyCode}>} 分享码和验证码
 */
async function createShare(envIds) {
  const supabase = getSupabase()
  if (!supabase) throw new Error(t('share.supabaseNotInit'))

  const userKey = getCryptoKeyRaw()
  if (!userKey) throw new Error(t('share.keyNotDerived'))

  if (!envIds || envIds.length === 0) {
    throw new Error(t('share.selectEnvs'))
  }

  const userId = getCurrentUser().id

  // 1. 加载并解密所有选中的环境
  const { data: envRows, error: envErr } = await supabase
    .from('environments')
    .select('*')
    .in('id', envIds)
    .eq('user_id', userId)
    .eq('is_deleted', false)

  if (envErr) throw new Error(t('share.queryEnvsFailed', { msg: envErr.message }))
  if (!envRows || envRows.length === 0) throw new Error(t('share.noShareableEnvs'))

  // 2. 生成分享码和验证码
  const { shareCode, verifyCode } = generateShareCodes()
  const shareKey = await deriveShareKey(shareCode, verifyCode)

  // 3. 用分享密钥加密所有环境数据
  const encryptedEnvs = []
  for (const row of envRows) {
    const env = await decryptEnv(row, userKey)
    const encrypted = await encryptEnvForShare(env, shareKey)
    encryptedEnvs.push({
      env_id: row.id,
      encrypted_env: encrypted,
      alias: env.alias
    })
  }

  // 4. 插入 env_shares 表
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error: shareErr } = await supabase
    .from('env_shares')
    .insert({
      env_ids: envIds,
      owner_user_id: userId,
      share_code: shareCode,
      verify_code: verifyCode,
      encrypted_envs: encryptedEnvs,
      status: 'active',
      expires_at: expiresAt
    })

  if (shareErr) {
    if (shareErr.code === '23505') {
      throw new Error(t('share.codeConflict'))
    }
    throw new Error(t('share.createShareFailed', { msg: shareErr.message }))
  }

  return { shareCode, verifyCode }
}

/**
 * 接受分享：从 env_shares 解密 → 用自己的 userKey 重新加密 → 插入 environments
 * @param {string} shareCode - 分享码
 * @param {string} verifyCode - 验证码
 * @param {Array<{envId, alias}>} aliases - 可选的自定义别名
 * @returns {Promise<{success, envIds}>} 创建的环境 ID 数组
 */
async function acceptShare(shareCode, verifyCode, aliases = []) {
  const supabase = getSupabase()
  if (!supabase) throw new Error(t('share.supabaseNotInit'))

  const userKey = getCryptoKeyRaw()
  if (!userKey) throw new Error(t('share.keyNotDerived'))

  const userId = getCurrentUser().id

  // 1. 查询分享记录（通过 SECURITY DEFINER 函数绕过 RLS）
  const { data: shareData, error: shareErr } = await supabase
    .rpc('accept_share_lookup', {
      p_share_code: shareCode,
      p_verify_code: verifyCode
    })

  if (shareErr || !shareData) {
    throw new Error(t('share.invalidOrExpired'))
  }

  // 2. 派生分享密钥，解密所有环境数据
  const shareKey = await deriveShareKey(shareCode, verifyCode)
  const newEnvIds = []

  for (let i = 0; i < shareData.encrypted_envs.length; i++) {
    const item = shareData.encrypted_envs[i]
    const envData = await decryptEnvFromShare(item.encrypted_env, shareKey)

    // 3. 用自己的 userKey 重新加密，作为独立环境保存
    const alias = aliases[i]?.alias || envData.alias || item.alias || t('share.sharedEnvAlias')
    const newEnvId = crypto.randomUUID()

    const newEnv = {
      id: newEnvId,
      alias: alias,
      type: envData.type || 'production',
      username: envData.username || '',
      password: envData.password || '',
      customUrl: envData.customUrl || '',
      groupId: 'ungrouped',
      totpSecret: envData.totpSecret || '',
      passkeys: envData.passkeys || [],
      sortOrder: 999,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const encrypted = await encryptEnv(newEnv, userKey, userId)
    const { error: insertErr } = await supabase
      .from('environments')
      .insert(encrypted)

    if (insertErr) throw new Error(t('share.createEnvFailed', { msg: insertErr.message }))
    newEnvIds.push(newEnvId)
  }

  // 4. 标记分享码已使用，并记录使用者
  const { error: consumeErr } = await supabase
    .rpc('accept_share_mark_used', { p_share_code: shareCode, p_consumed_by: userId })
  if (consumeErr) {
    console.warn('[Share] 标记分享码已使用失败（不影响接受结果）', consumeErr)
  }

  return { success: true, envIds: newEnvIds }
}

/**
 * 取消分享：删除 env_shares 中的分享记录
 * 注意：已经被别人接受分享（复制走）的数据不受影响
 * @param {string} envId - 环境 ID
 */
async function revokeShare(envId) {
  const supabase = getSupabase()
  if (!supabase) throw new Error(t('share.supabaseNotInit'))

  const userId = getCurrentUser().id

  const { error } = await supabase
    .from('env_shares')
    .delete()
    .eq('owner_user_id', userId)
    .contains('env_ids', [envId])

  if (error) throw new Error(t('share.cancelFailed', { msg: error.message }))

  return { success: true }
}

/**
 * 查询当前用户的所有分享记录
 */
async function getMyShares() {
  const supabase = getSupabase()
  if (!supabase) throw new Error(t('share.supabaseNotInit'))

  const { data, error } = await supabase
    .from('env_shares')
    .select('id, env_ids, share_code, verify_code, status, expires_at, consumed_by, created_at')
    .eq('owner_user_id', getCurrentUser().id)
    .order('created_at', { ascending: false })

  if (error) throw new Error(t('share.querySharesFailed', { msg: error.message }))
  return data || []
}

export function useShare() {
  return {
    createShare,
    acceptShare,
    revokeShare,
    getMyShares
  }
}
