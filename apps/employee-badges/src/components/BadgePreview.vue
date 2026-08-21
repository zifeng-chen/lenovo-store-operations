<script setup>
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg';

defineProps({
  name: { type: String, default: '' },
  position: { type: String, default: '' },
  qrUrl: { type: String, default: '' }
});
</script>

<template>
  <section class="preview-card ls-card" aria-labelledby="badge-preview-title">
    <div class="preview-heading">
      <div>
        <p class="ls-eyebrow">实时预览</p>
        <h2 id="badge-preview-title">员工工牌基础版式</h2>
      </div>
      <span class="layout-badge">版式待补充</span>
    </div>

    <div class="badge-stage">
      <article class="employee-badge">
        <div class="badge-brand">
          <img :src="logoUrl" alt="联想" />
          <span>联想门店</span>
        </div>
        <div class="badge-divider"></div>
        <div class="badge-person">
          <p class="badge-label">员工姓名</p>
          <h3>{{ name.trim() || '员工姓名' }}</h3>
          <p class="badge-position">{{ position.trim() || '岗位名称' }}</p>
        </div>
        <div class="badge-qr">
          <img v-if="qrUrl" :src="qrUrl" alt="员工二维码" />
          <div v-else class="badge-qr-placeholder">
            <span>二维码</span>
            <small>上传后显示</small>
          </div>
        </div>
        <p class="badge-footer">联想门店员工工牌</p>
      </article>
    </div>

    <p class="preview-note">当前仅用于确认信息和视觉方向，不代表最终物理尺寸或打印效果。</p>
  </section>
</template>
