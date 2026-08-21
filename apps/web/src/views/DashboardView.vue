<script setup>
import { STORE_MODULES } from '@lenovo-store/shared';
</script>

<template>
  <section class="page-stack">
    <div class="hero-panel">
      <div>
        <span class="eyebrow">联想门店运营系统</span>
        <h1>门店日常工具，集中在一个入口</h1>
        <p>{{ STORE_MODULES.length }} 个板块保持业务边界独立，只统一品牌、入口、部署、状态监控与后续维护方式。</p>
      </div>
      <div class="hero-stage">
        <b>{{ STORE_MODULES.length }}</b>
        <span>独立业务板块</span>
      </div>
    </div>

    <div class="section-heading">
      <div>
        <h2>业务板块</h2>
        <p>选择需要使用的联想门店工具</p>
      </div>
    </div>

    <div class="module-grid">
      <RouterLink v-for="(module, index) in STORE_MODULES" :key="module.id" class="module-card" :to="module.route">
        <div class="module-card-top">
          <span class="module-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="module-stage ready-stage">已就绪</span>
        </div>
        <span class="module-mark" :style="{ background: module.accent }">{{ module.iconText }}</span>
        <h3>{{ module.name }}</h3>
        <p>{{ module.description }}</p>
        <div class="module-link">进入板块 <span>→</span></div>
      </RouterLink>
    </div>

    <div class="principle-panel">
      <div class="principle-icon">界</div>
      <div>
        <h3>统一联想品牌，保持业务边界独立</h3>
        <p>商品标签、价格标签和付款凭证继续使用独立数据库、API 与打印流程；员工工牌仅在浏览器内生成预览，不保存员工信息。</p>
      </div>
    </div>
  </section>
</template>
