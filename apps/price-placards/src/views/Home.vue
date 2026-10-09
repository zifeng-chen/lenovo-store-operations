<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg'
import PricePlacard from '../components/PricePlacard.vue'
import * as api from '../api.js'
import { processImage } from '../image.js'
import { printPlacards } from '../printPlacards.js'
import { hasUnexpectedPlacardOverflow } from '../placardOverflow.js'
import {
  blankContent, buildSourceDiffs, collectContentAssetIds, colorCount, deepClone, mapAccessorySource, mapSource, normalizeContent,
  sampleContent, sourceKey, unwrapComputerProducts, validateDraft,
} from '../model.js'

const placards = ref([])
const librarySearch = ref('')
const librarySort = ref('updated-desc')
const libraryVisibleLimit = ref(18)
const serviceCatalog = ref([])
const serviceCatalogOpen = ref(false)
const newService = reactive({ name: '', price: 1 })
const activeId = ref(null)
const draft = ref(blankContent())
const sourceSnapshots = ref([])
const savedVersion = ref(null)
const loading = ref(false)
const busy = ref(false)
const draftOverflow = ref(false)
const previewRef = ref(null)
const printSource = ref(null)
const imageClaimToken = ref(null)
const claimedImageIds = ref(new Set())
const notice = reactive({ text: '', error: false })
let noticeTimer
let sourceLoadSequence = 0

const sourcePickerOpen = ref(false)
const sourceTarget = ref('product')
const sourceLoading = ref(false)
const sourceRows = ref([])
const sourceSearch = ref('')
const selectedSourceKeys = ref(new Set())
const refreshOpen = ref(false)
const refreshDiffs = ref([])
const historyOpen = ref(false)
const history = ref([])
const historyDetail = ref(null)
const historyPreviewRef = ref(null)
const deleteTarget = ref(null)
const importState = reactive({ open: false, kind: '', file: null, summary: null, confirmation: '' })
const queue = ref([])
const printOverflow = ref(new Set())
const previewOpen = ref(false)

const errors = computed(() => validateDraft(draft.value))
const dirty = computed(() => savedVersion.value ? JSON.stringify({ content: normalizeContent(draft.value), sourceSnapshots: sourceSnapshots.value }) !== savedVersion.value : true)
const filteredPlacards = computed(() => {
  const query = librarySearch.value.trim().toLocaleLowerCase('zh-CN')
  const rows = query
    ? placards.value.filter((item) => item.title.toLocaleLowerCase('zh-CN').includes(query))
    : [...placards.value]
  return rows.sort((left, right) => {
    if (librarySort.value === 'updated-asc') return Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
    if (librarySort.value === 'title-asc') return left.title.localeCompare(right.title, 'zh-CN')
    if (librarySort.value === 'title-desc') return right.title.localeCompare(left.title, 'zh-CN')
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
})
const visiblePlacards = computed(() => librarySearch.value.trim()
  ? filteredPlacards.value
  : filteredPlacards.value.slice(0, libraryVisibleLimit.value))
const hasMorePlacards = computed(() => !librarySearch.value.trim() && visiblePlacards.value.length < filteredPlacards.value.length)
const hasUnsavedChanges = computed(() => activeId.value
  ? dirty.value
  : JSON.stringify(normalizeContent(draft.value)) !== JSON.stringify(normalizeContent(blankContent())) || sourceSnapshots.value.length > 0)
const sourceSelectionLimit = computed(() => sourceTarget.value === 'accessory' ? 2 : 5)
const filteredSources = computed(() => {
  const q = sourceSearch.value.trim().toLocaleLowerCase('zh-CN')
  if (!q) return sourceRows.value
  return sourceRows.value.filter((item) => JSON.stringify(item.row).toLocaleLowerCase('zh-CN').includes(q))
})
const expandedQueue = computed(() => queue.value.flatMap((item) => Array.from({ length: item.copies }, (_, copyIndex) => ({ ...item, copyIndex }))))
const printPages = computed(() => {
  const pages = []
  for (let index = 0; index < expandedQueue.value.length; index += 2) pages.push(expandedQueue.value.slice(index, index + 2))
  return pages
})

function toast(text, error = false) {
  notice.text = text
  notice.error = error
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.text = '' }, 3200)
}

function formatTime(value) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
}

function libraryTitleParts(title) {
  const query = librarySearch.value.trim()
  if (!query) return [{ text: title, match: false }]
  const index = title.toLocaleLowerCase('zh-CN').indexOf(query.toLocaleLowerCase('zh-CN'))
  if (index < 0) return [{ text: title, match: false }]
  return [
    { text: title.slice(0, index), match: false },
    { text: title.slice(index, index + query.length), match: true },
    { text: title.slice(index + query.length), match: false },
  ].filter((part) => part.text)
}

function loadMorePlacards() {
  libraryVisibleLimit.value += 18
}

async function run(operation, success) {
  busy.value = true
  try {
    const result = await operation()
    if (success) toast(success)
    return result
  } catch (error) {
    toast(error.message || '操作失败', true)
    return null
  } finally { busy.value = false }
}

async function ensureImageClaim() {
  if (imageClaimToken.value) return imageClaimToken.value
  const claim = await api.createImageClaim()
  imageClaimToken.value = claim.claimToken
  claimedImageIds.value = new Set()
  return claim.claimToken
}

async function releaseDraftClaim({ keepalive = false } = {}) {
  const token = imageClaimToken.value
  imageClaimToken.value = null
  claimedImageIds.value = new Set()
  if (!token) return
  try { await api.releaseImageClaim(token, { keepalive }) } catch {
    // 服务端 TTL 会回收浏览器崩溃、断网或 keepalive 失败遗留的临时 claim。
  }
}

