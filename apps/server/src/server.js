import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import { STORE_MODULES } from '@lenovo-store/shared';
import computerLabelsRouter, {
  apiBase as computerLabelsApiBase,
  getDatabase as getComputerLabelsDatabase,
  initializeDatabase as initializeComputerLabelsDatabase
} from './modules/computer-labels/index.js';
import priceLabelsRouter, {
  apiBase as priceLabelsApiBase,
  getDatabase as getPriceLabelsDatabase,
  initializeDatabase as initializePriceLabelsDatabase
} from './modules/price-labels/index.js';
import {
  apiBase as salesReportApiBase,
  createSalesReportRouter
} from './modules/sales-report/index.js';
import receiptAssistantRouter, {
  apiBase as receiptAssistantApiBase,
  OCR_KEY_PATH as receiptOcrKeyPath,
  getDatabase as getReceiptAssistantDatabase,
  initializeDatabase as initializeReceiptAssistantDatabase,
  receiptAssistantMaintenance
} from './modules/receipt-assistant/index.js';
import {
  DATA_ROOT,
  DATA_ROOT_SOURCE,
  EXTERNAL_DATA_ROOT_CONFIGURED,
  UNIFIED_DATA_DIR,
  UNIFIED_DATABASE_PATH
} from './config/data-paths.js';
import { createGithubReleaseService } from './system/github-release-service.js';
import { createMaintenanceAuthorizer, createSameOriginAuthorizer } from './system/maintenance-auth.js';
import { createPersistenceService } from './system/persistence-service.js';
import { runtimeInfo } from './system/runtime-info.js';
import { createSystemPersistenceRouter } from './system/router.js';
import {
  createUpdateIpcService,
  detectInstalledUpdatePlatform,
  resolveUpdateInstallationEnablement
} from './system/update-ipc-service.js';
import { createSystemUpdateRouter } from './system/update-router.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '../../..');
const dataRoot = DATA_ROOT;
const webDist = path.join(projectRoot, 'apps/web/dist');
const webIndex = path.join(webDist, 'index.html');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT) || 8900;
const maintenanceToken = String(process.env.LENOVO_STORE_MAINTENANCE_TOKEN || '').trim();
const updateRequestPath = process.env.LENOVO_STORE_UPDATE_REQUEST_PATH || '/run/lenovo-store-updater/request.json';
const updateProcessingPath = process.env.LENOVO_STORE_UPDATE_PROCESSING_PATH || '/run/lenovo-store-updater/claimed/processing.json';
const updateStatePath = process.env.LENOVO_STORE_UPDATE_STATE_PATH || '/var/lib/lenovo-store-updater/status.json';
const updaterConfigPath = process.env.LENOVO_STORE_UPDATER_CONFIG || '/etc/lenovo-store-updater.json';
const updaterProgramPath = '/usr/local/lib/lenovo-store-updater/updater.mjs';
const updaterPlatformDetected = detectInstalledUpdatePlatform({
  configPath: updaterConfigPath,
  programPath: updaterProgramPath,
  requestPath: updateRequestPath,
  processingPath: updateProcessingPath,
  statePath: updateStatePath,
});
const updateEnablement = resolveUpdateInstallationEnablement(
  process.env.LENOVO_STORE_UPDATE_ENABLED,
  updaterPlatformDetected,
);
const updateInstallationEnabled = updateEnablement.enabled;
const updateEnablementSource = updateEnablement.source;
const githubToken = process.env.LENOVO_STORE_GITHUB_TOKEN || '';
if (process.env.NODE_ENV === 'production' && maintenanceToken && maintenanceToken.length < 24) {
  throw new Error('生产环境的 LENOVO_STORE_MAINTENANCE_TOKEN 必须至少包含 24 个字符');
}
if (!maintenanceToken) {
  console.warn('警告：未配置维护令牌，可信局域网客户端可执行系统备份、恢复和已启用的在线更新');
}
if (updateEnablementSource === 'detected') {
  console.info('检测到完整的 root updater 平台，已自动启用在线安装入口');
}
const app = express();

