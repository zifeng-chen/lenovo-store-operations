<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue';

const props = defineProps({
  modelValue: Boolean,
  product: { type: Object, default: null },
  mode: { type: String, default: 'create' },
  resetKey: { type: Number, default: 0 },
  saving: Boolean
});
const emit = defineEmits(['update:modelValue', 'save']);

const formRef = ref();
const skuInput = ref();
const submitAction = ref('');
const form = reactive({ sku: '', name: '', config: '', color: '', remark: '' });
const isEdit = computed(() => props.mode === 'edit');
const title = computed(() => ({
  create: '新增商品',
  copy: '复制新增商品',
  edit: '编辑商品'
}[props.mode] || '新增商品'));
const rules = {
  sku: [{ required: true, message: '请输入 SKU', trigger: 'blur' }],
  name: [{ required: true, message: '请输入商品名称', trigger: 'blur' }]
};

async function initializeForm() {
  const source = props.product;
  Object.assign(form, {
    sku: props.mode === 'copy' ? '' : source?.sku ?? '',
    name: source?.name ?? '',
    config: source?.config ?? '',
    color: source?.color ?? '',
    remark: source?.remark ?? ''
  });
  await nextTick();
  formRef.value?.clearValidate();
  if (!isEdit.value) skuInput.value?.focus();
}

watch(
  () => [props.modelValue, props.resetKey],
  ([visible]) => {
    if (visible) initializeForm();
  }
);

watch(
  () => props.saving,
  (value) => {
    if (!value) submitAction.value = '';
  }
);

async function submit(continueAdding = false) {
  if (props.saving) return;
  submitAction.value = continueAdding ? 'continue' : 'save';
  try {
    await formRef.value.validate();
    emit('save', { ...form }, continueAdding);
  } catch {
    submitAction.value = '';
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="520px"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-alert
      v-if="mode === 'copy'"
      class="copy-product-tip"
      title="已复制商品信息，请填写一个新的 SKU 后保存。"
      type="info"
      :closable="false"
      show-icon
    />
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit(false)">
      <div class="form-row">
        <el-form-item label="SKU（标签编号）" prop="sku">
          <el-input ref="skuInput" v-model="form.sku" maxlength="60" placeholder="例如：28976" />
        </el-form-item>
        <el-form-item label="商品名称" prop="name">
          <el-input v-model="form.name" maxlength="100" placeholder="例如：Legion Y7000" />
        </el-form-item>
      </div>
      <el-form-item label="配置信息" prop="config">
        <el-input v-model="form.config" maxlength="300" placeholder="例如：C7 245HX / 16G / 1T / 5060" />
      </el-form-item>
      <el-form-item label="颜色" prop="color">
        <el-input v-model="form.color" maxlength="80" placeholder="可留空，例如：黑色/白色" />
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="500" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button
        v-if="!isEdit"
        :loading="saving && submitAction === 'continue'"
        :disabled="saving"
        @click="submit(true)"
      >保存并新增</el-button>
      <el-button
        type="primary"
        :loading="saving && submitAction === 'save'"
        :disabled="saving"
        @click="submit(false)"
      >保存</el-button>
    </template>
  </el-dialog>
</template>
