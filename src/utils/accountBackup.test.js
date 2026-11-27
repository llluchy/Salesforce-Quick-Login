import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFilename,
  buildBackupPlain,
  openAccountBackup,
  planAccountImport,
  sealAccountBackup
} from './accountBackup.js'

describe('accountBackup', () => {
  it('builds plain payload with secrets and drops virtual groups', () => {
    const plain = buildBackupPlain({
      groups: [
        { id: 'ungrouped', name: '未分组', isVirtual: true },
        { id: 'g1', name: '生产', sortOrder: 1, collapsed: true }
      ],
      environments: [
        {
          alias: 'A',
          type: 'sandbox',
          username: 'u@x.com',
          password: 'secret',
          customUrl: 'https://x.test',
          groupId: 'g1',
          totpSecret: 'JBSWY3DPEHPK3PXP',
          passkeys: [{ credentialId: 'cid', privateKeyJwk: { kty: 'EC' }, rpId: 'login.salesforce.com' }],
          sortOrder: 2
        },
        {
          alias: 'orphan',
          username: 'o',
          password: 'p',
          groupId: 'missing-group'
        }
      ]
    })

    assert.equal(plain.groups.length, 1)
    assert.equal(plain.groups[0].id, 'g1')
    assert.equal(plain.environments.length, 2)
    assert.equal(plain.environments[0].username, 'u@x.com')
    assert.equal(plain.environments[0].password, 'secret')
    assert.equal(plain.environments[0].totpSecret, 'JBSWY3DPEHPK3PXP')
    assert.equal(plain.environments[0].passkeys[0].credentialId, 'cid')
    assert.equal(plain.environments[1].groupId, 'ungrouped')
  })

  it('round-trips seal/open with passphrase', async () => {
    const plain = buildBackupPlain({
      groups: [{ id: 'g1', name: 'G' }],
      environments: [{
        alias: 'A',
        username: 'user',
        password: 'pass',
        totpSecret: 'ABCD',
        passkeys: [{ credentialId: 'x', privateKeyJwk: { d: '1' }, rpId: 'login.salesforce.com' }],
        groupId: 'g1'
      }]
    })

    const sealed = await sealAccountBackup(plain, 'backup-pass-1')
    assert.equal(sealed.format, BACKUP_FORMAT)
    assert.equal(sealed.version, BACKUP_VERSION)
    assert.equal(sealed.envCount, 1)
    assert.ok(sealed.ciphertext)
    assert.ok(!JSON.stringify(sealed).includes('backup-pass-1'))
    assert.ok(!JSON.stringify(sealed).includes('"user"'))

    const opened = await openAccountBackup(sealed, 'backup-pass-1')
    assert.equal(opened.environments[0].username, 'user')
    assert.equal(opened.environments[0].password, 'pass')
    assert.equal(opened.environments[0].totpSecret, 'ABCD')
    assert.equal(opened.environments[0].passkeys[0].credentialId, 'x')
    assert.equal(opened.groups[0].name, 'G')

    await assert.rejects(
      () => openAccountBackup(sealed, 'wrong-password'),
      (e) => e.code === 'WRONG_PASSWORD'
    )
  })

  it('plans import with fresh ids and remapped groups', () => {
    const planned = planAccountImport({
      groups: [{ id: 'old-g', name: 'Prod', sortOrder: 3, collapsed: true }],
      environments: [
        { alias: 'A', username: 'u', password: 'p', groupId: 'old-g', totpSecret: '', passkeys: [] },
        { alias: 'B', username: 'u2', password: 'p2', groupId: 'ungrouped', totpSecret: '', passkeys: [] }
      ]
    }, { now: 1000 })

    assert.equal(planned.groupsToSave.length, 1)
    assert.notEqual(planned.groupsToSave[0].id, 'old-g')
    assert.equal(planned.groupsToSave[0].name, 'Prod')
    assert.equal(planned.envsToSave.length, 2)
    assert.equal(planned.envsToSave[0].groupId, planned.groupsToSave[0].id)
    assert.equal(planned.envsToSave[1].groupId, 'ungrouped')
    assert.notEqual(planned.envsToSave[0].id, planned.envsToSave[1].id)
  })

  it('builds dated filename', () => {
    assert.match(backupFilename(new Date('2026-11-27T00:00:00.000Z')), /^sfql-account-backup-20261127\.json$/)
  })
})
