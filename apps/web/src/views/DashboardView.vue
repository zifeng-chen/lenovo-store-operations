<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { STORE_MODULES } from '@lenovo-store/shared';
import { ENGINE_ICONS } from '../searchEngineIcons.js';
import FacaiCoinRain from '../components/FacaiCoinRain.vue';
import facaiTreeUrl from '../assets/facai-tree.png';

const ENGINE_KEY = 'lenovo-store:search-engine';

const ENGINES = [
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=', icon: ENGINE_ICONS.baidu },
  { id: 'bing', name: '必应', url: 'https://www.bing.com/search?q=', icon: ENGINE_ICONS.bing },
  { id: 'google', name: '谷歌', url: 'https://www.google.com/search?q=', icon: ENGINE_ICONS.google },
];

const engineMenuOpen = ref(false);
const engineId = ref('baidu');
const searchKeyword = ref('');
const engineTrigger = ref(null);
const engineMenuRef = ref(null);
const engineMenuStyle = ref({});
const searchInput = ref(null);

const todayCount = ref(null);
const todayAmount = ref(null);
const todayDelta = ref(null);
const yesterdayAmount = ref(null);
const weekTotal = ref(null);
const weekCount = ref(null);

const currentEngine = computed(() => ENGINES.find((item) => item.id === engineId.value) || ENGINES[0]);
const todayAvg = computed(() => {
  if (!todayCount.value || todayAmount.value === null) return null;
  return todayAmount.value / todayCount.value;
});

/* ---- 北京时间 + 农历 ---- */
const BEIJING_TZ = 'Asia/Shanghai';
const LUNAR_DAYS = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

// 单独格式化秒不会补零（得到 "7"），因此一次性取完整时间再切分
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TZ, year: 'numeric', month: 'long', day: 'numeric',
});
const weekFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TZ, weekday: 'long',
});
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  timeZone: BEIJING_TZ, year: 'numeric', month: 'long', day: 'numeric',
});

const clockTime = ref('--:--');
const clockSecond = ref(':--');
const clockDate = ref('');
const clockLunar = ref('');

function renderClock() {
  const now = new Date();
  const segments = timeFormatter.format(now).split(':');
  clockTime.value = `${segments[0]}:${segments[1]}`;
  clockSecond.value = `:${segments[2] || '00'}`;
  clockDate.value = `${dateFormatter.format(now)} ${weekFormatter.format(now)}`;
  try {
    const parts = lunarFormatter.formatToParts(now);
    const pick = (type) => parts.find((item) => item.type === type)?.value || '';
    const dayNumber = Number(String(pick('day')).replace(/\D/g, ''));
    const dayText = LUNAR_DAYS[dayNumber] || pick('day');
    const yearName = pick('yearName');
    clockLunar.value = `农历 ${yearName ? `${yearName}年 ` : ''}${pick('month')}${dayText}`;
  } catch {
    clockLunar.value = '';
  }
}

let clockTimer = null;

const amountFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatAmount(value) {
  if (value === null || !Number.isFinite(value)) return '--';
  return `¥${amountFormatter.format(value)}`;
}

function formatAmountDigits(value) {
  if (value === null || !Number.isFinite(value)) return '--';
  return amountFormatter.format(value);
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
      yesterdayAmount.value = yesterday;
      if (yesterday > 0) todayDelta.value = ((current - yesterday) / yesterday) * 100;
      else todayDelta.value = current > 0 ? null : 0;
    } else {
      todayDelta.value = null;
    }
  } catch {
    weekTotal.value = null;
    weekCount.value = null;
    todayDelta.value = null;
    yesterdayAmount.value = null;
  }
}

const deltaClass = computed(() => {
  if (todayDelta.value === null) return 'is-flat';
  if (todayDelta.value > 0) return 'is-up';
  if (todayDelta.value < 0) return 'is-down';
  return 'is-flat';
});

/* 文本只描述趋势，不直出百分比：门店基数很小时（例如昨日 291 元、今日 8259 元）
   涨幅会算出一万四千个百分点，数字本身没有决策价值，还容易读成噪声 */
const deltaText = computed(() => {
  if (todayDelta.value === null) {
    const hasAny = (todayAmount.value || 0) > 0;
    if (hasAny) return '较昨日 由零起步';
    return '较昨日 --';
  }
  if (todayDelta.value === 0) return '与昨日持平';
  if (todayDelta.value > 0) return '高于昨日';
  if ((todayAmount.value || 0) === 0) return '今日尚未收款';
  return '低于昨日';
});

const yesterdayText = computed(() => {
  if (yesterdayAmount.value === null) return '昨日 --';
  return `昨日 ${formatAmount(yesterdayAmount.value)}`;
});

function selectEngine(id) {
  engineId.value = id;
  engineMenuOpen.value = false;
  try {
    localStorage.setItem(ENGINE_KEY, id);
  } catch {
    // 忽略存储失败。
  }
  searchInput.value?.focus();
}

function submitSearch() {
  const keyword = searchKeyword.value.trim();
  if (!keyword) return;
  window.open(`${currentEngine.value.url}${encodeURIComponent(keyword)}`, '_blank', 'noopener,noreferrer');
}

