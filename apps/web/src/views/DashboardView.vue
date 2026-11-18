<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { STORE_MODULES } from '@lenovo-store/shared';
import { ENGINE_ICONS } from '../searchEngineIcons.js';
import facaiTreeUrl from '../assets/facai-tree.png';

const CARD_ALPHA_KEY = 'lenovo-store:card-alpha';
const ENGINE_KEY = 'lenovo-store:search-engine';

const ENGINES = [
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=', icon: ENGINE_ICONS.baidu },
  { id: 'bing', name: '必应', url: 'https://www.bing.com/search?q=', icon: ENGINE_ICONS.bing },
  { id: 'google', name: '谷歌', url: 'https://www.google.com/search?q=', icon: ENGINE_ICONS.google },
];

const cardAlpha = ref(0.92);
const engineMenuOpen = ref(false);
const engineId = ref('baidu');
const searchKeyword = ref('');
const appearanceOpen = ref(false);
const appearanceTrigger = ref(null);
const appearancePanelStyle = ref({});

const todayCount = ref(null);
const todayAmount = ref(null);
const todayDelta = ref(null);
const weekTotal = ref(null);
const weekCount = ref(null);

const currentEngine = computed(() => ENGINES.find((item) => item.id === engineId.value) || ENGINES[0]);
const cardAlphaPercent = computed(() => Math.round(cardAlpha.value * 100));
const todayAvg = computed(() => {
  if (!todayCount.value || todayAmount.value === null) return null;
  return todayAmount.value / todayCount.value;
});

const amountFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatAmount(value) {
  if (value === null || !Number.isFinite(value)) return '--';
  return `¥${amountFormatter.format(value)}`;
}

function toLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadRevenue() {
  try {
    const today = await readJson('/api/receipt-assistant/sales/today');
    todayCount.value = Number(today?.count) || 0;
    todayAmount.value = Number(today?.total) || 0;
  } catch {
    todayCount.value = null;
    todayAmount.value = null;
  }

  try {
    const trend = await readJson('/api/receipt-assistant/sales/trend');
    const rows = Array.isArray(trend) ? trend : [];
    const last7 = rows.slice(-7);
    const sumTotal = last7.reduce((acc, row) => acc + (Number(row?.total) || 0), 0);
    const sumCount = last7.reduce((acc, row) => acc + (Number(row?.count) || 0), 0);
    weekTotal.value = sumTotal;
    weekCount.value = sumCount;

    if (last7.length >= 2) {
      const yesterday = Number(last7[last7.length - 2]?.total) || 0;
      const current = Number(last7[last7.length - 1]?.total) || 0;
      if (yesterday > 0) todayDelta.value = ((current - yesterday) / yesterday) * 100;
      else todayDelta.value = current > 0 ? null : 0;
    } else {
      todayDelta.value = null;
    }
  } catch {
    weekTotal.value = null;
    weekCount.value = null;
    todayDelta.value = null;
  }
}

const deltaClass = computed(() => {
  if (todayDelta.value === null) return 'is-flat';
  if (todayDelta.value > 0) return 'is-up';
  if (todayDelta.value < 0) return 'is-down';
  return 'is-flat';
});

const deltaText = computed(() => {
  if (todayDelta.value === null) {
    const hasAny = (todayAmount.value || 0) > 0;
    if (hasAny) return '较昨日 新增';
    return '较昨日 --';
  }
  if (todayDelta.value === 0) return '较昨日 持平';
  const sign = todayDelta.value > 0 ? '+' : '';
  return `较昨日 ${sign}${todayDelta.value.toFixed(1)}%`;
});

function setCardAlpha(value) {
  cardAlpha.value = value;
  document.documentElement.style.setProperty('--card-alpha', value.toFixed(2));
  try {
    localStorage.setItem(CARD_ALPHA_KEY, String(value));
  } catch {
    // 隐私模式下无法记忆，仅影响下次进入的默认值。
  }
}

