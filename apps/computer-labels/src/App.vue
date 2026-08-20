<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import AppHeader from './components/AppHeader.vue';
import LeftPanel from './components/LeftPanel.vue';
import PreviewPanel from './components/PreviewPanel.vue';
import ProductModal from './components/ProductModal.vue';
import {
  backupDatabase,
  batchDeleteProducts,
  createProduct,
  deleteProduct,
  exportProducts,
  getProducts,
  importProducts,
  restoreDatabase,
  updateProduct
} from './api.js';

const products = ref([]);
const displayedProducts = ref([]);
const selectedIds = ref(new Set());
const quantities = reactive({});
const loading = ref(false);
const saving = ref(false);
const modalVisible = ref(false);
const modalMode = ref('create');
const modalResetKey = ref(0);
const editingProduct = ref(null);
const activeQuery = ref('');
let searchRequestId = 0;

const selectedProducts = computed(() => products.value.filter((item) => selectedIds.value.has(item.id)));
const labels = computed(() => {
  const result = [];
  selectedProducts.value.forEach((item) => {
    const quantity = Math.max(1, Math.min(999, Number(quantities[item.id]) || 1));
    for (let index = 0; index < quantity; index += 1) result.push(item);
  });
  return result;
});
const pages = computed(() => {
  const result = [];
  for (let index = 0; index < labels.value.length; index += 24) {
    result.push(labels.value.slice(index, index + 24));
  }
  return result;
});

function showError(error) {
  ElMessage.error(error.message || '操作失败');
}

function syncProductState(items, selectAll = false) {
  const validIds = new Set(items.map((item) => item.id));
  const nextSelected = selectAll
    ? new Set(validIds)
    : new Set([...selectedIds.value].filter((id) => validIds.has(id)));
  items.forEach((item) => {
    if (!quantities[item.id]) quantities[item.id] = 1;
  });
  Object.keys(quantities).forEach((id) => {
    if (!validIds.has(Number(id))) delete quantities[id];
  });
  selectedIds.value = nextSelected;
}

async function refreshProducts({ selectAll = false } = {}) {
  const allItems = await getProducts();
  products.value = allItems;
  syncProductState(allItems, selectAll);
  displayedProducts.value = activeQuery.value ? await getProducts(activeQuery.value) : allItems;
}

