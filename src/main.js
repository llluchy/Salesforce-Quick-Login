import { createApp } from 'vue'
import App from './App.vue'
import './assets/styles.css'
import { i18n, resolveLocale } from './i18n'

async function bootstrap() {
  await resolveLocale()
  const app = createApp(App)
  app.use(i18n)
  app.mount('#app')
}

bootstrap()
