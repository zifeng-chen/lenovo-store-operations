<script setup>
import { computed } from 'vue';
import backgroundUrl from '../assets/badge-background.png';

const props = defineProps({
  employee: { type: Object, required: true }
});

const theme = computed(() => props.employee.theme === 'lenovo-red' ? 'lenovo-red' : 'default');
</script>

<template>
  <article :class="['employee-badge', `employee-badge--${theme}`]">
    <img v-if="theme === 'lenovo-red'" class="badge-background" :src="backgroundUrl" alt="" />
    <div class="badge-content">
      <h3 :class="{ 'is-long': props.employee.name.length > 8 }">{{ props.employee.name }}</h3>
      <span class="badge-name-divider" aria-hidden="true"></span>
      <p :class="{ 'is-long': props.employee.position.length > 14 }">{{ props.employee.position }}</p>
      <div class="badge-code-block">
        <div class="badge-qr">
          <img :src="props.employee.qrUrl" :alt="`${props.employee.name}的二维码`" />
        </div>
        <div class="badge-footer-copy">
          <span>联想官方体验店</span>
          <span>{{ theme === 'default' ? '企业微信' : '请您添加企业微信' }}</span>
        </div>
      </div>
    </div>
  </article>
</template>
