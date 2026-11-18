import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/modules/price-tags/',
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api/price-tags': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true,
      },
    },
  },
})
