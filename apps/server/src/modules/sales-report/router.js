import express from 'express'
import { tableName } from '../../db/unified-database.js'

const SALES = tableName('receipt-assistant', 'sales')
const SALE_ITEMS = tableName('receipt-assistant', 'sale_items')

const DEFAULT_RANGE_DAYS = 30
const MAX_RANGE_DAYS = 3660

function toLocalISODate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  if (!Number.isFinite(date.getTime())) return null
  return toLocalISODate(date) === value ? date : null
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function deriveRange(query, db) {
  const hasData = db.prepare(`SELECT MIN(sale_date) AS firstDate, MAX(sale_date) AS lastDate FROM ${SALES} WHERE status = 1`).get()
  const lastDate = parseDate(query.end) || (hasData?.lastDate ? parseDate(hasData.lastDate) : new Date())
  const fallbackStart = addDays(lastDate, -(DEFAULT_RANGE_DAYS - 1))
  let startDate = parseDate(query.start) || (hasData?.firstDate ? parseDate(hasData.firstDate) : fallbackStart)
  if (startDate > lastDate) startDate = lastDate
  const span = Math.round((lastDate - startDate) / 86400000) + 1
  if (span > MAX_RANGE_DAYS) startDate = addDays(lastDate, -(MAX_RANGE_DAYS - 1))
  return { startDate: toLocalISODate(startDate), endDate: toLocalISODate(lastDate) }
}

const SALE_ROWS_SQL = `
  SELECT sale_date AS date, amount, status
  FROM ${SALES}
  WHERE status = 1 AND sale_date BETWEEN ? AND ?
  ORDER BY sale_date ASC
`

