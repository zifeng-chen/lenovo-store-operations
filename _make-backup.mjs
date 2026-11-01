import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import { writeBackupPackage } from '/tmp/lso/apps/server/src/system/backup-package.js'

const SNAP = '/tmp/lsbackup-work'
const OUT_DIR = '/tmp/lsbackup-out'
fs.mkdirSync(OUT_DIR, { recursive: true })

const modules = ['computer-labels', 'price-labels', 'receipt-assistant', 'price-placards']

function countsFor(dbPath) {
  const db = new Database(dbPath, { readonly: true })
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(r => r.name)
    const counts = {}
    for (const t of tables) counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c
    return counts
  } finally {
    db.close()
  }
}

const payloads = modules.map(moduleId => {
  const p = path.join(SNAP, `${moduleId}.sqlite`)
  return {
    id: `${moduleId}.database`,
    moduleId,
    kind: 'database',
    path: p,
    counts: countsFor(p),
  }
})

const keyPath = '/var/lib/lenovo-store-operations/secrets/receipt-ocr.key'
const ocrKeyExists = fs.existsSync(keyPath)
if (ocrKeyExists) {
  payloads.push({
    id: 'receipt-assistant.ocr-key',
    moduleId: 'receipt-assistant',
    kind: 'secret',
    path: keyPath,
    counts: {},
  })
}

const backupId = crypto.randomUUID()
const createdAt = new Date().toISOString()
const outputPath = path.join(OUT_DIR, `lenovo-store-backup-${createdAt.slice(0, 10)}.lsbackup`)

const manifest = writeBackupPackage({
  outputPath,
  backupId,
  createdAt,
  payloads,
  ocrEncryption: ocrKeyExists ? { mode: 'local', fingerprint: null } : { mode: 'none' },
})

console.log(JSON.stringify({
  outputPath,
  size: fs.statSync(outputPath).size,
  formatVersion: manifest.formatVersion,
  backupId: manifest.backupId,
  entries: manifest.entries.map(e => ({ id: e.id, length: e.length, counts: e.counts })),
}, null, 2))
