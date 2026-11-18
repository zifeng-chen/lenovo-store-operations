<script setup>
import { computed, onMounted, ref } from 'vue'
import { usePriceTagStore } from './stores/usePriceTagStore.js'
import { CATEGORIES } from './types.js'
import CardListPanel from './components/CardListPanel.vue'
import CardEditorPanel from './components/CardEditorPanel.vue'
import CardPreviewPanel from './components/CardPreviewPanel.vue'

const store = usePriceTagStore()
const toast = ref({ visible: false, message: '', type: 'success' })
let toastTimer

function notify(message, type = 'success') {
  const text = message && typeof message === 'object' ? message.message : message
  const level = message && typeof message === 'object' ? (message.type || type) : type
  clearTimeout(toastTimer)
  toast.value = { visible: true, message: text, type: level }
  toastTimer = setTimeout(() => { toast.value.visible = false }, 2600)
}

const expandedCategory = ref('笔记本')
const selectedCount = computed(() => store.selectedIds.value.size)
const previewCards = computed(() => {
  const ids = new Set(store.selectedIds.value)
  if (store.activeId.value) ids.add(store.activeId.value)
  return store.cards.value.filter((card) => ids.has(card.id))
})

async function handleCreate() {
  try {
    await store.addCard()
    notify('已新建展牌')
  } catch (error) {
    notify(error.message, 'error')
  }
}

async function handleDelete(id) {
  try {
    const ok = await store.deleteCard(id)
    if (!ok) notify('至少保留一张展牌', 'error')
    else notify('已删除')
  } catch (error) {
    notify(error.message, 'error')
  }
}

async function handleDuplicate(id) {
  try {
    await store.duplicateCard(id)
    notify('已复制展牌')
  } catch (error) {
    notify(error.message, 'error')
  }
}

async function handleDeleteSelected() {
  if (!selectedCount.value) return
  if (!window.confirm(`确定要删除选中的 ${selectedCount.value} 张展牌吗？`)) return
  try {
    const count = await store.deleteSelected()
    notify(`已删除 ${count} 张展牌`)
  } catch (error) {
    notify(error.message, 'error')
  }
}

function handlePrint() {
  if (!selectedCount.value) {
    notify('请先勾选需要打印的展牌', 'error')
    return
  }
  window.print()
}

function handleServiceChange({ type, row }) {
  if (type === 'create') store.services.value = [...store.services.value, row]
  else if (type === 'update') {
    store.services.value = store.services.value.map((item) => (item.id === row.id ? row : item))
  } else if (type === 'delete') {
    store.services.value = store.services.value.filter((item) => item.id !== row.id)
  }
}

onMounted(() => {
  store.load().catch((error) => notify(error.message, 'error'))
})
</script>

<template>
  <div class="tag-app">
    <div class="tag-stage">
      <CardListPanel
        class="col-list"
        :grouped-cards="store.groupedCards.value"
        :active-id="store.activeId.value"
        :selected-ids="store.selectedIds.value"
        :search-query="store.searchQuery.value"
        :expanded-category="expandedCategory"
        :total-count="store.cards.value.length"
        :selected-count="selectedCount"
        @update:search-query="store.searchQuery.value = $event"
        @update:expanded-category="expandedCategory = $event"
        @select="store.selectCard"
        @toggle-select="store.toggleSelect"
        @select-all="store.selectAll()"
        @deselect-all="store.deselectAll()"
        @create="handleCreate"
        @delete="handleDelete"
        @duplicate="handleDuplicate"
        @delete-selected="handleDeleteSelected"
        @print="handlePrint"
      />

      <CardEditorPanel
        class="col-editor"
        :card="store.currentCard.value"
        :subsidy-config="store.subsidyConfig.value"
        :accessories="store.accessories.value"
        :services="store.services.value"
        :categories="CATEGORIES"
        @change="store.persist"
        @notify="notify"
        @update-service="handleServiceChange"
      />

      <CardPreviewPanel
        class="col-preview"
        :cards="previewCards"
        :active-id="store.activeId.value"
      />
    </div>

    <div v-if="toast.visible" class="tag-toast" :class="toast.type">{{ toast.message }}</div>
  </div>
</template>

<style scoped>
.tag-app { height: 100vh; display: flex; flex-direction: column; background: #eef2f7; }
.tag-stage {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 258px minmax(0, 3fr) minmax(0, 4fr);
  gap: 12px;
  padding: 14px;
}
.col-list, .col-editor, .col-preview { min-height: 0; }
.tag-toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  padding: 9px 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  background: rgba(22,35,55,.94); color: #fff; box-shadow: 0 10px 28px rgba(0,0,0,.26); z-index: 999;
}
.tag-toast.error { background: #b42318; }

@media (max-width: 1440px) {
  .tag-stage { grid-template-columns: 238px minmax(0, 3fr) minmax(0, 4fr); }
}
@media (max-width: 1280px) {
  .tag-stage { grid-template-columns: 210px minmax(0, 3fr) minmax(0, 4fr); }
}
</style>
