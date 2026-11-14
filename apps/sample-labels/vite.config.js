import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { elementPlusOptimization, vendorChunks } from '../../packages/shared/vite-element-plus.js';

export default defineConfig({
  base: '/modules/sample-labels/',
  plugins: [vue(), ...elementPlusOptimization()],
  build: {
    rollupOptions: vendorChunks()
  },
  server: {
    host: '0.0.0.0',
    port: 5178,
    strictPort: true,
    fs: {
      allow: [
        '/data/tianxiclaw/deploy/current/aschannel/data/projects/2026-10-29/f5e31df6-8088-4948-98bf-5dfdcaf27de1/tmp/work',
        '/opt/lenovo-store-operations/releases'
      ]
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true
      }
    }
  }
});