const moduleRuntimes = new Map([
  ['computer-labels', {
    apiBase: computerLabelsApiBase,
    router: computerLabelsRouter,
    initializeDatabase: initializeComputerLabelsDatabase,
    jsonParser: express.json({ limit: '1mb' })
  }],
  ['price-labels', {
    apiBase: priceLabelsApiBase,
    router: priceLabelsRouter,
    initializeDatabase: initializePriceLabelsDatabase
  }],
  ['receipt-assistant', {
    apiBase: receiptAssistantApiBase,
    router: receiptAssistantRouter,
    initializeDatabase: initializeReceiptAssistantDatabase
  }]
]);
const databaseStatuses = new Map();
const persistenceService = createPersistenceService({
  runtimes: new Map([
    ['computer-labels', { getDatabase: getComputerLabelsDatabase }],
    ['price-labels', { getDatabase: getPriceLabelsDatabase }],
    ['receipt-assistant', { getDatabase: getReceiptAssistantDatabase }]
  ]),
  receiptMaintenance: receiptAssistantMaintenance,
  ocrKeyPath: receiptOcrKeyPath
});
const githubReleaseService = createGithubReleaseService({ githubToken });
const updateIpcService = createUpdateIpcService({
  enabled: updateInstallationEnabled,
  enablementSource: updateEnablementSource,
  requestPath: updateRequestPath,
  processingPath: updateProcessingPath,
  statePath: updateStatePath
});
const systemUpdateRouter = createSystemUpdateRouter({
  releaseService: githubReleaseService,
  ipcService: updateIpcService,
  maintenanceToken
});
const systemPersistenceRouter = createSystemPersistenceRouter({
  persistenceService,
  maintenanceToken,
  onModuleRestored(moduleId) {
    databaseStatuses.set(moduleId, { connected: true, error: null });
  }
});

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.enable('strict routing');
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      // Element Plus 与 echarts 会写行内样式，样式必须放行 unsafe-inline
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );
  next();
});
app.use(compression({
  threshold: 1024,
  level: 6,
  filter(request, response) {
    if (request.headers['x-no-compression']) return false;
    return compression.filter(request, response);
  }
}));
const corsMiddleware = cors();
app.use((request, response, next) => {
  const isRestrictedSystemRoute = request.path === '/api/system/health'
    || request.path.startsWith('/api/system/update');
  return isRestrictedSystemRoute ? next() : corsMiddleware(request, response, next);
});

function success(res, data, msg = 'success') {
  res.json({ code: 0, data, msg });
}

function initializeDatabases() {
  for (const module of STORE_MODULES) {
    if (module.persistence === 'none') {
      databaseStatuses.set(module.id, { connected: null, error: null });
      continue;
    }

    const runtime = moduleRuntimes.get(module.id);
    try {
      if (!runtime?.initializeDatabase) {
        throw new Error('模块缺少数据库运行时配置');
      }
      runtime.initializeDatabase();
      databaseStatuses.set(module.id, { connected: true, error: null });
    } catch (error) {
      console.error(`${module.name}数据库初始化失败：${error.message}`);
      databaseStatuses.set(module.id, { connected: false, error: error.message });
    }
  }
}

function moduleStatus(module) {
  const runtime = moduleRuntimes.get(module.id);
  const usesDatabase = module.persistence === 'sqlite';
  const dataDirectory = path.join(dataRoot, module.id);
  const moduleDist = path.join(projectRoot, 'apps', module.id, 'dist', 'index.html');
  const databaseStatus = databaseStatuses.get(module.id);
  return {
    ...module,
    apiReady: module.apiBase ? Boolean(runtime?.router) : null,
    moduleReady: fs.existsSync(moduleDist),
    dataDirectoryReady: usesDatabase ? fs.existsSync(UNIFIED_DATA_DIR) : null,
    databaseConnected: usesDatabase
      ? Boolean(databaseStatus?.connected && fs.existsSync(UNIFIED_DATABASE_PATH))
      : null,
    databaseError: usesDatabase ? databaseStatus?.error || null : null
  };
}

const LEGACY_HEALTH_MODULE_IDS = new Set([
  'computer-labels',
  'price-labels',
  'receipt-assistant',
  'employee-badges'
]);

function moduleIsOperational(module) {
  if (module.moduleReady !== true) return false;
  if (module.persistence === 'none') return true;
  return module.persistence === 'sqlite'
    && module.apiReady === true
    && module.dataDirectoryReady === true
    && module.databaseConnected === true;
}

initializeDatabases();

