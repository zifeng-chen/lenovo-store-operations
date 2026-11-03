<script setup>
import { onMounted, ref, watch } from 'vue';
import { STORE_MODULES } from '@lenovo-store/shared';
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg';

const suiteVersion = ref('');
const SIDEBAR_COLLAPSED_KEY = 'lenovo-store:sidebar-collapsed';
const sidebarCollapsed = ref(false);

function readSidebarPreference() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

watch(sidebarCollapsed, (value) => {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    // 隐私模式下写入可能失败，仅影响记忆，不影响本次折叠。
  }
});

onMounted(async () => {
  sidebarCollapsed.value = readSidebarPreference();
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
  <div class="suite-shell ls-theme" :class="{ 'suite-shell--collapsed': sidebarCollapsed }">
    <aside class="suite-sidebar">
      <div class="sidebar-top">
        <RouterLink class="suite-brand" to="/" :title="sidebarCollapsed ? '联想门店运营系统' : undefined">
          <img class="brand-logo ls-brand-logo" :src="logoUrl" alt="联想" />
          <strong v-show="!sidebarCollapsed">联想门店运营系统</strong>
        </RouterLink>
        <button
          type="button"
          class="sidebar-toggle"
          :aria-expanded="!sidebarCollapsed"
          :aria-label="sidebarCollapsed ? '展开侧边菜单' : '收起侧边菜单'"
          :title="sidebarCollapsed ? '展开菜单' : '收起菜单'"
          @click="toggleSidebar"
        >
          <span aria-hidden="true">{{ sidebarCollapsed ? '»' : '«' }}</span>
        </button>
      </div>

      <nav class="suite-nav" aria-label="主导航">
        <RouterLink class="nav-item" to="/" :title="sidebarCollapsed ? '工作台' : undefined">
          <span class="nav-icon">总</span>
          <span v-show="!sidebarCollapsed" class="nav-label">工作台</span>
        </RouterLink>
        <p v-show="!sidebarCollapsed" class="nav-section-title">业务板块</p>
        <RouterLink
          v-for="module in STORE_MODULES"
          :key="module.id"
          class="nav-item"
          :to="module.route"
          :title="sidebarCollapsed ? module.shortName : undefined"
        >
          <span class="nav-icon" :style="{ '--module-color': module.accent }">{{ module.iconText }}</span>
          <span v-show="!sidebarCollapsed" class="nav-label">{{ module.shortName }}</span>
        </RouterLink>
        <p v-show="!sidebarCollapsed" class="nav-section-title">系统</p>
        <RouterLink class="nav-item" to="/system" :title="sidebarCollapsed ? '系统状态' : undefined">
          <span class="nav-icon">系</span>
          <span v-show="!sidebarCollapsed" class="nav-label">系统状态</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <span class="status-dot"></span>
        <span v-show="!sidebarCollapsed">联想统一运营套件{{ suiteVersion ? ` v${suiteVersion}` : '' }}</span>
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