async function initialize() {
  loading.value = true;
  try {
    await refreshProducts({ selectAll: true });
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

async function search(keyword) {
  const normalized = keyword.trim();
  if (!normalized) {
    resetSearch();
    return;
  }

  const requestId = ++searchRequestId;
  activeQuery.value = normalized;
  loading.value = true;
  try {
    const result = await getProducts(normalized);
    if (requestId === searchRequestId) displayedProducts.value = result;
  } catch (error) {
    if (requestId === searchRequestId) showError(error);
  } finally {
    if (requestId === searchRequestId) loading.value = false;
  }
}

function resetSearch() {
  searchRequestId += 1;
  activeQuery.value = '';
  displayedProducts.value = products.value;
  loading.value = false;
}

function openCreate() {
  modalMode.value = 'create';
  editingProduct.value = null;
  modalResetKey.value += 1;
  modalVisible.value = true;
}

function openCopy(product) {
  modalMode.value = 'copy';
  editingProduct.value = product;
  modalResetKey.value += 1;
  modalVisible.value = true;
}

function openEdit(product) {
  modalMode.value = 'edit';
  editingProduct.value = product;
  modalResetKey.value += 1;
  modalVisible.value = true;
}

async function saveProduct(payload, continueAdding = false) {
  saving.value = true;
  try {
    if (modalMode.value === 'edit') {
      await updateProduct(editingProduct.value.id, payload);
      ElMessage.success('商品已更新');
      modalVisible.value = false;
    } else {
      const created = await createProduct(payload);
      selectedIds.value = new Set([...selectedIds.value, created.id]);
      quantities[created.id] = 1;
      if (continueAdding) {
        modalMode.value = 'create';
        editingProduct.value = null;
        modalResetKey.value += 1;
        ElMessage.success('商品已新增，请继续录入');
      } else {
        modalVisible.value = false;
        ElMessage.success('商品已新增');
      }
    }
    await refreshProducts();
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

async function removeOne(product) {
  try {
    await ElMessageBox.confirm(`确定删除“${product.name}”（SKU: ${product.sku}）吗？`, '删除商品', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    });
    await deleteProduct(product.id);
    selectedIds.value = new Set([...selectedIds.value].filter((id) => id !== product.id));
    await refreshProducts();
    ElMessage.success('商品已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error);
  }
}

async function removeSelected() {
  const ids = [...selectedIds.value];
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(`将永久删除当前已选的 ${ids.length} 个商品，是否继续？`, '批量删除', {
      type: 'warning',
      confirmButtonText: '全部删除',
      cancelButtonText: '取消'
    });
    await batchDeleteProducts(ids);
    selectedIds.value = new Set();
    await refreshProducts();
    ElMessage.success(`已删除 ${ids.length} 个商品`);
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error);
  }
}

function toggleOne(id, checked) {
  const next = new Set(selectedIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  selectedIds.value = next;
}

function toggleVisible(ids, checked) {
  const next = new Set(selectedIds.value);
  ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
  selectedIds.value = next;
}

function updateQuantity(id, value) {
  quantities[id] = Math.max(1, Math.min(999, Number(value) || 1));
}

function downloadResponse(response, fallbackName) {
  const disposition = response.headers['content-disposition'] || '';
  const matched = disposition.match(/filename="?([^";]+)"?/i);
  const filename = matched?.[1] || fallbackName;
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleImport(file) {
  loading.value = true;
  try {
    const response = await importProducts(file);
    const { total, success, failed, errors } = response.data.data;
    await refreshProducts({ selectAll: true });
    const detail = failed ? `；失败 ${failed} 行：${errors.slice(0, 3).map((item) => `第${item.row}行 ${item.reason}`).join('、')}` : '';
    ElMessage({ message: `导入完成：共 ${total} 行，成功 ${success} 行${detail}`, type: failed ? 'warning' : 'success', duration: 6000 });
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

async function handleExport() {
  try {
    downloadResponse(await exportProducts(), 'products.xlsx');
    ElMessage.success('商品数据已导出');
  } catch (error) {
    showError(error);
  }
}

async function handleBackup() {
  try {
    downloadResponse(await backupDatabase(), 'database.db');
    ElMessage.success('数据库备份已下载');
  } catch (error) {
    showError(error);
  }
}

async function handleRestore(file) {
  try {
    await ElMessageBox.confirm('恢复将覆盖当前全部商品数据。请确认已经备份当前数据库。', '恢复数据库', {
      type: 'warning',
      confirmButtonText: '确认恢复',
      cancelButtonText: '取消'
    });
    loading.value = true;
    await restoreDatabase(file);
    activeQuery.value = '';
    await refreshProducts({ selectAll: true });
    ElMessage.success('数据库恢复成功');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error);
  } finally {
    loading.value = false;
  }
}

function printLabels() {
  if (!labels.value.length) return;
  window.print();
}

onMounted(initialize);
</script>

<template>
  <div class="app-shell">
    <AppHeader :product-count="products.length" :label-count="labels.length" />
    <main class="main-content">
      <LeftPanel
        :products="displayedProducts"
        :selected-ids="selectedIds"
        :quantities="quantities"
        :loading="loading"
        :selected-count="selectedProducts.length"
        :label-count="labels.length"
        :page-count="pages.length"
        @search="search"
        @reset-search="resetSearch"
        @create="openCreate"
        @copy="openCopy"
        @edit="openEdit"
        @delete="removeOne"
        @batch-delete="removeSelected"
        @toggle-one="toggleOne"
        @toggle-visible="toggleVisible"
        @quantity-change="updateQuantity"
        @import="handleImport"
        @export="handleExport"
        @backup="handleBackup"
        @restore="handleRestore"
        @print="printLabels"
      />
      <PreviewPanel :pages="pages" :label-count="labels.length" />
    </main>
    <ProductModal
      v-model="modalVisible"
      :product="editingProduct"
      :mode="modalMode"
      :reset-key="modalResetKey"
      :saving="saving"
      @save="saveProduct"
    />
  </div>
</template>