async function prepareMaintenanceImport() {
  const health = await api.getSystemHealth()
  if (!health.maintenanceAuthenticationRequired) {
    api.setMaintenanceToken('')
    return true
  }
  const token = window.prompt('请输入系统维护令牌以执行全量导入')
  if (!token) return false
  api.setMaintenanceToken(token)
  return true
}

async function loadLibrary() {
  loading.value = true
  try { placards.value = await api.listPlacards() } catch (error) { toast(error.message, true) } finally { loading.value = false }
}

async function loadServiceCatalog() {
  try { serviceCatalog.value = await api.listServiceCatalog() } catch (error) { toast(error.message, true) }
}

async function openServiceCatalog() {
  await loadServiceCatalog()
  serviceCatalogOpen.value = true
}

function applyCatalogService(index, id) {
  const service = serviceCatalog.value.find((item) => item.id === Number(id))
  if (!service) return
  draft.value.services[index] = { name: service.name, price: service.price }
}

async function createCatalogService() {
  const created = await run(() => api.createServiceCatalogItem({ name: newService.name, price: Number(newService.price) }))
  if (!created) return
  newService.name = ''
  newService.price = 1
  await loadServiceCatalog()
  toast('服务已加入全局服务库')
}

async function saveCatalogService(item) {
  const updated = await run(() => api.updateServiceCatalogItem(item.id, { name: item.name, price: Number(item.price) }))
  if (!updated) return
  Object.assign(item, updated)
  await loadServiceCatalog()
  toast('服务库已更新')
}

async function removeCatalogService(item) {
  if (!window.confirm(`确定从全局服务库删除“${item.name}”吗？已保存展牌不会受影响。`)) return
  busy.value = true
  try {
    await api.deleteServiceCatalogItem(item.id)
    await loadServiceCatalog()
    toast('服务已从全局服务库删除')
  } catch (error) {
    toast(error.message || '删除失败', true)
  } finally { busy.value = false }
}

async function importServiceExcel(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const result = await run(() => api.importServiceCatalog(file))
  if (!result) return
  serviceCatalog.value = result.services
  toast(`服务库导入完成：新增 ${result.inserted} 项，更新 ${result.updated} 项`)
}

async function exportServiceExcel() {
  const result = await run(() => api.exportServiceCatalog())
  if (result) download(result, '想帮帮服务库.xlsx')
}

function setDraft(content, snapshots = [], id = null, version = null) {
  activeId.value = id
  draft.value = normalizeContent(deepClone(content))
  sourceSnapshots.value = deepClone(snapshots)
  savedVersion.value = version ? JSON.stringify({ content: normalizeContent(content), sourceSnapshots: snapshots }) : null
  historyOpen.value = false
  historyDetail.value = null
  nextTick(() => previewRef.value?.checkOverflow())
}

function confirmDraftReplacement() {
  return !hasUnsavedChanges.value || window.confirm('当前草稿有未保存修改，确定放弃并继续吗？')
}

async function newBlank(force = false) {
  if (!force && !confirmDraftReplacement()) return
  await releaseDraftClaim()
  setDraft(blankContent()); toast('已新建空白草稿，尚未保存')
}
async function newSample() {
  if (!confirmDraftReplacement()) return
  await releaseDraftClaim()
  setDraft(sampleContent()); toast('已载入示例模板草稿，尚未保存')
}

async function openPlacard(id) {
  if (!confirmDraftReplacement()) return
  const detail = await run(() => api.getPlacard(id))
  if (!detail) return
  await releaseDraftClaim()
  setDraft(detail.version.content, detail.version.sourceSnapshots, detail.id, detail.version)
}

function versionMatchesPayload(version, payload) {
  return JSON.stringify(normalizeContent(version.content)) === JSON.stringify(normalizeContent(payload.content))
    && JSON.stringify(version.sourceSnapshots) === JSON.stringify(payload.sourceSnapshots)
}

async function reconcileSaveResult(targetId, baselineIds, payload) {
  try {
    if (targetId) {
      const detail = await api.getPlacard(targetId)
      return versionMatchesPayload(detail.version, payload) ? detail : null
    }
    const latest = await api.listPlacards()
    const candidates = latest.filter((item) => !baselineIds.has(item.id) && item.title === payload.content.title)
    const matches = []
    for (const candidate of candidates) {
      const detail = await api.getPlacard(candidate.id)
      if (versionMatchesPayload(detail.version, payload)) matches.push(detail)
    }
    return matches.length === 1 ? matches[0] : null
  } catch {
    return null
  }
}

async function saveDraft() {
  await nextTick()
  const hasOverflow = previewRef.value?.checkOverflow()
  if (errors.value.length) return toast(errors.value[0], true)
  if (hasOverflow || draftOverflow.value) return toast('成品存在实际溢出，请调整内容后再保存', true)

  const targetId = activeId.value
  const payload = { content: normalizeContent(draft.value), sourceSnapshots: deepClone(sourceSnapshots.value), claimToken: imageClaimToken.value }
  let baselineIds = new Set(placards.value.map((item) => item.id))
  busy.value = true
  try {
    if (!targetId) {
      try {
        const latest = await api.listPlacards()
        placards.value = latest
        baselineIds = new Set(latest.map((item) => item.id))
      } catch {
        // 创建请求仍可继续；若响应也丢失，将使用当前保存库快照做尽力对账。
      }
    }

    let result
    let reconciled = false
    try {
      result = targetId ? await api.updatePlacard(targetId, payload) : await api.createPlacard(payload)
    } catch (error) {
      result = await reconcileSaveResult(targetId, baselineIds, payload)
      if (!result) return toast(error.message || '保存失败', true)
      reconciled = true
      if (payload.claimToken) {
        try { await api.releaseImageClaim(payload.claimToken) } catch {
          // 服务端提交成功时 claim 已消费；未消费时此处清理未使用认领。
        }
      }
    }

    imageClaimToken.value = null
    claimedImageIds.value = new Set()
    await loadLibrary()
    setDraft(result.version.content, result.version.sourceSnapshots, result.id, result.version)
    toast(reconciled ? '保存响应中断，已从服务端恢复保存结果' : targetId ? '已保存新版本' : '已保存到库')
  } finally {
    busy.value = false
  }
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  busy.value = true
  try {
    await api.deletePlacard(target.id)
    toast('已永久删除')
    deleteTarget.value = null
    if (activeId.value === target.id) await newBlank(true)
    await loadLibrary()
  } catch (error) {
    toast(error.message || '删除失败', true)
  } finally { busy.value = false }
}

