<script setup>
import { ref } from 'vue';
import * as api from '../api.js';

const props = defineProps({
  tasks: { type: Array, default: () => [] }
});

const emit = defineEmits(['cancel', 'refresh']);

const expanded = ref(new Set());
const details = ref({});
const loadingDetail = ref(new Set());

const STATUS_LABELS = {
  PENDING: '等待下发',
  DISPATCHED: '已派发',
  RUNNING: '执行中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
  pending: '等待',
  sent: '已送达',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
  timeout: '超时',
  unknown: '未知'
};

function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

function statusClass(status) {
  return `s-${String(status).toLowerCase()}`;
}

function typeLabel(type) {
  return (
    {
      SYSPREP: 'Sysprep 关机',
      SYSPREP_REBOOT: 'Sysprep 重启',
      SHUTDOWN: '关机',
      REBOOT: '重启',
      STATUS: '状态检查',
      UPGRADE: '远程升级',
      FILE_PUSH: '文件分发',
      HOSTMSG: '弹窗提示',
      SYSINFO: '采集信息',
      RESET_PWD: '清空密码'
    }[type] ?? type
  );
}

function shortTime(value) {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 19);
}

async function toggle(task) {
  const next = new Set(expanded.value);
  if (next.has(task.id)) {
    next.delete(task.id);
    expanded.value = next;
    return;
  }
  next.add(task.id);
  expanded.value = next;
  if (!details.value[task.id]) await loadDetail(task.id);
}

async function loadDetail(id) {
  const pending = new Set(loadingDetail.value);
  pending.add(id);
  loadingDetail.value = pending;
  try {
    details.value = { ...details.value, [id]: await api.getTask(id) };
  } catch (error) {
    ElMessage.error(error.message || '加载任务详情失败');
  } finally {
    const next = new Set(loadingDetail.value);
    next.delete(id);
    loadingDetail.value = next;
  }
}

function canCancel(task) {
  return ['PENDING', 'DISPATCHED', 'RUNNING'].includes(task.status);
}

defineExpose({ loadDetail });
</script>

<template>
  <div class="table-wrap">
    <div v-if="!tasks.length" class="empty-block">
      <b>还没有下发过任务</b>
      <p>在设备列表勾选设备后即可下发 Sysprep、弹窗提示、采集信息等指令。</p>
    </div>
    <div v-else class="task-list">
      <article v-for="task in tasks" :key="task.id" class="task-card">
        <div class="task-head" @click="toggle(task)">
          <span class="task-status-pill" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span>
          <span class="task-type">{{ typeLabel(task.task_type) }}</span>
          <span v-if="task.description && task.description !== typeLabel(task.task_type)" class="task-desc">{{ task.description }}</span>
          <span class="task-ips">{{ task.device_ips.length }} 台：{{ task.device_ips.join('、') || '—' }}</span>
          <span class="task-time">{{ shortTime(task.created_at) }}</span>
          <el-button
            v-if="canCancel(task)"
            size="small"
            text
            type="danger"
            @click.stop="emit('cancel', task)"
          >
            取消
          </el-button>
        </div>

        <div v-if="expanded.has(task.id)" class="task-detail">
          <div v-if="loadingDetail.has(task.id)" class="form-tip">加载中…</div>
          <table v-else-if="details[task.id]">
            <thead>
              <tr>
                <th style="width: 150px">设备</th>
                <th style="width: 100px">状态</th>
                <th style="width: 160px">完成时间</th>
                <th>输出</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in details[task.id].results" :key="row.id">
                <td>
                  <div>{{ row.device_hostname || row.device_ip }}</div>
                  <div class="form-tip">{{ row.device_ip }}</div>
                </td>
                <td>
                  <span class="task-status-pill" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
                </td>
                <td class="mono">{{ shortTime(row.finished_at) }}</td>
                <td>
                  <pre v-if="row.output">{{ row.output }}</pre>
                  <span v-else class="form-tip">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </div>
</template>
