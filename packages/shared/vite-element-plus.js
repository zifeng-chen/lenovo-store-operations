import Components from 'unplugin-vue-components/vite';
import AutoImport from 'unplugin-auto-import/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export function elementPlusOptimization(options = {}) {
  const { dts = false } = options;
  return [
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts,
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts,
    }),
  ];
}

export function vendorChunks() {
  return {
    output: {
      manualChunks(id) {
        if (!id.includes('node_modules')) return undefined;
        if (id.includes('element-plus') || id.includes('@element-plus')) return 'element-plus';
        if (id.includes('/vue/') || id.includes('@vue/') || id.includes('vue-router')) return 'vue';
        return 'vendor';
      },
    },
  };
}
