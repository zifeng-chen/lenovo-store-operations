import { createApp, h } from 'vue'
import ElementPlus, { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import '@lenovo-store/shared/theme.css'
import './style.css'
import App from './App.vue'

// 把错误显示到 body 顶部的独立容器，绝不触碰 #app
function reportError(label, detail) {
  try {
    let box = document.getElementById('__err__')
    if (!box) {
      box = document.createElement('div')
      box.id = '__err__'
      box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;padding:12px 16px;font:12px/1.6 system-ui;color:#b42318;background:#fff5f4;border-bottom:2px solid #f3c0bb;max-height:40vh;overflow:auto;white-space:pre-wrap;'
      document.body.appendChild(box)
    }
    box.textContent += `[${label}] ${detail}\n`
  } catch { /* 忽略 */ }
}

window.addEventListener('error', (e) => {
  reportError('error', (e.message || '') + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno)
})
window.addEventListener('unhandledrejection', (e) => {
  reportError('promise', String(e.reason && e.reason.message || e.reason))
})

const Root = {
  render: () => h(ElConfigProvider, { locale: zhCn }, () => h(App))
}

const app = createApp(Root)
app.use(ElementPlus, { locale: zhCn })
app.config.errorHandler = (error, instance, info) => {
  reportError('vue:' + (info || ''), (error && error.stack) || String(error))
}
app.config.warnHandler = (msg) => {
  if (/Failed to resolve|not found|Invalid/.test(msg)) reportError('warn', msg)
}

app.mount('#app')
