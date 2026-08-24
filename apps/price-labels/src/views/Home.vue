<script setup>
import { computed, onMounted, ref } from 'vue'
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg'
import { apiUrl, requestJson } from '../api.js'
import CategoryTabs from '../components/CategoryTabs.vue'
import PrintPanel from '../components/PrintPanel.vue'
import ProductForm from '../components/ProductForm.vue'
import ProductList from '../components/ProductList.vue'

const products = ref([])
const categories = ref([])
const activeCategory = ref('全部')
const searchTerm = ref('')
const selectedIds = ref(new Set())
const editingProduct = ref(null)
const formRef = ref(null)
const dataFileInputRef = ref(null)
const loading = ref(true)
const saving = ref(false)
const categorySaving = ref(false)
const deletingProductId = ref(null)
const dataAction = ref('')
const toast = ref({ visible: false, message: '', type: 'success' })
let toastTimer

const filteredProducts = computed(() => {
  const query = searchTerm.value.trim().toLocaleLowerCase('zh-CN')
  return products.value.filter((product) => {
    const matchesCategory = activeCategory.value === '全部' || product.category === activeCategory.value
    const searchable = `${product.name} ${product.category} ${product.price}`.toLocaleLowerCase('zh-CN')
    return matchesCategory && (!query || searchable.includes(query))
  })
})
const selectedProducts = computed(() => products.value.filter(({ id }) => selectedIds.value.has(id)))
const dataToolsBusy = computed(() => Boolean(dataAction.value) || saving.value || categorySaving.value || deletingProductId.value !== null)

function notify(message, type = 'success') {
  clearTimeout(toastTimer)
  toast.value = { visible: true, message, type }
  toastTimer = setTimeout(() => { toast.value.visible = false }, 2600)
}

async function loadData({ showError = true } = {}) {
  loading.value = true
  try {
    const [productData, categoryData] = await Promise.all([
      requestJson('/products'),
      requestJson('/categories'),
    ])
    products.value = productData
    categories.value = categoryData
    return true
  } catch (error) {
    if (showError) notify(error.message, 'error')
    return false
  } finally {
    loading.value = false
  }
}

async function exportData() {
  if (dataToolsBusy.value) return
  dataAction.value = 'export'
  try {
    const response = await fetch(apiUrl('/data/export'))
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.message || data.msg || '导出失败，请稍后重试')
    }
    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const filename = disposition.match(/filename="([^"]+)"/)?.[1]
      ?? `lenovo-price-label-backup-${new Date().toISOString().slice(0, 10)}.json`
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    notify('数据已导出为 JSON 备份')
  } catch (error) {
    notify(error.message, 'error')
  } finally {
    dataAction.value = ''
  }
}

function selectImportFile() {
  if (!dataToolsBusy.value) dataFileInputRef.value?.click()
}
function resetViewAfterImport() {
  selectedIds.value = new Set()
  editingProduct.value = null
  activeCategory.value = '全部'
  searchTerm.value = ''
}

async function importData(event) {
  const input = event.target
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    input.value = ''
    notify('导入文件不能超过 5MB', 'error')
    return
  }
  let importSubmitted = false
  dataAction.value = 'validate'
  try {
    let data
    try {
      data = JSON.parse(await file.text())
    } catch {
      throw new Error('所选文件不是有效的 JSON 备份')
    }
    const validation = await requestJson('/data/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validateOnly: true, data }),
    })
    const confirmed = window.confirm(`备份校验通过：${validation.summary.categories} 个品类、${validation.summary.products} 个商品。\n\n继续导入将替换当前全部品类和商品，是否确认？`)
    if (!confirmed) {
      notify('已取消数据导入')
      return
    }
    dataAction.value = 'import'
    importSubmitted = true
    const result = await requestJson('/data/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validateOnly: false, data }),
    })
    resetViewAfterImport()
    const refreshed = await loadData({ showError: false })
    if (!refreshed) throw new Error('数据已导入，但页面刷新失败，请手动刷新')
    formRef.value?.resetAfterImport()
    notify(`已导入 ${result.summary.categories} 个品类和 ${result.summary.products} 个商品`)
  } catch (error) {
    if (importSubmitted) {
      resetViewAfterImport()
      const refreshed = await loadData({ showError: false })
      if (refreshed) {
        formRef.value?.resetAfterImport()
        notify(`导入请求结果无法确认，已重新读取服务器数据：${error.message}`, 'error')
      } else notify(`${error.message}；同时无法重新读取服务器数据`, 'error')
    } else notify(error.message, 'error')
  } finally {
    dataAction.value = ''
    input.value = ''
  }
}

