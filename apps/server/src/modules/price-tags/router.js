import express from 'express'
import { CARDS, CONFIG, SELECTION, SERVICES, getDatabase } from './database.js'
import { tableName } from '../../db/unified-database.js'

const PRICE_LABEL_PRODUCTS = tableName('price-labels', 'products')

const DEFAULT_SUBSIDY = {
  computer: { rate: 15, cap: 1500 },
  mobile: { rate: 15, cap: 500 }
}

function subsidyRuleOf(category, config) {
  if (category === '笔记本' || category === '台式机') return config.computer
  if (category === '手机' || category === '平板') return config.mobile
  return null
}

function calcSubsidyPrice(price, category, config) {
  const rule = subsidyRuleOf(category, config)
  if (!rule) return null
  if (!Number.isFinite(price) || price <= 0) return null
  const subsidy = Math.min(price * (rule.rate / 100), rule.cap)
  return Math.round((price - subsidy) * 10000) / 10000
}

function readSubsidyConfig(db) {
  const row = db.prepare(`SELECT value FROM ${CONFIG} WHERE key = 'subsidy'`).get()
  if (!row) return { ...DEFAULT_SUBSIDY }
  try {
    const parsed = JSON.parse(row.value)
    return {
      computer: { ...DEFAULT_SUBSIDY.computer, ...(parsed.computer || {}) },
      mobile: { ...DEFAULT_SUBSIDY.mobile, ...(parsed.mobile || {}) }
    }
  } catch {
    return { ...DEFAULT_SUBSIDY }
  }
}

function rowToCard(row) {
  try {
    const payload = JSON.parse(row.payload)
    return { ...payload, id: row.id, category: row.category, productTitle: row.product_title }
  } catch {
    return null
  }
}

export function createPriceTagsRouter() {
  const router = express.Router()

  router.get('/cards', (_req, res) => {
    const db = getDatabase()
    const rows = db.prepare(`SELECT * FROM ${CARDS} ORDER BY sort_order ASC, created_at ASC`).all()
    const cards = rows.map(rowToCard).filter(Boolean)
    const selected = db.prepare(`SELECT card_id FROM ${SELECTION}`).all().map((row) => row.card_id)
    res.json({ code: 0, data: { cards, selected }, msg: 'success' })
  })

  router.post('/cards', (req, res) => {
    const db = getDatabase()
    const card = req.body || {}
    if (!card.id) return res.status(400).json({ code: 1, data: null, msg: '缺少展牌 ID' })
    const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS max FROM ${CARDS}`).get()
    db.prepare(`
      INSERT INTO ${CARDS} (id, product_title, category, payload, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      card.id,
      String(card.productTitle || ''),
      String(card.category || '笔记本'),
      JSON.stringify(card),
      Number(maxOrder.max) + 1
    )
    res.json({ code: 0, data: { card }, msg: '已创建' })
  })

  router.put('/cards/selection', (req, res) => {
    const db = getDatabase()
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
    db.prepare(`DELETE FROM ${SELECTION}`).run()
    const insert = db.prepare(`INSERT OR IGNORE INTO ${SELECTION} (card_id) VALUES (?)`)
    for (const id of ids) insert.run(String(id))
    res.json({ code: 0, data: { count: ids.length }, msg: '已保存' })
  })

  router.post('/cards/recalc', (_req, res) => {
    const db = getDatabase()
    const config = readSubsidyConfig(db)
    const rows = db.prepare(`SELECT * FROM ${CARDS}`).all()
    let changed = 0
    const update = db.prepare(`UPDATE ${CARDS} SET payload = ?, updated_at = datetime('now') WHERE id = ?`)

    for (const row of rows) {
      const card = rowToCard(row)
      if (!card) continue
      let touched = false
      for (const product of card.products || []) {
        for (const color of product.colors || []) {
          const next = calcSubsidyPrice(color.price, card.category, config)
          if (next === null) continue
          if (color.subsidyPrice !== next) {
            color.subsidyPrice = next
            touched = true
          }
        }
      }
      if (touched) {
        update.run(JSON.stringify(card), card.id)
        changed += 1
      }
    }
    res.json({ code: 0, data: { changed }, msg: `已更新 ${changed} 张展牌` })
  })

  router.put('/cards/:id', (req, res) => {
    const db = getDatabase()
    const card = req.body || {}
    const result = db.prepare(`
      UPDATE ${CARDS}
      SET product_title = ?, category = ?, payload = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      String(card.productTitle || ''),
      String(card.category || '笔记本'),
      JSON.stringify(card),
      req.params.id
    )
    if (!result.changes) return res.status(404).json({ code: 1, data: null, msg: '展牌不存在' })
    res.json({ code: 0, data: { card }, msg: '已保存' })
  })

  router.delete('/cards/:id', (req, res) => {
    const db = getDatabase()
    db.prepare(`DELETE FROM ${CARDS} WHERE id = ?`).run(req.params.id)
    db.prepare(`DELETE FROM ${SELECTION} WHERE card_id = ?`).run(req.params.id)
    res.json({ code: 0, data: null, msg: '已删除' })
  })

  // 配件复用外设价签数据
  router.get('/accessories', (_req, res) => {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT name, category, price FROM ${PRICE_LABEL_PRODUCTS}
      ORDER BY category ASC, name ASC
    `).all()
    res.json({ code: 0, data: rows, msg: 'success' })
  })

  router.get('/services', (_req, res) => {
    const db = getDatabase()
    const rows = db.prepare(`SELECT * FROM ${SERVICES} ORDER BY category ASC, name ASC`).all()
    res.json({ code: 0, data: rows, msg: 'success' })
  })

  router.get('/subsidy-config', (_req, res) => {
    res.json({ code: 0, data: readSubsidyConfig(getDatabase()), msg: 'success' })
  })

  router.put('/subsidy-config', (req, res) => {
    const db = getDatabase()
    const value = JSON.stringify(req.body || DEFAULT_SUBSIDY)
    db.prepare(`
      INSERT INTO ${CONFIG} (key, value, updated_at) VALUES ('subsidy', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(value)
    res.json({ code: 0, data: readSubsidyConfig(db), msg: '已保存' })
  })

  return router
}

export default createPriceTagsRouter()
