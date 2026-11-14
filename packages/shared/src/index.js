export const STORE_MODULES = Object.freeze([
  {
    id: 'computer-labels',
    name: '仓库货品标签',
    shortName: '仓库货品标签',
    iconText: '仓',
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
    name: '周边货品价签',
    shortName: '周边货品价签',
    iconText: '周',
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
    name: '付款凭证打印',
    shortName: '付款凭证打印',
    iconText: '收',
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
    name: '员工工牌制作',
    shortName: '员工工牌制作',
    iconText: '员',
    description: '录入多名员工的姓名、岗位和二维码，生成 54mm × 85mm 工牌并按 A4 横向批量打印。',
    route: '/employee-badges',
    moduleBase: '/modules/employee-badges/',
    apiBase: null,
    persistence: 'none',
    accent: '#d2382f',
    stage: 'ready'
  },
  {
    id: 'sample-labels',
    name: '出样标签打印',
    shortName: '出样标签',
    iconText: '样',
    description: '按 A4 横向 3 × 3 打印设备出样贴纸，SKU 与机型取自仓库货品。',
    route: '/sample-labels',
    moduleBase: '/modules/sample-labels/',
    apiBase: null,
    persistence: 'none',
    accent: '#e60012',
    stage: 'ready'
  },
  {
    id: 'sales-report',
    name: '销售业绩报表',
    shortName: '销售业绩报表',
    iconText: '销',
    description: '查看销售趋势与月度、季度、年度业绩对比，数据来自付款凭证打印的销售明细。',
    route: '/sales-report',
    moduleBase: '/modules/sales-report/',
    apiBase: '/api/sales-report',
    persistence: 'none',
    accent: '#1a5e9c',
    stage: 'migrated'
  }
]);

export function findStoreModule(moduleId) {
  return STORE_MODULES.find((item) => item.id === moduleId) ?? null;
}
