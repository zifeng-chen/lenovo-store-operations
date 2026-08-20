<script setup>
defineProps({
  productCount: { type: Number, default: 0 },
  labelCount: { type: Number, default: 0 }
});
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <div class="brand-mark">L</div>
      <div>
        <h1>联想门店商品标签打印系统</h1>
        <p>LENOVO STORE LABEL PRINTER</p>
      </div>
    </div>
    <div class="header-stats" aria-label="当前统计">
      <span class="stat-chip"><b>{{ productCount }}</b> 商品</span>
      <span class="stat-chip"><b>{{ labelCount }}</b> 标签</span>
    </div>
  </header>
</template>
