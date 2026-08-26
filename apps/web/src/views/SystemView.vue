<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const MAINTENANCE_HEADER = { 'X-Lenovo-Store-Maintenance': '1' };
const loading = ref(true);
const error = ref('');
const health = ref(null);
const backupLoading = ref(false);
const inspectLoading = ref(false);
const fileInput = ref(null);
const selectedFile = ref(null);
const restoreSession = ref(null);
const maintenanceToken = ref('');

function maintenanceHeaders() {
  return maintenanceToken.value
    ? { ...MAINTENANCE_HEADER, Authorization: `Bearer ${maintenanceToken.value}` }
    : MAINTENANCE_HEADER;
}

async function ensureMaintenanceAccess() {
  if (!health.value?.maintenanceAuthenticationRequired || maintenanceToken.value) return true;
  try {
    const result = await ElMessageBox.prompt(
      '统一备份和恢复属于高风险维护操作，请输入服务器配置的维护令牌。令牌只保存在当前页面内存中。',
      '维护身份验证',
      {
        confirmButtonText: '验证并继续',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: 'LENOVO_STORE_MAINTENANCE_TOKEN',
        inputValidator: value => String(value || '').trim().length >= 24 || '维护令牌至少 24 个字符',
        closeOnClickModal: false,
      },
    );
    maintenanceToken.value = String(result.value).trim();
    return true;
  } catch {
    return false;
  }
}

async function readApiResponse(response) {
  const body = await response.json().catch(() => null);
  if (response.status === 401) maintenanceToken.value = '';
  if (!response.ok || body?.code !== 0) throw new Error(body?.msg || `请求失败（HTTP ${response.status}）`);
  return body;
}

async function loadHealth() {
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/system/health');
    const body = await readApiResponse(response);
    health.value = body.data;
  } catch (requestError) {
    error.value = requestError.message;
  } finally {
    loading.value = false;
  }
}

async function downloadBackup() {
  if (!await ensureMaintenanceAccess()) return;
  backupLoading.value = true;
  try {
    const response = await fetch('/api/system/backups/export', { headers: maintenanceHeaders() });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.msg || '统一备份生成失败');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `lenovo-store-backup-${new Date().toISOString().slice(0, 10)}.lsbackup`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    ElMessage.success('统一备份已下载，请妥善保管');
  } catch (requestError) {
    ElMessage.error(requestError.message);
  } finally {
    backupLoading.value = false;
  }
}

async function discardSession({ notify = false } = {}) {
  const sessionId = restoreSession.value?.sessionId;
  restoreSession.value = null;
  if (!sessionId) return;
  try {
    const response = await fetch(`/api/system/restores/${sessionId}`, { method: 'DELETE', headers: maintenanceHeaders() });
    await readApiResponse(response);
    if (notify) ElMessage.success('已清理恢复会话');
  } catch {
    if (notify) ElMessage.warning('本地会话已关闭，服务端会在 30 分钟后自动清理');
  }
}

async function selectBackupFile(event) {
  const file = event.target.files?.[0] || null;
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.lsbackup')) {
    ElMessage.error('请选择 .lsbackup 统一备份文件');
    event.target.value = '';
    return;
  }
  await discardSession();
  selectedFile.value = file;
}

async function inspectBackup() {
  if (!selectedFile.value) return ElMessage.warning('请先选择统一备份文件');
  if (!await ensureMaintenanceAccess()) return;
  inspectLoading.value = true;
  try {
    await discardSession();
    const form = new FormData();
    form.append('file', selectedFile.value);
    const response = await fetch('/api/system/restores/inspect', {
      method: 'POST',
      headers: maintenanceHeaders(),
      body: form,
    });
    const body = await readApiResponse(response);
    restoreSession.value = {
      ...body.data,
      modules: body.data.modules.map(module => ({ ...module, error: module.error || '' })),
    };
    ElMessage.success(body.msg);
  } catch (requestError) {
    ElMessage.error(requestError.message);
  } finally {
    inspectLoading.value = false;
  }
}

async function restoreModule(module) {
  if (!await ensureMaintenanceAccess()) return;
  try {
    await ElMessageBox.prompt(
      `此操作会覆盖“${module.name}”当前数据库中的全部记录，且不会影响备份包内其他模块。请输入“恢复”继续。`,
      `确认恢复：${module.name}`,
      {
        confirmButtonText: '确认恢复此模块',
        cancelButtonText: '取消',
        inputPlaceholder: '请输入：恢复',
        inputPattern: /^恢复$/,
        inputErrorMessage: '必须完整输入“恢复”',
        type: 'warning',
        closeOnClickModal: false,
      },
    );
  } catch {
    return;
  }

  module.status = 'restoring';
  module.error = '';
  try {
    const response = await fetch(`/api/system/restores/${restoreSession.value.sessionId}/modules/${module.id}`, {
      method: 'POST',
      headers: maintenanceHeaders(),
    });
    const body = await readApiResponse(response);
    module.status = 'succeeded';
    ElMessage.success(body.msg);
    await loadHealth();
  } catch (requestError) {
    module.status = requestError.message.includes('过期') ? 'expired' : 'failed';
    module.error = requestError.message;
    ElMessage.error(requestError.message);
  }
}

