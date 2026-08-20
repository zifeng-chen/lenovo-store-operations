<script setup>
import { computed } from 'vue';
import { findStoreModule } from '@lenovo-store/shared';

const props = defineProps({ moduleId: { type: String, required: true } });
const module = computed(() => findStoreModule(props.moduleId));
</script>

<template>
  <section v-if="module" class="page-stack module-embed-page">
    <div class="module-hero module-embed-header" :style="{ '--module-color': module.accent }">
      <span class="module-large-mark">{{ module.shortName.slice(0, 1) }}</span>
      <div>
        <span class="eyebrow">{{ module.sourceProject }}</span>
        <h1>{{ module.name }}</h1>
        <p>{{ module.description }}</p>
      </div>
      <div class="module-header-actions">
        <span class="ready-badge">已迁移</span>
        <el-button tag="a" :href="module.moduleBase" target="_blank" rel="noopener noreferrer">
          新窗口打开
        </el-button>
      </div>
    </div>

    <iframe
      :key="module.id"
      class="module-frame"
      :src="module.moduleBase"
      :title="module.name"
      allow="clipboard-write"
    />
  </section>
</template>
