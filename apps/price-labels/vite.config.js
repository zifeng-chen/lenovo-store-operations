import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/modules/price-labels/',
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: true,
    proxy: {
      '/api/price-labels': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true,
      },
    },
  },
})
