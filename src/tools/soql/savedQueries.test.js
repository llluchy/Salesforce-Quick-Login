import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORAGE_KEY_SESSION } from '../../utils/constants.js'
import {
  SAVED_SOQL_MAX_COUNT,
  SAVED_SOQL_NAME_MAX,
  SAVED_SOQL_SESSION_KEY,
  SAVED_SOQL_TEXT_MAX,
  applyDeleteResult,
  applySaveResult,
  createSavedQueryStore,
  createSavedSoqlRestIo,
  readSessionQueries,
  sanitizeSavedQuery,
  savedQueryEditorText
} from './savedQueries.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const QUERY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const QUERY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SOQL = 'SELECT Id, Name FROM Account WHERE Name = \'Acme\''
const SAVED_KEYS = [
  'savedTitle',
  'saveQuery',
  'saveQueryTitle',
  'saveNameLabel',
  'saveNamePlaceholder',
  'saveConfirm',
  'savingQuery',
  'savedEmpty',
  'savedLoggedInHint',
  'savedLoggedOutHint',
  'saveWhereLoggedIn',
  'saveWhereLoggedOut',
  'openedSaved',
  'runNeedsSalesforce',
  'deleteSaved',
  'confirmDeleteSavedTitle',
  'confirmDeleteSavedBody',
  'saveFailed',
  'saveNeedSoql',
  'saveNeedName',
  'nameTooLong',
  'soqlTooLong',
  'savedLimit',
  'loadFailed',
  'deleteFailed',
  'savedOk',
  'deletedSaved',
  'openSaved',
  'savedPreviewLabel'
]

function pick(data, keys) {
  if (keys == null) return { ...data }
  const list = Array.isArray(keys) ? keys : [keys]
  const out = {}
  for (const key of list) {
    if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key]
  }
  return out
}

function createMemoryArea(initial = {}) {
  const data = { ...initial }
  return {
    data,
    async get(keys) {
      return pick(data, keys)
    },
    async set(obj) {
      Object.assign(data, obj)
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const key of list) delete data[key]
    }
  }
}

function legacyLocal() {
  return {
    salesforce_environments: [{ id: 'env-1', password: 'secret' }],
    salesforce_groups: [{ id: 'group-1' }],
    ui_locale: 'ja',
    sfql_tool_float_pos: { top: 80, right: 0 }
  }
}

function createGuardedStorage(sessionInitial = {}) {
  const localData = legacyLocal()
  const syncData = { leftover: true }
  const forbidden = []
  const guard = (name, data) => ({
    async get(keys) {
      return pick(data, keys)
    },
    async set(obj) {
      forbidden.push([name, 'set', obj])
      throw new Error(`${name} set forbidden`)
    },
    async remove(keys) {
      forbidden.push([name, 'remove', keys])
      throw new Error(`${name} remove forbidden`)
    }
  })
  const session = createMemoryArea(sessionInitial)
  return {
    storage: {
      session,
      local: guard('local', localData),
      sync: guard('sync', syncData)
    },
    localData,
    syncData,
    forbidden,
    session
  }
}

function snapshotStorage(guard) {
  return {
    local: JSON.parse(JSON.stringify(guard.localData)),
    sync: JSON.parse(JSON.stringify(guard.syncData)),
    forbidden: guard.forbidden.length,
    session: JSON.parse(JSON.stringify(guard.session.data))
  }
}

function assertDurableUntouched(guard, before) {
  assert.deepEqual(guard.localData, before.local)
  assert.deepEqual(guard.syncData, before.sync)
  assert.equal(guard.forbidden.length, before.forbidden)
  assert.equal(Object.hasOwn(guard.localData, SAVED_SOQL_SESSION_KEY), false)
  assert.equal(Object.hasOwn(guard.syncData, SAVED_SOQL_SESSION_KEY), false)
}

function authSession(id) {
  return { access_token: `token-${id}`, user: { id } }
}

function clock(start = '2026-11-11T00:00:00.000Z') {
  let n = 0
  const origin = Date.parse(start)
  return () => new Date(origin + n++ * 1000).toISOString()
}

function ids(...values) {
  let n = 0
  return () => values[n++]
}

