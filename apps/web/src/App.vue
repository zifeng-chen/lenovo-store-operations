<script setup>
import { STORE_MODULES } from '@lenovo-store/shared';
</script>

<template>
  <div class="suite-shell">
    <aside class="suite-sidebar">
      <RouterLink class="suite-brand" to="/">
        <span class="brand-mark">L</span>
        <span>
          <strong>联想门店运营工具</strong>
          <small>STORE OPERATIONS</small>
        </span>
      </RouterLink>

      <nav class="suite-nav" aria-label="主导航">
        <RouterLink class="nav-item" to="/">
          <span class="nav-icon">总</span>
          <span>工作台</span>
        </RouterLink>
        <p class="nav-section-title">业务工具</p>
        <RouterLink v-for="module in STORE_MODULES" :key="module.id" class="nav-item" :to="module.route">
          <span class="nav-icon" :style="{ '--module-color': module.accent }">{{ module.shortName.slice(0, 1) }}</span>
          <span>{{ module.shortName }}</span>
        </RouterLink>
        <p class="nav-section-title">系统</p>
        <RouterLink class="nav-item" to="/system">
          <span class="nav-icon">设</span>
          <span>系统状态</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <span class="status-dot"></span>
        <span>统一工程骨架 v0.1.0</span>
      </div>
    </aside>

    <div class="suite-content">
      <header class="suite-header">
        <div>
          <strong>Lenovo Store Operations</strong>
          <span>一个入口，三个独立业务模块</span>
        </div>
        <span class="phase-badge">第一阶段 · 工程整合</span>
      </header>
      <main class="suite-main">
        <RouterView />
      </main>
    </div>
  </div>
</template>
