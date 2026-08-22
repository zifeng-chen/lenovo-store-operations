import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  COMPUTER_LABELS_DATABASE_PATH,
  DATA_ROOT,
  isSameOrWithin,
  PRICE_LABELS_DATABASE_PATH,
  PROJECT_ROOT,
  RECEIPT_ASSISTANT_DATABASE_PATH,
  RECEIPT_OCR_KEY_PATH,
  resolveCanonicalPath
} from '../apps/server/src/config/data-paths.js';

const ENCRYPTION_CONTEXT = Buffer.from('lenovo-pos-ocr-config:v1');
const configuredBackupRoot = String(process.env.LENOVO_STORE_BACKUP_DIR || '').trim();
if (!configuredBackupRoot || !path.isAbsolute(configuredBackupRoot)) {
  throw new Error('LENOVO_STORE_BACKUP_DIR 必须设置为代码和数据目录之外的绝对路径');
}
if (fs.existsSync(configuredBackupRoot) && fs.lstatSync(configuredBackupRoot).isSymbolicLink()) {
  throw new Error('LENOVO_STORE_BACKUP_DIR 不能是符号链接');
}

const backupRoot = resolveCanonicalPath(configuredBackupRoot);
const canonicalDataRoot = resolveCanonicalPath(DATA_ROOT);
const canonicalProjectRoot = resolveCanonicalPath(PROJECT_ROOT);
const overlapsProtectedPath = (protectedPath) => isSameOrWithin(protectedPath, backupRoot)
  || isSameOrWithin(backupRoot, protectedPath);
if (overlapsProtectedPath(canonicalDataRoot) || overlapsProtectedPath(canonicalProjectRoot)) {
  throw new Error('LENOVO_STORE_BACKUP_DIR 必须与代码目录和数据目录完全分离');
}

const timestamp = new Date().toISOString().replaceAll(':', '-');
const finalDirectory = path.join(backupRoot, timestamp);
const stagingDirectory = path.join(backupRoot, `.${timestamp}.${process.pid}.staging`);
const databases = [
  { id: 'computer-labels', source: COMPUTER_LABELS_DATABASE_PATH },
  { id: 'price-labels', source: PRICE_LABELS_DATABASE_PATH },
  { id: 'receipt-assistant', source: RECEIPT_ASSISTANT_DATABASE_PATH }
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function inspectDatabase(filePath) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`数据库完整性检查失败：${integrity}`);
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();
    const counts = Object.fromEntries(tables.map(({ name }) => {
      const escapedName = name.replaceAll('"', '""');
      return [name, database.prepare(`SELECT COUNT(*) AS count FROM "${escapedName}"`).get().count];
    }));
    return { integrity, counts };
  } finally {
    database.close();
  }
}

async function backupDatabase(item) {
  if (!fs.existsSync(item.source)) throw new Error(`数据库不存在：${item.source}`);
  const targetDirectory = path.join(stagingDirectory, item.id);
  const target = path.join(targetDirectory, 'database.sqlite');
  fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });

  const sourceDatabase = new Database(item.source, { readonly: true, fileMustExist: true });
  try {
    await sourceDatabase.backup(target);
  } finally {
    sourceDatabase.close();
  }

  const inspection = inspectDatabase(target);
  return {
    id: item.id,
    source: item.source,
    file: path.relative(stagingDirectory, target),
    bytes: fs.statSync(target).size,
    sha256: sha256(target),
    ...inspection
  };
}

function decodeEnvironmentKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const key = /^[a-f\d]{64}$/i.test(normalized)
    ? Buffer.from(normalized, 'hex')
    : Buffer.from(normalized, 'base64');
  if (key.length !== 32) throw new Error('OCR_CONFIG_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制字符串');
  return key;
}

function readLocalOcrKey() {
  if (!fs.existsSync(RECEIPT_OCR_KEY_PATH)) return null;
  const stats = fs.lstatSync(RECEIPT_OCR_KEY_PATH);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('OCR 本机密钥必须是普通文件且不能是符号链接');
  const key = fs.readFileSync(RECEIPT_OCR_KEY_PATH);
  if (key.length !== 32) throw new Error('OCR 密钥长度不是预期的 32 字节');
  return key;
}

function getOcrConfigRow(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const table = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ocr_config'"
    ).get();
    return table ? database.prepare('SELECT * FROM ocr_config WHERE id = 1').get() || null : null;
  } finally {
    database.close();
  }
}

function assertOcrKeyDecrypts(row, key) {
  if (!row) return;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
    decipher.setAAD(ENCRYPTION_CONTEXT);
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
    const credentials = JSON.parse(plaintext);
    if (!credentials.apiKey || !credentials.secretKey) throw new Error('凭据字段不完整');
  } catch {
    throw new Error('当前 OCR 加密密钥无法解密备份中的凭据，备份已停止');
  }
}

function backupOcrKey() {
  const receiptBackup = path.join(stagingDirectory, 'receipt-assistant', 'database.sqlite');
  const configRow = getOcrConfigRow(receiptBackup);
  const environmentKey = decodeEnvironmentKey(process.env.OCR_CONFIG_ENCRYPTION_KEY);
  const localKey = environmentKey ? null : readLocalOcrKey();
  const key = environmentKey || localKey;
  const source = environmentKey ? 'environment' : localKey ? 'local-file' : 'none';

  if (configRow && !key) throw new Error('备份数据库包含 OCR 凭据，但找不到对应的加密密钥');
  if (!key) return null;
  assertOcrKeyDecrypts(configRow, key);

  const targetDirectory = path.join(stagingDirectory, 'secrets');
  const target = path.join(targetDirectory, 'receipt-ocr.key');
  fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, key, { flag: 'wx', mode: 0o600 });
  return {
    source,
    file: path.relative(stagingDirectory, target),
    bytes: 32,
    sha256: sha256(target)
  };
}

fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
const backupRootStats = fs.lstatSync(backupRoot);
if (!backupRootStats.isDirectory() || backupRootStats.isSymbolicLink()) {
  throw new Error('LENOVO_STORE_BACKUP_DIR 必须是普通目录且不能是符号链接');
}
if (resolveCanonicalPath(backupRoot) !== backupRoot) {
  throw new Error('LENOVO_STORE_BACKUP_DIR 真实路径与配置不一致');
}
if (fs.existsSync(finalDirectory) || fs.existsSync(stagingDirectory)) {
  throw new Error(`备份目标已存在：${finalDirectory}`);
}
fs.mkdirSync(stagingDirectory, { mode: 0o700 });

try {
  const databaseBackups = [];
  for (const item of databases) databaseBackups.push(await backupDatabase(item));
  const ocrKey = backupOcrKey();

  const manifest = {
    createdAt: new Date().toISOString(),
    dataRoot: DATA_ROOT,
    databases: databaseBackups,
    ocrKey
  };
  fs.writeFileSync(
    path.join(stagingDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 }
  );
  fs.renameSync(stagingDirectory, finalDirectory);
  console.log(`数据备份完成：${finalDirectory}`);
} catch (error) {
  if (fs.existsSync(stagingDirectory)) fs.rmSync(stagingDirectory, { recursive: true, force: true });
  throw error;
}
