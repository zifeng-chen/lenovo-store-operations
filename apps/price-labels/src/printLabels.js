import printStyles from './style.css?raw'

const PRINT_FRAME_ID = 'price-labels-print-frame'

async function waitForImages(documentRoot) {
  await Promise.all([...documentRoot.images].map(async (image) => {
    if (typeof image.decode === 'function') await image.decode()
    if (!image.complete || !image.naturalWidth) throw new Error('价格标签图片加载失败，请重试')
  }))
}

export async function printPriceLabelPages(source) {
  if (!source) throw new Error('打印内容尚未准备完成')

  document.getElementById(PRINT_FRAME_ID)?.remove()

  const frame = document.createElement('iframe')
  frame.id = PRINT_FRAME_ID
  frame.title = '周边货品价格标签打印'
  Object.assign(frame.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    right: '0',
    bottom: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.appendChild(frame)

  const printDocument = frame.contentDocument
  const base = printDocument.createElement('base')
  base.href = document.baseURI
  const style = printDocument.createElement('style')
  style.textContent = printStyles
  printDocument.head.append(base, style)
  printDocument.body.append(printDocument.importNode(source, true))

  let cleanupTimer
  const cleanup = () => {
    window.clearTimeout(cleanupTimer)
    frame.remove()
  }

  try {
    await printDocument.fonts?.ready
    await waitForImages(printDocument)
    await new Promise((resolve) => frame.contentWindow.requestAnimationFrame(resolve))
    frame.contentWindow.addEventListener('afterprint', cleanup, { once: true })
    cleanupTimer = window.setTimeout(cleanup, 120000)
    frame.contentWindow.focus()
    frame.contentWindow.print()
  } catch (error) {
    cleanup()
    throw error
  }
}
