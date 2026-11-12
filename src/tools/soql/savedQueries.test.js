import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORAGE_KEY_SESSION } from '../../utils/constants.js'
import {
  SAVED_SOQL_MAX_COUNT,
  SAVED_SOQL_SESSION_KEY,
  SAVED_SOQL_TEXT_MAX,
  applySaveResult,
  createSavedQueryStore,
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
  return { storage: { session, local: guard('local', localData), sync: guard('sync', syncData) }, localData, syncData, forbidden, session }
}

function assertDurableUntouched(guard, beforeForbidden) {
  assert.equal(guard.forbidden.length, beforeForbidden)
  assert.equal(Object.hasOwn(guard.localData, SAVED_SOQL_SESSION_KEY), false)
  assert.equal(Object.hasOwn(guard.syncData, SAVED_SOQL_SESSION_KEY), false)
  assert.deepEqual(guard.localData.salesforce_environments, legacyLocal().salesforce_environments)
}

function authSession(id) {
  return { access_token: `token-${id}`, user: { id } }
}

function clock(start = '2026-11-11T00:00:00.000Z') {
  let n = 0
  const origin = Date.parse(start)
  return () => new Date(origin + n++ * 1000).toISOString()
}

function ids(values) {
  let n = 0
  return () => values[n++]
}

function rowId(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function createCloud({ missing = false } = {}) {
  const rows = []
  let seq = 0
  const calls = []
  async function fetchImpl(url, options = {}) {
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ url, method, body })
    if (missing) {
      return new Response(JSON.stringify({ code: 'PGRST205', message: 'saved_soql_queries not found' }), { status: 404 })
    }
    const parsed = new URL(url)
    const userId = (parsed.searchParams.get('user_id') || '').replace(/^eq\./, '')
    const idFilter = parsed.searchParams.get('id') || ''
    if (method === 'GET') {
      return new Response(JSON.stringify(rows.filter((row) => row.user_id === userId)), { status: 200 })
    }
    if (method === 'POST') {
      if (!body?.user_id || !body?.soql || body.name || body.hostname || body.sessionId) {
        return new Response(JSON.stringify({ message: 'bad row' }), { status: 400 })
      }
      const row = {
        id: body.user_id === USER_B ? QUERY_B : `cccccccc-cccc-4ccc-8ccc-${String(seq++).padStart(12, '0')}`,
        user_id: body.user_id,
        soql: body.soql,
        created_at: new Date(Date.parse('2026-11-11T03:00:00.000Z') + seq * 1000).toISOString()
      }
      rows.push(row)
      return new Response(JSON.stringify([row]), { status: 201 })
    }
    if (method === 'DELETE') {
      const match = idFilter.match(/^in\.\((.*)\)$/)
      const idsToDrop = match ? match[1].split(',').filter(Boolean) : []
      const removed = []
      for (const id of idsToDrop) {
        const index = rows.findIndex((row) => row.user_id === userId && row.id === id)
        if (index >= 0) removed.push(rows.splice(index, 1)[0])
      }
      if (removed.length !== idsToDrop.length) return new Response(JSON.stringify({ message: 'delete failed' }), { status: 500 })
      return new Response(JSON.stringify(removed), { status: 200 })
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
    createId: extra.createId || ids([QUERY_A, QUERY_B]),
    fetchImpl: extra.fetchImpl
  })
}

