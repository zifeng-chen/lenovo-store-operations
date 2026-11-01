import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const filename = '/tmp/lso/apps/sales-report/src/App.vue'
const source = fs.readFileSync(filename, 'utf-8')
const { descriptor } = parse(source, { filename })
const script = compileScript(descriptor, { id: 'test' })

// 提取 script setup 的内容并求值（模拟运行）
let code = script.content
// 替换 import 为从已加载模块取
code = code
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?/g, 'const {$1} = Vue;')
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]echarts\/core['"];?/g, 'const {$1} = { init: () => ({ setOption(){}, resize(){}, dispose(){} }), use: () => {} };')
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]echarts\/charts['"];?/g, 'const {$1} = { LineChart: {}, BarChart: {} };')
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]echarts\/components['"];?/g, 'const {$1} = {};')
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]echarts\/renderers['"];?/g, 'const {$1} = {};')
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]\.\/api\.js['"];?/g, `const {$1} = { getOverview: async()=>({range:{startDate:'a',endDate:'b'},summary:{total:0,count:0,activeDays:0,averagePerSale:0,averagePerDay:0,median:0,changePercent:null,bestDay:null},daily:[]}), getComparison: async()=>({months:[],quarters:[],years:[]}), getTrend: async()=>({points:[]}), getItems: async()=>({items:[]}), getRecords: async()=>({records:[],total:0}) };`)

const fn = new Function('Vue', `${code}\nreturn new Proxy({}, { get: (t, k) => eval(k) })`)
try {
  const scope = fn(Vue)
  console.log('script setup 执行: OK')
  console.log('  暴露的绑定数:', Object.keys(scope).length)
} catch (e) {
  console.log('=== script setup 运行错误 ===')
  console.log(' ', e.message)
  console.log(e.stack?.split('\n').slice(0, 6).join('\n'))
}
