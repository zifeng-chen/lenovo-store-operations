<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import SampleSticker from './SampleSticker.vue';

const props = defineProps({
  pages: { type: Array, default: () => [] },
  total: { type: Number, default: 0 }
});

const scrollRef = ref();
const sheetWidth = ref(820);
let observer;

// A4 横向在 CSS 中的实际宽度（297mm ≈ 1122.5px），用作预览缩放基准。
const A4_WIDTH_PX = 297 / 25.4 * 96;

// 预览按容器宽度等比缩放：整页 transform 缩小，内部字号（pt/mm）随之等比，与打印完全一致。
const sheetStyle = computed(() => {
  const width = Math.max(320, sheetWidth.value);
  const height = width * 210 / 297;
  return {
    '--sheet-w': `${width}px`,
    '--sheet-h': `${height}px`,
    '--preview-scale': `${width / A4_WIDTH_PX}`
  };
});

function applyScale() {
  const available = scrollRef.value?.clientWidth ?? 0;
  if (!available) return;
  // 留出滚动条与内边距的余量
  sheetWidth.value = Math.max(320, Math.min(1120, available - 60));
}

onMounted(() => {
  observer = new ResizeObserver(applyScale);
  if (scrollRef.value) observer.observe(scrollRef.value);
  requestAnimationFrame(applyScale);
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section class="right-panel">
    <div class="preview-header">
      <strong>A4 打印预览</strong>
      <span v-if="total">共 {{ total }} 枚 · {{ pages.length }} 页</span>
      <span v-else>勾选左侧商品后显示预览</span>
    </div>

    <div ref="scrollRef" class="preview-scroll">
      <div v-if="!pages.length" class="preview-empty">
        <div class="empty-icon">A4</div>
        <strong>暂无贴纸</strong>
        <p>在左侧勾选需要出样的商品</p>
      </div>

      <div v-else class="preview-container" :style="sheetStyle">
        <div v-for="(page, pageIndex) in pages" :key="pageIndex" class="page-shell">
          <div class="sheet">
            <SampleSticker
              v-for="(item, index) in page"
              :key="`${pageIndex}-${index}-${item.id}`"
              :item="item"
            />
          </div>
          <div class="page-number">第 {{ pageIndex + 1 }} 页 / 共 {{ pages.length }} 页</div>
        </div>
      </div>
    </div>
  </section>
</template>
