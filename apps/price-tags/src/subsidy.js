export const DEFAULT_SUBSIDY_CONFIG = {
  computer: { rate: 15, cap: 1500 },
  mobile: { rate: 15, cap: 500 }
}

export function normalizeSubsidyConfig(raw) {
  const source = raw || {}
  return {
    computer: { ...DEFAULT_SUBSIDY_CONFIG.computer, ...(source.computer || {}) },
    mobile: { ...DEFAULT_SUBSIDY_CONFIG.mobile, ...(source.mobile || {}) }
  }
}

// 分类归入哪一档：笔记本/台式机 -> 电脑；手机/平板 -> 移动
export function subsidyRuleOf(category, config) {
  if (category === '笔记本' || category === '台式机') return config.computer
  if (category === '手机' || category === '平板') return config.mobile
  return null
}

// 补贴 = min(原价 × 百分比, 封顶)；国补价 = 原价 − 补贴
export function calcSubsidyPrice(price, category, config) {
  const rule = subsidyRuleOf(category, config)
  if (!rule) return null
  if (!Number.isFinite(price) || price <= 0) return null
  const subsidy = Math.min(price * (rule.rate / 100), rule.cap)
  return Math.round((price - subsidy) * 10000) / 10000
}
