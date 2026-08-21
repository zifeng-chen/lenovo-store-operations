import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: '/modules/employee-badges/',
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5177,
    strictPort: true
  }
});
