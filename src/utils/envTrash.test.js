import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TRASH_RETENTION_MS,
  TrashGoneError,
  carryTrashFlags,
  daysRemaining,
  isRecoverableTrash,
  listRecoverableTrash,
  purgeExpiredTrash,
  restorePatch,
  restoreTrashedEnvironment,
  softDeletePatch,
  trashCutoffIso
} from './envTrash.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const NOW = Date.parse('2026-11-11T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const OWNER = '11111111-1111-4111-8111-111111111111'
const RECIPIENT = '22222222-2222-4222-8222-222222222222'
const GROUP_ID = '33333333-3333-4333-8333-333333333333'

function iso(ms) {
  return new Date(ms).toISOString()
}

function envRow(overrides = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user_id: OWNER,
    alias: '生产',
    username: 'cipher-user',
    password: 'cipher-pass',
    totp_secret: 'cipher-totp',
    group_id: GROUP_ID,
    passkeys: '[]',
    type: 'production',
    is_deleted: true,
    deleted_at: iso(NOW - 2 * DAY),
    ...overrides
  }
}

function createTable(initial) {
  const rows = initial.map((row) => ({ ...row }))
  const ops = []

  function matches(row, filters) {
    return filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val
      if (op === 'gte') return row[col] != null && String(row[col]) >= String(val)
      if (op === 'lt') return row[col] != null && String(row[col]) < String(val)
      if (op === 'is') return val === null ? row[col] == null : row[col] === val
      return false
    })
  }

  const supabase = {
    from(table) {
      const state = { table, op: 'select', filters: [], patch: null }
      const api = {
        select() {
          return api
        },
        delete() {
          state.op = 'delete'
          return api
        },
        update(patch) {
          state.op = 'update'
          state.patch = patch
          return api
        },
        eq(col, val) {
          state.filters.push(['eq', col, val])
          return api
        },
        gte(col, val) {
          state.filters.push(['gte', col, val])
          return api
        },
        lt(col, val) {
          state.filters.push(['lt', col, val])
          return api
        },
        is(col, val) {
          state.filters.push(['is', col, val])
          return api
        },
        order() {
          return api
        },
        then(resolve, reject) {
          ops.push({
            table: state.table,
            op: state.op,
            filters: state.filters.map((item) => [...item]),
            patch: state.patch ? { ...state.patch } : null
          })
          if (state.table !== 'environments') {
            return Promise.resolve({
              data: null,
              error: { message: `unexpected table ${state.table}` }
            }).then(resolve, reject)
          }
          const matched = rows.filter((row) => matches(row, state.filters))
          if (state.op === 'delete') {
            for (const row of [...matched]) {
              const index = rows.indexOf(row)
              if (index >= 0) rows.splice(index, 1)
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject)
          }
          if (state.op === 'update') {
            for (const row of matched) Object.assign(row, state.patch)
            return Promise.resolve({
              data: matched.map((row) => ({ ...row })),
              error: null
            }).then(resolve, reject)
          }
          return Promise.resolve({
            data: matched.map((row) => ({ ...row })),
            error: null
          }).then(resolve, reject)
        }
      }
      return api
    }
  }

  return { supabase, rows, ops }
}

function installChromeGuard() {
  const writes = []
  const fail = (area, method) => () => {
    writes.push([area, method])
    throw new Error(`${area}.${method} forbidden`)
  }
  globalThis.chrome = {
    storage: {
      local: { get: fail('local', 'get'), set: fail('local', 'set'), remove: fail('local', 'remove') },
      sync: { get: fail('local', 'get'), set: fail('sync', 'set'), remove: fail('sync', 'remove') }
    }
  }
  return writes
}

async function identityDecrypt(row) {
  return {
    id: row.id,
    alias: row.alias,
    username: row.username,
    password: row.password,
    totpSecret: row.totp_secret,
    groupId: row.group_id,
    passkeys: row.passkeys
  }
}

