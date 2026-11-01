import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vendorChunks } from '../../packages/shared/vite-element-plus.js'

export default defineConfig({
  base: '/modules/sales-report/',
  plugins: [vue()],
  build: {
    rollupOptions: vendorChunks()
  },
  server: {
    host: '0.0.0.0',
    port: 5178,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true
      }
    }
  }
})
