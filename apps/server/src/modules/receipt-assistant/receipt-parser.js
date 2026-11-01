/**
 * 票据文字结构化解析。
 * 输入是百度 OCR 返回的逐行文字，输出商户、日期、金额、订单号、支付方式和商品明细。
 * 解析原则：尽力提取，任何字段失败都不影响其他字段；金额和日期由调用方做严格校验。
 */

import { extractReceiptAmount } from './baidu-ocr.js'

function normalizeLine(text) {
  return String(text || '')
    .replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[：]/g, ':')
    .replace(/[￥]/g, '¥')
    .replace(/[\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const DATE_PATTERNS = [
  { re: /(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/, kind: 'ymd' },
  { re: /(20\d{2})(\d{2})(\d{2})(?!\d)/, kind: 'ymd' }
]

export function findDate(lines) {
  for (const line of lines) {
    for (const { re, kind } of DATE_PATTERNS) {
      const match = re.exec(line)
      if (!match) continue
      const year = Number(match[1])
      const month = Number(match[2])
      const day = Number(match[3])
      if (kind === 'ymd' && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return {
          date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          matchedText: line
        }
      }
    }
  }
  return null
}

const MERCHANT_HINTS = /(超市|商场|门店|专营店|旗舰店|体验店|便利店|商行|百货|公司|联想|专卖)/

export function findMerchant(lines) {
  const candidates = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.length >= 2 && line.length <= 40)
    .filter(({ line }) => !/^\d+$/.test(line))
    .filter(({ line }) => !/(订单|单号|时间|日期|收据|小票|发票|电话|地址)/.test(line))

  const hinted = candidates.find(({ line }) => MERCHANT_HINTS.test(line))
  if (hinted) return { merchant: hinted.line, matchedText: hinted.line }

  const first = candidates.find(({ index }) => index <= 3)
  return first ? { merchant: first.line, matchedText: first.line } : null
}

export function findOrderNo(lines) {
  const pattern = /(?:订单编号|订单号|单号|交易号|流水号|票号|凭证号|No\.?)[:：\s]*([A-Za-z0-9][A-Za-z0-9-]{5,32})/i
  for (const line of lines) {
    const match = pattern.exec(line)
    if (match) return { orderNo: match[1], matchedText: line }
  }
  return null
}

const PAYMENT_METHODS = [
  { keys: ['微信', 'WeChat'], method: '微信' },
  { keys: ['支付宝', 'Alipay'], method: '支付宝' },
  { keys: ['银行卡', '银联', '信用卡', '储蓄卡', '刷卡'], method: '银行卡' },
  { keys: ['现金'], method: '现金' },
  { keys: ['云闪付'], method: '云闪付' }
]

export function findPaymentMethod(lines) {
  for (const line of lines) {
    for (const { keys, method } of PAYMENT_METHODS) {
      if (keys.some(key => line.includes(key))) return { paymentMethod: method, matchedText: line }
    }
  }
  return null
}

export function findChange(lines) {
  const amountPattern = /(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})|-?\d+(?:\.\d{1,2})?)/
  for (const line of lines) {
    if (!/(找零|找赎|找钱)/.test(line)) continue
    const match = amountPattern.exec(line.replace(/(找零|找赎|找钱)/, ''))
    if (match) {
      const value = Number(match[1].replace(/,/g, ''))
      if (Number.isFinite(value) && value >= 0 && value < 100000) {
        return { change: Math.round(value * 100) / 100, matchedText: line }
      }
    }
  }
  return null
}

export function findDiscount(lines) {
  for (const line of lines) {
    if (!/(优惠|折扣|减免|立减|满减)/.test(line)) continue
    const match = /(-?\d+(?:\.\d{1,2})?)/.exec(line)
    if (!match) continue
    const value = Number(match[1])
    if (Number.isFinite(value) && value > 0 && value < 1000000) {
      return { discount: Math.round(value * 100) / 100, matchedText: line }
    }
  }
  return null
}

/**
 * 商品明细行识别。
 * 小票常见布局：名称 [数量] 单价 小计，或 名称 x数量 金额。
 * 只在命中明确的价格行时才产出条目，避免把普通文字误判为商品。
 */