function addFeature() {
  if (draft.value.features.length < 4) draft.value.features.push({ title: '新卖点', desc: '卖点描述', imageAssetId: null })
}
async function removeFeature(index) {
  if (draft.value.features.length <= 3) return
  const [removed] = draft.value.features.splice(index, 1)
  await releaseClaimedAssetIfUnused(removed?.imageAssetId)
}
function addProduct() { if (draft.value.products.length < 5 && colorCount(draft.value) < 6) draft.value.products.push({ config: '产品配置', colors: [{ name: '', price: 1 }] }) }
function removeProduct(index) {
  if (draft.value.products.length <= 1) return
  draft.value.products.splice(index, 1)
  sourceSnapshots.value = sourceSnapshots.value
    .filter((item) => !Object.hasOwn(item, 'productIndex') || item.productIndex !== index)
    .map((item) => Object.hasOwn(item, 'productIndex') && item.productIndex > index ? { ...item, productIndex: item.productIndex - 1 } : item)
}
function addColor(product) { if (colorCount(draft.value) < 6) product.colors.push({ name: '', price: 1 }) }
function removeColor(product, index) { if (product.colors.length > 1) product.colors.splice(index, 1) }

function trackClaimedImage(assetId) {
  const next = new Set(claimedImageIds.value)
  next.add(assetId)
  claimedImageIds.value = next
}

async function releaseClaimedAssetIfUnused(assetId) {
  const claimToken = imageClaimToken.value
  if (!claimToken || !assetId || !claimedImageIds.value.has(assetId) || collectContentAssetIds(draft.value).has(assetId)) return
  try {
    await api.releaseClaimedImage(claimToken, assetId)
    const next = new Set(claimedImageIds.value)
    next.delete(assetId)
    claimedImageIds.value = next
  } catch (error) {
    toast(error.message || '未使用图片释放失败，保存或离开草稿时将自动清理', true)
  }
}

async function uploadProductImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const processed = await run(() => processImage(file))
  if (!processed) return
  const claimToken = await run(() => ensureImageClaim())
  if (!claimToken) return
  const previousAssetId = draft.value.productImageType === 'custom' ? draft.value.productImageAssetId : null
  const stored = await run(() => api.uploadImage(processed, claimToken), '图片处理并上传成功')
  if (!stored) return
  draft.value.productImageType = 'custom'
  draft.value.productImageAssetId = stored.id
  trackClaimedImage(stored.id)
  await releaseClaimedAssetIfUnused(previousAssetId)
}

async function uploadFeatureImage(feature, event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const processed = await run(() => processImage(file))
  if (!processed) return
  const claimToken = await run(() => ensureImageClaim())
  if (!claimToken) return
  const previousAssetId = feature.imageAssetId
  const stored = await run(() => api.uploadImage(processed, claimToken), '卖点图片处理并上传成功')
  if (!stored) return
  feature.imageAssetId = stored.id
  trackClaimedImage(stored.id)
  await releaseClaimedAssetIfUnused(previousAssetId)
}

async function clearFeatureImage(feature) {
  const previousAssetId = feature.imageAssetId
  feature.imageAssetId = null
  await releaseClaimedAssetIfUnused(previousAssetId)
}

async function loadSources(modules) {
  const requestId = ++sourceLoadSequence
  const requestedModules = new Set(modules)
  sourceLoading.value = true
  sourceRows.value = []
  try {
    const [computerPayload, pricePayload] = await Promise.all([
      requestedModules.has('computer-labels') ? api.getComputerProducts() : Promise.resolve([]),
      requestedModules.has('price-labels') ? api.getPriceProducts() : Promise.resolve([]),
    ])
    if (requestId !== sourceLoadSequence) return false
    const computers = unwrapComputerProducts(computerPayload).map((row) => ({ module: 'computer-labels', row, key: sourceKey('computer-labels', row.id) }))
    const prices = unwrapComputerProducts(pricePayload).map((row) => ({ module: 'price-labels', row, key: sourceKey('price-labels', row.id) }))
    sourceRows.value = [...computers, ...prices]
    return true
  } catch (error) {
    if (requestId === sourceLoadSequence) toast(error.message, true)
    return false
  } finally {
    if (requestId === sourceLoadSequence) sourceLoading.value = false
  }
}

async function openSourcePicker(target = 'product') {
  sourceTarget.value = target === 'accessory' ? 'accessory' : 'product'
  sourcePickerOpen.value = true
  sourceSearch.value = ''
  selectedSourceKeys.value = new Set()
  const expectedModule = sourceTarget.value === 'accessory' ? 'price-labels' : 'computer-labels'
  await loadSources([expectedModule])
}

