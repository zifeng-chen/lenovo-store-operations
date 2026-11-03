/**
 * 历史销售明细名称回填：把库里已存在的 OCR 脏名称按归一化规则重写。
 * 用法：node scripts/backfill-product-names.js <sqlite路径> [--apply]
 * 不加 --apply 时只做 dry-run，不写入。
 */
import Database from 'better-sqlite3'
import { normalizeProductName } from '../packages/shared/src/product-name.js'

const dbPath = process.argv[2]
const apply = process.argv.includes('--apply')

if (!dbPath) {
  console.error('用法：node scripts/backfill-product-names.js <sqlite路径> [--apply]')
  process.exit(2)
}

const db = new Database(dbPath, { readonly: !apply })
db.pragma('busy_timeout = 5000')

const rows = db.prepare('SELECT id, name FROM receipt_sale_items ORDER BY id').all()
const changes = []
for (const row of rows) {
  const next = normalizeProductName(row.name)
  if (next !== row.name) changes.push({ id: row.id, from: row.name, to: next })
}

console.log(`总明细行数：${rows.length}`)
console.log(`需要归一：${changes.length}`)
for (const change of changes.slice(0, 50)) {
  console.log(`  #${change.id}  ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`)
}
if (changes.length > 50) console.log(`  ...另有 ${changes.length - 50} 条`)

if (!apply) {
  console.log('\n[dry-run] 未写入。加 --apply 执行。')
  db.close()
  process.exit(0)
}

const update = db.prepare('UPDATE receipt_sale_items SET name = ? WHERE id = ?')
const run = db.transaction((list) => {
  for (const change of list) update.run(change.to, change.id)
})
run(changes)
console.log(`\n已更新 ${changes.length} 行。`)
db.close()