export function findItems(lines) {
  const items = []
  const skipPattern = /(合计|总计|应付|实付|实收|支付|找零|优惠|折扣|税额|税率|小计合计|订单|单号|时间|日期|商户|收银|会员)/
  const trailingAmounts = /(-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2})\s*$/

  for (const line of lines) {
    if (line.length < 2 || line.length > 80) continue
    if (skipPattern.test(line)) continue
    if (!trailingAmounts.test(line)) continue

    const amountMatches = [...line.matchAll(/-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}/g)]
    if (!amountMatches.length) continue

    const subtotalMatch = amountMatches[amountMatches.length - 1]
    const subtotal = Number(subtotalMatch[0].replace(/,/g, ''))
    if (!Number.isFinite(subtotal) || subtotal <= 0) continue

    const namePart = line.slice(0, subtotalMatch.index).trim()
    if (!namePart || /^\d+$/.test(namePart)) continue

    let qty = null
    let unitPrice = null

    const qtyMatch = /[x×*]\s*(\d{1,4})\s*$/i.exec(namePart) || /(\d{1,3})\s*件\s*$/.exec(namePart)
    if (qtyMatch) qty = Number(qtyMatch[1])

    // 名称中残留的「x数量」「件数」和单价需要剥离，再判断剩余部分是否为价格
    let remainder = namePart.trim()

    const trailingPriceInName = /(-?\d{1,3}(?:,\d{3})*\.\d{1,2}|-?\d+\.\d{1,2})\s*$/.exec(remainder)
    if (trailingPriceInName) {
      const value = Number(trailingPriceInName[1].replace(/,/g, ''))
      if (Number.isFinite(value) && value > 0) unitPrice = value
      remainder = remainder.slice(0, trailingPriceInName.index).trim()
    }

    remainder = remainder
      .replace(/[x×*]\s*\d{1,4}\s*$/i, '')
      .replace(/\d{1,3}\s*件\s*$/, '')
      .trim()

    if (unitPrice === null && amountMatches.length >= 2) {
      const preceding = Number(amountMatches[amountMatches.length - 2][0].replace(/,/g, ''))
      if (Number.isFinite(preceding) && preceding > 0 && preceding <= subtotal) unitPrice = preceding
    }

    const name = remainder
      .replace(/[x×*]\s*\d{1,4}\s*$/i, '')
      .replace(/\d{1,3}\s*件\s*$/, '')
      .replace(/\s*[-:]\s*$/, '')
      .trim()

    if (!name || name.length < 1) continue
    if (unitPrice === null && qty && qty > 1) unitPrice = Math.round((subtotal / qty) * 100) / 100
    if (qty === null && unitPrice && unitPrice > 0 && Math.abs(unitPrice - subtotal) < 0.005) qty = 1
    if (qty === null && unitPrice && unitPrice > 0 && subtotal > unitPrice) {
      const derivedQty = Math.round(subtotal / unitPrice)
      if (derivedQty > 1 && Math.abs(unitPrice * derivedQty - subtotal) < 0.05) qty = derivedQty
    }

    items.push({
      name,
      qty: qty ?? (unitPrice ? 1 : null),
      unitPrice: unitPrice ?? (qty ? Math.round((subtotal / qty) * 100) / 100 : subtotal),
      subtotal: Math.round(subtotal * 100) / 100,
      matchedText: line
    })
  }

  return items
}

export function parseReceipt(words) {
  const lines = (Array.isArray(words) ? words : []).map(normalizeLine).filter(Boolean)
  const amountResult = extractReceiptAmount(lines)
  const dateResult = findDate(lines)
  const merchantResult = findMerchant(lines)
  const orderResult = findOrderNo(lines)
  const paymentResult = findPaymentMethod(lines)
  const changeResult = findChange(lines)
  const discountResult = findDiscount(lines)
  const items = findItems(lines)

  const itemsTotal = items.reduce((sum, item) => sum + item.subtotal, 0)
  const itemsConsistent = amountResult
    ? Math.abs(Math.round(itemsTotal * 100) / 100 - amountResult.value) < 0.05
    : null

  return {
    amount: amountResult ? amountResult.value : null,
    amountMatchedText: amountResult ? amountResult.matchedText : null,
    date: dateResult ? dateResult.date : null,
    dateMatchedText: dateResult ? dateResult.matchedText : null,
    merchant: merchantResult ? merchantResult.merchant : null,
    orderNo: orderResult ? orderResult.orderNo : null,
    paymentMethod: paymentResult ? paymentResult.paymentMethod : null,
    change: changeResult ? changeResult.change : null,
    discount: discountResult ? discountResult.discount : null,
    items,
    itemsTotal: Math.round(itemsTotal * 100) / 100,
    itemsConsistent,
    rawText: lines.join('\n').slice(0, 100000),
    wordsCount: lines.length
  }
}
