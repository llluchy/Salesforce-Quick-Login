# Edge Functions（Stripe）

| 函数 | 作用 |
|------|------|
| `create-checkout` | 校验用户 JWT；已付费返回 `already_paid`；否则创建一次性 ¥5 CNY Checkout，返回 `{ url }` |
| `stripe-webhook` | **`verify_jwt = false`**（见 `../config.toml`）；`constructEventAsync` 验签后处理 `checkout.session.completed`，幂等写 `is_paid` |

密钥与上线步骤见仓库根目录 [`docs/stripe-setup.md`](../../docs/stripe-setup.md)。**不要把 secret 提交进本目录。**