function toggleSource(key) {
  const next = new Set(selectedSourceKeys.value)
  if (next.has(key)) next.delete(key)
  else if (next.size < sourceSelectionLimit.value) next.add(key)
  selectedSourceKeys.value = next
}

function importSelectedSources() {
  const expectedModule = sourceTarget.value === 'accessory' ? 'price-labels' : 'computer-labels'
  const selectedRows = sourceRows.value.filter((item) => selectedSourceKeys.value.has(item.key))
  if (selectedRows.some((item) => item.module !== expectedModule)) return toast('所选来源类型与目标不匹配，请重新选择', true)
  const selected = selectedRows.filter((item) => item.module === expectedModule).slice(0, sourceSelectionLimit.value)
  const targetLabel = sourceTarget.value === 'accessory' ? '配件' : '产品'
  if (!selected.length) return toast(`请至少选择一个来源${targetLabel}`, true)

  if (sourceTarget.value === 'accessory') {
    if (!window.confirm(`将用所选来源更新前 ${selected.length} 个配件，并保存只读来源快照。确定继续吗？`)) return
    const nextAccessories = deepClone(draft.value.accessories)
    const newSnapshots = []
    selected.forEach((item, accessoryIndex) => {
      const mapped = mapAccessorySource(item.module, item.row)
      nextAccessories[accessoryIndex] = mapped.accessory
      newSnapshots.push({ accessoryIndex, sourceModule: item.module, sourceId: item.row.id, sourceUpdatedAt: mapped.sourceUpdatedAt, snapshot: mapped.snapshot })
    })
    draft.value.accessories = nextAccessories
    sourceSnapshots.value = [
      ...sourceSnapshots.value.filter((item) => Object.hasOwn(item, 'productIndex')),
      ...sourceSnapshots.value.filter((item) => Object.hasOwn(item, 'accessoryIndex') && item.accessoryIndex >= selected.length),
      ...newSnapshots,
    ]
    sourcePickerOpen.value = false
    return toast('已联动周边货品配件来源')
  }

  if (!window.confirm('来源复制将替换草稿中的全部产品；配件来源和其他区域保留。确定继续吗？')) return
  const products = []
  const snapshots = []
  const mappedSources = []
  selected.forEach((item, productIndex) => {
    const mapped = mapSource(item.module, item.row)
    mappedSources.push(mapped)
    products.push(mapped.product)
    snapshots.push({ productIndex, sourceModule: item.module, sourceId: item.row.id, sourceUpdatedAt: mapped.sourceUpdatedAt, snapshot: mapped.snapshot })
  })
  draft.value.productTitle = mappedSources[0]?.productTitle || draft.value.productTitle
  draft.value.products = products
  sourceSnapshots.value = [...snapshots, ...sourceSnapshots.value.filter((item) => Object.hasOwn(item, 'accessoryIndex'))]
  sourcePickerOpen.value = false
  toast('已联动产品来源；仓库商品没有价格，需手工填写后保存')
}

async function openRefresh() {
  if (!sourceSnapshots.value.length) return toast('当前草稿没有来源快照', true)
  const modules = new Set(sourceSnapshots.value.map((item) => item.sourceModule))
  const loaded = await loadSources(modules)
  if (!loaded) return
  const rows = new Map(sourceRows.value.map((item) => [item.key, item.row]))
  refreshDiffs.value = buildSourceDiffs(draft.value, sourceSnapshots.value, rows)
  refreshOpen.value = true
}

function applyRefresh() {
  const selected = refreshDiffs.value.filter((item) => item.apply && !item.missing)
  selected.forEach((item) => {
    if (item.path) {
      if (item.target === 'content') draft.value[item.path] = deepClone(item.value)
      else if (item.target === 'accessory') draft.value.accessories[item.targetIndex][item.path] = deepClone(item.value)
      else draft.value.products[item.targetIndex][item.path] = deepClone(item.value)
    }
    const snapshotIndex = sourceSnapshots.value.findIndex((source) => item.targetType === 'accessory'
      ? source.accessoryIndex === item.targetIndex
      : source.productIndex === item.targetIndex)
    if (snapshotIndex >= 0 && item.mapped) {
      sourceSnapshots.value[snapshotIndex].snapshot = deepClone(item.mapped.snapshot)
      sourceSnapshots.value[snapshotIndex].sourceUpdatedAt = item.mapped.sourceUpdatedAt
    }
  })
  refreshOpen.value = false
  toast(selected.length ? `已应用 ${selected.length} 项更新` : '未覆盖任何字段')
}

async function openHistory() {
  if (!activeId.value) return toast('请先保存草稿', true)
  history.value = await run(() => api.listVersions(activeId.value)) || []
  historyOpen.value = true
}
async function viewVersion(versionId) { historyDetail.value = await run(() => api.getVersion(activeId.value, versionId)) }
async function validateHistoryWrite() {
  if (!historyDetail.value) return false
  const versionErrors = validateDraft(historyDetail.value.content)
  if (versionErrors.length) { toast(`历史版本无效：${versionErrors[0]}`, true); return false }
  await nextTick()
  await document.fonts?.ready
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (historyPreviewRef.value?.checkOverflow()) { toast('历史版本在当前冻结版式中实际溢出，已阻止写入', true); return false }
  return true
}
async function restoreHistory(versionId) {
  if (!(await validateHistoryWrite())) return
  if (!confirmDraftReplacement()) return
  const result = await run(() => api.restoreVersion(activeId.value, versionId), '已恢复为一个新版本')
  if (!result) return
  await releaseDraftClaim()
  await loadLibrary(); setDraft(result.version.content, result.version.sourceSnapshots, result.id, result.version)
}
async function copyHistory(versionId) {
  if (!historyDetail.value) return
  if (!confirmDraftReplacement()) return
  const result = await run(() => api.copyVersion(activeId.value, versionId), '已复制为新的库记录；原有错误可在副本中继续修改')
  if (!result) return
  await releaseDraftClaim()
  await loadLibrary(); setDraft(result.version.content, result.version.sourceSnapshots, result.id, result.version)
}

