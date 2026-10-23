# 术语表（Tool Platform / Quick Login）

> 围绕 **Salesforce Quick Login（宿主扩展）** 的统一叫法。  
> 讨论合并方案、写需求、做 Code Review 时优先使用本文档中的术语，避免「登录 / 会话 / 环境」混用。

最后更新：2026-09-09

---

## 一、产品层级

| 统一称呼 | 英文 / 代码 | 含义 |
|---------|-------------|------|
| **宿主扩展** | Host Extension | 整个 Chrome 扩展产品，对外名称 *Salesforce Quick Login* |
| **工具聚合平台** | Tool Platform | 宿主 + 多个子工具（登录、日志、SOQL 等）的长期形态 |
| **工具模块** | Tool Module | 平台内一块独立能力，如登录工具、Apex 日志工具、SOQL 工具 |
| **快照** | vendor-snapshot | `vendor-snapshots/` 里只读拷贝，**不是**运行时代码 |
| **Side Panel** | `side_panel` | Chrome 侧边栏，宿主 UI 的容器（`index.html`） |

---

## 二、扩展运行时（Chrome 层）

| 统一称呼 | 文件 / 位置 | 职责 |
|---------|-------------|------|
| **Service Worker** | `background.js` | 后台：SOAP 登录、截图扫码、Passkey 消息中转等 |
| **Content Script（隔离世界）** | `content.js` | 注入 SF 页面，与扩展通信（区域选框等） |
| **Page-World 脚本** | `page-world.js` | 注入 SF 页面主世界，拦截 WebAuthn |
| **Manifest** | `manifest.json` | 扩展元数据、权限、content_scripts、side_panel |
| **构建产物** | `dist/` | `npm run build` 输出，用于打包 / 上架 |

---

## 三、前端应用（Vue 层）

| 统一称呼 | 文件 | 含义 |
|---------|------|------|
| **根应用** | `App.vue` | 认证后主界面编排、数据加载、Passkey 弹窗、启动遮罩 |
| **入口** | `main.js` | Vue 挂载 |
| **Composable** | `src/composables/*.js` | 可复用逻辑单元（见下表） |
| **组件** | `src/components/*.vue` | UI 组件（见第六节） |
| **工具函数** | `src/utils/*.js` | 加密、WebAuthn、常量等纯函数 |

### Composable

| 称呼 | 文件 | 管什么 |
|------|------|--------|
| **账户认证** | `useAuth.js` | 注册 / 登录 / 解锁 / 登出、派生 **加密主密钥** |
| **数据存储** | `useStorage.js` | 环境 / 分组读写，Supabase + 本地缓存 |
| **环境登录** | `useLogin.js` | 对某个 **SF 环境** 执行 SOAP / frontdoor 登录 |
| **TOTP** | `useTotp.js` | 验证码生成、二维码识别 |
| **Passkey 桥接** | `usePasskeyBridge.js` | Side Panel 与 page-world 之间的 Passkey 请求 |
| **分享** | `useShare.js` | 环境分享码创建 / 接受 |
| **Supabase 客户端** | `useSupabase.js` | 云端 SDK 单例 |

---

## 四、两套「身份」——务必分开说

| 称呼 | 别混叫成 | 含义 |
|------|----------|------|
| **扩展账户** | 环境、Org | 用户在插件里注册的邮箱账号（Supabase Auth） |
| **SF 环境** | 账户、Org 实例 | 一条 Salesforce 登录配置（别名、账号、密码、类型…） |
| **Org / 组织** | 环境别名 | 某个 Salesforce 实例（Production / Sandbox / Custom URL） |
| **当前用户** | SF 用户 | `currentUser`：扩展账户 `{ id, email }` |
| **加密主密钥** | 密码、session | `cryptoKey`：由扩展账户密码派生，用于解密云端数据 |
| **扩展会话** | SF 会话 | Supabase session，存在 `chrome.storage.local` |
| **SF 会话** | 扩展登录 | Salesforce 的 `sessionId` / Cookie `sid`，用于调 SF API 或打开 frontdoor |

**口语对照：**

- 「登录扩展」→ 扩展账户登录 / 解锁  
- 「登录环境」→ 对某个 SF 环境一键进 Org  

---

## 五、数据实体

| 称呼 | 代码 / 存储 | 字段要点 |
|------|-------------|----------|
| **环境** | `environment` / `env` | `alias`, `username`, `password`, `type`, `groupId`, `totpSecret`, `passkeys` |
| **分组** | `group` | `name`, `sortOrder`, `collapsed`；虚拟分组 **未选择分组**（`ungrouped`） |
| **Passkey 凭证** | `passkey` | 绑在某个环境上的 WebAuthn 凭据 |
| **分享记录** | `env_share` | 分享码、验证码、加密后的环境副本 |
| **本地缓存** | `chrome.storage.local` | `salesforce_environments`, `salesforce_groups` 等 |
| **云端真相源** | Supabase | `environments`, `groups`, `user_secrets`, `env_shares` |

---

## 六、UI 界面（现有）

