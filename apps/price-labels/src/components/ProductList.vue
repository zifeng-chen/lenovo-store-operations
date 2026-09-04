<script setup>
import { computed, ref, watchEffect } from 'vue'

const props = defineProps({
  products: {
    type: Array,
    required: true,
  },
  selectedIds: {
    type: Set,
    required: true,
  },
})

const emit = defineEmits(['toggle', 'toggle-all', 'edit', 'delete'])
const selectAllCheckbox = ref(null)

const allSelected = computed(() => (
  props.products.length > 0 && props.products.every(({ id }) => props.selectedIds.has(id))
))

const someSelected = computed(() => (
  props.products.some(({ id }) => props.selectedIds.has(id)) && !allSelected.value
))

watchEffect(() => {
  if (selectAllCheckbox.value) {
    selectAllCheckbox.value.indeterminate = someSelected.value
  }
})

function formatPrice(price) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(price)
}
</script>

<template>
  <section class="card list-card" aria-labelledby="list-title">
    <div class="section-heading list-heading">
      <div>
        <p class="eyebrow">商品库</p>
        <h2 id="list-title">商品列表</h2>
      </div>
      <span class="result-count">共 {{ products.length }} 条结果</span>
    </div>

    <div class="table-scroll">
      <table class="product-table">
        <thead>
          <tr>
            <th class="check-column">
              <input
                ref="selectAllCheckbox"
                type="checkbox"
                :checked="allSelected"
                :disabled="!products.length"
                aria-label="全选当前筛选结果"
                title="全选当前筛选结果"
                @change="emit('toggle-all', $event.target.checked)"
              />
            </th>
            <th>商品名称</th>
            <th>品类</th>
            <th>价格</th>
            <th>添加日期</th>
            <th class="actions-column">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="product in products" :key="product.id">
            <td class="check-column">
              <input
                type="checkbox"
                :checked="selectedIds.has(product.id)"
                :aria-label="`将 ${product.name} 加入打印队列`"
                @change="emit('toggle', product.id, $event.target.checked)"
              />
            </td>
            <td class="product-name-cell">{{ product.name }}</td>
            <td><span class="category-badge">{{ product.category }}</span></td>
            <td class="price-cell">¥{{ formatPrice(product.price) }}</td>
            <td class="date-cell">{{ product.added_date }}</td>
            <td class="actions-column">
              <div class="row-actions">
                <button type="button" class="table-button" @click="emit('edit', product)">编辑</button>
                <button type="button" class="table-button danger" @click="emit('delete', product)">删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="!products.length">
            <td colspan="6" class="empty-cell">没有找到符合条件的商品</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
