<script setup>
import { computed, ref, watch } from 'vue'
import { MAX_COLOR_ROWS, MAX_FEATURES, MIN_FEATURES, getTotalColorRows } from '../types.js'
import { calcSubsidyPrice } from '../subsidy.js'
import { getBuiltinIcons, iconCategoriesOf } from '../icon-library.js'
import { getCopiesForIcon } from '../feature-copy.js'
import { api } from '../api.js'

const props = defineProps({
  card: { type: Object, default: null },
  subsidyConfig: { type: Object, required: true },
  accessories: { type: Array, default: () => [] },
  services: { type: Array, default: () => [] },
  categories: { type: Array, required: true }
})

const emit = defineEmits(['change', 'notify', 'update-service'])

const collapsed = ref({ features: false, products: false, accessory: false, service: false })
const featureCollapsed = ref([false, true, true, true])

function toggleSection(key) {
  collapsed.value[key] = !collapsed.value[key]
}

function toggleFeature(index) {
  featureCollapsed.value[index] = !featureCollapsed.value[index]
}

function touch() {
  if (props.card) emit('change', props.card)
}

const categoryIcons = computed(() => getBuiltinIcons(props.card?.category))
const categoryIconGroups = computed(() => iconCategoriesOf(props.card?.category))
const totalRows = computed(() => (props.card ? getTotalColorRows(props.card) : 0))
const canAddRow = computed(() => totalRows.value < MAX_COLOR_ROWS)

const accessoryCategories = computed(() => [...new Set(props.accessories.map((item) => item.category))])

const serviceProductCategory = (item) => item.product_category ?? item.productCategory ?? ''

const availableServices = computed(() =>
  props.services.filter((item) => {
    const scope = serviceProductCategory(item)
    return !scope || scope === props.card?.category
  })
)
const availableServiceCategories = computed(() => [...new Set(availableServices.value.map((item) => item.category))])

function iconsByGroup(group) {
  return categoryIcons.value.filter((icon) => icon.category === group)
}

// 切换分类时校验图标归属，不属于则回落到首个
watch(
  () => props.card?.category,
  () => {
    const card = props.card
    if (!card) return
    const valid = new Set(categoryIcons.value.map((icon) => icon.name))
    for (const feature of card.features) {
      if (feature.iconType === 'builtin' && !valid.has(feature.iconName)) {
        feature.iconName = categoryIcons.value[0]?.name || ''
      }
    }
    touch()
  }
)

/* 选中图标后自动套用该图标的第一条文案，用户再在下拉框里换；
   没有文案的图标保持原样，不覆盖用户已手填的内容。
   文案按分类隔离：不同分类下可能有同名但内容不同的图标。 */
function applyIconCopy(feature) {
  const copies = copiesOf(feature)
  if (!copies.length) {
    feature.linkedCopy = ''
    return
  }
  const first = copies[0]
  feature.linkedCopy = `${first.title}|${first.desc}`
  feature.title = first.title
  feature.desc = first.desc
}

function onIconTypeChange(feature) {
  feature.iconSrc = ''
  feature.linkedCopy = ''
  if (feature.iconType === 'builtin') {
    if (!feature.iconName || !categoryIcons.value.some((icon) => icon.name === feature.iconName)) {
      feature.iconName = categoryIcons.value[0]?.name || ''
      applyIconCopy(feature)
    }
    feature.iconSize = 100
  } else if (feature.iconSize === 100) {
    feature.iconSize = 70
  }
  touch()
}

function selectIcon(feature, name) {
  if (feature.iconName === name) return
  feature.iconName = name
  feature.iconSize = 100
  applyIconCopy(feature)
  touch()
}

/* 下拉框选中一条文案：value 为「标题|副标题」，两条一起填 */
function onLinkedCopyChange(feature, value) {
  if (!value) return
  const [title, desc] = value.split('|')
  feature.linkedCopy = value
  feature.title = title || ''
  feature.desc = desc || ''
  touch()
}

function copiesOf(feature) {
  return getCopiesForIcon(feature.iconName, props.card?.category)
}

