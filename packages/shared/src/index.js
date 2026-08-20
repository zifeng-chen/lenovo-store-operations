export const STORE_MODULES = Object.freeze([
  {
    id: 'computer-labels',
    name: '电脑商品标签',
    shortName: '电脑标签',
    description: '管理电脑 SKU、名称、配置和颜色，打印 46mm × 45mm 商品标签。',
    route: '/computer-labels',
    moduleBase: '/modules/computer-labels/',
    apiBase: '/api/computer-labels',
    sourceProject: 'Lenovo Store Label Printer System',
    accent: '#1a5e9c',
    stage: 'migrated'
  },
  {
    id: 'price-labels',
    name: '商品价格标签',
    shortName: '价格标签',
    description: '管理电脑、手机、平板及周边商品价格，打印 70mm × 28mm 价格标签。',
    route: '/price-labels',
    moduleBase: '/modules/price-labels/',
    apiBase: '/api/price-labels',
    sourceProject: 'lenovo-price-label',
    accent: '#c62828',
    stage: 'migrated'
  },
  {
    id: 'receipt-assistant',
    name: '付款凭证打印',
    shortName: '付款凭证',
    description: '将商务存根和购物小票排版到同一张 A4 纸，并辅助识别付款金额。',
    route: '/receipt-assistant',
    moduleBase: '/modules/receipt-assistant/',
    apiBase: '/api/receipt-assistant',
    sourceProject: 'Lenovo POS System',
    accent: '#805ad5',
    stage: 'migrated'
  }
]);

export function findStoreModule(moduleId) {
  return STORE_MODULES.find((item) => item.id === moduleId) ?? null;
}