function createCloud(initial = []) {
  const rows = initial.map((row) => ({ ...row }))
  const calls = []
  async function fetchImpl(url, options = {}) {
    const method = options.method || 'GET'
    calls.push({
      url,
      method,
      body: options.body ? JSON.parse(options.body) : null,
      authorization: options.headers?.Authorization,
      apikey: options.headers?.apikey
    })
    const parsed = new URL(url)
    const userFilter = parsed.searchParams.get('user_id') || ''
    const userId = userFilter.startsWith('eq.') ? userFilter.slice(3) : ''
    const idFilter = parsed.searchParams.get('id') || ''
    const id = idFilter.startsWith('eq.') ? idFilter.slice(3) : ''
    if (options.headers?.Authorization === 'Bearer expired') {
      return new Response(JSON.stringify({ message: 'JWT expired', code: 'PGRST301' }), { status: 401 })
    }
    if (method === 'GET') {
      const mine = rows.filter((row) => row.user_id === userId)
      return new Response(JSON.stringify(mine), { status: 200 })
    }
    if (method === 'POST') {
      const body = JSON.parse(options.body)
      if (!body.user_id || !body.name || !body.soql || body.hostname || body.sessionId) {
        return new Response(JSON.stringify({ message: 'bad row' }), { status: 400 })
      }
      if (body.name === 'boom') {
        return new Response(JSON.stringify({ message: 'insert failed' }), { status: 500 })
      }
      const row = {
        id: body.user_id === USER_B ? QUERY_B : QUERY_A,
        user_id: body.user_id,
        name: body.name,
        soql: body.soql,
        created_at: '2026-11-11T03:00:00.000Z'
      }
      if (options.headers?.Prefer !== 'return=representation') {
        return new Response(null, { status: 201 })
      }
      rows.push(row)
      if (body.name === 'silent') return new Response('[]', { status: 201 })
      return new Response(JSON.stringify([row]), { status: 201 })
    }
    if (method === 'DELETE') {
      const index = rows.findIndex((row) => row.user_id === userId && row.id === id)
      if (index < 0) return new Response('[]', { status: 200 })
      const [row] = rows.splice(index, 1)
      return new Response(JSON.stringify([row]), { status: 200 })
    }
    return new Response(JSON.stringify({ message: 'nope' }), { status: 500 })
  }
  return { fetchImpl, rows, calls }
}

function storeFor(guard, extra = {}) {
  return createSavedQueryStore({
    storage: guard.storage,
    supabaseUrl: 'https://example.supabase.co',
    anonKey: 'anon-key',
    now: extra.now || clock(),
    createId: extra.createId || ids(QUERY_A, QUERY_B),
    fetchImpl: extra.fetchImpl
  })
}

