import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REVOKED_SHARE_STATUS,
  UNCLAIMED_SHARE_COLUMNS,
  describeShareRemaining,
  isUnclaimedShare,
  listUnclaimedShares,
  pendingOutgoingShares,
  publicShareRow,
  revokeOutgoingShare,
  shareRemainingMs
} from './shareOutgoing.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const SHARE_ACTIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SHARE_LATER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SHARE_USED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SHARE_EXPIRED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ENV_ACCEPTED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const SENT_KEYS = [
  'tabSent',
  'shareHintRevoke',
  'sentHint',
  'sentLoading',
  'sentEmpty',
  'sentCodeLabel',
  'sentNoAlias',
  'aliasSeparator',
  'remainingExpired',
  'remainingUnderMinute',
  'remainingMinutes',
  'remainingHours',
  'remainingHoursMinutes',
  'revoke',
  'revokeHint',
  'revokeConfirm',
  'revokeCancel',
  'revoking',
  'revokeSuccess',
  'revokeFailed',
  'revokeAlreadyGone'
]

function loadLocale(name) {
  return JSON.parse(readFileSync(resolve(root, 'src/i18n/locales', name), 'utf8'))
}

function sliceBetween(sql, startMark, endMark) {
  const start = sql.indexOf(startMark)
  const end = sql.indexOf(endMark, start + startMark.length)
  assert.ok(start !== -1 && end !== -1, `missing SQL section ${startMark}`)
  return sql.slice(start, end).replace(/\s*TABLESPACE pg_default/gi, '')
}

function shareT(key, params = {}) {
  const messages = {
    'share.revokeAlreadyGone': '这份分享已经不能作废，可能已被收下或已失效',
    'share.revokeFailed': `作废失败：${params.msg || ''}`,
    'share.querySharesFailed': `查询分享记录失败：${params.msg || ''}`,
    'share.supabaseNotInit': 'Supabase 未初始化'
  }
  return messages[key] || key
}

function recordingClient(result) {
  const ops = []
  const chain = {
    update(patch) {
      ops.push({ op: 'update', patch })
      return chain
    },
    delete() {
      ops.push({ op: 'delete' })
      return chain
    },
    select(cols) {
      ops.push({ op: 'select', cols })
      return chain
    },
    eq(col, val) {
      ops.push({ op: 'eq', col, val })
      return chain
    },
    is(col, val) {
      ops.push({ op: 'is', col, val })
      return chain
    },
    order(col, opts) {
      ops.push({ op: 'order', col, opts })
      return chain
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected)
    }
  }
  return {
    ops,
    from(table) {
      ops.push({ op: 'from', table })
      return chain
    }
  }
}

describe('pending outgoing shares', () => {
  const now = Date.parse('2026-11-11T00:00:00.000Z')

  const rows = [
    {
      id: SHARE_LATER,
      share_code: '222222',
      status: 'active',
      consumed_by: null,
      expires_at: '2026-11-11T20:00:00.000Z',
      encrypted_envs: [{ alias: ' 沙箱 ' }, { alias: '' }]
    },
    {
      id: SHARE_USED,
      share_code: '333333',
      status: 'used',
      consumed_by: USER_B,
      expires_at: '2026-11-11T01:00:00.000Z',
      encrypted_envs: [{ alias: '已收下' }]
    },
    {
      id: SHARE_ACTIVE,
      share_code: '111111',
      status: 'active',
      consumed_by: null,
      expires_at: '2026-11-11T02:30:00.000Z',
      encrypted_envs: [{ alias: '生产' }, { alias: 'UAT' }]
    },
    {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      share_code: '444444',
      status: 'revoked',
      consumed_by: null,
      expires_at: '2026-11-11T03:00:00.000Z',
      encrypted_envs: [{ alias: '已作废' }]
    },
    {
      id: SHARE_EXPIRED,
      share_code: '555555',
      status: 'active',
      consumed_by: null,
      expires_at: '2026-11-10T23:00:00.000Z',
      encrypted_envs: [{ alias: '过期仍列出' }]
    }
  ]

  it('lists only unaccepted shares and the time left, soonest first', () => {
    const listed = pendingOutgoingShares(rows, now)
    assert.deepEqual(listed.map((item) => item.shareCode), ['555555', '111111', '222222'])
    assert.equal(isUnclaimedShare(rows[1]), false)
    assert.equal(listed[1].aliases.join(','), '生产,UAT')
    assert.equal(listed[2].aliases.join(','), '沙箱')
    assert.equal(listed[0].expired, true)
    assert.equal(listed[0].remainingMs, 0)
    assert.equal(listed[1].expired, false)
    assert.equal(listed[1].remainingMs, (2 * 60 + 30) * 60 * 1000)
  })

  it('turns remaining time into copy keys', () => {
    assert.equal(describeShareRemaining(0).key, 'share.remainingExpired')
    assert.equal(describeShareRemaining(-1).key, 'share.remainingExpired')
    assert.equal(describeShareRemaining(59_999).key, 'share.remainingUnderMinute')
    assert.deepEqual(describeShareRemaining(60_000), {
      key: 'share.remainingMinutes',
      params: { minutes: 1 }
    })
    assert.deepEqual(describeShareRemaining(2 * 60 * 60 * 1000), {
      key: 'share.remainingHours',
      params: { hours: 2 }
    })
    assert.deepEqual(describeShareRemaining((2 * 60 + 5) * 60 * 1000), {
      key: 'share.remainingHoursMinutes',
      params: { hours: 2, minutes: 5 }
    })
    assert.equal(shareRemainingMs('not-a-date', now), 0)
  })

  it('drops ciphertext before the list reaches the screen', () => {
    const row = publicShareRow({
      id: SHARE_ACTIVE,
      env_ids: [ENV_ACCEPTED],
      share_code: '111111',
      status: 'active',
      expires_at: '2026-11-11T02:30:00.000Z',
      consumed_by: null,
      created_at: '2026-11-10T00:00:00.000Z',
      encrypted_envs: [{ alias: '生产', encrypted_env: { password: 'cipher-secret', iv: 'iv' } }]
    })
    assert.deepEqual(row.encrypted_envs, [{ alias: '生产' }])
    assert.equal(JSON.stringify(row).includes('cipher-secret'), false)
    assert.equal(UNCLAIMED_SHARE_COLUMNS.includes('verify_code'), false)
  })
})

