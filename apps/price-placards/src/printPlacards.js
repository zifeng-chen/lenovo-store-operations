import frozenStyles from './frozen-placard.css?raw'
import printStyles from './print.css?raw'
import { hasUnexpectedPlacardOverflow } from './placardOverflow.js'

const FRAME_ID = 'price-placards-print-frame'

async function waitForImages(root) {
  await Promise.all([...root.images].map(async (image) => {
    if (typeof image.decode === 'function') await image.decode()
    if (!image.complete || !image.naturalWidth) throw new Error('打印图片加载失败，请检查图片后重试')
  }))
}

function hasOverflow(root) {
  return [...root.querySelectorAll('.card')].some(hasUnexpectedPlacardOverflow)
}

export async function printPlacards(source) {
  if (!source) throw new Error('打印内容尚未准备完成')
  document.getElementById(FRAME_ID)?.remove()
  const frame = document.createElement('iframe')
  frame.id = FRAME_ID
  frame.title = '价格立牌打印'
  Object.assign(frame.style, { position: 'fixed', width: '1px', height: '1px', right: '0', bottom: '0', border: '0', opacity: '0', pointerEvents: 'none' })
  document.body.appendChild(frame)
  const printDocument = frame.contentDocument
  const base = printDocument.createElement('base')
  base.href = document.baseURI
  const style = printDocument.createElement('style')
  style.textContent = `${frozenStyles}\n${printStyles}`
  printDocument.head.append(base, style)
  printDocument.body.append(printDocument.importNode(source, true))
  let cleanupTimer
  const cleanup = () => { window.clearTimeout(cleanupTimer); frame.remove() }
  try {
    await printDocument.fonts?.ready
    await waitForImages(printDocument)
    await new Promise((resolve) => frame.contentWindow.requestAnimationFrame(resolve))
    if (hasOverflow(printDocument)) throw new Error('打印 iframe 中存在实际溢出的成品，已阻止打印')
    frame.contentWindow.addEventListener('afterprint', cleanup, { once: true })
    cleanupTimer = window.setTimeout(cleanup, 120000)
    frame.contentWindow.focus()
    frame.contentWindow.print()
  } catch (error) { cleanup(); throw error }
}
