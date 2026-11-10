import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { STORAGE_KEY_SESSION } from './constants.js'
import { createLocaleMessageHandler } from './localeController.js'
import {
  LEGACY_LOCALE_LOCAL_KEY,
  SESSION_LOCALE_KEY,
  commitLocaleChange,
  createLocaleRestIo,
  effectiveLocale,
  getLoggedOutPreference,
  loadLocaleState,
  normalizeLocalePreference,
  readUiLocale,
  setLoggedOutPreference,
  signOutLocale,
  supabaseLocaleIo,
  writeUiLocale
} from './localePref.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'

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
    salesforce_environments: [{ id: 'env-1' }],
    salesforce_groups: [{ id: 'group-1' }],
    ui_locale: 'ja',
    sfql_tool_float_pos: { top: 80, right: 0 }
  }
}

function createGuardedStorage() {
  const localData = legacyLocal()
  const syncData = {}
  const writes = []
  const guard = (name, data, { allowLegacyRemove = false } = {}) => ({
    async get(keys) {
      return pick(data, keys)
    },
    async set(obj) {
      writes.push([name, 'set', obj])
      throw new Error(`${name} set forbidden`)
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys]
      if (allowLegacyRemove && list.length === 1 && list[0] === LEGACY_LOCALE_LOCAL_KEY) {
        delete data[LEGACY_LOCALE_LOCAL_KEY]
        return
      }
      writes.push([name, 'remove', keys])
      throw new Error(`${name} remove forbidden`)
    }
  })
  const session = createMemoryArea()
  return {
    storage: {
      session,
      local: guard('local', localData, { allowLegacyRemove: true }),
      sync: guard('sync', syncData)
    },
    localData,
    syncData,
    writes,
    session
  }
}

function assertNoPreferenceWrites(guard) {
  assert.deepEqual(guard.writes, [])
  assert.equal(Object.hasOwn(guard.localData, LEGACY_LOCALE_LOCAL_KEY), false)
  assert.equal(Object.hasOwn(guard.localData, SESSION_LOCALE_KEY), false)
  assert.equal(Object.hasOwn(guard.syncData, LEGACY_LOCALE_LOCAL_KEY), false)
  assert.equal(Object.hasOwn(guard.syncData, SESSION_LOCALE_KEY), false)
  assert.equal(Object.hasOwn(guard.syncData, 'ui_locale'), false)
  assert.deepEqual(guard.localData.salesforce_environments, [{ id: 'env-1' }])
  assert.deepEqual(guard.localData.sfql_tool_float_pos, { top: 80, right: 0 })
}

function authSession(id) {
  return { access_token: `token-${id}`, user: { id } }
}

