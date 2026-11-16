<script setup>
import { reactive, ref, watch } from 'vue';
import * as api from '../api.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
  mode: { type: String, default: 'create' },
  device: { type: Object, default: null }
});

const emit = defineEmits(['close', 'saved']);

const form = reactive({ hostname: '', ip: '', group_name: '' });
const saving = ref(false);

watch(
  () => props.visible,
  (value) => {
    if (!value) return;
    form.hostname = props.device?.hostname ?? '';
    form.ip = props.device?.ip ?? '';
    form.group_name = props.device?.group_name ?? '';
  }
);

async function submit() {
  if (!form.hostname.trim() && !form.ip.trim()) {
    ElMessage.warning('主机名和 IP 至少填写一项');
    return;
  }
  saving.value = true;
  try {
    if (props.mode === 'edit' && props.device) {
      await api.updateDevice(props.device.id, { ...form });
      ElMessage.success('设备已更新');
    } else {
      await api.createDevice({ ...form });
      ElMessage.success('设备已新增');
    }
    emit('saved');
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="mode === 'edit' ? '编辑设备' : '新增设备'"
    width="480px"
    @update:model-value="(v) => !v && emit('close')"
  >
    <p v-if="mode === 'edit'" class="dialog-hint">
      手动修改主机名后会被锁定，Agent 心跳不再用本机名覆盖。留空表示清除分组。
    </p>
    <el-form label-width="86px" label-position="right">
      <el-form-item label="主机名">
        <el-input v-model="form.hostname" placeholder="例如 DESKTOP-XXXX" clearable />
      </el-form-item>
      <el-form-item label="IP 地址">
        <el-input v-model="form.ip" placeholder="例如 192.168.2.104" clearable />
      </el-form-item>
      <el-form-item label="分组">
        <el-input v-model="form.group_name" placeholder="例如 一楼样机区" clearable />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>
