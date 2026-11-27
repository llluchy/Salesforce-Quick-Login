// Stripe Webhook：checkout.session.completed → 幂等标记 is_paid。密钥仅环境变量。
// 部署时必须 verify_jwt = false（见 supabase/config.toml）；鉴权靠 Stripe 签名。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method_not_allowed', { status: 405 })
  }

  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceRole) {
    console.error('[stripe-webhook] missing env')
    return new Response('server_misconfigured', { status: 500 })
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response('missing_signature', { status: 400 })
  }

  const body = await req.text()
  let event: Stripe.Event
  try {
    // Deno 仅异步 Web Crypto：必须用 constructEventAsync，勿用同步 constructEvent
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe-webhook] verify failed', err)
    return new Response('invalid_signature', { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId =
      session.metadata?.user_id ||
      session.client_reference_id ||
      null
    const sessionId = session.id
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id || null

    if (!userId || !sessionId) {
      console.error('[stripe-webhook] missing user_id or session id', { userId, sessionId })
      return new Response('bad_payload', { status: 400 })
    }

    if (session.payment_status && session.payment_status !== 'paid') {
      // 未付款完成：不记账，仍 200 避免 Stripe 无限重试（可按需改）
      console.warn('[stripe-webhook] session not paid', session.payment_status)
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await admin.rpc('claim_payment_from_stripe', {
      p_user_id: userId,
      p_session_id: sessionId,
      p_customer_id: customerId,
    })

    if (error) {
      console.error('[stripe-webhook] claim failed', error)
      return new Response('claim_failed', { status: 500 })
    }

    return new Response(JSON.stringify({ ok: true, claimed: data === true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, ignored: event.type }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
