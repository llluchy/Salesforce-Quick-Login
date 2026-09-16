import { createApp } from 'vue'
import ToolWindowShell from './_shared/ToolWindowShell.vue'
import SoqlApp from './soql/SoqlApp.vue'
import ObjectDetailApp from './soql/ObjectDetailApp.vue'
import ApexLogApp from './apex-log/ApexLogApp.vue'
import { getToolWindowDef } from './_shared/toolWindows.js'
import { i18n, resolveLocale } from '../i18n'
import '../assets/styles.css'

const params = new URLSearchParams(location.search)
const toolId = params.get('tool') || 'apex-log'
const def = getToolWindowDef(toolId)

async function bootstrap() {
  await resolveLocale()
  const t = i18n.global.t

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