async function createCategory(name) {
  if (dataAction.value) return
  categorySaving.value = true
  try {
    const created = await requestJson('/categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })
    categories.value.push(created)
    formRef.value?.selectCategory(created.name)
    notify(`品类“${created.name}”已新增`)
  } catch (error) { notify(error.message, 'error') } finally { categorySaving.value = false }
}

async function saveProduct(payload) {
  if (dataAction.value) return
  saving.value = true
  try {
    if (editingProduct.value) {
      const updated = await requestJson(`/products/${editingProduct.value.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const index = products.value.findIndex(({ id }) => id === updated.id)
      if (index !== -1) products.value.splice(index, 1, updated)
      editingProduct.value = null
      formRef.value?.clearFields()
      notify('商品修改已保存')
    } else {
      const created = await requestJson('/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      products.value.unshift(created)
      formRef.value?.clearFields()
      notify('商品已保存')
    }
  } catch (error) { notify(error.message, 'error') } finally { saving.value = false }
}

function editProduct(product) {
  if (dataAction.value) return
  editingProduct.value = product
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
async function deleteProduct(product) {
  if (dataAction.value || deletingProductId.value !== null) return
  if (!window.confirm(`确定删除“${product.name}”吗？此操作不可撤销。`)) return
  deletingProductId.value = product.id
  try {
    await requestJson(`/products/${product.id}`, { method: 'DELETE' })
    products.value = products.value.filter(({ id }) => id !== product.id)
    const nextSelected = new Set(selectedIds.value)
    nextSelected.delete(product.id)
    selectedIds.value = nextSelected
    if (editingProduct.value?.id === product.id) {
      editingProduct.value = null
      formRef.value?.clearFields()
    }
    notify('商品已删除')
  } catch (error) { notify(error.message, 'error') } finally { deletingProductId.value = null }
}
function toggleProduct(id, checked) {
  const nextSelected = new Set(selectedIds.value)
  if (checked) nextSelected.add(id)
  else nextSelected.delete(id)
  selectedIds.value = nextSelected
}
function toggleAllFiltered(checked) {
  const nextSelected = new Set(selectedIds.value)
  filteredProducts.value.forEach(({ id }) => { if (checked) nextSelected.add(id); else nextSelected.delete(id) })
  selectedIds.value = nextSelected
}
function clearSelection() { selectedIds.value = new Set() }
onMounted(loadData)
</script>

<template>
  <div class="app-shell ls-theme">
    <div class="management-ui">
      <header class="app-header">
        <div class="header-inner">
          <img class="brand-mark" :src="logoUrl" alt="Lenovo 联想" />
          <div>
            <p class="system-version">联想门店运营系统</p>
            <h1>周边货品价签</h1>
            <p class="header-description">快速管理商品，并生成精确尺寸的 A4 价格标签</p>
          </div>
        </div>
      </header>
      <main class="page-content">
        <section class="card data-tools" aria-labelledby="data-tools-title">
          <div><p class="eyebrow">数据维护</p><h2 id="data-tools-title">备份与恢复</h2><p>导出完整 JSON 备份；导入会先校验，并在确认后替换当前全部数据。</p></div>
          <div class="data-tool-buttons">
            <button type="button" class="secondary-button" :disabled="dataToolsBusy" @click="exportData">{{ dataAction === 'export' ? '导出中…' : '导出数据' }}</button>
            <button type="button" class="secondary-button" :disabled="dataToolsBusy" @click="selectImportFile">{{ dataAction === 'validate' ? '校验中…' : (dataAction === 'import' ? '导入中…' : '导入数据') }}</button>
            <input ref="dataFileInputRef" class="visually-hidden" type="file" accept=".json,application/json" tabindex="-1" @change="importData" />
          </div>
        </section>
        <ProductForm ref="formRef" :categories="categories" :editing-product="editingProduct" :busy="saving || Boolean(dataAction)" :category-busy="categorySaving || Boolean(dataAction)" @submit="saveProduct" @create-category="createCategory" @cancel-edit="editingProduct = null" />
        <section class="filter-section" aria-label="商品筛选">
          <CategoryTabs v-model="activeCategory" :categories="categories" />
          <label class="search-box"><span class="search-icon" aria-hidden="true"></span><span class="visually-hidden">搜索商品</span><input v-model="searchTerm" type="search" placeholder="搜索商品名称 / 品类 / 价格" /></label>
        </section>
        <div v-if="loading" class="card loading-state">正在读取商品数据…</div>
        <ProductList v-else :products="filteredProducts" :selected-ids="selectedIds" @toggle="toggleProduct" @toggle-all="toggleAllFiltered" @edit="editProduct" @delete="deleteProduct" />
      </main>
    </div>
    <PrintPanel :products="selectedProducts" @clear="clearSelection" />
    <Transition name="toast"><div v-if="toast.visible" class="toast" :class="`toast-${toast.type}`" role="status">{{ toast.message }}</div></Transition>
  </div>
</template>