function download(result, fallback) {
  const match = result.disposition.match(/filename="?([^";]+)"?/i)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(result.blob)
  link.download = match?.[1] || fallback
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
async function exportBackup(kind) {
  const result = await run(() => kind === 'json' ? api.exportJson() : api.exportDatabase())
  if (result) download(result, `price-placards.${kind === 'json' ? 'json' : 'db'}`)
}
async function preflightImport(kind, event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const authorized = await run(() => prepareMaintenanceImport())
  if (!authorized) return
  const summary = await run(() => api.importBackup(kind, file, true))
  if (!summary) return
  Object.assign(importState, { open: true, kind, file, summary, confirmation: '' })
}
async function commitImport() {
  if (importState.confirmation !== '导入') return toast('请输入“导入”以确认全量替换', true)
  const result = await run(() => api.importBackup(importState.kind, importState.file, false, '导入'), '导入成功')
  if (!result) return
  importState.open = false
  await newBlank(true)
  await loadLibrary()
}

function addToQueue() {
  if (errors.value.length) return toast(errors.value[0], true)
  if (imageClaimToken.value) return toast('未保存的自定义图片不能加入打印队列，请先显式保存展牌', true)
  if (previewRef.value?.checkOverflow() || draftOverflow.value) return toast('成品存在实际溢出，不能加入打印队列', true)
  queue.value.push({ key: `${Date.now()}-${Math.random()}`, title: draft.value.productTitle, content: normalizeContent(deepClone(draft.value)), copies: 1 })
  toast('已加入打印队列')
}
function moveQueue(index, direction) {
  const target = index + direction
  if (target < 0 || target >= queue.value.length) return
  const next = [...queue.value]
  ;[next[index], next[target]] = [next[target], next[index]]
  queue.value = next
}
function setCopies(item, value) { item.copies = Math.max(1, Math.min(99, Math.trunc(Number(value) || 1))) }
function updatePrintOverflow(key, overflowing) {
  const next = new Set(printOverflow.value)
  if (overflowing) next.add(key); else next.delete(key)
  printOverflow.value = next
}
async function doPrint() {
  if (!queue.value.length) return toast('打印队列为空', true)
  await nextTick()
  await document.fonts?.ready
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const activeKeys = new Set(expandedQueue.value.map((item) => `${item.key}-${item.copyIndex}`))
  const reportedOverflow = [...printOverflow.value].some((key) => activeKeys.has(key))
  const actualOverflow = [...(printSource.value?.querySelectorAll('.card') || [])].some(hasUnexpectedPlacardOverflow)
  if (reportedOverflow || actualOverflow) return toast('打印队列中存在实际溢出的成品，已阻止打印', true)
  const result = await run(() => printPlacards(printSource.value))
  if (result !== null) previewOpen.value = false
}

function handleBeforeUnload(event) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  Promise.all([loadLibrary(), loadServiceCatalog()])
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  releaseDraftClaim({ keepalive: true })
})
</script>

