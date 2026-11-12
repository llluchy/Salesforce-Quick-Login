# Apex Log 工具接入说明

> 术语见 [`terminology.md`](./terminology.md)。壳层见 [`tool-platform-shell-v1.md`](./tool-platform-shell-v1.md)。

## 能力（基于快照改写）

- Cookie `sid` 扫描浏览器已登录 Salesforce 标签
- 环境选择器 → 切换后启用 TraceFlag
- ApexLog 列表轮询、筛选（应用 / 状态 / 用户）
- 日志详情、仅 DEBUG、复制 / 下载
- Process Automated 追踪、TraceFlag 续期
- 日志窗口开着并正在看某个组织时，跟踪会在到期前自动续上；关掉窗口后不再续。手动续一次仍然可以。续期闹钟和租约只写在这台浏览器的 session 里，不进账号同步
- **关窗不清会话**（与旧版 clear-all-sessions 不同）

## 文件

| 路径 | 作用 |
|------|------|
| `src/tools/apex-log/apexLogBackground.js` | Session / REST / TraceFlag / 消息 |
| `src/tools/apex-log/traceRenew.js` | 窗口开着时的到期前续期，租约只留在本机 |
| `src/tools/apex-log/ApexLogApp.vue` | 独立窗口 UI（Quick Login 风格） |
| `src/tools/apex-log/useApexLogApi.js` | 窗口侧消息封装 |
| `tool-window.html?tool=apex-log` | 入口 |

## 权限

Manifest 需 `cookies`、`alarms`（已加）。宿主已有 `<all_urls>`。

## 消息协议

统一前缀 `apexLog:`：`discover` / `getState` / `switchEnv` / `fetchLogs` / `fetchLogBody` / `renewTraceFlag` / `traceWatch` / `traceUnwatch` / `traceStatus` / `trackProcessAutomated` / `startPolling` / `stopPolling` / `pollingTick`
