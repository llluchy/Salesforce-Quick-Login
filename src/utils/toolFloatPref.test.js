import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { STORAGE_KEY_SESSION } from './constants.js'
import { createToolFloatMessageHandler } from './toolFloatController.js'
import {
  TOOL_FLOAT_SESSION_KEY,
  commitToolFloatChange,
  createUserMetadataRestIo,
  getLoggedOutVisible,
  readOrInsertShowToolFloat,
  setLoggedOutVisible,
  signOutToolFloat,
  supabaseUserMetadataIo,
  writeShowToolFloat
} from './toolFloatPref.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const FLOAT_KEYS = ['title', 'hint', 'switchLabel', 'syncFailed']
const SETTINGS_KEYS = ['open', 'title']

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
  const session = createMemoryArea()
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
    forbidden: guard.forbidden.length
  }
}

function assertStorageUntouched(guard, before) {
  assert.deepEqual(guard.localData, before.local)
  assert.deepEqual(guard.syncData, before.sync)
  assert.equal(guard.forbidden.length, before.forbidden)
  assert.equal(Object.hasOwn(guard.localData, 'show_tool_float'), false)
  assert.equal(Object.hasOwn(guard.localData, TOOL_FLOAT_SESSION_KEY), false)
  assert.equal(Object.hasOwn(guard.syncData, 'show_tool_float'), false)
  assert.equal(Object.hasOwn(guard.syncData, TOOL_FLOAT_SESSION_KEY), false)
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
    const show = Object.prototype.hasOwnProperty.call(row, 'show_tool_float')
      ? row.show_tool_float
      : true
    rows.set(uid, { user_id: uid, show_tool_float: show })
    return { data: { show_tool_float: show }, error: null }
  }

  function doUpdate(uid, state) {
    const userId = state.eq?.[1]
    if (userId !== uid || !rows.has(userId)) return { data: [], error: null }
    const row = rows.get(userId)
    row.show_tool_float = state.patch.show_tool_float
    return { data: [{ show_tool_float: row.show_tool_float }], error: null }
  }

  function doSelect(uid, state) {
    const userId = state.eq?.[1]
    if (userId !== uid) return { data: null, error: null }
    const row = rows.get(userId)
    return { data: row ? { show_tool_float: row.show_tool_float } : null, error: null }
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
      return supabaseUserMetadataIo(clientFor(uid))
    }
  }
}

function handlerFor(guard, store, broadcast = () => {}) {
  return createToolFloatMessageHandler({
    storage: guard.storage,
    broadcast,
    ioForSession: (session) => store.io(session.user.id)
  })
}

describe('logged-out session', () => {
  it('defaults to visible, stays hidden for this browser session, and returns after restart', async () => {
    const guard = createGuardedStorage()
    const store = createMetadataStore()
    const handle = handlerFor(guard, store)
    const before = snapshotStorage(guard)

    const opened = await handle.getVisible()
    assert.equal(opened.visible, true)
    assert.equal(opened.source, 'session')

    const hidden = await handle.setSession(false)
    assert.equal(hidden.visible, false)
    assert.equal(guard.session.data[TOOL_FLOAT_SESSION_KEY], false)

    const reopened = await handle.getVisible()
    assert.equal(reopened.visible, false)

    const restarted = createMemoryArea()
    assert.equal(await getLoggedOutVisible(restarted), true)
    assertStorageUntouched(guard, before)
  })

  it('does not add a local or sync key while hidden', async () => {
    const guard = createGuardedStorage()
    const before = snapshotStorage(guard)
    await setLoggedOutVisible(guard.session, false)
    await setLoggedOutVisible(guard.session, true)
    assert.equal(guard.session.data[TOOL_FLOAT_SESSION_KEY], undefined)
    assertStorageUntouched(guard, before)
  })
})

