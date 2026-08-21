<script setup>
import { onMounted, ref } from 'vue';

const loading = ref(true);
const error = ref('');
const health = ref(null);

async function loadHealth() {
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/system/health');
    const body = await response.json();
    if (!response.ok || body.code !== 0) throw new Error(body.msg || '状态检查失败');
    health.value = body.data;
  } catch (requestError) {
    error.value = requestError.message;
  } finally {
    loading.value = false;
  }
}

function statusClass(value) {
  if (value === null) return 'neutral';
  return value ? 'ready' : 'waiting';
}

function statusText(value, readyText, errorText, neutralText) {
  if (value === null) return neutralText;
  return value ? readyText : errorText;
}

function stageText(stage) {
  if (stage === 'migrated') return '已迁移';
  if (stage === 'ready') return '已就绪';
  return '待处理';
}

onMounted(loadHealth);
</script>

<template>
  <section class="page-stack">
    <div class="page-heading">
      <div>
        <span class="eyebrow">联想门店运营系统</span>
        <h1>系统状态</h1>
        <p>检查统一服务、业务板块、数据目录和独立数据库的运行状态。</p>
      </div>
      <el-button :loading="loading" @click="loadHealth">刷新状态</el-button>
    </div>

    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />

    <div v-if="health" class="status-summary">
      <div><span>服务状态</span><b class="healthy">正常</b></div>
      <div><span>服务版本</span><b>{{ health.version }}</b></div>
      <div><span>运行时间</span><b>{{ health.uptimeSeconds }} 秒</b></div>
      <div><span>板块数量</span><b>{{ health.modules.length }}</b></div>
    </div>

    <div v-loading="loading" class="status-table-wrap">
      <table class="status-table">
        <thead><tr><th>业务板块</th><th>API</th><th>数据目录</th><th>数据库</th><th>准备状态</th></tr></thead>
        <tbody>
          <tr v-for="module in health?.modules || []" :key="module.id">
            <td><span class="table-module-mark" :style="{ background: module.accent }"></span><strong>{{ module.name }}</strong></td>
            <td><span :class="['status-value', statusClass(module.apiReady)]">{{ statusText(module.apiReady, '已就绪', '异常', '无需 API') }}</span></td>
            <td><span :class="['status-value', statusClass(module.dataDirectoryReady)]">{{ statusText(module.dataDirectoryReady, '已创建', '未创建', '无需目录') }}</span></td>
            <td><span :class="['status-value', statusClass(module.databaseConnected)]" :title="module.databaseError || ''">{{ statusText(module.databaseConnected, '已连接', '连接失败', '无需数据库') }}</span></td>
            <td><span :class="['status-value', ['migrated', 'ready'].includes(module.stage) ? 'ready' : 'waiting']">{{ stageText(module.stage) }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
