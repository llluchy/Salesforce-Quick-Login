import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import { resolve } from 'path'

export default defineConfig({
  base: '',
  // Chrome MV3 CSP 禁止 unsafe-eval；开启 JIT 避免 vue-i18n 使用 new Function
  define: {
    __INTLIFY_JIT_COMPILATION__: true
  },
  plugins: [
    vue(),
    crx({ manifest })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'index.html'),
        'tool-window': resolve(__dirname, 'tool-window.html')
      }
    }
  },
  server: {
    port: 5175,
    strictPort: true,
    origin: 'http://localhost:5175',
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5175,
      clientPort: 5175
    }
  }
})
