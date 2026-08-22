import printStyles from './print.css?raw';

const PRINT_FRAME_ID = 'employee-badge-print-frame';

function waitForImages(documentRoot) {
  return Promise.all([...documentRoot.images].map(async (image) => {
    if (typeof image.decode === 'function') await image.decode();
    if (!image.complete || !image.naturalWidth) throw new Error('工牌图片加载失败，请重新上传后再试');
  }));
}

export async function printBadgePages(source) {
  if (!source) throw new Error('打印内容尚未准备完成');

  document.getElementById(PRINT_FRAME_ID)?.remove();

  const frame = document.createElement('iframe');
  frame.id = PRINT_FRAME_ID;
  frame.title = '员工工牌打印';
  frame.style.position = 'fixed';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
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
    await waitForImages(printDocument);
    frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
    cleanupTimer = window.setTimeout(cleanup, 120000);
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