app.get('/api/system/health', (req, res) => {
  res.removeHeader('Access-Control-Allow-Origin');
  res.set('Cache-Control', 'no-store');
  res.vary('User-Agent');
  res.vary('X-Lenovo-Store-Health-Contract');
  const allModules = STORE_MODULES.map(moduleStatus);
  // v0.4 updater 使用 Node fetch 且没有契约头，并严格要求旧四模块集合。
  const legacyUpdater = req.get('User-Agent') === 'node'
    && req.get('X-Lenovo-Store-Health-Contract') !== '2';
  success(res, {
    status: allModules.every(moduleIsOperational) ? 'ok' : 'degraded',
    service: 'lenovo-store-operations',
    version: runtimeInfo.version,
    build: runtimeInfo,
    uptimeSeconds: Math.floor(process.uptime()),
    persistentDataConfigured: EXTERNAL_DATA_ROOT_CONFIGURED,
    maintenanceAuthenticationRequired: Boolean(maintenanceToken),
    maintenanceAccessMode: maintenanceToken ? 'token' : 'trusted-lan',
    updateInstallationEnabled,
    updateInstallationDetected: updaterPlatformDetected,
    updateEnablementSource,
    updateAuthenticationRequired: Boolean(maintenanceToken),
    portalReady: fs.existsSync(webIndex),
    modules: legacyUpdater
      ? allModules.filter(module => LEGACY_HEALTH_MODULE_IDS.has(module.id))
      : allModules
  });
});

app.use('/api/system/update', systemUpdateRouter);
app.use('/api/system', systemPersistenceRouter);

for (const module of STORE_MODULES) {
  if (!module.apiBase) continue;
  app.get(`${module.apiBase}/health`, (_req, res) => {
    success(res, moduleStatus(module));
  });
}

for (const runtime of moduleRuntimes.values()) {
  const middleware = runtime.jsonParser
    ? [runtime.jsonParser, runtime.router]
    : [runtime.router];
  app.use(runtime.apiBase, ...middleware);
}

app.use(salesReportApiBase, createSameOriginAuthorizer('销售报表只能从本系统页面访问'), createSalesReportRouter({ getDatabase: getReceiptAssistantDatabase }));

app.use('/api', (_req, res) => {
  res.status(404).json({ code: 1, data: null, msg: '接口不存在' });
});

const IMMUTABLE_ASSET_MAX_AGE = '365d';
function staticOptions() {
  return {
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders(response, filePath) {
      const isHashedAsset = /[\\/]assets[\\/]/.test(filePath) && /-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|jpe?g|svg|webp)$/.test(filePath);
      if (isHashedAsset) {
        response.setHeader('Cache-Control', `public, max-age=${IMMUTABLE_ASSET_MAX_AGE}, immutable`);
      } else {
        response.setHeader('Cache-Control', 'no-cache');
      }
    }
  };
}

for (const module of STORE_MODULES) {
  const moduleDist = path.join(projectRoot, 'apps', module.id, 'dist');
  const moduleIndex = path.join(moduleDist, 'index.html');
  const moduleBase = module.moduleBase;
  const moduleBaseWithoutSlash = moduleBase.replace(/\/$/, '');

  app.get(moduleBaseWithoutSlash, (_req, res) => res.redirect(308, moduleBase));
  if (!fs.existsSync(moduleIndex)) continue;

  app.use(moduleBase, express.static(moduleDist, staticOptions()));
  app.use(moduleBase, (req, res, next) => {
    if (req.method !== 'GET' || path.extname(req.path) || !req.accepts('html')) return next();
    return res.sendFile(moduleIndex);
  });
}

if (fs.existsSync(webIndex)) {
  app.use(express.static(webDist, staticOptions()));
  const legacyPortalRoutes = ['/system', ...STORE_MODULES.map((module) => module.route)];
  for (const legacyRoute of legacyPortalRoutes) {
    app.get(legacyRoute, (req, res, next) => {
      if (!req.accepts('html')) return next();
      return res.redirect(308, `/#${legacyRoute}`);
    });
  }
}

app.use((_req, res) => {
  res.status(404).send('页面不存在');
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ code: 1, data: null, msg: 'JSON 请求内容不能超过模块配置上限' });
  }
  if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 1, data: null, msg: 'JSON 请求内容无效' });
  }
  const status = Number.isInteger(error.status)
    ? error.status
    : Number.isInteger(error.statusCode) ? error.statusCode : 500;
  return res.status(status).json({ code: 1, data: null, msg: error.message || '服务器内部错误' });
});

app.listen(port, host, () => {
  console.log(`联想门店运营系统运行于 http://${host}:${port}`);
  console.log(`持久化数据目录：${dataRoot}（${DATA_ROOT_SOURCE}）`);
});
