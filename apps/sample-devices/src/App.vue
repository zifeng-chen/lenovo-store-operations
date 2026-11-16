<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg';
import DeviceTable from './components/DeviceTable.vue';
import TaskPanel from './components/TaskPanel.vue';
import AuditPanel from './components/AuditPanel.vue';
import DeviceDialog from './components/DeviceDialog.vue';
import TaskDialog from './components/TaskDialog.vue';
import ImportDialog from './components/ImportDialog.vue';
import DeployDialog from './components/DeployDialog.vue';
import * as api from './api.js';

const activeTab = ref('devices');
const devices = ref([]);
const stats = reactive({ total: 0, online: 0, offline: 0 });
const tasks = ref([]);
const groups = ref([]);
const loading = ref(false);
const selectedIds = ref(new Set());

const filters = reactive({ status: '', group: '', search: '' });
const taskScope = ref({ ids: [], label: '' });

const deviceDialog = reactive({ visible: false, mode: 'create', device: null });
const taskDialog = reactive({ visible: false, type: 'HOSTMSG' });
const importDialog = reactive({ visible: false });
const deployDialog = reactive({ visible: false });

let pollTimer = null;

const onlineCount = computed(() => devices.value.filter((item) => item.status === 'online').length);
const selectedDevices = computed(() => devices.value.filter((item) => selectedIds.value.has(item.id)));

function toast(message, type = 'success') {
  if (type === 'error') ElMessage.error(message);
  else ElMessage.success(message);
}

async function loadDevices() {
  loading.value = true;
  try {
    const [list, stat, groupList] = await Promise.all([
      api.getDevices({ status: filters.status, group: filters.group, search: filters.search }),
      api.getDeviceStats(),
      api.getGroups()
    ]);
    devices.value = list;
    Object.assign(stats, stat);
    groups.value = groupList;
    const valid = new Set(list.map((item) => item.id));
    selectedIds.value = new Set([...selectedIds.value].filter((id) => valid.has(id)));
  } catch (error) {
    toast(error.message || '加载设备失败', 'error');
  } finally {
    loading.value = false;
  }
}

async function loadTasks() {
  try {
    tasks.value = await api.getTasks(100);
  } catch (error) {
    toast(error.message || '加载任务失败', 'error');
  }
}

async function refreshAll() {
  await Promise.all([loadDevices(), loadTasks()]);
}

function toggleSelect(id, checked) {
  const next = new Set(selectedIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  selectedIds.value = next;
}

function toggleSelectAll(checked) {
  selectedIds.value = checked ? new Set(devices.value.map((item) => item.id)) : new Set();
}

function clearSelection() {
  selectedIds.value = new Set();
}

function openCreate() {
  Object.assign(deviceDialog, { visible: true, mode: 'create', device: null });
}

function openEdit(device) {
  Object.assign(deviceDialog, { visible: true, mode: 'edit', device });
}

async function handleDeviceSaved() {
  deviceDialog.visible = false;
  await loadDevices();
}

async function handleDelete(device) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${device.hostname || device.ip}」？设备若在线会同步下发卸载指令。`,
      '删除设备',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  try {
    const result = await api.deleteDevice(device.id);
    toast(result.uninstall_sent ? '已删除并下发卸载指令' : '已删除');
    await refreshAll();
  } catch (error) {
    toast(error.message || '删除失败', 'error');
  }
}

async function handleBatchDelete() {
  const ids = [...selectedIds.value];
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${ids.length} 台设备？在线设备会同步下发卸载指令。`,
      '批量删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  try {
    const result = await api.batchDeleteDevices(ids);
    toast(`已删除 ${result.deleted} 台${result.uninstall_sent ? `，下发卸载 ${result.uninstall_sent} 台` : ''}`);
    clearSelection();
    await refreshAll();
  } catch (error) {
    toast(error.message || '批量删除失败', 'error');
  }
}

