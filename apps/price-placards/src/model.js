export const deepClone = (value) => JSON.parse(JSON.stringify(value))

const DEFAULT_FEATURES = [
  { title: '核心卖点', desc: '填写产品优势', imageAssetId: null },
  { title: '贴心体验', desc: '填写体验亮点', imageAssetId: null },
  { title: '品质设计', desc: '填写设计亮点', imageAssetId: null },
  { title: '高效体验', desc: '填写效率亮点', imageAssetId: null },
]

export function blankContent() {
  const productTitle = '精选产品'
  return {
    title: productTitle,
    productTitle,
    showProductImage: true,
    productImageType: 'default',
    productImageAssetId: null,
    features: deepClone(DEFAULT_FEATURES),
    products: [{ config: '产品配置', colors: [{ name: '', price: 1 }] }],
    showAccessory: true,
    accessories: [{ name: '配件一', price: 1 }, { name: '配件二', price: 1 }],
    serviceTitle: '想帮帮',
    serviceLogoAssetId: null,
    services: [{ name: '服务一', price: 1 }, { name: '服务二', price: 1 }],
  }
}

export function sampleContent() {
  const content = blankContent()
  const productTitle = 'IdeaPad Pro 14'
  return {
    ...content,
    title: productTitle,
    productTitle,
    features: [
      { title: '强劲性能', desc: '高性能处理器，多任务流畅运行', imageAssetId: null },
      { title: '精彩视界', desc: '高分辨率护眼屏，细节清晰自然', imageAssetId: null },
      { title: '轻薄随行', desc: '精巧机身设计，移动办公更轻松', imageAssetId: null },
      { title: '持久续航', desc: '长效电池表现，满足全天使用', imageAssetId: null },
    ],
    products: [
      { config: 'Ultra 5 / 16GB / 1TB SSD', colors: [{ name: '深空灰', price: 5999 }, { name: '云帆白', price: 6099 }] },
      { config: 'Ultra 7 / 32GB / 1TB SSD', colors: [{ name: '', price: 6999 }] },
    ],
    accessories: [{ name: '联想无线鼠标', price: 99 }, { name: '联想电脑包', price: 129 }],
    services: [{ name: '三年上门服务', price: 399 }, { name: '意外保护服务', price: 599 }],
  }
}

export function colorCount(content) {
  return content.products.reduce((sum, product) => sum + product.colors.length, 0)
}

export function normalizeContent(content) {
  const cloned = deepClone(content)
  cloned.features = cloned.features.map((feature) => ({
    ...feature,
    imageAssetId: Number.isSafeInteger(feature.imageAssetId) && feature.imageAssetId > 0 ? feature.imageAssetId : null,
  }))
  cloned.title = cloned.productTitle
  cloned.showAccessory = Boolean(cloned.showAccessory) && colorCount(cloned) < 5
  cloned.serviceTitle = '想帮帮'
  return cloned
}

export function collectContentAssetIds(content) {
  const ids = new Set()
  if (content.productImageType === 'custom' && Number.isSafeInteger(content.productImageAssetId) && content.productImageAssetId > 0) ids.add(content.productImageAssetId)
  if (Number.isSafeInteger(content.serviceLogoAssetId) && content.serviceLogoAssetId > 0) ids.add(content.serviceLogoAssetId)
  content.features.forEach((feature) => {
    if (Number.isSafeInteger(feature.imageAssetId) && feature.imageAssetId > 0) ids.add(feature.imageAssetId)
  })
  return ids
}

export function validateDraft(content) {
  const errors = []
  const text = (value, label, max, empty = false) => {
    if (typeof value !== 'string' || (!empty && !value.trim())) errors.push(`${label}不能为空`)
    else if (value.trim().length > max) errors.push(`${label}不能超过 ${max} 个字符`)
  }
  const price = (value, label) => { if (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 999999) errors.push(`${label}必须是 1-999999 的整数`) }
  text(content.productTitle, '产品标题', 80)
  if (!['default', 'custom'].includes(content.productImageType)) errors.push('产品图片类型无效')
  if (content.productImageType === 'custom' && (!Number.isSafeInteger(content.productImageAssetId) || content.productImageAssetId <= 0)) errors.push('请先处理并上传自定义产品图片')
  if (content.features.length < 3 || content.features.length > 4) errors.push('卖点必须为 3-4 项')
  content.features.forEach((item, i) => {
    text(item.title, `卖点 ${i + 1} 标题`, 20)
    text(item.desc, `卖点 ${i + 1} 描述`, 20)
    if (item.imageAssetId != null && (!Number.isSafeInteger(item.imageAssetId) || item.imageAssetId <= 0)) errors.push(`卖点 ${i + 1} 图片无效`)
  })
  if (content.products.length < 1 || content.products.length > 5) errors.push('产品必须为 1-5 项')
  content.products.forEach((item, i) => {
    text(item.config, `产品 ${i + 1} 配置`, 160, true)
    if (!item.colors.length) errors.push(`产品 ${i + 1} 至少需要一种颜色`)
    item.colors.forEach((row, j) => { text(row.name, `颜色 ${i + 1}-${j + 1}`, 40, true); price(row.price, `颜色 ${i + 1}-${j + 1} 价格`) })
  })
  if (colorCount(content) < 1 || colorCount(content) > 6) errors.push('颜色总数必须为 1-6')
  ;['accessories', 'services'].forEach((key) => {
    if (content[key].length !== 2) errors.push(`${key === 'accessories' ? '配件' : '服务'}必须固定为 2 项`)
    content[key].forEach((row, i) => { text(row.name, `${key === 'accessories' ? '配件' : '服务'} ${i + 1}`, key === 'accessories' ? 80 : 100); price(row.price, `${key === 'accessories' ? '配件' : '服务'} ${i + 1} 价格`) })
  })
  return errors
}

