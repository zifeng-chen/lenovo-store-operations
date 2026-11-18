import { computed, ref } from 'vue'
import { api, createDebouncedUpdater } from '../api.js'
import { CATEGORIES, createDefaultCard, generateId, getTotalColorRows, normalizeCard } from '../types.js'
import { DEFAULT_SUBSIDY_CONFIG, calcSubsidyPrice, normalizeSubsidyConfig } from '../subsidy.js'

const cards = ref([])
const selectedIds = ref(new Set())
const activeId = ref('')
const searchQuery = ref('')
const loading = ref(true)
const saving = ref(false)
const subsidyConfig = ref({ ...DEFAULT_SUBSIDY_CONFIG })
const accessories = ref([])
const services = ref([])

let initialized = false
const updater = createDebouncedUpdater()

function persist(card) {
  if (!card?.id) return
  updater.write(card.id, card)
}

export function usePriceTagStore() {
  async function load() {
    loading.value = true
    try {
      const [cardList, accessoryList, serviceList, config] = await Promise.all([
        api.listCards(),
        api.accessories().catch(() => []),
        api.services().catch(() => []),
        api.subsidyConfig().catch(() => DEFAULT_SUBSIDY_CONFIG)
      ])
      cards.value = (cardList?.cards || []).map(normalizeCard)
      selectedIds.value = new Set(cardList?.selected || [])
      accessories.value = accessoryList || []
      services.value = serviceList || []
      subsidyConfig.value = normalizeSubsidyConfig(config)
      if (!activeId.value && cards.value.length) activeId.value = cards.value[0].id
    } finally {
      loading.value = false
      initialized = true
    }
  }

  function init() {
    if (!initialized) load()
  }

  const currentCard = computed(() => cards.value.find((card) => card.id === activeId.value) || null)

  const filteredCards = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    const list = query
      ? cards.value.filter((card) => (card.productTitle || '').toLowerCase().includes(query))
      : [...cards.value]
    return list.sort((a, b) => (a.productTitle || '').localeCompare(b.productTitle || '', 'zh-CN'))
  })

  const groupedCards = computed(() =>
    CATEGORIES.map((category) => ({
      category,
      items: filteredCards.value.filter((card) => card.category === category)
    }))
  )

  const selectedCards = computed(() => cards.value.filter((card) => selectedIds.value.has(card.id)))

  function selectCard(id) {
    activeId.value = id
  }

  function toggleSelect(id) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
    api.updateSelection([...next]).catch(() => undefined)
  }

  function selectAll() {
    selectedIds.value = new Set(cards.value.map((card) => card.id))
    api.updateSelection([...selectedIds.value]).catch(() => undefined)
  }

  function deselectAll() {
    selectedIds.value = new Set()
    api.updateSelection([]).catch(() => undefined)
  }

  async function addCard() {
    const draft = createDefaultCard()
    const created = await api.createCard(draft)
    const card = normalizeCard(created?.card || draft)
    cards.value.push(card)
    activeId.value = card.id
    toggleSelect(card.id)
    return card
  }

  async function deleteCard(id) {
    if (cards.value.length <= 1) return false
    await api.deleteCard(id)
    cards.value = cards.value.filter((card) => card.id !== id)
    if (activeId.value === id) activeId.value = cards.value[0]?.id || ''
    const next = new Set(selectedIds.value)
    next.delete(id)
    selectedIds.value = next
    return true
  }

  async function deleteSelected() {
    const removed = cards.value.filter((card) => selectedIds.value.has(card.id))
    if (!removed.length) return 0
    await Promise.all(removed.map((card) => api.deleteCard(card.id)))
    cards.value = cards.value.filter((card) => !selectedIds.value.has(card.id))
    if (!cards.value.some((card) => card.id === activeId.value)) {
      activeId.value = cards.value[0]?.id || ''
    }
    deselectAll()
    return removed.length
  }

  async function duplicateCard(id) {
    const source = cards.value.find((card) => card.id === id)
    if (!source) return null
    const clone = JSON.parse(JSON.stringify(source))
    clone.id = generateId()
    clone.productTitle = `复制 - ${source.productTitle || ''}`
    const created = await api.createCard(clone)
    const card = normalizeCard(created?.card || clone)
    cards.value.push(card)
    activeId.value = card.id
    return card
  }

  // 按当前生效的国补规则重算所有展牌
  async function recalcAllSubsidy() {
    const result = await api.recalcSubsidy()
    await load()
    return result?.changed || 0
  }

  return {
    cards,
    selectedIds,
    activeId,
    searchQuery,
    loading,
    saving,
    subsidyConfig,
    accessories,
    services,
    currentCard,
    filteredCards,
    groupedCards,
    selectedCards,
    load,
    init,
    selectCard,
    toggleSelect,
    selectAll,
    deselectAll,
    addCard,
    deleteCard,
    deleteSelected,
    duplicateCard,
    persist,
    recalcAllSubsidy,
    getTotalColorRows,
    calcSubsidyPrice
  }
}
