<template>
  <main class="app-shell ls-theme">
    <aside class="control-panel">
      <header class="brand-header"><img class="brand-logo ls-brand-logo" :src="logoUrl" alt="联想" /><div><h1>付款凭证打印</h1><p>存根、小票与销售记录</p></div></header>
      <section class="today-card">
        <div class="today-card__header"><span class="section-eyebrow">今日销售</span><span class="today-date">{{ displayToday }}</span></div>
        <div class="today-metrics"><div class="metric"><span class="metric__label">销售笔数</span><strong>{{ todayStats.count }}</strong><span class="metric__unit">笔</span></div><div class="metric-divider"></div><div class="metric metric--amount"><span class="metric__label">销售总额</span><strong>{{ money(todayStats.total) }}</strong></div></div>
      </section>
      <section class="panel-section">
        <div class="section-heading"><div><span class="section-eyebrow section-eyebrow--dark">快速记账</span><h2>录入销售金额</h2></div><span class="auto-date">自动记录当日</span></div>
        <div class="amount-row"><el-input-number v-model="saleAmount" :min="0.01" :precision="2" :step="100" :controls="false" class="amount-input" placeholder="0.00" @input="markAmountEdited" @keyup.enter="saveSale"/><el-button type="primary" :loading="saving" class="save-button" @click="saveSale">保存记录</el-button></div>
        <div :class="['ocr-hint', `ocr-hint--${ocrMessageType}`]" aria-live="polite"><span v-if="recognizing" class="ocr-spinner"></span><span>{{ ocrMessage }}</span><el-button v-if="currentHistoryId" link type="primary" class="ocr-result-link" @click="openHistoryDetail(currentHistoryId)">查看识别结果</el-button></div>
      </section>
      <section class="action-grid"><el-button class="action-button action-button--print" @click="printPreview">打印凭证</el-button><el-button class="action-button" @click="clearImages">清除图片</el-button><el-button class="action-button action-button--download" :loading="downloading" @click="downloadCombined">下载组合图</el-button></section>
      <section class="panel-section ocr-management-section">
        <div class="section-heading section-heading--compact"><div><span class="section-eyebrow section-eyebrow--dark">文字识别</span><h2>百度 OCR 管理</h2></div><span :class="['ocr-config-state',{ 'is-ready':ocrConfig.configured }]">{{ ocrConfig.configured ? '已配置':'未配置' }}</span></div>
        <p class="ocr-config-summary">{{ ocrConfig.configured ? `API Key：${ocrConfig.apiKeyMasked} · ${ocrConfigSourceLabel}` : '请先配置百度智能云文字识别应用凭据' }}</p>
        <div v-loading="usageLoading" class="ocr-quota-card">
          <div class="ocr-quota-heading"><span>{{ usageMonthLabel }}免费额度</span><strong>{{ ocrUsage.remaining }}<small> / {{ ocrUsage.limit }} 次剩余</small></strong></div>
          <el-progress :percentage="usagePercentage" :stroke-width="7" :show-text="false" :status="ocrUsage.overage > 0 ? 'exception' : undefined" />
          <p>本机已记录 {{ ocrUsage.used }} 次 OCR 调用<span v-if="ocrUsage.overage > 0">，超出免费额度 {{ ocrUsage.overage }} 次</span>；删除识别记录不会返还次数。</p>
        </div>
        <div class="ocr-management-actions"><el-button plain @click="openConfig">配置凭据</el-button><el-button plain @click="openHistory">识别记录</el-button></div>
      </section>
      <section class="panel-section records-section">
        <div class="section-heading section-heading--compact"><div><span class="section-eyebrow section-eyebrow--dark">销售明细</span><h2>最近记录</h2></div><span class="record-count">共 {{ sales.length }} 条</span></div>
        <el-table v-loading="loading" :data="sales" height="260" class="sales-table" empty-text="暂无销售记录" row-key="id">
          <el-table-column prop="sale_date" label="日期" width="108"/><el-table-column label="金额" min-width="104"><template #default="scope"><span :class="['table-amount',{ 'is-cancelled':scope.row.status===0 }]">{{ money(scope.row.amount) }}</span></template></el-table-column>
          <el-table-column label="状态" width="72" align="center"><template #default="scope"><span :class="['status-pill',scope.row.status===1?'status-pill--active':'status-pill--cancelled']">{{ scope.row.status===1?'正常':'已撤销' }}</span></template></el-table-column>
          <el-table-column label="操作" width="66" align="right"><template #default="scope"><el-button link :type="scope.row.status===1?'danger':'primary'" :loading="togglingSaleIds.has(scope.row.id)" :disabled="togglingSaleIds.has(scope.row.id)" @click="toggleSale(scope.row)">{{ scope.row.status===1?'撤销':'恢复' }}</el-button></template></el-table-column>
        </el-table>
      </section>
      <section v-loading="trendRefreshing" class="panel-section chart-section">
        <div class="section-heading section-heading--compact">
          <div><span class="section-eyebrow section-eyebrow--dark">销售趋势</span><h2>近 30 天销售额走势</h2></div>
          <el-button link type="primary" :disabled="trendRefreshing" @click="refreshTrend">刷新趋势</el-button>
        </div>
        <div class="trend-summary" aria-label="近30天销售汇总">
          <div><span>累计销售额</span><strong>{{ money(trendSummary.total) }}</strong></div>
          <div><span>有效销售</span><strong>{{ trendSummary.count }} 笔</strong></div>
        </div>
        <div class="trend-toolbar" aria-label="趋势图显示范围">
          <span>显示范围</span>
          <div class="trend-range-switch" role="group" aria-label="选择趋势图显示天数">
            <button v-for="days in [7,14,30]" :key="days" type="button" :class="{ 'is-active':trendRange===days }" :aria-pressed="trendRange===days" @click="trendRange=days">{{ days }} 天</button>
          </div>
          <span class="chart-click-hint">悬浮看数值 · 点击看明细</span>
        </div>
        <div class="trend-chart">
          <div
            ref="trendChartElement"
            class="trend-echart"
            role="group"
            tabindex="0"
            aria-label="销售额趋势曲线图。鼠标悬浮可查看数值；使用左右方向键选择日期，Home 和 End 跳转，Enter 或空格打开当日明细。"
            :aria-describedby="trendChartDescriptionId"
            @keydown="handleTrendKeydown"
          ></div>
          <p :id="trendChartDescriptionId" class="visually-hidden" aria-live="polite">{{ trendA11yDescription }}</p>
          <div v-if="!hasTrendData && !trendLoadError" class="chart-empty-overlay" role="status"><strong>近 {{ trendRange }} 天暂无有效销售</strong><span>仍可点击日期或使用键盘查看当日撤销记录。</span></div>
          <div v-if="trendLoadError" class="chart-error" role="alert"><strong>趋势数据加载失败</strong><span>{{ trendLoadError }}</span><el-button size="small" @click="refreshTrend">重新加载</el-button></div>
          <p class="chart-usage-tip">曲线仅表示销售额；鼠标悬浮可查看当日金额和有效笔数，点击图表可打开当日明细。</p>
          <label class="trend-date-picker">
            <span>按日期查看明细</span>
            <select :value="selectedTrendDate || ''" aria-label="选择销售趋势日期" @change="selectTrendDate">
              <option value="">请选择日期</option>
              <option v-for="item in trend" :key="item.date" :value="item.date">{{ item.date }} · {{ money(item.total) }} · {{ item.count || 0 }} 笔</option>
            </select>
          </label>
        </div>
      </section>
    </aside>
    <section class="preview-workspace">
      <header class="preview-header"><div><span class="section-eyebrow section-eyebrow--blue">打印预览</span><h2>A4 组合排版</h2><p>将存根与购物小票并排放置，图片会自动等比缩放</p></div><div class="paper-badge"><span></span>A4 · 210 × 297 mm</div></header>
      <div class="paper-stage"><div class="a4-preview">
        <div v-for="side in ['stub','receipt']" :key="side" :class="['image-zone',{ 'image-zone--dragging':draggingSide===side }]" role="button" tabindex="0" @click="pick(side)" @keydown.enter="pick(side)" @keydown.space.prevent="pick(side)" @dragenter.prevent="draggingSide=side" @dragover.prevent @dragleave.prevent="draggingSide=null" @drop.prevent="drop(side,$event)"><img v-if="images[side]" :src="images[side]" :alt="side==='stub'?'商务存根预览':'购物小票预览'"/><div v-else class="upload-placeholder"><div class="upload-mark">+</div><strong>{{ side==='stub'?'商务存根':'购物小票' }}</strong><span>拖入图片或点击上传</span><small>支持 JPG、PNG、WEBP</small></div></div>
      </div></div>
      <input ref="stubInput" type="file" accept="image/*" hidden @change="selected('stub',$event)"/><input ref="receiptInput" type="file" accept="image/*" hidden @change="selected('receipt',$event)"/>
    </section>
    <el-dialog v-model="trendDetailVisible" :title="trendDetailTitle" width="min(760px,94vw)" @closed="closeTrendDetail">
      <div class="trend-detail-summary">
        <div><span>有效销售额</span><strong>{{ money(selectedTrend?.total) }}</strong></div>
        <div><span>有效销售</span><strong>{{ selectedTrend?.count || 0 }} 笔</strong></div>
        <div><span>全部记录</span><strong>{{ selectedTrendSales.length }} 条</strong></div>
        <div><span>已撤销</span><strong>{{ selectedCancelledSales.length }} 条</strong></div>
      </div>
      <p class="trend-detail-note">趋势汇总只统计状态为“正常”的记录；下表同时列出当日已撤销记录。</p>
      <el-table :data="selectedTrendSales" max-height="420" row-key="id" empty-text="当日暂无销售记录" class="trend-detail-table">
        <el-table-column prop="id" label="编号" width="76"><template #default="scope">#{{ scope.row.id }}</template></el-table-column>
        <el-table-column label="记录时间" min-width="168"><template #default="scope">{{ historyTime(scope.row.created_at) }}</template></el-table-column>
        <el-table-column label="金额" min-width="116"><template #default="scope"><span :class="['table-amount',{ 'is-cancelled':scope.row.status===0 }]">{{ money(scope.row.amount) }}</span></template></el-table-column>
        <el-table-column label="状态" width="84" align="center"><template #default="scope"><span :class="['status-pill',scope.row.status===1?'status-pill--active':'status-pill--cancelled']">{{ scope.row.status===1?'正常':'已撤销' }}</span></template></el-table-column>
        <el-table-column label="操作" width="76" align="right"><template #default="scope"><el-button link :type="scope.row.status===1?'danger':'primary'" :loading="togglingSaleIds.has(scope.row.id)" :disabled="togglingSaleIds.has(scope.row.id)" @click.stop="toggleSale(scope.row)">{{ scope.row.status===1?'撤销':'恢复' }}</el-button></template></el-table-column>
      </el-table>
    </el-dialog>
    <el-dialog v-model="configVisible" title="配置百度智能云文字识别" width="min(500px,92vw)" :close-on-click-modal="!configSaving" @close="resetConfigForm"><div class="ocr-config-dialog-summary"><span :class="['ocr-config-state',{ 'is-ready':ocrConfig.configured }]">{{ ocrConfig.configured?'当前已配置':'当前未配置' }}</span><span v-if="ocrConfig.configured">{{ ocrConfig.apiKeyMasked }}</span></div><el-alert title="凭据仅发送到当前门店后端，Secret Key 不会回显；留空字段将保留现有值。" type="info" :closable="false" show-icon/><el-form label-position="top" class="ocr-config-form"><el-form-item label="API Key"><el-input v-model="configForm.apiKey" :placeholder="ocrConfig.configured?'留空以保留当前 API Key':'请输入 API Key'"/></el-form-item><el-form-item label="Secret Key"><el-input v-model="configForm.secretKey" type="password" show-password autocomplete="new-password" :placeholder="ocrConfig.hasSecretKey?'留空以保留当前 Secret Key':'请输入 Secret Key'"/></el-form-item></el-form><p class="ocr-config-security-note">保存前会向百度验证凭据；数据库仅保存 AES-256-GCM 密文。此系统无登录功能，只能部署在可信门店内网。</p><template #footer><el-button @click="configVisible=false">取消</el-button><el-button type="primary" :loading="configSaving" @click="saveConfig">验证并保存</el-button></template></el-dialog>
    <el-dialog v-model="historyVisible" title="OCR 识别记录" width="min(980px,96vw)" @close="cancelHistory">
      <div class="ocr-history-toolbar">
        <div><strong>{{ usageMonthLabel }}剩余 {{ ocrUsage.remaining }} 次</strong><span>已用 {{ ocrUsage.used }} / 免费 {{ ocrUsage.limit }} 次 · 按百度 OCR endpoint 调用统计</span></div>
        <div class="ocr-history-export-actions"><el-button size="small" :loading="exportingFormat==='csv'" :disabled="Boolean(exportingFormat)" @click="exportHistory('csv')">导出 CSV</el-button><el-button size="small" :loading="exportingFormat==='json'" :disabled="Boolean(exportingFormat)" @click="exportHistory('json')">导出 JSON</el-button></div>
      </div>
      <p class="ocr-history-note">记录可查看、导出或删除；删除仅清理本机展示历史，不会返还已经调用百度 OCR 的次数。额度为本机自本功能启用后记录的估算值，不是百度账号权威账单。</p>
      <el-table v-loading="historyLoading" :data="history.items" height="420" row-key="id" @row-click="row=>openHistoryDetail(row.id)">
        <el-table-column label="时间" min-width="155"><template #default="s">{{ historyTime(s.row.createdAt) }}</template></el-table-column><el-table-column label="状态" width="84"><template #default="s"><span :class="['history-status',`history-status--${s.row.status}`]">{{ statusLabel(s.row.status) }}</span></template></el-table-column><el-table-column label="金额" width="110"><template #default="s">{{ s.row.amount?money(s.row.amount):'—' }}</template></el-table-column><el-table-column prop="matchedText" label="命中文本" min-width="180" show-overflow-tooltip/><el-table-column label="耗时" width="86"><template #default="s">{{ s.row.durationMs }}ms</template></el-table-column><el-table-column label="操作" width="76" align="right"><template #default="s"><el-button link type="danger" :loading="deletingHistoryIds.has(s.row.id)" :disabled="deletingHistoryIds.size > 0" @click.stop="deleteHistory(s.row)">删除</el-button></template></el-table-column>
      </el-table>
      <div class="ocr-history-pagination"><el-pagination background layout="total, prev, pager, next" :total="history.total" :page-size="history.pageSize" :current-page="history.page" @current-change="loadHistory"/></div>
    </el-dialog>
    <el-dialog v-model="detailVisible" title="识别结果详情" width="min(680px,94vw)" @close="cancelDetail"><div v-loading="detailLoading" class="ocr-detail"><template v-if="detail"><div class="ocr-detail-grid"><div><span>记录编号</span><strong>#{{ detail.id }}</strong></div><div><span>识别时间</span><strong>{{ historyTime(detail.createdAt) }}</strong></div><div><span>状态</span><strong>{{ statusLabel(detail.status) }}</strong></div><div><span>耗时</span><strong>{{ detail.durationMs }}ms</strong></div><div><span>识别金额</span><strong>{{ detail.amount?money(detail.amount):'—' }}</strong></div><div><span>文字行数</span><strong>{{ detail.wordsCount }}</strong></div></div><div v-if="detail.matchedText" class="ocr-detail-block"><span>金额命中文本</span><p>{{ detail.matchedText }}</p></div><div v-if="detail.errorMessage" class="ocr-detail-block ocr-detail-block--error"><span>失败原因（{{ detail.errorCode||detail.httpStatus }}）</span><p>{{ detail.errorMessage }}</p></div><div class="ocr-detail-block"><span>百度 OCR 识别文字</span><pre>{{ detail.recognizedText||'未返回可保存的识别文字' }}</pre></div></template></div></el-dialog>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { init, use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg'
