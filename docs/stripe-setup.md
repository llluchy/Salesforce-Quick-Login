# Stripe 一次性付款（¥5 CNY）— 密钥与上线步骤

本页只写运维步骤与环境变量。**不要把任何密钥提交进 git。**

关联代码：`supabase/functions/create-checkout`、`supabase/functions/stripe-webhook`、`supabase/migrations/user_billing.sql`。

## 环境变量（Edge Functions）

在 Supabase Dashboard → Edge Functions → Secrets（或 CLI `supabase secrets set`）配置：

| 变量 | 用途 | 是否进扩展包 |
|------|------|--------------|
| `STRIPE_SECRET_KEY` | Stripe API 密钥（测试 `sk_test_…` / 正式 `sk_live_…`） | **禁止** |
| `STRIPE_WEBHOOK_SECRET` | Webhook 签名密钥（`whsec_…`） | **禁止** |
| `STRIPE_PRICE_ID` | 一次性 ¥5 CNY 的 Price ID（`price_…`） | **禁止** |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅 `stripe-webhook` 调 `claim_payment_from_stripe` | **禁止**（扩展只用 anon） |
| `SUPABASE_URL` | 项目 URL（函数运行时常已注入） | 扩展已有公开 URL |
| `SUPABASE_ANON_KEY` | `create-checkout` 校验用户 JWT（常已注入） | 扩展已有 anon |
| `CHECKOUT_SUCCESS_URL` | Stripe 成功回跳（**非必须体验**；有无皆可，扩展靠查 `is_paid`） | 可选 |
| `CHECKOUT_CANCEL_URL` | 取消回跳，任意无害页 | 可选 |

扩展包内**只**使用已有的 `SUPABASE_URL` + anon key；**不得**放入 secret / webhook secret / service_role / Price 密钥。

## Stripe Dashboard（个人或公司账户均可）

1. 创建 Product：一次性付款，价格 **¥5 CNY**（`mode=payment` 对应 Price）。
2. 复制 Price ID → `STRIPE_PRICE_ID`。
3. 部署 Edge Functions 后，Webhook 端点指向：  
   `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`  
   事件至少勾选 `checkout.session.completed`。
4. 复制 Signing secret → `STRIPE_WEBHOOK_SECRET`。
5. 测试模式与正式模式密钥分开；上线前用测试卡走通再切 live。

## 线上库（需所有者批准后再做）

**本 PR 只把 DDL 放进仓库，不自动改线上库。** 批准后建议顺序：

1. 在 SQL Editor 执行 `supabase/migrations/user_billing.sql`（或等价 apply）。
2. 确认 RLS：authenticated 只能 `SELECT` 自己的 `user_billing`；不能自行改 `is_paid`。
3. 部署 `create-checkout` 与 `stripe-webhook`，并设置上表 Secrets。
4. 配置 Stripe Webhook 指向 webhook 函数 URL。
5. 用测试账号点「去支付」→ 完成 Checkout → 回扩展点「我已付款」刷新，确认 `is_paid=true`。

## 纠纷 / Webhook 延迟

扩展内同时展示联系邮箱：`llluchy@outlook.com`、`llluchy@qq.com`。不做应用内「恢复购买」或人工标记付费 UI。
