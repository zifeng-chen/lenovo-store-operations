// 用 SSR 真实渲染 App.vue，捕获组件解析错误
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire('/tmp/lso/')
const path = require('node:path')

const filename = '/tmp/lso/apps/sales-report/src/App.vue'
const source = fs.readFileSync(filename, 'utf-8')
const { descriptor } = parse(source, { filename })
const script = compileScript(descriptor, { id: 'test' })
const bindings = script.bindings

const tpl = compileTemplate({
  source: descriptor.template.content,
  filename,
  id: 'test',
  compilerOptions: {
    bindingMetadata: bindings,
    mode: 'module',
  },
})

if (tpl.errors.length) {
  console.log('模板编译错误:')
  tpl.errors.forEach(e => console.log(' ', e.message || e))
  process.exit(1)
}

// 检查编译后代码里是否有 resolveComponent 调用（说明有未自动导入的组件）
const code = tpl.code
const resolved = [...code.matchAll(/_resolveComponent\("([^"]+)"\)/g)].map(m => m[1])
const resolvedDirective = [...code.matchAll(/_resolveDirective\("([^"]+)"\)/g)].map(m => m[1])

console.log('=== 需要运行时解析的组件（自动导入失败的会出现在这里）===')
if (resolved.length === 0) console.log('  无')
else [...new Set(resolved)].forEach(c => console.log('  ⚠', c))

console.log('\n=== 指令 ===')
if (resolvedDirective.length === 0) console.log('  无')
else [...new Set(resolvedDirective)].forEach(d => console.log('  ⚠', d))
