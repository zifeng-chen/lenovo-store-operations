<script setup>
import { computed } from 'vue';

const props = defineProps({
  item: { type: Object, required: true }
});

const MAX_SKU_LENGTH = 6;

const sku = computed(() => String(props.item.sku ?? '').trim());

// 6 位为基准档，位数越少字号越大；超过 6 位按同等比例继续收小，避免出框
const skuStyle = computed(() => {
  const delta = MAX_SKU_LENGTH - sku.value.length;
  return `--sku-pt: ${Math.max(14, 40 + delta * 4)}pt`;
});
</script>

<template>
  <article class="sticker">
    <div class="sample-panel">
      <div class="sample-text">出样</div>
    </div>
    <div class="info-panel">
      <div class="sku-row">
        <span class="sku" :style="skuStyle">{{ sku }}</span>
      </div>
      <div class="model">{{ item.name }}</div>
      <div v-if="item.config" class="config">{{ item.config }}</div>
    </div>
  </article>
</template>