describe('saved queries while logged out', () => {
  it('keeps a named query in session storage and nowhere else', async () => {
    const guard = createGuardedStorage()
    const before = snapshotStorage(guard)
    const saved = storeFor(guard)
    const result = await saved.save({ name: '  本周商机  ', soql: `  ${SOQL}  ` })
    assert.equal(result.ok, true)
    assert.equal(result.loggedIn, false)
    assert.equal(result.saved.name, '本周商机')
    assert.equal(result.saved.soql, SOQL)
    assert.deepEqual(Object.keys(result.saved).sort(), ['createdAt', 'id', 'name', 'soql'])
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY][0].soql, SOQL)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY][0].hostname, undefined)
    assertDurableUntouched(guard, before)

    const fresh = createMemoryArea()
    assert.deepEqual(await readSessionQueries(fresh), [])
    const listed = await saved.list()
    assert.equal(listed.ok, true)
    assert.equal(listed.queries[0].id, QUERY_A)
    assert.equal(savedQueryEditorText(listed.queries[0]), SOQL)
  })

  it('does not show a query when session write fails', async () => {
    const guard = createGuardedStorage()
    const previous = [{ id: QUERY_B, name: '旧的', soql: 'SELECT Id FROM Contact', createdAt: '2026-11-01T00:00:00.000Z' }]
    guard.session.data[SAVED_SOQL_SESSION_KEY] = previous.map((row) => ({ ...row, hostname: 'org.my.salesforce.com', sid: 'secret' }))
    guard.storage.session.set = async () => {
      throw new Error('session unavailable')
    }
    const saved = storeFor(guard)
    const result = await saved.save({ name: '新的', soql: SOQL })
    assert.equal(result.ok, false)
    assert.equal(result.saved, null)
    assert.deepEqual(result.queries.map((query) => query.id), [QUERY_B])
    assert.equal(result.queries[0].hostname, undefined)
    assert.equal(applySaveResult(previous, result), previous)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY][0].name, '旧的')
    assert.equal(Object.hasOwn(guard.localData, SAVED_SOQL_SESSION_KEY), false)
  })

  it('rejects an empty name or query without writing', async () => {
    const guard = createGuardedStorage()
    const saved = storeFor(guard)
    const unnamed = await saved.save({ name: '   ', soql: SOQL })
    const empty = await saved.save({ name: '账户', soql: '  ' })
    assert.equal(unnamed.ok, false)
    assert.equal(unnamed.error, 'need-name')
    assert.equal(empty.error, 'need-soql')
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY], undefined)
    assert.equal(applySaveResult([{ id: QUERY_B }], unnamed).length, 1)
  })

  it('rejects oversized text and the 101st query', async () => {
    const guard = createGuardedStorage()
    const saved = storeFor(guard, { createId: ids(QUERY_A) })
    const longName = await saved.save({ name: '名'.repeat(SAVED_SOQL_NAME_MAX + 1), soql: SOQL })
    const longSoql = await saved.save({ name: '太长', soql: 'S'.repeat(SAVED_SOQL_TEXT_MAX + 1) })
    assert.equal(longName.error, 'name-too-long')
    assert.equal(longSoql.error, 'soql-too-long')

    const existing = Array.from({ length: SAVED_SOQL_MAX_COUNT }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `q${index}`,
      soql: 'SELECT Id FROM Account',
      createdAt: '2026-11-01T00:00:00.000Z'
    }))
    guard.session.data[SAVED_SOQL_SESSION_KEY] = existing
    const limited = await saved.save({ name: '再一条', soql: SOQL })
    assert.equal(limited.ok, false)
    assert.equal(limited.error, 'limit')
    assert.equal(limited.queries.length, SAVED_SOQL_MAX_COUNT)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY].length, SAVED_SOQL_MAX_COUNT)
    assert.equal(applySaveResult(existing, limited), existing)
  })

  it('drops a session query only after the write can be read back', async () => {
    const guard = createGuardedStorage()
    const saved = storeFor(guard)
    await saved.save({ name: '本周商机', soql: SOQL })
    const previous = (await saved.list()).queries
    const write = guard.storage.session.set.bind(guard.storage.session)
    guard.storage.session.set = async () => {
      throw new Error('remove failed')
    }
    const failed = await saved.remove(QUERY_A)
    assert.equal(failed.ok, false)
    assert.equal(applyDeleteResult(previous, QUERY_A, failed), previous)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY].length, 1)

    guard.storage.session.set = write
    const removed = await saved.remove(QUERY_A)
    assert.equal(removed.ok, true)
    assert.deepEqual(removed.queries, [])
    assert.deepEqual(applyDeleteResult(previous, QUERY_A, removed), [])
  })

  it('strips Salesforce session fields from anything stored in the browser session', async () => {
    const poisoned = sanitizeSavedQuery({
      id: QUERY_A,
      name: '账户',
      soql: SOQL,
      createdAt: '2026-11-11T00:00:00.000Z',
      hostname: 'acme.my.salesforce.com',
      orgId: '00Dxx',
      sessionId: 'sid',
      sid: 'sid',
      password: 'nope'
    })
    assert.deepEqual(poisoned, {
      id: QUERY_A,
      name: '账户',
      soql: SOQL,
      createdAt: '2026-11-11T00:00:00.000Z'
    })
    assert.equal(savedQueryEditorText({ ...poisoned, hostname: 'acme.my.salesforce.com' }), SOQL)
    assert.equal(savedQueryEditorText({ soql: SOQL, hostname: 'acme.my.salesforce.com' }), '')
  })
})