/* 下拉框的回显值：老展牌没有存 linkedCopy，但若标题/副标题恰好等于某条内置文案，
   就把它认回来，避免明明用的是内置文案、下拉框却显示"未选择"。 */
function currentLinkedValue(feature) {
  if (feature.linkedCopy) return feature.linkedCopy
  const hit = copiesOf(feature).find(
    (copy) => copy.title === feature.title && copy.desc === feature.desc
  )
  return hit ? `${hit.title}|${hit.desc}` : ''
}

function uploadIcon(feature, event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    feature.iconSrc = reader.result
    touch()
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

function addFeature() {
  if (!props.card || props.card.features.length >= MAX_FEATURES) return
  props.card.features.push({
    title: '', desc: '', iconType: 'builtin',
    iconName: categoryIcons.value[0]?.name || '', iconSrc: '', iconSize: 100, linkedCopy: ''
  })
  featureCollapsed.value.push(false)
  touch()
}

function deleteFeature(index) {
  if (!props.card || props.card.features.length <= MIN_FEATURES) return
  props.card.features.splice(index, 1)
  featureCollapsed.value.splice(index, 1)
  touch()
}

function addProduct() {
  if (!props.card || !canAddRow.value) return
  props.card.products.push({ config: '', colors: [{ name: '', price: 0, subsidyPrice: 0 }] })
  touch()
}

function deleteProduct(index) {
  if (!props.card) return
  if (!window.confirm(`确定要删除产品 ${index + 1} 吗？`)) return
  props.card.products.splice(index, 1)
  if (!props.card.products.length) {
    props.card.products.push({ config: '', colors: [] })
  }
  touch()
}

function addColor(productIndex) {
  if (!props.card || !canAddRow.value) return
  props.card.products[productIndex].colors.push({ name: '', price: 0, subsidyPrice: 0 })
  touch()
}

function deleteColor(productIndex, colorIndex) {
  if (!props.card) return
  if (!window.confirm('确定要删除该颜色吗？')) return
  props.card.products[productIndex].colors.splice(colorIndex, 1)
  touch()
}

function onPriceInput(color, event) {
  const raw = event.target.value
  color.price = raw === '' ? 0 : Number(raw)
  // 输入原价后按展牌分类自动计算国补价
  const auto = calcSubsidyPrice(color.price, props.card?.category, props.subsidyConfig)
  if (auto !== null) color.subsidyPrice = auto
  touch()
}

function onSubsidyInput(color, event) {
  const raw = event.target.value
  color.subsidyPrice = raw === '' ? 0 : Number(raw)
  touch()
}

function selectAccessory(slot, name) {
  if (!props.card || !name) return
  const item = props.accessories.find((entry) => entry.name === name)
  if (!item) return
  if (slot === 1) {
    props.card.accessory1Name = item.name
    props.card.accessory1Price = item.price
  } else {
    props.card.accessory2Name = item.name
    props.card.accessory2Price = item.price
  }
  touch()
}

function clearAccessory(slot) {
  if (!props.card) return
  if (slot === 1) {
    props.card.accessory1Name = ''
    props.card.accessory1Price = 0
  } else {
    props.card.accessory2Name = ''
    props.card.accessory2Price = 0
  }
  touch()
}

function selectService(slot, value) {
  if (!props.card || !value) return
  const [name, price] = value.split('|||')
  if (slot === 1) {
    props.card.service1Name = name
    props.card.service1Price = Number(price) || 0
  } else {
    props.card.service2Name = name
    props.card.service2Price = Number(price) || 0
  }
  touch()
}

function priceFieldValue(value) {
  return value && value > 0 ? value : ''
}

/* ---------- 服务库管理 ---------- */
const serviceLibraryOpen = ref(false)
const serviceDraft = ref({ id: null, name: '', price: '', category: '', productCategory: '' })

function resetServiceDraft() {
  serviceDraft.value = { id: null, name: '', price: '', category: '', productCategory: '' }
}

function openServiceLibrary() {
  resetServiceDraft()
  serviceLibraryOpen.value = true
}

function closeServiceLibrary() {
  serviceLibraryOpen.value = false
  resetServiceDraft()
}

function editServiceRow(item) {
  serviceDraft.value = {
    id: item.id,
    name: item.name,
    price: item.price,
    category: item.category || '',
    productCategory: item.product_category || ''
  }
}

async function submitService() {
  const draft = serviceDraft.value
  const name = draft.name.trim()
  if (!name) {
    emit('notify', { type: 'error', message: '请填写服务名称' })
    return
  }
  const payload = {
    name,
    price: Number(draft.price) || 0,
    category: draft.category.trim(),
    productCategory: draft.productCategory
  }
  try {
    if (draft.id) {
      const row = await api.updateService(draft.id, payload)
      emit('update-service', { type: 'update', row })
      emit('notify', { type: 'success', message: '服务已更新' })
    } else {
      const row = await api.createService(payload)
      emit('update-service', { type: 'create', row })
      emit('notify', { type: 'success', message: '服务已新增' })
    }
    resetServiceDraft()
  } catch (error) {
    emit('notify', { type: 'error', message: error.message || '保存失败' })
  }
}

async function removeServiceRow(item) {
  try {
    await api.deleteService(item.id)
    emit('update-service', { type: 'delete', row: item })
    emit('notify', { type: 'success', message: '服务已删除' })
    if (serviceDraft.value.id === item.id) resetServiceDraft()
  } catch (error) {
    emit('notify', { type: 'error', message: error.message || '删除失败' })
  }
}

// 把当前槽位填写的服务存入服务库
async function saveServiceToLibrary(slot) {
  const name = (slot === 1 ? props.card?.service1Name : props.card?.service2Name || '').trim()
  const price = slot === 1 ? props.card?.service1Price : props.card?.service2Price
  if (!name) return
  if (props.services.some((item) => item.name === name)) {
    emit('notify', { type: 'error', message: '服务库中已存在同名服务' })
    return
  }
  try {
    const row = await api.createService({
      name,
      price: Number(price) || 0,
      category: '增值服务',
      productCategory: props.card?.category || ''
    })
    emit('update-service', { type: 'create', row })
    emit('notify', { type: 'success', message: '已存入服务库' })
  } catch (error) {
    emit('notify', { type: 'error', message: error.message || '存入失败' })
  }
}
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2>展牌编辑</h2>
      <small>修改自动保存</small>
    </header>

    <div v-if="!card" class="empty">
      <p>暂无选中展牌</p>
      <span>在左侧选择一张展牌开始编辑</span>
    </div>

    <div v-else class="form-body">
      <!-- 产品信息 -->
      <div class="sec">
        <button class="sec-head" @click="toggleSection('card')">
          <span class="toggle" :class="{ collapsed: collapsed.card }">▾</span>
          <span>产品信息</span>
        </button>
        <div v-show="!collapsed.card" class="sec-body">
          <div class="form-group">
            <label>产品名称</label>
            <div class="switch-wrap">
              <label class="switch">
                <input type="checkbox" v-model="card.showProductImage" @change="touch" />
                <span class="switch-slider"></span>
              </label>
              <span class="switch-text">显示 AI 图标</span>
            </div>
            <input v-model="card.productTitle" class="input" @input="touch" />
          </div>
          <div class="form-group">
            <label>分类</label>
            <select v-model="card.category" class="input" @change="touch">
              <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 卖点信息 -->
      <div class="sec">
        <button class="sec-head" @click="toggleSection('features')">
          <span class="toggle" :class="{ collapsed: collapsed.features }">▾</span>
          <span>卖点信息</span>
        </button>
        <div v-show="!collapsed.features" class="sec-body">
          <div v-for="(feature, index) in card.features" :key="index" class="feat-row">
            <div class="feat-top" @click="toggleFeature(index)">
              <span class="feat-arrow" :class="{ collapsed: featureCollapsed[index] }">▾</span>
              <span class="t">卖点 {{ index + 1 }}{{ feature.title ? ' · ' + feature.title : '' }}</span>
              <button
                v-if="card.features.length > MIN_FEATURES"
                class="btn-del-feat"
                title="删除此卖点"
                @click.stop="deleteFeature(index)"
              >×</button>
            </div>

            <div v-show="!featureCollapsed[index]" class="feat-body">
              <div class="form-group">
                <label>图标类型</label>
                <select v-model="feature.iconType" class="input" @change="onIconTypeChange(feature)">
                  <option value="builtin">内置图标</option>
                  <option value="image">上传图片</option>
                  <option value="svg">粘贴 SVG 代码</option>
                </select>
              </div>

              <div v-if="feature.iconType === 'builtin'" class="form-group">
                <label>选择图标</label>
                <div class="builtin-icon-picker">
                  <div v-for="group in categoryIconGroups" :key="group" class="builtin-icon-group">
                    <div class="builtin-icon-cat">{{ group }}</div>
                    <div class="builtin-icon-grid">
                      <button
                        v-for="icon in iconsByGroup(group)"
                        :key="icon.name"
                        type="button"
                        class="builtin-icon-item"
                        :class="{ active: feature.iconName === icon.name }"
                        :title="icon.name"
                        @click="selectIcon(feature, icon.name)"
                      >
                        <img :src="icon.src" :alt="icon.name" />
                        <span>{{ icon.name }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="feature.iconType === 'image'" class="form-group">
                <label>上传图片</label>
                <div class="icon-row">
                  <label class="btn btn-sm upload-label">
                    选择图片
                    <input type="file" accept="image/*" hidden @change="uploadIcon(feature, $event)" />
                  </label>
                  <span v-if="feature.iconSrc" class="icon-file-name">已选择</span>
                  <div class="size-inline">
                    <label>大小（%）</label>
                    <input v-model.number="feature.iconSize" type="number" min="1" max="100" class="input" @input="touch" />
                  </div>
                </div>
              </div>

              <div v-if="feature.iconType === 'svg'" class="form-group">
                <label>SVG 代码</label>
                <textarea
                  v-model="feature.iconSrc"
                  class="input svg-textarea"
                  rows="3"
                  placeholder="粘贴 SVG 代码，如：<svg>...</svg>"
                  @input="touch"
                ></textarea>
                <div class="size-inline" style="margin-top: 6px">
                  <label>大小（%）</label>
                  <input v-model.number="feature.iconSize" type="number" min="1" max="100" class="input" @input="touch" />
                </div>
              </div>

              <div v-if="feature.iconType === 'builtin' && copiesOf(feature).length" class="form-group">
                <label>卖点文案<span class="label-hint">选中即填入标题与副标题</span></label>
                <select
                  class="input"
                  :value="currentLinkedValue(feature)"
                  @change="onLinkedCopyChange(feature, $event.target.value)"
                >
                  <option v-if="!currentLinkedValue(feature)" value="">从下方文案中选择，或直接手填</option>
                  <option v-for="copy in copiesOf(feature)" :key="copy.title + copy.desc" :value="`${copy.title}|${copy.desc}`">
                    {{ copy.title }} — {{ copy.desc }}
                  </option>
                </select>
              </div>

              <div class="form-group">
                <label>标题</label>
                <input v-model="feature.title" class="input" @input="touch" />
              </div>
              <div class="form-group">
                <label>副标题</label>
                <input v-model="feature.desc" class="input" @input="touch" />
              </div>
            </div>
          </div>

          <button
            v-if="card.features.length < MAX_FEATURES"
            class="btn-add-feat"
            @click="addFeature"
          >＋ 添加卖点（{{ MIN_FEATURES }}–{{ MAX_FEATURES }} 个）</button>
        </div>
      </div>

      <!-- 产品价格 -->
      <div class="sec">
        <button class="sec-head" @click="toggleSection('products')">
          <span class="toggle" :class="{ collapsed: collapsed.products }">▾</span>
          <span>产品价格配置</span>
          <span class="spacing" @click.stop>
            <label>行间距</label>
            <input v-model.number="card.priceRowSpacing" type="range" min="0" max="12" step="1" @input="touch" />
            <span class="spacing-value">{{ (card.priceRowSpacing || 0) > 0 ? '+' : '' }}{{ card.priceRowSpacing || 0 }}px</span>
          </span>
        </button>
        <div v-show="!collapsed.products" class="sec-body">
          <div v-for="(product, productIndex) in card.products" :key="productIndex" class="product-item">
            <div class="product-item-head">
              <span>产品 {{ productIndex + 1 }}</span>
              <button class="btn-del-round" @click="deleteProduct(productIndex)">×</button>
            </div>
            <div class="form-group">
              <label>配置信息</label>
              <input v-model="product.config" class="input" @input="touch" />
            </div>
            <div v-for="(color, colorIndex) in product.colors" :key="colorIndex" class="color-row">
              <input v-model="color.name" type="text" placeholder="颜色" @input="touch" />
              <input
                type="number"
                :value="priceFieldValue(color.subsidyPrice)"
                placeholder="国补价"
                @input="onSubsidyInput(color, $event)"
              />
              <input
                type="number"
                :value="priceFieldValue(color.price)"
                placeholder="原价"
                @input="onPriceInput(color, $event)"
              />
              <button class="btn-del-round" @click="deleteColor(productIndex, colorIndex)">×</button>
            </div>
            <button class="btn-add-color" :disabled="!canAddRow" @click="addColor(productIndex)">＋ 添加颜色</button>
          </div>

          <button class="btn-add-feat" :disabled="!canAddRow" @click="addProduct">＋ 添加产品</button>
          <p v-if="!canAddRow" class="limit-hint">已达到最大行数（{{ MAX_COLOR_ROWS }} 行），请先删除已有产品或颜色</p>
        </div>
      </div>

      <!-- 配件信息 -->
      <div class="sec">
        <button class="sec-head" @click="toggleSection('accessory')">
          <span class="toggle" :class="{ collapsed: collapsed.accessory }">▾</span>
          <span>配件信息</span>
        </button>
        <div v-show="!collapsed.accessory" class="sec-body">
          <div class="switch-wrap">
            <label class="switch">
              <input type="checkbox" v-model="card.showAccessory" @change="touch" />
              <span class="switch-slider"></span>
            </label>
            <span class="switch-text">显示配件信息</span>
          </div>

          <div v-show="card.showAccessory">
            <div v-for="slot in [1, 2]" :key="slot" class="slot-block">
              <label class="slot-label">配件 {{ slot }}</label>
              <select
                class="input"
                :value="slot === 1 ? card.accessory1Name : card.accessory2Name"
                @change="selectAccessory(slot, $event.target.value)"
              >
                <option value="">-- 选择配件 --</option>
                <optgroup v-for="category in accessoryCategories" :key="category" :label="category">
                  <option
                    v-for="item in accessories.filter((entry) => entry.category === category)"
                    :key="item.name"
                    :value="item.name"
                  >{{ item.name }} ¥{{ item.price }}</option>
                </optgroup>
              </select>
              <div class="slot-current">
                <span>{{ slot === 1 ? card.accessory1Name : card.accessory2Name || '未选择' }}</span>
                <button class="btn-link" @click="clearAccessory(slot)">清除</button>
              </div>
            </div>
            <p class="tip-text">配件按分类分组，只能选择分类下的具体配件</p>
          </div>
        </div>
      </div>

      <!-- 服务信息 -->
      <div class="sec">
        <div class="sec-head sec-head-row">
          <button class="sec-head-main" @click="toggleSection('service')">
            <span class="toggle" :class="{ collapsed: collapsed.service }">▾</span>
            <span>服务信息</span>
          </button>
          <button class="lib-btn" @click.stop="openServiceLibrary">管理服务库</button>
        </div>
        <div v-show="!collapsed.service" class="sec-body">
          <div v-for="slot in [1, 2]" :key="slot" class="slot-block">
            <label class="slot-label">服务 {{ slot }}</label>
            <div class="slot-select-row">
              <select class="input" @change="selectService(slot, $event.target.value)">
                <option value="">-- 选择服务 --</option>
                <optgroup v-for="category in availableServiceCategories" :key="category" :label="category">
                  <option
                    v-for="item in availableServices.filter((entry) => entry.category === category)"
                    :key="item.name"
                    :value="`${item.name}|||${item.price}`"
                  >{{ item.name }} ¥{{ item.price }}</option>
                </optgroup>
              </select>
              <button
                class="lib-btn small"
                :disabled="!(slot === 1 ? card.service1Name : card.service2Name)"
                @click="saveServiceToLibrary(slot)"
              >存入服务库</button>
            </div>
            <div class="slot-edit">
              <input
                :value="slot === 1 ? card.service1Name : card.service2Name"
                class="input"
                placeholder="服务名称"
                @input="slot === 1 ? (card.service1Name = $event.target.value) : (card.service2Name = $event.target.value); touch()"
              />
              <input
                :value="slot === 1 ? card.service1Price : card.service2Price"
                type="number"
                class="input price-input"
                placeholder="价格"
                @input="slot === 1 ? (card.service1Price = Number($event.target.value) || 0) : (card.service2Price = Number($event.target.value) || 0); touch()"
              />
            </div>
          </div>
          <p class="tip-text">服务按展牌分类自动过滤，手机展牌不显示平板专属服务</p>
        </div>
      </div>
    </div>

    <!-- 服务库管理 -->
    <div v-if="serviceLibraryOpen" class="lib-mask" @click.self="closeServiceLibrary">
      <div class="lib-dialog">
        <header class="lib-head">
          <h3>管理服务库</h3>
          <button class="lib-close" @click="closeServiceLibrary">✕</button>
        </header>

        <div class="lib-form">
          <input v-model="serviceDraft.name" class="input" placeholder="服务名称" />
          <input v-model="serviceDraft.price" type="number" class="input" placeholder="价格" />
          <input v-model="serviceDraft.category" class="input" placeholder="分组（如 增值服务）" />
          <select v-model="serviceDraft.productCategory" class="input">
            <option value="">适用全部机型</option>
            <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
          </select>
          <button class="lib-primary" @click="submitService">
            {{ serviceDraft.id ? '保存修改' : '新增服务' }}
          </button>
          <button v-if="serviceDraft.id" class="lib-btn small" @click="resetServiceDraft">取消编辑</button>
        </div>

        <div class="lib-list">
          <div v-for="item in services" :key="item.id" class="lib-row">
            <div class="lib-row-main">
              <span class="lib-row-name">{{ item.name }}</span>
              <span class="lib-row-meta">{{ item.category || '增值服务' }} · {{ item.product_category || '全部机型' }}</span>
            </div>
            <span class="lib-row-price">¥{{ item.price }}</span>
            <button class="lib-btn small" @click="editServiceRow(item)">编辑</button>
            <button class="lib-btn small danger" @click="removeServiceRow(item)">删除</button>
          </div>
          <p v-if="!services.length" class="empty-hint">服务库为空，先在上方新增一条</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--line); border-radius: 12px;
  background: #fff; box-shadow: 0 6px 18px rgba(30,48,72,.06);
}
.panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 13px; border-bottom: 1px solid var(--line); background: #f7f9fc;
}
.panel-head h2 { margin: 0; font-size: 12.5px; }
.panel-head small { color: var(--muted); font-size: 10.5px; }

