<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { imageUrl } from '../api.js'
import { hasUnexpectedPlacardOverflow } from '../placardOverflow.js'
import defaultProductImage from '../assets/default-product.jpg'
import defaultServiceLogo from '../assets/xiangbangbang-logo.jpg'

const props = defineProps({ content: { type: Object, required: true } })
const emit = defineEmits(['overflow'])
const card = ref(null)
let observer
const productImage = computed(() => props.content.productImageType === 'custom' && props.content.productImageAssetId ? imageUrl(props.content.productImageAssetId) : defaultProductImage)
const serviceLogo = computed(() => props.content.serviceLogoAssetId ? imageUrl(props.content.serviceLogoAssetId) : defaultServiceLogo)

function checkOverflow() {
  const root = card.value
  if (!root) return false
  const overflowing = hasUnexpectedPlacardOverflow(root)
  root.classList.toggle('is-overflowing', overflowing)
  emit('overflow', overflowing)
  return overflowing
}

async function scheduleCheck() { await nextTick(); requestAnimationFrame(checkOverflow) }
watch(() => props.content, scheduleCheck, { deep: true })
onMounted(() => {
  observer = new ResizeObserver(scheduleCheck)
  observer.observe(card.value)
  scheduleCheck()
})
onBeforeUnmount(() => observer?.disconnect())
defineExpose({ checkOverflow })
</script>

<template>
  <div class="card-outer">
    <div ref="card" class="card">
      <div class="product-header">
        <div class="product-title">{{ content.productTitle }}</div>
        <div v-if="content.showProductImage" class="product-image-box">
          <img :src="productImage" :alt="content.productImageType === 'custom' ? '产品图片' : 'AI 元启'" @load="scheduleCheck" />
        </div>
      </div>

      <div class="feature-grid">
        <div v-for="(feature, featureIndex) in content.features" :key="featureIndex" class="feature">
          <div class="icon">
            <img v-if="feature.imageAssetId" :src="imageUrl(feature.imageAssetId)" alt="" @load="scheduleCheck" />
          </div>
          <div class="feature-text">
            <div class="feature-title">{{ feature.title }}</div>
            <div class="feature-desc">{{ feature.desc }}</div>
          </div>
        </div>
      </div>

      <div class="line"></div>

      <div class="product-list">
        <template v-for="(product, productIndex) in content.products" :key="productIndex">
          <template v-if="product.config">
            <div v-for="(color, colorIndex) in product.colors" :key="colorIndex" class="product-row">
              <span v-if="colorIndex === 0">{{ product.config }}</span>
              <span class="price" :style="colorIndex === 0 ? undefined : { marginLeft: 'auto' }">
                <span v-if="color.name" class="color-text">{{ color.name }}</span>
                <span class="money"><span>¥</span><span>{{ color.price }}</span></span>
              </span>
            </div>
          </template>
        </template>
      </div>

      <div class="flex-spacer"></div>

      <div v-if="content.showAccessory" class="accessory">
        <div v-for="item in content.accessories" :key="item.name" class="accessory-title">
          <span>{{ item.name }}</span>
          <span class="accessory-price money"><span>¥</span><span>{{ item.price }}</span></span>
        </div>
      </div>

      <div class="service">
        <div class="service-header">
          <span class="service-title-slot"><img class="service-title-logo" :src="serviceLogo" :alt="content.serviceTitle" @load="scheduleCheck" /></span>
          <div class="service-line"></div>
        </div>
        <div v-for="item in content.services" :key="item.name" class="service-row">
          <span>{{ item.name }}</span>
          <span class="service-price money"><span>¥</span><span>{{ item.price }}</span></span>
        </div>
      </div>
    </div>
  </div>
</template>
