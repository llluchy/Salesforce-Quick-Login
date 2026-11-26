# Edge Functions（Stripe）

| 函数 | 作用 |
|------|------|
| `create-checkout` | 校验用户 JWT，创建一次性 ¥5 CNY Checkout Session，返回 `{ url }` |
| `stripe-webhook` | 验签后处理 `checkout.session.completed`，调用 `claim_payment_from_stripe` 幂等写 `is_paid` |

密钥与上线步骤见仓库根目录 [`docs/stripe-setup.md`](../../docs/stripe-setup.md)。**不要把 secret 提交进本目录。**