.form-body { flex: 1; min-height: 0; overflow-y: auto; padding: 20px; }
.empty { padding: 50px 0; text-align: center; }
.empty p { margin: 0 0 6px; color: #999; font-size: 13px; font-weight: 600; }
.empty span { color: #bbb; font-size: 11px; }

.sec { margin-bottom: 18px; }
.sec:last-child { margin-bottom: 0; }
.sec-head {
  width: 100%; display: flex; align-items: center; gap: 6px;
  padding: 4px 0; margin-bottom: 14px; border: 0; border-radius: 4px;
  background: transparent; font-size: 13px; font-weight: 600; color: #333;
  cursor: pointer; text-align: left; transition: background .15s;
}
.sec-head:hover { background: #f8f8f8; }
.sec-head .toggle { color: #666; font-size: 11px; transition: transform .2s; display: inline-block; }
.sec-head .toggle.collapsed { transform: rotate(-90deg); }

/* 带右侧操作按钮的标题行 */
.sec-head-row { cursor: default; }
.sec-head-row:hover { background: transparent; }
.sec-head-main {
  flex: 1; display: flex; align-items: center; gap: 6px; padding: 4px 0;
  border: 0; background: transparent; font-size: 13px; font-weight: 600;
  color: #333; cursor: pointer; text-align: left;
}
.lib-btn {
  padding: 4px 10px; border: 1px solid #cfdcea; border-radius: 6px;
  background: #fff; color: var(--blue); font-size: 11.5px; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap; transition: all .15s;
}
.lib-btn:hover { background: #eef4fa; border-color: var(--blue); }
.lib-btn.small { padding: 5px 9px; font-size: 11px; }
.lib-btn.danger { color: #b42318; border-color: #f0c9c5; }
.lib-btn.danger:hover { background: #fdf1f0; border-color: #b42318; }
.lib-btn:disabled { opacity: .45; cursor: not-allowed; }
.slot-select-row { display: flex; gap: 6px; align-items: center; }
.slot-select-row .input { flex: 1; min-width: 0; }

/* 服务库弹窗 */
.lib-mask {
  position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center;
  background: rgba(16,28,44,.42); padding: 24px;
}
.lib-dialog {
  width: min(680px, 100%); max-height: 78vh; display: flex; flex-direction: column;
  background: #fff; border-radius: 12px; overflow: hidden;
  box-shadow: 0 18px 48px rgba(0,0,0,.24);
}
.lib-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--line); background: #f7f9fc;
}
.lib-head h3 { margin: 0; font-size: 13.5px; color: #1a1a1a; }
.lib-close {
  width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent;
  color: #8a97a8; font-size: 13px; cursor: pointer;
}
.lib-close:hover { background: #eef2f7; color: #333; }
.lib-form {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
  padding: 14px 16px; border-bottom: 1px solid var(--line);
}
.lib-form .input { font-size: 12px; padding: 7px 10px; }
.lib-primary {
  padding: 8px 12px; border: 0; border-radius: 6px; background: var(--blue);
  color: #fff; font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;
}
.lib-primary:hover { background: #16507f; }
.lib-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 16px 14px; }
.lib-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0; border-bottom: 1px solid #f0f3f8;
}
.lib-row-main { flex: 1; min-width: 0; }
.lib-row-name {
  display: block; font-size: 12.5px; font-weight: 600; color: #1a1a1a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lib-row-meta { display: block; margin-top: 1px; color: #8a97a8; font-size: 10.5px; }
.lib-row-price { color: var(--blue); font-size: 12.5px; font-weight: 700; }
.empty-hint { padding: 24px 0; text-align: center; color: #a8b3c1; font-size: 12px; }

.form-group { margin-bottom: 18px; }
.form-group:last-child { margin-bottom: 0; }
.form-group label { display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 5px; }
.label-hint { margin-left: 6px; font-weight: 400; font-size: 11px; color: #999; }
.input {
  width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px;
  font-size: 13px; font-family: inherit; color: #333; outline: none; background: #fff;
  transition: border-color .2s, box-shadow .2s;
}
.input:focus { border-color: #9cc0e0; box-shadow: 0 0 0 3px rgba(26,94,156,.10); }
.svg-textarea { resize: vertical; font-family: ui-monospace, monospace; font-size: 12px; }

.switch-wrap { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.switch { position: relative; width: 36px; height: 20px; flex: none; cursor: pointer; }
.switch input { display: none; }
.switch-slider { position: absolute; inset: 0; background: #ddd; border-radius: 20px; transition: .3s; }
.switch-slider::before {
  content: ""; position: absolute; width: 16px; height: 16px; bottom: 2px; left: 2px;
  background: #fff; border-radius: 50%; transition: .3s;
}
.switch input:checked + .switch-slider { background: var(--blue); }
.switch input:checked + .switch-slider::before { transform: translateX(16px); }
.switch-text { font-size: 12px; font-weight: 600; color: #555; }

.feat-row { border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px; overflow: hidden; background: #fff; }
.feat-top {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  background: #fafafa; font-size: 13px; font-weight: 600; color: #555; cursor: pointer;
}
.feat-top:hover { background: #f0f0f0; }
.feat-arrow { color: #999; font-size: 11px; width: 14px; text-align: center; transition: transform .2s; display: inline-block; }
.feat-arrow.collapsed { transform: rotate(-90deg); }
.feat-top .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.btn-del-feat {
  width: 22px; height: 22px; display: grid; place-items: center;
  border: 0; border-radius: 50%; background: transparent; color: #ff4d4f;
  font-size: 15px; font-weight: 700; cursor: pointer;
}
.btn-del-feat:hover { background: rgba(255,77,79,.1); }
.feat-body { padding: 12px; }

.builtin-icon-picker {
  max-height: 260px; overflow-y: auto; padding: 8px;
  border: 1px solid #e5e5e5; border-radius: 8px; background: #fafafa;
}
.builtin-icon-group + .builtin-icon-group { margin-top: 10px; }
.builtin-icon-cat { font-size: 12px; font-weight: 600; color: #888; margin-bottom: 6px; }
.builtin-icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; }
.builtin-icon-item {
  display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 2px;
  border: 1px solid #e5e5e5; border-radius: 8px; background: #fff; cursor: pointer; transition: .15s;
}
.builtin-icon-item:hover { border-color: var(--blue); }
.builtin-icon-item.active { border-color: var(--blue); background: #eaf2f9; box-shadow: inset 0 0 0 1px var(--blue); }
.builtin-icon-item img { width: 28px; height: 28px; object-fit: contain; }
.builtin-icon-item span {
  font-size: 10px; color: #666; line-height: 1.1; text-align: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}
.builtin-icon-item.active span { color: var(--blue); font-weight: 600; }

.icon-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.upload-label { cursor: pointer; }
.icon-file-name { color: #20845f; font-size: 11px; font-weight: 600; }
.size-inline { flex: 1; min-width: 90px; }
.size-inline label { display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px; }

.product-item { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
.product-item-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.product-item-head span { font-size: 13px; font-weight: 600; color: #333; }
.btn-del-round {
  width: 22px; height: 22px; display: grid; place-items: center;
  border: 0; border-radius: 50%; background: #ff4d4f; color: #fff; font-size: 13px; cursor: pointer;
}
.color-row { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.color-row input {
  flex: 1; min-width: 0; padding: 7px 10px; border: 1px solid #ddd;
  border-radius: 6px; font-size: 13px; outline: none;
}
.color-row input:focus { border-color: #9cc0e0; }
.btn-add-color {
  width: 100%; margin-top: 8px; padding: 6px 12px; border: 1px dashed #ddd;
  border-radius: 6px; background: #f5f5f5; color: #888; font-size: 12px; cursor: pointer;
}
.btn-add-color:hover:not(:disabled) { color: var(--blue); background: #f4f9fe; border-color: var(--blue); }
.btn-add-color:disabled { opacity: .45; cursor: not-allowed; }
.btn-add-feat {
  width: 100%; margin-top: 8px; padding: 8px 12px; border: 1px dashed #ddd;
  border-radius: 6px; background: #f5f5f5; color: #888; font-size: 12px; cursor: pointer;
}
.btn-add-feat:hover:not(:disabled) { color: var(--blue); background: #f4f9fe; border-color: var(--blue); }
.btn-add-feat:disabled { opacity: .45; cursor: not-allowed; }
.limit-hint { margin: 8px 0 0; color: #ff4d4f; font-size: 12px; font-weight: 600; }

.spacing { display: flex; align-items: center; gap: 8px; margin-left: auto; padding: 2px 8px; border-radius: 6px; background: #fafafa; font-size: 12px; font-weight: 400; color: #666; }
.spacing input[type="range"] { width: 76px; accent-color: var(--blue); cursor: pointer; }
.spacing-value { min-width: 34px; text-align: right; color: var(--blue); font-weight: 600; }

.slot-block { margin-bottom: 12px; }
.slot-label { display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 5px; }
.slot-current { display: flex; align-items: center; justify-content: space-between; margin-top: 5px; font-size: 11.5px; color: #7a8899; }
.btn-link { border: 0; background: none; color: var(--blue); font-size: 11.5px; cursor: pointer; }
.btn-link:hover { text-decoration: underline; }
.slot-edit { display: flex; gap: 8px; margin-top: 6px; }
.price-input { width: 100px; flex: none; }
.tip-text { margin: 8px 0 0; color: #999; font-size: 11.5px; line-height: 1.6; }
</style>