import { ApiError, request } from './api.js'

use([LineChart, AriaComponent, GridComponent, TooltipComponent])
use([CanvasRenderer])

const images=reactive({stub:null,receipt:null}); const decoded=reactive({stub:null,receipt:null}); const readVersions=reactive({stub:0,receipt:0})
const stubInput=ref(); const receiptInput=ref(); const draggingSide=ref(null); const saleAmount=ref(null); const sales=ref([]); const trend=ref([]); const todayStats=ref({count:0,total:0})
const loading=ref(false); const saving=ref(false); const downloading=ref(false); const recognizing=ref(false); const ocrMessage=ref('上传两张图片后自动识别销售金额'); const ocrMessageType=ref('neutral'); const currentHistoryId=ref(null)
const ocrConfig=ref({configured:false,apiKeyMasked:'',hasSecretKey:false,source:'none',version:0,updatedAt:null,storageError:false}); const configVisible=ref(false); const configSaving=ref(false); const configForm=reactive({apiKey:'',secretKey:''})
const historyVisible=ref(false); const historyLoading=ref(false); const history=ref({items:[],total:0,page:1,pageSize:10,totalPages:1}); const detailVisible=ref(false); const detailLoading=ref(false); const detail=ref(null)
const usageLoading=ref(false); const ocrUsage=ref({month:'',timezone:'Asia/Shanghai',limit:500,used:0,remaining:500,overage:0,trackingSince:null,basis:'local-ocr-endpoint-attempts'}); const exportingFormat=ref(''); const deletingHistoryIds=reactive(new Set())
const trendDetailVisible=ref(false); const selectedTrendDate=ref(null); const trendChartElement=ref(null); const trendRange=ref(30); const trendRefreshing=ref(false); const trendLoadError=ref(''); const togglingSaleIds=reactive(new Set())
let trendChart=null,trendResizeObserver=null
let ocrController=null, ocrRequestId=0, amountEditVersion=0, amountManuallyEdited=false, historyController=null, historyRequestId=0, detailController=null, detailRequestId=0, usageRequestId=0, releasePrint=null
const displayToday=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'short'}).format(new Date())
const money=value=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2}).format(Number(value)||0)
const ocrConfigSourceLabel=computed(()=>ocrConfig.value.source==='database'?'页面持久化配置':ocrConfig.value.source==='environment'?'后端环境配置':'未配置')
const usagePercentage=computed(()=>{const limit=Math.max(1,Number(ocrUsage.value.limit)||500);return Math.min(100,Math.max(0,Math.round((Number(ocrUsage.value.used)||0)/limit*100)))})
const usageMonthLabel=computed(()=>{const match=/^(\d{4})-(\d{2})$/.exec(ocrUsage.value.month||'');return match?`${match[1]}年${Number(match[2])}月`:'本月'})
const trendChartDescriptionId='sales-trend-chart-description'
const compactMoney=value=>{const amount=Math.max(0,Number(value)||0);if(amount>=10000){const scaled=amount/10000;return `¥${scaled>=10?scaled.toFixed(0):scaled.toFixed(1)}万`}return `¥${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:amount<100?2:0}).format(amount)}`}
const trendSummary=computed(()=>trend.value.reduce((summary,item)=>({total:summary.total+(Number(item.total)||0),count:summary.count+(Number(item.count)||0)}),{total:0,count:0}))
const hasTrendData=computed(()=>trendSummary.value.count>0)
const visibleTrend=computed(()=>trend.value.slice(-trendRange.value))
const selectedTrend=computed(()=>trend.value.find(item=>item.date===selectedTrendDate.value)||null)
const selectedTrendSales=computed(()=>sales.value.filter(item=>item.sale_date===selectedTrendDate.value))
const selectedCancelledSales=computed(()=>selectedTrendSales.value.filter(item=>item.status===0))
const trendDetailTitle=computed(()=>selectedTrendDate.value?`${selectedTrendDate.value} 销售趋势详情`:'销售趋势详情')
const trendA11yDescription=computed(()=>{const selected=selectedTrend.value;if(selected)return `${selected.date}，有效销售额 ${money(selected.total)}，有效销售 ${selected.count||0} 笔。按 Enter 查看详情。`;return `近30天累计销售额 ${money(trendSummary.value.total)}，有效销售 ${trendSummary.value.count} 笔。`})
const prefersReducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true
const escapeTooltipText=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]))
function chartOption(){
  const data=visibleTrend.value
  const dates=data.map(item=>item.date)
  return {
    animation:!prefersReducedMotion(),animationDuration:320,
    aria:{enabled:true,label:{description:`近${trendRange.value}天销售额趋势，累计销售额${money(trendSummary.value.total)}，有效销售${trendSummary.value.count}笔。`}},
    tooltip:{
      trigger:'axis',confine:true,transitionDuration:0,backgroundColor:'rgba(255,255,255,.98)',borderColor:'#dce5ee',borderWidth:1,padding:[11,13],extraCssText:'border-radius:10px;box-shadow:0 10px 28px rgba(20,44,70,.14);',textStyle:{color:'#172033',fontSize:12},
      axisPointer:{type:'line',snap:true,lineStyle:{color:'#8aa9c3',width:1}},
      formatter(params){const index=params?.[0]?.dataIndex??0;const item=data[index];if(!item)return '';return `<div style="min-width:148px"><div style="margin-bottom:6px;color:#6b7b8e;font-size:11px">${escapeTooltipText(item.date)}</div><div style="color:#173b5d;font-size:18px;font-weight:750;line-height:1.2">${money(item.total)}</div><div style="margin-top:7px;color:#56687b;font-size:11px">有效销售 ${item.count||0} 笔 · 点击查看明细</div></div>`}
    },
    grid:{left:58,right:20,top:22,bottom:40,containLabel:false},
    xAxis:{type:'category',boundaryGap:false,data:dates,axisLine:{lineStyle:{color:'#d8e1ea'}},axisTick:{show:false},axisLabel:{margin:12,color:'#77879a',fontSize:10,hideOverlap:true,formatter:value=>value.slice(5),interval:Math.max(0,Math.ceil(data.length/6)-1)}},
    yAxis:{type:'value',min:0,splitNumber:3,axisLine:{show:false},axisTick:{show:false},axisLabel:{margin:12,color:'#77879a',fontSize:10,formatter:compactMoney},splitLine:{lineStyle:{color:'#e9eef4',width:1}}},
    series:[{
      name:'销售额',type:'line',smooth:.4,showSymbol:false,symbol:'none',connectNulls:true,
      lineStyle:{width:3,color:'#1a5e9c',cap:'round',join:'round'},
      emphasis:{disabled:true},
      data:data.map(item=>Number(item.total)||0)
    }]
  }
}
function renderTrendChart(){if(!trendChart)return;trendChart.setOption(chartOption(),{notMerge:true,lazyUpdate:false})}
function showTrendTooltip(date){const index=visibleTrend.value.findIndex(item=>item.date===date);if(index<0||!trendChart)return;trendChart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:index})}
function selectTrendForKeyboard(index){const data=visibleTrend.value;if(!data.length)return;const safeIndex=Math.max(0,Math.min(data.length-1,index));selectedTrendDate.value=data[safeIndex].date;nextTick(()=>showTrendTooltip(data[safeIndex].date))}
function handleTrendKeydown(event){const data=visibleTrend.value;if(!data.length)return;const selectedIndex=data.findIndex(item=>item.date===selectedTrendDate.value),currentIndex=selectedIndex>=0?selectedIndex:data.length-1;if(event.key==='ArrowLeft'){event.preventDefault();selectTrendForKeyboard(currentIndex-1)}else if(event.key==='ArrowRight'){event.preventDefault();selectTrendForKeyboard(selectedIndex>=0?currentIndex+1:data.length-1)}else if(event.key==='Home'){event.preventDefault();selectTrendForKeyboard(0)}else if(event.key==='End'){event.preventDefault();selectTrendForKeyboard(data.length-1)}else if((event.key==='Enter'||event.key===' ')&&selectedIndex>=0){event.preventDefault();openTrendDetail(selectedTrendDate.value)}}
function initializeTrendChart(){
  if(!trendChartElement.value||trendChart)return
  trendChart=init(trendChartElement.value,null,{renderer:'canvas'})
  trendChart.getZr().on('click',event=>{const point=[event.offsetX,event.offsetY];if(!trendChart?.containPixel({gridIndex:0},point))return;let nearest=null,distance=Infinity;visibleTrend.value.forEach(item=>{const x=trendChart.convertToPixel({xAxisIndex:0},item.date);const nextDistance=Math.abs(x-event.offsetX);if(nextDistance<distance){nearest=item;distance=nextDistance}});if(nearest)openTrendDetail(nearest.date)})
  trendResizeObserver=new ResizeObserver(()=>trendChart?.resize())
  trendResizeObserver.observe(trendChartElement.value)
  renderTrendChart()
}
function disposeTrendChart(){trendResizeObserver?.disconnect();trendResizeObserver=null;trendChart?.dispose();trendChart=null}
const statusLabel=status=>status==='success'?'成功':status==='cancelled'?'已取消':'失败'
const historyTime=value=>{if(!value)return '—';const date=new Date(`${String(value).replace(' ','T')}Z`);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'medium',hour12:false}).format(date)}
const message=(error,fallback)=>error instanceof ApiError?error.message:fallback
const markAmountEdited=()=>{amountManuallyEdited=true;amountEditVersion+=1}
function openTrendDetail(date){if(!date)return;selectedTrendDate.value=date;trendDetailVisible.value=true;nextTick(()=>showTrendTooltip(date))}
function selectTrendDate(event){openTrendDetail(event.target.value)}
function closeTrendDetail(){selectedTrendDate.value=null;trendChart?.dispatchAction({type:'hideTip'})}
function applySaleStatusChange(originalStatus,updated){if(originalStatus===updated.status)return;const direction=updated.status===1?1:-1,amount=Number(updated.amount)||0;trend.value=trend.value.map(item=>item.date===updated.sale_date?{...item,count:Math.max(0,(Number(item.count)||0)+direction),total:Math.max(0,Math.round(((Number(item.total)||0)+direction*amount)*100)/100)}:item);const todayDate=trend.value.at(-1)?.date;if(updated.sale_date===todayDate)todayStats.value={count:Math.max(0,(Number(todayStats.value.count)||0)+direction),total:Math.max(0,Math.round(((Number(todayStats.value.total)||0)+direction*amount)*100)/100)}}

