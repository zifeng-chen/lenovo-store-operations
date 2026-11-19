<script setup>
import { getIconSrc } from '../icon-library.js'

const BASE = import.meta.env.BASE_URL
const aiImgSrc = `${BASE}ai.png`
const xbbImgSrc = `${BASE}xbb.png`

defineProps({
  card: { type: Object, required: true }
})
</script>

<template>
  <!-- 外层容器：实际输出 110mm -->
  <div class="card-outer">
    <!-- 价签 UI 样式与原项目一致，数值不可修改 -->
    <div class="card">
      <div class="product-header">
        <div class="product-title">{{ card.productTitle }}</div>
        <div v-if="card.showProductImage" class="product-image-box">
          <img :src="aiImgSrc" alt="AI元启" class="default-icon-img" />
        </div>
      </div>

      <div class="feature-grid">
        <div v-for="(feature, index) in card.features" :key="index" class="feature">
          <div class="icon">
            <img
              v-if="feature.iconType === 'image' && feature.iconSrc"
              :src="feature.iconSrc"
              class="icon-custom"
              :style="{ width: (feature.iconSize || 100) + '%', height: (feature.iconSize || 100) + '%' }"
              alt=""
            />
            <div
              v-else-if="feature.iconType === 'svg' && feature.iconSrc"
              class="icon-svg"
              :style="{ width: (feature.iconSize || 100) + '%', height: (feature.iconSize || 100) + '%' }"
              v-html="feature.iconSrc"
            ></div>
            <img
              v-else-if="feature.iconType === 'builtin' && getIconSrc(feature.iconName, card.category)"
              :src="getIconSrc(feature.iconName, card.category)"
              class="icon-custom"
              :style="{ width: (feature.iconSize || 100) + '%', height: (feature.iconSize || 100) + '%' }"
              alt=""
            />
          </div>
          <div class="feature-text">
            <div class="feature-title">{{ feature.title }}</div>
            <div class="feature-desc">{{ feature.desc }}</div>
          </div>
        </div>
      </div>

      <div class="line"></div>

      <div class="product-list" :style="{ '--row-spacing': (card.priceRowSpacing || 0) + 'px' }">
        <template v-for="(product, productIndex) in card.products" :key="productIndex">
          <template v-if="product.config">
            <template v-for="(color, colorIndex) in product.colors" :key="colorIndex">
              <div v-if="colorIndex === 0" class="product-row">
                <span>{{ product.config }}</span>
                <span class="price">
                  <span class="color-text">{{ color.name }}</span>
                  <span v-if="(color.subsidyPrice || 0) > 0" class="subsidy-price">¥{{ color.subsidyPrice }}</span>
                  <span class="origin-price" :class="{ 'with-subsidy': (color.subsidyPrice || 0) > 0 }">¥{{ color.price }}</span>
                </span>
              </div>
              <div v-else class="product-row">
                <span class="price" style="margin-left: auto">
                  <span class="color-text">{{ color.name }}</span>
                  <span v-if="(color.subsidyPrice || 0) > 0" class="subsidy-price">¥{{ color.subsidyPrice }}</span>
                  <span class="origin-price" :class="{ 'with-subsidy': (color.subsidyPrice || 0) > 0 }">¥{{ color.price }}</span>
                </span>
              </div>
            </template>
          </template>
        </template>
      </div>

      <div class="flex-spacer"></div>

      <div v-if="card.showAccessory" class="accessory">
        <div class="accessory-title">
          <span>{{ card.accessory1Name }}</span>
          <span class="accessory-price">¥<span>{{ card.accessory1Price }}</span></span>
        </div>
        <div class="accessory-title">
          <span>{{ card.accessory2Name }}</span>
          <span class="accessory-price">¥<span>{{ card.accessory2Price }}</span></span>
        </div>
      </div>

      <div class="service">
        <div class="service-header">
          <img :src="xbbImgSrc" alt="想帮帮" class="service-logo" />
          <div class="service-line"></div>
        </div>
        <div class="service-row">
          <span>{{ card.service1Name }}</span>
          <span class="service-price">¥<span>{{ card.service1Price }}</span></span>
        </div>
        <div class="service-row">
          <span>{{ card.service2Name }}</span>
          <span class="service-price">¥<span>{{ card.service2Price }}</span></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 外层容器：实际输出 110mm，内部按 120mm 设计后等比缩放 */
