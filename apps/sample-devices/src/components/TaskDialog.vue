<script setup>
import { reactive, ref, watch } from 'vue';
import * as api from '../api.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
  type: { type: String, default: 'HOSTMSG' },
  scope: { type: Object, default: () => ({ ids: [], label: '' }) }
});

const emit = defineEmits(['close', 'submit']);

const form = reactive({ title: '门店通知', message: '', version: '', filename: '', uploading: false });
const uploading = ref(false);
const latest = ref(null);

watch(
  () => props.visible,
  async (value) => {
    if (!value) return;
    form.title = '门店通知';
    form.message = '';
    form.version = '';
    form.filename = '';
    if (props.type === 'UPGRADE') {
      latest.value = await api.getLatestAgent().catch(() => null);
      if (latest.value?.version) form.version = latest.value.version;
    }
  }
);

async function pickFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  uploading.value = true;
  try {
    const saved = await api.uploadDistributionFile(file);
    form.filename = saved.filename;
    ElMessage.success(`已上传 ${saved.original_name}`);
  } catch (error) {
    ElMessage.error(error.message || '上传失败');
  } finally {
    uploading.value = false;
  }
}

function submit() {
  if (props.type === 'HOSTMSG') {
    if (!form.message.trim()) {
      ElMessage.warning('请填写提示内容');
      return;
    }
    emit('submit', {
      type: 'HOSTMSG',
      params: { title: form.title.trim() || '门店通知', message: form.message.trim() }
    });
    return;
  }
  if (props.type === 'UPGRADE') {
    if (!form.version.trim()) {
      ElMessage.warning('请填写目标版本号');
      return;
    }
    emit('submit', { type: 'UPGRADE', params: { version: form.version.trim() } });
    return;
  }
  if (props.type === 'FILE_PUSH') {
    if (!form.filename) {
      ElMessage.warning('请先上传要分发的文件');
      return;
    }
    emit('submit', { type: 'FILE_PUSH', params: { filename: form.filename } });
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="type === 'UPGRADE' ? '远程升级' : type === 'FILE_PUSH' ? '文件分发' : '弹窗提示'"
    width="540px"
    @update:model-value="(v) => !v && emit('close')"
  >
    <p class="dialog-hint">
      目标设备：<b>{{ scope.ids.length }}</b> 台 · {{ scope.label }}
    </p>

    <template v-if="type === 'HOSTMSG'">
      <el-form label-width="80px">
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="门店通知" maxlength="60" show-word-limit />
        </el-form-item>
        <el-form-item label="内容">
          <el-input
            v-model="form.message"
            type="textarea"
            :rows="5"
            maxlength="500"
            show-word-limit
            placeholder="将在目标样机桌面弹出该提示"
          />
        </el-form-item>
      </el-form>
    </template>

    <template v-else-if="type === 'UPGRADE'">
      <el-form label-width="80px">
        <el-form-item label="目标版本">
          <el-input v-model="form.version" placeholder="例如 1.4.7" />
        </el-form-item>
      </el-form>
      <p class="form-tip">
        服务器上最新 Agent：<b>{{ latest?.version || '未找到 LanAgent.exe' }}</b>
        <span v-if="latest?.size"> · {{ (latest.size / 1024 / 1024).toFixed(1) }} MB</span>
      </p>
      <p class="form-tip">升级任务超过 5 分钟未回报结果会自动判定为失败。</p>
    </template>

    <template v-else>
      <div class="toolbar" style="border: none; padding: 0 0 8px">
        <label class="el-button">
          {{ uploading ? '上传中…' : '选择文件' }}
          <input type="file" style="display: none" @change="pickFile" />
        </label>
        <span v-if="form.filename" class="form-tip">已上传：{{ form.filename }}</span>
      </div>
      <p class="form-tip">单个文件上限 500MB，服务器只保留最近 20 个上传文件。</p>
    </template>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" @click="submit">下发</el-button>
    </template>
  </el-dialog>
</template>
