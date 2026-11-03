<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { init, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getComparison, getItems, getOverview, getRecords, getTrend } from './api.js';
import { splitProductName, toFullName, toShortLabel } from './product-name.js';

use([LineChart, BarChart, AriaComponent, GridComponent, TooltipComponent, CanvasRenderer]);

const loading = ref(true);
const errorMessage = ref('');
const overview = ref(null);
const allStats = ref(null);
const comparison = ref(null);
const items = ref([]);
const records = ref([]);
const recordPage = ref(1);
const recordPageSize = ref(20);
const recordTotal = ref(0);
const trend = ref(null);
const granularity = ref('month');
const range = ref({ dates: null });
const quickRange = ref('all');
const trendChartEl = ref(null);
const countChartEl = ref(null);
const compareChartEl = ref(null);
const itemChartEl = ref(null);
let trendChart = null;
let countChart = null;
let compareChart = null;
let itemChart = null;

const money = (value) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (value) => {
  const num = Number(value || 0);
  if (Math.abs(num) >= 10000) return `${(num / 10000).toFixed(1)}万`;
  return num.toFixed(0);
};
const percentText = (value) => (value === null || value === undefined ? '暂无对比' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`);
const percentClass = (value) => (value === null || value === undefined ? 'neutral' : value > 0 ? 'up' : value < 0 ? 'down' : 'neutral');

const summary = computed(() => overview.value?.summary ?? null);
const totalSummary = computed(() => allStats.value?.summary ?? null);
const trendPoints = computed(() => trend.value?.points ?? []);
const monthRows = computed(() => comparison.value?.months ?? []);
const quarterRows = computed(() => comparison.value?.quarters ?? []);
const yearRows = computed(() => comparison.value?.years ?? []);

// 表格行：把 OCR 原始名称拆成型号与配置，型号完整保留不截断
const itemRows = computed(() => items.value.map((item) => {
  const { model, config } = splitProductName(item.name);
  return { ...item, model, config, fullName: toFullName(item.name) };
}));

// 图表取销售额前五，Y 轴使用中等截取的短标签
const ITEM_TOP_COUNT = 5;
const itemTopRows = computed(() => [...itemRows.value]
  .sort((left, right) => right.total - left.total)
  .slice(0, ITEM_TOP_COUNT));


const granularityOptions = [
  { label: '按日', value: 'day' },
  { label: '按月', value: 'month' },
  { label: '按季', value: 'quarter' },
  { label: '按年', value: 'year' }
];

function renderTrend() {
  if (!trendChartEl.value) return;
  if (!trendChart) trendChart = init(trendChartEl.value);
  const points = trendPoints.value;
  trendChart.setOption({
    grid: { left: 62, right: 24, top: 32, bottom: 48 },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const item = params[0];
        const point = points[item.dataIndex];
        if (!point) return '';
        return `${point.period}<br/>销售额：${money(point.total)}<br/>笔数：${point.count}`;
      }
    },
    xAxis: {
      type: 'category',
      data: points.map(point => point.period),
      axisLabel: { fontSize: 11, rotate: points.length > 14 ? 45 : 0 }
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value) => compact(value) }
    },
    series: [{
      type: 'line',
      smooth: true,
      symbolSize: 6,
      data: points.map(point => point.total),
      areaStyle: { opacity: 0.14 },
      lineStyle: { width: 2 }
    }]
  }, true);
  trendChart.resize();
}

function currentParams() {
  const params = {};
  const dates = range.value.dates;
  if (Array.isArray(dates) && dates.length === 2 && dates[0] && dates[1]) {
    params.start = dates[0];
    params.end = dates[1];
  }
  return params;
}

async function load() {
  loading.value = true;
  errorMessage.value = '';
  const params = currentParams();
  try {
    const [overviewData, allOverview, comparisonData, trendData, itemsData, recordsData] = await Promise.all([
      getOverview(params),
      getOverview({}),
      getComparison(params),
      getTrend({ ...params, granularity: granularity.value }),
      getItems(params),
      getRecords({ ...params, page: recordPage.value, pageSize: recordPageSize.value })
    ]);
    // 统计区间跟随所选范围；下方汇总卡片始终展示全部数据。
    overview.value = overviewData;
    allStats.value = allOverview;
    comparison.value = comparisonData;
    trend.value = trendData;
    items.value = itemsData.items ?? [];
    records.value = recordsData.records ?? [];
    recordTotal.value = recordsData.total ?? 0;
    await new Promise(resolve => requestAnimationFrame(resolve));
    try { renderTrend() } catch (error) { console.error('[趋势图渲染失败]', error) }
    try { renderCountChart() } catch (error) { console.error('[构成图渲染失败]', error) }
    try { renderCompareChart() } catch (error) { console.error('[对比图渲染失败]', error) }
    try { renderItemChart() } catch (error) { console.error('[商品排行图渲染失败]', error) }
  } catch (error) {
    errorMessage.value = error.message || '报表数据加载失败';
  } finally {
    loading.value = false;
  }
}

function applyQuickRange(value) {
  quickRange.value = value;
  if (value === 'all') {
    range.value.dates = null;
    load();
    return;
  }
  const days = Number(value);
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  range.value.dates = [fmt(start), fmt(end)];
  load();
}

async function changeGranularity(value) {
  granularity.value = value;
  try {
    trend.value = await getTrend({ ...currentParams(), granularity: value });
    renderTrend();
  } catch (error) {
    errorMessage.value = error.message || '趋势加载失败';
  }
}

async function changeRecordPage(page) {
  recordPage.value = page;
  const params = { ...currentParams(), page, pageSize: recordPageSize.value };
  try {
    const data = await getRecords(params);
    records.value = data.records ?? [];
    recordTotal.value = data.total ?? 0;
  } catch (error) {
    errorMessage.value = error.message || '销售明细加载失败';
  }
}

function renderCountChart() {
  if (!countChartEl.value) return;
  if (!countChart) countChart = init(countChartEl.value);
  const daily = overview.value?.daily ?? [];
  const buckets = new Map();
  for (const day of daily) {
    if (!day.count) continue;
    const key = day.count;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const entries = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  countChart.setOption({
    grid: { left: 50, right: 20, top: 30, bottom: 40 },
    tooltip: { trigger: 'axis', formatter: (p) => `每日 ${p[0].name} 笔<br/>出现 ${p[0].value} 天` },
    xAxis: { type: 'category', data: entries.map(e => `${e[0]}笔`), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: '天数', axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar',
      data: entries.map(e => e[1]),
      barMaxWidth: 36,
      itemStyle: { borderRadius: [4, 4, 0, 0] }
    }]
  }, true);
  countChart.resize();
}

function renderCompareChart() {
  if (!compareChartEl.value) return;
  if (!compareChart) compareChart = init(compareChartEl.value);
  const months = monthRows.value;
  // 横向条形图：更适合维度对比，数据标签直接标在条上，避免双轴混淆。
  const sorted = [...months].sort((a, b) => a.total - b.total);
  const maxTotal = Math.max(...sorted.map(m => m.total), 1);
  compareChart.setOption({
    grid: { left: 84, right: 96, top: 16, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const item = sorted[params[0].dataIndex];
        if (!item) return '';
        const change = item.changePercent === null || item.changePercent === undefined
          ? '—'
          : `${item.changePercent > 0 ? '+' : ''}${item.changePercent.toFixed(1)}%`;
        return `<b>${item.period}</b><br/>销售额：${money(item.total)}<br/>笔数：${item.count}<br/>环比：${change}`;
      }
    },
    xAxis: {
      type: 'value',
      max: maxTotal,
      axisLabel: { formatter: compact, fontSize: 11 },
      splitLine: { lineStyle: { type: 'dashed', color: '#eef1f6' } }
    },
    yAxis: {
      type: 'category',
      data: sorted.map(m => m.period),
      axisLabel: { fontSize: 12, color: '#46536a' },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      data: sorted.map(m => ({
        value: m.total,
        itemStyle: {
          borderRadius: [0, 6, 6, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: '#7fb2e5' },
              { offset: 1, color: '#1a5e9c' }
            ]
          }
        }
      })),
      barMaxWidth: 26,
      label: {
        show: true,
        position: 'right',
        distance: 8,
        fontSize: 11,
        color: '#46536a',
        formatter: (p) => {
          const item = sorted[p.dataIndex];
          return `${money(item.total)}  ·  ${item.count} 笔`;
        }
      }
    }]
  }, true);
  compareChart.resize();
}

function renderItemChart() {
  if (!itemChartEl.value) return;
  if (!itemChart) itemChart = init(itemChartEl.value);
  const rows = itemTopRows.value;
  // 横向条形图按销售额升序绘制，使最高的商品显示在顶部
  const sorted = [...rows].sort((left, right) => left.total - right.total);
  const labels = sorted.map((row) => toShortLabel(row.fullName));
  const maxTotal = Math.max(...sorted.map((row) => row.total), 1);
  itemChart.setOption({
    grid: { left: 130, right: 110, top: 12, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const row = sorted[params[0].dataIndex];
        if (!row) return '';
        return `<b>${row.fullName}</b><br/>销售额：${money(row.total)}<br/>数量：${row.qty ?? '—'}<br/>出现次数：${row.occurrences}`;
      }
    },
    xAxis: {
      type: 'value',
      max: maxTotal,
      axisLabel: { formatter: compact, fontSize: 11 },
      splitLine: { lineStyle: { type: 'dashed', color: '#eef1f6' } }
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { fontSize: 12, color: '#46536a', width: 120, overflow: 'truncate' },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      data: sorted.map((row) => ({
        value: row.total,
        itemStyle: {
          borderRadius: [0, 6, 6, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: '#7fb2e5' },
              { offset: 1, color: '#1a5e9c' }
            ]
          }
        }
      })),
      barMaxWidth: 26,
      label: {
        show: true,
        position: 'right',
        distance: 8,
        fontSize: 11,
        color: '#46536a',
        formatter: (params) => money(sorted[params.dataIndex].total)
      }
    }]
  }, true);
  itemChart.resize();
}

const handleResize = () => {
  trendChart?.resize();
  countChart?.resize();
  compareChart?.resize();
  itemChart?.resize();
};

onMounted(() => {
  load();
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  trendChart?.dispose();
  countChart?.dispose();
  compareChart?.dispose();
  itemChart?.dispose();
  trendChart = null;
  countChart = null;
  compareChart = null;
  itemChart = null;
});
</script>

<template>
  <div class="report-shell">
    <header class="report-header">
      <div>
        <h1>销售业绩报表</h1>
        <p>数据来源：付款凭证打印 · 销售明细</p>
      </div>
      <div v-if="overview" class="report-range">
        {{ overview.range.startDate }} 至 {{ overview.range.endDate }}
      </div>
    </header>

    <div class="report-toolbar">
      <el-date-picker
        v-model="range.dates"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        unlink-panels
        size="small"
        style="width: 280px"
        @change="load"
      />
      <el-radio-group :model-value="quickRange" size="small" @update:model-value="applyQuickRange">
        <el-radio-button label="7">近7天</el-radio-button>
        <el-radio-button label="30">近30天</el-radio-button>
        <el-radio-button label="90">近90天</el-radio-button>
        <el-radio-button label="all">全部</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false" />

    <div class="report-body" :class="{ 'is-loading': loading }">
      <div v-if="loading" class="report-loading-mask"><span>加载中…</span></div>
      <section v-if="summary" class="range-summary">
        <div class="range-summary-period">
          <span>统计区间</span>
          <strong>{{ overview.range.startDate }} ~ {{ overview.range.endDate }}</strong>
        </div>
        <div class="range-summary-metrics">
          <div><span>区间笔数</span><strong>{{ summary.count }}</strong></div>
          <div><span>区间销售额</span><strong>{{ money(summary.total) }}</strong></div>
          <div><span>区间日均</span><strong>{{ money(summary.averagePerDay) }}</strong></div>
          <div><span>区间客单价</span><strong>{{ money(summary.averagePerSale) }}</strong></div>
        </div>
      </section>

      <section v-if="totalSummary" class="metric-grid">
        <article class="metric-card">
          <span>总销售额（全部）</span>
          <strong>{{ money(totalSummary.total) }}</strong>
          <em :class="percentClass(totalSummary.changePercent)">环比 {{ percentText(totalSummary.changePercent) }}</em>
        </article>
        <article class="metric-card">
          <span>总成交笔数（全部）</span>
          <strong>{{ totalSummary.count }}</strong>
          <em class="neutral">{{ totalSummary.activeDays }} 个活跃日</em>
        </article>
        <article class="metric-card">
          <span>整体客单价</span>
          <strong>{{ money(totalSummary.averagePerSale) }}</strong>
          <em class="neutral">中位数 {{ money(totalSummary.median) }}</em>
        </article>
        <article class="metric-card">
          <span>整体日均销售额</span>
          <strong>{{ money(totalSummary.averagePerDay) }}</strong>
          <em v-if="totalSummary.bestDay" class="neutral">最高 {{ totalSummary.bestDay.date }} · {{ money(totalSummary.bestDay.total) }}</em>
          <em v-else class="neutral">暂无峰值</em>
        </article>
      </section>

      <section class="panel-grid chart-grid">
        <div class="panel">
          <div class="panel-head">
            <h2>销售趋势</h2>
            <el-radio-group :model-value="granularity" size="small" @update:model-value="changeGranularity">
              <el-radio-button v-for="option in granularityOptions" :key="option.value" :label="option.value">
                {{ option.label }}
              </el-radio-button>
            </el-radio-group>
          </div>
          <div ref="trendChartEl" class="chart-box"></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>销售构成</h2></div>
          <div ref="countChartEl" class="chart-box"></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>月度销售额排行</h2>
          <span class="panel-note">按销售额从低到高排列</span>
        </div>
        <div ref="compareChartEl" class="chart-box chart-box--tall"></div>
      </section>

      <section class="panel-grid">
        <div class="panel">
          <div class="panel-head"><h2>月度对比</h2></div>
          <el-table :data="monthRows" size="small" empty-text="暂无数据">
            <el-table-column prop="period" label="月份" width="100" />
            <el-table-column label="销售额" min-width="120">
              <template #default="{ row }">{{ money(row.total) }}</template>
            </el-table-column>
            <el-table-column prop="count" label="笔数" width="70" />
            <el-table-column label="环比" width="90">
              <template #default="{ row }">
                <span :class="['change', percentClass(row.changePercent)]">{{ percentText(row.changePercent) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>季度 / 年度</h2></div>
          <el-table :data="quarterRows" size="small" empty-text="暂无数据">
            <el-table-column prop="period" label="季度" width="110" />
            <el-table-column label="销售额" min-width="120">
              <template #default="{ row }">{{ money(row.total) }}</template>
            </el-table-column>
            <el-table-column prop="count" label="笔数" width="70" />
            <el-table-column label="环比" width="90">
              <template #default="{ row }">
                <span :class="['change', percentClass(row.changePercent)]">{{ percentText(row.changePercent) }}</span>
              </template>
            </el-table-column>
          </el-table>
          <el-table :data="yearRows" size="small" class="year-table" empty-text="暂无数据">
            <el-table-column prop="period" label="年度" width="110" />
            <el-table-column label="销售额" min-width="120">
              <template #default="{ row }">{{ money(row.total) }}</template>
            </el-table-column>
            <el-table-column prop="count" label="笔数" width="70" />
            <el-table-column label="同比" width="90">
              <template #default="{ row }">
                <span :class="['change', percentClass(row.changePercent)]">{{ percentText(row.changePercent) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>销售明细</h2>
          <span class="panel-note">共 {{ recordTotal }} 条 · 可展开查看商品明细</span>
        </div>
        <el-table :data="records" size="small" row-key="id" empty-text="所选区间暂无销售记录">
          <el-table-column type="expand">
            <template #default="scope">
              <div class="record-items-panel">
                <template v-if="scope.row.items && scope.row.items.length">
                  <div class="record-items-head">商品明细（{{ scope.row.items.length }} 项）</div>
                  <el-table :data="scope.row.items" size="small" border>
                    <el-table-column type="index" label="#" width="48" />
                    <el-table-column prop="name" label="商品名称" min-width="180" show-overflow-tooltip />
                    <el-table-column prop="qty" label="数量" width="80" />
                    <el-table-column label="单价" width="110">
                      <template #default="r">{{ r.row.unitPrice ? money(r.row.unitPrice) : '—' }}</template>
                    </el-table-column>
                    <el-table-column label="小计" width="120">
                      <template #default="r">{{ money(r.row.subtotal) }}</template>
                    </el-table-column>
                  </el-table>
                </template>
                <div v-else class="record-items-empty">该笔销售未记录商品明细</div>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="id" label="编号" width="80">
            <template #default="{ row }">#{{ row.id }}</template>
          </el-table-column>
          <el-table-column prop="saleDate" label="销售日期" width="120" />
          <el-table-column label="金额" width="140">
            <template #default="{ row }">{{ money(row.amount) }}</template>
          </el-table-column>
          <el-table-column label="明细" width="90">
            <template #default="{ row }">
              <span class="record-items-badge">{{ row.items?.length || 0 }} 项</span>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="记录时间" min-width="160" />
        </el-table>
        <div class="record-pager">
          <el-pagination
            :current-page="recordPage"
            :page-size="recordPageSize"
            :total="recordTotal"
            layout="prev, pager, next, total"
            small
            @current-change="changeRecordPage"
          />
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>商品销售额排行</h2>
          <span class="panel-note">来自付款凭证 OCR 识别的商品明细，图表展示销售额前 {{ ITEM_TOP_COUNT }} 名</span>
        </div>
        <div ref="itemChartEl" class="chart-box chart-box--items"></div>
        <el-table :data="itemRows" size="small" empty-text="暂无商品明细数据（识别销售票据后自动累积）">
          <el-table-column type="index" label="#" width="56" />
          <el-table-column label="商品名称" min-width="160">
            <template #default="{ row }">
              <span class="item-model" :title="row.fullName">{{ row.model }}</span>
            </template>
          </el-table-column>
          <el-table-column label="配置" min-width="200">
            <template #default="{ row }">
              <span class="item-config" :title="row.fullName">{{ row.config || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="qty" label="数量" width="80" />
          <el-table-column prop="occurrences" label="出现次数" width="90" />
          <el-table-column label="销售额" width="130">
            <template #default="{ row }">{{ money(row.total) }}</template>
          </el-table-column>
        </el-table>
      </section>
    </div>
  </div>
</template>