async function handleBatchGroup() {
  const ids = [...selectedIds.value];
  if (!ids.length) return;
  let groupName = '';
  try {
    const result = await ElMessageBox.prompt('输入分组名称（留空则清除分组）', '设置分组', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：一楼样机区'
    });
    groupName = result.value ?? '';
  } catch {
    return;
  }
  try {
    await api.batchSetGroup(ids, groupName);
    toast('分组已更新');
    await loadDevices();
  } catch (error) {
    toast(error.message || '设置分组失败', 'error');
  }
}

function openTask(type, scope) {
  if (!scope.ids.length) {
    toast('请先选择设备', 'error');
    return;
  }
  if (type === 'UPGRADE') {
    taskDialog.visible = true;
    taskDialog.type = 'UPGRADE';
    taskScope.value = scope;
    return;
  }
  if (type === 'FILE_PUSH') {
    taskDialog.visible = true;
    taskDialog.type = 'FILE_PUSH';
    taskScope.value = scope;
    return;
  }
  if (type === 'HOSTMSG') {
    taskDialog.visible = true;
    taskDialog.type = 'HOSTMSG';
    taskScope.value = scope;
    return;
  }
  runTask(type, scope);
}

async function runTask(type, scope, params = null) {
  try {
    await ElMessageBox.confirm(
      `确定对 ${scope.ids.length} 台设备执行「${scope.label}」？`,
      scope.label,
      { type: 'warning', confirmButtonText: '执行', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  try {
    await api.createTask({ task_type: type, device_ids: scope.ids, params });
    toast(`已下发「${scope.label}」`);
    activeTab.value = 'tasks';
    await refreshAll();
  } catch (error) {
    toast(error.message || '下发失败', 'error');
  }
}

async function handleTaskSubmit({ type, params }) {
  const scope = taskScope.value;
  taskDialog.visible = false;
  await api
    .createTask({ task_type: type, device_ids: scope.ids, params })
    .then(() => {
      toast('任务已下发');
      activeTab.value = 'tasks';
      return refreshAll();
    })
    .catch((error) => toast(error.message || '下发失败', 'error'));
}

async function handleTaskCancel(task) {
  try {
    await api.cancelTask(task.id);
    toast('任务已取消');
    await loadTasks();
  } catch (error) {
    toast(error.message || '取消失败', 'error');
  }
}

function openDeploy() {
  deployDialog.visible = true;
}

function handleTabChange(name) {
  activeTab.value = name;
  if (name === 'tasks') loadTasks();
  if (name === 'devices') loadDevices();
}

watch(
  () => [filters.status, filters.group],
  () => loadDevices()
);

let searchDebounce = null;
watch(
  () => filters.search,
  () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadDevices, 260);
  }
);

onMounted(async () => {
  await refreshAll();
  pollTimer = setInterval(() => {
    if (activeTab.value === 'devices') loadDevices();
    else if (activeTab.value === 'tasks') loadTasks();
  }, 10_000);
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (searchDebounce) clearTimeout(searchDebounce);
});
</script>

<template>
  <div class="app-shell ls-theme" style="--ls-accent: #0f7a6c">
    <header class="app-header">
      <div class="brand">
        <img class="brand-logo" :src="logoUrl" alt="联想" />
        <div>
          <h1>样机设备管理</h1>
          <p>门店样机客户端在线状态与批量指令下发</p>
        </div>
      </div>
      <div class="header-stats">
        <span class="stat-chip"><b>{{ stats.total }}</b> 设备</span>
        <span class="stat-chip online"><b>{{ stats.online }}</b> 在线</span>
        <span class="stat-chip offline"><b>{{ stats.offline }}</b> 离线</span>
      </div>
    </header>

    <nav class="tab-bar">
      <button
        class="tab-item"
        :class="{ active: activeTab === 'devices' }"
        type="button"
        @click="handleTabChange('devices')"
      >
        设备列表 <span class="tab-count">{{ stats.total }}</span>
      </button>
      <button
        class="tab-item"
        :class="{ active: activeTab === 'tasks' }"
        type="button"
        @click="handleTabChange('tasks')"
      >
        任务记录 <span class="tab-count">{{ tasks.length }}</span>
      </button>
      <button
        class="tab-item"
        :class="{ active: activeTab === 'audit' }"
        type="button"
        @click="handleTabChange('audit')"
      >
        操作审计
      </button>
    </nav>

    <div v-show="activeTab === 'devices'" class="panel-body">
      <div class="toolbar">
        <el-select v-model="filters.status" placeholder="全部状态" style="width: 118px" clearable>
          <el-option label="全部状态" value="" />
          <el-option label="在线" value="online" />
          <el-option label="离线" value="offline" />
        </el-select>
        <el-select v-model="filters.group" placeholder="全部分组" style="width: 132px" clearable>
          <el-option label="全部分组" value="" />
          <el-option v-for="group in groups" :key="group" :label="group" :value="group" />
        </el-select>
        <el-input
          v-model="filters.search"
          placeholder="搜索主机名 / IP / 序列号"
          style="width: 220px"
          clearable
        />
        <el-button :loading="loading" @click="loadDevices">刷新</el-button>
        <span class="spacer"></span>
        <el-button @click="importDialog.visible = true">批量导入</el-button>
        <el-button @click="openDeploy">部署与升级包</el-button>
        <el-button type="primary" @click="openCreate">新增设备</el-button>
      </div>

      <div v-if="selectedIds.size" class="batch-bar">
        <span>已选 <b>{{ selectedIds.size }}</b> 台设备</span>
        <el-button size="small" @click="handleBatchGroup">设置分组</el-button>
        <el-button size="small" @click="openTask('SYSINFO', { ids: [...selectedIds], label: '采集设备信息' })">
          采集信息
        </el-button>
        <el-button size="small" @click="openTask('HOSTMSG', { ids: [...selectedIds], label: '弹窗提示' })">
          弹窗提示
        </el-button>
        <el-button size="small" @click="openTask('SYSPREP', { ids: [...selectedIds], label: 'Sysprep 关机' })">
          Sysprep 关机
        </el-button>
        <el-button size="small" @click="openTask('SYSPREP_REBOOT', { ids: [...selectedIds], label: 'Sysprep 重启' })">
          Sysprep 重启
        </el-button>
        <el-button size="small" @click="openTask('UPGRADE', { ids: [...selectedIds], label: '远程升级' })">
          远程升级
        </el-button>
        <el-button size="small" @click="openTask('FILE_PUSH', { ids: [...selectedIds], label: '文件分发' })">
          文件分发
        </el-button>
        <el-button size="small" type="danger" plain @click="handleBatchDelete">批量删除</el-button>
        <el-button size="small" text @click="clearSelection">取消选择</el-button>
      </div>

      <DeviceTable
        :devices="devices"
        :selected-ids="selectedIds"
        :loading="loading"
        @toggle-select="toggleSelect"
        @toggle-select-all="toggleSelectAll"
        @edit="openEdit"
        @delete="handleDelete"
        @single-task="(type, device) => openTask(type, { ids: [device.id], label: device.hostname || device.ip })"
        @open-single-task="runTask"
      />
    </div>

    <div v-show="activeTab === 'tasks'" class="panel-body">
      <div class="toolbar">
        <span class="form-tip">展示最近 100 条任务，可展开查看每台设备的执行结果。</span>
        <span class="spacer"></span>
        <el-button :loading="loading" @click="loadTasks">刷新</el-button>
      </div>
      <TaskPanel :tasks="tasks" @cancel="handleTaskCancel" @refresh="loadTasks" />
    </div>

    <div v-show="activeTab === 'audit'" class="panel-body">
      <AuditPanel />
    </div>

    <DeviceDialog
      :visible="deviceDialog.visible"
      :mode="deviceDialog.mode"
      :device="deviceDialog.device"
      @close="deviceDialog.visible = false"
      @saved="handleDeviceSaved"
    />
    <TaskDialog
      :visible="taskDialog.visible"
      :type="taskDialog.type"
      :scope="taskScope"
      @close="taskDialog.visible = false"
      @submit="handleTaskSubmit"
    />
    <ImportDialog
      :visible="importDialog.visible"
      @close="importDialog.visible = false"
      @imported="importDialog.visible = false; loadDevices()"
    />
    <DeployDialog :visible="deployDialog.visible" @close="deployDialog.visible = false" />
  </div>
</template>