export function unwrapComputerProducts(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []
}

export function sourceKey(module, id) { return `${module}:${id}` }

function normalizeSourceTimestamp(value) {
  if (value == null || value === '') return null
  const candidate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value))
    ? `${String(value).replace(' ', 'T')}Z`
    : String(value)
  const parsed = new Date(candidate)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function normalizedSourcePrice(value) {
  return Math.max(0, Math.min(999999, Math.round(Number(value) || 0)))
}

function sourceMetadata(row) {
  return {
    snapshot: deepClone(row),
    sourceUpdatedAt: normalizeSourceTimestamp(row.updated_at || row.updatedAt),
  }
}

export function mapSource(sourceModule, row) {
  if (sourceModule === 'computer-labels') {
    return {
      productTitle: String(row.name || '').trim(),
      product: {
        config: String(row.config || '').trim(),
        colors: [{ name: String(row.color || '').trim(), price: 0 }],
      },
      ...sourceMetadata(row),
    }
  }
  return {
    productTitle: String(row.category || '').trim() || String(row.name || '').trim(),
    product: {
      config: String(row.name || '').trim(),
      colors: [{ name: '', price: normalizedSourcePrice(row.price) }],
    },
    ...sourceMetadata(row),
  }
}

export function mapAccessorySource(sourceModule, row) {
  return {
    accessory: {
      name: String(row.name || '').trim(),
      price: sourceModule === 'price-labels' ? normalizedSourcePrice(row.price) : 0,
    },
    ...sourceMetadata(row),
  }
}

function locator(source) {
  return Number.isInteger(source.accessoryIndex)
    ? { type: 'accessory', index: source.accessoryIndex, key: `accessory:${source.accessoryIndex}` }
    : { type: 'product', index: source.productIndex, key: `product:${source.productIndex}` }
}

export function buildSourceDiffs(content, sourceSnapshots, rowsByKey) {
  const diffs = []
  sourceSnapshots.forEach((source) => {
    const location = locator(source)
    const row = rowsByKey.get(sourceKey(source.sourceModule, source.sourceId))
    const shared = {
      targetType: location.type,
      targetIndex: location.index,
      productIndex: location.type === 'product' ? location.index : undefined,
      accessoryIndex: location.type === 'accessory' ? location.index : undefined,
      source,
    }
    if (!row) {
      diffs.push({ ...shared, key: `${location.key}:missing`, field: '来源状态', before: '存在', after: '来源已删除', apply: false, missing: true })
      return
    }

    if (location.type === 'accessory') {
      const mapped = mapAccessorySource(source.sourceModule, row)
      const current = content.accessories[location.index]
      if (!current) return
      ;['name', 'price'].forEach((path) => {
        if (current[path] !== mapped.accessory[path]) {
          diffs.push({ ...shared, key: `${location.key}:${path}`, field: path === 'name' ? '配件名称' : '配件价格', before: current[path], after: mapped.accessory[path] || '（待填写价格）', apply: false, value: mapped.accessory[path], path, target: 'accessory', mapped })
        }
      })
      if (JSON.stringify(source.snapshot) !== JSON.stringify(mapped.snapshot) && !diffs.some((item) => item.targetType === location.type && item.targetIndex === location.index && item.mapped)) {
        diffs.push({ ...shared, key: `${location.key}:snapshot`, field: '仅来源快照', before: '旧快照', after: '来源有其他字段更新', apply: false, path: null, mapped })
      }
      return
    }

    const mapped = mapSource(source.sourceModule, row)
    const current = content.products[location.index]
    if (!current) return
    if (location.index === 0 && content.productTitle !== mapped.productTitle) {
      diffs.push({ ...shared, key: `${location.key}:productTitle`, field: '产品标题', before: content.productTitle, after: mapped.productTitle, apply: false, value: mapped.productTitle, path: 'productTitle', target: 'content', mapped })
    }
    if (current.config !== mapped.product.config) diffs.push({ ...shared, key: `${location.key}:config`, field: '配置', before: current.config, after: mapped.product.config, apply: false, value: mapped.product.config, path: 'config', target: 'product', mapped })
    const refreshedColors = source.sourceModule === 'computer-labels'
      ? current.colors.map((color, index) => index === 0 ? { ...color, name: mapped.product.colors[0]?.name || '' } : deepClone(color))
      : mapped.product.colors
    if (JSON.stringify(current.colors) !== JSON.stringify(refreshedColors)) {
      const colorsOnly = source.sourceModule === 'computer-labels'
      diffs.push({
        ...shared,
        key: `${location.key}:colors`,
        field: colorsOnly ? '颜色' : '颜色与价格',
        before: colorsOnly ? current.colors.map((x) => x.name || '（空）').join('；') : current.colors.map((x) => `${x.name || '（无颜色）'} ¥${x.price}`).join('；'),
        after: colorsOnly ? refreshedColors.map((x) => x.name || '（空）').join('；') : refreshedColors.map((x) => `${x.name || '（无颜色）'} ¥${x.price || '（待填写价格）'}`).join('；'),
        apply: false,
        value: refreshedColors,
        path: 'colors',
        target: 'product',
        mapped,
      })
    }
    if (JSON.stringify(source.snapshot) !== JSON.stringify(mapped.snapshot) && !diffs.some((item) => item.targetType === location.type && item.targetIndex === location.index && item.mapped)) {
      diffs.push({ ...shared, key: `${location.key}:snapshot`, field: '仅来源快照', before: '旧快照', after: '来源有其他字段更新', apply: false, path: null, mapped })
    }
  })
  return diffs
}
