<script setup>
import { onMounted, ref } from 'vue';
import { STORE_MODULES } from '@lenovo-store/shared';
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg';

const suiteVersion = ref('');

onMounted(async () => {
  try {
    const response = await fetch('/api/system/health');
    const body = await response.json();
    if (response.ok && body?.code === 0) suiteVersion.value = body.data.version;
  } catch {
    // 版本信息不影响导航和业务页面使用。
  }
});
</script>

<template>
  <div class="suite-shell ls-theme">
    <aside class="suite-sidebar">
      <RouterLink class="suite-brand" to="/">
        <img class="brand-logo ls-brand-logo" :src="logoUrl" alt="联想" />
        <strong>联想门店运营系统</strong>
      </RouterLink>

      <nav class="suite-nav" aria-label="主导航">
        <RouterLink class="nav-item" to="/">
          <span class="nav-icon">总</span>
          <span>工作台</span>
        </RouterLink>
        <p class="nav-section-title">业务板块</p>
        <RouterLink v-for="module in STORE_MODULES" :key="module.id" class="nav-item" :to="module.route">
          <span class="nav-icon" :style="{ '--module-color': module.accent }">{{ module.iconText }}</span>
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
        <span>联想统一运营套件{{ suiteVersion ? ` v${suiteVersion}` : '' }}</span>
      </div>
    </aside>

    <div class="suite-content">
      <header class="suite-header">
        <div>
          <strong>联想门店运营系统</strong>
          <span>一个入口，{{ STORE_MODULES.length }} 个独立业务板块</span>
        </div>
        <span class="phase-badge">联想套件 · {{ STORE_MODULES.length }} 个板块已集成</span>
      </header>
      <main class="suite-main">
        <RouterView />
      </main>
    </div>
  </div>
</template>