describe('env trash window', () => {
  it('keeps an environment recoverable for seven days and drops it after that', () => {
    const within = envRow({ deleted_at: iso(NOW - TRASH_RETENTION_MS) })
    const expired = envRow({ deleted_at: iso(NOW - TRASH_RETENTION_MS - 1) })
    const missingTime = envRow({ deleted_at: null })
    const active = envRow({ is_deleted: false, deleted_at: iso(NOW - DAY) })

    assert.equal(isRecoverableTrash(within, NOW), true)
    assert.equal(isRecoverableTrash(expired, NOW), false)
    assert.equal(isRecoverableTrash(missingTime, NOW), false)
    assert.equal(isRecoverableTrash(active, NOW), false)
    assert.equal(daysRemaining(iso(NOW), NOW), 7)
    assert.equal(daysRemaining(iso(NOW - 6 * DAY - 1), NOW), 1)
  })

  it('soft-deletes and restores by flags only', () => {
    const deleted = softDeletePatch(NOW)
    assert.deepEqual(Object.keys(deleted).sort(), ['deleted_at', 'is_deleted'])
    assert.equal(deleted.is_deleted, true)
    assert.equal(deleted.deleted_at, iso(NOW))

    const restored = restorePatch()
    assert.deepEqual(restored, { is_deleted: false, deleted_at: null })
    assert.equal(Object.hasOwn(restored, 'alias'), false)
    assert.equal(Object.hasOwn(restored, 'username'), false)
    assert.equal(Object.hasOwn(restored, 'password'), false)
    assert.equal(Object.hasOwn(restored, 'totp_secret'), false)
    assert.equal(Object.hasOwn(restored, 'group_id'), false)
    assert.equal(Object.hasOwn(restored, 'passkeys'), false)
  })

  it('keeps trash flags when re-encrypting after a password change', () => {
    const original = [
      envRow({ id: 'deleted-row', is_deleted: true, deleted_at: iso(NOW - DAY) }),
      envRow({ id: 'active-row', is_deleted: false, deleted_at: iso(NOW - DAY) })
    ]
    const reencrypted = original.map((row) => ({
      id: row.id,
      alias: row.alias,
      username: 'new-cipher-user',
      password: 'new-cipher-pass',
      totp_secret: 'new-cipher-totp',
      group_id: row.group_id
    }))
    const carried = carryTrashFlags(original, reencrypted)
    assert.equal(carried[0].is_deleted, true)
    assert.equal(carried[0].deleted_at, iso(NOW - DAY))
    assert.equal(carried[0].password, 'new-cipher-pass')
    assert.equal(carried[0].group_id, GROUP_ID)
    assert.equal(carried[1].is_deleted, false)
    assert.equal(carried[1].deleted_at, null)
  })
})

