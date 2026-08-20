<script setup>
defineProps({
  categories: {
    type: Array,
    required: true,
  },
  modelValue: {
    type: String,
    required: true,
  },
})

defineEmits(['update:modelValue'])
</script>

<template>
  <nav class="category-tabs" aria-label="按品类筛选">
    <button
      type="button"
      class="category-tab"
      :class="{ active: modelValue === '全部' }"
      @click="$emit('update:modelValue', '全部')"
    >
      全部
    </button>
    <button
      v-for="category in categories"
      :key="category.id"
      type="button"
      class="category-tab"
      :class="{ active: modelValue === category.name }"
      @click="$emit('update:modelValue', category.name)"
    >
      {{ category.name }}
    </button>
  </nav>
</template>
