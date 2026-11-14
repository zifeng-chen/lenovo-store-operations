<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PrintActionBar from '@lenovo-store/shared/components/PrintActionBar.vue';
import PreviewPanel from './components/PreviewPanel.vue';
import ProductList from './components/ProductList.vue';
import { getProducts } from './api.js';

const PER_PAGE = 9;

// products 保留全量结果，仅用于维护选择有效性；displayedProducts 才是当前筛选下要渲染的列表。
const products = ref([]);
const displayedProducts = ref([]);
const selectedIds = ref([]);
const keyword = ref('');
const loading = ref(false);
const activeQuery = ref('');
let searchTimer;

// 按勾选顺序输出，用户点选顺序就是打印顺序。
const selectedProducts = computed(() =>
  selectedIds.value
    .map((id) => products.value.find((item) => item.id === id))
    .filter(Boolean)
);

const pages = computed(() => {
  const result = [];
  for (let index = 0; index < selectedProducts.value.length; index += PER_PAGE) {
    result.push(selectedProducts.value.slice(index, index + PER_PAGE));
  }
  return result;
});

const visibleIds = computed(() => displayedProducts.value.map((item) => item.id));
const allSelected = computed(() =>
  visibleIds.value.length > 0 && visibleIds.value.every((id) => selectedIds.value.includes(id))
);

function toggle(id) {
  const index = selectedIds.value.indexOf(id);
  if (index >= 0) selectedIds.value.splice(index, 1);
  else selectedIds.value.push(id);
}

function toggleAll() {
  if (allSelected.value) {
    const visible = new Set(visibleIds.value);
    selectedIds.value = selectedIds.value.filter((id) => !visible.has(id));
  } else {
    const existing = new Set(selectedIds.value);
    visibleIds.value.forEach((id) => {
      if (!existing.has(id)) selectedIds.value.push(id);
    });
  }
}

function clearSelection() {
  selectedIds.value = [];
}

async function load() {
  loading.value = true;
  try {
    const allItems = await getProducts();
    products.value = allItems;
    // 只按全量结果清理已删除的商品，筛选不能影响已勾选项。
    const valid = new Set(allItems.map((item) => item.id));
    selectedIds.value = selectedIds.value.filter((id) => valid.has(id));

    displayedProducts.value = activeQuery.value ? await getProducts(activeQuery.value) : allItems;
  } catch (error) {
    ElMessage.error(error.message || '加载商品失败');
  } finally {
    loading.value = false;
  }
}

function onKeywordInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    activeQuery.value = keyword.value.trim();
    load();
  }, 300);
}

function resetSearch() {
  keyword.value = '';
  activeQuery.value = '';
  load();
}

function printLabels() {
  if (!selectedProducts.value.length) {
    ElMessage.warning('请先勾选需要打印的商品');
    return;
  }
  window.print();
}

onMounted(load);
</script>

<template>
  <div class="app-shell ls-theme">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">出</span>
        <div>
          <h1>出样标签制作</h1>
          <p>A4 横向 3 × 3，每页 9 枚贴纸</p>
        </div>
      </div>
      <div class="header-stats">
        <span>已选 <b>{{ selectedProducts.length }}</b> 项</span>
        <span class="dot">·</span>
        <span><b>{{ pages.length }}</b> 页</span>
      </div>
    </header>

    <main class="main-content">
      <section class="left-panel">
        <div class="toolbar">
          <el-input
            v-model="keyword"
            clearable
            placeholder="搜索 SKU、名称或配置"
            @input="onKeywordInput"
            @clear="resetSearch"
          />
          <div class="toolbar-actions">
            <el-button @click="toggleAll">{{ allSelected ? '取消全选' : '全选' }}</el-button>
            <el-button :disabled="!selectedIds.length" @click="clearSelection">清空</el-button>
          </div>
        </div>

        <ProductList
          :products="displayedProducts"
          :selected-ids="selectedIds"
          :loading="loading"
          @toggle="toggle"
        />

        <PrintActionBar
          accent="#e60012"
          :count="selectedProducts.length"
          :pages="pages.length"
          unit="项"
          label="打印标签"
          @print="printLabels"
        />
      </section>

      <PreviewPanel :pages="pages" :total="selectedProducts.length" />
    </main>
  </div>
</template>