describe('logged-in cloud value', () => {
  it('inserts show_tool_float true when the row is missing, then toggles false and true', async () => {
    const store = createMetadataStore()
    const inserted = await readOrInsertShowToolFloat(store.io(USER_A), USER_A)
    assert.equal(inserted, true)
    assert.equal(store.rows.get(USER_A).show_tool_float, true)
    const insertCall = store.calls.find((call) => call.op === 'insert')
    assert.ok(insertCall)
    assert.equal(insertCall.row.user_id, USER_A)
    assert.equal(Object.hasOwn(insertCall.row, 'show_tool_float'), false)

    assert.equal(await writeShowToolFloat(store.io(USER_A), USER_A, false), false)
    assert.equal(store.rows.get(USER_A).show_tool_float, false)
    assert.equal(await writeShowToolFloat(store.io(USER_A), USER_A, true), true)
    assert.equal(store.rows.get(USER_A).show_tool_float, true)
  })

  it('lets the cloud value replace a logged-out hide, including when the cloud value is false', async () => {
    const store = createMetadataStore()
    await readOrInsertShowToolFloat(store.io(USER_A), USER_A)

    const showGuard = createGuardedStorage()
    showGuard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    await setLoggedOutVisible(showGuard.session, false)
    const beforeShow = snapshotStorage(showGuard)
    const show = await handlerFor(showGuard, store).getVisible()
    assert.deepEqual(show, { success: true, visible: true, source: 'cloud' })
    assert.equal(showGuard.session.data[TOOL_FLOAT_SESSION_KEY], undefined)
    assertStorageUntouched(showGuard, beforeShow)

    await writeShowToolFloat(store.io(USER_A), USER_A, false)
    const hideGuard = createGuardedStorage()
    hideGuard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    await setLoggedOutVisible(hideGuard.session, false)
    const beforeHide = snapshotStorage(hideGuard)
    const hidden = await handlerFor(hideGuard, store).getVisible()
    assert.equal(hidden.visible, false)
    assert.equal(hidden.source, 'cloud')
    assert.equal(hideGuard.session.data[TOOL_FLOAT_SESSION_KEY], undefined)
    assertStorageUntouched(hideGuard, beforeHide)
  })

  it('shares one cloud row across two session areas', async () => {
    const store = createMetadataStore()
    const first = createGuardedStorage()
    const second = createGuardedStorage()
    first.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    second.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    await readOrInsertShowToolFloat(store.io(USER_A), USER_A)
    await writeShowToolFloat(store.io(USER_A), USER_A, false)
    const seen = await handlerFor(second, store).getVisible()
    assert.equal(seen.visible, false)
    await writeShowToolFloat(store.io(USER_A), USER_A, true)
    const restored = await handlerFor(first, store).getVisible()
    assert.equal(restored.visible, true)
  })

  it('clears the session override on logout and does not copy the cloud value', async () => {
    const store = createMetadataStore()
    await readOrInsertShowToolFloat(store.io(USER_A), USER_A)
    await writeShowToolFloat(store.io(USER_A), USER_A, false)

    const guard = createGuardedStorage()
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    await setLoggedOutVisible(guard.session, false)
    await handlerFor(guard, store).applyCloud(false)
    assert.equal(guard.session.data[TOOL_FLOAT_SESSION_KEY], undefined)

    const before = snapshotStorage(guard)
    const broadcasts = []
    const handle = handlerFor(guard, store, (visible) => {
      broadcasts.push(visible)
    })
    const response = await new Promise((resolve) => {
      handle({ action: 'toolFloatSignedOut' }, {}, resolve)
    })
    assert.equal(response.visible, true)
    assert.deepEqual(broadcasts, [true])
    assert.equal(await getLoggedOutVisible(guard.session), true)
    assert.equal(store.rows.get(USER_A).show_tool_float, false)
    assert.equal(guard.session.data[TOOL_FLOAT_SESSION_KEY], undefined)
    assertStorageUntouched(guard, before)

    const area = createMemoryArea({ [TOOL_FLOAT_SESSION_KEY]: false })
    const direct = await signOutToolFloat(area)
    assert.equal(direct.visible, true)
    assert.equal(area.data[TOOL_FLOAT_SESSION_KEY], undefined)
  })
})

describe('RLS and offline', () => {
  it('rejects another user reading or updating the row', async () => {
    const store = createMetadataStore()
    await readOrInsertShowToolFloat(store.io(USER_A), USER_A)
    await writeShowToolFloat(store.io(USER_A), USER_A, false)

    const peeked = await store.io(USER_B).selectOwn(USER_A)
    assert.equal(peeked.data, null)
    assert.equal(peeked.error, null)
    await assert.rejects(
      () => writeShowToolFloat(store.io(USER_B), USER_A, true),
      (error) => error.code === '42501'
    )
    assert.equal(store.rows.get(USER_A).show_tool_float, false)
    const own = await store.io(USER_A).selectOwn(USER_A)
    assert.equal(own.data.show_tool_float, false)
  })

  it('does not pretend an offline toggle succeeded', async () => {
    let sessionWrites = 0
    let cloudWrites = 0
    const result = await commitToolFloatChange({
      loggedIn: true,
      previous: true,
      next: false,
      write: async () => {
        cloudWrites += 1
        throw new Error('Failed to fetch')
      },
      setSession: async () => {
        sessionWrites += 1
        return { success: true, visible: false }
      },
      applyCloud: async () => {
        throw new Error('apply')
      }
    })
    assert.deepEqual(result, { ok: false, visible: true })
    assert.equal(cloudWrites, 1)
    assert.equal(sessionWrites, 0)

    const guard = createGuardedStorage()
    guard.localData[STORAGE_KEY_SESSION] = authSession(USER_A)
    await setLoggedOutVisible(guard.session, false)
    const before = snapshotStorage(guard)
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
    }).getVisible()
    assert.equal(failed.success, false)
    assert.equal(guard.session.data[TOOL_FLOAT_SESSION_KEY], false)
    assertStorageUntouched(guard, before)
  })
})

