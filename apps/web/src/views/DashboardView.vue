<script setup>
import { STORE_MODULES } from '@lenovo-store/shared';
</script>

<template>
  <section class="page-stack">
    <div class="hero-panel">
      <div>
        <span class="eyebrow">LENOVO STORE TOOLKIT</span>
        <h1>门店日常工具，集中在一个入口</h1>
        <p>三个模块保持业务和数据独立，只统一入口、部署、状态监控与后续维护方式。</p>
      </div>
      <div class="hero-stage">
        <b>3</b>
        <span>独立业务模块</span>
      </div>
    </div>

    <div class="section-heading">
      <div>
        <h2>业务工具</h2>
        <p>选择需要使用的门店工具</p>
      </div>
    </div>

    <div class="module-grid">
      <RouterLink v-for="(module, index) in STORE_MODULES" :key="module.id" class="module-card" :to="module.route">
        <div class="module-card-top">
          <span class="module-index">0{{ index + 1 }}</span>
          <span class="module-stage ready-stage">已就绪</span>
        </div>
        <span class="module-mark" :style="{ background: module.accent }">{{ module.shortName.slice(0, 1) }}</span>
        <h3>{{ module.name }}</h3>
        <p>{{ module.description }}</p>
        <div class="module-link">进入模块 <span>→</span></div>
      </RouterLink>
    </div>

    <div class="principle-panel">
      <div class="principle-icon">界</div>
      <div>
        <h3>业务边界保持独立</h3>
        <p>电脑商品标签、商品价格标签和付款凭证分别使用独立的数据目录、API 命名空间和打印流程，不建立错误的数据关联。</p>
      </div>
    </div>
  </section>
</template>
