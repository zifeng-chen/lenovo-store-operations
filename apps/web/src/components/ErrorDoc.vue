<script setup>
import { computed } from 'vue';
import { describeError } from '@lenovo-store/shared/error-catalog';

const props = defineProps({
  error: { type: [Object, String], default: null },
  title: { type: String, default: '' },
  type: { type: String, default: 'error' },
  showRaw: { type: Boolean, default: true }
});

const doc = computed(() => {
  const value = props.error;
  if (!value) return null;
  if (typeof value === 'object' && Array.isArray(value.solutions)) return value;
  return describeError(value);
});

const severityType = computed(() => {
  if (props.type !== 'error') return props.type;
  if (doc.value?.severity === 'warning') return 'warning';
  if (doc.value?.severity === 'critical') return 'error';
  return 'error';
});

const heading = computed(() => props.title || doc.value?.title || '出现错误');
const rawMessage = computed(() => doc.value?.rawMessage || '');
const showRawLine = computed(
  () => props.showRaw && rawMessage.value && rawMessage.value !== heading.value
);
</script>

<template>
  <div v-if="doc" :class="['error-doc', `error-doc--${severityType}`]">
    <div class="error-doc__head">
      <span class="error-doc__icon" aria-hidden="true">!</span>
      <div class="error-doc__heading">
        <strong class="error-doc__title">{{ heading }}</strong>
        <p class="error-doc__explanation">{{ doc.explanation }}</p>
      </div>
    </div>

    <div v-if="doc.solutions?.length" class="error-doc__block">
      <span class="error-doc__block-label">您可以这样处理</span>
      <ol class="error-doc__steps">
        <li v-for="(step, index) in doc.solutions" :key="index">{{ step }}</li>
      </ol>
    </div>

    <p v-if="showRawLine" class="error-doc__raw">
      <span>原始信息</span>
      <code>{{ rawMessage }}</code>
    </p>
    <p v-if="doc.code" class="error-doc__code">错误码：{{ doc.code }}</p>
  </div>
</template>

<style scoped>
.error-doc {
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid #f0b8b3;
  background: #fdf4f3;
}
.error-doc--warning {
  border-color: #edcf9b;
  background: #fdf8ee;
}
.error-doc__head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.error-doc__icon {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border-radius: 50%;
  background: #cd3a30;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
}
.error-doc--warning .error-doc__icon {
  background: #c08a25;
}
.error-doc__heading {
  min-width: 0;
}
.error-doc__title {
  display: block;
  font-size: 14px;
  color: #8f2a22;
}
.error-doc--warning .error-doc__title {
  color: #8a6216;
}
.error-doc__explanation {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.65;
  color: #5a4148;
}
.error-doc__block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #ecc9c5;
}
.error-doc--warning .error-doc__block {
  border-top-color: #ecdcbb;
}
.error-doc__block-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #7b3a33;
  letter-spacing: 0.4px;
}
.error-doc--warning .error-doc__block-label {
  color: #7a5a1c;
}
.error-doc__steps {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.8;
  color: #46333a;
}
.error-doc__raw {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 10px 0 0;
  font-size: 12px;
  color: #8a767c;
}
.error-doc__raw span {
  flex: 0 0 auto;
}
.error-doc__raw code {
  padding: 2px 6px;
  border-radius: 4px;
  background: #f3e8e7;
  color: #6d4a48;
  font-size: 12px;
  word-break: break-all;
}
.error-doc__code {
  margin: 6px 0 0;
  font-size: 11px;
  color: #a3969a;
  letter-spacing: 0.3px;
}
</style>