describe('revoke outgoing share client', () => {
  it('only marks that active share revoked and does not touch environments', async () => {
    const client = recordingClient({ data: [{ id: SHARE_ACTIVE }], error: null })
    const result = await revokeOutgoingShare(SHARE_ACTIVE, { supabase: client, userId: USER_A, t: shareT })
    assert.deepEqual(result, { success: true })
    assert.deepEqual(client.ops, [
      { op: 'from', table: 'env_shares' },
      { op: 'update', patch: { status: REVOKED_SHARE_STATUS } },
      { op: 'eq', col: 'id', val: SHARE_ACTIVE },
      { op: 'eq', col: 'owner_user_id', val: USER_A },
      { op: 'eq', col: 'status', val: 'active' },
      { op: 'select', cols: 'id' }
    ])
    assert.equal(client.ops.some((op) => op.op === 'delete' || op.table === 'environments'), false)
  })

  it('reports a share that was already accepted or is no longer active', async () => {
    const client = recordingClient({ data: [], error: null })
    await assert.rejects(
      () => revokeOutgoingShare(SHARE_USED, { supabase: client, userId: USER_A, t: shareT }),
      /不能作废/
    )
  })

  it('lists unclaimed rows without the verify code or ciphertext', async () => {
    const client = recordingClient({
      data: [{
        id: SHARE_ACTIVE,
        env_ids: [],
        share_code: '111111',
        verify_code: '999999',
        status: 'active',
        expires_at: '2026-11-11T02:30:00.000Z',
        consumed_by: null,
        created_at: '2026-11-10T00:00:00.000Z',
        encrypted_envs: [{ alias: '生产', encrypted_env: { password: 'cipher-secret' } }]
      }],
      error: null
    })
    const rows = await listUnclaimedShares({ supabase: client, userId: USER_A, t: shareT })
    assert.equal(rows[0].verify_code, undefined)
    assert.equal(JSON.stringify(rows).includes('cipher-secret'), false)
    assert.equal(JSON.stringify(rows).includes('999999'), false)
    assert.deepEqual(client.ops.filter((op) => op.op === 'from').map((op) => op.table), ['env_shares'])
    const selected = client.ops.find((op) => op.op === 'select').cols
    assert.equal(selected, UNCLAIMED_SHARE_COLUMNS)
    assert.equal(selected.includes('verify_code'), false)
  })
})

