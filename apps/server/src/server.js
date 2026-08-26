import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { STORE_MODULES } from '@lenovo-store/shared';
import computerLabelsRouter, {
  apiBase as computerLabelsApiBase,
  DATABASE_PATH as computerLabelsDatabasePath,
  getDatabase as getComputerLabelsDatabase,
  initializeDatabase as initializeComputerLabelsDatabase
} from './modules/computer-labels/index.js';
import priceLabelsRouter, {
  apiBase as priceLabelsApiBase,
  DATABASE_PATH as priceLabelsDatabasePath,
  getDatabase as getPriceLabelsDatabase,
  initializeDatabase as initializePriceLabelsDatabase
} from './modules/price-labels/index.js';
import receiptAssistantRouter, {
  apiBase as receiptAssistantApiBase,
  DATABASE_PATH as receiptAssistantDatabasePath,
  OCR_KEY_PATH as receiptOcrKeyPath,
  getDatabase as getReceiptAssistantDatabase,
  initializeDatabase as initializeReceiptAssistantDatabase,
  receiptAssistantMaintenance
} from './modules/receipt-assistant/index.js';
import {
  DATA_ROOT,
  DATA_ROOT_SOURCE,
  EXTERNAL_DATA_ROOT_CONFIGURED
} from './config/data-paths.js';
import { createPersistenceService } from './system/persistence-service.js';
import { createSystemPersistenceRouter } from './system/router.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '../../..');
const dataRoot = DATA_ROOT;
const webDist = path.join(projectRoot, 'apps/web/dist');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT) || 8900;
const maintenanceToken = String(process.env.LENOVO_STORE_MAINTENANCE_TOKEN || '').trim();
if (process.env.NODE_ENV === 'production' && maintenanceToken.length < 24) {
  throw new Error('生产环境必须设置至少 24 个字符的 LENOVO_STORE_MAINTENANCE_TOKEN');
}
const app = express();

const moduleRuntimes = new Map([
  ['computer-labels', {
    apiBase: computerLabelsApiBase,
    router: computerLabelsRouter,
    databasePath: computerLabelsDatabasePath,
    initializeDatabase: initializeComputerLabelsDatabase,
    jsonParser: express.json({ limit: '1mb' })
  }],
  ['price-labels', {
    apiBase: priceLabelsApiBase,
    router: priceLabelsRouter,
    databasePath: priceLabelsDatabasePath,
    initializeDatabase: initializePriceLabelsDatabase
  }],
  ['receipt-assistant', {
    apiBase: receiptAssistantApiBase,
    router: receiptAssistantRouter,
    databasePath: receiptAssistantDatabasePath,
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
app.use(cors());

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
      if (!runtime?.initializeDatabase || !runtime?.databasePath) {
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
    dataDirectoryReady: usesDatabase ? fs.existsSync(dataDirectory) : null,
    databaseConnected: usesDatabase
      ? Boolean(databaseStatus?.connected && runtime?.databasePath && fs.existsSync(runtime.databasePath))
      : null,
    databaseError: usesDatabase ? databaseStatus?.error || null : null
  };
}

initializeDatabases();

app.get('/api/system/health', (_req, res) => {
  success(res, {
    status: 'ok',
    service: 'lenovo-store-operations',
    version: '1.0.0',
    uptimeSeconds: Math.floor(process.uptime()),
    persistentDataConfigured: EXTERNAL_DATA_ROOT_CONFIGURED,
    maintenanceAuthenticationRequired: Boolean(maintenanceToken),
    modules: STORE_MODULES.map(moduleStatus)
  });
});

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

app.use('/api', (_req, res) => {
  res.status(404).json({ code: 1, data: null, msg: '接口不存在' });
});

for (const module of STORE_MODULES) {
  const moduleDist = path.join(projectRoot, 'apps', module.id, 'dist');
  const moduleIndex = path.join(moduleDist, 'index.html');
  const moduleBase = module.moduleBase;
  const moduleBaseWithoutSlash = moduleBase.replace(/\/$/, '');

  app.get(moduleBaseWithoutSlash, (_req, res) => res.redirect(308, moduleBase));
  if (!fs.existsSync(moduleIndex)) continue;

  app.use(moduleBase, express.static(moduleDist));
  app.use(moduleBase, (req, res, next) => {
    if (req.method !== 'GET' || path.extname(req.path) || !req.accepts('html')) return next();
    return res.sendFile(moduleIndex);
  });
}

const webIndex = path.join(webDist, 'index.html');
if (fs.existsSync(webIndex)) {
  app.use(express.static(webDist));
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
  const status = Number.isInteger(error.status) ? error.status : 500;
  res.status(status).json({ code: 1, data: null, msg: error.message || '服务器内部错误' });
});

app.listen(port, host, () => {
  console.log(`联想门店运营系统运行于 http://${host}:${port}`);
  console.log(`持久化数据目录：${dataRoot}（${DATA_ROOT_SOURCE}）`);
});
