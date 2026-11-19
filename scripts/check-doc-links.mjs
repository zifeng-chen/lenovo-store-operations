import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('.')
const files = [
  'README.md',
  ...fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
]

let bad = 0
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  const links = [...text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)]
  for (const [, label, target] of links) {
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const [rawPath, anchor] = target.split('#')
    if (!rawPath) continue
    const resolved = path.resolve(path.dirname(path.join(root, file)), rawPath)
    if (!fs.existsSync(resolved)) {
      console.log(`BROKEN FILE ${file} -> ${target} (${label})`)
      bad += 1
      continue
    }
    if (!anchor) continue
    const targetText = fs.readFileSync(resolved, 'utf8')
    const slugs = [...targetText.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, title]) =>
      title.trim().toLowerCase()
        .replace(/[`*_[\]()]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s/g, '-')
    )
    if (!slugs.includes(anchor)) {
      console.log(`BROKEN ANCHOR ${file} -> ${target} (${label})`)
      bad += 1
    }
  }
}
console.log(bad === 0 ? '所有链接与锚点有效' : `问题数：${bad}`)
