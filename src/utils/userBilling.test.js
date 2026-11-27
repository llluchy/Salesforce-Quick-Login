import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  createCheckoutSession,
  fetchOwnBilling,
  normalizeBillingRow,
  openCheckoutUrl,
  supabaseUserBillingIo
} from './userBilling.js'
import { PAYMENT_CONTACT_EMAILS, mailtoHref } from './paymentContact.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const USER_A = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'

describe('paymentContact', () => {
  it('exposes both locked contact emails', () => {
    assert.deepEqual([...PAYMENT_CONTACT_EMAILS], [
      'llluchy@outlook.com',
      'llluchy@qq.com'
    ])
    assert.equal(mailtoHref('llluchy@outlook.com'), 'mailto:llluchy@outlook.com')
  })
})

describe('normalizeBillingRow', () => {
  it('treats missing row as unpaid', () => {
    assert.deepEqual(normalizeBillingRow(null), {
      isPaid: false,
      paidAt: null,
      stripeCheckoutSessionId: null
    })
  })

  it('maps paid row', () => {
    assert.deepEqual(normalizeBillingRow({
      is_paid: true,
      paid_at: '2026-11-26T00:00:00Z',
      stripe_checkout_session_id: 'cs_test_1'
    }), {
      isPaid: true,
      paidAt: '2026-11-26T00:00:00Z',
      stripeCheckoutSessionId: 'cs_test_1'
    })
  })
})

describe('fetchOwnBilling / checkout helpers', () => {
  it('reads via io and opens checkout url', async () => {
    const io = {
      async selectOwn(userId) {
        assert.equal(userId, USER_A)
        return { data: { is_paid: false, paid_at: null, stripe_checkout_session_id: null }, error: null }
      }
    }
    const row = await fetchOwnBilling(io, USER_A)
    assert.equal(row.isPaid, false)

    const url = await createCheckoutSession(async (name, options) => {
      assert.equal(name, 'create-checkout')
      assert.equal(options.method, 'POST')
      return { data: { url: 'https://checkout.stripe.com/c/pay/cs_test' }, error: null }
    })
    assert.match(url, /^https:\/\/checkout\.stripe\.com\//)

    let opened = null
    await openCheckoutUrl(url, async (u) => { opened = u })
    assert.equal(opened, url)
  })

  it('rejects missing checkout url', async () => {
    await assert.rejects(
      () => createCheckoutSession(async () => ({ data: { error: 'checkout_failed' }, error: null })),
      /checkout/
    )
  })

  it('surfaces already_paid from create-checkout', async () => {
    await assert.rejects(
      () => createCheckoutSession(async () => ({ data: { error: 'already_paid' }, error: null })),
      (err) => err.code === 'already_paid' && err.status === 409
    )
  })

  it('supabaseUserBillingIo selects own columns only', async () => {
    const calls = []
    const client = {
      from(table) {
        assert.equal(table, 'user_billing')
        return {
          select(cols) {
            calls.push(cols)
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: null, error: null })
                }
              }
            }
          }
        }
      }
    }
    await supabaseUserBillingIo(client).selectOwn(USER_A)
    assert.equal(calls[0], 'is_paid, paid_at, stripe_checkout_session_id')
  })
})

