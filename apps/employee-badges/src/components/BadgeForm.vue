<script setup>
import { ref } from 'vue';

const props = defineProps({
  name: { type: String, default: '' },
  position: { type: String, default: '' },
  qrFileName: { type: String, default: '' },
  qrError: { type: String, default: '' },
  formError: { type: String, default: '' },
  dragging: { type: Boolean, default: false },
  editing: { type: Boolean, default: false },
  employees: { type: Array, default: () => [] },
  badgeCount: { type: Number, default: 0 },
  pageCount: { type: Number, default: 0 },
  printing: { type: Boolean, default: false }
});

const emit = defineEmits([
  'update:name',
  'update:position',
  'select-qr',
  'clear-qr',
  'update:dragging',
  'save',
  'cancel',
  'edit',
  'update-quantity',
  'remove',
  'clear-all',
  'print'
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
  if (file) emit('select-qr', file);
}
</script>

<template>
  <section class="editor-card ls-card" aria-labelledby="badge-form-title">
    <div class="section-heading">
      <div>
        <p class="ls-eyebrow">工牌信息</p>
        <h2 id="badge-form-title">{{ props.editing ? '修改员工资料' : '添加员工资料' }}</h2>
      </div>
      <span class="local-badge">仅当前页面</span>
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
        :class="['qr-dropzone', { 'is-dragging': props.dragging, 'has-file': props.qrFileName }]"
        @click="fileInput?.click()"
        @dragenter.prevent="emit('update:dragging', true)"
        @dragover.prevent
        @dragleave.prevent="emit('update:dragging', false)"
        @drop.prevent="dropFile"
      >
        <span class="qr-dropzone-icon">{{ props.qrFileName ? '✓' : '+' }}</span>
        <strong>{{ props.qrFileName || '上传员工二维码' }}</strong>
        <small>点击选择或拖入 PNG、JPG、WEBP、SVG，最大 5MB</small>
      </button>
      <input ref="fileInput" class="ls-visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" @change="selectFile" />
      <p v-if="props.qrError" class="field-error" role="alert">{{ props.qrError }}</p>
      <button v-if="props.qrFileName" type="button" class="text-button" @click="emit('clear-qr')">移除二维码</button>
    </div>

    <p v-if="props.formError" class="form-error" role="alert">{{ props.formError }}</p>

    <div class="form-actions">
      <button v-if="props.editing" type="button" class="ls-button ls-button--secondary" @click="emit('cancel')">取消修改</button>
      <button type="button" class="ls-button ls-button--primary" @click="emit('save')">{{ props.editing ? '保存修改' : '添加到打印列表' }}</button>
    </div>

    <div class="employee-queue">
      <div class="queue-heading">
        <div>
          <strong>打印列表</strong>
          <span>{{ props.employees.length }} 人 · {{ props.badgeCount }} 张 · {{ props.pageCount }} 页</span>
        </div>
        <button v-if="props.employees.length" type="button" class="text-button" @click="emit('clear-all')">清空列表</button>
      </div>

      <div v-if="props.employees.length" class="queue-list">
        <div v-for="(employee, index) in props.employees" :key="employee.id" class="queue-item">
          <span class="queue-index">{{ index + 1 }}</span>
          <div class="queue-person">
            <strong>{{ employee.name }}</strong>
            <small>{{ employee.position }}</small>
          </div>
          <label class="queue-quantity">
            <span>份数</span>
            <input
              type="number"
              min="1"
              max="99"
              step="1"
              :value="employee.quantity"
              :aria-label="`${employee.name}的打印份数`"
              @change="emit('update-quantity', employee.id, $event.target.value)"
            />
          </label>
          <div class="queue-actions">
            <button type="button" @click="emit('edit', employee.id)">编辑</button>
            <button type="button" class="danger" @click="emit('remove', employee.id)">删除</button>
          </div>
        </div>
      </div>
      <p v-else class="queue-empty">填写完整资料后添加员工，右侧会自动生成 A4 排版。</p>

      <button type="button" class="ls-button ls-button--primary print-button" :disabled="!props.badgeCount || props.printing" @click="emit('print')">
        {{ props.printing ? '正在准备打印…' : `打印全部工牌（${props.badgeCount} 张）` }}
      </button>
      <p class="print-tip">A4 横向 · 54mm × 85mm · 每页 10 张 · 打印缩放请选择 100%</p>
    </div>
  </section>
</template>
