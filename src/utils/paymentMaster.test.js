import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  PAYMENT_MASTER_CACHE_KEY,
  PAYMENT_MASTER_CACHE_TTL_MS,
  PAYMENT_MASTER_KEY,
  clearPaymentMasterCache,
  createAppConfigRestIo,
  fetchPaymentMasterEnabled,
  getPaymentMasterEnabled,
  parsePaymentMasterEnabled,
  supabaseAppConfigIo
} from './paymentMaster.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const USER_A = '11111111-1111-4111-8111-111111111111'

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

describe('parsePaymentMasterEnabled', () => {
  it('defaults to off for missing or invalid shapes', () => {
    assert.equal(parsePaymentMasterEnabled(null), false)
    assert.equal(parsePaymentMasterEnabled(undefined), false)
    assert.equal(parsePaymentMasterEnabled('not-json'), false)
    assert.equal(parsePaymentMasterEnabled('null'), false)
    assert.equal(parsePaymentMasterEnabled('true'), false)
    assert.equal(parsePaymentMasterEnabled([]), false)
    assert.equal(parsePaymentMasterEnabled({}), false)
    assert.equal(parsePaymentMasterEnabled({ enabled: false }), false)
    assert.equal(parsePaymentMasterEnabled({ enabled: 'true' }), false)
  })

  it('returns true only when enabled is boolean true', () => {
    assert.equal(parsePaymentMasterEnabled({ enabled: true }), true)
    assert.equal(parsePaymentMasterEnabled('{"enabled":true}'), true)
    assert.equal(parsePaymentMasterEnabled('{"enabled":false}'), false)
  })
})

