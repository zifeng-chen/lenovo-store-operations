import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import sharp from 'sharp'

export const JSON_SCHEMA_VERSION = 2
export const DATABASE_SCHEMA_VERSION = 3
// Kept as the portable JSON schema version for compatibility with existing exports.
export const SCHEMA_VERSION = JSON_SCHEMA_VERSION
export const MAX_PLACARDS = 1000
export const MAX_VERSIONS_PER_PLACARD = 100
export const MAX_SERVICE_CATALOG = 5000
export const MAX_IMAGE_BYTES = 1024 * 1024
export const MAX_IMAGE_DIMENSION = 1200
export const MAX_IMAGE_ASSETS = 5000
export const MAX_ASSETS_PER_VERSION = 6
export const MAX_TOTAL_IMAGE_BYTES = 250 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const LIMITS = Object.freeze({
  title: 80,
  productTitle: 80,
  featureTitle: 30,
  featureDesc: 120,
  config: 160,
  color: 40,
  accessory: 80,
  service: 100,
})

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

export function isValidTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

function text(value, label, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${label}必须是文字`)
  const normalized = value.trim()
  if (!allowEmpty && !normalized) throw new Error(`${label}不能为空`)
  if (normalized.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  return normalized
}

function requiredBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
  return value
}

function optionalAssetId(value, label) {
  if (value == null || value === '') return null
  if (!isPositiveSafeInteger(value)) throw new Error(`${label}必须是有效的图片 ID`)
  return value
}

function validatePrice(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 999999) throw new Error(`${label}必须是 1-999999 的人民币整数`)
  return value
}

function stableJsonValue(value, label, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} 包含不可 JSON 序列化的值`)
    return value
  }
  if (typeof value !== 'object') throw new Error(`${label} 包含不可 JSON 序列化的值`)
  if (ancestors.has(value)) throw new Error(`${label} 包含循环引用`)
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value)
      if (Object.getOwnPropertySymbols(value).length || keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw new Error(`${label} 包含稀疏数组、额外属性或不可 JSON 序列化的键`)
      }
      return value.map((item, index) => stableJsonValue(item, `${label}[${index}]`, ancestors))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} 只能包含普通 JSON 对象`)
    if (Object.getOwnPropertySymbols(value).length) throw new Error(`${label} 包含不可 JSON 序列化的键`)
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key], `${label}.${key}`, ancestors)]))
  } finally {
    ancestors.delete(value)
  }
}

function cloneSnapshot(snapshot, label) {
  if (!isRecord(snapshot)) throw new Error(`${label}.snapshot 必须是对象`)
  const cloned = stableJsonValue(snapshot, `${label}.snapshot`)
  const serialized = JSON.stringify(cloned)
  if (Buffer.byteLength(serialized) > 20 * 1024) throw new Error(`${label}.snapshot 不能超过 20KB`)
  return cloned
}

function validatePricedItem(item, label, nameLimit, { allowEmptyName = false } = {}) {
  if (!isRecord(item)) throw new Error(`${label}必须是对象`)
  return {
    name: text(item.name, `${label}名称`, nameLimit, { allowEmpty: allowEmptyName }),
    price: validatePrice(item.price, `${label}价格`),
  }
}

export function validateServiceCatalogItem(item) {
  return validatePricedItem(item, '服务', LIMITS.service)
}

export function validatePlacardPayload(payload, { requireFeatureImages = false, syncTitle = false, enforceAccessoryVisibility = false, enforceFeatureTextLimit = false } = {}) {
  if (!isRecord(payload)) throw new Error('展牌内容必须是对象')
  const contentInput = isRecord(payload.content) ? payload.content : payload
  const productTitle = text(contentInput.productTitle, '产品标题', LIMITS.productTitle)
  const title = syncTitle ? productTitle : text(contentInput.title, '保存记录标题', LIMITS.title)
  const showProductImage = requiredBoolean(contentInput.showProductImage, '是否显示产品图片')
  if (!['default', 'custom'].includes(contentInput.productImageType)) throw new Error('产品图片类型必须是 default 或 custom')
  const productImageType = contentInput.productImageType
  const suppliedProductImageAssetId = optionalAssetId(contentInput.productImageAssetId, '产品图片')
  if (productImageType === 'custom' && suppliedProductImageAssetId == null) throw new Error('自定义产品图片必须提供图片 ID')
  const productImageAssetId = productImageType === 'custom' ? suppliedProductImageAssetId : null

  if (!Array.isArray(contentInput.features) || contentInput.features.length < 3 || contentInput.features.length > 4) {
    throw new Error('卖点必须为 3-4 项')
  }
  const features = contentInput.features.map((feature, index) => {
    if (!isRecord(feature)) throw new Error(`卖点 ${index + 1} 必须是对象`)
    const featureTextLimit = enforceFeatureTextLimit ? 20 : null
    const normalized = {
      title: text(feature.title, `卖点 ${index + 1} 标题`, featureTextLimit ?? LIMITS.featureTitle),
      desc: text(feature.desc, `卖点 ${index + 1} 描述`, featureTextLimit ?? LIMITS.featureDesc),
    }
    const imageAssetId = optionalAssetId(feature.imageAssetId, `卖点 ${index + 1} 图片`)
    if (requireFeatureImages && imageAssetId === null) throw new Error(`卖点 ${index + 1} 必须上传图片`)
    if (imageAssetId !== null) normalized.imageAssetId = imageAssetId
    return normalized
  })

  if (!Array.isArray(contentInput.products) || contentInput.products.length < 1 || contentInput.products.length > 5) {
    throw new Error('产品必须为 1-5 项')
  }
  let colorRows = 0
  const products = contentInput.products.map((product, index) => {
    if (!isRecord(product)) throw new Error(`产品 ${index + 1} 必须是对象`)
    if (!Array.isArray(product.colors) || product.colors.length < 1 || product.colors.length > 6) {
      throw new Error(`产品 ${index + 1} 的颜色必须至少保留一行`)
    }
    colorRows += product.colors.length
    return {
      config: text(product.config, `产品 ${index + 1} 配置`, LIMITS.config, { allowEmpty: true }),
      colors: product.colors.map((color, colorIndex) => validatePricedItem(color, `产品 ${index + 1} 颜色 ${colorIndex + 1}`, LIMITS.color, { allowEmptyName: true })),
    }
  })
  if (colorRows < 1 || colorRows > 6) throw new Error('颜色总行数必须为 1-6 行')
  const requestedShowAccessory = requiredBoolean(contentInput.showAccessory, '是否显示配件')
  const showAccessory = enforceAccessoryVisibility ? requestedShowAccessory && colorRows < 5 : requestedShowAccessory

  if (!Array.isArray(contentInput.accessories) || contentInput.accessories.length !== 2) throw new Error('配件必须固定为 2 项')
  const accessories = contentInput.accessories.map((item, index) => validatePricedItem(item, `配件 ${index + 1}`, LIMITS.accessory))
  if (!Array.isArray(contentInput.services) || contentInput.services.length !== 2) throw new Error('服务必须固定为 2 项')
  const services = contentInput.services.map((item, index) => validatePricedItem(item, `服务 ${index + 1}`, LIMITS.service))
  if (contentInput.serviceTitle !== '想帮帮') throw new Error('服务标题必须为“想帮帮”')
  const serviceLogoAssetId = optionalAssetId(contentInput.serviceLogoAssetId, '服务标志')

  const sourceInput = payload.sourceSnapshots ?? contentInput.sourceSnapshots ?? []
  if (!Array.isArray(sourceInput) || sourceInput.length > products.length + accessories.length) throw new Error('来源快照数量无效')
  const usedTargets = new Set()
  const sourceSnapshots = sourceInput.map((source, index) => {
    const label = `来源 ${index + 1}`
    if (!isRecord(source)) throw new Error(`${label}必须是对象`)
    const hasProductIndex = Object.hasOwn(source, 'productIndex')
    const hasAccessoryIndex = Object.hasOwn(source, 'accessoryIndex')
    if (hasProductIndex === hasAccessoryIndex) throw new Error(`${label}必须且只能指定 productIndex 或 accessoryIndex`)
    const targetIndex = hasProductIndex ? source.productIndex : source.accessoryIndex
    const targetLimit = hasProductIndex ? products.length : accessories.length
    const targetName = hasProductIndex ? 'productIndex' : 'accessoryIndex'
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= targetLimit) throw new Error(`${label}.${targetName} 无效`)
    const targetKey = `${hasProductIndex ? 'product' : 'accessory'}:${targetIndex}`
    if (usedTargets.has(targetKey)) throw new Error(`${label}.${targetName} 重复`)
    usedTargets.add(targetKey)
    if (!['computer-labels', 'price-labels'].includes(source.sourceModule)) throw new Error(`${label}.sourceModule 无效`)
    const sourceId = source.sourceId
    if (!(isPositiveSafeInteger(sourceId) || (typeof sourceId === 'string' && sourceId.trim() && sourceId.trim().length <= 100))) {
      throw new Error(`${label}.sourceId 无效`)
    }
    const normalizedSourceId = typeof sourceId === 'string' ? sourceId.trim() : sourceId
    const sourceUpdatedAt = source.sourceUpdatedAt == null || source.sourceUpdatedAt === '' ? null : source.sourceUpdatedAt
    if (sourceUpdatedAt !== null && !isValidTimestamp(sourceUpdatedAt)) throw new Error(`${label}.sourceUpdatedAt 必须是严格 ISO UTC 时间`)
    const normalizedSnapshot = cloneSnapshot(source.snapshot, label)
    return hasProductIndex ? {
      productIndex: targetIndex,
      sourceModule: source.sourceModule,
      sourceId: normalizedSourceId,
      sourceUpdatedAt,
      snapshot: normalizedSnapshot,
    } : {
      accessoryIndex: targetIndex,
      sourceModule: source.sourceModule,
      sourceId: normalizedSourceId,
      sourceUpdatedAt,
      snapshot: normalizedSnapshot,
    }
  }).sort((left, right) => {
    const leftAccessory = Object.hasOwn(left, 'accessoryIndex')
    const rightAccessory = Object.hasOwn(right, 'accessoryIndex')
    if (leftAccessory !== rightAccessory) return leftAccessory ? 1 : -1
    return (leftAccessory ? left.accessoryIndex : left.productIndex) - (rightAccessory ? right.accessoryIndex : right.productIndex)
  })

  return {
    content: {
      title,
      productTitle,
      showProductImage,
      productImageType,
      productImageAssetId,
      features,
      products,
      showAccessory,
      accessories,
      serviceTitle: '想帮帮',
      serviceLogoAssetId,
      services,
    },
    sourceSnapshots,
  }
}

export function collectAssetIds(content) {
  const ids = new Set()
  if (content.productImageType === 'custom' && content.productImageAssetId) ids.add(content.productImageAssetId)
  if (content.serviceLogoAssetId) ids.add(content.serviceLogoAssetId)
  content.features.forEach((feature) => {
    if (feature.imageAssetId) ids.add(feature.imageAssetId)
  })
  return [...ids].sort((left, right) => left - right)
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
  return crc >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const MAX_PNG_SCANLINE_BYTES = 16 * 1024 * 1024
const MAX_PNG_SCANLINE_ROWS = MAX_IMAGE_DIMENSION * 2

function pngScanlines(width, height, bitDepth, colorType, interlaced) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) return null
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels || !Number.isInteger(bitDepth) || ![false, true].includes(interlaced)) return null
  const bitsPerPixel = channels * bitDepth
  const passes = interlaced
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]]
  const rows = []
  let byteLength = 0
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX)
    const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY)
    if (!passWidth || !passHeight) continue
    const rowLength = Math.ceil((passWidth * bitsPerPixel) / 8)
    if (!Number.isSafeInteger(rowLength) || rows.length + passHeight > MAX_PNG_SCANLINE_ROWS) return null
    for (let row = 0; row < passHeight; row += 1) {
      if (byteLength > MAX_PNG_SCANLINE_BYTES - 1 - rowLength) return null
      rows.push(byteLength)
      byteLength += 1 + rowLength
    }
  }
  if (!byteLength || byteLength > MAX_PNG_SCANLINE_BYTES) return null
  return { rows, byteLength }
}

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length < 57 || !buffer.subarray(0, 8).equals(signature)) return null
  let offset = 8
  let dimensions = null
  let bitDepth
  let colorType
  let interlaced
  let hasPalette = false
  let sawImageData = false
  let imageDataEnded = false
  const imageData = []

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    if (dataEnd < dataStart || chunkEnd > buffer.length) return null
    const type = buffer.toString('ascii', typeStart, dataStart)
    if (crc32(buffer.subarray(typeStart, dataEnd)) !== buffer.readUInt32BE(dataEnd)) return null

    if (offset === 8 && type !== 'IHDR') return null
    if (type === 'IHDR') {
      if (dimensions || length !== 13) return null
      const width = buffer.readUInt32BE(dataStart)
      const height = buffer.readUInt32BE(dataStart + 4)
      if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) return null
      bitDepth = buffer[dataStart + 8]
      colorType = buffer[dataStart + 9]
      const validDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!validDepths[colorType]?.includes(bitDepth) || buffer[dataStart + 10] !== 0 || buffer[dataStart + 11] !== 0 || ![0, 1].includes(buffer[dataStart + 12])) return null
      interlaced = buffer[dataStart + 12] === 1
      dimensions = { width, height }
    } else if (type === 'PLTE') {
      if (!dimensions || sawImageData || length < 3 || length > 768 || length % 3 !== 0) return null
      hasPalette = true
    } else if (type === 'IDAT') {
      if (!dimensions || imageDataEnded || (colorType === 3 && !hasPalette)) return null
      sawImageData = true
      imageData.push(buffer.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      if (length !== 0 || !dimensions || !sawImageData || chunkEnd !== buffer.length) return null
      let decoded
      const scanlines = pngScanlines(dimensions.width, dimensions.height, bitDepth, colorType, interlaced)
      if (!scanlines) return null
      try { decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: scanlines.byteLength + 1 }) } catch { return null }
      if (decoded.length !== scanlines.byteLength || scanlines.rows.some((rowStart) => decoded[rowStart] > 4)) return null
      return dimensions
    } else {
      if (sawImageData) imageDataEnded = true
      if ((buffer[typeStart] & 0x20) === 0) return null
    }
    offset = chunkEnd
  }
  return null
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]
    offset += 2
    if (marker === 0xd9 || marker === 0xda) break
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > buffer.length) break
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) }
    }
    offset += length
  }
  return null
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null
  const type = buffer.toString('ascii', 12, 16)
  if (type === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
  if (type === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  }
  if (type === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

export function inspectImageBuffer(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('图片处理副本必须小于等于 1MB')
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) throw new Error('图片仅支持 PNG、JPEG 或 WEBP')
  const dimensions = mimeType === 'image/png' ? pngDimensions(buffer) : mimeType === 'image/jpeg' ? jpegDimensions(buffer) : webpDimensions(buffer)
  if (!dimensions) throw new Error('图片内容与格式不匹配或无法读取尺寸')
  if (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    throw new Error('图片宽高必须为正整数且不能超过 1200px')
  }
  return { ...dimensions, byteLength: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') }
}

export async function validateDecodedImage(buffer, mimeType, expected = {}) {
  const inspected = inspectImageBuffer(buffer, mimeType)
  const expectedFormat = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[mimeType]
  let metadata
  let decoded
  try {
    const image = sharp(buffer, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION,
      sequentialRead: true,
    })
    metadata = await image.metadata()
    decoded = await image.raw().toBuffer({ resolveWithObject: true })
  } catch {
    throw new Error('图片像素数据损坏或无法完整解码')
  }
  if (metadata.format !== expectedFormat || decoded.info.format !== 'raw'
      || metadata.width !== inspected.width || metadata.height !== inspected.height
      || decoded.info.width !== inspected.width || decoded.info.height !== inspected.height) {
    throw new Error('图片格式或宽高与实际解码结果不一致')
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && inspected[key] !== value) throw new Error('图片元数据与内容不一致')
  }
  return inspected
}

export function decodeImagePayload(payload) {
  if (!isRecord(payload)) throw new Error('图片请求必须是对象')
  if (!ALLOWED_IMAGE_TYPES.has(payload.mimeType)) throw new Error('图片仅支持 PNG、JPEG 或 WEBP')
  if (typeof payload.data !== 'string' || !payload.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.data) || payload.data.length % 4 !== 0) throw new Error('图片 data 必须是有效 base64')
  const buffer = Buffer.from(payload.data, 'base64')
  const inspected = inspectImageBuffer(buffer, payload.mimeType)
  if (payload.width !== inspected.width || payload.height !== inspected.height) throw new Error('图片宽高与实际内容不一致')
  return { buffer, mimeType: payload.mimeType, ...inspected }
}

export async function decodeAndValidateImagePayload(payload) {
  const image = decodeImagePayload(payload)
  await validateDecodedImage(image.buffer, image.mimeType, {
    sha256: image.sha256,
    width: image.width,
    height: image.height,
    byteLength: image.byteLength,
  })
  return image
}
