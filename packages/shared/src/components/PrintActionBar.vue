<script setup>
import { computed } from 'vue';

const props = defineProps({
  accent: { type: String, default: '#e60012' },
  count: { type: Number, default: 0 },
  pages: { type: Number, default: 0 },
  unit: { type: String, default: '项' },
  label: { type: String, default: '打印标签' },
  showPreview: Boolean,
  showClear: Boolean,
  clearText: { type: String, default: '清空队列' },
  previewText: { type: String, default: '打印预览' }
});

const emit = defineEmits(['print', 'preview', 'clear']);

const disabled = computed(() => props.count === 0);
const printText = computed(() => (props.count > 0 ? `${props.label} ${props.count}` : props.label));
const barStyle = computed(() => `--pab-accent: ${props.accent}`);
</script>

<template>
  <section class="print-action-bar" :style="barStyle" aria-label="打印操作">
    <div class="pab-inner">
      <div class="pab-summary">
        <span class="pab-badge">{{ count }}</span>
        <span class="pab-text">已选 {{ count }} {{ unit }}，共 {{ pages }} 页</span>
        <button v-if="showClear" type="button" class="pab-ghost" :disabled="disabled" @click="emit('clear')">{{ clearText }}</button>
      </div>
      <div class="pab-actions">
        <button v-if="showPreview" type="button" class="pab-btn" :disabled="disabled" @click="emit('preview')">{{ previewText }}</button>
        <button type="button" class="pab-btn pab-btn-main" :disabled="disabled" @click="emit('print')">
          <svg class="pab-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3h10a1 1 0 0 1 1 1v3H6V4a1 1 0 0 1 1-1Z" />
            <path d="M6 13h12v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7Z" />
            <path d="M4 8h16a1 1 0 0 1 1 1v5h-3v-3H6v3H3V9a1 1 0 0 1 1-1Z" />
          </svg>
          <span>{{ printText }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.print-action-bar {
  flex: 0 0 auto;
  border-top: 1px solid #dfe5ee;
  background: #fff;
  box-shadow: 0 -4px 16px rgb(20 40 70 / 6%);
}
.pab-inner {
  min-height: 66px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.pab-summary { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pab-badge {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 8px;
  background: var(--pab-accent);
  color: #fff;
  font-size: 14px;
  font-weight: 800;
}
.pab-text { color: #3a4e62; font-size: 13.5px; white-space: nowrap; }
.pab-ghost {
  padding: 0 4px;
  border: 0;
  background: none;
  color: #7b8ca0;
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.pab-ghost:hover:not(:disabled) { color: var(--pab-accent); }
.pab-ghost:disabled { opacity: .45; cursor: not-allowed; }
.pab-actions { display: flex; align-items: center; gap: 10px; }
.pab-btn {
  height: 44px;
  padding: 0 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid #ccd6e2;
  border-radius: 8px;
  background: #fff;
  color: #2c3e50;
  font-size: 15px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: border-color .14s, color .14s, background .14s;
}
.pab-btn:hover:not(:disabled) { border-color: var(--pab-accent); color: var(--pab-accent); }
.pab-btn:disabled { opacity: .5; cursor: not-allowed; }
.pab-btn-main {
  min-width: 176px;
  border-color: var(--pab-accent);
  background: var(--pab-accent);
  color: #fff;
}
.pab-btn-main:hover:not(:disabled) { background: color-mix(in srgb, var(--pab-accent) 84%, #000); border-color: color-mix(in srgb, var(--pab-accent) 84%, #000); color: #fff; }
.pab-btn-main:disabled { background: color-mix(in srgb, var(--pab-accent) 40%, #fff); border-color: transparent; }
.pab-icon { width: 17px; height: 17px; flex: 0 0 17px; fill: currentColor; }

@media (max-width: 620px) {
  .pab-inner { padding: 10px 14px; flex-direction: column; align-items: stretch; gap: 10px; }
  .pab-summary { justify-content: center; flex-wrap: wrap; }
  .pab-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .pab-btn-main { grid-column: 1 / -1; min-width: 0; }
  .pab-btn { padding: 0 12px; font-size: 14px; }
}

@media print {
  .print-action-bar { display: none !important; }
}
</style>
