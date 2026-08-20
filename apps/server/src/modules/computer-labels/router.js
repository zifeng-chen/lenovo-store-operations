import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import {
  createDatabaseBackup,
  getDatabase,
  restoreDatabase
} from './database.js';

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const valid = extension === '.xlsx' || extension === '.xls';
    callback(valid ? null : new Error('仅支持 .xlsx 或 .xls 文件'), valid);
  }
});

const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, callback) => callback(null, `computer-labels-${randomUUID()}.db`)
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const valid = path.extname(file.originalname).toLowerCase() === '.db';
    callback(valid ? null : new Error('仅支持 .db 数据库文件'), valid);
  }
});

const clean = (value) => {
  const result = value == null ? '' : String(value).trim();
  return result || null;
};

const requiredText = (value) => String(value ?? '').trim();

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sendSuccess(res, data, msg = 'success') {
  res.json({ code: 0, data, msg });
}

function sendValidationError(res, msg) {
  return res.status(400).json({ code: 1, data: null, msg });
}

export function createComputerLabelsRouter() {
  const router = Router();

  router.get('/products/export', (_req, res) => {
    const rows = getDatabase().prepare(
      'SELECT sku, name, config, color, remark FROM products ORDER BY id DESC'
    ).all();
    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: ['sku', 'name', 'config', 'color', 'remark']
    });
    worksheet['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 42 }, { wch: 18 }, { wch: 28 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '商品数据');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="products_${timestamp()}.xlsx"`);
    res.send(buffer);
  });

  router.post('/products/import', excelUpload.single('file'), (req, res) => {
    if (!req.file) return sendValidationError(res, '请选择 Excel 文件');

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch {
      return sendValidationError(res, 'Excel 文件无法读取');
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) return sendValidationError(res, 'Excel 文件中没有可读取的工作表');

    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
    const db = getDatabase();
    const findBySku = db.prepare('SELECT id FROM products WHERE sku = ?');
    const insert = db.prepare(
      'INSERT INTO products (sku, name, config, color, remark) VALUES (?, ?, ?, ?, ?)'
    );
    const update = db.prepare(`
      UPDATE products
      SET name = ?, config = ?, color = ?, remark = ?, updated_at = datetime('now')
      WHERE sku = ?
    `);
    const errors = [];
    let success = 0;

    const importRows = db.transaction((items) => {
      items.forEach((source, index) => {
        const normalized = Object.fromEntries(
          Object.entries(source).map(([key, value]) => [String(key).trim().toLowerCase(), value])
        );
        const sku = requiredText(normalized.sku);
        const name = requiredText(normalized.name);
        if (!sku || !name) {
          errors.push({ row: index + 2, reason: !sku ? 'SKU不能为空' : '商品名称不能为空' });
          return;
        }
        try {
          const values = [clean(normalized.config), clean(normalized.color), clean(normalized.remark)];
          if (findBySku.get(sku)) update.run(name, ...values, sku);
          else insert.run(sku, name, ...values);
          success += 1;
        } catch (error) {
          errors.push({ row: index + 2, reason: error.message });
        }
      });
    });
    importRows(rows);

    sendSuccess(res, { total: rows.length, success, failed: errors.length, errors }, '导入完成');
  });

  router.post('/products/batch-delete', (req, res) => {
    const ids = Array.isArray(req.body.ids)
      ? [...new Set(req.body.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
      : [];
    if (!ids.length) return sendValidationError(res, '请选择要删除的商品');

    const placeholders = ids.map(() => '?').join(',');
    const info = getDatabase().prepare(`DELETE FROM products WHERE id IN (${placeholders})`).run(...ids);
    sendSuccess(res, { count: info.changes }, '批量删除成功');
  });

  router.get('/products', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    let sql = 'SELECT * FROM products';
    let params = [];
    if (q) {
      sql += " WHERE sku LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR config LIKE ? ESCAPE '\\'";
      const escaped = q.replace(/[\\%_]/g, '\\$&');
      const like = `%${escaped}%`;
      params = [like, like, like];
    }
    sql += ' ORDER BY id DESC';
    sendSuccess(res, getDatabase().prepare(sql).all(...params));
  });

  router.post('/products', (req, res) => {
    const name = requiredText(req.body.name);
    const sku = requiredText(req.body.sku);
    if (!name || !sku) return sendValidationError(res, 'name和sku为必填字段');

    const db = getDatabase();
    const info = db.prepare(
      'INSERT INTO products (name, sku, config, color, remark) VALUES (?, ?, ?, ?, ?)'
    ).run(name, sku, clean(req.body.config), clean(req.body.color), clean(req.body.remark));
    sendSuccess(res, db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid), '新增成功');
  });

  router.put('/products/:id', (req, res) => {
    const id = Number(req.params.id);
    const name = requiredText(req.body.name);
    const sku = requiredText(req.body.sku);
    if (!Number.isInteger(id) || id <= 0) return sendValidationError(res, '商品ID无效');
    if (!name || !sku) return sendValidationError(res, 'name和sku为必填字段');

    const db = getDatabase();
    const info = db.prepare(`
      UPDATE products
      SET name = ?, sku = ?, config = ?, color = ?, remark = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, sku, clean(req.body.config), clean(req.body.color), clean(req.body.remark), id);
    if (!info.changes) return res.status(404).json({ code: 1, data: null, msg: '商品不存在' });
    sendSuccess(res, db.prepare('SELECT * FROM products WHERE id = ?').get(id), '更新成功');
  });

  router.delete('/products/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendValidationError(res, '商品ID无效');

    const info = getDatabase().prepare('DELETE FROM products WHERE id = ?').run(id);
    if (!info.changes) return res.status(404).json({ code: 1, data: null, msg: '商品不存在' });
    sendSuccess(res, null, '删除成功');
  });

  router.get('/backup', async (_req, res, next) => {
    const filename = `computer_labels_${timestamp()}.db`;
    const tempPath = path.join(os.tmpdir(), `${randomUUID()}-${filename}`);
    try {
      await createDatabaseBackup(tempPath);
      res.download(tempPath, filename, (error) => {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      next(error);
    }
  });

  router.post('/restore', restoreUpload.single('file'), (req, res) => {
    if (!req.file) return sendValidationError(res, '请选择 .db 备份文件');
    try {
      restoreDatabase(req.file.path);
      sendSuccess(res, null, '恢复成功，请刷新页面');
    } finally {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
  });

  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return sendValidationError(res, 'SKU已存在，请使用不同的SKU');
    }
    if (error?.name === 'MulterError' || /仅支持|文件过大/.test(error?.message ?? '')) {
      return sendValidationError(res, error.message || '上传文件无效');
    }
    return next(error);
  });

  return router;
}

export default createComputerLabelsRouter();
