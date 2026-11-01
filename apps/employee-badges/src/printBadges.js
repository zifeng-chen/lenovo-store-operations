import printStyles from './print.css?raw';
import { printInIsolatedFrame } from '@lenovo-store/shared/print';

const PRINT_FRAME_ID = 'employee-badge-print-frame';

export async function printBadgePages(source) {
  return printInIsolatedFrame(source, {
    frameId: PRINT_FRAME_ID,
    title: '员工工牌打印',
    printStyles,
    imageFailureMessage: '工牌图片加载失败，请重新上传后再试'
  });
}
