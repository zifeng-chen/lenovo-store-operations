import { createRouter, createWebHistory } from 'vue-router';
import { STORE_MODULES } from '@lenovo-store/shared';
import DashboardView from './views/DashboardView.vue';
import ModuleView from './views/ModuleView.vue';
import SystemView from './views/SystemView.vue';

const routes = [
  { path: '/', name: 'dashboard', component: DashboardView },
  ...STORE_MODULES.map((module) => ({
    path: module.route,
    name: module.id,
    component: ModuleView,
    props: { moduleId: module.id }
  })),
  { path: '/system', name: 'system', component: SystemView },
  { path: '/:pathMatch(.*)*', redirect: '/' }
];

export default createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
});
