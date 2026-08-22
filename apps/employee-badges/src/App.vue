<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue';
import logoUrl from '@lenovo-store/shared/lenovo-logo.svg';
import BadgeForm from './components/BadgeForm.vue';
import BadgePreview from './components/BadgePreview.vue';
import EmployeeBadge from './components/EmployeeBadge.vue';
import { printBadgePages } from './printBadges.js';

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const employees = ref([]);
const editingId = ref(null);
const draft = reactive({ name: '', position: '', qrUrl: '', qrFileName: '' });
const qrError = ref('');
const formError = ref('');
const dragging = ref(false);
const printing = ref(false);
const draftQrIsNew = ref(false);
const printSource = ref(null);
let uploadVersion = 0;

const pages = computed(() => {
  const result = [];
  for (let index = 0; index < employees.value.length; index += 10) result.push(employees.value.slice(index, index + 10));
  return result;
});

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function validateImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = () => reject(new Error('无法读取所选图片'));
    image.src = url;
  });
}

function releaseDraftQr() {
  if (draftQrIsNew.value && draft.qrUrl) URL.revokeObjectURL(draft.qrUrl);
  draft.qrUrl = '';
  draft.qrFileName = '';
  draftQrIsNew.value = false;
}

function clearDraft({ keepEditing = false } = {}) {
  uploadVersion += 1;
  releaseDraftQr();
  draft.name = '';
  draft.position = '';
  qrError.value = '';
  formError.value = '';
  dragging.value = false;
  if (!keepEditing) editingId.value = null;
}

async function useQrFile(file) {
  const requestVersion = ++uploadVersion;
  qrError.value = '';
  formError.value = '';

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
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
    if (requestVersion !== uploadVersion) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    releaseDraftQr();
    draft.qrUrl = nextUrl;
    draft.qrFileName = file.name;
    draftQrIsNew.value = true;
  } catch (error) {
    URL.revokeObjectURL(nextUrl);
    if (requestVersion === uploadVersion) qrError.value = error.message;
  }
}

function clearQr() {
  uploadVersion += 1;
  releaseDraftQr();
  qrError.value = '';
}

function saveEmployee() {
  const name = draft.name.trim();
  const position = draft.position.trim();
  formError.value = '';
  if (!name || !position || !draft.qrUrl) {
    formError.value = '请填写员工姓名、岗位并上传二维码';
    return;
  }

  if (editingId.value) {
    const employee = employees.value.find((item) => item.id === editingId.value);
    if (!employee) {
      formError.value = '未找到需要修改的员工，请重新选择';
      return;
    }
    const previousQrUrl = employee.qrUrl;
    Object.assign(employee, { name, position, qrUrl: draft.qrUrl, qrFileName: draft.qrFileName });
    if (draftQrIsNew.value && previousQrUrl !== draft.qrUrl) URL.revokeObjectURL(previousQrUrl);
  } else {
    employees.value.push({ id: createId(), name, position, qrUrl: draft.qrUrl, qrFileName: draft.qrFileName });
  }

  draftQrIsNew.value = false;
  draft.qrUrl = '';
  draft.qrFileName = '';
  draft.name = '';
  draft.position = '';
  editingId.value = null;
  qrError.value = '';
  formError.value = '';
}

function editEmployee(id) {
  const employee = employees.value.find((item) => item.id === id);
  if (!employee) return;
  clearDraft();
  editingId.value = id;
  draft.name = employee.name;
  draft.position = employee.position;
  draft.qrUrl = employee.qrUrl;
  draft.qrFileName = employee.qrFileName;
  draftQrIsNew.value = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function removeEmployee(id) {
  const index = employees.value.findIndex((item) => item.id === id);
  if (index < 0) return;
  if (editingId.value === id) clearDraft();
  URL.revokeObjectURL(employees.value[index].qrUrl);
  employees.value.splice(index, 1);
}

function clearEmployees() {
  if (!employees.value.length || !window.confirm('确认清空全部员工工牌吗？')) return;
  clearDraft();
  employees.value.forEach((employee) => URL.revokeObjectURL(employee.qrUrl));
  employees.value = [];
}

async function printAll() {
  if (!employees.value.length || printing.value) return;
  printing.value = true;
  formError.value = '';
  try {
    await nextTick();
    await printBadgePages(printSource.value);
  } catch (error) {
    formError.value = error.message || '打印准备失败，请稍后重试';
  } finally {
    printing.value = false;
  }
}

onBeforeUnmount(() => {
  uploadVersion += 1;
  releaseDraftQr();
  employees.value.forEach((employee) => URL.revokeObjectURL(employee.qrUrl));
  document.getElementById('employee-badge-print-frame')?.remove();
});
</script>

<template>
  <main class="badge-app ls-theme">
    <header class="badge-app-header">
      <div class="badge-app-brand">
        <img class="ls-brand-logo" :src="logoUrl" alt="联想" />
        <div>
          <h1>联想员工工牌</h1>
          <p>54mm × 85mm 竖版工牌，A4 横向每页打印 10 张</p>
        </div>
      </div>
      <span class="privacy-status"><i></i>无数据持久化</span>
    </header>

    <div class="badge-workspace">
      <BadgeForm
        v-model:name="draft.name"
        v-model:position="draft.position"
        :qr-file-name="draft.qrFileName"
        :qr-error="qrError"
        :form-error="formError"
        :dragging="dragging"
        :editing="Boolean(editingId)"
        :employees="employees"
        :page-count="pages.length"
        :printing="printing"
        @select-qr="useQrFile"
        @clear-qr="clearQr"
        @update:dragging="dragging = $event"
        @save="saveEmployee"
        @cancel="clearDraft"
        @edit="editEmployee"
        @remove="removeEmployee"
        @clear-all="clearEmployees"
        @print="printAll"
      />
      <BadgePreview :pages="pages" />
    </div>

    <div ref="printSource" class="print-source" aria-hidden="true">
      <section v-for="(page, pageIndex) in pages" :key="pageIndex" class="badge-page">
        <div class="badge-grid">
          <div v-for="employee in page" :key="employee.id" class="badge-slot">
            <EmployeeBadge :employee="employee" />
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
