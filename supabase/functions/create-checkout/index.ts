// Stripe Checkout：一次性 ¥5 CNY。需用户 JWT。密钥仅环境变量，不进 git。
// 已付费账号拒绝再建 Session，避免重复扣款。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  try {
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
    const priceId = Deno.env.get('STRIPE_PRICE_ID')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')
    const successUrl =
      Deno.env.get('CHECKOUT_SUCCESS_URL') ||
      'https://llluchy.github.io/Salesforce-Quick-Login/welcome'
    const cancelUrl = Deno.env.get('CHECKOUT_CANCEL_URL') || successUrl

    if (!stripeSecret || !priceId || !supabaseUrl || !supabaseAnon) {
      return json({ error: 'server_misconfigured' }, 500)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401)
    }

    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user?.id) {
      return json({ error: 'unauthorized' }, 401)
    }

    const userId = userData.user.id
    const email = userData.user.email || undefined

    // 用户 JWT 可读本人 user_billing；已付费则拒绝开新 Checkout
    const { data: billing, error: billingError } = await supabase
      .from('user_billing')
      .select('is_paid')
      .eq('user_id', userId)
      .maybeSingle()

    if (billingError) {
      console.error('[create-checkout] billing read failed', billingError)
      return json({ error: 'billing_unavailable' }, 500)
    }

    if (billing?.is_paid === true) {
      return json({ error: 'already_paid' }, 409)
    }

    const stripe = new Stripe(stripeSecret, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      customer_email: email,
      metadata: { user_id: userId },
      payment_intent_data: {
        metadata: { user_id: userId },
      },
    })

    if (!session.url) {
      return json({ error: 'checkout_url_missing' }, 500)
    }

    return json({ url: session.url })
  } catch (e) {
    console.error('[create-checkout]', e)
    return json({ error: 'checkout_failed' }, 500)
  }
})

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
