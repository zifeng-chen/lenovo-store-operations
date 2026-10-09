import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const UUID_PATTERN = new RegExp(`^${UUID}$`)
const LEGACY_ROLLBACK_PATTERN = new RegExp(`^\\.database-${UUID}\\.rollback\\.sqlite$`)
const PHASES = new Set(['prepared', 'old-moved', 'installed', 'committed'])
const PORTABLE_ONLY_ERRORS = new Set([
  '可移植数据库不能包含临时图片 claims',
  '导入数据不能包含未被任何展牌历史版本引用的孤儿图片',
])

function fsyncFile(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

function unlink(filePath) {
  try { fs.unlinkSync(filePath); return true } catch (error) { if (error.code !== 'ENOENT') throw error }
  return false
}

function removeSidecars(databasePath) {
  let changed = false
  for (const suffix of ['-wal', '-shm']) changed = unlink(`${databasePath}${suffix}`) || changed
  if (changed) fsyncDirectory(path.dirname(databasePath))
}

function pathsFor(directory, databasePath, operationId) {
  return {
    directory,
    databasePath,
    journalPath: path.join(directory, '.price-placards-restore.json'),
    journalTempPath: path.join(directory, '.price-placards-restore.json.tmp'),
    stagedName: `.price-placards-${operationId}.staged.sqlite`,
    rollbackName: `.price-placards-${operationId}.rollback.sqlite`,
  }
}

function validateJournal(value, databasePath) {
  const expectedKeys = ['database', 'hadDatabase', 'operationId', 'phase', 'rollback', 'staged', 'version']
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) throw new Error('数据库恢复 journal 结构损坏')
  const expected = pathsFor(path.dirname(databasePath), databasePath, value.operationId)
  if (value.version !== 1 || !UUID_PATTERN.test(value.operationId) || !PHASES.has(value.phase)
      || value.database !== path.basename(databasePath) || typeof value.hadDatabase !== 'boolean'
      || value.staged !== expected.stagedName || value.rollback !== expected.rollbackName
      || path.basename(value.staged) !== value.staged || path.basename(value.rollback) !== value.rollback) {
    throw new Error('数据库恢复 journal 内容损坏')
  }
  return value
}

function readJournal(journalPath, databasePath) {
  if (!fs.existsSync(journalPath)) return null
  try { return validateJournal(JSON.parse(fs.readFileSync(journalPath, 'utf8')), databasePath) } catch (error) {
    if (/journal/.test(error.message)) throw error
    throw new Error('数据库恢复 journal 无法解析，已拒绝启动')
  }
}

function writeJournal(paths, journal) {
  validateJournal(journal, paths.databasePath)
  unlink(paths.journalTempPath)
  fs.writeFileSync(paths.journalTempPath, `${JSON.stringify(journal)}\n`, { flag: 'wx', mode: 0o600 })
  fsyncFile(paths.journalTempPath)
  fs.renameSync(paths.journalTempPath, paths.journalPath)
  fsyncDirectory(paths.directory)
}

function cleanup(paths, journal) {
  let changed = false
  changed = unlink(path.join(paths.directory, journal.staged)) || changed
  changed = unlink(path.join(paths.directory, journal.rollback)) || changed
  changed = unlink(paths.journalPath) || changed
  changed = unlink(paths.journalTempPath) || changed
  if (changed) fsyncDirectory(paths.directory)
}

function snapshotDatabase(filePath, targetPath) {
  const source = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    source.pragma('query_only = ON')
    source.pragma('trusted_schema = OFF')
    // SQLite serialization includes committed WAL pages; a raw main-file copy does not.
    fs.writeFileSync(targetPath, source.serialize(), { flag: 'wx', mode: 0o600 })
  } finally {
    source.close()
  }
}

function validateLiveDatabase(filePath, validatePortableSync) {
  try {
    return validatePortableSync(filePath)
  } catch (error) {
    if (!PORTABLE_ONLY_ERRORS.has(error.message)) throw error
  }

  const directory = path.dirname(filePath)
  const validationCopy = path.join(directory, `.price-placards-${randomUUID()}.recovery-check.sqlite`)
  try {
    snapshotDatabase(filePath, validationCopy)
    const candidate = new Database(validationCopy, { fileMustExist: true })
    try {
      candidate.pragma('trusted_schema = OFF')
      candidate.pragma('foreign_keys = ON')
      const hasClaims = candidate.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'image_claim_sessions'").get()
      candidate.transaction(() => {
        if (hasClaims) candidate.prepare('DELETE FROM image_claim_sessions').run()
        candidate.prepare('DELETE FROM image_assets WHERE id NOT IN (SELECT asset_id FROM version_assets)').run()
      })()
    } finally {
      candidate.close()
    }
    fsyncFile(validationCopy)
    return validatePortableSync(validationCopy)
  } finally {
    let changed = unlink(validationCopy)
    changed = unlink(`${validationCopy}-wal`) || changed
    changed = unlink(`${validationCopy}-shm`) || changed
    if (changed) fsyncDirectory(directory)
  }
}

