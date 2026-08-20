import { Router, json } from 'express'
import { getDatabase } from './database.js'

const SCHEMA_VERSION = 1
const MAX_CATEGORIES = 500
const MAX_PRODUCTS = 10000
const MAX_CATEGORY_NAME_LENGTH = 30

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function isPositiveSafeInteger(value) { return Number.isSafeInteger(value) && value > 0 }
function isValidTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}
function parseId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}
function validateCategory(body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return { error: '请输入品类名称' }
  if (name.length > MAX_CATEGORY_NAME_LENGTH) return { error: `品类名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字符` }
  if (name === '全部') return { error: '“全部”是系统筛选项，不能作为品类名称' }
  return { value: name }
}
function validateProduct(db, body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const price = body.price === '' || body.price === null ? Number.NaN : Number(body.price)
  if (!name) return { error: '请输入商品名称' }
  if (name.length > 100) return { error: '商品名称不能超过 100 个字符' }
  if (!category) return { error: '请选择品类' }
  if (!Number.isFinite(price) || price < 0) return { error: '请输入有效的非负价格' }
  if (!db.prepare('SELECT 1 FROM categories WHERE name = ?').get(category)) return { error: '所选品类不存在，请刷新页面后重试' }
  return { value: { name, category, price: Math.round(price * 100) / 100 } }
}

function validateImportPayload(payload) {
  const errors = []
  const addError = (message) => { if (errors.length < 20) errors.push(message) }
  if (!isRecord(payload)) return { errors: ['备份文件必须是 JSON 对象'] }
  if (payload.schemaVersion !== SCHEMA_VERSION) addError(`不支持的备份格式版本，应为 ${SCHEMA_VERSION}`)
  if (!isValidTimestamp(payload.exportedAt)) addError('exportedAt 必须是有效时间')
  if (!Array.isArray(payload.categories)) addError('categories 必须是数组')
  if (!Array.isArray(payload.products)) addError('products 必须是数组')
  if (errors.length) return { errors }
  if (!payload.categories.length) addError('备份中至少需要一个品类')
  if (payload.categories.length > MAX_CATEGORIES) addError(`品类数量不能超过 ${MAX_CATEGORIES}`)
  if (payload.products.length > MAX_PRODUCTS) addError(`商品数量不能超过 ${MAX_PRODUCTS}`)

  const categoryIds = new Set()
  const categoryNames = new Set()
  const categories = payload.categories.map((category, index) => {
    const itemPath = `categories[${index}]`
    if (!isRecord(category)) { addError(`${itemPath} 必须是对象`); return null }
    const name = typeof category.name === 'string' ? category.name.trim() : ''
    if (!isPositiveSafeInteger(category.id)) addError(`${itemPath}.id 必须是正整数`)
    if (categoryIds.has(category.id)) addError(`${itemPath}.id 重复`)
    categoryIds.add(category.id)
    if (!name) addError(`${itemPath}.name 不能为空`)
    if (typeof category.name === 'string' && category.name !== name) addError(`${itemPath}.name 不能包含首尾空格`)
    if (name.length > 30) addError(`${itemPath}.name 不能超过 30 个字符`)
    if (name === '全部') addError(`${itemPath}.name 不能使用系统筛选项“全部”`)
    if (categoryNames.has(name)) addError(`${itemPath}.name 重复`)
    categoryNames.add(name)
    if (!Number.isSafeInteger(category.sort_order) || category.sort_order < 0) addError(`${itemPath}.sort_order 必须是非负整数`)
    return { id: category.id, name, sort_order: category.sort_order }
  }).filter(Boolean)

  const productIds = new Set()
  const products = payload.products.map((product, index) => {
    const itemPath = `products[${index}]`
    if (!isRecord(product)) { addError(`${itemPath} 必须是对象`); return null }
    const name = typeof product.name === 'string' ? product.name.trim() : ''
    const category = typeof product.category === 'string' ? product.category.trim() : ''
    if (!isPositiveSafeInteger(product.id)) addError(`${itemPath}.id 必须是正整数`)
    if (productIds.has(product.id)) addError(`${itemPath}.id 重复`)
    productIds.add(product.id)
    if (!name) addError(`${itemPath}.name 不能为空`)
    if (typeof product.name === 'string' && product.name !== name) addError(`${itemPath}.name 不能包含首尾空格`)
    if (name.length > 100) addError(`${itemPath}.name 不能超过 100 个字符`)
    if (!category || !categoryNames.has(category)) addError(`${itemPath}.category 不在导入品类中`)
    if (typeof product.category === 'string' && product.category !== category) addError(`${itemPath}.category 不能包含首尾空格`)
    if (!Number.isFinite(product.price) || product.price < 0) addError(`${itemPath}.price 必须是非负数字`)
    else if (Math.abs(product.price * 100 - Math.round(product.price * 100)) > 1e-8) addError(`${itemPath}.price 最多保留两位小数`)
    if (!isValidTimestamp(product.created_at)) addError(`${itemPath}.created_at 必须是有效时间`)
    if (!isValidTimestamp(product.updated_at)) addError(`${itemPath}.updated_at 必须是有效时间`)
    if (isValidTimestamp(product.created_at) && isValidTimestamp(product.updated_at) && Date.parse(product.created_at) > Date.parse(product.updated_at)) addError(`${itemPath}.created_at 不能晚于 updated_at`)
    return { id: product.id, name, category, price: Math.round(product.price * 100) / 100, created_at: product.created_at, updated_at: product.updated_at }
  }).filter(Boolean)
  return { errors, value: { schemaVersion: SCHEMA_VERSION, exportedAt: payload.exportedAt, categories, products } }
}