describe('successful queries while logged out', () => {
  it('keeps a successful statement in session storage and nowhere else', async () => {
    const guard = createGuardedStorage()
    const saved = storeFor(guard)
    const result = await saved.remember(`  ${SOQL}  `)
    assert.equal(result.ok, true)
    assert.equal(result.loggedIn, false)
    assert.equal(result.saved.soql, SOQL)
    assert.deepEqual(Object.keys(result.saved).sort(), ['createdAt', 'id', 'soql'])
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY][0].hostname, undefined)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY][0].name, undefined)
    assertDurableUntouched(guard, 0)
    assert.equal(savedQueryEditorText(result.saved), SOQL)
    assert.equal((await readSessionQueries(createMemoryArea())).length, 0)
  })

  it('does not show a statement when the session write fails', async () => {
    const guard = createGuardedStorage()
    const previous = [{ id: QUERY_B, soql: 'SELECT Id FROM Contact', createdAt: '2026-11-01T00:00:00.000Z' }]
    guard.session.data[SAVED_SOQL_SESSION_KEY] = previous.map((row) => ({ ...row, hostname: 'org.my.salesforce.com', name: '旧的' }))
    guard.storage.session.set = async () => {
      throw new Error('session unavailable')
    }
    const result = await storeFor(guard).remember(SOQL)
    assert.equal(result.ok, false)
    assert.equal(result.saved, null)
    assert.deepEqual(result.queries.map((query) => query.soql), ['SELECT Id FROM Contact'])
    assert.equal(applySaveResult(previous, result), previous)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY][0].soql, 'SELECT Id FROM Contact')
    assertDurableUntouched(guard, 0)
  })

  it('drops the oldest statement after fifty and keeps one copy of the same statement', async () => {
    const guard = createGuardedStorage()
    const existing = Array.from({ length: SAVED_SOQL_MAX_COUNT }, (_, index) => ({
      id: rowId(index),
      soql: `SELECT Id FROM Object_${index}`,
      createdAt: new Date(Date.parse('2026-11-01T00:00:00.000Z') + index * 1000).toISOString()
    }))
    guard.session.data[SAVED_SOQL_SESSION_KEY] = existing
    const saved = storeFor(guard, { createId: ids([QUERY_A, QUERY_B]) })
    const added = await saved.remember('SELECT Id FROM Newest')
    assert.equal(added.ok, true)
    assert.equal(added.queries.length, 50)
    assert.equal(added.queries[0].soql, 'SELECT Id FROM Newest')
    assert.equal(added.queries.some((query) => query.soql === 'SELECT Id FROM Object_0'), false)
    assert.equal(added.queries.some((query) => query.soql === 'SELECT Id FROM Object_1'), true)

    const again = await saved.remember('SELECT Id FROM Newest')
    assert.equal(again.ok, true)
    assert.equal(again.queries.filter((query) => query.soql === 'SELECT Id FROM Newest').length, 1)
    assert.equal(again.queries[0].id, QUERY_B)
    assert.equal(again.queries.length, 50)
  })

  it('rejects an empty or oversized statement without writing', async () => {
    const guard = createGuardedStorage()
    const saved = storeFor(guard)
    assert.equal((await saved.remember('   ')).error, 'need-soql')
    assert.equal((await saved.remember('S'.repeat(SAVED_SOQL_TEXT_MAX + 1))).error, 'soql-too-long')
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY], undefined)
  })

  it('strips Salesforce session fields', () => {
    const poisoned = sanitizeSavedQuery({
      id: QUERY_A,
      name: '账户',
      soql: SOQL,
      createdAt: '2026-11-11T00:00:00.000Z',
      hostname: 'acme.my.salesforce.com',
      sessionId: 'sid'
    })
    assert.deepEqual(poisoned, {
      id: QUERY_A,
      soql: SOQL,
      createdAt: '2026-11-11T00:00:00.000Z'
    })
    assert.equal(savedQueryEditorText({ soql: SOQL, hostname: 'acme.my.salesforce.com' }), '')
  })
})

describe('successful queries while logged in', () => {
  it('writes Supabase and trims to fifty without touching local, sync, or session', async () => {
    const cloud = createCloud()
    const guard = createGuardedStorage({
      [SAVED_SOQL_SESSION_KEY]: [{ id: QUERY_A, soql: 'SELECT Id FROM Lead', createdAt: '2026-11-11T00:00:00.000Z' }]
    })
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    const idList = Array.from({ length: 52 }, (_, index) => rowId(index + 1))
    const saved = storeFor(guard, { fetchImpl: cloud.fetchImpl, createId: ids(idList) })
    for (let index = 0; index < 50; index += 1) {
      const result = await saved.remember(`SELECT Id FROM Object_${index}`)
      assert.equal(result.ok, true)
    }
    const newest = await saved.remember('SELECT Id FROM Newest')
    assert.equal(newest.ok, true)
    assert.equal(newest.queries.length, 50)
    assert.equal(newest.queries[0].soql, 'SELECT Id FROM Newest')
    assert.equal(newest.queries.some((query) => query.soql === 'SELECT Id FROM Object_0'), false)
    assert.equal(cloud.calls.find((call) => call.method === 'POST').body.name, undefined)
    assert.deepEqual(Object.keys(cloud.calls.find((call) => call.method === 'POST').body).sort(), ['soql', 'user_id'])
    assertDurableUntouched(guard, 0)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY][0].soql, 'SELECT Id FROM Lead')
    assert.equal(applySaveResult([], { ok: false, saved: newest.saved, queries: newest.queries }).length, 0)
  })

  it('does not show a statement when the table is missing', async () => {
    const cloud = createCloud({ missing: true })
    const guard = createGuardedStorage()
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    const previous = [{ id: QUERY_B, soql: 'SELECT Id FROM Contact', createdAt: '2026-11-01T00:00:00.000Z' }]
    const result = await storeFor(guard, { fetchImpl: cloud.fetchImpl }).remember(SOQL)
    assert.equal(result.ok, false)
    assert.equal(result.saved, null)
    assert.equal(applySaveResult(previous, result), previous)
    assert.equal(guard.session.data[SAVED_SOQL_SESSION_KEY], undefined)
    assert.equal(cloud.rows.length, 0)
  })

  it('shows only the signed-in account statements', async () => {
    const cloud = createCloud()
    const guard = createGuardedStorage()
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    const saved = storeFor(guard, { fetchImpl: cloud.fetchImpl, createId: ids([QUERY_A]) })
    await saved.remember(SOQL)
    cloud.rows.push({
      id: QUERY_B,
      user_id: USER_B,
      soql: 'SELECT Id FROM Lead',
      created_at: '2026-11-11T05:00:00.000Z'
    })
    const listed = await saved.list()
    assert.deepEqual(listed.queries.map((query) => query.soql), [SOQL])
    assert.equal(Object.hasOwn(listed.queries[0], 'hostname'), false)
  })
})

