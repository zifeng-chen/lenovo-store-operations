import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import fs from 'node:fs'

for (const m of ['receipt-assistant', 'computer-labels', 'sales-report', 'web']) {
  const candidates = [
    `/tmp/lso/apps/${m}/src/App.vue`,
    `/tmp/lso/apps/${m}/src/views/SystemView.vue`,
  ]
  for (const filename of candidates) {
    if (!fs.existsSync(filename)) continue
    const source = fs.readFileSync(filename, 'utf-8')
    const { descriptor } = parse(source, { filename })
    if (!descriptor.template) continue
    const script = compileScript(descriptor, { id: 'test' })
    const tpl = compileTemplate({
      source: descriptor.template.content,
      filename, id: 'test',
      compilerOptions: { bindingMetadata: script.bindings, mode: 'module' },
    })
    const resolved = [...new Set([...tpl.code.matchAll(/_resolveComponent\("([^"]+)"\)/g)].map(x => x[1]))]
    console.log(`${m}/${filename.split('/').pop()}: ${resolved.length} 个需运行时解析`)
    if (resolved.length) console.log('   ', resolved.slice(0, 6).join(', '))
  }
}