async function fetchConfig(){ocrConfig.value=await request('/ocr/config')}
async function loadUsage(){const id=++usageRequestId;usageLoading.value=true;try{const data=await request('/ocr/usage');if(id===usageRequestId)ocrUsage.value=data;return data}finally{if(id===usageRequestId)usageLoading.value=false}}
async function refresh(){trendLoadError.value='';try{const [all,today,last30]=await Promise.all([request('/sales'),request('/sales/today'),request('/sales/trend')]);sales.value=all;todayStats.value=today;trend.value=last30}catch(error){trendLoadError.value='无法获取最新销售统计，请检查服务后重试';throw error}}
async function refreshTrend(){if(trendRefreshing.value)return;trendRefreshing.value=true;try{await refresh();ElMessage.success('销售趋势已刷新')}catch(e){ElMessage.error(message(e,'销售趋势刷新失败'))}finally{trendRefreshing.value=false}}
async function saveSale(){const amount=Number(saleAmount.value);if(!Number.isFinite(amount)||amount<=0)return ElMessage.warning('请输入大于 0 的销售金额');saving.value=true;try{await request('/sales',{method:'POST',body:{amount}});saleAmount.value=null;amountManuallyEdited=false;ElMessage.success('销售记录已保存')}catch(e){ElMessage.error(message(e,'保存失败，请检查后端服务'));saving.value=false;return}try{await refresh()}catch{ElMessage.warning('记录已保存，但统计刷新失败，请稍后刷新页面')}finally{saving.value=false}}
async function toggleSale(sale){if(togglingSaleIds.has(sale.id))return;togglingSaleIds.add(sale.id);const originalStatus=sale.status;try{const updated=await request(`/sales/${sale.id}/toggle`,{method:'PUT'});Object.assign(sale,updated);applySaleStatusChange(originalStatus,updated);ElMessage.success(originalStatus===1?'记录已撤销':'记录已恢复');try{await refresh()}catch{ElMessage.warning('状态已更新，本页汇总已同步；服务器统计刷新失败，请稍后重试')}}catch(e){ElMessage.error(message(e,'操作失败，请稍后重试'))}finally{togglingSaleIds.delete(sale.id)}}
function pick(side){(side==='stub'?stubInput.value:receiptInput.value)?.click()}
function drop(side,event){draggingSide.value=null;readImage(side,event.dataTransfer.files[0])}
function selected(side,event){readImage(side,event.target.files[0]);event.target.value=''}
function cancelOcr(){ocrRequestId+=1;ocrController?.abort();ocrController=null;recognizing.value=false;currentHistoryId.value=null}
function readImage(side,file){if(!file?.type.startsWith('image/'))return ElMessage.warning('请选择有效的图片文件');if(file.size>20*1024*1024)return ElMessage.warning('单张图片不能超过 20MB');cancelOcr();const version=++readVersions[side];ocrMessage.value='正在读取图片...';ocrMessageType.value='loading';const reader=new FileReader();reader.onload=async event=>{if(version!==readVersions[side])return;const image=new Image();image.src=event.target.result;try{await image.decode();if(version!==readVersions[side])return;images[side]=event.target.result;decoded[side]=image;void recognize()}catch{ElMessage.error('图片读取失败，请重新选择')}};reader.onerror=()=>ElMessage.error('图片读取失败，请重新选择');reader.readAsDataURL(file)}
function clearImages(){if(!images.stub&&!images.receipt)return ElMessage.info('预览区暂无图片');readVersions.stub+=1;readVersions.receipt+=1;cancelOcr();images.stub=images.receipt=decoded.stub=decoded.receipt=null;ocrMessage.value='上传两张图片后自动识别销售金额';ocrMessageType.value='neutral';ElMessage.success('图片已清除')}
function ensureImages(){if(!decoded.stub||!decoded.receipt){ElMessage.warning('请先上传存根和小票两张图片');return false}return true}
function drawContain(context,image,x,y,width,height,alignBottom=false){const scale=Math.min(width/image.naturalWidth,height/image.naturalHeight);const w=image.naturalWidth*scale,h=image.naturalHeight*scale;context.drawImage(image,x+(width-w)/2,alignBottom?y+height-h:y,w,h)}
function renderCanvas(width=2480,{divider=false}={}){if(!decoded.stub||!decoded.receipt)throw new Error('图片尚未准备完成');const height=Math.round(width*297/210),half=width/2,pad=width*.03158,receiptTop=width*.11184;const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);drawContain(ctx,decoded.stub,pad,pad,half-pad*2,height-pad,true);drawContain(ctx,decoded.receipt,half+pad,receiptTop,half-pad*2,height-receiptTop-pad,false);if(divider){ctx.strokeStyle='#d9dfe8';ctx.setLineDash([8,8]);ctx.beginPath();ctx.moveTo(half,0);ctx.lineTo(half,height);ctx.stroke()}return canvas}
const blob=(canvas,type='image/png',quality)=>new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('组合图片生成失败')),type,quality))
async function recognize(){const id=++ocrRequestId;ocrController?.abort();if(!decoded.stub||!decoded.receipt){ocrMessage.value='请继续上传另一张图片，上传完成后将自动识别金额';ocrMessageType.value='neutral';return}const controller=new AbortController();ocrController=controller;const editAtStart=amountEditVersion,manualAtStart=amountManuallyEdited;recognizing.value=true;ocrMessage.value='正在合成票据并识别金额...';ocrMessageType.value='loading';try{const imageBlob=await blob(renderCanvas(1600),'image/jpeg',.88);const data=await request('/ocr/amount',{method:'POST',body:imageBlob,headers:{'Content-Type':'image/jpeg'},signal:controller.signal,timeout:45000});if(id!==ocrRequestId)return;const amount=Number(data.amount);if(!Number.isFinite(amount)||amount<=0)throw new Error('OCR 返回了无效金额');currentHistoryId.value=data.historyId||null;if(!manualAtStart&&!amountManuallyEdited&&amountEditVersion===editAtStart){saleAmount.value=amount;ocrMessage.value=`已自动识别金额：${money(amount)}`;ocrMessageType.value='success';ElMessage.success('票据金额已自动填入')}else{ocrMessage.value=`识别金额为 ${money(amount)}，已保留手动输入的金额`;ocrMessageType.value='warning'}}catch(e){if(id!==ocrRequestId||controller.signal.aborted)return;currentHistoryId.value=e.data?.historyId||null;ocrMessage.value=message(e,'金额识别失败，请手动输入');ocrMessageType.value='error'}finally{if(id===ocrRequestId){recognizing.value=false;ocrController=null;if(historyVisible.value&&currentHistoryId.value)void loadHistory(history.value.page);void loadUsage().catch(()=>{})}}}
async function printPreview(){if(!ensureImages())return;releasePrint?.();let frame,url;const cleanup=()=>{frame?.remove();if(url)URL.revokeObjectURL(url);if(releasePrint===cleanup)releasePrint=null};try{url=URL.createObjectURL(await blob(renderCanvas(2480)));frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:1px;height:1px;border:0';document.body.appendChild(frame);const doc=frame.contentDocument;doc.open();doc.write(`<!doctype html><style>@page{size:A4 portrait;margin:0}html,body{width:209mm;height:296mm;margin:0;overflow:hidden}img{display:block;width:100%;height:100%;object-fit:contain}</style><img id="print" src="${url}">`);doc.close();const image=doc.querySelector('#print');await image.decode();releasePrint=cleanup;frame.contentWindow.focus();frame.contentWindow.print()}catch{cleanup();ElMessage.error('打印内容生成失败，请稍后重试')}}
async function downloadCombined(){if(!ensureImages())return;downloading.value=true;try{const canvas=renderCanvas(2480,{divider:true});const link=document.createElement('a');const now=new Date();const stamp=[now.getFullYear(),now.getMonth()+1,now.getDate(),now.getHours(),now.getMinutes(),now.getSeconds()].map((v,i)=>i?String(v).padStart(2,'0'):v).join('');link.download=`票据${stamp}.png`;link.href=canvas.toDataURL('image/png');link.click();ElMessage.success('组合图已下载')}catch{ElMessage.error('组合图生成失败，请重试')}finally{downloading.value=false}}
function resetConfigForm(){configForm.apiKey='';configForm.secretKey=''}
async function openConfig(){try{await fetchConfig();resetConfigForm();configVisible.value=true}catch(e){ElMessage.error(message(e,'OCR 配置状态加载失败'))}}
async function saveConfig(){const apiKey=configForm.apiKey.trim(),secretKey=configForm.secretKey.trim();if(!apiKey&&!secretKey)return ElMessage.warning('请至少填写 API Key 或 Secret Key');configSaving.value=true;try{ocrConfig.value=await request('/ocr/config',{method:'PUT',body:{apiKey:apiKey||undefined,secretKey:secretKey||undefined,version:ocrConfig.value.version},timeout:30000});resetConfigForm();configVisible.value=false;ElMessage.success('百度 OCR 凭据已验证并加密保存')}catch(e){if(e.status===409)void fetchConfig();ElMessage.error(message(e,'百度 OCR 凭据保存失败'))}finally{configSaving.value=false}}
function cancelHistory(){historyRequestId+=1;historyController?.abort();historyController=null;historyLoading.value=false}
async function loadHistory(page=1){const id=++historyRequestId;historyController?.abort();const controller=new AbortController();historyController=controller;historyLoading.value=true;try{const data=await request(`/ocr/history?page=${page}&pageSize=${history.value.pageSize}`,{signal:controller.signal});if(id===historyRequestId){history.value=data;return data}}catch(e){if(id===historyRequestId)ElMessage.error(message(e,'OCR 识别记录加载失败'))}finally{if(id===historyRequestId){historyLoading.value=false;historyController=null}}}
async function openHistory(){historyVisible.value=true;const results=await Promise.allSettled([loadHistory(1),loadUsage()]);if(results[1].status==='rejected')ElMessage.warning('OCR 免费额度加载失败，请稍后重试')}
async function exportHistory(format){if(exportingFormat.value)return;exportingFormat.value=format;try{const response=await fetch(`/api/receipt-assistant/ocr/history/export?format=${encodeURIComponent(format)}`,{headers:{Accept:format==='json'?'application/json':'text/csv'}});if(!response.ok){const contentType=response.headers.get('content-type')||'';const data=contentType.includes('application/json')?await response.json():null;throw new ApiError(data?.message||`导出失败（${response.status}）`,response.status,data)}const file=await response.blob();const disposition=response.headers.get('content-disposition')||'';const filename=disposition.match(/filename="([^"]+)"/)?.[1]||`receipt-ocr-history.${format}`;const url=URL.createObjectURL(file);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);ElMessage.success(`OCR 识别记录已导出为 ${format.toUpperCase()}`)}catch(e){ElMessage.error(message(e,'OCR 识别记录导出失败'))}finally{exportingFormat.value=''}}
async function deleteHistory(row){if(!row?.id||deletingHistoryIds.size)return;try{await ElMessageBox.confirm(`确定删除 #${row.id} 识别记录吗？删除后不能恢复，也不会返还 OCR 调用次数。`,'删除识别记录',{confirmButtonText:'删除',cancelButtonText:'取消',type:'warning'})}catch{return}deletingHistoryIds.add(row.id);try{await request(`/ocr/history/${row.id}`,{method:'DELETE'});if(detail.value?.id===row.id){detailVisible.value=false;cancelDetail()}if(currentHistoryId.value===row.id)currentHistoryId.value=null;const data=await loadHistory(history.value.page);if(data&&data.page>data.totalPages)await loadHistory(data.totalPages);ElMessage.success('识别记录已删除，OCR 调用次数保持不变')}catch(e){ElMessage.error(message(e,'OCR 识别记录删除失败'))}finally{deletingHistoryIds.delete(row.id)}}
function cancelDetail(){detailRequestId+=1;detailController?.abort();detailController=null;detail.value=null}
async function openHistoryDetail(id){if(!id)return;const requestId=++detailRequestId;detailController?.abort();const controller=new AbortController();detailController=controller;detailVisible.value=true;detailLoading.value=true;detail.value=null;try{const data=await request(`/ocr/history/${id}`,{signal:controller.signal});if(requestId===detailRequestId)detail.value=data}catch(e){if(requestId===detailRequestId){detailVisible.value=false;ElMessage.error(message(e,'识别结果详情加载失败'))}}finally{if(requestId===detailRequestId){detailLoading.value=false;detailController=null}}}
watch(trend,()=>nextTick(()=>renderTrendChart()),{deep:true})
watch(trendRange,()=>{if(!visibleTrend.value.some(item=>item.date===selectedTrendDate.value))selectedTrendDate.value=null;nextTick(()=>renderTrendChart())})
onMounted(async()=>{await nextTick();initializeTrendChart();loading.value=true;const results=await Promise.allSettled([refresh(),fetchConfig(),loadUsage()]);if(results[0].status==='rejected')ElMessage.error('数据加载失败，请确认后端服务已启动');if(results[1].status==='rejected')ElMessage.warning('OCR 配置状态加载失败');if(results[2].status==='rejected')ElMessage.warning('OCR 免费额度加载失败');loading.value=false})
onBeforeUnmount(()=>{disposeTrendChart();cancelOcr();cancelHistory();cancelDetail();releasePrint?.()})
</script>