.card-outer {
  width: 110mm;
  height: 110mm;
  overflow: hidden;
  border: 0.5px solid #ccc;
  background: #fff;
}

.card {
  width: 120mm;
  height: 120mm;
  border: none;
  padding: 3mm 6mm 13.09px 6mm;
  background: transparent;
  display: flex;
  flex-direction: column;
  transform: scale(calc(11 / 12));
  transform-origin: top left;
  font-family: "Source Han Sans SC", "思源黑体", "Noto Sans SC", sans-serif;
}

.product-header { display: flex; align-items: center; height: 15mm; flex: none; }
.product-title { font-size: 20px; font-weight: 900; color: #000; display: flex; align-items: center; }
.product-image-box {
  width: 9mm; height: 9mm; display: flex; align-items: center; justify-content: center;
  overflow: hidden; flex: none; margin-left: 5px; background: transparent;
}
.product-image-box img { width: 100%; height: 100%; object-fit: cover; }
.default-icon-img { width: 100%; height: 100%; object-fit: contain; }

.feature-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  column-gap: 7mm; row-gap: calc(6mm - 5px); flex: none;
}
.feature { display: flex; align-items: center; }
.feature:nth-child(2n) { margin-left: -5px; }

/* 卖点色块：32.73px 橙色，尺寸锁死 */
.icon {
  width: 32.73px; height: 32.73px; background: #FF6A00; flex: none;
  display: flex; align-items: center; justify-content: center;
}
.icon-custom { object-fit: contain; }
.icon-svg { display: flex; align-items: center; justify-content: center; }
.icon-svg :deep(svg) { width: 100%; height: 100%; }

.feature-text { margin-left: 3mm; }
.feature-title { font-size: 11.91px; font-weight: 700; color: #000; line-height: 1.3; white-space: nowrap; }
.feature-desc { font-size: 10.82px; font-weight: 700; color: #000; margin-top: 1mm; line-height: 1.3; white-space: nowrap; }

/* 原设计为 0.5px，但卡片整体 scale(11/12) 后只剩 0.458px，
   不足 1 个设备像素会被浏览器直接丢弃，预览与打印都看不到这条线，故提到 1px（缩放后 0.917px）。
   行高只增加 0.458px，不影响版式。 */
.line { margin-top: 6mm; height: 1px; background: #333; flex: none; }

.product-list {
  margin-top: calc(5mm - 4.5px); flex: none; overflow: hidden;
  display: flex; flex-direction: column; justify-content: flex-start;
}
.product-row {
  height: calc(20.18px + var(--row-spacing, 0px));
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px; font-weight: 700; color: #000; flex: none;
}
.price { font-size: 13px; font-weight: 900; color: #000; display: inline-flex; align-items: baseline; gap: 0.5em; }
.color-text { font-size: 13px; font-weight: 700; color: #000; flex: none; }
.subsidy-price { font-size: 13px; font-weight: 900; color: #000; flex: none; }
.origin-price { font-size: 13px; font-weight: 900; color: #000; flex: none; }
.origin-price.with-subsidy {
  font-size: 12px; font-weight: 700; color: #666;
  text-decoration: line-through 1px; text-decoration-thickness: 1px;
}
.subsidy-price + .origin-price { margin-left: 1px; }

/* 配件区：固定位置 */
.accessory { margin-top: 0; flex: none; margin-bottom: 7.64px; }
.accessory-title {
  font-size: 11px; font-weight: 700; color: #000; line-height: 1.2;
  display: flex; justify-content: space-between; margin-bottom: 3px;
}
.accessory-price { font-size: 11px; font-weight: 700; color: #000; display: inline-flex; align-items: baseline; gap: 0.5em; }

.flex-spacer { flex: 1; }

/* 服务区：底部 padding 锁定 13.09px */
.service { margin-top: 0; padding-top: 0; flex: none; }
.service-header {
  display: flex; align-items: center; font-size: 9.82px; font-weight: 900;
  line-height: 1.2; margin-bottom: 4.91px;
}
.service-logo { height: 6.5mm; width: auto; object-fit: contain; flex: none; }
.service-line { height: 1px; background: #333; flex: 1; margin-left: 3mm; }
.service-row {
  display: flex; justify-content: space-between; font-size: 11px; font-weight: 700;
  color: #000; line-height: 1.2; margin-bottom: 3px;
}
.service-price { font-size: 11px; font-weight: 700; color: #000; display: inline-flex; align-items: baseline; gap: 0.5em; }

</style>
