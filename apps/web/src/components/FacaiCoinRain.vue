<template>
  <div ref="stageEl" class="coin-stage" aria-hidden="true">
    <div ref="layerEl" class="coin-layer"></div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import coinUrl from '../assets/facai-coin.png';

/* 三路混播：A 垂直雨、B 斜抛、D 树冠爆开，同一批次里按配比混排。
   金币从树冠内部出现再向下飘落，不从天而降。 */
const MIX_CYCLE_MS = 5000;
const COIN_COUNT = 12;
/* 单枚金币的平均存活时长，用于算首屏铺满的错峰间隔 */
const COIN_LIFECYCLE_MS = 3500;
const RESIZE_DEBOUNCE_MS = 220;
const COIN_SIZE_RATIO = 0.075;
const COIN_SIZE_JITTER = 0.3;
const CROWN = { x: 0.5, y: 0.34, w: 0.74 };
const FADE_START = 0.8;
const KEYFRAME_STYLE_ID = 'facai-coin-keyframes';

const stageEl = ref(null);
const layerEl = ref(null);
const rand = (a, b) => a + Math.random() * (b - a);

/* 在树冠椭圆内取出生点，避免四角空白处凭空冒出金币 */
function crownSpawn(crown) {
  const cx = crown.x + crown.w / 2;
  const cy = crown.y + crown.h / 2;
  const r = Math.min(crown.w, crown.h) * 0.5;
  for (let i = 0; i < 12; i += 1) {
    const x = rand(crown.x, crown.x + crown.w);
    const y = rand(crown.y, crown.y + crown.h);
    if (Math.hypot(x - cx, y - cy) <= r) return { x, y };
  }
  return { x: cx, y: cy };
}

/* 量出树在舞台里的实际绘制区域，金币尺寸与出生点全部由它推导 */
function measureTree(stage, tree) {
  const stageRect = stage.getBoundingClientRect();
  const treeRect = tree.getBoundingClientRect();
  const box = Math.min(treeRect.width, treeRect.height) || 150;
  const ox = treeRect.left - stageRect.left + (treeRect.width - box) / 2;
  const oy = treeRect.top - stageRect.top + (treeRect.height - box) / 2;
  return {
    stageH: stageRect.height,
    treeW: box,
    crown: {
      x: ox + box * CROWN.x - (box * CROWN.w) / 2,
      y: oy + box * CROWN.y - (box * CROWN.w * 0.62) / 2,
      w: box * CROWN.w,
      h: box * CROWN.w * 0.62,
    },
  };
}

