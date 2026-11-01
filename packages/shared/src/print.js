/**
 * 隔离 iframe 打印：把待打印节点克隆进一个隐藏 iframe，
 * 等字体和图片就绪后在 iframe 内打印，避免宿主页面的样式和滚动状态影响分页。
 */

async function waitForImages(documentRoot, failureMessage) {
  await Promise.all([...documentRoot.images].map(async (image) => {
    if (typeof image.decode === 'function') await image.decode();
    if (!image.complete || !image.naturalWidth) throw new Error(failureMessage);
  }));
}

const FRAME_STYLE = {
  position: 'fixed',
  width: '1px',
  height: '1px',
  right: '0',
  bottom: '0',
  border: '0',
  opacity: '0',
  pointerEvents: 'none'
};

export async function printInIsolatedFrame(source, options = {}) {
  const {
    frameId,
    title,
    printStyles,
    imageFailureMessage = '打印图片加载失败，请重试',
    beforePrint,
    cleanupTimeoutMs = 120000
  } = options;

  if (!source) throw new Error('打印内容尚未准备完成');
  if (!frameId) throw new Error('打印 iframe 标识缺失');

  document.getElementById(frameId)?.remove();

  const frame = document.createElement('iframe');
  frame.id = frameId;
  if (title) frame.title = title;
  Object.assign(frame.style, FRAME_STYLE);
  document.body.appendChild(frame);

  const printDocument = frame.contentDocument;
  const base = printDocument.createElement('base');
  base.href = document.baseURI;
  const style = printDocument.createElement('style');
  style.textContent = printStyles;
  printDocument.head.append(base, style);
  printDocument.body.append(printDocument.importNode(source, true));

  let cleanupTimer;
  const cleanup = () => {
    window.clearTimeout(cleanupTimer);
    frame.remove();
  };

  try {
    await printDocument.fonts?.ready;
    await waitForImages(printDocument, imageFailureMessage);
    await new Promise((resolve) => frame.contentWindow.requestAnimationFrame(resolve));
    if (typeof beforePrint === 'function') beforePrint(printDocument);
    frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
    cleanupTimer = window.setTimeout(cleanup, cleanupTimeoutMs);
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
