const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_ORIGINAL = 5 * 1024 * 1024
const MAX_COPY = 1024 * 1024
const MAX_EDGE = 1200

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法解码')) }
    image.src = url
  })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export async function processImage(file) {
  if (!TYPES.has(file?.type)) throw new Error('仅支持 PNG、JPEG 或 WEBP 图片')
  if (!file.size || file.size > MAX_ORIGINAL) throw new Error('原图不能超过 5MB')
  const image = await loadImage(file)
  let scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  let width = Math.max(1, Math.round(image.naturalWidth * scale))
  let height = Math.max(1, Math.round(image.naturalHeight * scale))
  let quality = 0.92
  const outputType = file.type === 'image/png' ? 'image/webp' : file.type

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: outputType !== 'image/jpeg' })
    if (!context) throw new Error('当前浏览器不支持 Canvas 图片处理')
    if (outputType === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height) }
    context.drawImage(image, 0, 0, width, height)
    const blob = await canvasBlob(canvas, outputType, quality)
    if (!blob) throw new Error('图片处理失败')
    if (blob.size <= MAX_COPY) {
      const dataUrl = await toDataUrl(blob)
      return { mimeType: outputType, width, height, byteLength: blob.size, data: dataUrl.split(',')[1] }
    }
    if (quality > 0.52 && outputType !== 'image/png') quality -= 0.1
    else { width = Math.max(1, Math.floor(width * 0.85)); height = Math.max(1, Math.floor(height * 0.85)); quality = 0.82 }
  }
  throw new Error('图片无法处理到 1MB 以内，请选择更简单或更小的图片')
}
