import fs from 'node:fs'

const ids = [
  'computer-labels',
  'price-labels',
  'price-tags',
  'receipt-assistant',
  'sales-report',
  'sample-devices',
]

const actual = new Map()
for (const id of ids) {
  const text = fs.readFileSync(`apps/server/src/modules/${id}/router.js`, 'utf8')
  const routes = new Set()
  for (const [, method, route] of text.matchAll(/router\.(get|post|put|delete)\(\s*'([^']+)'/g)) {
    routes.add(`${method.toUpperCase()} ${route}`)
  }
  actual.set(id, routes)
}

const doc = fs.readFileSync('docs/modules.md', 'utf8')
let bad = 0
for (const section of doc.split(/^## /m).slice(1)) {
  const id = /`([a-z-]+)`/.exec(section.split('\n')[0])?.[1]
  const routes = actual.get(id)
  if (!routes) continue
  for (const [, body] of section.matchAll(/`([^`]+)`/g)) {
    const raw = body.trim()
    if (!raw.startsWith('/') && !/^(GET|POST|PUT|DELETE)/.test(raw)) continue
    const parts = raw.split(/\s+/)
    const route = parts.length > 1 ? parts[1] : parts[0]
    if (!route.startsWith('/api/')) continue
    const methods = parts.length > 1 ? parts[0].split('/') : []
    const candidates = [...routes].filter((entry) => entry.endsWith(` ${route}`))
    if (candidates.length === 0) {
      console.log(`MISSING ${id} ${raw}`)
      bad += 1
    } else if (methods.length && !methods.every((m) => candidates.some((e) => e.startsWith(`${m} `)))) {
      console.log(`METHOD MISMATCH ${id} ${raw} -> ${candidates.join(' | ')}`)
      bad += 1
    }
  }
}
console.log(bad === 0 ? '文档接口与 router.js 一致' : `问题数：${bad}`)
