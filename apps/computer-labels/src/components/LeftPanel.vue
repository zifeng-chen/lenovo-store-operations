<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import PrintActionBar from '@lenovo-store/shared/components/PrintActionBar.vue';

const props = defineProps({
  products: { type: Array, default: () => [] },
  selectedIds: { type: Set, required: true },
  quantities: { type: Object, required: true },
  stockDates: { type: Object, default: () => ({}) },
  loading: Boolean,
  selectedCount: { type: Number, default: 0 },
  labelCount: { type: Number, default: 0 },
  pageCount: { type: Number, default: 0 }
});
const emit = defineEmits([
  'search', 'reset-search', 'create', 'copy', 'edit', 'delete', 'batch-delete',
  'toggle-one', 'toggle-visible', 'quantity-change', 'stock-date-change', 'import', 'export',
  'backup', 'restore', 'print'
]);

const keyword = ref('');
const importInput = ref();
const restoreInput = ref();
let searchTimer;

const visibleIds = computed(() => props.products.map((item) => item.id));
const selectedVisibleCount = computed(() => visibleIds.value.filter((id) => props.selectedIds.has(id)).length);
const allVisibleSelected = computed(() => props.products.length > 0 && selectedVisibleCount.value === props.products.length);
const partiallySelected = computed(() => selectedVisibleCount.value > 0 && !allVisibleSelected.value);

watch(keyword, (value) => {
  clearTimeout(searchTimer);
  const normalized = value.trim();
  if (!normalized) {
    emit('reset-search');
    return;
  }
  searchTimer = setTimeout(() => emit('search', normalized), 300);
});

onBeforeUnmount(() => clearTimeout(searchTimer));

function submitSearch() {
  clearTimeout(searchTimer);
  const normalized = keyword.value.trim();
  if (normalized) emit('search', normalized);
  else emit('reset-search');
}

function clearSearch() {
  if (!keyword.value) emit('reset-search');
  keyword.value = '';
}

function chooseImport() {
  importInput.value?.click();
}

function chooseRestore() {
  restoreInput.value?.click();
}

function fileSelected(event, type) {
  const file = event.target.files?.[0];
  if (file) emit(type, file);
  event.target.value = '';
}
</script>

<template>
  <section class="left-panel">
    <div class="toolbar">
      <div class="search-row">
        <el-input v-model="keyword" clearable placeholder="输入 SKU、名称、配置或日期后自动筛选" @keyup.enter="submitSearch" />
        <el-button type="primary" @click="submitSearch">搜索</el-button>
        <el-button @click="clearSearch">清空</el-button>
      </div>
      <div class="action-row">
        <el-button type="primary" @click="emit('create')">新增商品</el-button>
        <el-button @click="chooseImport">导入 Excel</el-button>
        <el-button @click="emit('export')">导出 Excel</el-button>
        <el-button @click="emit('backup')">备份数据</el-button>
        <el-button @click="chooseRestore">恢复数据</el-button>
        <el-button type="danger" plain :disabled="selectedCount === 0" @click="emit('batch-delete')">批量删除</el-button>
        <input ref="importInput" hidden type="file" accept=".xlsx,.xls" @change="fileSelected($event, 'import')" />
        <input ref="restoreInput" hidden type="file" accept=".db" @change="fileSelected($event, 'restore')" />
      </div>
      <div v-if="products.length" class="select-row">
        <el-checkbox
          :model-value="allVisibleSelected"
          :indeterminate="partiallySelected"
          @change="emit('toggle-visible', visibleIds, $event)"
        >全选本页</el-checkbox>
        <span class="select-hint">已选 {{ selectedVisibleCount }} / {{ products.length }}</span>
      </div>
    </div>

    <div class="card-list-wrap" v-loading="loading">
      <div v-if="!products.length" class="card-empty">暂无商品数据</div>
      <div v-else class="card-grid">
        <article
          v-for="row in products"
          :key="row.id"
          :class="['product-card', { selected: selectedIds.has(row.id) }]"
        >
          <div class="card-body">
            <div class="card-head">
              <el-checkbox
                :model-value="selectedIds.has(row.id)"
                :aria-label="`选择 ${row.name}`"
                @change="emit('toggle-one', row.id, $event)"
              />
              <span class="card-color" :class="{ empty: !row.color }">{{ row.color || '—' }}</span>
            </div>
            <div class="card-sku">SKU: {{ row.sku }}</div>
            <div class="card-name" :title="row.name">{{ row.name }}</div>
            <div class="card-config" :title="row.config || ''">{{ row.config || '—' }}</div>
          </div>

          <div class="card-edit">
            <label class="card-field">
              <span class="card-field-label">数量</span>
              <el-input-number
                :model-value="quantities[row.id] || 1"
                :min="1"
                :max="999"
                :step="1"
                size="small"
                controls-position="right"
                class="card-qty"
                @update:model-value="emit('quantity-change', row.id, $event)"
              />
            </label>
            <label class="card-field">
              <span class="card-field-label">入库</span>
              <el-date-picker
                :model-value="stockDates[row.id] || row.added_date || ''"
                type="date"
                value-format="YYYY-MM-DD"
                format="YYYY-MM-DD"
                size="small"
                placeholder="选择日期"
                :clearable="false"
                class="card-date"
                @update:model-value="emit('stock-date-change', row.id, $event)"
              />
            </label>
          </div>

          <div class="card-divider"></div>
          <div class="card-ops">
            <el-button link type="primary" @click="emit('copy', row)">复制</el-button>
            <el-button link type="primary" @click="emit('edit', row)">编辑</el-button>
            <el-button link type="danger" @click="emit('delete', row)">删除</el-button>
          </div>
        </article>
      </div>
    </div>

    <PrintActionBar
      accent="#1a5e9c"
      :count="labelCount"
      :pages="pageCount"
      unit="项"
      label="打印标签"
      show-preview
      @print="emit('print')"
      @preview="emit('print')"
    />
  </section>
</template>