describe('env trash supabase operations', () => {
  it('lists, restores, and purges without writing chrome.storage.local or sync', async () => {
    const writes = installChromeGuard()
    const acceptedCopy = envRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      user_id: RECIPIENT,
      is_deleted: false,
      deleted_at: null,
      alias: '生产-已收下'
    })
    const recoverable = envRow()
    const expired = envRow({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      deleted_at: iso(NOW - TRASH_RETENTION_MS - 1)
    })
    const undated = envRow({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      deleted_at: null
    })
    const share = {
      id: 'share-1',
      owner_user_id: OWNER,
      env_ids: [recoverable.id],
      status: 'used',
      consumed_by: RECIPIENT
    }
    const table = createTable([recoverable, expired, undated, acceptedCopy])
    table.rows.shares = [share]

    const listed = await listRecoverableTrash(table.supabase, {
      now: NOW,
      decrypt: identityDecrypt
    })
    assert.equal(listed.length, 1)
    assert.equal(listed[0].id, recoverable.id)
    assert.equal(listed[0].alias, '生产')
    assert.equal(listed[0].username, 'cipher-user')
    assert.equal(listed[0].password, 'cipher-pass')
    assert.equal(listed[0].totpSecret, 'cipher-totp')
    assert.equal(listed[0].groupId, GROUP_ID)

    const restored = await restoreTrashedEnvironment(table.supabase, {
      id: recoverable.id,
      decrypt: identityDecrypt
    })
    assert.equal(restored.alias, '生产')
    assert.equal(restored.username, 'cipher-user')
    assert.equal(restored.password, 'cipher-pass')
    assert.equal(restored.totpSecret, 'cipher-totp')
    assert.equal(restored.groupId, GROUP_ID)
    assert.equal(restored.passkeys, '[]')

    const stored = table.rows.find((row) => row.id === recoverable.id)
    assert.equal(stored.is_deleted, false)
    assert.equal(stored.deleted_at, null)
    assert.equal(stored.group_id, GROUP_ID)
    assert.equal(stored.password, 'cipher-pass')

    await assert.rejects(
      () => restoreTrashedEnvironment(table.supabase, {
        id: acceptedCopy.id,
        decrypt: identityDecrypt
      }),
      (error) => error instanceof TrashGoneError
    )
    const copy = table.rows.find((row) => row.id === acceptedCopy.id)
    assert.equal(copy.is_deleted, false)
    assert.equal(copy.user_id, RECIPIENT)
    assert.equal(copy.alias, '生产-已收下')
    assert.equal(copy.password, 'cipher-pass')

    await purgeExpiredTrash(table.supabase, { now: NOW })
    const ids = table.rows.map((row) => row.id).sort()
    assert.deepEqual(ids, [acceptedCopy.id, recoverable.id].sort())
    assert.equal(table.rows.shares.length, 1)
    assert.equal(table.ops.some((op) => op.table === 'env_shares'), false)
    assert.equal(table.ops.every((op) => op.table === 'environments'), true)

    const restoreOp = table.ops.find((op) => op.op === 'update')
    assert.deepEqual(restoreOp.patch, restorePatch())
    assert.equal(writes.length, 0)

    const cutoff = trashCutoffIso(NOW)
    const listOp = table.ops.find((op) => op.op === 'select')
    assert.deepEqual(listOp.filters, [
      ['eq', 'is_deleted', true],
      ['gte', 'deleted_at', cutoff]
    ])
  })
})

describe('env trash copy', () => {
  it('has the new strings in zh-CN, en, and ja', () => {
    const locales = ['zh-CN', 'en', 'ja'].map((locale) =>
      JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${locale}.json`), 'utf8'))
    )
    const required = [
      ['toolbar', 'trash'],
      ['toolbar', 'trashTitle'],
      ['delete', 'envHint'],
      ['trash', 'title'],
      ['trash', 'hint'],
      ['trash', 'empty'],
      ['trash', 'restore'],
      ['trash', 'daysLeft'],
      ['trash', 'restored'],
      ['trash', 'expiredHint'],
      ['trash', 'shareUnaffected'],
      ['trash', 'gone']
    ]
    const seen = []
    for (const [section, key] of required) {
      const values = locales.map((messages) => messages[section]?.[key])
      for (const value of values) {
        assert.equal(typeof value, 'string')
        assert.ok(value.trim().length > 0)
      }
      assert.equal(new Set(values).size, 3)
      seen.push(values[0])
    }
    assert.match(seen[0], /回收处/)
    const schema = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    assert.match(schema, /is_deleted boolean not null default false/)
    assert.match(schema, /deleted_at timestamp with time zone null/)
    assert.match(schema, /7 日/)

    const storage = readFileSync(resolve(root, 'src/composables/useStorage.js'), 'utf8')
    const trashStart = storage.indexOf('const loadTrashedEnvironments')
    const trashEnd = storage.indexOf('// 分组列表', trashStart)
    const trashFns = storage.slice(trashStart, trashEnd).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.ok(trashStart > 0 && trashEnd > trashStart)
    assert.equal(trashFns.includes('cacheSet'), false)
    assert.equal(trashFns.includes('cacheGet'), false)
    assert.equal(trashFns.includes('chrome.storage'), false)
    assert.equal(trashFns.includes('localStorage'), false)
  })
})
