<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  products: { type: Array, default: () => [] },
  selectedIds: { type: Set, required: true },
  quantities: { type: Object, required: true },
  loading: Boolean,
  selectedCount: { type: Number, default: 0 },
  labelCount: { type: Number, default: 0 },
  pageCount: { type: Number, default: 0 }
});
const emit = defineEmits([
  'search', 'reset-search', 'create', 'copy', 'edit', 'delete', 'batch-delete',
  'toggle-one', 'toggle-visible', 'quantity-change', 'import', 'export',
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
        <el-input v-model="keyword" clearable placeholder="输入 SKU、名称或配置后自动筛选" @keyup.enter="submitSearch" />
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
    </div>

    <div class="table-wrap">
      <el-table :data="products" height="100%" v-loading="loading" row-key="id" empty-text="暂无商品数据">
        <el-table-column width="44" align="center">
          <template #header>
            <el-checkbox
              :model-value="allVisibleSelected"
              :indeterminate="partiallySelected"
              aria-label="选择当前列表全部商品"
              @change="emit('toggle-visible', visibleIds, $event)"
            />
          </template>
          <template #default="{ row }">
            <el-checkbox
              :model-value="selectedIds.has(row.id)"
              :aria-label="`选择 ${row.name}`"
              @change="emit('toggle-one', row.id, $event)"
            />
          </template>
        </el-table-column>
        <el-table-column label="SKU" prop="sku" width="90">
          <template #default="{ row }"><code class="sku-code">{{ row.sku }}</code></template>
        </el-table-column>
        <el-table-column label="商品名称" prop="name" min-width="120" show-overflow-tooltip />
        <el-table-column label="配置" prop="config" min-width="170" show-overflow-tooltip>
          <template #default="{ row }"><span class="config-cell">{{ row.config || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="颜色" prop="color" width="90" align="center">
          <template #default="{ row }"><span :class="['color-pill', { empty: !row.color }]">{{ row.color || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="数量" width="112" align="center">
          <template #default="{ row }">
            <el-input-number
              :model-value="quantities[row.id] || 1"
              :min="1"
              :max="999"
              :step="1"
              size="small"
              controls-position="right"
              @update:model-value="emit('quantity-change', row.id, $event)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="148" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="emit('copy', row)">复制</el-button>
            <el-button link type="primary" @click="emit('edit', row)">编辑</el-button>
            <el-button link type="danger" @click="emit('delete', row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <footer class="footer-bar">
      <div class="footer-stats">
        <span>已选 <b>{{ selectedCount }}</b> 项</span>
        <span>标签 <b>{{ labelCount }}</b> 个</span>
        <span>{{ pageCount }} 页</span>
      </div>
      <el-button type="primary" size="large" :disabled="labelCount === 0" @click="emit('print')">打印标签</el-button>
    </footer>
  </section>
</template>
