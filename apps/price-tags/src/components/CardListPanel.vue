<script setup>
import { computed } from 'vue'

const props = defineProps({
  groupedCards: { type: Array, required: true },
  activeId: { type: String, default: '' },
  selectedIds: { type: Set, required: true },
  searchQuery: { type: String, default: '' },
  expandedCategory: { type: String, default: '笔记本' },
  totalCount: { type: Number, default: 0 },
  selectedCount: { type: Number, default: 0 }
})

const emit = defineEmits([
  'update:searchQuery', 'update:expandedCategory', 'select', 'toggle-select',
  'select-all', 'deselect-all', 'create', 'delete', 'duplicate', 'delete-selected', 'print'
])

const expandedItems = computed(() =>
  props.groupedCards.find((group) => group.category === props.expandedCategory)?.items || []
)
const pinnedGroups = computed(() =>
  props.groupedCards.filter((group) => group.category !== props.expandedCategory)
)
const allSelected = computed(() =>
  props.totalCount > 0 && props.selectedCount === props.totalCount
)
const activeCount = computed(() =>
  expandedItems.value.filter((card) => props.selectedIds.has(card.id)).length
)

function rowCount(card) {
  return (card.products || []).reduce((sum, product) => sum + (product.colors?.length || 0), 0)
}
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2>展牌管理</h2>
      <small>共 {{ totalCount }} 张</small>
    </header>

    <div class="search-wrap">
      <input
        class="search-input"
        :value="searchQuery"
        placeholder="搜索产品名称…"
        @input="emit('update:searchQuery', $event.target.value)"
      />
    </div>

    <div class="list">
      <button
        class="group-head"
        :class="{ open: expandedCategory }"
        @click="emit('update:expandedCategory', expandedCategory ? '' : '笔记本')"
      >
        <span class="arrow">▾</span>
        <span>{{ expandedCategory || '全部分类' }}</span>
        <span class="count">{{ activeCount }}/{{ expandedItems.length }}</span>
      </button>

      <div
        v-for="card in expandedItems"
        :key="card.id"
        class="item"
        :class="{ 'is-active': card.id === activeId, 'is-checked': selectedIds.has(card.id) }"
        @click="emit('select', card.id)"
      >
        <span
          class="item-check"
          role="checkbox"
          :aria-checked="selectedIds.has(card.id)"
          @click.stop="emit('toggle-select', card.id)"
        ></span>
        <div class="item-body">
          <div class="item-name">{{ card.productTitle || '未命名' }}</div>
          <div class="item-meta">{{ rowCount(card) }} 行价格</div>
        </div>
        <div class="item-actions">
          <button class="icon-btn" title="复制" @click.stop="emit('duplicate', card.id)">⧉</button>
          <button class="icon-btn danger" title="删除" @click.stop="emit('delete', card.id)">✕</button>
        </div>
      </div>

      <p v-if="!expandedItems.length" class="empty">该分类下暂无展牌</p>

      <button
        v-for="group in pinnedGroups"
        :key="group.category"
        class="group-head pinned"
        @click="emit('update:expandedCategory', group.category)"
      >
        <span class="arrow">▸</span>
        <span>{{ group.category }}</span>
        <span class="count">{{ group.items.length }}</span>
      </button>
    </div>

    <footer class="list-foot">
      <div class="foot-row">
        <button class="btn btn-sm" @click="allSelected ? emit('deselect-all') : emit('select-all')">
          {{ allSelected ? '取消全选' : '全选' }}
        </button>
        <button class="btn btn-sm" @click="emit('create')">＋ 新建</button>
      </div>
      <div class="foot-row">
        <button class="btn btn-sm btn-danger" :disabled="!selectedCount" @click="emit('delete-selected')">
          删除选中（{{ selectedCount }}）
        </button>
      </div>
      <button class="btn btn-primary" :disabled="!selectedCount" @click="emit('print')">
        打印选中（{{ selectedCount }}）
      </button>
    </footer>
  </section>
</template>