describe('i18n payment keys', () => {
  it('keeps zh-CN / en / ja payment key sets aligned', () => {
    const locales = ['zh-CN', 'en', 'ja'].map((name) => ({
      name,
      json: JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${name}.json`), 'utf8'))
    }))
    const keys = Object.keys(locales[0].json.payment).sort()
    for (const loc of locales) {
      assert.deepEqual(Object.keys(loc.json.payment).sort(), keys, loc.name)
      for (const k of keys) {
        assert.equal(typeof loc.json.payment[k], 'string')
        assert.ok(loc.json.payment[k].length > 0, `${loc.name}.${k}`)
      }
    }
  })
})

describe('schema user_billing', () => {
  it('declares user_billing, claim RPC, and read-only RLS for clients', async () => {
    const sql = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
    assert.match(sql, /create table public\.user_billing/)
    assert.match(sql, /is_paid boolean not null default false/)
    assert.match(sql, /claim_payment_from_stripe/)
    assert.match(sql, /user_billing_select_own/)
    assert.doesNotMatch(
      sql.slice(sql.indexOf('-- ---------- 表：saved_soql_queries'), sql.indexOf('-- ---------- 函数：accept_share_lookup')),
      /user_billing/
    )

    const migration = readFileSync(resolve(root, 'supabase/migrations/user_billing.sql'), 'utf8')
    assert.match(migration, /create table if not exists public\.user_billing/)
    assert.match(migration, /on_auth_user_created_billing/)
    assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.user_billing/i)
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_payment_from_stripe/i)

    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite()

    const tableStart = sql.indexOf('-- ---------- 表：user_billing 账号付费状态 ----------')
    const tableEnd = sql.indexOf('-- ---------- 函数：ensure_user_billing_row', tableStart)
    const fnStart = sql.indexOf('-- ---------- 函数：ensure_user_billing_row')
    const fnEnd = sql.indexOf('-- ------------------------------------------------------------\n-- RLS 策略', fnStart)
    const policyStart = sql.indexOf('-- user_billing：用户仅可读自己的付费状态')
    const tableSql = sql.slice(tableStart, tableEnd).replace(/\s*TABLESPACE pg_default/gi, '')
    let fnSql = sql.slice(fnStart, fnEnd)
    // 备份里触发器对 auth.users 是注释掉的；测试里手动挂
    fnSql = fnSql.replace(/-- CREATE TRIGGER on_auth_user_created_billing[\s\S]*?--\s*FOR EACH ROW EXECUTE FUNCTION public\.ensure_user_billing_row\(\);/, '')
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
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
    `)
    await db.exec(tableSql)
    await db.exec(fnSql)
    await db.exec(`
      CREATE TRIGGER on_auth_user_created_billing
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.ensure_user_billing_row();
    `)
    await db.exec(policySql)
    await db.exec(`
      GRANT SELECT ON public.user_billing TO authenticated;
      REVOKE INSERT, UPDATE, DELETE ON public.user_billing FROM PUBLIC, authenticated;
      ALTER TABLE public.user_billing FORCE ROW LEVEL SECURITY;
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
    `)

    const seeded = await db.query(`SELECT is_paid FROM public.user_billing WHERE user_id = $1`, [USER_A])
    assert.equal(seeded.rows[0].is_paid, false)

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

    const own = await asUser(USER_A, () => db.query(
      `SELECT is_paid FROM public.user_billing WHERE user_id = $1`,
      [USER_A]
    ))
    assert.equal(own.rows[0].is_paid, false)

    const other = await asUser(USER_A, () => db.query(
      `SELECT is_paid FROM public.user_billing WHERE user_id = $1`,
      [USER_B]
    ))
    assert.equal(other.rows.length, 0)

    await assert.rejects(() => asUser(USER_A, () => db.query(
      `UPDATE public.user_billing SET is_paid = true WHERE user_id = $1`,
      [USER_A]
    )))

    await db.exec('RESET ROLE')
    const claimed = await db.query(
      `SELECT public.claim_payment_from_stripe($1::uuid, $2::text, $3::text) AS ok`,
      [USER_A, 'cs_test_abc', 'cus_1']
    )
    assert.equal(claimed.rows[0].ok, true)
    const after = await db.query(
      `SELECT is_paid, stripe_checkout_session_id, stripe_customer_id FROM public.user_billing WHERE user_id = $1`,
      [USER_A]
    )
    assert.equal(after.rows[0].is_paid, true)
    assert.equal(after.rows[0].stripe_checkout_session_id, 'cs_test_abc')
    assert.equal(after.rows[0].stripe_customer_id, 'cus_1')

    const again = await db.query(
      `SELECT public.claim_payment_from_stripe($1::uuid, $2::text, $3::text) AS ok`,
      [USER_A, 'cs_test_abc', 'cus_1']
    )
    assert.equal(again.rows[0].ok, true)

    const otherSession = await db.query(
      `SELECT public.claim_payment_from_stripe($1::uuid, $2::text, $3::text) AS ok`,
      [USER_A, 'cs_test_other', null]
    )
    assert.equal(otherSession.rows[0].ok, true)
    const still = await db.query(
      `SELECT stripe_checkout_session_id FROM public.user_billing WHERE user_id = $1`,
      [USER_A]
    )
    assert.equal(still.rows[0].stripe_checkout_session_id, 'cs_test_abc')
  })
})

describe('edge functions present', () => {
  it('ships create-checkout and stripe-webhook sources', () => {
    const checkout = readFileSync(resolve(root, 'supabase/functions/create-checkout/index.ts'), 'utf8')
    const webhook = readFileSync(resolve(root, 'supabase/functions/stripe-webhook/index.ts'), 'utf8')
    const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8')
    assert.match(checkout, /mode:\s*'payment'/)
    assert.match(checkout, /STRIPE_PRICE_ID/)
    assert.match(checkout, /already_paid/)
    assert.match(checkout, /is_paid/)
    assert.match(webhook, /checkout\.session\.completed/)
    assert.match(webhook, /claim_payment_from_stripe/)
    assert.match(webhook, /STRIPE_WEBHOOK_SECRET/)
    assert.match(webhook, /constructEventAsync/)
    assert.doesNotMatch(webhook, /constructEvent\(/)
    assert.match(config, /\[functions\.stripe-webhook\]/)
    assert.match(config, /verify_jwt\s*=\s*false/)
    const setup = readFileSync(resolve(root, 'docs/stripe-setup.md'), 'utf8')
    assert.match(setup, /STRIPE_SECRET_KEY/)
    assert.match(setup, /verify_jwt\s*=\s*false/)
    assert.match(setup, /llluchy@outlook\.com/)
    assert.match(setup, /llluchy@qq\.com/)
  })
})
