<script setup>
import { onBeforeUnmount, ref } from 'vue';
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg';
import BadgeForm from './components/BadgeForm.vue';
import BadgePreview from './components/BadgePreview.vue';

const name = ref('');
const position = ref('');
const qrUrl = ref('');
const qrFileName = ref('');
const qrError = ref('');
const dragging = ref(false);

function revokeQrUrl() {
  if (qrUrl.value) URL.revokeObjectURL(qrUrl.value);
  qrUrl.value = '';
}

function validateImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('无法读取所选图片'));
    image.src = url;
  });
}

async function useQrFile(file) {
  qrError.value = '';
  if (!file.type.startsWith('image/')) {
    qrError.value = '请选择 PNG、JPG、WEBP 或 SVG 图片';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    qrError.value = '二维码图片不能超过 5MB';
    return;
  }

  const nextUrl = URL.createObjectURL(file);
  try {
    await validateImage(nextUrl);
    revokeQrUrl();
    qrUrl.value = nextUrl;
    qrFileName.value = file.name;
  } catch (error) {
    URL.revokeObjectURL(nextUrl);
    qrError.value = error.message;
  }
}

function clearQr() {
  revokeQrUrl();
  qrFileName.value = '';
  qrError.value = '';
}

function reset() {
  name.value = '';
  position.value = '';
  dragging.value = false;
  clearQr();
}

onBeforeUnmount(revokeQrUrl);
</script>

<template>
  <main class="badge-app ls-theme">
    <header class="badge-app-header">
      <div class="badge-app-brand">
        <img class="ls-brand-logo" :src="logoUrl" alt="联想" />
        <div>
          <h1>联想员工工牌</h1>
          <p>输入员工资料并上传二维码，信息只在当前页面内使用</p>
        </div>
      </div>
      <span class="privacy-status"><i></i>无数据持久化</span>
    </header>

    <div class="badge-workspace">
      <BadgeForm
        v-model:name="name"
        v-model:position="position"
        :qr-file-name="qrFileName"
        :qr-error="qrError"
        :dragging="dragging"
        @select-qr="useQrFile"
        @drop-qr="useQrFile"
        @clear-qr="clearQr"
        @update:dragging="dragging = $event"
        @reset="reset"
      />
      <BadgePreview :name="name" :position="position" :qr-url="qrUrl" />
    </div>
  </main>
</template>