function createMetadataStore() {
  const rows = new Map()
  const calls = []

  function doInsert(uid, row) {
    if (row.user_id !== uid) {
      return {
        data: null,
        error: { code: '42501', message: 'new row violates row-level security policy' }
      }
    }
    if (rows.has(uid)) {
      return { data: null, error: { code: '23505', message: 'duplicate key' } }
    }
    const stored = {
      user_id: uid,
      show_tool_float: Object.prototype.hasOwnProperty.call(row, 'show_tool_float')
        ? row.show_tool_float
        : true,
      ui_locale: Object.prototype.hasOwnProperty.call(row, 'ui_locale') ? row.ui_locale : 'system'
    }
    rows.set(uid, stored)
    return { data: { ui_locale: stored.ui_locale }, error: null }
  }

  function doUpdate(uid, state) {
    const userId = state.eq?.[1]
    if (userId !== uid || !rows.has(userId)) return { data: [], error: null }
    const row = rows.get(userId)
    if (Object.prototype.hasOwnProperty.call(state.patch, 'show_tool_float')) {
      row.show_tool_float = state.patch.show_tool_float
    }
    if (Object.prototype.hasOwnProperty.call(state.patch, 'ui_locale')) {
      row.ui_locale = state.patch.ui_locale
    }
    return { data: [{ ui_locale: row.ui_locale }], error: null }
  }

  function doSelect(uid, state) {
    const userId = state.eq?.[1]
    if (userId !== uid) return { data: null, error: null }
    const row = rows.get(userId)
    return { data: row ? { ui_locale: row.ui_locale } : null, error: null }
  }

  function clientFor(uid) {
    return {
      from(table) {
        if (table !== 'user_metadata') throw new Error(`unexpected table ${table}`)
        const state = { op: '', eq: null, patch: null, row: null }
        const api = {
          select() {
            if (!state.op) state.op = 'select'
            return api
          },
          insert(row) {
            state.op = 'insert'
            state.row = row
            return api
          },
          update(patch) {
            state.op = 'update'
            state.patch = patch
            return api
          },
          eq(col, val) {
            state.eq = [col, val]
            return api
          },
          maybeSingle() {
            return finish()
          },
          single() {
            return finish()
          },
          then(resolve, reject) {
            return finish().then(resolve, reject)
          }
        }
        function finish() {
          calls.push({
            uid,
            op: state.op,
            row: state.row ? { ...state.row } : null,
            patch: state.patch ? { ...state.patch } : null
          })
          if (state.op === 'insert') return Promise.resolve(doInsert(uid, state.row))
          if (state.op === 'update') return Promise.resolve(doUpdate(uid, state))
          return Promise.resolve(doSelect(uid, state))
        }
        return api
      }
    }
  }

  return {
    rows,
    calls,
    io(uid) {
      return supabaseLocaleIo(clientFor(uid))
    }
  }
}

function handlerFor(guard, store, broadcast = () => {}) {
  return createLocaleMessageHandler({
    storage: guard.storage,
    broadcast,
    ioForSession: (session) => store.io(session.user.id)
  })
}

describe('preference values', () => {
  it('accepts follow-system, zh-CN, en, and ja', () => {
    for (const value of ['system', 'zh-CN', 'en', 'ja']) {
      assert.equal(normalizeLocalePreference(value), value)
    }
    assert.equal(normalizeLocalePreference('fr'), null)
    assert.equal(normalizeLocalePreference('ja'), 'ja')
    assert.equal(effectiveLocale('system', 'en'), 'en')
    assert.equal(effectiveLocale('ja', 'en'), 'ja')
    assert.equal(effectiveLocale('nope', 'zh-CN'), 'zh-CN')
  })
})

describe('logged-out session', () => {
  it('keeps a change for this browser session and returns to follow-system after restart', async () => {
    const guard = createGuardedStorage()
    const store = createMetadataStore()
    const handle = handlerFor(guard, store)

    const opened = await handle.getPreference()
    assert.deepEqual(opened, { success: true, preference: 'system', source: 'session' })
    assert.equal(guard.localData.ui_locale, undefined)

    const chosen = await handle.setSession('ja')
    assert.equal(chosen.preference, 'ja')
    assert.equal(guard.session.data[SESSION_LOCALE_KEY], 'ja')

    const reopened = await handle.getPreference()
    assert.equal(reopened.preference, 'ja')
    assert.equal(reopened.source, 'session')

    const restarted = createMemoryArea()
    assert.equal(await getLoggedOutPreference(restarted), 'system')
    assertNoPreferenceWrites(guard)
  })

  it('does not write the choice to local or sync', async () => {
    const guard = createGuardedStorage()
    await setLoggedOutPreference(guard.session, 'en')
    await setLoggedOutPreference(guard.session, 'system')
    assert.equal(guard.session.data[SESSION_LOCALE_KEY], undefined)
    assert.equal(guard.localData.ui_locale, 'ja')
    assert.deepEqual(guard.writes, [])
    assert.deepEqual(guard.syncData, {})
  })
})

