<script setup>
import { ref, watch } from 'vue';
import * as api from '../api.js';

const props = defineProps({ visible: { type: Boolean, default: false } });
const emit = defineEmits(['close']);

const serverUrl = ref('');
const latest = ref(null);
const uploads = ref([]);
const uploading = ref(false);
const building = ref(false);

async function load() {
  const [url, agent, files] = await Promise.all([
    api.getServerUrl().catch(() => ({ server_url: '' })),
    api.getLatestAgent().catch(() => null),
    api.getUploads().catch(() => [])
  ]);
  serverUrl.value = url.server_url;
  latest.value = agent;
  uploads.value = files;
}

watch(() => props.visible, (value) => {
  if (value) load();
});

async function pickAgent(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!/\.exe$/i.test(file.name)) {
    ElMessage.warning('请选择 .exe 文件');
    return;
  }
  uploading.value = true;
  try {
    await api.uploadAgentExe(file);
    ElMessage.success('Agent 已上传');
    await load();
  } catch (error) {
    ElMessage.error(error.message || '上传失败');
  } finally {
    uploading.value = false;
  }
}

async function downloadPackage() {
  building.value = true;
  try {
    const blob = await api.downloadDeployPackage();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'LanAgent-Deploy.zip';
    link.click();
    URL.revokeObjectURL(url);
    ElMessage.success('部署包已生成');
  } catch (error) {
    ElMessage.error(error.message || '生成部署包失败');
  } finally {
    building.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="部署与升级包"
    width="620px"
    @update:model-value="(v) => !v && emit('close')"
  >
    <dl class="info-grid">
      <dt>设备接入地址</dt>
      <dd class="mono">{{ serverUrl || '—' }}</dd>
      <dt>服务器最新 Agent</dt>
      <dd>{{ latest?.version || '未找到 LanAgent.exe' }}<span v-if="latest?.size"> · {{ (latest.size / 1024 / 1024).toFixed(1) }} MB</span></dd>
    </dl>

    <p class="dialog-hint" style="margin-top: 14px">
      部署包内含 LanAgent.exe、deploy.conf（写入注册密钥与接入地址）、安装说明、卸载与覆盖安装脚本。
      同一安装包可装到任意多台设备，新设备首次心跳会自动登记。
    </p>

    <div class="toolbar" style="border: none; padding: 0">
      <el-button type="primary" :loading="building" @click="downloadPackage">下载部署包</el-button>
      <label class="el-button">
        {{ uploading ? '上传中…' : '上传新 Agent' }}
        <input type="file" accept=".exe" style="display: none" @change="pickAgent" />
      </label>
    </div>

    <el-divider content-position="left">服务器上传文件（最近 20 个）</el-divider>
    <div v-if="!uploads.length" class="form-tip">暂无上传文件</div>
    <table v-else class="audit-table">
      <thead>
        <tr>
          <th>文件名</th>
          <th style="width: 100px">大小</th>
          <th style="width: 170px">上传时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="file in uploads" :key="file.filename">
          <td class="mono">{{ file.filename }}</td>
          <td>{{ (file.size / 1024 / 1024).toFixed(2) }} MB</td>
          <td class="mono">{{ String(file.modified_at).replace('T', ' ').slice(0, 19) }}</td>
        </tr>
      </tbody>
    </table>

    <template #footer>
      <el-button @click="emit('close')">关闭</el-button>
    </template>
  </el-dialog>
</template>