function resetFile() {
  selectedFile.value = null;
  if (fileInput.value) fileInput.value.value = '';
  discardSession({ notify: true });
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

function restoreStatusText(module) {
  return {
    ready: '检查通过',
    restoring: '恢复中',
    succeeded: '已恢复',
    failed: '恢复失败',
    incompatible: '不兼容',
    expired: '会话已过期',
  }[module.status] || module.status;
}

function formatCounts(counts) {
  const labels = { products: '商品', categories: '品类', sales: '销售', ocrConfig: 'OCR 配置', ocrHistory: 'OCR 历史' };
  return Object.entries(counts).map(([key, value]) => `${labels[key] || key} ${value.toLocaleString()} 条`).join('，');
}

const sessionExpiresText = computed(() => restoreSession.value
  ? new Date(restoreSession.value.expiresAt).toLocaleString('zh-CN', { hour12: false })
  : '');

onMounted(loadHealth);
onBeforeUnmount(() => discardSession());
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

    <section class="persistence-panel" aria-labelledby="persistence-title">
      <div class="persistence-heading">
        <div>
          <span class="card-kicker">统一数据保护</span>
          <h2 id="persistence-title">全部备份，按模块恢复</h2>
          <p>一次下载仓库货品标签、周边货品价签和付款凭证打印的数据库；上传后只检查，不会立即覆盖数据。</p>
        </div>
        <el-button type="primary" :loading="backupLoading" @click="downloadBackup">下载全部数据库备份</el-button>
      </div>

      <el-alert
        title="统一备份可能包含已加密的 OCR 凭据及其配套密钥，属于敏感文件。格式、摘要和数据库检查只能发现损坏，不能证明文件来源；请仅使用从受信任服务器下载并保存在受控位置的备份。"
        type="warning"
        :closable="false"
        show-icon
      />

      <div class="restore-upload">
        <input ref="fileInput" class="visually-hidden" type="file" accept=".lsbackup,application/octet-stream" @change="selectBackupFile">
        <el-button @click="fileInput?.click()">选择 .lsbackup 文件</el-button>
        <span class="selected-backup">{{ selectedFile ? `${selectedFile.name}（${(selectedFile.size / 1024 / 1024).toFixed(2)} MB）` : '尚未选择文件' }}</span>
        <el-button type="primary" plain :disabled="!selectedFile" :loading="inspectLoading" @click="inspectBackup">上传并检查</el-button>
        <el-button v-if="selectedFile" text @click="resetFile">清除</el-button>
      </div>

      <div v-if="restoreSession" class="restore-inspection">
        <div class="inspection-meta">
          <div><span>备份编号</span><code>{{ restoreSession.backupId }}</code></div>
          <div><span>创建时间</span><b>{{ new Date(restoreSession.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</b></div>
          <div><span>会话过期时间</span><b>{{ sessionExpiresText }}</b></div>
        </div>
        <div class="restore-table-wrap">
          <table class="restore-table">
            <thead><tr><th>模块</th><th>备份内容</th><th>校验状态</th><th>独立操作</th></tr></thead>
            <tbody>
              <tr v-for="module in restoreSession.modules" :key="module.id">
                <td><strong>{{ module.name }}</strong></td>
                <td>{{ formatCounts(module.counts) }}</td>
                <td>
                  <span :class="['restore-state', module.status]">{{ restoreStatusText(module) }}</span>
                  <small v-if="module.error">{{ module.error }}</small>
                </td>
                <td><el-button type="danger" plain :loading="module.status === 'restoring'" :disabled="['restoring', 'expired', 'incompatible'].includes(module.status)" @click="restoreModule(module)">恢复此模块</el-button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="restore-note">没有“一键恢复全部”：三个模块相互独立，请核对统计后逐个恢复。某个模块失败不会覆盖其他模块。</p>
      </div>
    </section>

    <section class="legacy-backup-panel" aria-labelledby="legacy-title">
      <div>
        <span class="card-kicker">兼容入口</span>
        <h2 id="legacy-title">现有导入导出功能继续保留</h2>
        <p>统一入口稳定验证期间，原页面功能不会取消，可继续用于单模块迁移或应急恢复。</p>
      </div>
      <div class="legacy-links">
        <a href="/#/computer-labels">仓库货品标签：Excel / SQLite <span>→</span></a>
        <a href="/#/price-labels">周边货品价签：JSON <span>→</span></a>
        <span>付款凭证打印：当前通过本页统一入口恢复</span>
      </div>
    </section>
  </section>
</template>