describe('logged-in account value', () => {
  it('lets the account language replace a logged-out choice', async () => {
    const store = createMetadataStore()
    await writeUiLocale(store.io(USER_A), USER_A, 'en')
    assert.equal(store.rows.get(USER_A).show_tool_float, true)
    const insertCall = store.calls.find((call) => call.op === 'insert')
    assert.deepEqual(insertCall.row, { user_id: USER_A, ui_locale: 'en' })
    assert.equal(Object.hasOwn(insertCall.row, 'show_tool_float'), false)

    const guard = createGuardedStorage()
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    await setLoggedOutPreference(guard.session, 'ja')
    const seen = await handlerFor(guard, store).getPreference()
    assert.deepEqual(seen, { success: true, preference: 'en', source: 'cloud' })
    assert.equal(guard.session.data[SESSION_LOCALE_KEY], undefined)
    assert.equal(store.rows.get(USER_A).ui_locale, 'en')
    assertNoPreferenceWrites(guard)
  })

  it('shares one account language across two browsers', async () => {
    const store = createMetadataStore()
    const first = createGuardedStorage()
    const second = createGuardedStorage()
    first.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    second.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    await writeUiLocale(store.io(USER_A), USER_A, 'ja')
    store.rows.get(USER_A).show_tool_float = false

    const seen = await handlerFor(second, store).getPreference()
    assert.equal(seen.preference, 'ja')
    assert.equal(seen.source, 'cloud')
    await writeUiLocale(store.io(USER_A), USER_A, 'en')
    const updateCall = store.calls.filter((call) => call.op === 'update').at(-1)
    assert.deepEqual(updateCall.patch, { ui_locale: 'en' })
    assert.equal(store.rows.get(USER_A).show_tool_float, false)
    const restored = await handlerFor(first, store).getPreference()
    assert.equal(restored.preference, 'en')
    assert.equal(second.session.data[SESSION_LOCALE_KEY], undefined)
    assertNoPreferenceWrites(first)
    assertNoPreferenceWrites(second)
  })

  it('returns follow-system after logout and does not copy the account value', async () => {
    const store = createMetadataStore()
    await writeUiLocale(store.io(USER_A), USER_A, 'ja')
    const guard = createGuardedStorage()
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    await setLoggedOutPreference(guard.session, 'en')
    await handlerFor(guard, store).applyCloud('ja')
    assert.equal(guard.session.data[SESSION_LOCALE_KEY], undefined)

    delete guard.localData[STORAGE_KEY_SESSION]
    const broadcasts = []
    const handle = handlerFor(guard, store, (preference) => {
      broadcasts.push(preference)
    })
    const response = await new Promise((resolve) => {
      handle({ action: 'uiLocaleSignedOut' }, {}, resolve)
    })
    assert.equal(response.preference, 'system')
    assert.deepEqual(broadcasts, ['system'])
    const after = await handle.getPreference()
    assert.equal(after.preference, 'system')
    assert.equal(after.source, 'session')
    assert.equal(store.rows.get(USER_A).ui_locale, 'ja')
    assertNoPreferenceWrites(guard)

    const area = createMemoryArea({ [SESSION_LOCALE_KEY]: 'en' })
    const direct = await signOutLocale(area)
    assert.equal(direct.preference, 'system')
    assert.equal(area.data[SESSION_LOCALE_KEY], undefined)
  })
})

