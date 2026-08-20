<script setup>
import { computed } from 'vue';
import { findStoreModule } from '@lenovo-store/shared';

const props = defineProps({ moduleId: { type: String, required: true } });
const module = computed(() => findStoreModule(props.moduleId));

const migrationScopes = {
  'computer-labels': ['商品 CRUD 与实时搜索', 'Excel 导入导出', '46mm × 45mm 标签预览与打印', '独立 SQLite 备份恢复'],
  'price-labels': ['价格商品与品类管理', 'JSON 导入导出', '70mm × 28mm 价格标签', '名称字号自适应与横向 A4 打印'],
  'receipt-assistant': ['存根与小票图片处理', '百度 OCR 金额识别', '付款金额记录与趋势', 'A4 合成、打印与 PNG 下载']
};
</script>

<template>
  <section v-if="module" class="page-stack">
    <div class="module-hero" :style="{ '--module-color': module.accent }">
      <span class="module-large-mark">{{ module.shortName.slice(0, 1) }}</span>
      <div>
        <span class="eyebrow">{{ module.sourceProject }}</span>
        <h1>{{ module.name }}</h1>
        <p>{{ module.description }}</p>
      </div>
      <span class="pending-badge">业务迁移待开始</span>
    </div>

    <div class="workspace-grid">
      <article class="workspace-card">
        <span class="card-kicker">MIGRATION SCOPE</span>
        <h2>计划迁移范围</h2>
        <ul class="scope-list">
          <li v-for="scope in migrationScopes[module.id]" :key="scope"><span>✓</span>{{ scope }}</li>
        </ul>
      </article>
      <article class="workspace-card">
        <span class="card-kicker">BOUNDARY</span>
        <h2>模块隔离状态</h2>
        <dl class="boundary-list">
          <div><dt>API</dt><dd><code>{{ module.apiBase }}</code></dd></div>
          <div><dt>数据目录</dt><dd><code>data/{{ module.id }}/</code></dd></div>
          <div><dt>当前阶段</dt><dd>工程骨架已就绪</dd></div>
          <div><dt>旧数据</dt><dd>尚未复制或修改</dd></div>
        </dl>
      </article>
    </div>

    <div class="next-step-panel">
      <div>
        <span class="eyebrow">NEXT STEP</span>
        <h2>下一阶段将按模块逐一迁移</h2>
        <p>迁移前会先备份源数据库，并使用功能基线和实体打印样张验证迁移结果。</p>
      </div>
      <el-button type="primary" disabled>等待迁移</el-button>
    </div>
  </section>
</template>