| 称呼 | 组件 | 何时出现 |
|------|------|----------|
| **认证屏** | `AuthScreen.vue` | 未解锁扩展账户时（登录 / 注册 / 解锁） |
| **主界面** | `App.vue` 内 `app-container` | 已认证后的环境列表页 |
| **顶栏** | `Toolbar.vue` | 添加环境、创建分组、分享、账户 |
| **分组区块** | `GroupSection.vue` | 一组环境 + 分组头 |
| **分组头** | `GroupHeader.vue` | 折叠、编辑、删除分组 |
| **环境卡片** | `EnvCard.vue` | 单条环境：登录、编辑、TOTP 等 |
| **环境编辑弹窗** | `EditModal.vue` | 添加 / 编辑环境 |
| **分组弹窗** | `GroupModal.vue` | 创建 / 编辑分组（顶栏入口） |
| **快速建分组弹窗** | `EditModal` 内嵌 | 编辑环境里点「+ 分组」 |
| **删除确认弹窗** | `DeleteModal.vue` | 删环境 / 删分组 |
| **账户弹窗** | `AccountDialog.vue` | 改密、重加密、退出登录 |
| **退出确认弹窗** | `AccountDialog` 内嵌 | 退出前的二次确认 |
| **分享弹窗** | `ShareDialog.vue` | 生成 / 接受分享 |
| **Passkey 选择弹窗** | `App.vue` 内 `pkDialog` | SF 页请求 Passkey 时在 Side Panel 选环境 |
| **Passkey 保存遮罩** | `passkeySaving` | 绑定 / 验证 Passkey 时的转圈 |
| **启动 / 同步遮罩** | `bootOverlay` | 恢复会话、拉取云端数据的进度 |
| **Toast** | `Toast.vue`（Side Panel）/ `tools/_shared/ToolToast.vue` + `useToolToast.js`（工具窗口） | 轻提示；**工具内禁止再用页面 status-text**，统一 `showToast()`，自动消失 |

**弹窗统称：**

- **插件风格弹窗** = 上述 Vue Modal / Overlay  
- **浏览器原生弹窗** = `alert` / `confirm` / `prompt`（应逐步淘汰）

---

## 七、关键用户流程（动词统一）

| 说法 | 含义 |
|------|------|
| **注册 / 登录扩展** | `signUp` / `signIn`，建立扩展账户 |
| **解锁** | 已有 Supabase session，输入密码派生 `cryptoKey` |
| **恢复会话** | 打开插件时 `getSession`，可能自动进主界面 |
| **同步数据** | `loadData`：从 Supabase 拉环境 / 分组并解密 |
| **登录环境** | 对某 env 调 SOAP → frontdoor 打开 SF |
| **绑定 Passkey** | SF 注册 WebAuthn 时，选环境写入凭证 |
| **验证 Passkey** | SF 登录时 WebAuthn，扩展代签 |
| **分享环境** | 生成分享码，对方导入为独立副本 |
| **退出扩展** | `signOut`，清本地密钥与缓存 |

---

## 八、待合并工具（快照侧）

| 称呼 | 快照目录 | 原形态 | 核心能力 |
|------|----------|--------|----------|
| **Apex 日志工具** | `vendor-snapshots/Salesforce-Apexlog-Viewer` | 独立扩展，**弹窗 window** | Cookie sid、TraceFlag、ApexLog 轮询 |
| **SOQL 工具** | `vendor-snapshots/Salesforce-Soql-Create` | 独立扩展，**Side Panel + Expand 全页** | 对象 / 字段选型、生成 SOQL、执行查询 |

### 合并规划中的概念（尚未实现）

| 称呼 | 含义 |
|------|------|
| **工具导航** | 主界面 Tab：登录 / 日志 / SOQL … |
| **共享 SF 会话层** | `SfSession`：`getSfHost` / `getSession`（Cookie sid） |
| **共享 REST 层** | `SfRest`：Bearer + API version，供日志 / SOQL 共用 |
| **工具上下文** | `ToolContext`：当前活动 Org、hostname、session 是否有效 |

正式合入代码目标目录（规划）：`src/tools/...`  
只读对照：`vendor-snapshots/`（见 `vendor-snapshots/README.md`）

---

## 九、会话与技术路径对照

| 路径 | 谁在用 | 怎么拿到凭证 |
|------|--------|--------------|
| **SOAP 登录路径** | Quick Login `useLogin` | 账号密码 → SOAP `sessionId` → frontdoor |
| **Cookie 会话路径** | Apex Log、SOQL | 浏览器已登录 SF → 读 Cookie `sid` → REST Bearer |
| **Passkey 路径** | page-world + PasskeyBridge | 页面 WebAuthn ↔ Side Panel 选环境 |

合并讨论常用表述：**「登录路径负责进 Org，Cookie 路径负责调 API」**。

---

## 十、命名约定

1. **环境** = SF 配置条目；**扩展账户** = 插件用户  
2. **弹窗** = Vue 自定义；**浏览器弹窗** = 原生 `alert` / `confirm` / `prompt`  
3. **宿主** = Quick Login 壳；**工具模块** = 日志 / SOQL 等子能力  
4. **快照** = `vendor-snapshots`；**正式代码** = 将来 `src/tools/...`  
5. Chrome **Side Panel 只有一个** → 多工具用 **工具导航** 切换，不做第二个 `side_panel`  

---

## 十一、方案描述示例

> 在 **宿主** 的 **Side Panel** 加 **工具导航**；**登录工具** 保持现有 **环境卡片**；**SOQL 工具** 迁入后走 **Cookie 会话路径**，与 **SOAP 登录路径** 在 **共享 SF 会话层** 对接。

---

## 相关文档

- `vendor-snapshots/README.md` — 快照来源与合并注意  
- `docs/tool-platform-shell-v1.md` — 第一版壳层（标签 + 独立窗口）实现说明  
- `vendor-snapshots/Salesforce-Apexlog-Viewer/docs/Session-Management.md` — Apex Log 的 Cookie 会话设计  
- `vendor-snapshots/Salesforce-Soql-Create/docs/OPTIMIZATION_PLAN.md` — SOQL 去重与重构计划  
