// Stripe Webhook：付款完成 → 标记 is_paid；退款 → 取消授权。密钥仅环境变量。
// 部署时必须 verify_jwt = false（见 supabase/config.toml）；鉴权靠 Stripe 签名。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno'

type AdminClient = ReturnType<typeof createClient>

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

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

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
      return json({ ok: true, skipped: true })
    }

    const { data, error } = await admin.rpc('claim_payment_from_stripe', {
      p_user_id: userId,
      p_session_id: sessionId,
      p_customer_id: customerId,
    })

    if (error) {
      console.error('[stripe-webhook] claim failed', error)
      return new Response('claim_failed', { status: 500 })
    }

    return json({ ok: true, claimed: data === true })
  }

  if (
    event.type === 'charge.refunded' ||
    event.type === 'refund.created' ||
    event.type === 'charge.refund.updated'
  ) {
    return await handleRefundEvent(event, stripe, admin)
  }

  return json({ ok: true, ignored: event.type })
})

async function handleRefundEvent(
  event: Stripe.Event,
  stripe: Stripe,
  admin: AdminClient,
): Promise<Response> {
  let charge: Stripe.Charge | null = null
  let refundId: string | null = null
  let refundStatus: string | null = null

  if (event.type === 'charge.refunded') {
    charge = event.data.object as Stripe.Charge
    // 含部分退款：只要有退款金额即取消授权（一次性 ¥5）
    if (!charge.amount_refunded || charge.amount_refunded <= 0) {
      return json({ ok: true, skipped: true, reason: 'no_refund_amount' })
    }
  } else {
    const refund = event.data.object as Stripe.Refund
    refundId = refund.id
    refundStatus = refund.status
    // 仅成功/处理中的退款取消授权；失败/取消不改 is_paid
    if (refundStatus && refundStatus !== 'succeeded' && refundStatus !== 'pending') {
      return json({ ok: true, skipped: true, reason: 'refund_not_active', status: refundStatus })
    }
    const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id
    if (!chargeId) {
      console.error('[stripe-webhook] refund missing charge', refundId)
      return json({ ok: true, skipped: true, reason: 'missing_charge' })
    }
    try {
      charge = await stripe.charges.retrieve(chargeId)
    } catch (err) {
      console.error('[stripe-webhook] charge retrieve failed', err)
      return new Response('charge_retrieve_failed', { status: 500 })
    }
  }

  const userId = await resolveUserIdFromCharge(stripe, admin, charge!)
  if (!userId) {
    console.error('[stripe-webhook] cannot resolve user for refund', {
      chargeId: charge!.id,
      refundId,
      event: event.type,
    })
    // 无法关联用户：200 避免无限重试；需人工对照 Stripe Dashboard
    return json({ ok: true, skipped: true, reason: 'user_unresolved' })
  }

  const { data, error } = await admin.rpc('revoke_payment_from_stripe', {
    p_user_id: userId,
    p_refund_id: refundId,
  })

  if (error) {
    console.error('[stripe-webhook] revoke failed', error)
    return new Response('revoke_failed', { status: 500 })
  }

  return json({
    ok: true,
    revoked: data === true,
    user_id: userId,
    event: event.type,
  })
}

async function resolveUserIdFromCharge(
  stripe: Stripe,
  admin: AdminClient,
  charge: Stripe.Charge,
): Promise<string | null> {
  const fromMeta = charge.metadata?.user_id
  if (fromMeta) return fromMeta

  const piId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id || null

  if (piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId)
      if (pi.metadata?.user_id) return pi.metadata.user_id
    } catch (err) {
      console.warn('[stripe-webhook] payment_intent retrieve failed', err)
    }

    try {
      const sessions = await stripe.checkout.sessions.list({
        payment_intent: piId,
        limit: 1,
      })
      const session = sessions.data[0]
      if (session) {
        const fromSession =
          session.metadata?.user_id || session.client_reference_id || null
        if (fromSession) return fromSession

        const { data } = await admin
          .from('user_billing')
          .select('user_id')
          .eq('stripe_checkout_session_id', session.id)
          .maybeSingle()
        if (data?.user_id) return data.user_id
      }
    } catch (err) {
      console.warn('[stripe-webhook] checkout session lookup failed', err)
    }
  }

  const customerId =
    typeof charge.customer === 'string'
      ? charge.customer
      : charge.customer?.id || null
  if (customerId) {
    const { data } = await admin
      .from('user_billing')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    if (data?.user_id) return data.user_id
  }

  return null
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
