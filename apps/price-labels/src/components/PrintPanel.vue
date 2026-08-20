<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({ products: { type: Array, required: true } })
const emit = defineEmits(['clear'])
const ITEMS_PER_PAGE = 28
const DEFAULT_NAME_SIZE_MM = 5
const MIN_NAME_SIZE_MM = 0.5
const LABEL_WIDTH_MM = 70
const logoUrl = `${import.meta.env.BASE_URL}lenovo-logo.svg`
const nameFontSizes = ref({})
const isPreviewOpen = ref(false)
const previewButtonRef = ref(null)
const previewDialogRef = ref(null)
const previewCloseButtonRef = ref(null)
const nameMeasureElements = new Map()
let fitRequestId = 0

const printPages = computed(() => {
  const pages = []
  for (let index = 0; index < props.products.length; index += ITEMS_PER_PAGE) {
    pages.push(props.products.slice(index, index + ITEMS_PER_PAGE))
  }
  return pages
})

function formatPrice(price) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(price)
}

function setNameMeasureElement(id, element) {
  if (element) nameMeasureElements.set(id, element)
  else nameMeasureElements.delete(id)
}

async function fitLabelNames() {
  const requestId = ++fitRequestId
  await nextTick()
  if (document.fonts?.ready) await document.fonts.ready
  if (requestId !== fitRequestId) return
  const nextSizes = {}
  props.products.forEach((product) => {
    const element = nameMeasureElements.get(product.id)
    if (!element) return
    element.style.fontSize = `${DEFAULT_NAME_SIZE_MM}mm`
    const measureContainer = element.parentElement
    const containerStyles = measureContainer ? getComputedStyle(measureContainer) : null
    const availableWidth = measureContainer && containerStyles
      ? measureContainer.clientWidth - Number.parseFloat(containerStyles.paddingLeft) - Number.parseFloat(containerStyles.paddingRight)
      : 0
    const requiredWidth = element.getBoundingClientRect().width
    let size = DEFAULT_NAME_SIZE_MM
    if (availableWidth > 0 && requiredWidth > availableWidth) {
      size = Math.max(MIN_NAME_SIZE_MM, Math.floor(DEFAULT_NAME_SIZE_MM * (availableWidth / requiredWidth) * 99.5) / 100)
    }
    nextSizes[product.id] = `${size}mm`
  })
  nameFontSizes.value = nextSizes
}

function getPreviewNameSize(id) {
  const size = Number.parseFloat(nameFontSizes.value[id]) || DEFAULT_NAME_SIZE_MM
  return `${(size / LABEL_WIDTH_MM) * 100}cqi`
}

function setBackgroundInert(inert) {
  const app = document.getElementById('app')
  if (inert) app?.setAttribute('inert', '')
  else app?.removeAttribute('inert')
}

async function openPreview() {
  if (!props.products.length) return
  await fitLabelNames()
  isPreviewOpen.value = true
  document.body.classList.add('print-preview-open')
  setBackgroundInert(true)
  await nextTick()
  previewCloseButtonRef.value?.focus()
}

function closePreview({ restoreFocus = true } = {}) {
  if (!isPreviewOpen.value) return
  isPreviewOpen.value = false
  document.body.classList.remove('print-preview-open')
  setBackgroundInert(false)
  if (restoreFocus) nextTick(() => previewButtonRef.value?.focus())
}

function handleKeydown(event) {
  if (!isPreviewOpen.value) return
  if (event.key === 'Escape') {
    closePreview()
    return
  }
  if (event.key !== 'Tab') return
  const dialog = previewDialogRef.value
  const focusableElements = dialog ? [...dialog.querySelectorAll('button:not(:disabled)')] : []
  if (!focusableElements.length) return
  const firstElement = focusableElements[0]
  const lastElement = focusableElements[focusableElements.length - 1]
  const activeElement = document.activeElement
  if (!dialog.contains(activeElement)) {
    event.preventDefault()
    ;(event.shiftKey ? lastElement : firstElement).focus()
  } else if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault()
    lastElement.focus()
  } else if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault()
    firstElement.focus()
  }
}