describe('i18n and wiring', () => {
  it('has the same tool float copy keys in zh-CN, en, and ja', () => {
    const locales = ['zh-CN', 'en', 'ja'].map((name) => ({
      name,
      messages: JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${name}.json`), 'utf8'))
    }))
    const bundles = locales.map((locale) => locale.messages.toolFloat)
    for (const bundle of bundles) {
      assert.deepEqual(Object.keys(bundle).sort(), [...FLOAT_KEYS].sort())
      for (const key of FLOAT_KEYS) {
        assert.equal(typeof bundle[key], 'string')
        assert.ok(bundle[key].trim().length > 0)
      }
    }
    for (const key of FLOAT_KEYS) {
      const values = new Set(bundles.map((bundle) => bundle[key]))
      assert.equal(values.size, 3, key)
    }

    const settingsBundles = locales.map((locale) => locale.messages.settings)
    for (const bundle of settingsBundles) {
      assert.deepEqual(Object.keys(bundle).sort(), [...SETTINGS_KEYS].sort())
      for (const key of SETTINGS_KEYS) {
        assert.equal(typeof bundle[key], 'string')
        assert.ok(bundle[key].trim().length > 0)
      }
    }
    for (const key of SETTINGS_KEYS) {
      const values = new Set(settingsBundles.map((bundle) => bundle[key]))
      assert.equal(values.size, 3, key)
    }

    const vue = readFileSync(resolve(root, 'src/components/ToolFloatToggle.vue'), 'utf8')
    for (const key of FLOAT_KEYS) {
      assert.match(vue, new RegExp(`t\\('toolFloat\\.${key}'\\)`))
    }
    const template = vue.slice(vue.indexOf('<template>'), vue.indexOf('</template>'))
    assert.doesNotMatch(template, /[\u3400-\u9fff]/)
    assert.match(vue, /\.float-toggle-modal/)

    const gear = readFileSync(resolve(root, 'src/components/SettingsGear.vue'), 'utf8')
    assert.match(gear, /t\('settings\.open'\)/)
    assert.match(gear, /t\('settings\.title'\)/)
    assert.match(gear, /<ToolFloatToggle variant="modal" \/>/)
    assert.match(gear, /role="dialog"/)
    const gearTemplate = gear.slice(gear.indexOf('<template>'), gear.indexOf('</template>'))
    assert.doesNotMatch(gearTemplate, /[\u3400-\u9fff]/)

    const auth = readFileSync(resolve(root, 'src/components/AuthScreen.vue'), 'utf8')
    const localeBlock = auth.slice(auth.indexOf('class="auth-locale"'), auth.indexOf('auth-header'))
    assert.ok(localeBlock.indexOf('<SettingsGear') !== -1)
    assert.ok(localeBlock.indexOf('<SettingsGear') < localeBlock.indexOf('<LocaleSwitcher'))
    assert.doesNotMatch(auth, /<ToolFloatToggle/)

    const toolbar = readFileSync(resolve(root, 'src/components/Toolbar.vue'), 'utf8')
    const gearAt = toolbar.indexOf('<SettingsGear')
    const accountAt = toolbar.indexOf('btn-account')
    assert.ok(gearAt !== -1 && accountAt !== -1 && gearAt < accountAt)

    const app = readFileSync(resolve(root, 'src/App.vue'), 'utf8')
    assert.doesNotMatch(app, /ToolFloatToggle/)

    const content = readFileSync(resolve(root, 'content.js'), 'utf8')
    assert.match(content, /action: 'getToolFloatVisible'/)
    assert.match(content, /syncRailFromBackground\(\)/)
    assert.match(content, /action !== 'toolFloatVisibility'/)

    const pref = readFileSync(resolve(root, 'src/utils/toolFloatPref.js'), 'utf8')
    const controller = readFileSync(resolve(root, 'src/utils/toolFloatController.js'), 'utf8')
    const composable = readFileSync(resolve(root, 'src/composables/useToolFloat.js'), 'utf8')
    for (const src of [pref, controller, composable]) {
      assert.doesNotMatch(src, /chrome\.storage\.local\.set|chrome\.storage\.sync|storage\.sync/)
    }
  })
})

describe('schema RLS', () => {
  it('declares the live user_metadata shape and authenticated policies', () => {
    const sql = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    assert.match(sql, /create table public\.user_metadata/)
    assert.match(sql, /show_tool_float boolean not null default true/)
    assert.match(sql, /references auth\.users \(id\) on delete CASCADE/)
    assert.match(sql, /trg_user_metadata_touch BEFORE/)
    assert.match(sql, /execute FUNCTION touch_updated_at \(\)/)
    assert.match(sql, /alter table public\.user_metadata enable row level security/)
    assert.match(sql, /for INSERT to authenticated[\s\S]*with check \(auth\.uid\(\) = user_id\)/)
    assert.match(sql, /for SELECT to authenticated[\s\S]*using \(auth\.uid\(\) = user_id\)/)
    assert.match(
      sql,
      /for UPDATE to authenticated[\s\S]*using \(auth\.uid\(\) = user_id\)[\s\S]*with check \(auth\.uid\(\) = user_id\)/
    )
  })

  it('blocks another role from reading or updating the row', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite()
    const sql = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    const tableStart = sql.indexOf('-- ---------- 表：user_metadata 用户设置 ----------')
    const tableEnd = sql.indexOf('-- ---------- 表：saved_soql_queries 常用查询 ----------', tableStart)
    const policyStart = sql.indexOf('-- user_metadata：仅本人可读写自己的偏好')
    const policyEnd = sql.indexOf('-- saved_soql_queries：仅本人可读写自己记下的查询', policyStart)
    const tableSql = sql.slice(tableStart, tableEnd).replace(/\s*TABLESPACE pg_default/gi, '')
    const policySql = sql.slice(policyStart, policyEnd)

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
      `INSERT INTO public.user_metadata (user_id) VALUES ($1)`,
      [USER_A]
    ))
    const inserted = await db.query(
      `SELECT show_tool_float FROM public.user_metadata WHERE user_id = $1`,
      [USER_A]
    )
    assert.equal(inserted.rows[0].show_tool_float, true)

    await asUser(USER_A, () => db.query(
      `UPDATE public.user_metadata SET show_tool_float = false WHERE user_id = $1`,
      [USER_A]
    ))

    const hidden = await asUser(USER_B, () => db.query(
      `SELECT show_tool_float FROM public.user_metadata`
    ))
    assert.equal(hidden.rows.length, 0)

    const blocked = await asUser(USER_B, () => db.query(
      `UPDATE public.user_metadata SET show_tool_float = true WHERE user_id = $1`,
      [USER_A]
    ))
    const affected = blocked.affectedRows ?? blocked.rowCount ?? 0
    assert.equal(Number(affected), 0)

    await assert.rejects(() => asUser(USER_B, () => db.query(
      `INSERT INTO public.user_metadata (user_id) VALUES ($1)`,
      [USER_A]
    )))

    const still = await db.query(
      `SELECT show_tool_float FROM public.user_metadata WHERE user_id = $1`,
      [USER_A]
    )
    assert.equal(still.rows[0].show_tool_float, false)

    await db.exec('ALTER TABLE public.user_metadata DISABLE TRIGGER trg_user_metadata_touch')
    await db.query(
      `UPDATE public.user_metadata SET updated_at = '2000-01-01T00:00:00Z' WHERE user_id = $1`,
      [USER_A]
    )
    await db.exec('ALTER TABLE public.user_metadata ENABLE TRIGGER trg_user_metadata_touch')
    await asUser(USER_A, () => db.query(
      `UPDATE public.user_metadata SET show_tool_float = true WHERE user_id = $1`,
      [USER_A]
    ))
    const touched = await db.query(
      `SELECT updated_at FROM public.user_metadata WHERE user_id = $1`,
      [USER_A]
    )
    assert.ok(new Date(touched.rows[0].updated_at).getTime() > new Date('2001-01-01').getTime())

    await db.query(`DELETE FROM auth.users WHERE id = $1`, [USER_A])
    const left = await db.query(`SELECT count(*)::int AS n FROM public.user_metadata`)
    assert.equal(Number(left.rows[0].n), 0)
    await db.close()
  })
})

describe('background REST insert', () => {
  it('omits show_tool_float on insert so the database default applies', async () => {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options })
      if ((options.method || 'GET') === 'GET') {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      const body = JSON.parse(options.body)
      assert.deepEqual(body, { user_id: USER_A })
      return new Response(JSON.stringify([{ user_id: USER_A, show_tool_float: true }]), { status: 201 })
    }
    const io = createUserMetadataRestIo({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      fetchImpl
    })
    assert.equal(await readOrInsertShowToolFloat(io, USER_A), true)
    assert.equal(calls[1].options.method, 'POST')
  })
})
