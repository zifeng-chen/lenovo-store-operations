// 用 SSR 真实渲染 App.vue 的模板，捕获渲染期异常
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createSSRApp, h, defineComponent } from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'

const filename = '/tmp/lso/apps/sales-report/src/App.vue'
const source = fs.readFileSync(filename, 'utf-8')
const { descriptor } = parse(source, { filename })
const script = compileScript(descriptor, { id: 'test' })

// 取 script setup 里的 setup 逻辑（去掉 import）
let setupCode = script.content
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
  .replace(/^use\(\[[\s\S]*?\]\)$/gm, '')

// 提供被移除 import 的桩
const stubs = {
  init: () => ({ setOption() {}, resize() {}, dispose() {}, on() {} }),
  use: () => {},
  LineChart: {}, BarChart: {}, AriaComponent: {}, GridComponent: {}, TooltipComponent: {}, CanvasRenderer: {},
  getOverview: async () => ({ range: { startDate: '2026-01-01', endDate: '2026-01-31' }, summary: { total: 100, count: 2, activeDays: 1, averagePerSale: 50, averagePerDay: 100, median: 50, changePercent: null, bestDay: null }, daily: [{ date: '2026-01-01', total: 100, count: 2 }] }),
  getComparison: async () => ({ months: [], quarters: [], years: [] }),
  getTrend: async () => ({ points: [] }),
  getItems: async () => ({ items: [] }),
  getRecords: async () => ({ records: [], total: 0 }),
}

const factory = new Function(
  'Vue', ...Object.keys(stubs),
  `${setupCode}\n;return { __ok: true };`
)

try {
  factory(Vue, ...Object.values(stubs))
  console.log('setup 执行: OK')
} catch (e) {
  console.log('=== setup 执行异常 ===')
  console.log(e.message)
  console.log(e.stack?.split('\n').slice(0, 8).join('\n'))
}