describe('offline and RLS', () => {
  it('does not show an unsaved language when the account write fails', async () => {
    let sessionWrites = 0
    let cloudWrites = 0
    const result = await commitLocaleChange({
      loggedIn: true,
      previous: 'en',
      next: 'ja',
      write: async () => {
        cloudWrites += 1
        throw new Error('Failed to fetch')
      },
      setSession: async () => {
        sessionWrites += 1
        return { success: true, preference: 'ja' }
      },
      applyCloud: async () => {
        throw new Error('apply')
      }
    })
    assert.deepEqual(result, { ok: false, preference: 'en' })
    assert.equal(cloudWrites, 1)
    assert.equal(sessionWrites, 0)

    const guard = createGuardedStorage()
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    await setLoggedOutPreference(guard.session, 'ja')
    const failed = await handlerFor(guard, {
      io() {
        return {
          async selectOwn() {
            return { data: null, error: { message: 'Failed to fetch' } }
          },
          async insertOwn() {
            throw new Error('insert')
          },
          async updateOwn() {
            throw new Error('update')
          }
        }
      }
    }).getPreference()
    assert.equal(failed.success, false)
    assert.equal(guard.session.data[SESSION_LOCALE_KEY], 'ja')
    assert.equal(guard.localData.ui_locale, undefined)
    assertNoPreferenceWrites(guard)
  })

  it('keeps the last saved language when a later read fails', async () => {
    const result = await loadLocaleState({
      loggedIn: true,
      read: async () => {
        throw new Error('Failed to fetch')
      },
      getSession: async () => ({ success: true, preference: 'ja' }),
      applyCloud: async () => {
        throw new Error('should not apply')
      }
    })
    assert.deepEqual(result, { ok: false })
  })

  it('rejects another user reading or updating the language', async () => {
    const store = createMetadataStore()
    await writeUiLocale(store.io(USER_A), USER_A, 'ja')
    const peeked = await store.io(USER_B).selectOwn(USER_A)
    assert.equal(peeked.data, null)
    assert.equal(peeked.error, null)
    await assert.rejects(
      () => writeUiLocale(store.io(USER_B), USER_A, 'en'),
      (error) => error.code === '42501'
    )
    assert.equal(store.rows.get(USER_A).ui_locale, 'ja')
    const own = await readUiLocale(store.io(USER_A), USER_A)
    assert.equal(own, 'ja')
  })
})

