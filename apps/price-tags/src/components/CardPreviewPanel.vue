<script setup>
import { computed } from 'vue'
import PriceTagCard from './PriceTagCard.vue'

const props = defineProps({
  cards: { type: Array, required: true },
  activeId: { type: String, default: '' }
})

// A4 每页排 2 张
const pages = computed(() => {
  const result = []
  for (let i = 0; i < props.cards.length; i += 2) {
    result.push(props.cards.slice(i, i + 2))
  }
  return result
})

function hasMissingSubsidy(card) {
  return (card.products || []).some((product) =>
    (product.colors || []).some((color) => !color.subsidyPrice || color.subsidyPrice <= 0)
  )
}
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2>实时预览</h2>
      <small>A4 · 每页 2 张</small>
    </header>

    <div class="preview-body">
      <div class="paper-bar">
        <span class="paper-label">● 实际尺寸 110 × 110mm</span>
        <span class="hint">与打印 1:1</span>
      </div>

      <div v-if="!cards.length" class="empty">
        <p>暂无展牌</p>
        <span>在左侧勾选或选中一张展牌即可预览</span>
      </div>

      <div v-for="(page, pageIndex) in pages" :key="pageIndex" class="a4-page">
        <div class="a4-slot">
          <template v-if="page[0]">
            <PriceTagCard :card="page[0]" />
            <template v-if="page[0].id === activeId && hasMissingSubsidy(page[0])">
              <div class="subsidy-warn left">未输入国补价格</div>
              <div class="subsidy-warn right">未输入国补价格</div>
            </template>
          </template>
          <span v-else class="slot-empty">空位</span>
        </div>

        <div class="a4-slot">
          <template v-if="page[1]">
            <PriceTagCard :card="page[1]" />
            <template v-if="page[1].id === activeId && hasMissingSubsidy(page[1])">
              <div class="subsidy-warn left">未输入国补价格</div>
              <div class="subsidy-warn right">未输入国补价格</div>
            </template>
          </template>
          <span v-else class="slot-empty">空位</span>
        </div>
      </div>

      <p class="foot-note">展牌版式与原项目一致，未做任何改动</p>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--line); border-radius: 12px;
  background: #fff; box-shadow: 0 6px 18px rgba(30,48,72,.06);
}
.panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 13px; border-bottom: 1px solid var(--line); background: #f7f9fc;
}
.panel-head h2 { margin: 0; font-size: 12.5px; }
.panel-head small { color: var(--muted); font-size: 10.5px; }

.preview-body {
  flex: 1; min-height: 0; overflow-y: auto; padding: 12px;
  background: #f1f5fa; display: grid; gap: 9px; align-content: start; justify-items: center;
}

.paper-bar { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.paper-label {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px;
  border-radius: 20px; background: #fff; border: 1px solid var(--line);
  color: #7a8899; font-size: 10px; font-weight: 600;
}
.hint { color: #8894a4; font-size: 10px; }

.a4-page {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 10px; background: #fff; border-radius: 3px;
  box-shadow: 0 2px 12px rgba(0,0,0,.08);
}
.a4-slot {
  position: relative; display: flex; align-items: center; justify-content: center;
  width: 110mm; height: 110mm; border: 0.5px dashed #ddd;
}
.slot-empty { color: #ccc; font-size: 12px; }

/* 未填国补警示：原项目样式 */
.subsidy-warn {
  position: absolute; top: 50%; transform: translateY(-50%);
  writing-mode: vertical-rl; background: #ff4d4f; color: #fff;
  border: 2px solid #cf1322; border-radius: 6px; padding: 14px 8px;
  font-size: 16px; font-weight: 700; letter-spacing: 4px; white-space: nowrap;
  box-shadow: 0 2px 8px rgba(255,77,79,.4);
  animation: subsidy-pulse 1.2s ease-in-out infinite;
}
.subsidy-warn.left { left: -62px; }
.subsidy-warn.right { right: -62px; }
@keyframes subsidy-pulse {
  0%, 100% { transform: translateY(-50%) scale(1); }
  50% { transform: translateY(-50%) scale(1.12); }
}

.empty { padding: 40px 0; text-align: center; }
.empty p { margin: 0 0 6px; color: #999; font-size: 13px; font-weight: 600; }
.empty span { color: #bbb; font-size: 11px; }

.foot-note { margin: 0; color: #8894a4; font-size: 10px; text-align: center; }
</style>
