// 读管理员总开关（app_config.payment_master）。
// DDL / seed 由「管理员总开关」PR 拥有；本模块只按约定 schema 读取。
// value.enabled === true → 收费阶段；否则（含缺省）→ 提醒阶段。

export const PAYMENT_MASTER_KEY = 'payment_master'

export function toError(error) {
  if (error instanceof Error) return error
  const err = new Error(error?.message || 'app_config request failed')
  if (error?.code) err.code = error.code
  if (error?.status) err.status = error.status
  return err
}

/** @returns {boolean} true = 收费阶段；false = 提醒阶段（默认） */
export function parsePaymentMasterEnabled(row) {
  const value = row?.value
  if (value == null) return false
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value.enabled === true
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed?.enabled === true
    } catch {
      return false
    }
  }
  return false
}

export function supabasePaymentMasterIo(client) {
  return {
    async selectMaster() {
      const { data, error } = await client
        .from('app_config')
        .select('value')
        .eq('key', PAYMENT_MASTER_KEY)
        .maybeSingle()
      return { data, error }
    }
  }
}

/**
 * 成功时返回 boolean；失败抛错（提醒阶段调用方应 fail-open：不弹窗、不挡功能）。
 */
export async function readPaymentMasterEnabled(io) {
  const selected = await io.selectMaster()
  if (selected.error) throw toError(selected.error)
  return parsePaymentMasterEnabled(selected.data)
}