describe('i18n and wiring', () => {
  it('uses the same language message on the panel, tool windows, and Salesforce page', () => {
    const locales = ['zh-CN', 'en', 'ja'].map((name) => (
      JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${name}.json`), 'utf8')).locale
    ))
    for (const bundle of locales) {
      assert.equal(typeof bundle.saveFailed, 'string')
      assert.ok(bundle.saveFailed.trim().length > 0)
      assert.equal(typeof bundle.system, 'string')
    }
    const messages = new Set(locales.map((bundle) => bundle.saveFailed))
    assert.equal(messages.size, 3)

    const vue = readFileSync(resolve(root, 'src/components/LocaleSwitcher.vue'), 'utf8')
    assert.match(vue, /t\('locale\.saveFailed'\)/)
    assert.match(vue, /t\('locale\.system'\)/)
    assert.match(vue, /LOCALE_PREF_SYSTEM/)
    const template = vue.slice(vue.indexOf('<template>'), vue.indexOf('</template>'))
    assert.doesNotMatch(template, /[\u3400-\u9fff]/)

    const content = readFileSync(resolve(root, 'content.js'), 'utf8')
    assert.match(content, /action: 'getUiLocale'/)
    assert.match(content, /action !== 'uiLocaleChanged'/)
    assert.doesNotMatch(content, /storage\.onChanged/)
    assert.doesNotMatch(content, /LOCALE_STORAGE_KEY/)

    const sources = [
      'src/utils/localePref.js',
      'src/utils/localeController.js',
      'src/composables/useLocale.js',
      'src/i18n/index.js'
    ].map((file) => readFileSync(resolve(root, file), 'utf8'))
    for (const src of sources) {
      assert.doesNotMatch(src, /chrome\.storage\.local\.set|chrome\.storage\.sync|storage\.sync|storage\.local\.set/)
    }
    assert.match(readFileSync(resolve(root, 'background.js'), 'utf8'), /createLocaleMessageHandler/)
    assert.match(readFileSync(resolve(root, 'src/tools/tool-window-main.js'), 'utf8'), /resolveLocale/)
    assert.match(readFileSync(resolve(root, 'src/main.js'), 'utf8'), /resolveLocale/)
  })
})

describe('schema', () => {
  it('adds ui_locale on user_metadata and defaults to follow-system', async () => {
    const sql = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    assert.match(sql, /ui_locale text not null default 'system'::text/)
    assert.match(sql, /ui_locale in \('system', 'zh-CN', 'en', 'ja'\)/)
    assert.match(sql, /show_tool_float boolean not null default true/)

    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite()
    const tableStart = sql.indexOf('-- ---------- 表：user_metadata 用户设置 ----------')
    const tableEnd = sql.indexOf('-- ---------- 函数：accept_share_lookup', tableStart)
    const policyStart = sql.indexOf('-- user_metadata：仅本人可读写自己的偏好')
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
      GRANT SELECT, INSERT, UPDATE ON public.user_metadata TO authenticated;
      ALTER TABLE public.user_metadata FORCE ROW LEVEL SECURITY;
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

    await asUser(USER_A, () => db.query(
      `INSERT INTO public.user_metadata (user_id, show_tool_float) VALUES ($1, false)`,
      [USER_A]
    ))
    const inserted = await db.query(
      `SELECT ui_locale, show_tool_float FROM public.user_metadata WHERE user_id = $1`,
      [USER_A]
    )
    assert.equal(inserted.rows[0].ui_locale, 'system')
    assert.equal(inserted.rows[0].show_tool_float, false)

    await asUser(USER_A, () => db.query(
      `UPDATE public.user_metadata SET ui_locale = 'ja' WHERE user_id = $1`,
      [USER_A]
    ))
    const updated = await db.query(
      `SELECT ui_locale, show_tool_float FROM public.user_metadata WHERE user_id = $1`,
      [USER_A]
    )
    assert.equal(updated.rows[0].ui_locale, 'ja')
    assert.equal(updated.rows[0].show_tool_float, false)

    await assert.rejects(() => db.query(
      `UPDATE public.user_metadata SET ui_locale = 'fr' WHERE user_id = $1`,
      [USER_A]
    ))

    const hidden = await asUser(USER_B, () => db.query(
      `SELECT ui_locale FROM public.user_metadata`
    ))
    assert.equal(hidden.rows.length, 0)
    const blocked = await asUser(USER_B, () => db.query(
      `UPDATE public.user_metadata SET ui_locale = 'en' WHERE user_id = $1`,
      [USER_A]
    ))
    assert.equal(Number(blocked.affectedRows ?? blocked.rowCount ?? 0), 0)
    const still = await db.query(
      `SELECT ui_locale FROM public.user_metadata WHERE user_id = $1`,
      [USER_A]
    )
    assert.equal(still.rows[0].ui_locale, 'ja')
    await db.close()
  })
})

describe('background REST', () => {
  it('writes only ui_locale and leaves the float column out of the payload', async () => {
    const calls = []
    let stored = null
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options })
      const method = options.method || 'GET'
      if (method === 'GET') {
        return new Response(JSON.stringify(stored ? [stored] : []), { status: 200 })
      }
      if (method === 'PATCH') {
        const body = JSON.parse(options.body)
        assert.deepEqual(body, { ui_locale: 'ja' })
        if (!stored) return new Response(JSON.stringify([]), { status: 200 })
        stored = { ...stored, ...body }
        return new Response(JSON.stringify([stored]), { status: 200 })
      }
      const body = JSON.parse(options.body)
      assert.deepEqual(body, { user_id: USER_A, ui_locale: 'ja' })
      stored = { user_id: USER_A, ui_locale: 'ja', show_tool_float: true }
      return new Response(JSON.stringify([stored]), { status: 201 })
    }
    const io = createLocaleRestIo({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      fetchImpl
    })
    assert.equal(await readUiLocale(io, USER_A), 'system')
    assert.equal(await writeUiLocale(io, USER_A, 'ja'), 'ja')
    assert.equal(calls[1].options.method, 'PATCH')
    assert.equal(calls[2].options.method, 'POST')
    assert.equal(await readUiLocale(io, USER_A), 'ja')
    assert.equal(stored.show_tool_float, true)
  })
})
