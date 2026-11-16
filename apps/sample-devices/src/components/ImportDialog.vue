<script setup>
import { reactive, ref } from 'vue';
import * as api from '../api.js';

const props = defineProps({ visible: { type: Boolean, default: false } });
const emit = defineEmits(['close', 'imported']);

const mode = ref('range');
const range = reactive({ start_ip: '', end_ip: '', group_name: '' });
const csv = reactive({ rows: [], group_name: '', filename: '' });
const busy = ref(false);

function reset() {
  mode.value = 'range';
  range.start_ip = '';
  range.end_ip = '';
  range.group_name = '';
  csv.rows = [];
  csv.group_name = '';
  csv.filename = '';
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
  const ipIndex = header.findIndex((cell) => cell === 'ip');
  const hostIndex = header.findIndex((cell) => cell === 'hostname' || cell === 'host');
  const groupIndex = header.findIndex((cell) => cell === 'group' || cell === 'group_name');
  const start = ipIndex >= 0 ? 1 : 0;
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const cells = lines[i].split(',').map((cell) => cell.trim());
    rows.push({
      ip: cells[ipIndex >= 0 ? ipIndex : 0] ?? '',
      hostname: hostIndex >= 0 ? cells[hostIndex] : '',
      group: groupIndex >= 0 ? cells[groupIndex] : ''
    });
  }
  return rows;
}

async function pickCsv(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const text = await file.text();
  csv.rows = parseCsv(text);
  csv.filename = file.name;
  if (!csv.rows.length) ElMessage.warning('未解析到有效行，请确认首行为 ip 或 ip,hostname,group');
}

async function submit() {
  busy.value = true;
  try {
    if (mode.value === 'range') {
      if (!range.start_ip.trim() || !range.end_ip.trim()) {
        ElMessage.warning('请填写起始与结束 IP');
        return;
      }
      const result = await api.importIpRange({ ...range });
      ElMessage.success(`新增 ${result.added} 台，跳过已存在 ${result.skipped} 台`);
    } else {
      if (!csv.rows.length) {
        ElMessage.warning('请先选择 CSV 文件');
        return;
      }
      const result = await api.importCsv(csv.rows, csv.group_name);
      ElMessage.success(`新增 ${result.added} 台，跳过 ${result.skipped} 台`);
      if (result.errors?.length) ElMessage.warning(result.errors.slice(0, 3).join('；'));
    }
    reset();
    emit('imported');
  } catch (error) {
    ElMessage.error(error.message || '导入失败');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="批量导入设备"
    width="560px"
    @update:model-value="(v) => !v && (reset(), emit('close'))"
  >
    <el-radio-group v-model="mode" style="margin-bottom: 14px">
      <el-radio-button value="range">IP 段导入</el-radio-button>
      <el-radio-button value="csv">CSV 文件导入</el-radio-button>
    </el-radio-group>

    <template v-if="mode === 'range'">
      <el-form label-width="90px">
        <el-form-item label="起始 IP">
          <el-input v-model="range.start_ip" placeholder="192.168.2.100" />
        </el-form-item>
        <el-form-item label="结束 IP">
          <el-input v-model="range.end_ip" placeholder="192.168.2.150" />
        </el-form-item>
        <el-form-item label="分组">
          <el-input v-model="range.group_name" placeholder="选填" />
        </el-form-item>
      </el-form>
      <p class="form-tip">单次最多 1024 个地址，已存在的 IP 会自动跳过。</p>
    </template>

    <template v-else>
      <div class="toolbar" style="border: none; padding: 0 0 8px">
        <label class="el-button">
          选择 CSV
          <input type="file" accept=".csv" style="display: none" @change="pickCsv" />
        </label>
        <span v-if="csv.filename" class="form-tip">{{ csv.filename }} · {{ csv.rows.length }} 行</span>
      </div>
      <el-form label-width="90px">
        <el-form-item label="默认分组">
          <el-input v-model="csv.group_name" placeholder="CSV 未包含 group 列时使用" />
        </el-form-item>
      </el-form>
      <p class="form-tip">CSV 首行支持 ip / hostname / group 三列，编码 UTF-8。</p>
    </template>

    <template #footer>
      <el-button @click="reset(); emit('close')">取消</el-button>
      <el-button type="primary" :loading="busy" @click="submit">导入</el-button>
    </template>
  </el-dialog>
</template>
