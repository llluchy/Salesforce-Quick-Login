import { getCryptoKeyRaw } from './useAuth'
import { useStorage } from './useStorage'
import { t } from '../i18n'
import {
  backupFilename,
  buildBackupPlain,
  openAccountBackup,
  planAccountImport,
  sealAccountBackup
} from '../utils/accountBackup.js'

function mapBackupError(e) {
  const code = e?.code || e?.message
  if (code === 'PASSWORD_TOO_SHORT') return t('account.backupPasswordMin')
  if (code === 'INVALID_FORMAT') return t('account.backupInvalidFile')
  if (code === 'UNSUPPORTED_VERSION') return t('account.backupUnsupportedVersion')
  if (code === 'WRONG_PASSWORD') return t('account.backupWrongPassword')
  return e?.message || t('account.backupFailed')
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 导出 / 导入当前账户全部环境（含用户名、密码、TOTP、Passkey）与分组。
 */
export function useAccountBackup() {
  const { loadEnvironments, loadGroups, saveEnvironments, saveGroups } = useStorage()

  async function exportAccountBackup(passphrase) {
    if (!getCryptoKeyRaw()) {
      throw new Error(t('account.backupNeedUnlock'))
    }

    const [environments, groups] = await Promise.all([
      loadEnvironments(),
      loadGroups()
    ])

    const plain = buildBackupPlain({ environments, groups })
    if (plain.environments.length === 0) {
      throw new Error(t('account.backupEmpty'))
    }

    const sealed = await sealAccountBackup(plain, passphrase)
    downloadJson(sealed, backupFilename())
    return {
      envCount: sealed.envCount,
      groupCount: sealed.groupCount
    }
  }

  async function importAccountBackup(fileText, passphrase) {
    if (!getCryptoKeyRaw()) {
      throw new Error(t('account.backupNeedUnlock'))
    }

    let fileObj
    try {
      fileObj = JSON.parse(fileText)
    } catch {
      const err = new Error('INVALID_FORMAT')
      err.code = 'INVALID_FORMAT'
      throw new Error(mapBackupError(err))
    }

    let plain
    try {
      plain = await openAccountBackup(fileObj, passphrase)
    } catch (e) {
      throw new Error(mapBackupError(e))
    }

    if (!plain.environments.length) {
      throw new Error(t('account.backupEmptyFile'))
    }

    const { groupsToSave, envsToSave } = planAccountImport(plain)

    const existingGroups = await loadGroups()
    const existingEnvs = await loadEnvironments()
    const keptGroups = (Array.isArray(existingGroups) ? existingGroups : [])
      .filter((g) => g && g.id && g.id !== 'ungrouped' && !g.isVirtual)

    if (groupsToSave.length > 0 || keptGroups.length > 0) {
      const groupResult = await saveGroups([...keptGroups, ...groupsToSave])
      if (!groupResult?.success) {
        throw new Error(groupResult?.error || t('account.backupImportFailed'))
      }
    }

    const keptEnvs = Array.isArray(existingEnvs) ? existingEnvs : []
    const envResult = await saveEnvironments([...keptEnvs, ...envsToSave])
    if (!envResult?.success) {
      throw new Error(envResult?.error || t('account.backupImportFailed'))
    }

    return {
      envCount: envsToSave.length,
      groupCount: groupsToSave.length
    }
  }

  return {
    exportAccountBackup,
    importAccountBackup,
    mapBackupError
  }
}