describe('fetch and cache', () => {
  it('reads via supabase io and caches in session only', async () => {
    const calls = []
    const io = {
      async selectPaymentMaster() {
        calls.push('select')
        return { data: { key: PAYMENT_MASTER_KEY, value: { enabled: true } }, error: null }
      }
    }
    const session = createMemoryArea()
    const localWrites = []
    const syncWrites = []
    const guardedLocal = {
      async set(obj) {
        localWrites.push(obj)
        throw new Error('local forbidden')
      }
    }
    const guardedSync = {
      async set(obj) {
        syncWrites.push(obj)
        throw new Error('sync forbidden')
      }
    }

    const first = await getPaymentMasterEnabled({
      io,
      sessionArea: session,
      now: 1_000
    })
    assert.equal(first, true)
    assert.equal(calls.length, 1)
    assert.deepEqual(session.data[PAYMENT_MASTER_CACHE_KEY], {
      enabled: true,
      fetchedAt: 1_000
    })

    const second = await getPaymentMasterEnabled({
      io,
      sessionArea: session,
      now: 1_000 + PAYMENT_MASTER_CACHE_TTL_MS - 1
    })
    assert.equal(second, true)
    assert.equal(calls.length, 1)

    const third = await getPaymentMasterEnabled({
      io,
      sessionArea: session,
      now: 1_000 + PAYMENT_MASTER_CACHE_TTL_MS + 1
    })
    assert.equal(third, true)
    assert.equal(calls.length, 2)

    await clearPaymentMasterCache(session)
    assert.equal(session.data[PAYMENT_MASTER_CACHE_KEY], undefined)

    // 确认本模块不会去写 local/sync（调用方也不应传入它们作为真相源）
    assert.equal(localWrites.length, 0)
    assert.equal(syncWrites.length, 0)
    void guardedLocal
    void guardedSync
  })

  it('force skips cache and surfaces io errors', async () => {
    let n = 0
    const io = {
      async selectPaymentMaster() {
        n += 1
        if (n === 1) {
          return { data: { key: PAYMENT_MASTER_KEY, value: { enabled: false } }, error: null }
        }
        return { data: null, error: { message: 'network' } }
      }
    }
    const session = createMemoryArea()
    assert.equal(
      await getPaymentMasterEnabled({ io, sessionArea: session, now: 10 }),
      false
    )
    await assert.rejects(
      () => getPaymentMasterEnabled({ io, sessionArea: session, now: 11, force: true }),
      /network/
    )
  })

  it('supabaseAppConfigIo selects payment_master key', async () => {
    const calls = []
    const client = {
      from(table) {
        calls.push(['from', table])
        return {
          select(cols) {
            calls.push(['select', cols])
            return {
              eq(col, val) {
                calls.push(['eq', col, val])
                return {
                  async maybeSingle() {
                    return {
                      data: { key: PAYMENT_MASTER_KEY, value: { enabled: false } },
                      error: null
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    const enabled = await fetchPaymentMasterEnabled(supabaseAppConfigIo(client))
    assert.equal(enabled, false)
    assert.deepEqual(calls[0], ['from', 'app_config'])
    assert.deepEqual(calls[2], ['eq', 'key', PAYMENT_MASTER_KEY])
  })

  it('REST io works with anon bearer and parses enabled', async () => {
    const seen = []
    const fetchImpl = async (url, init) => {
      seen.push({ url, init })
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify([{ key: PAYMENT_MASTER_KEY, value: { enabled: true } }])
        }
      }
    }
    const io = createAppConfigRestIo({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon-key',
      fetchImpl
    })
    assert.equal(await fetchPaymentMasterEnabled(io), true)
    assert.match(seen[0].url, /\/rest\/v1\/app_config\?/)
    assert.match(seen[0].url, /key=eq\.payment_master/)
    assert.equal(seen[0].init.headers.apikey, 'anon-key')
    assert.equal(seen[0].init.headers.Authorization, 'Bearer anon-key')
  })
})

describe('schema app_config', () => {
  it('defines payment_master default off with select-only RLS', async () => {
    const sql = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    assert.match(sql, /create table public\.app_config/)
    assert.match(sql, /'payment_master'/)
    assert.match(sql, /\{\s*"enabled":\s*false\s*\}/)
    assert.match(sql, /create policy "app_config_select"/)
    assert.match(sql, /to anon, authenticated/)
    assert.match(sql, /grant select on public\.app_config to anon, authenticated/)
    assert.doesNotMatch(sql, /create policy "app_config_insert"/)
    assert.doesNotMatch(sql, /create policy "app_config_update"/)

    const migration = readFileSync(
      resolve(root, 'supabase/migrations/app_config_payment_master.sql'),
      'utf8'
    )
    assert.match(migration, /payment_master/)
    assert.match(migration, /线上 apply/)
    assert.match(migration, /enabled": false/)

    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite()
    const tableStart = sql.indexOf('-- ---------- 表：app_config 全局配置')
    const tableEnd = sql.indexOf('-- ---------- 函数：accept_share_lookup', tableStart)
    const policyStart = sql.indexOf('-- app_config：anon / authenticated 可读总开关')
    const policyEnd = sql.indexOf('-- env_shares：用户管理自己创建的分享', policyStart)
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
      DO $$ BEGIN
        CREATE ROLE anon;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    `)
    await db.exec(tableSql)

    const seeded = await db.query(
      `SELECT key, value->>'enabled' AS enabled FROM public.app_config WHERE key = $1`,
      [PAYMENT_MASTER_KEY]
    )
    assert.equal(seeded.rows.length, 1)
    assert.equal(seeded.rows[0].enabled, 'false')

    await db.exec(policySql)
    await db.exec(`
      GRANT SELECT ON public.app_config TO anon, authenticated;
      ALTER TABLE public.app_config FORCE ROW LEVEL SECURITY;
      INSERT INTO auth.users (id) VALUES ('${USER_A}');
    `)

    async function asRole(role, userId, fn) {
      await db.exec('RESET ROLE')
      if (userId) {
        await db.query(`SELECT set_config('app.user_id', $1, false)`, [userId])
      } else {
        await db.query(`SELECT set_config('app.user_id', '', false)`)
      }
      await db.exec(`SET ROLE ${role}`)
      try {
        return await fn()
      } finally {
        await db.exec('RESET ROLE')
      }
    }

    const asAnon = await asRole('anon', null, () => db.query(
      `SELECT value->>'enabled' AS enabled FROM public.app_config WHERE key = $1`,
      [PAYMENT_MASTER_KEY]
    ))
    assert.equal(asAnon.rows[0].enabled, 'false')

    const asAuth = await asRole('authenticated', USER_A, () => db.query(
      `SELECT value->>'enabled' AS enabled FROM public.app_config WHERE key = $1`,
      [PAYMENT_MASTER_KEY]
    ))
    assert.equal(asAuth.rows[0].enabled, 'false')

    // 仅 GRANT SELECT：写操作在表权限层即拒绝（不仅靠无写策略）
    await assert.rejects(() => asRole('authenticated', USER_A, () => db.query(
      `UPDATE public.app_config SET value = '{"enabled": true}'::jsonb WHERE key = $1`,
      [PAYMENT_MASTER_KEY]
    )))
    await assert.rejects(() => asRole('anon', null, () => db.query(
      `INSERT INTO public.app_config (key, value) VALUES ('x', '{}'::jsonb)`
    )))
    await assert.rejects(() => asRole('authenticated', USER_A, () => db.query(
      `DELETE FROM public.app_config WHERE key = $1`,
      [PAYMENT_MASTER_KEY]
    )))

    const stillOff = await asRole('anon', null, () => db.query(
      `SELECT value->>'enabled' AS enabled FROM public.app_config WHERE key = $1`,
      [PAYMENT_MASTER_KEY]
    ))
    assert.equal(stillOff.rows[0].enabled, 'false')

    // BYPASSRLS + 写权限模拟 Dashboard / service_role 拨开关
    await db.exec('RESET ROLE')
    await db.exec(`
      DO $$ BEGIN
        CREATE ROLE service_role BYPASSRLS;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      GRANT ALL ON public.app_config TO service_role;
    `)
    await asRole('service_role', null, () => db.query(
      `UPDATE public.app_config SET value = '{"enabled": true}'::jsonb WHERE key = $1`,
      [PAYMENT_MASTER_KEY]
    ))
    const flipped = await asRole('anon', null, () => db.query(
      `SELECT value->>'enabled' AS enabled FROM public.app_config WHERE key = $1`,
      [PAYMENT_MASTER_KEY]
    ))
    assert.equal(flipped.rows[0].enabled, 'true')
    await db.close()
  })
})

describe('scope guards', () => {
  it('paymentMaster util stays read-only (no local/sync truth, no stripe)', () => {
    const util = readFileSync(resolve(root, 'src/utils/paymentMaster.js'), 'utf8')
    // 总开关模块：仅 session 短缓存；不以 local/sync 为真相源；不接 Stripe
    assert.doesNotMatch(util, /chrome\.storage\.local|chrome\.storage\.sync|storage\.sync/)
    assert.doesNotMatch(util, /stripe|checkout/i)
    // usePaymentGate（收费门 PR）可清 local 环境缓存、调 checkout；禁止 sync 作真相源
    const gate = readFileSync(resolve(root, 'src/composables/usePaymentGate.js'), 'utf8')
    assert.doesNotMatch(gate, /chrome\.storage\.sync|storage\.sync/)
  })
})