describe('saved queries while logged in', () => {
  it('reads and writes Supabase without copying queries into local, sync, or session', async () => {
    const cloud = createCloud([{
      id: QUERY_B,
      user_id: USER_A,
      name: '云端旧查询',
      soql: 'SELECT Id FROM Contact',
      created_at: '2026-11-10T00:00:00.000Z',
      hostname: 'should-not-pass'
    }])
    const guard = createGuardedStorage({
      [SAVED_SOQL_SESSION_KEY]: [{
        id: QUERY_A,
        name: '只在这台浏览器',
        soql: 'SELECT Id FROM Lead',
        createdAt: '2026-11-11T00:00:00.000Z'
      }]
    })
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    const before = snapshotStorage(guard)
    const saved = storeFor(guard, { fetchImpl: cloud.fetchImpl, createId: ids(QUERY_A) })

    const listed = await saved.list()
    assert.equal(listed.ok, true)
    assert.equal(listed.loggedIn, true)
    assert.deepEqual(listed.queries.map((query) => query.name), ['云端旧查询'])
    assert.equal(listed.queries[0].hostname, undefined)
    assert.equal(listed.queries[0].soql, 'SELECT Id FROM Contact')

    const result = await saved.save({ name: '本周商机', soql: SOQL })
    assert.equal(result.ok, true)
    assert.equal(result.loggedIn, true)
    assert.equal(result.saved.id, QUERY_A)
    assert.deepEqual(result.queries.map((query) => query.name), ['本周商机', '云端旧查询'])
    const post = cloud.calls.find((call) => call.method === 'POST')
    assert.deepEqual(post.body, { user_id: USER_A, name: '本周商机', soql: SOQL })
    assert.equal(post.authorization, `Bearer token-${USER_A}`)
    assert.equal(post.apikey, 'anon-key')
    assert.match(post.url, /\/rest\/v1\/saved_soql_queries$/)
    assertDurableUntouched(guard, before)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY][0].name, '只在这台浏览器')
    assert.equal(applySaveResult([], { ok: false, saved: result.saved, queries: result.queries }).length, 0)
    assert.equal(applySaveResult([], result)[0].name, '本周商机')
  })

  it('keeps the previous list when the cloud insert fails or returns no row', async () => {
    const cloud = createCloud()
    const guard = createGuardedStorage()
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    const saved = storeFor(guard, { fetchImpl: cloud.fetchImpl })
    const failed = await saved.save({ name: 'boom', soql: SOQL })
    assert.equal(failed.ok, false)
    assert.equal(failed.saved, null)
    assert.deepEqual(failed.queries, [])
    assert.equal(cloud.rows.length, 0)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY], undefined)

    const silent = await saved.save({ name: 'silent', soql: SOQL })
    assert.equal(silent.ok, false)
    assert.equal(applySaveResult([{ id: QUERY_B, name: '已有', soql: SOQL, createdAt: '' }], silent).length, 1)
  })

  it('does not fall back to session storage when the account token is rejected', async () => {
    const guard = createGuardedStorage({
      [SAVED_SOQL_SESSION_KEY]: [{
        id: QUERY_A,
        name: '会话里的',
        soql: SOQL,
        createdAt: '2026-11-11T00:00:00.000Z'
      }]
    })
    guard.localData[STORAGE_KEY_SESSION] = {
      access_token: 'expired',
      user: { id: USER_A }
    }
    const calls = []
    const saved = storeFor(guard, {
      fetchImpl: async (url, options) => {
        calls.push(url)
        return new Response(JSON.stringify({ message: 'JWT expired', code: 'PGRST301' }), { status: 401 })
      }
    })
    const listed = await saved.list()
    assert.equal(listed.ok, false)
    assert.equal(listed.loggedIn, true)
    assert.deepEqual(listed.queries, [])
    const attempt = await saved.save({ name: '新的', soql: SOQL })
    assert.equal(attempt.ok, false)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY].length, 1)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY][0].name, '会话里的')
    assert.equal(calls.length > 0, true)
  })

  it('deletes only after the cloud row is gone', async () => {
    const cloud = createCloud([{
      id: QUERY_A,
      user_id: USER_A,
      name: '本周商机',
      soql: SOQL,
      created_at: '2026-11-11T03:00:00.000Z'
    }])
    const guard = createGuardedStorage()
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    const saved = storeFor(guard, { fetchImpl: cloud.fetchImpl })
    const previous = (await saved.list()).queries
    cloud.fetchImpl = async () => new Response(JSON.stringify({ message: 'delete failed' }), { status: 500 })
    const broken = createSavedQueryStore({
      storage: guard.storage,
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon-key',
      fetchImpl: cloud.fetchImpl
    })
    const failed = await broken.remove(QUERY_A)
    assert.equal(failed.ok, false)
    assert.equal(applyDeleteResult(previous, QUERY_A, failed), previous)

    const removed = await saved.remove(QUERY_A)
    assert.equal(removed.ok, true)
    assert.deepEqual(removed.queries, [])
    assert.equal(cloud.rows.length, 0)
    assert.deepEqual(applyDeleteResult(previous, QUERY_A, removed), [])
  })

  it('asks another signed-in computer for the same account rows only', async () => {
    const cloud = createCloud([
      {
        id: QUERY_A,
        user_id: USER_A,
        name: '本周商机',
        soql: SOQL,
        created_at: '2026-11-11T03:00:00.000Z'
      },
      {
        id: QUERY_B,
        user_id: USER_B,
        name: '别人的',
        soql: 'SELECT Id FROM Lead',
        created_at: '2026-11-11T04:00:00.000Z'
      }
    ])
    const first = createGuardedStorage()
    const second = createGuardedStorage()
    first.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    second.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    const there = storeFor(first, { fetchImpl: cloud.fetchImpl })
    const here = storeFor(second, { fetchImpl: cloud.fetchImpl })
    const opened = await here.list()
    assert.deepEqual(opened.queries.map((query) => query.name), ['本周商机'])
    assert.equal(savedQueryEditorText(opened.queries[0]), SOQL)
    assert.equal(Object.hasOwn(opened.queries[0], 'hostname'), false)
    const other = createSavedSoqlRestIo({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon-key',
      accessToken: 'token-b',
      fetchImpl: cloud.fetchImpl
    })
    const theirs = await other.listOwn(USER_B)
    assert.deepEqual(theirs.data.map((query) => query.name), ['别人的'])
    assert.notEqual(theirs.data[0].soql, (await there.list()).queries[0].soql)
  })
})

