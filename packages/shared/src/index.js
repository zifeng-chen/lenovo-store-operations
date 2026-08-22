export const STORE_MODULES = Object.freeze([
  {
    id: 'computer-labels',
    name: '联想电脑商品标签',
    shortName: '联想电脑标签',
    iconText: '电',
    description: '管理电脑 SKU、名称、配置和颜色，打印 46mm × 45mm 商品标签。',
    route: '/computer-labels',
    moduleBase: '/modules/computer-labels/',
    apiBase: '/api/computer-labels',
    persistence: 'sqlite',
    accent: '#1a5e9c',
    stage: 'migrated'
  },
  {
    id: 'price-labels',
    name: '联想商品价格标签',
    shortName: '联想价格标签',
    iconText: '价',
    description: '管理电脑、手机、平板及周边商品价格，打印 70mm × 28mm 价格标签。',
    route: '/price-labels',
    moduleBase: '/modules/price-labels/',
    apiBase: '/api/price-labels',
    persistence: 'sqlite',
    accent: '#d2382f',
    stage: 'migrated'
  },
  {
    id: 'receipt-assistant',
    name: '联想付款凭证',
    shortName: '联想付款凭证',
    iconText: '付',
    description: '将商务存根和购物小票排版到同一张 A4 纸，并辅助识别付款金额。',
    route: '/receipt-assistant',
    moduleBase: '/modules/receipt-assistant/',
    apiBase: '/api/receipt-assistant',
    persistence: 'sqlite',
    accent: '#1a5e9c',
    stage: 'migrated'
  },
  {
    id: 'employee-badges',
    name: '联想员工工牌',
    shortName: '联想员工工牌',
    iconText: '员',
    description: '录入多名员工的姓名、岗位和二维码，生成 54mm × 85mm 工牌并按 A4 横向批量打印。',
    route: '/employee-badges',
    moduleBase: '/modules/employee-badges/',
    apiBase: null,
    persistence: 'none',
    accent: '#d2382f',
    stage: 'ready'
  }
]);

export function findStoreModule(moduleId) {
  return STORE_MODULES.find((item) => item.id === moduleId) ?? null;
}