<template>
  <div class="app-shell ls-theme">
    <header class="app-header ls-page-header">
      <div class="header-inner">
        <img :src="logoUrl" class="brand-logo" alt="Lenovo" />
        <div><p class="ls-eyebrow">STORE OPERATIONS</p><h1>价格展牌打印</h1><p>编辑、留档、追溯与稳定打印 110 × 110mm 门店展牌</p></div>
        <div class="header-status"><span :class="['status-dot', { dirty }]" />{{ activeId ? `库记录 #${activeId}` : '未保存草稿' }} · {{ dirty ? '有未保存修改' : '已保存' }}</div>
      </div>
    </header>

    <main class="workspace">
      <div class="left-column">
      <aside class="library-panel ls-card">
        <div class="panel-heading"><div><p class="ls-eyebrow">LIBRARY</p><h2>保存库</h2></div><button class="icon-button" :disabled="loading" @click="loadLibrary">刷新</button></div>
        <div class="draft-actions"><button class="ls-button ls-button--secondary" @click="newBlank">空白新建</button><button class="ls-button ls-button--secondary" @click="newSample">示例草稿</button></div>
        <div class="library-toolbar"><input v-model.trim="librarySearch" type="search" placeholder="搜索产品标题…" aria-label="搜索保存库" /><select v-model="librarySort" aria-label="保存库排序"><option value="updated-desc">最近更新</option><option value="updated-asc">最早更新</option><option value="title-asc">标题 A–Z</option><option value="title-desc">标题 Z–A</option></select></div>
        <div class="library-summary"><span>共 {{ placards.length }} 条<span v-if="librarySearch.trim()">，找到 {{ filteredPlacards.length }} 条</span></span><button v-if="librarySearch" class="clear-search" @click="librarySearch = ''">清空搜索</button></div>
        <div v-if="loading" class="empty">正在读取…</div>
        <div v-else-if="!placards.length" class="empty">暂无已保存立牌</div>
        <div v-else-if="!filteredPlacards.length" class="empty">没有匹配的价格展牌</div>
        <div v-else class="library-list">
          <article v-for="item in visiblePlacards" :key="item.id" :class="['library-item', { active: activeId === item.id }]">
            <button class="library-open" @click="openPlacard(item.id)"><strong><template v-for="(part, index) in libraryTitleParts(item.title)" :key="index"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></strong><span>版本 {{ item.versionNumber }}</span><time>{{ formatTime(item.updatedAt) }}</time></button>
            <button class="danger-link" title="删除展牌" aria-label="删除展牌" @click="deleteTarget = item">删除</button>
          </article>
        </div>
        <button v-if="hasMorePlacards" class="library-more" @click="loadMorePlacards">加载更多（还有 {{ filteredPlacards.length - visiblePlacards.length }} 条）</button>
        <section class="data-tools">
          <h3>备份与恢复</h3>
          <div class="compact-grid"><button @click="exportBackup('json')">导出 JSON</button><button @click="exportBackup('database')">导出 DB</button><label>导入 JSON<input type="file" accept=".json,application/json" @change="preflightImport('json', $event)" /></label><label>导入 DB<input type="file" accept=".db,application/octet-stream" @change="preflightImport('database', $event)" /></label></div>
        </section>
      </aside>

      <section class="editor-panel ls-card">
        <div class="panel-heading sticky-heading"><div><p class="ls-eyebrow">EDITOR</p><h2>立牌编辑器</h2></div><div class="heading-actions"><button @click="openSourcePicker('product')">选择仓库货品</button><button @click="openRefresh">刷新来源</button><button @click="openHistory">历史</button><button class="primary" :disabled="busy" @click="saveDraft">显式保存</button></div></div>
        <div class="editor-scroll">
          <section class="form-section"><h3>基本信息</h3><div class="form-grid"><label>产品标题<input v-model.trim="draft.productTitle" maxlength="80" /></label></div><div class="inline-options"><label><input v-model="draft.showProductImage" type="checkbox" /> 显示产品配图</label><label><input v-model="draft.productImageType" type="radio" value="default" /> 默认图形</label><label><input v-model="draft.productImageType" type="radio" value="custom" /> 自定义图片</label><label class="upload-button">处理并上传<input type="file" accept="image/png,image/jpeg,image/webp" @change="uploadProductImage" /></label></div><p class="hint">价格展牌名称与产品标题保持一致。原图仅 PNG/JPEG/WEBP、≤5MB；客户端 Canvas 将最长边限制为 1200px，并把处理副本压至 ≤1MB。</p></section>

          <section class="form-section">
            <div class="section-title"><h3>卖点 <span>3–4 项，图片可选；卖点和优势最多 20 字</span></h3><button :disabled="draft.features.length >= 4" @click="addFeature">添加</button></div>
            <div v-for="(feature, index) in draft.features" :key="index" class="repeat-row feature-edit">
              <input v-model.trim="feature.title" maxlength="20" aria-label="卖点标题" />
              <textarea v-model.trim="feature.desc" maxlength="20" rows="2" aria-label="卖点描述" />
              <div class="feature-actions">
                <label class="upload-button">{{ feature.imageAssetId ? '替换图片' : '上传图片' }}<input type="file" accept="image/png,image/jpeg,image/webp" :aria-label="`卖点 ${index + 1} 图片`" @change="uploadFeatureImage(feature, $event)" /></label>
                <button v-if="feature.imageAssetId" @click="clearFeatureImage(feature)">清除图片</button>
                <button :disabled="draft.features.length <= 3" @click="removeFeature(index)">移除</button>
              </div>
            </div>
            <p class="hint">卖点图片可不上传；上传时处理规则与产品图一致，并在 12mm 橙色色块内按 75% 大小居中显示。</p>
          </section>

          <section class="form-section"><div class="section-title"><h3>产品 <span>1–5 项，颜色可空，共 1–6 行</span></h3><div class="heading-actions"><button @click="openSourcePicker('product')">从仓库货品选择产品</button><button :disabled="draft.products.length >= 5 || colorCount(draft) >= 6" @click="addProduct">添加产品</button></div></div><article v-for="(product, productIndex) in draft.products" :key="productIndex" class="product-edit"><div class="repeat-row"><label class="grow">配置<input v-model.trim="product.config" maxlength="160" /></label><button :disabled="draft.products.length <= 1" @click="removeProduct(productIndex)">移除产品</button></div><div v-for="(color, colorIndex) in product.colors" :key="colorIndex" class="color-edit"><input v-model.trim="color.name" maxlength="40" aria-label="颜色" /><label class="price-input"><span>¥</span><input v-model.number="color.price" type="number" min="1" max="999999" step="1" aria-label="价格" /></label><button :disabled="product.colors.length <= 1" @click="removeColor(product, colorIndex)">移除</button></div><button class="subtle" :disabled="colorCount(draft) >= 6" @click="addColor(product)">+ 添加颜色</button><p v-if="sourceSnapshots.find((item) => item.productIndex === productIndex)" class="source-note">来源快照：{{ sourceSnapshots.find((item) => item.productIndex === productIndex).sourceModule }} #{{ sourceSnapshots.find((item) => item.productIndex === productIndex).sourceId }}（快照只读）</p></article><p class="hint">当前颜色 {{ colorCount(draft) }}/6；达到 5 行时冻结成品自动隐藏配件区。</p></section>

          <section class="form-section"><div class="section-title"><h3>推荐配件 <span>固定 2 项；产品信息达到 5 行自动隐藏</span></h3><div class="heading-actions"><label class="visibility-toggle"><input v-model="draft.showAccessory" type="checkbox" :disabled="colorCount(draft) >= 5" /> 显示配件</label><button @click="openSourcePicker('accessory')">从周边货品选择配件</button></div></div><template v-for="(item, index) in draft.accessories" :key="index"><div class="color-edit"><input v-model.trim="item.name" maxlength="80" /><label class="price-input"><span>¥</span><input v-model.number="item.price" type="number" min="1" max="999999" step="1" /></label></div><p v-if="sourceSnapshots.find((source) => source.accessoryIndex === index)" class="source-note">来源快照：{{ sourceSnapshots.find((source) => source.accessoryIndex === index).sourceModule }} #{{ sourceSnapshots.find((source) => source.accessoryIndex === index).sourceId }}（快照只读）</p></template></section>
          <section class="form-section"><div class="section-title"><h3>想帮帮 <span>固定 2 项，可选择或手工编辑</span></h3><div class="heading-actions"><button @click="openServiceCatalog">管理服务库</button><button @click="exportServiceExcel">导出 Excel</button><label class="upload-button">导入 Excel<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="importServiceExcel" /></label></div></div><div v-for="(item, index) in draft.services" :key="index" class="service-edit"><select aria-label="从服务库选择" @change="applyCatalogService(index, $event.target.value); $event.target.value = ''"><option value="">从全局服务库选择…</option><option v-for="service in serviceCatalog" :key="service.id" :value="service.id">{{ service.name }} · ¥{{ service.price }}</option></select><div class="color-edit"><input v-model.trim="item.name" maxlength="100" /><label class="price-input"><span>¥</span><input v-model.number="item.price" type="number" min="1" max="999999" step="1" /></label></div></div><p class="hint">选择服务只复制名称和价格到当前展牌，之后仍可手工修改；历史版本不会随服务库变化。</p></section>
        </div>
      </section>
      </div>

      <aside class="preview-panel ls-card">
        <div class="panel-heading"><div><p class="ls-eyebrow">LIVE PREVIEW</p><h2>冻结成品</h2></div><span :class="['overflow-state', { bad: draftOverflow }]">{{ draftOverflow ? '实际溢出' : '尺寸正常' }}</span></div>
        <div class="preview-stage"><div class="preview-scale"><PricePlacard ref="previewRef" :content="normalizeContent(draft)" @overflow="draftOverflow = $event" /></div></div>
        <div v-if="errors.length || draftOverflow" class="validation-box"><strong>保存/打印已阻止</strong><ul><li v-for="error in errors.slice(0, 4)" :key="error">{{ error }}</li><li v-if="draftOverflow">DOM 实际尺寸超过容器；不会自动缩字或截断。</li></ul></div>
        <section class="queue-panel"><div class="section-title"><h3>打印队列</h3><button @click="addToQueue">加入当前成品</button></div><div v-if="!queue.length" class="empty">队列为空</div><article v-for="(item, index) in queue" :key="item.key" class="queue-item"><strong>{{ item.title }}</strong><label>份数 <input :value="item.copies" type="number" min="1" max="99" @change="setCopies(item, $event.target.value)" /></label><div><button :disabled="index === 0" @click="moveQueue(index, -1)">上移</button><button :disabled="index === queue.length - 1" @click="moveQueue(index, 1)">下移</button><button @click="queue.splice(index, 1)">移除</button></div></article><button class="print-button primary" :disabled="!queue.length" @click="previewOpen = true">A4 预览（{{ expandedQueue.length }} 张）</button></section>
      </aside>
    </main>

    <div class="print-source" ref="printSource" aria-hidden="true">
      <section v-for="(page, pageIndex) in printPages" :key="pageIndex" class="print-page"><div class="print-sheet"><div v-for="item in page" :key="`${item.key}-${item.copyIndex}`" class="print-slot"><PricePlacard :content="item.content" @overflow="updatePrintOverflow(`${item.key}-${item.copyIndex}`, $event)" /></div></div></section>
    </div>

    <div v-if="sourcePickerOpen" class="modal-layer" role="dialog" aria-modal="true" aria-label="选择来源"><div class="modal wide"><div class="modal-header"><div><p class="ls-eyebrow">SOURCE</p><h2>选择{{ sourceTarget === 'accessory' ? '配件' : '产品' }}来源</h2></div><button @click="sourcePickerOpen = false">关闭</button></div><p class="hint">{{ sourceTarget === 'accessory' ? '配件仅可选择周边货品。' : '产品仅可选择仓库货品；仓库来源没有价格，带入后必须手工填写有效整数价格。' }} 来源会保存为只读快照。</p><input v-model="sourceSearch" class="search" :placeholder="sourceTarget === 'accessory' ? '搜索名称或分类' : '搜索名称、配置或 SKU'" /><div v-if="sourceLoading" class="empty">加载来源中…</div><div v-else-if="!filteredSources.length" class="empty">没有可选来源</div><div v-else class="source-list"><label v-for="item in filteredSources" :key="item.key" class="source-row"><input type="checkbox" :checked="selectedSourceKeys.has(item.key)" :disabled="!selectedSourceKeys.has(item.key) && selectedSourceKeys.size >= sourceSelectionLimit" @change="toggleSource(item.key)" /><span class="source-module">{{ item.module === 'computer-labels' ? '仓库货品' : '周边货品' }}</span><strong>{{ item.row.name }}</strong><span>{{ item.module === 'computer-labels' ? [item.row.sku, item.row.config, item.row.color].filter(Boolean).join(' · ') : `${item.row.category} · ¥${item.row.price}` }}</span></label></div><div class="modal-footer"><span>已选 {{ selectedSourceKeys.size }}/{{ sourceSelectionLimit }}</span><button class="primary" @click="importSelectedSources">复制到{{ sourceTarget === 'accessory' ? '配件' : '产品' }}</button></div></div></div>

    <div v-if="refreshOpen" class="modal-layer" role="dialog" aria-modal="true" aria-label="刷新来源"><div class="modal wide"><div class="modal-header"><div><p class="ls-eyebrow">SOURCE DIFF</p><h2>逐字段刷新</h2></div><button @click="refreshOpen = false">关闭</button></div><p class="hint">所有差异默认不覆盖。仅勾选确实要应用的字段。</p><div v-if="!refreshDiffs.length" class="empty">来源没有变化</div><label v-for="item in refreshDiffs" :key="item.key" :class="['diff-row', { missing: item.missing }]"><input v-model="item.apply" type="checkbox" :disabled="item.missing" /><strong>{{ item.targetType === 'accessory' ? '配件' : '产品' }} {{ item.targetIndex + 1 }} · {{ item.field }}</strong><span>当前：{{ item.before }}</span><span>来源：{{ item.after }}</span></label><div class="modal-footer"><span>勾选 {{ refreshDiffs.filter((item) => item.apply).length }} 项</span><button class="primary" @click="applyRefresh">应用勾选项</button></div></div></div>

    <div v-if="historyOpen" class="modal-layer" role="dialog" aria-modal="true" aria-label="版本历史"><div class="modal wide"><div class="modal-header"><div><p class="ls-eyebrow">HISTORY</p><h2>版本历史</h2></div><button @click="historyOpen = false">关闭</button></div><div class="history-layout"><div class="history-list"><button v-for="item in history" :key="item.id" @click="viewVersion(item.id)"><strong>版本 {{ item.versionNumber }}</strong><span>{{ formatTime(item.createdAt) }}</span></button></div><div class="history-detail"><div v-if="!historyDetail" class="empty">选择版本查看内容</div><template v-else><div class="history-placard"><PricePlacard ref="historyPreviewRef" :content="historyDetail.content" /></div><h3>{{ historyDetail.content.title }}</h3><p>{{ historyDetail.content.productTitle }} · {{ historyDetail.content.products.length }} 个产品</p><pre>{{ JSON.stringify(historyDetail.sourceSnapshots, null, 2) }}</pre><div class="heading-actions"><button @click="copyHistory(historyDetail.id)">复制为新记录</button><button class="primary" @click="restoreHistory(historyDetail.id)">恢复为新版本</button></div></template></div></div></div></div>

    <div v-if="serviceCatalogOpen" class="modal-layer" role="dialog" aria-modal="true" aria-label="想帮帮服务库"><div class="modal wide"><div class="modal-header"><div><p class="ls-eyebrow">SERVICE CATALOG</p><h2>想帮帮服务库</h2></div><button @click="serviceCatalogOpen = false">关闭</button></div><p class="hint">这里的数据对所有价格展牌可用；导入同名服务会覆盖价格，新名称会追加，未出现在文件中的原服务不会删除。</p><div class="catalog-create"><input v-model.trim="newService.name" maxlength="100" placeholder="服务名称" /><label class="price-input"><span>¥</span><input v-model.number="newService.price" type="number" min="1" max="999999" step="1" aria-label="新服务价格" /></label><button class="primary" :disabled="busy" @click="createCatalogService">新增服务</button></div><div class="catalog-tools"><label class="upload-button">导入 .xlsx<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="importServiceExcel" /></label><button @click="exportServiceExcel">导出 .xlsx</button><span>共 {{ serviceCatalog.length }} 项</span></div><div v-if="!serviceCatalog.length" class="empty">服务库为空，可手工新增或导入 Excel</div><div v-else class="catalog-list"><div v-for="item in serviceCatalog" :key="item.id" class="catalog-row"><input v-model.trim="item.name" maxlength="100" aria-label="服务名称" /><label class="price-input"><span>¥</span><input v-model.number="item.price" type="number" min="1" max="999999" step="1" aria-label="服务价格" /></label><button :disabled="busy" @click="saveCatalogService(item)">保存</button><button class="danger" :disabled="busy" @click="removeCatalogService(item)">删除</button></div></div></div></div>

    <div v-if="deleteTarget" class="modal-layer" role="alertdialog" aria-modal="true" aria-label="确认永久删除"><div class="modal small"><h2>永久删除？</h2><p>将硬删除“{{ deleteTarget.title }}”及全部历史版本，无法撤销。</p><div class="modal-footer"><button @click="deleteTarget = null">取消</button><button class="danger" @click="confirmDelete">再次确认永久删除</button></div></div></div>

    <div v-if="importState.open" class="modal-layer" role="alertdialog" aria-modal="true" aria-label="确认导入"><div class="modal small"><h2>导入预检已通过</h2><p>将全量替换当前价格立牌数据库。预检摘要：</p><pre>{{ JSON.stringify(importState.summary, null, 2) }}</pre><label>请输入“导入”<input v-model="importState.confirmation" autocomplete="off" /></label><div class="modal-footer"><button @click="importState.open = false">取消</button><button class="danger" :disabled="importState.confirmation !== '导入'" @click="commitImport">执行全量导入</button></div></div></div>

    <div v-if="previewOpen" class="modal-layer preview-layer" role="dialog" aria-modal="true" aria-label="A4 打印预览"><div class="modal preview-modal"><div class="modal-header"><div><p class="ls-eyebrow">A4 PORTRAIT</p><h2>打印预览</h2></div><button @click="previewOpen = false">关闭</button></div><div class="a4-list"><section v-for="(page, pageIndex) in printPages" :key="pageIndex" class="a4-page"><div class="a4-sheet"><div v-for="item in page" :key="`${item.key}-${item.copyIndex}`" class="a4-slot"><PricePlacard :content="item.content" /></div></div></section></div><div class="modal-footer"><span>共 {{ printPages.length }} 页；末页单张保持上方</span><button class="primary" @click="doPrint">隔离 iframe 打印</button></div></div></div>

    <Transition name="toast"><div v-if="notice.text" :class="['toast', { error: notice.error }]">{{ notice.text }}</div></Transition>
  </div>
</template>