<style scoped>
.panel {
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--line); border-radius: 12px;
  background: #fff; box-shadow: 0 6px 18px rgba(30,48,72,.06);
}
.panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 13px; border-bottom: 1px solid var(--line); background: #f7f9fc;
}
.panel-head h2 { margin: 0; font-size: 12.5px; }
.panel-head small { color: var(--muted); font-size: 10.5px; }

.search-wrap { padding: 9px 11px; border-bottom: 1px solid var(--line); }
.search-input {
  width: 100%; height: 31px; padding: 0 11px; border: 1px solid var(--line);
  border-radius: 999px; background: #f7f9fc; font-size: 12px; outline: none;
}
.search-input:focus { border-color: #9cc0e0; background: #fff; }

.list { flex: 1; overflow-y: auto; min-height: 0; }

.group-head {
  width: 100%; display: flex; align-items: center; gap: 7px; padding: 8px 12px;
  border: 0; border-bottom: 1px solid var(--line); background: #f7f9fc;
  font-size: 12px; font-weight: 700; color: #33404f; cursor: pointer; text-align: left;
}
.group-head:hover { background: #f1f5fa; }
.group-head.pinned { color: #5a6b80; }
.group-head .arrow { font-size: 9px; color: #8a97a8; }
.group-head .count {
  margin-left: auto; padding: 1px 6px; border-radius: 20px;
  background: #e8eef6; color: #5a6b80; font-size: 10px; font-weight: 700;
}

.item {
  display: flex; align-items: center; gap: 8px; padding: 8px 11px;
  border-bottom: 1px solid #f0f3f8; cursor: pointer;
}
.item:hover { background: #f7fafd; }
.item.is-active { background: #eaf2f9; border-left: 3px solid var(--blue); padding-left: 8px; }

.item-check {
  width: 14px; height: 14px; flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid #c3cfdd; border-radius: 4px; background: #fff;
  position: relative; cursor: pointer; box-sizing: border-box;
  transition: background .15s, border-color .15s;
}
.item-check:hover { border-color: var(--blue); }
.item.is-checked .item-check { background: var(--blue); border-color: var(--blue); }
.item.is-checked .item-check::after {
  content: ""; width: 4px; height: 7px;
  border: solid #fff; border-width: 0 1.6px 1.6px 0;
  transform: translateY(-1px) rotate(45deg);
}

.item-body { min-width: 0; flex: 1; }
.item-name {
  font-size: 12px; font-weight: 600; color: #1a1a1a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.item-meta { margin-top: 1px; color: #999; font-size: 10px; }

.item-actions { display: flex; gap: 1px; opacity: 0; transition: opacity .15s; }
.item:hover .item-actions { opacity: 1; }
.icon-btn {
  width: 21px; height: 21px; display: grid; place-items: center;
  border: 0; border-radius: 5px; background: transparent; color: #8a97a8;
  font-size: 11px; cursor: pointer;
}
.icon-btn:hover { background: #eef3f9; color: var(--blue); }
.icon-btn.danger:hover { background: #fdf0ef; color: #b42318; }

.empty { margin: 0; padding: 22px 0; text-align: center; color: #ccc; font-size: 12px; }

.list-foot {
  display: grid; gap: 6px; padding: 9px 10px;
  border-top: 1px solid var(--line); background: #f7f9fc;
}
.foot-row { display: flex; gap: 6px; }
.foot-row .btn { flex: 1; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 6px 13px; border: 1px solid #ddd; border-radius: 6px;
  background: #fff; color: #555; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: .16s;
}
.btn:hover:not(:disabled) { border-color: var(--blue); color: var(--blue); background: #f4f9fe; }
.btn-sm { padding: 5px 10px; font-size: 11.5px; }
.btn-primary { background: var(--blue); border-color: var(--blue); color: #fff; }
.btn-primary:hover:not(:disabled) { background: #124a7a; border-color: #124a7a; color: #fff; }
.btn-danger { color: #b42318; border-color: #f0c9c6; }
.btn:disabled { cursor: not-allowed; }
.btn-primary:disabled {
  background: #dfe7f0; border-color: #c3cfdd; color: #5c6f85;
}
</style>
