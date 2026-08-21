<script setup>
import { ref } from 'vue';

const props = defineProps({
  name: { type: String, default: '' },
  position: { type: String, default: '' },
  qrFileName: { type: String, default: '' },
  qrError: { type: String, default: '' },
  dragging: { type: Boolean, default: false }
});

const emit = defineEmits([
  'update:name',
  'update:position',
  'select-qr',
  'drop-qr',
  'clear-qr',
  'update:dragging',
  'reset'
]);

const fileInput = ref(null);

function selectFile(event) {
  const file = event.target.files?.[0];
  if (file) emit('select-qr', file);
  event.target.value = '';
}

function dropFile(event) {
  emit('update:dragging', false);
  const file = event.dataTransfer?.files?.[0];
  if (file) emit('drop-qr', file);
}
</script>

<template>
  <section class="editor-card ls-card" aria-labelledby="badge-form-title">
    <div class="section-heading">
      <div>
        <p class="ls-eyebrow">工牌信息</p>
        <h2 id="badge-form-title">填写员工资料</h2>
      </div>
      <span class="local-badge">仅本地预览</span>
    </div>

    <label class="form-field">
      <span>员工姓名</span>
      <input
        :value="props.name"
        class="ls-input"
        type="text"
        maxlength="20"
        autocomplete="off"
        placeholder="请输入员工姓名"
        @input="emit('update:name', $event.target.value)"
      />
      <small>{{ props.name.length }}/20</small>
    </label>

    <label class="form-field">
      <span>岗位</span>
      <input
        :value="props.position"
        class="ls-input"
        type="text"
        maxlength="30"
        autocomplete="off"
        placeholder="例如：门店销售顾问"
        @input="emit('update:position', $event.target.value)"
      />
      <small>{{ props.position.length }}/30</small>
    </label>

    <div class="form-field">
      <span>二维码图片</span>
      <button
        type="button"
        :class="['qr-dropzone', { 'is-dragging': props.dragging }]"
        @click="fileInput?.click()"
        @dragenter.prevent="emit('update:dragging', true)"
        @dragover.prevent
        @dragleave.prevent="emit('update:dragging', false)"
        @drop.prevent="dropFile"
      >
        <span class="qr-dropzone-icon">+</span>
        <strong>{{ props.qrFileName || '上传员工二维码' }}</strong>
        <small>点击选择或将图片拖到这里，最大 5MB</small>
      </button>
      <input ref="fileInput" class="ls-visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" @change="selectFile" />
      <p v-if="props.qrError" class="field-error" role="alert">{{ props.qrError }}</p>
      <button v-if="props.qrFileName" type="button" class="text-button" @click="emit('clear-qr')">移除二维码</button>
    </div>

    <div class="form-actions">
      <button type="button" class="ls-button ls-button--secondary" @click="emit('reset')">清空全部</button>
    </div>
  </section>
</template>
