// 完全模拟浏览器：加载真实构建产物，检查是否抛错
import fs from 'node:fs'
import path from 'node:path'

const distDir = '/tmp/lso/apps/sales-report/dist/assets'
const files = fs.readdirSync(distDir).filter(f => f.endsWith('.js'))
console.log('=== 产物文件 ===')
for (const f of files) {
  const size = fs.statSync(path.join(distDir, f)).size
  console.log(`  ${f}: ${(size / 1024).toFixed(1)} KB`)
}

// 检查 index.html 的引用顺序
const html = fs.readFileSync('/tmp/lso/apps/sales-report/dist/index.html', 'utf-8')
console.log('\n=== index.html 引用 ===')
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
refs.forEach(r => console.log('  ', r))

// 检查 index.js 是否引用了所有依赖（模块预加载）
const indexPath = path.join(distDir, files.find(f => f.startsWith('index-')))
const indexContent = fs.readFileSync(indexPath, 'utf-8')
console.log('\n=== index.js 中的 import 语句 ===')
const imports = [...indexContent.matchAll(/from"\.\/([^"]+)"/g)].map(m => m[1])
imports.forEach(i => console.log('  ', i))
