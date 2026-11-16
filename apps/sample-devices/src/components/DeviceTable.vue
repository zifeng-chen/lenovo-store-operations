<script setup>
const props = defineProps({
  devices: { type: Array, default: () => [] },
  selectedIds: { type: Set, default: () => new Set() },
  loading: { type: Boolean, default: false }
});

const emit = defineEmits(['toggle-select', 'toggle-select-all', 'edit', 'delete', 'single-task', 'open-single-task']);

function isChecked(id) {
  return props.selectedIds.has(id);
}

function allChecked() {
  return props.devices.length > 0 && props.devices.every((item) => props.selectedIds.has(item.id));
}

function duration(value) {
  if (!value) return '—';
  const text = String(value).includes('T') ? value : value.replace(' ', 'T');
  const time = Date.parse(text);
  if (Number.isNaN(time)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function memoryText(mb) {
  if (!mb) return null;
  return `${Math.round(mb / 1024)} GB`;
}

function diskText(device) {
  if (!device.disk_total_gb) return null;
  const free = device.disk_free_gb ? `${Math.round(device.disk_free_gb)} GB 可用` : '';
  return `${Math.round(device.disk_total_gb)} GB${free ? ` / ${free}` : ''}`;
}
</script>

<template>
  <div class="table-wrap">
    <div v-if="!devices.length && !loading" class="empty-block">
      <b>还没有登记任何设备</b>
      <p>可以用「部署与升级包」生成安装包分发到样机，设备首次心跳会自动注册。</p>
    </div>
    <table v-else class="device-table">
      <thead>
        <tr>
          <th class="col-check">
            <input type="checkbox" :checked="allChecked()" @change="emit('toggle-select-all', $event.target.checked)" />
          </th>
          <th>状态</th>
          <th>主机名 / IP</th>
          <th>分组</th>
          <th>硬件信息</th>
          <th>Agent</th>
          <th>最后心跳</th>
          <th class="col-actions">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="device in devices" :key="device.id" :class="{ 'offline-row': device.status !== 'online' }">
          <td class="col-check">
            <input
              type="checkbox"
              :checked="isChecked(device.id)"
              @change="emit('toggle-select', device.id, $event.target.checked)"
            />
          </td>
          <td>
            <span class="status-pill" :class="device.status === 'online' ? 'online' : 'offline'">
              <i></i>{{ device.status === 'online' ? '在线' : '离线' }}
            </span>
          </td>
          <td>
            <div class="hostname-cell">
              {{ device.hostname || '未命名' }}
              <span v-if="device.hostname_locked" class="lock" title="已手动锁定主机名">🔒</span>
            </div>
            <div class="device-meta">
              <span class="mono">{{ device.ip || '—' }}</span>
              <span v-if="device.model">{{ device.manufacturer }} {{ device.model }}</span>
            </div>
          </td>
          <td>{{ device.group_name || '—' }}</td>
          <td>
            <div class="device-meta">
              <span v-if="device.cpu_model">{{ device.cpu_model }}</span>
              <span v-if="device.cpu_cores || device.memory_total_mb">
                {{ device.cpu_cores ? `${device.cpu_cores} 核` : '' }}
                {{ memoryText(device.memory_total_mb) ? ` / ${memoryText(device.memory_total_mb)}` : '' }}
              </span>
              <span v-if="diskText(device)">{{ diskText(device) }}</span>
              <span v-if="!device.cpu_model && !device.memory_total_mb">未采集</span>
            </div>
          </td>
          <td>
            <div class="device-meta">
              <span class="mono">{{ device.agent_version || '—' }}</span>
              <span>重装 {{ device.rearm_count ?? 0 }} 次</span>
            </div>
          </td>
          <td>
            <div class="device-meta">
              <span>{{ duration(device.last_heartbeat) }}</span>
              <span v-if="device.socket_connected" style="color: #20845f">长连接在线</span>
            </div>
          </td>
          <td class="col-actions">
            <el-dropdown trigger="click" @command="(cmd) => emit('open-single-task', cmd, { ids: [device.id], label: device.hostname || device.ip })">
              <el-button size="small">下发指令</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="STATUS">状态检查</el-dropdown-item>
                  <el-dropdown-item command="SYSINFO">采集设备信息</el-dropdown-item>
                  <el-dropdown-item command="HOSTMSG">弹窗提示</el-dropdown-item>
                  <el-dropdown-item command="SYSPREP" divided>Sysprep 关机</el-dropdown-item>
                  <el-dropdown-item command="SYSPREP_REBOOT">Sysprep 重启</el-dropdown-item>
                  <el-dropdown-item command="REBOOT">重启</el-dropdown-item>
                  <el-dropdown-item command="SHUTDOWN">关机</el-dropdown-item>
                  <el-dropdown-item command="RESET_PWD">清空账户密码</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button size="small" text @click="emit('edit', device)">编辑</el-button>
            <el-button size="small" text type="danger" @click="emit('delete', device)">删除</el-button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
