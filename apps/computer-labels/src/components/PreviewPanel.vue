<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  pages: { type: Array, default: () => [] },
  labelCount: { type: Number, default: 0 }
});

const scrollRef = ref();
const scale = ref(0.55);
let observer;

const scaleStyle = computed(() => ({
  '--preview-scale': scale.value,
  '--preview-width': `${793.7008 * scale.value}px`,
  '--preview-height': `${1122.5197 * scale.value}px`
}));

function applyScale() {
  const width = scrollRef.value?.clientWidth ?? 0;
  if (!width) return;
  const a4WidthPx = (210 / 25.4) * 96;
  scale.value = Math.max(0.3, Math.min(1, (width - 52) / a4WidthPx));
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
      <div>
        <strong>A4 标签预览</strong>
        <span>共 {{ labelCount }} 个标签</span>
      </div>
      <span class="page-summary">每页 24 个 · {{ pages.length }} 页</span>
    </div>
    <div ref="scrollRef" class="preview-scroll">
      <div v-if="pages.length" class="preview-container" :style="scaleStyle">
        <div v-for="(page, pageIndex) in pages" :key="pageIndex" class="preview-page-shell">
          <article class="a4-wrapper">
            <div class="page-number">第 {{ pageIndex + 1 }} 页 / 共 {{ pages.length }} 页</div>
            <div class="label-grid">
              <div v-for="(item, index) in page" :key="`${pageIndex}-${index}-${item.id}`" class="label-item">
                <div class="label-top-color">
                  <div v-if="item.color" class="color-block">{{ item.color }}</div>
                  <div class="text-area">
                    <div class="sku">SKU: {{ item.sku }}</div>
                    <div class="name">{{ item.name }}</div>
                    <div v-if="item.config" class="config">{{ item.config }}</div>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
      <div v-else class="preview-empty">
        <div class="empty-icon">A4</div>
        <strong>暂无标签预览</strong>
        <p>请在左侧选择商品并设置打印数量</p>
      </div>
    </div>
  </section>
</template>
