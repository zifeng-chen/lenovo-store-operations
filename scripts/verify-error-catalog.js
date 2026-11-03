#!/usr/bin/env node
// 校验错误目录覆盖率：代码里抛出的每个错误码，都必须在 error-catalog.js 里有中文解释和解决方案。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ERROR_CATALOG, hasErrorDocumentation, describeError } from '../packages/shared/src/error-catalog.js'
import { UPDATER_HINTS, describeUpdaterError } from '../ops/updater/error-hints.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SCAN_TARGETS = [
  'ops/updater/updater.mjs',
  'apps/server/src/system/update-ipc-service.js',
  'apps/server/src/system/update-router.js',
  'apps/server/src/system/github-release-service.js',
  'apps/server/src/system/persistence-service.js',
  'apps/server/src/system/backup-package.js',
  'apps/server/src/system/router.js',
  'apps/server/src/modules/receipt-assistant/router.js',
  'apps/server/src/modules/receipt-assistant/ocr-client.js',
  'apps/server/src/modules/receipt-assistant/ocr-config-store.js'
]

const CODE_PATTERN = /(?<![A-Za-z0-9_'"-])'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'(?![A-Za-z0-9_'"-])/g

const IGNORED = new Set([
  'CHN_ENG',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  'BEGIN', 'COMMIT', 'ROLLBACK',
  'EEXIST', 'ENOENT', 'ESRCH', 'EACCES', 'EPERM', 'ENOSPC', 'EMFILE',
  'SIGKILL', 'SIGTERM', 'SIGINT',
  'UTF_8', 'ISO_8859_1',
  'NODE_USE_ENV_PROXY'
])

const found = new Map()

function collect(absolutePath) {
  if (!fs.existsSync(absolutePath)) return
  const source = fs.readFileSync(absolutePath, 'utf8')
  for (const match of source.matchAll(CODE_PATTERN)) {
    const code = match[1]
    if (IGNORED.has(code)) continue
    if (!found.has(code)) found.set(code, new Set())
    found.get(code).add(path.relative(root, absolutePath))
  }
}

for (const target of SCAN_TARGETS) collect(path.join(root, target))

const missing = [...found.entries()]
  .filter(([code]) => !hasErrorDocumentation(code))
  .sort(([a], [b]) => a.localeCompare(b))

const problems = []

if (missing.length > 0) {
  problems.push(`以下错误码在代码中被抛出，但 error-catalog.js 里没有登记解释：\n${missing.map(([code, files]) => `  - ${code}  ←  ${[...files].join(', ')}`).join('\n')}`)
}

for (const [code, doc] of Object.entries(ERROR_CATALOG)) {
  if (!doc.title || doc.title.trim().length < 2) problems.push(`${code}: title 缺失或过短`)
  if (!doc.explanation || doc.explanation.trim().length < 15) problems.push(`${code}: explanation 过于简略，使用者看不懂`)
  if (!Array.isArray(doc.solutions) || doc.solutions.length === 0) problems.push(`${code}: 缺少 solutions`)
  for (const solution of doc.solutions || []) {
    if (typeof solution !== 'string' || solution.trim().length < 5) problems.push(`${code}: 存在为空或过短的解决方案`)
  }
  if (!['error', 'warning', 'critical'].includes(doc.severity)) problems.push(`${code}: severity 取值非法`)
  if (typeof doc.retryable !== 'boolean') problems.push(`${code}: retryable 必须为布尔值`)
}

const undocumented = describeError({ code: 'SOME_UNKNOWN_FUTURE_CODE', message: 'x' })
if (undocumented.documented !== false) problems.push('describeError 未正确把未知错误码标记为 undocumented')
if (undocumented.solutions.length === 0) problems.push('describeError 对未知错误码也必须给出通用解决方案，不能留空')

const known = describeError({ code: 'INTERRUPTED_BEFORE_SWITCH', message: '更新在候选版本切换前被中断' })
if (known.title === undocumented.title) problems.push('describeError 未命中已登记错误码')
if (!known.rawMessage.includes('被中断')) problems.push('describeError 丢失了原始错误信息')

// 更新器内置提示表必须与共享目录使用同一错误码，且文案不能互相矛盾。
for (const [code, hint] of Object.entries(UPDATER_HINTS)) {
  if (!hasErrorDocumentation(code)) problems.push(`ops/updater/error-hints.mjs 中的 ${code} 未在共享错误目录登记`)
  if (!hint.title || hint.title.trim().length < 2) problems.push(`更新器提示 ${code}: title 缺失`)
  if (!hint.explanation || hint.explanation.trim().length < 15) problems.push(`更新器提示 ${code}: explanation 过于简略`)
  if (!Array.isArray(hint.solutions) || hint.solutions.length === 0) problems.push(`更新器提示 ${code}: 缺少 solutions`)
}

const updaterDocs = describeUpdaterError('NOT_A_REAL_CODE', '原始信息')
if (updaterDocs.solutions.length === 0) problems.push('更新器对未登记错误码也必须给出通用处理步骤')

const mustHaveHint = [
  'INTERRUPTED_BEFORE_SWITCH',
  'ORPHANED_UPDATE_STATE',
  'DOWNLOAD_FAILED',
  'SIGNATURE_VERIFICATION_FAILED',
  'HEALTH_CHECK_FAILED'
]
for (const code of mustHaveHint) {
  if (!UPDATER_HINTS[code]) problems.push(`更新器日志必须能直接解释 ${code}，请补充 error-hints.mjs`)
}

if (problems.length > 0) {
  console.error('[错误目录校验失败]')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

console.log(`[错误目录校验通过] 已登记 ${Object.keys(ERROR_CATALOG).length} 个错误码，代码中检出的 ${found.size} 个错误码全部有中文解释与解决方案`)