/* 12 枚 → A 7 / B 3 / D 2，洗牌避免 A 全排在前面导致前几秒全是同一路 */
function mixBag(count) {
  const nB = Math.max(1, Math.round(count * 0.25));
  const nD = Math.max(1, Math.round(count * 0.16));
  const nA = Math.max(count - nB - nD, 0);
  const bag = [...new Array(nA).fill('A'), ...new Array(nB).fill('B'), ...new Array(nD).fill('D')];
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

/* 关键帧只依赖每枚金币自带的 --drop / --drift 变量，因此只需注入一次 */
function ensureKeyframes() {
  if (document.getElementById(KEYFRAME_STYLE_ID)) return;
  const styleEl = document.createElement('style');
  styleEl.id = KEYFRAME_STYLE_ID;
  styleEl.textContent = `
    @keyframes facaiFallA{
      0%{transform:translate3d(0,0,0) scale(.35) rotateY(0deg) rotateZ(-14deg);opacity:0}
      9%{transform:translate3d(calc(var(--drift,0px) * .2),calc(var(--drop,200px) * .05),0) scale(1) rotateY(calc(var(--ry,140deg) * .2)) rotateZ(-8deg);opacity:1}
      50%{transform:translate3d(var(--drift,0px),calc(var(--drop,200px) * .5),0) rotateY(var(--ry,140deg)) rotateZ(4deg);opacity:1}
      88%{transform:translate3d(calc(var(--drift,0px) * .4),calc(var(--drop,200px) * .88),0) rotateY(calc(var(--ry,140deg) * 1.6)) rotateZ(-4deg);opacity:1}
      100%{transform:translate3d(calc(var(--drift,0px) * .1),var(--drop,200px),0) rotateY(calc(var(--ry,140deg) * 2)) rotateZ(-10deg);opacity:0}
    }
    @keyframes facaiFallB{
      0%{transform:translate3d(0,0,0) scale(.4) rotateZ(0deg);opacity:0}
      12%{transform:translate3d(calc(var(--drift,0px) * .5),calc(var(--drop,200px) * .12),0) scale(1) rotateZ(55deg);opacity:1}
      55%{transform:translate3d(calc(var(--drift,0px) * 1.1 * var(--dir,1)),calc(var(--drop,200px) * .55),0) rotateZ(150deg);opacity:1}
      88%{transform:translate3d(calc(var(--drift,0px) * 1.3 * var(--dir,1)),calc(var(--drop,200px) * .88),0) rotateZ(300deg);opacity:1}
      100%{transform:translate3d(calc(var(--drift,0px) * 1.4 * var(--dir,1)),var(--drop,200px),0) rotateZ(340deg);opacity:0}
    }
    @keyframes facaiFallD{
      0%{transform:translate3d(0,0,0) scale(.45) rotateZ(0deg);opacity:0}
      14%{transform:translate3d(var(--dx,20px),calc(var(--drop,200px) * .16),0) scale(1) rotateZ(80deg);opacity:1}
      46%{transform:translate3d(calc(var(--dx,20px) * .2),calc(var(--drop,200px) * .46),0) rotateZ(150deg);opacity:1}
      74%{transform:translate3d(calc(var(--dx,20px) * -.7),calc(var(--drop,200px) * .74),0) rotateZ(220deg);opacity:1}
      100%{transform:translate3d(var(--dx,20px),var(--drop,200px),0) rotateZ(300deg);opacity:0}
    }
  `;
  document.head.appendChild(styleEl);
}

let coinTimers = new Set();
let emitCount = 0;
let resizeTimer = null;
let resizeObserver = null;
let stage = null;
let layer = null;
let tree = null;

function createCoin(geo, pick, index) {
  const sizeBase = geo.treeW * COIN_SIZE_RATIO;
  const img = document.createElement('img');
  img.src = coinUrl;
  img.alt = '';
  img.className = 'facai-coin';
  const size = sizeBase * rand(1 - COIN_SIZE_JITTER, 1 + COIN_SIZE_JITTER);
  const spawn = crownSpawn(geo.crown);
  const drop = Math.max(0, geo.stageH * FADE_START - spawn.y);
  // 横向漂移以树冠宽度为基准：早先按金币尺寸算，金币才 9px，轨迹全是垂直线
  const drift = geo.crown.w * 0.34 * rand(0.55, 1.35) * (index % 2 ? 1 : -1);
  const rotateY = (index % 2 ? -1 : 1) * rand(100, 220);
  const duration = rand(2.6, 4.4);

  img.style.cssText =
    `width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;` +
    `left:${(spawn.x - size / 2).toFixed(1)}px;top:${(spawn.y - size / 2).toFixed(1)}px;` +
    `--drop:${drop.toFixed(1)}px;--drift:${drift.toFixed(1)}px;--ry:${rotateY.toFixed(0)}deg;--dir:${index % 2 ? -1 : 1};` +
    `--dx:${(drift * 1.2).toFixed(1)}px;` +
    `animation-duration:${duration.toFixed(2)}s;` +
    `animation-name:facaiFall${pick};`;
  return { img, duration };
}

/* 滚动补发：占满一屏所需金币 = 生命周期 / 发射间隔。
   早先是每 MIX_CYCLE_MS 清空整批重来，而动画时长 2.6–4.4s 与 5s 批次几乎同量级，
   于是每批开头三秒都在"爬坡"，画面上只有 1–2 枚。改成每枚金币播完立即补一枚，
   群规模恒定，任意时刻都在 10 枚以上。 */
function emitOnce() {
  if (!stage || !layer || !layer.isConnected) return;
  const geo = measureTree(stage, tree);
  const pick = mixBag(COIN_COUNT)[Math.floor(Math.random() * COIN_COUNT)];
  const { img, duration } = createCoin(geo, pick, emitCount);
  emitCount += 1;
  layer.appendChild(img);
  const nextGap = (duration * 1000) / COIN_COUNT;
  const timer = setTimeout(() => {
    img.remove();
    emitOnce();
  }, duration * 1000);
  coinTimers.add(timer);
}

function startRain() {
  stopRain();
  emitCount = 0;
  if (!stage || !layer || !tree) return;
  const geo = measureTree(stage, tree);
  // 首屏按错峰延迟一次性铺满，避免刚进页面时画面是空的
  const warmup = mixBag(COIN_COUNT);
  const stagger = COIN_LIFECYCLE_MS / 1000 / COIN_COUNT;
  warmup.forEach((pick, i) => {
    const { img } = createCoin(geo, pick, i);
    img.style.animationDelay = `${(i * stagger).toFixed(2)}s`;
    layer.appendChild(img);
    emitCount += 1;
  });
  // 预热批次播完后统一交给滚动补发，此后群规模保持恒定
  const handover = setTimeout(() => {
    layer.replaceChildren();
    emitOnce();
  }, COIN_LIFECYCLE_MS);
  coinTimers.add(handover);
}

function stopRain() {
  for (const timer of coinTimers) clearTimeout(timer);
  coinTimers.clear();
  layer?.replaceChildren();
}

onMounted(() => {
  stage = stageEl.value;
  layer = layerEl.value;
  tree = stage?.closest('.facai-stage')?.querySelector('.facai-img');
  if (!stage || !layer || !tree) return;
  // 尊重系统「减弱动态效果」：不生成金币，只保留静态树
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  ensureKeyframes();
  startRain();
  resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => startRain(), RESIZE_DEBOUNCE_MS);
  });
  resizeObserver.observe(stage);
});

onBeforeUnmount(() => {
  clearTimeout(resizeTimer);
  stopRain();
  resizeObserver?.disconnect();
  resizeObserver = null;
  stage = null;
  layer = null;
  tree = null;
});
</script>
