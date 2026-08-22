import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  COMPUTER_LABELS_DATABASE_PATH,
  PRICE_LABELS_DATABASE_PATH,
  RECEIPT_ASSISTANT_DATABASE_PATH,
  RECEIPT_OCR_KEY_PATH
} from '../apps/server/src/config/data-paths.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..');

const migrations = [
  {
    name: '电脑商品标签',
    source: process.env.LEGACY_COMPUTER_DB || path.resolve(projectRoot, '../backend/db/database.sqlite'),
    target: COMPUTER_LABELS_DATABASE_PATH,
    counts: ['products']
  },
  {
    name: '商品价格标签',
    source: process.env.LEGACY_PRICE_DB || path.join(os.homedir(), 'lenovo-price-label/data/database.db'),
    target: PRICE_LABELS_DATABASE_PATH,
    counts: ['categories', 'products']
  },
  {
    name: '付款凭证',
    source: process.env.LEGACY_RECEIPT_DB || path.join(os.homedir(), 'Lenovo POS System/backend/db/database.sqlite'),
    target: RECEIPT_ASSISTANT_DATABASE_PATH,
    counts: ['sales', 'ocr_config', 'ocr_history']
  }
];

const keyMigration = {
  source: process.env.LEGACY_RECEIPT_OCR_KEY || path.join(os.homedir(), 'Lenovo POS System/backend/.local/ocr-config.key'),
  target: RECEIPT_OCR_KEY_PATH
};

function assertPreconditions() {
  const missingSources = [...migrations.map((item) => item.source), keyMigration.source]
    .filter((source) => !fs.existsSync(source));
  if (missingSources.length) {
    throw new Error(`找不到源文件：\n${missingSources.join('\n')}`);
  }

  const existingTargets = [...migrations.map((item) => item.target), keyMigration.target]
    .filter((target) => fs.existsSync(target));
  if (existingTargets.length) {
    throw new Error(`为防止覆盖，迁移已停止。以下目标文件已存在：\n${existingTargets.join('\n')}`);
  }
}

function inspectDatabase(databasePath, tables) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`数据库完整性检查失败：${integrity}`);
    return Object.fromEntries(tables.map((table) => {
      const row = database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
      return [table, row.count];
    }));
  } finally {
    database.close();
  }
}

async function backupDatabase(migration) {
  fs.mkdirSync(path.dirname(migration.target), { recursive: true });
  const sourceDatabase = new Database(migration.source, { readonly: true, fileMustExist: true });
  try {
    await sourceDatabase.backup(migration.target);
  } finally {
    sourceDatabase.close();
  }

  const sourceCounts = inspectDatabase(migration.source, migration.counts);
  const targetCounts = inspectDatabase(migration.target, migration.counts);
  if (JSON.stringify(sourceCounts) !== JSON.stringify(targetCounts)) {
    throw new Error(`${migration.name}记录数不一致：源 ${JSON.stringify(sourceCounts)}，目标 ${JSON.stringify(targetCounts)}`);
  }
  console.log(`✓ ${migration.name}：${JSON.stringify(targetCounts)}`);
}

function cleanupCreatedTargets() {
  const targets = [...migrations.map((item) => item.target), keyMigration.target];
  for (const target of targets) {
    for (const suffix of ['', '-wal', '-shm']) {
      const candidate = `${target}${suffix}`;
      if (fs.existsSync(candidate)) fs.rmSync(candidate);
    }
  }
}

assertPreconditions();

try {
  for (const migration of migrations) await backupDatabase(migration);

  fs.mkdirSync(path.dirname(keyMigration.target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(keyMigration.target), 0o700);
  fs.copyFileSync(keyMigration.source, keyMigration.target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(keyMigration.target, 0o600);
  if (fs.statSync(keyMigration.target).size !== 32) throw new Error('OCR 密钥长度不是预期的 32 字节');
  console.log('✓ 付款凭证 OCR 密钥：已复制并设置权限 0600');
  console.log('旧系统数据迁移完成，源文件未被修改。');
} catch (error) {
  cleanupCreatedTargets();
  throw error;
}