describe('saved query copy and schema', () => {
  it('keeps history labels short in Chinese, English, and Japanese', () => {
    const zh = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/zh-CN.json'), 'utf8')).soql
    const en = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/en.json'), 'utf8')).soql
    const ja = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/ja.json'), 'utf8')).soql
    for (const key of ['history', 'historyEmpty']) {
      assert.equal(typeof zh[key], 'string')
      assert.equal(typeof en[key], 'string')
      assert.equal(typeof ja[key], 'string')
      assert.equal(/[\u4e00-\u9fff]/.test(en[key]), false)
      assert.notEqual(zh[key], en[key])
      assert.ok(zh[key].length < 20)
      assert.ok(en[key].length < 20)
      assert.ok(ja[key].length < 20)
    }
    for (const key of ['savedLoggedInHint', 'savedLoggedOutHint', 'saveQuery', 'saveWhereLoggedIn', 'runNeedsSalesforce']) {
      assert.equal(zh[key], undefined)
      assert.equal(en[key], undefined)
      assert.equal(ja[key], undefined)
    }
    const vue = readFileSync(resolve(root, 'src/tools/soql/SoqlApp.vue'), 'utf8')
    assert.match(vue, /soql\.history/)
    assert.match(vue, /rememberSuccessfulSoql/)
    assert.match(vue, /applySaveResult/)
    assert.doesNotMatch(vue, /saveQuery|记下|savedLoggedInHint|常用查询/)
    const opener = vue.slice(vue.indexOf('function openSavedQuery'), vue.indexOf('function settleOpenedQuery'))
    assert.doesNotMatch(opener, /executeQuery|fetchSfSession|sessionId/)
    const source = readFileSync(resolve(root, 'src/tools/soql/savedQueries.js'), 'utf8')
    assert.match(source, /storage\.local\.get/)
    assert.doesNotMatch(source, /local\.set|sync\.set|storage\.sync|chrome\.storage\.local\.set|chrome\.storage\.sync/)
  })

  it('declares a per-user statement table without a name or Salesforce session columns', () => {
    const sql = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    const start = sql.indexOf('-- ---------- 表：saved_soql_queries 常用查询 ----------')
    const end = sql.indexOf('-- ---------- 函数：accept_share_lookup', start)
    const table = sql.slice(start, end)
    assert.match(table, /create table public\.saved_soql_queries/)
    assert.match(table, /soql text not null/)
    assert.doesNotMatch(table, /name text/)
    assert.doesNotMatch(table, /hostname|org_id|session_id|\bsid\b/i)
    assert.match(sql, /saved_soql_insert[\s\S]*for INSERT to authenticated[\s\S]*with check \(auth\.uid\(\) = user_id\)/)
  })

  it('blocks another account from reading the saved statement', async () => {
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
      'id', 'user_id', 'soql', 'created_at', 'updated_at'
    ])

    await asUser(USER_A, () => db.query(
      `INSERT INTO public.saved_soql_queries (user_id, soql) VALUES ($1, $2)`,
      [USER_A, SOQL]
    ))
    const hidden = await asUser(USER_B, () => db.query(`SELECT soql FROM public.saved_soql_queries`))
    assert.equal(hidden.rows.length, 0)
    await assert.rejects(() => asUser(USER_B, () => db.query(
      `INSERT INTO public.saved_soql_queries (user_id, soql) VALUES ($1, 'SELECT Id FROM Lead')`,
      [USER_A]
    )))
    await assert.rejects(() => asUser(USER_A, () => db.query(
      `INSERT INTO public.saved_soql_queries (user_id, soql) VALUES ($1, '')`,
      [USER_A]
    )))
    const mine = await asUser(USER_A, () => db.query(`SELECT soql FROM public.saved_soql_queries`))
    assert.deepEqual(mine.rows, [{ soql: SOQL }])
    await db.close()
  })
})
