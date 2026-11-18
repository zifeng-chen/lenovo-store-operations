export const CATEGORIES = ['笔记本', '手机', '平板', '台式机']

export const DEFAULT_CATEGORY = '笔记本'

export const MAX_FEATURES = 4
export const MIN_FEATURES = 3
export const MAX_COLOR_ROWS = 6

export function generateId() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
}

export function createDefaultCard() {
  return {
    id: generateId(),
    productTitle: '新建展牌',
    category: DEFAULT_CATEGORY,
    showProductImage: true,
    features: [
      { title: '', desc: '', iconType: 'builtin', iconName: '', iconSrc: '', iconSize: 100, linkedCopy: '' },
      { title: '', desc: '', iconType: 'builtin', iconName: '', iconSrc: '', iconSize: 100, linkedCopy: '' },
      { title: '', desc: '', iconType: 'builtin', iconName: '', iconSrc: '', iconSize: 100, linkedCopy: '' }
    ],
    products: [{ config: '', colors: [{ name: '', price: 0 }] }],
    showAccessory: true,
    accessory1Name: '',
    accessory1Price: 0,
    accessory2Name: '',
    accessory2Price: 0,
    serviceTitle: '想帮帮',
    service1Name: '',
    service1Price: 0,
    service2Name: '',
    service2Price: 0,
    priceRowSpacing: 0
  }
}

export function normalizeCard(card) {
  const category = CATEGORIES.includes(card?.category) ? card.category : DEFAULT_CATEGORY
  return {
    ...createDefaultCard(),
    ...card,
    category,
    features: Array.isArray(card?.features) && card.features.length ? card.features : createDefaultCard().features,
    products: Array.isArray(card?.products) && card.products.length ? card.products : createDefaultCard().products
  }
}

export function getTotalColorRows(card) {
  return (card?.products || []).reduce((sum, product) => sum + (product.colors?.length || 0), 0)
}