function onAlphaInput(event) {
  setCardAlpha(Number(event.target.value) / 100);
}

function selectEngine(id) {
  engineId.value = id;
  engineMenuOpen.value = false;
  try {
    localStorage.setItem(ENGINE_KEY, id);
  } catch {
    // 忽略存储失败。
  }
}

function submitSearch() {
  const keyword = searchKeyword.value.trim();
  if (!keyword) return;
  window.open(`${currentEngine.value.url}${encodeURIComponent(keyword)}`, '_blank', 'noopener,noreferrer');
}

function closeEngineMenu(event) {
  if (!event.target.closest?.('.engine-picker')) engineMenuOpen.value = false;
  if (!event.target.closest?.('#appearancePanel, .appearance-trigger, .glass-btn')) appearanceOpen.value = false;
}

// 面板挂到 body 并用 fixed 定位，彻底避开收款卡片等带 backdrop-filter 的叠加上下文
function placeAppearancePanel() {
  const rect = appearanceTrigger.value?.getBoundingClientRect();
  if (!rect) return;
  const width = 268;
  const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
  appearancePanelStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 10}px`,
    left: `${left}px`,
    width: `${width}px`,
  };
}

function toggleAppearance() {
  appearanceOpen.value = !appearanceOpen.value;
  if (appearanceOpen.value) placeAppearancePanel();
}

function onViewportChange() {
  if (appearanceOpen.value) placeAppearancePanel();
}

let pollTimer = null;

function onVisibilityChange() {
  if (document.visibilityState === 'visible') loadRevenue();
}

onMounted(() => {
  try {
    const storedAlpha = Number(localStorage.getItem(CARD_ALPHA_KEY));
    if (storedAlpha >= 0.45 && storedAlpha <= 1) cardAlpha.value = storedAlpha;
    const storedEngine = localStorage.getItem(ENGINE_KEY);
    if (storedEngine && ENGINES.some((item) => item.id === storedEngine)) engineId.value = storedEngine;
  } catch {
    // 读取失败时用默认值。
  }
  document.documentElement.style.setProperty('--card-alpha', cardAlpha.value.toFixed(2));

  loadRevenue();
  pollTimer = window.setInterval(loadRevenue, 60000);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('click', closeEngineMenu);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
});

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('click', closeEngineMenu);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
});
</script>

<template>
  <section class="page-stack">
    <div class="hero-panel dashboard-hero">
      <div class="hero-copy">
        <span class="eyebrow">联想门店运营系统</span>
        <h1>门店日常工具，集中在一个入口</h1>
        <p>{{ STORE_MODULES.length }} 个板块保持业务边界独立，只统一品牌、入口、部署、状态监控与后续维护方式。</p>
      </div>

      <div class="hero-search">
        <form class="search-box" @submit.prevent="submitSearch">
          <div class="engine-picker">
            <button
              class="engine-trigger"
              type="button"
              aria-haspopup="listbox"
              :aria-expanded="engineMenuOpen"
              @click.stop="engineMenuOpen = !engineMenuOpen"
            >
              <img class="engine-icon" :src="currentEngine.icon" :alt="currentEngine.name" />
              <span class="engine-name">{{ currentEngine.name }}</span>
              <span class="engine-caret" aria-hidden="true">▼</span>
            </button>
            <div v-show="engineMenuOpen" class="engine-menu" role="listbox" aria-label="选择搜索引擎">
              <button
                v-for="engine in ENGINES"
                :key="engine.id"
                class="engine-option"
                :class="{ 'is-current': engine.id === engineId }"
                type="button"
                role="option"
                :aria-selected="engine.id === engineId"
                @click.stop="selectEngine(engine.id)"
              >
                <img class="engine-icon engine-icon--small" :src="engine.icon" :alt="engine.name" />
                <span>{{ engine.name }}</span>
                <small v-if="engine.id === 'baidu'">默认</small>
              </button>
            </div>
          </div>
          <input v-model="searchKeyword" class="search-input" type="text" placeholder="搜索网页、商品型号、政策文档…" />
          <button class="search-submit" type="submit">搜索</button>
        </form>
        <div class="search-hint">
          <span>按 <kbd>Enter</kbd> 直接用「{{ currentEngine.name }}」搜索</span>
        </div>
      </div>
    </div>

    <div class="revenue-row">
      <div class="facai-stage">
        <div class="facai-glow" aria-hidden="true"></div>
        <figure class="facai-figure">
          <img class="facai-img" :src="facaiTreeUrl" alt="发财树" />
          <figcaption class="facai-caption">日进斗金 · <b>今日进宝</b></figcaption>
        </figure>
      </div>

      <div class="revenue-metrics">
        <div class="rev-metric">
          <span class="rev-label"><i></i>今日收款笔数</span>
          <div class="rev-value"><span>{{ todayCount === null ? '--' : todayCount }}</span><small>笔</small></div>
          <div class="rev-foot">
            <span>{{ todayCount === null ? '数据暂不可用' : `共 ${todayCount} 笔有效收款` }}</span>
          </div>
        </div>
        <div class="rev-metric">
          <span class="rev-label"><i></i>今日收款金额</span>
          <div class="rev-value rev-money">{{ formatAmount(todayAmount) }}</div>
          <div class="rev-foot">
            <span class="rev-delta" :class="deltaClass">{{ deltaText }}</span>
            <span>笔均 <b>{{ formatAmount(todayAvg) }}</b></span>
          </div>
        </div>
        <div class="rev-metric">
          <span class="rev-label"><i></i>近 7 日累计</span>
          <div class="rev-value rev-value--compact">{{ formatAmount(weekTotal) }}</div>
          <div class="rev-foot">
            <span>{{ weekCount === null ? '--' : `${weekCount} 笔` }}</span>
            <span class="rev-status">来自付款凭证打印</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section-heading dashboard-section-heading">
      <div>
        <h2>业务板块</h2>
        <p>单击卡片即可进入，无需再找入口按钮</p>
      </div>
      <div class="heading-actions">
        <button
          ref="appearanceTrigger"
          class="glass-btn"
          type="button"
          :aria-expanded="appearanceOpen"
          aria-controls="appearancePanel"
          @click.stop="toggleAppearance"
        >
          ⚙ 工作台外观
        </button>
        <el-button
          class="github-repository-link"
          tag="a"
          href="https://github.com/zifeng-chen/lenovo-store-operations"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub 仓库 <span aria-hidden="true">↗</span>
        </el-button>
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
      </RouterLink>
    </div>

    <div class="principle-panel">
      <div class="principle-icon">界</div>
      <div>
        <h3>统一联想品牌，保持业务边界独立</h3>
        <p>商品标签、价格标签和付款凭证继续使用独立数据库、API 与打印流程；员工工牌在浏览器内生成 A4 排版并打印，不保存员工信息。</p>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="appearanceOpen"
      id="appearancePanel"
      class="appearance-panel"
      role="dialog"
      aria-label="工作台外观"
      :style="appearancePanelStyle"
      @click.stop
    >
      <label class="appearance-label" for="cardAlphaRange">
        卡片透明度
        <output>{{ cardAlphaPercent }}%</output>
      </label>
      <input
        id="cardAlphaRange"
        class="alpha-range"
        type="range"
        min="45"
        max="100"
        step="1"
        :value="cardAlphaPercent"
        @input="onAlphaInput"
      />
      <div class="appearance-preview">
        <span class="preview-card"></span>
        <span class="preview-card"></span>
        <span class="preview-card"></span>
      </div>
      <p class="appearance-note">预览三张业务卡片的通透程度，拖动即时生效。</p>
    </div>
  </Teleport>
</template>