watch(() => props.products.map(({ id, name }) => `${id}:${name}`).join('|'), fitLabelNames, { immediate: true })
watch(() => props.products.length, (count) => { if (!count) closePreview({ restoreFocus: false }) })
onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.classList.remove('print-preview-open')
  setBackgroundInert(false)
})

async function printLabels() {
  if (!props.products.length) return
  await fitLabelNames()
  window.print()
}
</script>

<template>
  <aside class="print-actions" aria-label="打印队列">
    <div class="print-actions-inner">
      <div class="selection-summary">
        <span class="selection-count">{{ products.length }}</span>
        <span>已选择 {{ products.length }} 个商品，共 {{ printPages.length }} 页</span>
      </div>
      <div class="print-buttons">
        <button type="button" class="secondary-button" :disabled="!products.length" @click="emit('clear')">清空打印队列</button>
        <button ref="previewButtonRef" type="button" class="secondary-button" :disabled="!products.length" @click="openPreview">打印预览</button>
        <button type="button" class="primary-button print-button" :disabled="!products.length" @click="printLabels">打印价格标签（{{ products.length }}）</button>
      </div>
    </div>
  </aside>

  <div class="print-name-measurer" aria-hidden="true">
    <div v-for="product in products" :key="product.id" class="print-name-measure-width">
      <span :ref="(element) => setNameMeasureElement(product.id, element)" class="label-name-measure">{{ product.name }}</span>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="print-preview">
      <div v-if="isPreviewOpen" class="print-preview-overlay" @click.self="closePreview()">
        <section ref="previewDialogRef" class="print-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="print-preview-title" aria-describedby="print-preview-description" tabindex="-1">
          <header class="print-preview-header">
            <div>
              <p class="eyebrow">PRINT PREVIEW</p>
              <h2 id="print-preview-title">打印预览</h2>
              <p id="print-preview-description">A4 横向 · 每页最多 28 张 · 共 {{ printPages.length }} 页</p>
            </div>
            <button ref="previewCloseButtonRef" type="button" class="print-preview-close" aria-label="关闭打印预览" @click="closePreview()">关闭</button>
          </header>
          <div class="print-preview-content">
            <article v-for="(page, pageIndex) in printPages" :key="pageIndex" class="print-preview-page-card">
              <p class="print-preview-page-caption">第 {{ pageIndex + 1 }} / {{ printPages.length }} 页</p>
              <div class="print-preview-page">
                <div class="print-preview-sheet">
                  <article v-for="product in page" :key="product.id" class="print-preview-label">
                    <div class="print-preview-label-top">
                      <img class="print-preview-logo" :src="logoUrl" alt="" />
                      <span class="print-preview-price">¥{{ formatPrice(product.price) }}</span>
                    </div>
                    <span class="print-preview-name" :style="{ fontSize: getPreviewNameSize(product.id) }">{{ product.name }}</span>
                  </article>
                </div>
              </div>
            </article>
          </div>
          <footer class="print-preview-footer">
            <span>已选择 {{ products.length }} 个商品，共 {{ printPages.length }} 页</span>
            <div class="print-preview-footer-actions">
              <button type="button" class="secondary-button" @click="closePreview()">返回修改</button>
              <button type="button" class="primary-button" @click="printLabels">确认打印</button>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>

  <div class="print-root" aria-hidden="true">
    <section v-for="(page, pageIndex) in printPages" :key="pageIndex" class="print-page">
      <main class="print-sheet">
        <article v-for="product in page" :key="product.id" class="price-label">
          <div class="label-top-row">
            <img class="label-logo" :src="logoUrl" alt="" />
            <span class="label-price">¥{{ formatPrice(product.price) }}</span>
          </div>
          <span class="label-name" :style="{ fontSize: nameFontSizes[product.id] || '5mm' }">{{ product.name }}</span>
        </article>
      </main>
    </section>
  </div>
</template>
