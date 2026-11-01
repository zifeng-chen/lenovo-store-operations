import { createApp, h } from 'vue';
import { ElConfigProvider } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import '@lenovo-store/shared/theme.css';
import './styles.css';
import App from './App.vue';
import router from './router.js';

const Root = {
  render: () => h(ElConfigProvider, { locale: zhCn }, () => h(App))
};

createApp(Root).use(router).mount('#app');
