<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const MAINTENANCE_HEADER = { 'X-Lenovo-Store-Maintenance': '1' };
const UPDATE_HEADER = { 'X-Lenovo-Store-Update': '1' };
const loading = ref(true);
const error = ref('');
const health = ref(null);
const updateLoading = ref(false);
const updateError = ref('');
const updateStatus = ref(null);
const installSubmitting = ref(false);
const updateToken = ref('');
const lastInstallationResult = ref('');
let updatePollTimer = null;
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

async function readApiResponse(response, authentication = 'maintenance') {
  const body = await response.json().catch(() => null);
  if (response.status === 401) {
    if (authentication === 'update') updateToken.value = '';
    else maintenanceToken.value = '';
  }
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

function clearUpdatePolling() {
  if (updatePollTimer) window.clearTimeout(updatePollTimer);
  updatePollTimer = null;
}

function scheduleUpdatePolling() {
  clearUpdatePolling();
  if (!updateStatus.value?.installation?.active) return;
  const delay = document.visibilityState === 'hidden' ? 8000 : 2000;
  updatePollTimer = window.setTimeout(() => loadUpdateStatus({ silent: true }), delay);
}

async function applyUpdateSnapshot(snapshot, { notify = false } = {}) {
  updateStatus.value = snapshot;
  if (snapshot.lastError) updateError.value = snapshot.lastError;
  const state = snapshot.installation?.state;
  if (state && !['queued', 'running'].includes(state.status)) {
    const marker = `${state.jobId}:${state.status}:${state.phase}`;
    if (marker !== lastInstallationResult.value) {
      lastInstallationResult.value = marker;
      if (state.status === 'succeeded') {
        ElMessage.success(`系统已更新到 ${state.targetTag}`);
        await loadHealth();
      } else if (state.rolledBack) {
        ElMessage.warning('安装未通过健康检查，系统已自动回滚到原版本');
        await loadHealth();
      } else if (notify || state.status === 'rollback-failed') {
        ElMessage.error(state.error?.message || '系统更新失败');
      }
    }
  }
  scheduleUpdatePolling();
}

async function loadUpdateStatus({ silent = false } = {}) {
  if (!silent) updateLoading.value = true;
  if (!silent) updateError.value = '';
  try {
    const response = await fetch('/api/system/update/status');
    const body = await readApiResponse(response);
    await applyUpdateSnapshot(body.data);
  } catch (requestError) {
    if (!updateStatus.value?.installation?.active) updateError.value = requestError.message;
    scheduleUpdatePolling();
  } finally {
    if (!silent) updateLoading.value = false;
  }
}

async function checkForUpdates() {
  updateLoading.value = true;
  updateError.value = '';
  try {
    const response = await fetch('/api/system/update/check', { method: 'POST' });
    const body = await readApiResponse(response);
    await applyUpdateSnapshot(body.data);
    if (body.data.lastError) {
      updateError.value = body.data.lastError;
      ElMessage.warning('GitHub 暂时不可用，已保留上次成功的检查结果');
    } else if (body.data.updateAvailable) {
      ElMessage.success(`发现新版本 ${body.data.latestRelease.version}`);
    } else if (!body.data.latestRelease) {
      ElMessage.info('GitHub 仓库暂时没有正式 Release');
    } else {
      ElMessage.success('当前已是最新稳定版本');
    }
  } catch (requestError) {
    updateError.value = requestError.message;
    ElMessage.error(requestError.message);
  } finally {
    updateLoading.value = false;
  }
}

async function ensureUpdateAccess() {
  if (updateToken.value) return true;
  try {
    const result = await ElMessageBox.prompt(
      '在线安装会创建备份、短暂重启服务，并在健康检查失败时自动回滚。请输入独立的更新管理员令牌；令牌只保存在当前页面内存中。',
      '更新身份验证',
      {
        confirmButtonText: '验证并继续',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: 'LENOVO_STORE_UPDATE_TOKEN',
        inputValidator: value => String(value || '').trim().length >= 32 || '更新管理员令牌至少 32 个字符',
        closeOnClickModal: false,
      },
    );
    updateToken.value = String(result.value).trim();
    return true;
  } catch {
    return false;
  }
}

async function installLatestUpdate() {
  const release = updateStatus.value?.latestRelease;
  if (!release || !canInstallUpdate.value || !await ensureUpdateAccess()) return;
  try {
    await ElMessageBox.prompt(
      `将安装 v${release.version}。系统会先创建一致性备份，安装期间将短暂离线；健康检查失败会自动回滚。请输入“安装”确认。`,
      `安装 ${release.tag}`,
      {
        confirmButtonText: '提交安装任务',
        cancelButtonText: '取消',
        inputPlaceholder: '请输入：安装',
        inputPattern: /^安装$/,
        inputErrorMessage: '必须完整输入“安装”',
        type: 'warning',
        closeOnClickModal: false,
      },
    );
  } catch {
    return;
  }

  installSubmitting.value = true;
  updateError.value = '';
  try {
    const response = await fetch('/api/system/update/install', {
      method: 'POST',
      headers: {
        ...UPDATE_HEADER,
        Authorization: `Bearer ${updateToken.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tag: release.tag }),
    });
    const body = await readApiResponse(response, 'update');
    await applyUpdateSnapshot(body.data, { notify: true });
    ElMessage.success(body.msg);
  } catch (requestError) {
    updateError.value = requestError.message;
    ElMessage.error(requestError.message);
  } finally {
    installSubmitting.value = false;
  }
}

function installationPhaseText(phase) {
  return {
    queued: '等待更新器领取任务',
    claimed: '更新器已领取任务',
    'backing-up': '正在创建一致性备份',
    downloading: '正在下载签名发布包',
    verifying: '正在验证签名和发布包',
    installing: '正在安装依赖并检查候选版本',
    switching: '正在原子切换运行版本',
    restarting: '正在重启服务',
    'health-check': '正在验证版本、数据库和模块',
    finalizing: '正在更新已签名的更新器程序',
    'rolling-back': '安装失败，正在自动回滚',
    completed: '安装及健康验证完成',
    'rolled-back': '已自动回滚到原版本',
    'failed-before-switch': '切换前安装失败，当前服务未变更',
    'rollback-failed': '自动回滚未通过健康检查，需要人工处理',
  }[phase] || '等待状态更新';
}

function formatUpdateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
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

const currentBuild = computed(() => updateStatus.value?.current || health.value?.build || {
  version: health.value?.version || '未知',
  commit: null,
  shortCommit: null,
  channel: 'stable',
});

const installationState = computed(() => updateStatus.value?.installation?.state || null);
const canInstallUpdate = computed(() => Boolean(
  updateStatus.value?.installation?.enabled
  && updateStatus.value?.installation?.configured
  && !updateStatus.value?.installation?.active
  && updateStatus.value?.updateAvailable
  && updateStatus.value?.latestRelease
  && updateStatus.value?.checkedAt
  && !updateStatus.value?.stale
  && !updateStatus.value?.lastError
));
const installationTagType = computed(() => {
  const status = installationState.value?.status;
  if (status === 'succeeded') return 'success';
  if (status === 'failed' || status === 'rollback-failed') return 'danger';
  if (status === 'queued' || status === 'running') return 'warning';
  return 'info';
});
const installationStatusText = computed(() => {
  const state = installationState.value;
  if (!state) return updateStatus.value?.installation?.enabled ? '尚无安装任务' : '未启用';
  if (state.status === 'succeeded') return '安装成功';
  if (state.status === 'rollback-failed') return '回滚异常';
  if (state.status === 'failed' && state.rolledBack) return '安装失败，已回滚';
  if (state.status === 'failed') return '安装失败';
  if (state.status === 'queued') return '等待执行';
  return '执行中';
});

const updateStateText = computed(() => {
  if (!updateStatus.value?.checkedAt) return '尚未检查';
  if (!updateStatus.value.latestRelease) return '暂无正式 Release';
  if (updateStatus.value.updateAvailable) return '发现新版本';
  if (updateStatus.value.aheadOfLatest) return '当前版本领先';
  return '已是最新版本';
});

const updateTagType = computed(() => {
  if (updateStatus.value?.updateAvailable) return 'warning';
  if (updateStatus.value?.checkedAt && updateStatus.value?.latestRelease) return 'success';
  return 'info';
});

const sessionExpiresText = computed(() => restoreSession.value
  ? new Date(restoreSession.value.expiresAt).toLocaleString('zh-CN', { hour12: false })
  : '');

function handleVisibilityChange() {
  if (updateStatus.value?.installation?.active) scheduleUpdatePolling();
}

onMounted(() => {
  loadHealth();
  loadUpdateStatus();
  document.addEventListener('visibilitychange', handleVisibilityChange);
});
onBeforeUnmount(() => {
  clearUpdatePolling();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  discardSession();
});
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

    <section class="update-panel" aria-labelledby="update-title">
      <div class="update-heading">
        <div>
          <span class="card-kicker">GitHub 稳定通道</span>
          <h2 id="update-title">系统版本与更新</h2>
          <p>检查固定 GitHub 正式版本；已完成受控更新器配置的 Ubuntu 主机可在备份和签名校验后安装，并在健康检查失败时自动回滚。</p>
        </div>
        <div class="update-heading-actions">
          <el-tag type="info" effect="plain">stable</el-tag>
          <el-button type="primary" :loading="updateLoading" :disabled="updateStatus?.installation?.active" @click="checkForUpdates">检查更新</el-button>
          <el-button
            v-if="updateStatus?.installation?.enabled"
            type="warning"
            :loading="installSubmitting || updateStatus.installation.active"
            :disabled="!canInstallUpdate"
            @click="installLatestUpdate"
          >{{ updateStatus.installation.active ? '安装进行中' : '安装最新版本' }}</el-button>
        </div>
      </div>

      <el-alert v-if="updateError" :title="`${updateError}；业务服务不受影响。`" type="warning" :closable="false" show-icon />
      <el-alert v-if="updateStatus?.installation?.enabled && !updateStatus.installation.configured" title="在线安装已启用，但 Ubuntu 更新器目录或权限尚未配置完成；安装按钮保持禁用。" type="error" :closable="false" show-icon />
      <el-alert v-if="updateStatus?.searchTruncated" title="Release 数量超过检查上限，当前结果仅基于最近 300 条记录。" type="warning" :closable="false" show-icon />

      <div v-loading="updateLoading" class="update-content">
        <div class="update-grid">
          <article class="update-info-card">
            <span>当前运行版本</span>
            <strong>v{{ currentBuild.version }}</strong>
            <dl>
              <div><dt>提交</dt><dd><code :title="currentBuild.commit || '当前构建未包含提交信息'">{{ currentBuild.shortCommit || '未知' }}</code></dd></div>
              <div><dt>通道</dt><dd>{{ currentBuild.channel }}</dd></div>
            </dl>
          </article>

          <article class="update-info-card">
            <div class="update-card-title">
              <span>最新 GitHub Release</span>
              <el-tag :type="updateTagType" effect="light">{{ updateStateText }}</el-tag>
            </div>
            <strong>{{ updateStatus?.latestRelease ? `v${updateStatus.latestRelease.version}` : '—' }}</strong>
            <dl>
              <div><dt>发布时间</dt><dd>{{ formatUpdateTime(updateStatus?.latestRelease?.publishedAt) }}</dd></div>
              <div><dt>检查时间</dt><dd>{{ formatUpdateTime(updateStatus?.checkedAt) }}</dd></div>
            </dl>
          </article>
        </div>

        <div v-if="updateStatus?.latestRelease" class="release-notes">
          <div class="release-notes-heading">
            <div>
              <span>更新说明</span>
              <strong>{{ updateStatus.latestRelease.name }}</strong>
            </div>
            <a v-if="updateStatus.latestRelease.url" class="update-release-link" :href="updateStatus.latestRelease.url" target="_blank" rel="noopener noreferrer">查看 GitHub Release <span aria-hidden="true">↗</span></a>
          </div>
          <pre>{{ updateStatus.latestRelease.notes || '该版本未提供更新说明。' }}</pre>
          <p v-if="updateStatus.stale" class="update-stale-note">当前显示上次成功的缓存结果。</p>
        </div>
        <p v-else class="update-empty-note">{{ updateStatus?.stale ? '当前显示上次成功检查的“无正式 Release”结果，本次无法连接 GitHub，暂时不能确认最新状态。' : (updateStatus?.checkedAt ? 'GitHub 仓库暂时没有正式 Release。' : '点击“检查更新”获取最新稳定版本。') }}</p>

        <section v-if="updateStatus?.installation" class="installation-status" aria-labelledby="installation-status-title">
          <div class="installation-status-heading">
            <div>
              <span>受控安装器</span>
              <strong id="installation-status-title">{{ installationStatusText }}</strong>
            </div>
            <el-tag :type="installationTagType" effect="light">{{ installationState?.targetTag || (updateStatus.installation.enabled ? '已启用' : '未启用') }}</el-tag>
          </div>
          <template v-if="installationState">
            <div class="installation-progress" :class="{ active: updateStatus.installation.active }">
              <i aria-hidden="true"></i>
              <div>
                <b>{{ installationPhaseText(installationState.phase) }}</b>
                <span>任务 {{ installationState.jobId }} · 更新于 {{ formatUpdateTime(installationState.updatedAt) }}</span>
              </div>
            </div>
            <el-alert
              v-if="installationState.error"
              :title="installationState.error.message"
              :type="installationState.rolledBack ? 'warning' : 'error'"
              :closable="false"
              show-icon
            />
            <p v-if="installationState.rolledBack" class="installation-note">候选版本未通过验证，current 已切回原版本并重新通过健康检查，业务数据未自动覆盖。</p>
          </template>
          <p v-else class="installation-note">{{ updateStatus.installation.enabled ? '尚无安装任务。安装只接受刚检查到的最新稳定版本，并要求独立更新管理员令牌。' : '此环境只提供版本检查；需先按 Ubuntu 部署文档配置签名公钥、systemd 更新器和独立令牌。' }}</p>
        </section>
      </div>
    </section>

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
