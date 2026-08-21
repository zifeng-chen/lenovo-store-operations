<script setup>
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg';

defineProps({
  productCount: { type: Number, default: 0 },
  labelCount: { type: Number, default: 0 }
});
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <img class="brand-logo ls-brand-logo" :src="logoUrl" alt="联想" />
      <div>
        <h1>联想电脑商品标签</h1>
        <p>电脑 SKU、配置与颜色标签管理</p>
      </div>
    </div>
    <div class="header-stats" aria-label="当前统计">
      <span class="stat-chip"><b>{{ productCount }}</b> 商品</span>
      <span class="stat-chip"><b>{{ labelCount }}</b> 标签</span>
    </div>
  </header>
</template>