describe('saved query copy and schema', () => {
  it('ships the same saved-query strings in Chinese, English, and Japanese', () => {
    const zh = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/zh-CN.json'), 'utf8')).soql
    const en = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/en.json'), 'utf8')).soql
    const ja = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/ja.json'), 'utf8')).soql
    for (const key of SAVED_KEYS) {
      assert.equal(typeof zh[key], 'string')
      assert.equal(typeof en[key], 'string')
      assert.equal(typeof ja[key], 'string')
      assert.notEqual(zh[key].trim(), '')
      assert.notEqual(en[key].trim(), '')
      assert.notEqual(ja[key].trim(), '')
      assert.equal(/[\u4e00-\u9fff]/.test(en[key]), false)
      assert.notEqual(zh[key], en[key])
      assert.notEqual(ja[key], en[key])
    }
    const vue = readFileSync(resolve(root, 'src/tools/soql/SoqlApp.vue'), 'utf8')
    assert.match(vue, /applySaveResult/)
    assert.match(vue, /applyDeleteResult/)
    assert.match(vue, /savedQueryEditorText/)
    const opener = vue.slice(vue.indexOf('function openSavedQuery'), vue.indexOf('function settleOpenedQuery'))
    assert.doesNotMatch(opener, /executeQuery|fetchSfSession|sessionId/)
    const source = readFileSync(resolve(root, 'src/tools/soql/savedQueries.js'), 'utf8')
    assert.match(source, /storage\.local\.get/)
    assert.doesNotMatch(source, /local\.set|sync\.set|storage\.sync|chrome\.storage\.local\.set|chrome\.storage\.sync/)
  })

  it('declares a per-user query table without Salesforce session columns', () => {
    const sql = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    const start = sql.indexOf('-- ---------- 表：saved_soql_queries 常用查询 ----------')
    const end = sql.indexOf('-- ---------- 函数：accept_share_lookup', start)
    const table = sql.slice(start, end)
    assert.match(table, /create table public\.saved_soql_queries/)
    assert.match(table, /name text not null/)
    assert.match(table, /soql text not null/)
    assert.match(table, /references auth\.users \(id\) on delete CASCADE/)
    assert.match(table, /char_length\(name\) between 1 and 80/)
    assert.match(table, /char_length\(soql\) between 1 and 20000/)
    assert.match(table, /trg_saved_soql_touch BEFORE/)
    assert.doesNotMatch(table, /hostname|org_id|session_id|sessionid|\bsid\b/i)
    assert.match(sql, /alter table public\.saved_soql_queries enable row level security/)
    assert.match(sql, /saved_soql_insert[\s\S]*for INSERT to authenticated[\s\S]*with check \(auth\.uid\(\) = user_id\)/)
    assert.match(sql, /saved_soql_select[\s\S]*for SELECT to authenticated[\s\S]*using \(auth\.uid\(\) = user_id\)/)
    assert.match(sql, /saved_soql_delete[\s\S]*for DELETE to authenticated[\s\S]*using \(auth\.uid\(\) = user_id\)/)
  })

  it('blocks another account from reading or deleting the saved query', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite()
    const sql = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    const tableStart = sql.indexOf('-- ---------- 表：saved_soql_queries 常用查询 ----------')
    const tableEnd = sql.indexOf('-- ---------- 函数：accept_share_lookup', tableStart)
    const policyStart = sql.indexOf('-- saved_soql_queries：仅本人可读写自己记下的查询')
    const tableSql = sql.slice(tableStart, tableEnd).replace(/\s*TABLESPACE pg_default/gi, '')
    const policySql = sql.slice(policyStart)

    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
      $$;
      CREATE OR REPLACE FUNCTION public.touch_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$;
      DO $$ BEGIN
        CREATE ROLE authenticated;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    `)
    await db.exec(tableSql)
    await db.exec(policySql)
    await db.exec(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_soql_queries TO authenticated;
      ALTER TABLE public.saved_soql_queries FORCE ROW LEVEL SECURITY;
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
    `)

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

    const columns = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'saved_soql_queries'
      ORDER BY ordinal_position
    `)
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      'id',
      'user_id',
      'name',
      'soql',
      'created_at',
      'updated_at'
    ])

    await asUser(USER_A, () => db.query(
      `INSERT INTO public.saved_soql_queries (user_id, name, soql) VALUES ($1, $2, $3)`,
      [USER_A, '本周商机', SOQL]
    ))

    const hidden = await asUser(USER_B, () => db.query(
      `SELECT name, soql FROM public.saved_soql_queries`
    ))
    assert.equal(hidden.rows.length, 0)

    const blocked = await asUser(USER_B, () => db.query(
      `DELETE FROM public.saved_soql_queries WHERE user_id = $1`,
      [USER_A]
    ))
    assert.equal(Number(blocked.affectedRows ?? blocked.rowCount ?? 0), 0)

    await assert.rejects(() => asUser(USER_B, () => db.query(
      `INSERT INTO public.saved_soql_queries (user_id, name, soql) VALUES ($1, '偷看', 'SELECT Id FROM Lead')`,
      [USER_A]
    )))

    const mine = await asUser(USER_A, () => db.query(
      `SELECT name, soql FROM public.saved_soql_queries`
    ))
    assert.deepEqual(mine.rows, [{ name: '本周商机', soql: SOQL }])

    await assert.rejects(() => asUser(USER_A, () => db.query(
      `INSERT INTO public.saved_soql_queries (user_id, name, soql) VALUES ($1, $2, $3)`,
      [USER_A, '', SOQL]
    )))

    await db.query(`DELETE FROM auth.users WHERE id = $1`, [USER_A])
    const left = await db.query(`SELECT count(*)::int AS n FROM public.saved_soql_queries`)
    assert.equal(Number(left.rows[0].n), 0)
    await db.close()
  })
})
