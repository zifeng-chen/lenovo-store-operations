import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '@lenovo-store/shared/theme.css'
import App from './App.vue'
import './style.css'

createApp(App).use(ElementPlus).mount('#app')