export function createPriceLabelsRouter() {
  const router = Router()
  const standardJsonParser = json({ limit: '50kb' })
  const importJsonParser = json({ limit: '5mb' })

  router.use((request, response, next) => {
    const parser = request.method === 'POST' && request.path === '/data/import'
      ? importJsonParser
      : standardJsonParser
    return parser(request, response, next)
  })

  router.get('/categories', (_request, response) => {
    const rows = getDatabase().prepare('SELECT id, name FROM categories ORDER BY sort_order ASC, id ASC').all()
    response.json(rows)
  })
  router.post('/categories', (request, response, next) => {
    const validation = validateCategory(request.body)
    if (validation.error) return response.status(400).json({ message: validation.error })
    const db = getDatabase()
    const name = validation.value
    if (db.prepare('SELECT id, name FROM categories WHERE name = ?').get(name)) return response.status(409).json({ message: '该品类已存在' })
    try {
      const created = db.transaction(() => {
        db.prepare('INSERT INTO categories (name, sort_order) SELECT ?, COALESCE(MAX(sort_order), 0) + 1 FROM categories').run(name)
        return db.prepare('SELECT id, name FROM categories WHERE name = ?').get(name)
      })()
      return response.status(201).json(created)
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ message: '该品类已存在' })
      return next(error)
    }
  })

  router.get('/products', (_request, response) => {
    const rows = getDatabase().prepare('SELECT id, name, category, price, created_at, updated_at FROM products ORDER BY updated_at DESC, id DESC').all()
    response.json(rows)
  })
  router.post('/products', (request, response) => {
    const db = getDatabase()
    const validation = validateProduct(db, request.body)
    if (validation.error) return response.status(400).json({ message: validation.error })
    const { name, category, price } = validation.value
    const now = new Date().toISOString()
    const result = db.prepare('INSERT INTO products (name, category, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(name, category, price, now, now)
    return response.status(201).json(db.prepare('SELECT id, name, category, price, created_at, updated_at FROM products WHERE id = ?').get(result.lastInsertRowid))
  })
  router.put('/products/:id', (request, response) => {
    const id = parseId(request.params.id)
    if (!id) return response.status(400).json({ message: '无效的商品 ID' })
    const db = getDatabase()
    const selectProduct = db.prepare('SELECT id, name, category, price, created_at, updated_at FROM products WHERE id = ?')
    if (!selectProduct.get(id)) return response.status(404).json({ message: '商品不存在' })
    const validation = validateProduct(db, request.body)
    if (validation.error) return response.status(400).json({ message: validation.error })
    const { name, category, price } = validation.value
    db.prepare('UPDATE products SET name = ?, category = ?, price = ?, updated_at = ? WHERE id = ?').run(name, category, price, new Date().toISOString(), id)
    return response.json(selectProduct.get(id))
  })
  router.delete('/products/:id', (request, response) => {
    const id = parseId(request.params.id)
    if (!id) return response.status(400).json({ message: '无效的商品 ID' })
    const result = getDatabase().prepare('DELETE FROM products WHERE id = ?').run(id)
    if (!result.changes) return response.status(404).json({ message: '商品不存在' })
    return response.status(204).end()
  })

  router.get('/data/export', (_request, response) => {
    const db = getDatabase()
    const exportedAt = new Date().toISOString()
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      categories: db.prepare('SELECT id, name, sort_order FROM categories ORDER BY sort_order ASC, id ASC').all(),
      products: db.prepare('SELECT id, name, category, price, created_at, updated_at FROM products ORDER BY id ASC').all(),
    }
    const timestamp = exportedAt.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
    response.set('Content-Disposition', `attachment; filename="lenovo-price-label-backup-${timestamp}.json"`)
    response.type('application/json').send(JSON.stringify(payload, null, 2))
  })
  router.post('/data/import', (request, response, next) => {
    if (!isRecord(request.body) || typeof request.body.validateOnly !== 'boolean') return response.status(400).json({ message: '请求必须包含 validateOnly 和 data' })
    const validation = validateImportPayload(request.body.data)
    if (validation.errors.length) return response.status(400).json({ message: validation.errors[0], errors: validation.errors })
    const summary = { categories: validation.value.categories.length, products: validation.value.products.length }
    if (request.body.validateOnly) return response.json({ valid: true, summary })
    try {
      const db = getDatabase()
      const insertCategory = db.prepare('INSERT INTO categories (id, name, sort_order) VALUES (@id, @name, @sort_order)')
      const insertProduct = db.prepare('INSERT INTO products (id, name, category, price, created_at, updated_at) VALUES (@id, @name, @category, @price, @created_at, @updated_at)')
      db.transaction((payload) => {
        db.prepare('DELETE FROM products').run()
        db.prepare('DELETE FROM categories').run()
        db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('categories', 'products')").run()
        payload.categories.forEach((category) => insertCategory.run(category))
        payload.products.forEach((product) => insertProduct.run(product))
        if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('导入数据未通过数据库外键完整性检查')
      })(validation.value)
      return response.json({ imported: true, summary })
    } catch (error) { return next(error) }
  })

  router.use((error, _request, response, next) => {
    if (response.headersSent) return next(error)
    if (error?.type === 'entity.too.large') return response.status(413).json({ message: '请求数据过大，最大允许 5MB' })
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) return response.status(400).json({ message: '请求体不是有效的 JSON' })
    return next(error)
  })
  return router
}

export default createPriceLabelsRouter()
