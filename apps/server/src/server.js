import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { STORE_MODULES } from '@lenovo-store/shared';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '../../..');
const dataRoot = path.join(projectRoot, 'data');
const webDist = path.join(projectRoot, 'apps/web/dist');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT) || 8890;
const app = express();

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

function success(res, data, msg = 'success') {
  res.json({ code: 0, data, msg });
}

function moduleStatus(module) {
  const dataDirectory = path.join(dataRoot, module.id);
  return {
    ...module,
    apiReady: true,
    dataDirectoryReady: fs.existsSync(dataDirectory),
    databaseConnected: false
  };
}

app.get('/api/system/health', (_req, res) => {
  success(res, {
    status: 'ok',
    service: 'lenovo-store-operations',
    version: '0.1.0',
    uptimeSeconds: Math.floor(process.uptime()),
    modules: STORE_MODULES.map(moduleStatus)
  });
});

for (const module of STORE_MODULES) {
  app.get(`${module.apiBase}/health`, (_req, res) => {
    success(res, moduleStatus(module));
  });
}

if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use('/api', (_req, res) => {
  res.status(404).json({ code: 1, data: null, msg: '接口不存在' });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ code: 1, data: null, msg: error.message || '服务器内部错误' });
});

app.listen(port, host, () => {
  console.log(`Lenovo Store Operations running at http://${host}:${port}`);
});
