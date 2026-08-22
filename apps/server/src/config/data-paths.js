import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(currentDir, '../../../..');

export function resolveCanonicalPath(targetPath) {
  let cursor = path.resolve(targetPath);
  const missingSegments = [];

  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missingSegments.unshift(path.basename(cursor));
    cursor = parent;
  }

  const canonicalBase = fs.realpathSync(cursor);
  return path.join(canonicalBase, ...missingSegments);
}

export function isSameOrWithin(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

const configuredDataRoot = String(process.env.LENOVO_STORE_DATA_DIR || '').trim();
const allowsProjectDefault = process.env.NODE_ENV === 'development'
  || process.env.NODE_ENV === 'test'
  || process.env.npm_lifecycle_event === 'dev';

if (!configuredDataRoot && !allowsProjectDefault) {
  throw new Error('必须设置绝对路径 LENOVO_STORE_DATA_DIR；仅开发和测试模式允许使用仓库内 data 目录');
}
if (configuredDataRoot && !path.isAbsolute(configuredDataRoot)) {
  throw new Error('LENOVO_STORE_DATA_DIR 必须是绝对路径');
}

const canonicalProjectRoot = resolveCanonicalPath(PROJECT_ROOT);
const canonicalDataRoot = configuredDataRoot
  ? resolveCanonicalPath(configuredDataRoot)
  : path.join(canonicalProjectRoot, 'data');

if (configuredDataRoot && isSameOrWithin(canonicalProjectRoot, canonicalDataRoot)) {
  throw new Error('LENOVO_STORE_DATA_DIR 必须位于项目代码目录之外');
}
if (configuredDataRoot && canonicalDataRoot === path.parse(canonicalDataRoot).root) {
  throw new Error('LENOVO_STORE_DATA_DIR 不能是文件系统根目录');
}

export const DATA_ROOT = canonicalDataRoot;
export const DATA_ROOT_SOURCE = configuredDataRoot ? 'environment' : 'project-default';
export const EXTERNAL_DATA_ROOT_CONFIGURED = Boolean(configuredDataRoot);

export const COMPUTER_LABELS_DATA_DIR = path.join(DATA_ROOT, 'computer-labels');
export const COMPUTER_LABELS_DATABASE_PATH = path.join(COMPUTER_LABELS_DATA_DIR, 'database.sqlite');
export const PRICE_LABELS_DATA_DIR = path.join(DATA_ROOT, 'price-labels');
export const PRICE_LABELS_DATABASE_PATH = path.join(PRICE_LABELS_DATA_DIR, 'database.sqlite');
export const RECEIPT_ASSISTANT_DATA_DIR = path.join(DATA_ROOT, 'receipt-assistant');
export const RECEIPT_ASSISTANT_DATABASE_PATH = path.join(RECEIPT_ASSISTANT_DATA_DIR, 'database.sqlite');
export const RECEIPT_OCR_KEY_PATH = path.join(DATA_ROOT, 'secrets', 'receipt-ocr.key');
