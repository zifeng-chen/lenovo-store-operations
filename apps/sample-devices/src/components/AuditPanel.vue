<script setup>
import { onMounted, ref } from 'vue';
import * as api from '../api.js';

const items = ref([]);
const actions = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(50);
const action = ref('');
const loading = ref(false);

const ACTION_LABELS = {
  'device.create': '新增设备',
  'device.update': '编辑设备',
  'device.delete': '删除设备',
  'device.batch-delete': '批量删除',
  'device.batch-group': '设置分组',
  'device.import-ip-range': 'IP 段导入',
  'device.import-csv': 'CSV 导入',
  'device.re-enrolled': '设备重新接入',
  'heartbeat.rejected': '心跳被拒绝',
  'recover.rejected': '恢复被拒绝',
  'task.create': '下发任务',
  'task.cancel': '取消任务',
  'agent.upload': '上传 Agent',
  'file.upload': '上传文件',
  'deploy.package': '生成部署包'
};

function actionLabel(value) {
  return ACTION_LABELS[value] ?? value;
}

function shortTime(value) {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 19);
}

async function load() {
  loading.value = true;
  try {
    const data = await api.getAuditLogs({ page: page.value, size: size.value, action: action.value });
    items.value = data.items;
    total.value = data.total;
  } catch (error) {
    ElMessage.error(error.message || '加载审计失败');
  } finally {
    loading.value = false;
  }
}

function changePage(delta) {
  const next = page.value + delta;
  const max = Math.max(1, Math.ceil(total.value / size.value));
  if (next < 1 || next > max) return;
  page.value = next;
  load();
}

onMounted(async () => {
  await Promise.all([load(), api.getAuditActions().then((list) => { actions.value = list; }).catch(() => {})]);
});

defineExpose({ load });
</script>

<template>
  <div class="toolbar">
    <el-select v-model="action" placeholder="全部操作" style="width: 190px" clearable @change="page = 1; load()">
      <el-option label="全部操作" value="" />
      <el-option v-for="item in actions" :key="item" :label="actionLabel(item)" :value="item" />
    </el-select>
    <span class="spacer"></span>
    <span class="form-tip">共 {{ total }} 条记录</span>
    <el-button :loading="loading" @click="load">刷新</el-button>
  </div>

  <div class="table-wrap">
    <div v-if="!items.length && !loading" class="empty-block">
      <b>暂无审计记录</b>
      <p>设备的增删改、任务下发、心跳拒绝等操作都会留痕。</p>
    </div>
    <table v-else class="audit-table">
      <thead>
        <tr>
          <th style="width: 170px">时间</th>
          <th style="width: 130px">操作</th>
          <th style="width: 110px">来源 IP</th>
          <th>详情</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in items" :key="row.id">
          <td class="mono">{{ shortTime(row.created_at) }}</td>
          <td><code>{{ actionLabel(row.action) }}</code></td>
          <td class="mono">{{ row.ip_address || '—' }}</td>
          <td class="audit-detail">{{ row.detail || '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="pager-row">
    <el-button size="small" :disabled="page <= 1" @click="changePage(-1)">上一页</el-button>
    <span>第 {{ page }} / {{ Math.max(1, Math.ceil(total / size)) }} 页</span>
    <el-button size="small" :disabled="page >= Math.ceil(total / size)" @click="changePage(1)">下一页</el-button>
  </div>
</template>
