<script setup>
import { computed } from 'vue';
import EmployeeBadge from './EmployeeBadge.vue';

const props = defineProps({
  pages: { type: Array, default: () => [] }
});

const previewPages = computed(() => (props.pages.length ? props.pages : [[]]));
</script>

<template>
  <section class="preview-card ls-card" aria-labelledby="badge-preview-title">
    <div class="preview-heading">
      <div>
        <p class="ls-eyebrow">A4 实时预览</p>
        <h2 id="badge-preview-title">员工工牌打印排版</h2>
      </div>
      <span class="layout-badge">5 × 2 / 10 张</span>
    </div>

    <div class="a4-preview-viewport">
      <div v-for="(page, pageIndex) in previewPages" :key="pageIndex" class="a4-preview-shell">
        <div class="a4-preview-page">
          <div v-if="!page.length" class="empty-page-hint">
            <strong>A4 工牌预览</strong>
            <span>添加员工后将在此按 5 列 × 2 行排版</span>
          </div>
          <div class="preview-badge-grid">
            <div v-for="employee in page" :key="employee.printKey" class="preview-badge-slot">
              <EmployeeBadge :employee="employee" />
            </div>
          </div>
        </div>
        <span class="page-number">第 {{ pageIndex + 1 }} / {{ previewPages.length }} 页</span>
      </div>
    </div>

    <p class="preview-note">灰色细线为裁切边界；打印时请选择 A4、横向、实际大小（100%），并关闭页眉页脚。</p>
  </section>
</template>
