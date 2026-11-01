import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { elementPlusOptimization, vendorChunks } from '../../packages/shared/vite-element-plus.js'

export default defineConfig({
  base: '/modules/receipt-assistant/',
  plugins: [vue(), ...elementPlusOptimization()],
  build: {
    rollupOptions: vendorChunks(),
  },
  server: {
    host: '0.0.0.0',
    port: 5176,
    strictPort: true,
    proxy: {
      '/api/receipt-assistant': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true,
      },
    },
  },
})
