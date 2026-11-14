<script setup>
const props = defineProps({
  products: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  loading: Boolean
});
const emit = defineEmits(['toggle']);

function isSelected(id) {
  return props.selectedIds.includes(id);
}
</script>

<template>
  <div class="product-list" v-loading="loading">
    <div v-if="!products.length" class="empty">暂无商品数据</div>
    <div
      v-for="item in products"
      :key="item.id"
      :class="['product-row', { checked: isSelected(item.id) }]"
      @click="emit('toggle', item.id)"
    >
      <el-checkbox :model-value="isSelected(item.id)" />
      <span class="row-sku">{{ item.sku }}</span>
      <span class="row-name">{{ item.name }}</span>
    </div>
  </div>
</template>
