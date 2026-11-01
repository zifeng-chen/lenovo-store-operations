import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

// 直接读取 App.vue 的编译结果不可行，改为检查编译错误
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import fs from 'node:fs'

const source = fs.readFileSync('/tmp/lso/apps/sales-report/src/App.vue', 'utf-8')
const { descriptor, errors } = parse(source, { filename: 'App.vue' })

if (errors.length) {
  console.log('=== SFC 解析错误 ===')
  errors.forEach(e => console.log(' ', e.message))
} else {
  console.log('SFC 解析: OK')
}

// 编译 script
try {
  const script = compileScript(descriptor, { id: 'test' })
  console.log('script 编译: OK, bindings:', Object.keys(script.bindings || {}).length, '个')
} catch (e) {
  console.log('script 编译失败:', e.message)
}

// 编译 template
try {
  const tpl = compileTemplate({
    source: descriptor.template.content,
    filename: 'App.vue',
    id: 'test',
    compilerOptions: { bindingMetadata: compileScript(descriptor, { id: 'test' }).bindings }
  })
  if (tpl.errors?.length) {
    console.log('=== template 编译错误 ===')
    tpl.errors.forEach(e => console.log(' ', e.message || e))
  } else {
    console.log('template 编译: OK')
  }
} catch (e) {
  console.log('template 编译失败:', e.message)
}
