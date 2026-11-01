import printStyles from './style.css?raw'
import { printInIsolatedFrame } from '@lenovo-store/shared/print'

const PRINT_FRAME_ID = 'price-labels-print-frame'

export async function printPriceLabelPages(source) {
  return printInIsolatedFrame(source, {
    frameId: PRINT_FRAME_ID,
    title: '周边货品价格标签打印',
    printStyles,
    imageFailureMessage: '价格标签图片加载失败，请重试',
  })
}
