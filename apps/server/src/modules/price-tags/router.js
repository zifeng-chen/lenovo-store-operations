import express from 'express'
import { CARDS, CONFIG, COPIES, SELECTION, SERVICES, getDatabase } from './database.js'
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

  router.post('/services', (req, res) => {
    const db = getDatabase()
    const body = req.body || {}
    const name = String(body.name ?? '').trim()
    if (!name) {
      res.status(400).json({ code: 400, data: null, msg: '服务名称不能为空' })
      return
    }
    const info = db.prepare(`
      INSERT INTO ${SERVICES} (name, price, category, product_category) VALUES (?, ?, ?, ?)
    `).run(
      name,
      Number(body.price) || 0,
      String(body.category ?? '').trim() || '增值服务',
      String(body.productCategory ?? '').trim()
    )
    const row = db.prepare(`SELECT * FROM ${SERVICES} WHERE id = ?`).get(info.lastInsertRowid)
    res.json({ code: 0, data: row, msg: '已新增' })
  })

  router.put('/services/:id', (req, res) => {
    const db = getDatabase()
    const body = req.body || {}
    const current = db.prepare(`SELECT * FROM ${SERVICES} WHERE id = ?`).get(req.params.id)
    if (!current) {
      res.status(404).json({ code: 404, data: null, msg: '服务不存在' })
      return
    }
    const name = body.name === undefined ? current.name : String(body.name).trim()
    if (!name) {
      res.status(400).json({ code: 400, data: null, msg: '服务名称不能为空' })
      return
    }
    db.prepare(`
      UPDATE ${SERVICES} SET name = ?, price = ?, category = ?, product_category = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name,
      body.price === undefined ? current.price : Number(body.price) || 0,
      body.category === undefined ? current.category : (String(body.category).trim() || '增值服务'),
      body.productCategory === undefined ? current.product_category : String(body.productCategory).trim(),
      req.params.id
    )
    const row = db.prepare(`SELECT * FROM ${SERVICES} WHERE id = ?`).get(req.params.id)
    res.json({ code: 0, data: row, msg: '已保存' })
  })

  router.delete('/services/:id', (req, res) => {
    const db = getDatabase()
    const info = db.prepare(`DELETE FROM ${SERVICES} WHERE id = ?`).run(req.params.id)
    if (!info.changes) {
      res.status(404).json({ code: 404, data: null, msg: '服务不存在' })
      return
    }
    res.json({ code: 0, data: { id: Number(req.params.id) }, msg: '已删除' })
  })

  /* 自建卖点文案：按「分类 + 图标名」归属，选中图标后与内置文案一起出现在下拉框 */
  router.get('/feature-copies', (req, res) => {
    const db = getDatabase()
    const category = String(req.query.category ?? '').trim()
    const rows = category
      ? db.prepare(`SELECT * FROM ${COPIES} WHERE category = ? ORDER BY icon_name ASC, id ASC`).all(category)
      : db.prepare(`SELECT * FROM ${COPIES} ORDER BY category ASC, icon_name ASC, id ASC`).all()
    res.json({ code: 0, data: rows, msg: 'success' })
  })

  router.post('/feature-copies', (req, res) => {
    const db = getDatabase()
    const body = req.body || {}
    const category = String(body.category ?? '').trim()
    const iconName = String(body.iconName ?? '').trim()
    const title = String(body.title ?? '').trim()
    const desc = String(body.desc ?? '').trim()
    if (!category) {
      res.status(400).json({ code: 400, data: null, msg: '缺少所属分类' })
      return
    }
    if (!iconName) {
      res.status(400).json({ code: 400, data: null, msg: '请先选择归属图标' })
      return
    }
    if (!title) {
      res.status(400).json({ code: 400, data: null, msg: '标题不能为空' })
      return
    }
    const dup = db.prepare(`SELECT id FROM ${COPIES} WHERE category = ? AND icon_name = ? AND title = ? AND desc = ?`)
      .get(category, iconName, title, desc)
    if (dup) {
      res.status(409).json({ code: 409, data: null, msg: '该图标下已有相同文案' })
      return
    }
    const info = db.prepare(`
      INSERT INTO ${COPIES} (category, icon_name, title, desc) VALUES (?, ?, ?, ?)
    `).run(category, iconName, title, desc)
    const row = db.prepare(`SELECT * FROM ${COPIES} WHERE id = ?`).get(info.lastInsertRowid)
    res.json({ code: 0, data: row, msg: '已新增' })
  })

  router.put('/feature-copies/:id', (req, res) => {
    const db = getDatabase()
    const body = req.body || {}
    const current = db.prepare(`SELECT * FROM ${COPIES} WHERE id = ?`).get(req.params.id)
    if (!current) {
      res.status(404).json({ code: 404, data: null, msg: '文案不存在' })
      return
    }
    const title = body.title === undefined ? current.title : String(body.title).trim()
    if (!title) {
      res.status(400).json({ code: 400, data: null, msg: '标题不能为空' })
      return
    }
    db.prepare(`
      UPDATE ${COPIES} SET category = ?, icon_name = ?, title = ?, desc = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      body.category === undefined ? current.category : String(body.category).trim(),
      body.iconName === undefined ? current.icon_name : String(body.iconName).trim(),
      title,
      body.desc === undefined ? current.desc : String(body.desc).trim(),
      req.params.id
    )
    const row = db.prepare(`SELECT * FROM ${COPIES} WHERE id = ?`).get(req.params.id)
    res.json({ code: 0, data: row, msg: '已保存' })
  })

  router.delete('/feature-copies/:id', (req, res) => {
    const db = getDatabase()
    const info = db.prepare(`DELETE FROM ${COPIES} WHERE id = ?`).run(req.params.id)
    if (!info.changes) {
      res.status(404).json({ code: 404, data: null, msg: '文案不存在' })
      return
    }
    res.json({ code: 0, data: { id: Number(req.params.id) }, msg: '已删除' })
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
