<script setup>
import { computed } from 'vue';
import { findStoreModule } from '@lenovo-store/shared';

const props = defineProps({ moduleId: { type: String, required: true } });
const module = computed(() => findStoreModule(props.moduleId));
</script>

<template>
  <section v-if="module" class="module-embed-page">
    <div class="module-workspace" :style="{ '--module-color': module.accent }">
      <header class="module-workspace-bar">
        <div class="module-workspace-context">
          <span class="module-workspace-mark">{{ module.shortName.slice(0, 1) }}</span>
          <div>
            <span class="module-breadcrumb">业务工具 / {{ module.sourceProject }}</span>
            <div class="module-title-line">
              <h1>{{ module.name }}</h1>
              <span class="module-description">{{ module.description }}</span>
            </div>
          </div>
        </div>
        <div class="module-header-actions">
          <span class="workspace-status"><i></i>已集成</span>
          <el-button tag="a" :href="module.moduleBase" target="_blank" rel="noopener noreferrer">
            新窗口打开
          </el-button>
        </div>
      </header>

      <div class="module-frame-shell">
        <iframe
          :key="module.id"
          class="module-frame"
          :src="module.moduleBase"
          :title="module.name"
          allow="clipboard-write"
        />
      </div>
    </div>
  </section>
</template>