// 弹窗 Teleport 到 body 并 fixed 定位，任何祖先的 overflow / backdrop-filter 都无法裁切或遮挡
function placeEngineMenu() {
  const rect = engineTrigger.value?.getBoundingClientRect();
  if (!rect) return;
  const menu = engineMenuRef.value;
  const menuWidth = menu?.offsetWidth || 186;
  const menuHeight = menu?.offsetHeight || 140;

  let left = rect.left;
  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuWidth - 8);
  }

  let top = rect.bottom + 8;
  if (top + menuHeight > window.innerHeight - 8 && rect.top - menuHeight - 8 > 8) {
    top = rect.top - menuHeight - 8;
  }

  engineMenuStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    zIndex: 2147483000,
  };
}

function toggleEngineMenu() {
  engineMenuOpen.value = !engineMenuOpen.value;
  if (engineMenuOpen.value) {
    // 先于绘制测量尺寸，避免首帧位置跳动
    placeEngineMenu();
  }
}

function closeEngineMenu(event) {
  if (engineMenuOpen.value && !event.target.closest?.('.engine-picker, .engine-menu')) {
    engineMenuOpen.value = false;
  }
}

function onViewportChange() {
  if (engineMenuOpen.value) placeEngineMenu();
}

let pollTimer = null;

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  loadRevenue();
  // 后台标签页的定时器会被节流，回到前台立即校正时间
  renderClock();
}

onMounted(() => {
  try {
    const storedEngine = localStorage.getItem(ENGINE_KEY);
    if (storedEngine && ENGINES.some((item) => item.id === storedEngine)) engineId.value = storedEngine;
  } catch {
    // 读取失败时用默认值。
  }

  loadRevenue();
  pollTimer = window.setInterval(loadRevenue, 60000);

  renderClock();
  clockTimer = window.setInterval(renderClock, 1000);

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('click', closeEngineMenu);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
});

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
  if (clockTimer) window.clearInterval(clockTimer);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('click', closeEngineMenu);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
});
</script>

<template>
  <section class="page-stack">
    <div class="dash-topbar">
      <div class="dash-search">
        <form class="search-box" role="search" @submit.prevent="submitSearch">
          <div class="engine-picker">
            <button
              ref="engineTrigger"
              class="engine-trigger"
              type="button"
              aria-haspopup="listbox"
              :aria-expanded="engineMenuOpen"
              aria-label="选择搜索引擎"
              @click.stop="toggleEngineMenu"
            >
              <img class="engine-icon" :src="currentEngine.icon" :alt="currentEngine.name" />
              <span class="engine-name">{{ currentEngine.name }}</span>
              <span class="engine-caret" aria-hidden="true">▼</span>
            </button>
          </div>
          <input
            ref="searchInput"
            v-model="searchKeyword"
            class="search-input"
            type="text"
            placeholder="搜索网页、商品型号、政策文档…"
            autocomplete="off"
          />
          <button class="search-submit" type="submit">搜索</button>
        </form>
      </div>

      <div class="dash-clock">
        <div class="clock-time">
          <span>{{ clockTime }}</span><span class="clock-sec">{{ clockSecond }}</span>
        </div>
        <div class="clock-date">{{ clockDate }}</div>
        <div v-if="clockLunar" class="clock-lunar">{{ clockLunar }}</div>
      </div>
    </div>

    <!-- 搜索引擎选项：Teleport 到 body + fixed 定位，避免被卡片叠加上下文遮挡 -->
    <Teleport to="body">
      <div
        v-if="engineMenuOpen"
        ref="engineMenuRef"
        class="engine-menu"
        role="listbox"
        aria-label="选择搜索引擎"
        :style="engineMenuStyle"
        @click.stop
      >
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
    </Teleport>

    <div class="revenue-row">
      <div class="facai-stage">
        <div class="facai-glow" aria-hidden="true"></div>
        <figure class="facai-figure">
          <img class="facai-img" :src="facaiTreeUrl" alt="发财树" />
          <figcaption class="facai-caption">日进斗金 · <b>今日进宝</b></figcaption>
        </figure>
        <FacaiCoinRain />
      </div>

      <div class="revenue-metrics">
        <div class="rev-metric">
          <span class="rev-label"><i></i>今日收款笔数</span>
          <div class="rev-value"><span class="rev-num">{{ todayCount === null ? '--' : todayCount }}</span><small>笔</small></div>
          <div class="rev-foot">
            <span>{{ todayCount === null ? '数据暂不可用' : `共 ${todayCount} 笔有效收款` }}</span>
          </div>
        </div>
        <div class="rev-metric">
          <span class="rev-label"><i></i>今日收款金额</span>
          <div class="rev-value rev-money"><span class="rev-cur">¥</span><span class="rev-num">{{ formatAmountDigits(todayAmount) }}</span></div>
          <div class="rev-foot">
            <span class="rev-trend" :class="deltaClass">{{ deltaText }}</span>
            <span>{{ yesterdayText }}</span>
            <span>笔均 <b>{{ formatAmount(todayAvg) }}</b></span>
          </div>
        </div>
        <div class="rev-metric">
          <span class="rev-label"><i></i>近 7 日累计</span>
          <div class="rev-value rev-value--compact"><span class="rev-cur">¥</span><span class="rev-num">{{ formatAmountDigits(weekTotal) }}</span></div>
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
</template>