function rollback(paths, journal, validateSync) {
  const stagedPath = path.join(paths.directory, journal.staged)
  const rollbackPath = path.join(paths.directory, journal.rollback)
  if (journal.hadDatabase) {
    if (!fs.existsSync(rollbackPath)) {
      // In prepared, the old main file may still be in place. If the rename happened,
      // the rollback file must exist, so all other topologies fail closed.
      if (journal.phase === 'prepared' && fs.existsSync(paths.databasePath)) {
        validateLiveDatabase(paths.databasePath, validateSync)
        unlink(stagedPath)
        unlink(paths.journalPath)
        unlink(paths.journalTempPath)
        fsyncDirectory(paths.directory)
        return
      }
      throw new Error('旧数据库回滚文件不存在，已拒绝启动')
    }
    validateLiveDatabase(rollbackPath, validateSync)
    removeSidecars(paths.databasePath)
    unlink(paths.databasePath)
    fs.renameSync(rollbackPath, paths.databasePath)
  } else {
    removeSidecars(paths.databasePath)
    unlink(paths.databasePath)
  }
  unlink(stagedPath)
  unlink(paths.journalPath)
  unlink(paths.journalTempPath)
  fsyncDirectory(paths.directory)
}

export function recoverDatabaseRestore({ directory, databasePath, validateSync }) {
  fs.mkdirSync(directory, { recursive: true })
  const basePaths = pathsFor(directory, databasePath, '00000000-0000-4000-8000-000000000000')
  const journal = readJournal(basePaths.journalPath, databasePath)
  if (!journal) {
    if (fs.existsSync(basePaths.journalTempPath)) throw new Error('发现未完成的数据库恢复 journal 临时文件，已拒绝启动')
    if (fs.existsSync(databasePath)) return
    const candidates = fs.readdirSync(directory).filter(name => LEGACY_ROLLBACK_PATTERN.test(name))
    if (!candidates.length) return
    if (candidates.length !== 1) throw new Error('发现多个旧版 rollback 候选，已拒绝自动恢复')
    const candidate = path.join(directory, candidates[0])
    validateLiveDatabase(candidate, validateSync)
    fsyncFile(candidate)
    fs.renameSync(candidate, databasePath)
    fsyncDirectory(directory)
    return
  }
  const paths = pathsFor(directory, databasePath, journal.operationId)
  if (journal.phase === 'prepared' || journal.phase === 'old-moved') {
    rollback(paths, journal, validateSync)
    return
  }
  try {
    // installed/committed always point at the portable replacement, not the old live DB.
    validateSync(databasePath)
  } catch (error) {
    if (journal.phase === 'committed') throw new Error(`已提交的新数据库无效，已拒绝启动：${error.message}`)
    rollback(paths, journal, validateSync)
    return
  }
  if (journal.phase === 'installed') writeJournal(paths, { ...journal, phase: 'committed' })
  cleanup(paths, journal)
}

export async function installDatabaseFile({
  sourcePath,
  directory,
  databasePath,
  prepareStaged,
  closeStrict,
  validateInstalled,
  validateSync,
  reopen,
}) {
  fs.mkdirSync(directory, { recursive: true })
  const operationId = randomUUID()
  const paths = pathsFor(directory, databasePath, operationId)
  const stagedPath = path.join(directory, paths.stagedName)
  const rollbackPath = path.join(directory, paths.rollbackName)
  const hadDatabase = fs.existsSync(databasePath)
  let liveConnectionOpen = true
  let journal = {
    version: 1,
    operationId,
    phase: 'prepared',
    database: path.basename(databasePath),
    staged: paths.stagedName,
    rollback: paths.rollbackName,
    hadDatabase,
  }
  try {
    await fs.promises.copyFile(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL)
    await prepareStaged(stagedPath)
    fsyncFile(stagedPath)
    writeJournal(paths, journal)

    // A BUSY/LOCKED checkpoint throws before sidecars or the live database are touched.
    closeStrict()
    liveConnectionOpen = false
    removeSidecars(databasePath)
    if (hadDatabase) {
      fsyncFile(databasePath)
      fs.renameSync(databasePath, rollbackPath)
    }
    fsyncDirectory(directory)
    journal = { ...journal, phase: 'old-moved' }
    writeJournal(paths, journal)

    fs.renameSync(stagedPath, databasePath)
    fsyncDirectory(directory)
    journal = { ...journal, phase: 'installed' }
    writeJournal(paths, journal)

    await validateInstalled(databasePath)
    reopen()
    liveConnectionOpen = true
    journal = { ...journal, phase: 'committed' }
    writeJournal(paths, journal)
    cleanup(paths, journal)
  } catch (error) {
    try {
      const durable = readJournal(paths.journalPath, databasePath)
      if (durable && durable.phase !== 'committed') {
        const rollbackExists = fs.existsSync(path.join(paths.directory, durable.rollback))
        const untouchedPrepared = durable.phase === 'prepared' && !rollbackExists
        if (liveConnectionOpen && !untouchedPrepared) {
          closeStrict()
          liveConnectionOpen = false
        }
        rollback(paths, durable, validateSync)
        if (hadDatabase && fs.existsSync(databasePath) && !liveConnectionOpen) {
          reopen()
          liveConnectionOpen = true
        }
      } else if (!durable) {
        unlink(stagedPath)
        unlink(paths.journalTempPath)
        fsyncDirectory(directory)
      }
    } catch (recoveryError) {
      error.message = `${error.message}；自动回滚失败：${recoveryError.message}`
    }
    throw error
  }
}