describe('share revoke copy and dialog', () => {
  it('adds the same sent-share keys in Chinese, English, and Japanese', () => {
    const zh = loadLocale('zh-CN.json').share
    const en = loadLocale('en.json').share
    const ja = loadLocale('ja.json').share
    assert.deepEqual(Object.keys(zh), Object.keys(en))
    assert.deepEqual(Object.keys(zh), Object.keys(ja))
    for (const key of SENT_KEYS) {
      assert.equal(typeof zh[key], 'string')
      assert.notEqual(zh[key], en[key])
      if (key !== 'aliasSeparator') assert.notEqual(zh[key], ja[key])
      assert.doesNotMatch(en[key], /[\u3400-\u9fff]/)
      const placeholders = zh[key].match(/\{[a-z]+\}/g) || []
      for (const token of placeholders) {
        assert.ok(en[key].includes(token), `en ${key} missing ${token}`)
        assert.ok(ja[key].includes(token), `ja ${key} missing ${token}`)
      }
    }

    const dialog = readFileSync(resolve(root, 'src/components/ShareDialog.vue'), 'utf8')
    const outgoing = readFileSync(resolve(root, 'src/composables/shareOutgoing.js'), 'utf8')
    const template = dialog.slice(dialog.indexOf('<template>'), dialog.indexOf('</template>'))
    assert.match(template, /mode === 'sent'/)
    assert.match(template, /share\.revokeHint/)
    assert.match(template, /share\.sentHint/)
    const visibleTemplate = template.replace(/<!--[\s\S]*?-->/g, '')
    assert.doesNotMatch(visibleTemplate, /[\u3400-\u9fff]/)
    const wired = `${dialog}\n${outgoing}`
    for (const key of SENT_KEYS) {
      assert.match(wired, new RegExp(`share\\.${key}`))
    }
  })

  it('keeps acceptance behind an active share and never deletes or edits environments on revoke', () => {
    const outgoing = readFileSync(resolve(root, 'src/composables/shareOutgoing.js'), 'utf8')
    const revokeFn = outgoing.slice(
      outgoing.indexOf('export async function revokeOutgoingShare'),
      outgoing.indexOf('export async function listUnclaimedShares')
    )
    assert.doesNotMatch(revokeFn, /\.delete\(|environments/)
    assert.match(revokeFn, /status: REVOKED_SHARE_STATUS/)
    assert.match(revokeFn, /\.eq\('status', 'active'\)/)
    assert.doesNotMatch(outgoing, /\.delete\(/)

    const src = readFileSync(resolve(root, 'src/composables/useShare.js'), 'utf8')
    assert.match(src, /revokeOutgoingShare\(shareId, outgoingDeps\(\)\)/)
    assert.doesNotMatch(src, /\.delete\(/)
    const lookupAt = src.indexOf("rpc('accept_share_lookup'")
    const insertAt = src.indexOf('.insert(encrypted)', lookupAt)
    assert.ok(lookupAt !== -1 && insertAt !== -1 && lookupAt < insertAt)

    const schema = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    const lookup = sliceBetween(
      schema,
      '-- ---------- 函数：accept_share_lookup',
      '-- ---------- 函数：accept_share_mark_used'
    )
    assert.match(lookup, /status = 'active'/)
    assert.match(lookup, /expires_at > now\(\)/)
  })
})

describe('schema: voided code cannot be accepted', () => {
  it('rejects a revoked code and leaves an already accepted environment unchanged', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite()
    const schema = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    const tableSql = sliceBetween(
      schema,
      '-- ---------- 表：env_shares 分享记录 ----------',
      '-- ---------- 表：environments 环境数据 ----------'
    )
    const lookupSql = sliceBetween(
      schema,
      '-- ---------- 函数：accept_share_lookup',
      '-- ---------- 函数：accept_share_mark_used'
    )
    const markSql = sliceBetween(
      schema,
      '-- ---------- 函数：accept_share_mark_used',
      '-- ---------- 函数：touch_updated_at'
    )
    const policySql = sliceBetween(
      schema,
      '-- env_shares：用户管理自己创建的分享',
      '-- environments'
    )

    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
      $$;
      DO $$ BEGIN
        CREATE ROLE authenticated;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    `)
    await db.exec(tableSql)
    await db.exec(lookupSql)
    await db.exec(markSql)
    await db.exec(policySql)
    await db.exec(`
      GRANT SELECT, UPDATE ON public.env_shares TO authenticated;
      GRANT EXECUTE ON FUNCTION public.accept_share_lookup(text, text) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.accept_share_mark_used(text, uuid) TO authenticated;
      ALTER TABLE public.env_shares FORCE ROW LEVEL SECURITY;
      CREATE TABLE public.environments (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        alias text NOT NULL,
        password text NOT NULL
      );
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
      INSERT INTO public.environments (id, user_id, alias, password)
      VALUES ('${ENV_ACCEPTED}', '${USER_B}', '已收下的生产', 'copied-secret');
    `)

    const activeEnvs = JSON.stringify([
      { alias: '生产', encrypted_env: { password: 'active-cipher' } }
    ])
    const laterEnvs = JSON.stringify([{ alias: '沙箱', encrypted_env: { password: 'later-cipher' } }])
    const usedEnvs = JSON.stringify([{ alias: '已收下的生产', encrypted_env: { password: 'used-cipher' } }])
    const expiredEnvs = JSON.stringify([{ alias: '过期', encrypted_env: { password: 'expired-cipher' } }])

    await db.query(
      `INSERT INTO public.env_shares
        (id, env_ids, owner_user_id, share_code, verify_code, encrypted_envs, status, expires_at, consumed_by)
       VALUES
        ($1, $2::uuid[], $3, '111111', '222222', $4::jsonb, 'active', now() + interval '2 hours', null),
        ($5, $2::uuid[], $3, '333333', '444444', $6::jsonb, 'active', now() + interval '20 hours', null),
        ($7, $2::uuid[], $3, '555555', '666666', $8::jsonb, 'used', now() + interval '3 hours', $9),
        ($10, $2::uuid[], $3, '777777', '888888', $11::jsonb, 'active', now() - interval '1 hour', null)`,
      [
        SHARE_ACTIVE, [ENV_ACCEPTED], USER_A, activeEnvs,
        SHARE_LATER, laterEnvs,
        SHARE_USED, usedEnvs, USER_B,
        SHARE_EXPIRED, expiredEnvs
      ]
    )

    async function asUser(id, fn) {
      await db.exec('RESET ROLE')
      await db.query(`SELECT set_config('app.user_id', $1, false)`, [id])
      await db.exec('SET ROLE authenticated')
      try {
        return await fn()
      } finally {
        await db.exec('RESET ROLE')
      }
    }

    async function lookup(code, verify) {
      const found = await asUser(USER_B, () => db.query(
        `SELECT public.accept_share_lookup($1, $2) AS share`,
        [code, verify]
      ))
      return found.rows[0].share
    }

    async function environments() {
      const found = await db.query(
        `SELECT id::text, user_id::text, alias, password
         FROM public.environments ORDER BY id`
      )
      return found.rows
    }

    const beforeEnvs = await environments()
    assert.deepEqual(beforeEnvs, [{
      id: ENV_ACCEPTED,
      user_id: USER_B,
      alias: '已收下的生产',
      password: 'copied-secret'
    }])

    const openShare = await lookup('111111', '222222')
    assert.ok(openShare)
    assert.equal(await lookup('111111', '000000'), null)
    assert.equal(await lookup('777777', '888888'), null)
    assert.equal(await lookup('555555', '666666'), null)

    const blocked = await asUser(USER_B, () => db.query(
      `UPDATE public.env_shares
       SET status = 'revoked'
       WHERE id = $1 AND owner_user_id = $2 AND status = 'active'`,
      [SHARE_ACTIVE, USER_A]
    ))
    assert.equal(Number(blocked.affectedRows ?? blocked.rowCount ?? 0), 0)
    assert.ok(await lookup('111111', '222222'))

    const revoked = await asUser(USER_A, () => db.query(
      `UPDATE public.env_shares
       SET status = 'revoked'
       WHERE id = $1 AND owner_user_id = $2 AND status = 'active'
       RETURNING id`,
      [SHARE_ACTIVE, USER_A]
    ))
    assert.equal(revoked.rows.length, 1)
    assert.equal(await lookup('111111', '222222'), null)

    const stillOpen = await lookup('333333', '444444')
    assert.ok(stillOpen)

    const marked = await asUser(USER_B, () => db.query(
      `SELECT public.accept_share_mark_used($1, $2) AS marked`,
      ['111111', USER_B]
    ))
    assert.equal(marked.rows[0].marked, false)

    const states = await db.query(
      `SELECT id::text, status, consumed_by::text AS consumed_by
       FROM public.env_shares ORDER BY share_code`
    )
    assert.deepEqual(states.rows, [
      { id: SHARE_ACTIVE, status: 'revoked', consumed_by: null },
      { id: SHARE_LATER, status: 'active', consumed_by: null },
      { id: SHARE_USED, status: 'used', consumed_by: USER_B },
      { id: SHARE_EXPIRED, status: 'active', consumed_by: null }
    ])
    assert.deepEqual(await environments(), beforeEnvs)

    const visible = await db.query(
      `SELECT id::text, share_code, status, expires_at, consumed_by, encrypted_envs
       FROM public.env_shares
       WHERE owner_user_id = $1 AND status = 'active' AND consumed_by IS NULL
       ORDER BY expires_at ASC`,
      [USER_A]
    )
    const pending = pendingOutgoingShares(visible.rows, Date.now())
    assert.deepEqual(pending.map((item) => item.shareCode), ['777777', '333333'])
    assert.equal(pending[0].expired, true)
    assert.equal(pending[1].expired, false)
    assert.deepEqual(pending[1].aliases, ['沙箱'])
    assert.equal(JSON.stringify(pending).includes('later-cipher'), false)

    await db.close()
  })
})
