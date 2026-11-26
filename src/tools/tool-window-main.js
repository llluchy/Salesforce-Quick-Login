import { createApp } from 'vue'
import ToolWindowShell from './_shared/ToolWindowShell.vue'
import SoqlApp from './soql/SoqlApp.vue'
import ObjectDetailApp from './soql/ObjectDetailApp.vue'
import ApexLogApp from './apex-log/ApexLogApp.vue'
import { getToolWindowDef } from './_shared/toolWindows.js'
import { applyToolThemeVars } from './_shared/toolThemes.js'
import { i18n, resolveLocale } from '../i18n'
import { loadPaymentGateSnapshot } from '../utils/paymentGateApi.js'
import { planPaymentToolGate } from '../utils/paymentAccess.js'
import '../assets/styles.css'
import './_shared/toolThemes.css'

const params = new URLSearchParams(location.search)
const toolId = params.get('tool') || 'apex-log'
const def = getToolWindowDef(toolId)

async function bootstrap() {
  await resolveLocale()
  const t = i18n.global.t

  // 窗口底色 / CSS 变量与工具主题对齐，便于全局直接 var(--accent)
  const theme = applyToolThemeVars(toolId)
  document.body.style.backgroundColor = theme.page
  document.documentElement.dataset.toolTheme = theme.id

  // 工具窗自身再校验收费门；读失败 / 未授权一律整页不可用（fail-closed）
  const showBlocked = (statusText) => {
    document.title = t('payment.toolBlockedTitle')
    createApp(ToolWindowShell, {
      toolId,
      title: t('payment.toolBlockedTitle'),
      subtitle: '',
      statusText
    })
      .use(i18n)
      .mount('#app')
  }
  try {
    const snapshot = await loadPaymentGateSnapshot({ force: true, skipSideEffects: true })
    const gate = planPaymentToolGate(snapshot.access)
    if (gate !== 'proceed') {
      showBlocked(
        gate === 'need-login' ? t('payment.toolNeedLogin')
          : gate === 'need-payment' ? t('payment.toolNeedPayment')
            : t('toolsHub.blocked')
      )
      return
    }
  } catch {
    showBlocked(t('toolsHub.blocked'))
    return
  }

  if (toolId === 'soql') {
    document.title = t('tools.titleSoqlCreator')
    createApp(SoqlApp).use(i18n).mount('#app')
  } else if (toolId === 'object-detail') {
    document.title = t('tools.titleObjectDetail')
    createApp(ObjectDetailApp).use(i18n).mount('#app')
  } else if (toolId === 'apex-log') {
    document.title = t('tools.titleApexLogViewer')
    createApp(ApexLogApp).use(i18n).mount('#app')
  } else {
    document.title = t('tools.unknownTool')
    createApp(ToolWindowShell, {
      toolId,
      title: t('tools.unknownTool'),
      subtitle: toolId,
      statusText: t('tools.unrecognizedToolId')
    })
      .use(i18n)
      .mount('#app')
  }

  console.info('[ToolWindow]', toolId, def?.page)
}

bootstrap()