function buildPeriods(startDate, endDate) {
  const periods = new Map()
  const cursor = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  while (cursor <= end) {
    const iso = toLocalISODate(cursor)
    periods.set(iso, { date: iso, total: 0, count: 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return periods
}

function aggregate(rows, keyOf) {
  const buckets = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (!buckets.has(key)) buckets.set(key, { period: key, total: 0, count: 0 })
    const bucket = buckets.get(key)
    bucket.total = Math.round((bucket.total + row.amount) * 100) / 100
    bucket.count += 1
  }
  return [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period))
}

function percentChange(current, previous) {
  if (!previous) return current ? null : 0
  return Math.round(((current - previous) / previous) * 10000) / 100
}

export function createSalesReportRouter({ getDatabase }) {
  const router = express.Router()

  router.get('/overview', (request, response) => {
    const db = getDatabase()
    const { startDate, endDate } = deriveRange(request.query, db)
    const rows = db.prepare(SALE_ROWS_SQL).all(startDate, endDate)

    const total = Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100
    const count = rows.length
    const activeDays = new Set(rows.map(row => row.date)).size
    const averagePerSale = count ? Math.round((total / count) * 100) / 100 : 0
    const averagePerDay = activeDays ? Math.round((total / activeDays) * 100) / 100 : 0
    const amounts = rows.map(row => row.amount).sort((a, b) => a - b)
    const median = amounts.length
      ? (amounts.length % 2
        ? amounts[(amounts.length - 1) / 2]
        : Math.round(((amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2) * 100) / 100)
      : 0

    const days = buildPeriods(startDate, endDate)
    for (const row of rows) {
      const bucket = days.get(row.date)
      if (!bucket) continue
      bucket.total = Math.round((bucket.total + row.amount) * 100) / 100
      bucket.count += 1
    }
    const daily = [...days.values()]

    const best = daily.reduce((acc, day) => (day.total > (acc?.total ?? -1) ? day : acc), null)
    const firstDate = parseDate(startDate)
    const lastDate = parseDate(endDate)
    const span = Math.round((lastDate - firstDate) / 86400000) + 1
    const previousStart = toLocalISODate(addDays(firstDate, -span))
    const previousEnd = toLocalISODate(addDays(firstDate, -1))
    const previousTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM ${SALES} WHERE status = 1 AND sale_date BETWEEN ? AND ?`).get(previousStart, previousEnd).total

    return response.json({
      range: { startDate, endDate },
      summary: {
        total,
        count,
        activeDays,
        averagePerSale,
        averagePerDay,
        median,
        bestDay: best && best.total > 0 ? best : null,
        previousTotal: Math.round(previousTotal * 100) / 100,
        previousRange: { startDate: previousStart, endDate: previousEnd },
        changePercent: percentChange(total, previousTotal)
      },
      daily
    })
  })

  router.get('/trend', (request, response) => {
    const db = getDatabase()
    const { startDate, endDate } = deriveRange(request.query, db)
    const granularity = ['day', 'month', 'quarter', 'year'].includes(request.query.granularity)
      ? request.query.granularity
      : 'day'
    const rows = db.prepare(SALE_ROWS_SQL).all(startDate, endDate)

    const keyOf = (() => {
      if (granularity === 'month') return row => row.date.slice(0, 7)
      if (granularity === 'year') return row => row.date.slice(0, 4)
      if (granularity === 'quarter') {
        return row => {
          const month = Number(row.date.slice(5, 7))
          return `${row.date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`
        }
      }
      return row => row.date
    })()

    return response.json({
      range: { startDate, endDate },
      granularity,
      points: aggregate(rows, keyOf)
    })
  })

  router.get('/comparison', (request, response) => {
    const db = getDatabase()
    const { startDate, endDate } = deriveRange(request.query, db)
    const rows = db.prepare(SALE_ROWS_SQL).all(startDate, endDate)

    const byMonth = aggregate(rows, row => row.date.slice(0, 7))
    const byQuarter = aggregate(rows, row => {
      const month = Number(row.date.slice(5, 7))
      return `${row.date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`
    })
    const byYear = aggregate(rows, row => row.date.slice(0, 4))

    const withChange = (list) => list.map((item, index) => ({
      ...item,
      previousTotal: index > 0 ? list[index - 1].total : null,
      changePercent: index > 0 ? percentChange(item.total, list[index - 1].total) : null
    }))

    return response.json({
      range: { startDate, endDate },
      months: withChange(byMonth),
      quarters: withChange(byQuarter),
      years: withChange(byYear)
    })
  })

  router.get('/items', (request, response) => {
    const db = getDatabase()
    const { startDate, endDate } = deriveRange(request.query, db)
    const hasItems = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${SALE_ITEMS}'`).get()
    if (!hasItems) return response.json({ range: { startDate, endDate }, items: [], note: '尚未记录商品明细' })

    const rows = db.prepare(`
      SELECT i.name AS name,
             COUNT(*) AS occurrences,
             COALESCE(SUM(i.qty), 0) AS qty,
             ROUND(SUM(i.subtotal), 2) AS total
      FROM ${SALE_ITEMS} i
      JOIN ${SALES} s ON s.id = i.sale_id
      WHERE s.status = 1 AND s.sale_date BETWEEN ? AND ?
      GROUP BY i.name
      ORDER BY total DESC
      LIMIT 100
    `).all(startDate, endDate)

    return response.json({
      range: { startDate, endDate },
      items: rows.map(row => ({
        name: row.name,
        occurrences: Number(row.occurrences) || 0,
        qty: Number(row.qty) || 0,
        total: Number(row.total) || 0
      }))
    })
  })

  router.get('/records', (request, response) => {
    const db = getDatabase()
    const { startDate, endDate } = deriveRange(request.query, db)
    const page = Math.max(1, Number(request.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(request.query.pageSize) || 20))
    const offset = (page - 1) * pageSize

    const totals = db.prepare(`SELECT COUNT(*) AS count FROM ${SALES} WHERE status = 1 AND sale_date BETWEEN ? AND ?`).get(startDate, endDate)
    const total = Number(totals?.count) || 0
    const rows = db.prepare(`
      SELECT id, sale_date AS saleDate, amount, created_at AS createdAt
      FROM ${SALES}
      WHERE status = 1 AND sale_date BETWEEN ? AND ?
      ORDER BY sale_date DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(startDate, endDate, pageSize, offset)

    const hasItems = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${SALE_ITEMS}'`).get()
    let itemMap = new Map()
    if (hasItems && rows.length) {
      const ids = rows.map(row => row.id)
      const placeholders = ids.map(() => '?').join(', ')
      const items = db.prepare(`SELECT id, sale_id, name, qty, unit_price AS unitPrice, subtotal FROM ${SALE_ITEMS} WHERE sale_id IN (${placeholders}) ORDER BY id`).all(...ids)
      for (const item of items) {
        if (!itemMap.has(item.sale_id)) itemMap.set(item.sale_id, [])
        itemMap.get(item.sale_id).push({ id: item.id, name: item.name, qty: item.qty, unitPrice: item.unitPrice, subtotal: item.subtotal })
      }
    }

    return response.json({
      range: { startDate, endDate },
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      records: rows.map(row => ({ ...row, items: itemMap.get(row.id) ?? [] }))
    })
  })

  return router
}
