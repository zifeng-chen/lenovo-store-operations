import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const REPOSITORY = 'zifeng-chen/lenovo-store-operations'
const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])
const REQUEST_KEYS = ['action', 'jobId', 'requestedAt', 'schemaVersion', 'tag']
const REQUIRED_ASSETS = ['manifest.json', 'manifest.json.sig', 'SHA256SUMS']
const DEFAULT_CONFIG_PATH = '/etc/lenovo-store-updater.json'
const MAX_REQUEST_BYTES = 4096
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_SIGNATURE_BYTES = 8192
const MAX_CHECKSUM_BYTES = 64 * 1024
const MAX_ARCHIVE_ENTRIES = 30000
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024

function updaterError(message, code = 'UPDATER_FAILED') {
  const error = new Error(message)
  error.code = code
  return error
}

function assert(condition, message, code) {
  if (!condition) throw updaterError(message, code)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseStrictVersion(tag) {
  const match = TAG_PATTERN.exec(tag)
  return match ? match.slice(1).map(Number) : null
}

function compareVersions(leftTag, rightTag) {
  const left = parseStrictVersion(leftTag)
  const right = parseStrictVersion(rightTag)
  assert(left && right, '版本号格式无效', 'INVALID_VERSION')
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

function assertAbsoluteSafePath(value, name) {
  assert(typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value, `${name} 必须是规范的绝对路径`, 'INVALID_CONFIG')
  assert(value !== '/', `${name} 不能是文件系统根目录`, 'INVALID_CONFIG')
  return value
}

function readRegularFile(filePath, maxBytes, name) {
  const stats = fs.lstatSync(filePath)
  assert(stats.isFile() && !stats.isSymbolicLink(), `${name} 必须是普通文件`, 'UNSAFE_FILE')
  assert(stats.size > 0 && stats.size <= maxBytes, `${name} 大小无效`, 'FILE_SIZE_INVALID')
  return fs.readFileSync(filePath)
}

function parseJson(buffer, name) {
  try {
    const value = JSON.parse(buffer.toString('utf8'))
    assert(isPlainObject(value), `${name} 格式无效`, 'INVALID_JSON')
    return value
  } catch (error) {
    if (error.code) throw error
    throw updaterError(`${name} 不是有效 JSON`, 'INVALID_JSON')
  }
}

function validateConfig(raw) {
  assert(isPlainObject(raw), '更新器配置格式无效', 'INVALID_CONFIG')
  assert(raw.repository === REPOSITORY, `更新源必须固定为 ${REPOSITORY}`, 'INVALID_CONFIG')
  const config = {
    repository: raw.repository,
    releaseRoot: assertAbsoluteSafePath(raw.releaseRoot, 'releaseRoot'),
    requestPath: assertAbsoluteSafePath(raw.requestPath, 'requestPath'),
    processingPath: assertAbsoluteSafePath(raw.processingPath, 'processingPath'),
    statePath: assertAbsoluteSafePath(raw.statePath, 'statePath'),
    transactionPath: assertAbsoluteSafePath(raw.transactionPath, 'transactionPath'),
    publicKeyPath: assertAbsoluteSafePath(raw.publicKeyPath, 'publicKeyPath'),
    updaterPath: assertAbsoluteSafePath(raw.updaterPath, 'updaterPath'),
    serviceName: String(raw.serviceName || ''),
    updaterServiceName: String(raw.updaterServiceName || ''),
    backupServiceName: String(raw.backupServiceName || ''),
    npmPath: assertAbsoluteSafePath(raw.npmPath, 'npmPath'),
    tarPath: assertAbsoluteSafePath(raw.tarPath, 'tarPath'),
    serviceUid: Number(raw.serviceUid),
    serviceGid: Number(raw.serviceGid),
    builderUid: Number(raw.builderUid),
    builderGid: Number(raw.builderGid),
    serviceHome: assertAbsoluteSafePath(raw.serviceHome, 'serviceHome'),
    healthUrl: String(raw.healthUrl || ''),
    downloadTimeoutMs: Number(raw.downloadTimeoutMs || 30000),
    installTimeoutMs: Number(raw.installTimeoutMs || 600000),
    healthTimeoutMs: Number(raw.healthTimeoutMs || 90000),
    maxArtifactBytes: Number(raw.maxArtifactBytes || 300 * 1024 * 1024),
  }
  assert(/^[a-zA-Z0-9_.@-]+\.service$/.test(config.serviceName), 'serviceName 无效', 'INVALID_CONFIG')
  assert(/^[a-zA-Z0-9_.@-]+\.service$/.test(config.updaterServiceName), 'updaterServiceName 无效', 'INVALID_CONFIG')
  assert(/^[a-zA-Z0-9_.@-]+\.service$/.test(config.backupServiceName), 'backupServiceName 无效', 'INVALID_CONFIG')
  assert(Number.isSafeInteger(config.serviceUid) && config.serviceUid > 0, 'serviceUid 无效', 'INVALID_CONFIG')
  assert(Number.isSafeInteger(config.serviceGid) && config.serviceGid > 0, 'serviceGid 无效', 'INVALID_CONFIG')
  assert(Number.isSafeInteger(config.builderUid) && config.builderUid > 0 && config.builderUid !== config.serviceUid, 'builderUid 必须是独立的非 root 账号', 'INVALID_CONFIG')
  assert(Number.isSafeInteger(config.builderGid) && config.builderGid > 0 && config.builderGid !== config.serviceGid, 'builderGid 必须是独立的非 root 组', 'INVALID_CONFIG')
  assert(config.downloadTimeoutMs >= 5000 && config.downloadTimeoutMs <= 120000, 'downloadTimeoutMs 超出允许范围', 'INVALID_CONFIG')
  assert(config.installTimeoutMs >= 60000 && config.installTimeoutMs <= 1800000, 'installTimeoutMs 超出允许范围', 'INVALID_CONFIG')
  assert(config.healthTimeoutMs >= 15000 && config.healthTimeoutMs <= 300000, 'healthTimeoutMs 超出允许范围', 'INVALID_CONFIG')
  assert(config.maxArtifactBytes >= 1024 * 1024 && config.maxArtifactBytes <= 1024 * 1024 * 1024, 'maxArtifactBytes 超出允许范围', 'INVALID_CONFIG')
  const healthUrl = new URL(config.healthUrl)
  assert(healthUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(healthUrl.hostname), 'healthUrl 只能使用本机 HTTP 地址', 'INVALID_CONFIG')
  assert(healthUrl.pathname === '/api/system/health' && !healthUrl.search && !healthUrl.hash, 'healthUrl 路径必须是 /api/system/health', 'INVALID_CONFIG')
  assert(path.dirname(config.statePath) === path.dirname(config.transactionPath), '状态与事务文件必须位于同一 root-owned 目录', 'INVALID_CONFIG')
  const requestDirectory = path.dirname(config.requestPath)
  const processingDirectory = path.dirname(config.processingPath)
  const requestDirectoryStats = fs.lstatSync(requestDirectory)
  const processingDirectoryStats = fs.lstatSync(processingDirectory)
  assert(requestDirectoryStats.isDirectory() && !requestDirectoryStats.isSymbolicLink(), '请求目录无效', 'INVALID_CONFIG')
  assert(processingDirectoryStats.isDirectory() && !processingDirectoryStats.isSymbolicLink(), 'claimed 目录无效', 'INVALID_CONFIG')
  assert(fs.realpathSync(processingDirectory) === processingDirectory && processingDirectoryStats.uid === 0 && (processingDirectoryStats.mode & 0o077) === 0, 'claimed 目录必须由 root 独占', 'INVALID_CONFIG')
  assert(requestDirectoryStats.dev === processingDirectoryStats.dev, '请求和 claimed 目录必须位于同一文件系统', 'INVALID_CONFIG')
  return Object.freeze(config)
}

function loadConfig() {
  const configPath = process.env.LENOVO_STORE_UPDATER_CONFIG || DEFAULT_CONFIG_PATH
  const stats = fs.lstatSync(configPath)
  assert(stats.uid === 0 && (stats.mode & 0o077) === 0, '更新器配置必须由 root 独占', 'INVALID_CONFIG_PERMISSIONS')
  const raw = parseJson(readRegularFile(configPath, 64 * 1024, '更新器配置'), '更新器配置')
  return validateConfig(raw)
}

function fsyncDirectory(directory) {
  const handle = fs.openSync(directory, 'r')
  try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
}

function removeFileDurably(filePath) {
  if (!fs.existsSync(filePath)) return
  fs.unlinkSync(filePath)
  fsyncDirectory(path.dirname(filePath))
}

function writeJsonAtomic(filePath, value, { mode = 0o640, gid = null } = {}) {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  const handle = fs.openSync(temporaryPath, 'wx', mode)
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  if (gid !== null && typeof process.getuid === 'function' && process.getuid() === 0) fs.chownSync(temporaryPath, 0, gid)
  fs.renameSync(temporaryPath, filePath)
  fsyncDirectory(directory)
}

function validateRequest(request, { allowExpired = false } = {}) {
  assert(isPlainObject(request), '更新请求格式无效', 'INVALID_REQUEST')
  assert(Object.keys(request).sort().join(',') === REQUEST_KEYS.join(','), '更新请求包含未授权字段', 'INVALID_REQUEST')
  assert(request.schemaVersion === 1 && request.action === 'install', '更新请求动作无效', 'INVALID_REQUEST')
  assert(UUID_PATTERN.test(request.jobId), '更新任务编号无效', 'INVALID_REQUEST')
  assert(TAG_PATTERN.test(request.tag), '更新 tag 必须符合 vX.Y.Z', 'INVALID_REQUEST')
  assert(typeof request.requestedAt === 'string' && !Number.isNaN(Date.parse(request.requestedAt)), '更新请求时间无效', 'INVALID_REQUEST')
  if (!allowExpired) assert(Math.abs(Date.now() - Date.parse(request.requestedAt)) <= 30 * 60 * 1000, '更新请求已过期', 'REQUEST_EXPIRED')
  return request
}

function claimRequest(config) {
  if (!fs.existsSync(config.requestPath)) return null
  assert(!fs.existsSync(config.processingPath), '存在未清理的处理中任务', 'PROCESSING_REQUEST_EXISTS')
  fs.renameSync(config.requestPath, config.processingPath)
  let handle
  try {
    handle = fs.openSync(config.processingPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const stats = fs.fstatSync(handle)
    assert(stats.isFile() && stats.size > 0 && stats.size <= MAX_REQUEST_BYTES, '更新请求必须是受限普通文件', 'INVALID_REQUEST_FILE')
    assert(stats.uid === config.serviceUid && (stats.mode & 0o077) === 0, '更新请求所有者或权限无效', 'INVALID_REQUEST_PERMISSIONS')
    assert(stats.nlink === 1, '更新请求不能存在额外硬链接', 'INVALID_REQUEST_LINKS')
    const request = validateRequest(parseJson(fs.readFileSync(handle), '更新请求'))
    fs.fchownSync(handle, 0, 0)
    fs.fchmodSync(handle, 0o600)
    fs.fsyncSync(handle)
    return request
  } catch (error) {
    if (fs.existsSync(config.processingPath)) fs.unlinkSync(config.processingPath)
    throw error
  } finally {
    if (handle !== undefined) fs.closeSync(handle)
  }
}

function createStatusWriter(config, request) {
  let state = {
    schemaVersion: 1,
    jobId: request.jobId,
    action: request.action,
    targetTag: request.tag,
    status: 'running',
    phase: 'claimed',
    requestedAt: request.requestedAt,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    current: null,
    target: null,
    rolledBack: false,
    error: null,
  }
  const persist = () => writeJsonAtomic(config.statePath, state, { gid: config.serviceGid })
  persist()
  return {
    update(phase, extra = {}) {
      state = { ...state, ...extra, phase, updatedAt: new Date().toISOString() }
      persist()
    },
    finish(status, extra = {}) {
      state = { ...state, ...extra, status, updatedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }
      persist()
    },
  }
}

async function runFixed(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
    env: options.env || { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' },
    uid: options.uid,
    gid: options.gid,
  })
}

function safeAssetUrl(value) {
  const url = new URL(value)
  assert(url.protocol === 'https:' && ALLOWED_DOWNLOAD_HOSTS.has(url.hostname), 'Release 资产地址不在允许域名中', 'UNSAFE_DOWNLOAD_URL')
  return url
}

async function fetchWithRedirects(url, options, timeoutMs) {
  let current = safeAssetUrl(url)
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'lenovo-store-operations-updater',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {}),
      },
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    assert(location, 'Release 下载重定向缺少地址', 'INVALID_REDIRECT')
    current = safeAssetUrl(new URL(location, current).href)
  }
  throw updaterError('Release 下载重定向次数过多', 'TOO_MANY_REDIRECTS')
}

async function readLimitedResponse(response, maxBytes, name) {
  assert(response.ok, `${name} 下载失败（HTTP ${response.status}）`, 'DOWNLOAD_FAILED')
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength)) assert(declaredLength <= maxBytes, `${name} 超过大小限制`, 'DOWNLOAD_TOO_LARGE')
  const reader = response.body?.getReader()
  assert(reader, `${name} 响应为空`, 'EMPTY_DOWNLOAD')
  const chunks = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      throw updaterError(`${name} 超过大小限制`, 'DOWNLOAD_TOO_LARGE')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

async function downloadSmall(url, maxBytes, name, config) {
  const response = await fetchWithRedirects(url, { method: 'GET' }, config.downloadTimeoutMs)
  return readLimitedResponse(response, maxBytes, name)
}

async function downloadArtifact(url, destination, expectedBytes, expectedSha256, config) {
  const response = await fetchWithRedirects(url, { method: 'GET', headers: { Accept: 'application/octet-stream' } }, config.downloadTimeoutMs)
  assert(response.ok, `发布包下载失败（HTTP ${response.status}）`, 'DOWNLOAD_FAILED')
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength)) assert(declaredLength === expectedBytes, '发布包 Content-Length 与签名清单不一致', 'ARTIFACT_SIZE_MISMATCH')
  const reader = response.body?.getReader()
  assert(reader, '发布包响应为空', 'EMPTY_DOWNLOAD')
  const handle = fs.openSync(destination, 'wx', 0o600)
  const digest = crypto.createHash('sha256')
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      assert(bytes <= config.maxArtifactBytes && bytes <= expectedBytes, '发布包超过允许大小', 'DOWNLOAD_TOO_LARGE')
      digest.update(value)
      fs.writeSync(handle, value)
    }
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  assert(bytes === expectedBytes, '发布包字节数与签名清单不一致', 'ARTIFACT_SIZE_MISMATCH')
  assert(digest.digest('hex') === expectedSha256, '发布包 SHA-256 与签名清单不一致', 'ARTIFACT_DIGEST_MISMATCH')
}

function assetMap(release) {
  assert(isPlainObject(release) && !release.draft && !release.prerelease, '目标 Release 不是正式版本', 'INVALID_RELEASE')
  assert(TAG_PATTERN.test(release.tag_name), '目标 Release tag 无效', 'INVALID_RELEASE')
  assert(Array.isArray(release.assets), '目标 Release 缺少资产列表', 'INVALID_RELEASE')
  const map = new Map()
  for (const asset of release.assets) {
    const name = String(asset?.name || '')
    if (!name) continue
    assert(!map.has(name), `Release 包含重复资产 ${name}`, 'DUPLICATE_ASSET')
    map.set(name, safeAssetUrl(asset.browser_download_url).href)
  }
  for (const required of REQUIRED_ASSETS) assert(map.has(required), `Release 缺少 ${required}`, 'MISSING_ASSET')
  return map
}

async function fetchRelease(tag, config) {
  const url = `https://api.github.com/repos/${REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`
  const response = await fetchWithRedirects(url, { method: 'GET' }, config.downloadTimeoutMs)
  const payload = parseJson(await readLimitedResponse(response, MAX_MANIFEST_BYTES, 'Release 元数据'), 'Release 元数据')
  assert(payload.tag_name === tag, 'GitHub Release tag 与请求不一致', 'RELEASE_TAG_MISMATCH')
  return { release: payload, assets: assetMap(payload) }
}

function validateManifest(manifest, tag, config) {
  assert(manifest.manifestSchemaVersion === 1, '不支持此发布清单版本', 'UNSUPPORTED_MANIFEST')
  assert(manifest.repository === REPOSITORY && manifest.channel === 'stable', '发布清单来源或通道无效', 'MANIFEST_SOURCE_MISMATCH')
  assert(manifest.tag === tag && TAG_PATTERN.test(manifest.tag), '发布清单 tag 不一致', 'MANIFEST_TAG_MISMATCH')
  assert(manifest.version === tag.slice(1), '发布清单版本与 tag 不一致', 'MANIFEST_VERSION_MISMATCH')
  assert(COMMIT_PATTERN.test(manifest.commit), '发布清单 commit 无效', 'INVALID_COMMIT')
  assert(manifest.dataCompatibility?.schemaVersion === 1, '数据兼容版本不受支持', 'INCOMPATIBLE_DATA_SCHEMA')
  assert(manifest.dataCompatibility?.irreversibleMigration === false, '包含不可逆数据迁移的版本不能自动安装', 'IRREVERSIBLE_MIGRATION')
  assert(manifest.platformCompatibility?.updaterContractVersion === 1, '此版本需要人工升级 systemd 更新平台', 'INCOMPATIBLE_UPDATER_CONTRACT')
  assert(manifest.healthCheckPath === '/api/system/health', '发布清单健康检查路径无效', 'INVALID_HEALTH_PATH')
  const artifact = manifest.artifact
  assert(isPlainObject(artifact), '发布清单缺少发布包信息', 'INVALID_MANIFEST')
  assert(artifact.name === `lenovo-store-operations-${tag}.tar.gz`, '发布包名称无效', 'INVALID_ARTIFACT_NAME')
  assert(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= config.maxArtifactBytes, '发布包大小无效', 'INVALID_ARTIFACT_SIZE')
  assert(/^[0-9a-f]{64}$/.test(artifact.sha256), '发布包 SHA-256 无效', 'INVALID_ARTIFACT_DIGEST')
  assert(artifact.format === 'tar+gzip' && artifact.installMode === 'npm-ci-on-target', '发布包安装模式无效', 'INVALID_INSTALL_MODE')
  return manifest
}

function verifyManifestSignature(manifestBytes, signatureBytes, publicKeyPath) {
  const publicKeyStats = fs.lstatSync(publicKeyPath)
  assert(publicKeyStats.uid === 0 && (publicKeyStats.mode & 0o022) === 0, 'Release 签名公钥权限不安全', 'UNSAFE_PUBLIC_KEY')
  const publicKey = readRegularFile(publicKeyPath, 64 * 1024, 'Release 签名公钥')
  const signatureText = signatureBytes.toString('utf8').trim()
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText), 'Release 签名编码无效', 'INVALID_SIGNATURE')
  const signature = Buffer.from(signatureText, 'base64')
  assert(signature.length === 64, 'Release 签名长度无效', 'INVALID_SIGNATURE')
  assert(crypto.verify(null, manifestBytes, publicKey, signature), 'Release 清单签名验证失败', 'SIGNATURE_VERIFICATION_FAILED')
}

function parseChecksums(buffer) {
  const entries = new Map()
  for (const line of buffer.toString('utf8').trim().split('\n')) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/.exec(line.trim())
    assert(match, 'SHA256SUMS 格式无效', 'INVALID_CHECKSUMS')
    assert(!entries.has(match[2]), `SHA256SUMS 包含重复文件 ${match[2]}`, 'INVALID_CHECKSUMS')
    entries.set(match[2], match[1])
  }
  return entries
}

async function inspectArchive(archivePath, expectedRoot, config) {
  const environment = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' }
  const { stdout: namesOutput } = await runFixed(config.tarPath, ['-tzf', archivePath], { timeout: 120000, env: environment, maxBuffer: 32 * 1024 * 1024 })
  const names = namesOutput.trim().split('\n').filter(Boolean)
  assert(names.length > 0 && names.length <= MAX_ARCHIVE_ENTRIES, '发布包文件数量无效', 'ARCHIVE_ENTRY_LIMIT')
  const seen = new Set()
  for (const name of names) {
    assert(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'), `发布包包含不安全路径 ${name}`, 'UNSAFE_ARCHIVE_PATH')
    assert(name === expectedRoot || name.startsWith(`${expectedRoot}/`), '发布包必须只有一个固定顶层目录', 'INVALID_ARCHIVE_ROOT')
    assert(!seen.has(name), `发布包包含重复路径 ${name}`, 'DUPLICATE_ARCHIVE_ENTRY')
    seen.add(name)
  }
  const { stdout: verboseOutput } = await runFixed(config.tarPath, ['-tvzf', archivePath], { timeout: 120000, env: environment, maxBuffer: 64 * 1024 * 1024 })
  let totalBytes = 0
  const lines = verboseOutput.trim().split('\n').filter(Boolean)
  assert(lines.length === names.length, '发布包目录清单不一致', 'INVALID_ARCHIVE')
  for (const line of lines) {
    assert(line[0] === '-' || line[0] === 'd', '发布包包含链接、设备或其他特殊文件', 'UNSAFE_ARCHIVE_TYPE')
    const fields = line.trim().split(/\s+/)
    const size = Number(fields[2])
    assert(Number.isSafeInteger(size) && size >= 0, '无法验证发布包文件大小', 'INVALID_ARCHIVE')
    totalBytes += size
    assert(totalBytes <= MAX_UNPACKED_BYTES, '发布包解压大小超过限制', 'ARCHIVE_SIZE_LIMIT')
  }
}

function validateExtractedTree(root) {
  const required = [
    'package.json',
    'package-lock.json',
    'release-info.json',
    'apps/server/src/server.js',
    'ops/updater/updater.mjs',
    'apps/web/dist/index.html',
    'apps/computer-labels/dist/index.html',
    'apps/price-labels/dist/index.html',
    'apps/receipt-assistant/dist/index.html',
    'apps/employee-badges/dist/index.html',
  ]
  for (const relative of required) {
    const stats = fs.lstatSync(path.join(root, relative))
    assert(stats.isFile() && !stats.isSymbolicLink(), `候选版本缺少安全的 ${relative}`, 'INVALID_RELEASE_TREE')
  }
  const stack = [root]
  let entries = 0
  while (stack.length) {
    const directory = stack.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      entries += 1
      assert(entries <= MAX_ARCHIVE_ENTRIES, '候选版本文件数量超过限制', 'RELEASE_TREE_LIMIT')
      assert(!entry.isSymbolicLink(), `候选版本包含符号链接 ${entry.name}`, 'UNSAFE_RELEASE_TREE')
      if (entry.isDirectory()) stack.push(path.join(directory, entry.name))
      else assert(entry.isFile(), `候选版本包含特殊文件 ${entry.name}`, 'UNSAFE_RELEASE_TREE')
    }
  }
}

function crossCheckRelease(candidateRoot, manifest) {
  const packageMetadata = parseJson(readRegularFile(path.join(candidateRoot, 'package.json'), 1024 * 1024, 'package.json'), 'package.json')
  const lockMetadata = parseJson(readRegularFile(path.join(candidateRoot, 'package-lock.json'), 20 * 1024 * 1024, 'package-lock.json'), 'package-lock.json')
  const releaseInfo = parseJson(readRegularFile(path.join(candidateRoot, 'release-info.json'), 64 * 1024, 'release-info.json'), 'release-info.json')
  assert(packageMetadata.version === manifest.version && lockMetadata.version === manifest.version, 'package 与发布清单版本不一致', 'PACKAGE_VERSION_MISMATCH')
  for (const field of ['repository', 'channel', 'version', 'tag', 'commit']) {
    assert(releaseInfo[field] === manifest[field], `release-info.${field} 与签名清单不一致`, 'RELEASE_INFO_MISMATCH')
  }
  return releaseInfo
}

function changeOwnershipAndMode(root, uid, gid) {
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    const stats = fs.lstatSync(current)
    if (stats.isSymbolicLink()) {
      fs.lchownSync(current, uid, gid)
      continue
    }
    fs.chownSync(current, uid, gid)
    if (stats.isDirectory()) {
      fs.chmodSync(current, 0o750)
      for (const name of fs.readdirSync(current)) stack.push(path.join(current, name))
    } else if (stats.isFile()) {
      const executable = Boolean(stats.mode & 0o111)
      fs.chmodSync(current, executable ? 0o750 : 0o640)
    }
  }
}

function uidProcessIds(uid) {
  const processIds = []
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const status = fs.readFileSync(path.join('/proc', name, 'status'), 'utf8')
      const match = /^Uid:\s+(\d+)/m.exec(status)
      if (match && Number(match[1]) === uid) processIds.push(Number(name))
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error
    }
  }
  return processIds
}

function assertBuilderIdle(config) {
  assert(uidProcessIds(config.builderUid).length === 0, '专用构建账号存在遗留进程，拒绝处理候选版本', 'BUILDER_NOT_IDLE')
}

function terminateBuilderProcesses(config) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const processIds = uidProcessIds(config.builderUid)
    if (processIds.length === 0) return
    for (const processId of processIds) {
      try {
        process.kill(processId, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    Atomics.wait(sleeper, 0, 0, 100)
  }
  throw updaterError('无法终止专用构建账号的全部进程', 'BUILDER_PROCESS_CLEANUP_FAILED')
}

function sha256RegularFile(filePath, maxBytes, name) {
  return crypto.createHash('sha256').update(readRegularFile(filePath, maxBytes, name)).digest('hex')
}

async function prepareCandidate(candidateRoot, config) {
  assertBuilderIdle(config)
  const updaterSource = path.join(candidateRoot, 'ops/updater/updater.mjs')
  const trustedUpdaterSha256 = sha256RegularFile(updaterSource, 2 * 1024 * 1024, '候选更新器')
  const builderHome = path.join(candidateRoot, '.builder-home')
  fs.mkdirSync(builderHome, { mode: 0o700 })
  changeOwnershipAndMode(candidateRoot, config.builderUid, config.builderGid)
  const environment = {
    HOME: builderHome,
    PATH: `${path.dirname(config.npmPath)}:/usr/local/bin:/usr/bin:/bin`,
    NODE_ENV: 'development',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_cache: path.join(candidateRoot, '.npm-cache'),
  }
  let buildError = null
  try {
    await runFixed(config.npmPath, ['ci', '--include=dev'], {
      cwd: candidateRoot,
      timeout: config.installTimeoutMs,
      env: environment,
      uid: config.builderUid,
      gid: config.builderGid,
    })
    await runFixed(config.npmPath, ['run', 'check'], {
      cwd: candidateRoot,
      timeout: config.installTimeoutMs,
      env: environment,
      uid: config.builderUid,
      gid: config.builderGid,
    })
  } catch (error) {
    buildError = error
  } finally {
    terminateBuilderProcesses(config)
    fs.rmSync(path.join(candidateRoot, '.npm-cache'), { recursive: true, force: true })
    fs.rmSync(environment.HOME, { recursive: true, force: true })
  }
  if (buildError) throw buildError
  assert(sha256RegularFile(updaterSource, 2 * 1024 * 1024, '候选更新器') === trustedUpdaterSha256, '候选更新器在降权构建期间被修改', 'UPDATER_PAYLOAD_CHANGED')
  changeOwnershipAndMode(candidateRoot, 0, config.serviceGid)
  return trustedUpdaterSha256
}

function releasesDirectory(config) {
  const value = path.join(config.releaseRoot, 'releases')
  const real = fs.realpathSync(value)
  assert(real === value, 'releases 目录不能是符号链接', 'UNSAFE_RELEASE_ROOT')
  return value
}

function resolveReleaseLink(linkPath, releasesRoot) {
  const stats = fs.lstatSync(linkPath)
  assert(stats.isSymbolicLink(), `${path.basename(linkPath)} 必须是符号链接`, 'INVALID_RELEASE_LINK')
  const resolved = fs.realpathSync(linkPath)
  assert(path.dirname(resolved) === releasesRoot, `${path.basename(linkPath)} 指向 releases 目录之外`, 'UNSAFE_RELEASE_LINK')
  return resolved
}

function readReleaseIdentity(releasePath) {
  const info = parseJson(readRegularFile(path.join(releasePath, 'release-info.json'), 64 * 1024, 'release-info.json'), 'release-info.json')
  assert(TAG_PATTERN.test(info.tag) && COMMIT_PATTERN.test(info.commit) && info.version === info.tag.slice(1), 'release-info 身份无效', 'INVALID_RELEASE_INFO')
  return { version: info.version, tag: info.tag, commit: info.commit, shortCommit: info.commit.slice(0, 8) }
}

function replaceSymlink(linkPath, targetPath, releaseRoot) {
  const relativeTarget = path.relative(releaseRoot, targetPath)
  assert(relativeTarget && !relativeTarget.startsWith('..') && !path.isAbsolute(relativeTarget), '链接目标超出 release 根目录', 'UNSAFE_RELEASE_LINK')
  const temporary = path.join(releaseRoot, `.${path.basename(linkPath)}.${process.pid}.${crypto.randomUUID()}`)
  fs.symlinkSync(relativeTarget, temporary)
  fs.renameSync(temporary, linkPath)
  fsyncDirectory(releaseRoot)
}

async function restartService(config) {
  await runFixed('/usr/bin/systemctl', ['restart', config.serviceName], { timeout: 120000 })
}

async function waitForHealth(config, expected) {
  const deadline = Date.now() + config.healthTimeoutMs
  let consecutive = 0
  let lastMessage = '服务尚未响应'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(config.healthUrl, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) })
      const body = await response.json()
      const data = body?.data
      const modules = Array.isArray(data?.modules) ? data.modules : []
      const healthy = response.ok
        && body?.code === 0
        && data?.status === 'ok'
        && data?.service === 'lenovo-store-operations'
        && data?.build?.version === expected.version
        && data?.build?.commit === expected.commit
        && data?.persistentDataConfigured === true
        && modules.length > 0
        && modules.every(module => module.moduleReady === true && (module.persistence !== 'sqlite' || module.databaseConnected === true))
      if (healthy) {
        consecutive += 1
        if (consecutive >= 3) return
      } else {
        consecutive = 0
        lastMessage = '健康响应的版本、提交、数据目录或数据库状态不符合要求'
      }
    } catch (error) {
      consecutive = 0
      lastMessage = error.message
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw updaterError(`服务健康检查超时：${lastMessage}`, 'HEALTH_CHECK_FAILED')
}

function installSignedUpdater(candidateRoot, config, expectedSha256) {
  const source = path.join(candidateRoot, 'ops/updater/updater.mjs')
  const sourceStats = fs.lstatSync(source)
  assert(sourceStats.isFile() && !sourceStats.isSymbolicLink() && sourceStats.size > 0 && sourceStats.size <= 2 * 1024 * 1024, '候选版本的更新器程序无效', 'INVALID_UPDATER_PAYLOAD')
  assert(sha256RegularFile(source, 2 * 1024 * 1024, '候选更新器') === expectedSha256, '封存后的候选更新器摘要发生变化', 'UPDATER_PAYLOAD_CHANGED')
  const directory = path.dirname(config.updaterPath)
  assert(fs.realpathSync(directory) === directory, '更新器安装目录不能是符号链接', 'UNSAFE_UPDATER_PATH')
  const temporary = path.join(directory, `.updater.${process.pid}.${crypto.randomUUID()}.tmp`)
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL)
  try {
    fs.chownSync(temporary, 0, 0)
    fs.chmodSync(temporary, 0o755)
    const handle = fs.openSync(temporary, 'r')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
    fs.renameSync(temporary, config.updaterPath)
    const directoryHandle = fs.openSync(directory, 'r')
    try { fs.fsyncSync(directoryHandle) } finally { fs.closeSync(directoryHandle) }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function validateIdentity(identity, name) {
  assert(isPlainObject(identity) && TAG_PATTERN.test(identity.tag) && COMMIT_PATTERN.test(identity.commit) && identity.version === identity.tag.slice(1), `更新事务 ${name} 无效`, 'INVALID_TRANSACTION')
  return identity
}

function validateTransaction(raw) {
  assert(isPlainObject(raw) && raw.schemaVersion === 1, '更新事务 journal 格式无效', 'INVALID_TRANSACTION')
  assert(['claimed', 'preparing', 'prepared', 'switched', 'recovered', 'committed'].includes(raw.stage), '更新事务阶段无效', 'INVALID_TRANSACTION')
  const request = validateRequest(raw.request, { allowExpired: true })
  if (raw.stage === 'claimed') return { ...raw, request }
  const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-[0-9a-f]{40}$/
  assert(releasePattern.test(raw.oldRelease) && releasePattern.test(raw.newRelease), '更新事务 release 名称无效', 'INVALID_TRANSACTION')
  return {
    ...raw,
    request,
    oldIdentity: validateIdentity(raw.oldIdentity, 'oldIdentity'),
    targetIdentity: validateIdentity(raw.targetIdentity, 'targetIdentity'),
  }
}

function readRootOwnedJson(filePath, maxBytes, name) {
  const stats = fs.lstatSync(filePath)
  assert(stats.uid === 0 && (stats.mode & 0o022) === 0, `${name} 权限无效`, 'UNSAFE_TRANSACTION')
  return parseJson(readRegularFile(filePath, maxBytes, name), name)
}

function transactionReleaseContext(config, transaction) {
  const releasesRoot = releasesDirectory(config)
  const oldRelease = path.join(releasesRoot, transaction.oldRelease)
  const newRelease = path.join(releasesRoot, transaction.newRelease)
  assert(fs.realpathSync(oldRelease) === oldRelease && fs.realpathSync(newRelease) === newRelease, '事务中的 release 不存在或路径无效', 'INVALID_TRANSACTION')
  assert(readReleaseIdentity(oldRelease).commit === transaction.oldIdentity.commit, '旧 release 身份与事务不一致', 'INVALID_TRANSACTION')
  assert(readReleaseIdentity(newRelease).commit === transaction.targetIdentity.commit, '目标 release 身份与事务不一致', 'INVALID_TRANSACTION')
  return { oldRelease, newRelease }
}

function removeDirectoryDurably(directory, parent) {
  if (!fs.existsSync(directory)) return
  const stats = fs.lstatSync(directory)
  assert(stats.isDirectory() && !stats.isSymbolicLink() && path.dirname(directory) === parent, '待清理目录无效', 'UNSAFE_CLEANUP_PATH')
  fs.rmSync(directory, { recursive: true, force: true })
  fsyncDirectory(parent)
}

function updaterServiceIsRunning(config) {
  try {
    const state = execFileSync('/usr/bin/systemctl', ['show', '--property=ActiveState', '--value', config.updaterServiceName], {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' },
    }).trim()
    return ['active', 'activating', 'reloading'].includes(state)
  } catch {
    return false
  }
}

function recoverLinksBeforeServiceStart(config) {
  if (!fs.existsSync(config.transactionPath)) return
  const transaction = validateTransaction(readRootOwnedJson(config.transactionPath, MAX_REQUEST_BYTES * 4, '更新事务 journal'))
  if (['claimed', 'preparing', 'committed', 'recovered'].includes(transaction.stage) || updaterServiceIsRunning(config)) return
  const { oldRelease } = transactionReleaseContext(config, transaction)
  replaceSymlink(path.join(config.releaseRoot, 'current'), oldRelease, config.releaseRoot)
  replaceSymlink(path.join(config.releaseRoot, 'previous'), oldRelease, config.releaseRoot)
  writeJsonAtomic(config.transactionPath, { ...transaction, stage: 'recovered', updatedAt: new Date().toISOString() }, { mode: 0o600 })
}

async function recoverInterruptedTransaction(config) {
  if (!fs.existsSync(config.transactionPath)) return
  const transaction = validateTransaction(readRootOwnedJson(config.transactionPath, MAX_REQUEST_BYTES * 4, '更新事务 journal'))
  const status = createStatusWriter(config, transaction.request)

  if (['claimed', 'preparing'].includes(transaction.stage)) {
    const releasesRoot = releasesDirectory(config)
    const currentRelease = resolveReleaseLink(path.join(config.releaseRoot, 'current'), releasesRoot)
    let currentIdentity = readReleaseIdentity(currentRelease)
    const stagingRoot = path.join(releasesRoot, `.staging-${transaction.request.jobId}`)
    removeDirectoryDurably(stagingRoot, releasesRoot)

    if (transaction.stage === 'preparing') {
      const oldRelease = path.join(releasesRoot, transaction.oldRelease)
      assert(fs.realpathSync(oldRelease) === oldRelease && currentRelease === oldRelease, 'preparing 事务的 current 已意外变化', 'INVALID_TRANSACTION')
      assert(readReleaseIdentity(oldRelease).commit === transaction.oldIdentity.commit, 'preparing 事务的旧 release 身份无效', 'INVALID_TRANSACTION')
      currentIdentity = transaction.oldIdentity
      const newRelease = path.join(releasesRoot, transaction.newRelease)
      if (fs.existsSync(newRelease)) {
        const previousRelease = resolveReleaseLink(path.join(config.releaseRoot, 'previous'), releasesRoot)
        assert(currentRelease !== newRelease && previousRelease !== newRelease, '不能清理仍被链接引用的候选 release', 'UNSAFE_CLEANUP_PATH')
        assert(readReleaseIdentity(newRelease).commit === transaction.targetIdentity.commit, '待清理候选 release 身份无效', 'INVALID_TRANSACTION')
        removeDirectoryDurably(newRelease, releasesRoot)
      }
    }

    await restartService(config)
    await waitForHealth(config, currentIdentity)
    status.finish('failed', {
      phase: 'failed-before-switch',
      current: currentIdentity,
      target: transaction.targetIdentity || null,
      error: { code: 'INTERRUPTED_BEFORE_SWITCH', message: '更新在候选版本切换前被中断，已清理本事务候选并确认原服务健康，请重新检查后提交' },
    })
    removeFileDurably(config.transactionPath)
    removeFileDurably(config.processingPath)
    return
  }

  const { oldRelease } = transactionReleaseContext(config, transaction)
  if (transaction.stage === 'committed') {
    status.finish('succeeded', { phase: 'completed', current: transaction.targetIdentity, target: transaction.targetIdentity })
    removeFileDurably(config.transactionPath)
    removeFileDurably(config.processingPath)
    return
  }

  try {
    status.update('rolling-back', { current: transaction.oldIdentity, target: transaction.targetIdentity })
    if (transaction.stage !== 'recovered') {
      replaceSymlink(path.join(config.releaseRoot, 'current'), oldRelease, config.releaseRoot)
      replaceSymlink(path.join(config.releaseRoot, 'previous'), oldRelease, config.releaseRoot)
      await restartService(config)
    }
    await waitForHealth(config, transaction.oldIdentity)
    status.finish('failed', {
      phase: 'rolled-back',
      current: transaction.oldIdentity,
      target: transaction.targetIdentity,
      rolledBack: true,
      error: { code: 'INTERRUPTED_UPDATE_RECOVERED', message: '更新事务曾被关机或进程终止中断，已保守回滚到原版本' },
    })
    removeFileDurably(config.transactionPath)
    removeFileDurably(config.processingPath)
  } catch (error) {
    status.finish('rollback-failed', {
      phase: 'rollback-failed',
      error: { code: error.code || 'RECOVERY_FAILED', message: `中断事务自动恢复失败：${error.message}` },
    })
    throw error
  }
}

function recoverStaleRunningStatus(config) {
  if (!fs.existsSync(config.statePath) || fs.existsSync(config.transactionPath) || fs.existsSync(config.requestPath) || fs.existsSync(config.processingPath)) return
  const state = readRootOwnedJson(config.statePath, MAX_REQUEST_BYTES * 4, '更新任务状态')
  if (!['queued', 'running'].includes(state.status)) return
  const request = validateRequest({
    schemaVersion: 1,
    jobId: state.jobId,
    action: 'install',
    tag: state.targetTag,
    requestedAt: state.requestedAt,
  }, { allowExpired: true })
  const releasesRoot = releasesDirectory(config)
  const currentRelease = resolveReleaseLink(path.join(config.releaseRoot, 'current'), releasesRoot)
  const currentIdentity = readReleaseIdentity(currentRelease)
  const status = createStatusWriter(config, request)
  status.finish('failed', {
    phase: 'failed-before-switch',
    current: currentIdentity,
    error: { code: 'ORPHANED_UPDATE_STATE', message: '检测到没有事务 journal 的遗留任务，已确认 current 未由该任务切换；请重新检查后提交' },
  })
}

function recoverOrphanedProcessing(config) {
  if (!fs.existsSync(config.processingPath)) return
  const request = validateRequest(parseJson(readRegularFile(config.processingPath, MAX_REQUEST_BYTES, '遗留更新请求'), '遗留更新请求'), { allowExpired: true })
  const status = createStatusWriter(config, request)
  status.finish('failed', {
    phase: 'failed-before-switch',
    error: { code: 'INTERRUPTED_BEFORE_SWITCH', message: '更新器在建立切换事务前中断，当前运行版本未改变，请重新检查后提交' },
  })
  removeFileDurably(config.processingPath)
}

async function install(request, config, status) {
  const releasesRoot = releasesDirectory(config)
  const currentPath = path.join(config.releaseRoot, 'current')
  const previousPath = path.join(config.releaseRoot, 'previous')
  const oldRelease = resolveReleaseLink(currentPath, releasesRoot)
  const oldIdentity = readReleaseIdentity(oldRelease)
  assert(compareVersions(request.tag, oldIdentity.tag) > 0, '目标版本必须高于当前版本', 'UPDATE_NOT_NEWER')
  status.update('downloading', { current: oldIdentity })
  const { assets } = await fetchRelease(request.tag, config)
  const manifestBytes = await downloadSmall(assets.get('manifest.json'), MAX_MANIFEST_BYTES, 'manifest.json', config)
  const signatureBytes = await downloadSmall(assets.get('manifest.json.sig'), MAX_SIGNATURE_BYTES, 'manifest.json.sig', config)
  verifyManifestSignature(manifestBytes, signatureBytes, config.publicKeyPath)
  const manifest = validateManifest(parseJson(manifestBytes, 'manifest.json'), request.tag, config)
  const artifactUrl = assets.get(manifest.artifact.name)
  assert(artifactUrl, `Release 缺少 ${manifest.artifact.name}`, 'MISSING_ASSET')
  const checksumsBytes = await downloadSmall(assets.get('SHA256SUMS'), MAX_CHECKSUM_BYTES, 'SHA256SUMS', config)
  const checksums = parseChecksums(checksumsBytes)
  assert(checksums.size === 3, 'SHA256SUMS 必须只包含发布包、manifest 和签名', 'CHECKSUM_MISMATCH')
  assert(checksums.get('manifest.json') === crypto.createHash('sha256').update(manifestBytes).digest('hex'), 'SHA256SUMS 中 manifest 摘要不一致', 'CHECKSUM_MISMATCH')
  assert(checksums.get('manifest.json.sig') === crypto.createHash('sha256').update(signatureBytes).digest('hex'), 'SHA256SUMS 中签名摘要不一致', 'CHECKSUM_MISMATCH')
  assert(checksums.get(manifest.artifact.name) === manifest.artifact.sha256, 'SHA256SUMS 中发布包摘要不一致', 'CHECKSUM_MISMATCH')

  const targetIdentity = { version: manifest.version, tag: manifest.tag, commit: manifest.commit, shortCommit: manifest.commit.slice(0, 8) }
  const finalName = `${manifest.version}-${manifest.commit}`
  const finalPath = path.join(releasesRoot, finalName)
  const stagingRoot = path.join(releasesRoot, `.staging-${request.jobId}`)
  assert(!fs.existsSync(stagingRoot), '更新 staging 已存在', 'STAGING_EXISTS')
  fs.mkdirSync(stagingRoot, { mode: 0o710 })
  fs.chownSync(stagingRoot, 0, config.builderGid)
  fs.chmodSync(stagingRoot, 0o710)
  fsyncDirectory(releasesRoot)
  const archivePath = path.join(stagingRoot, manifest.artifact.name)
  let switched = false
  let serviceStopped = false
  let candidatePersisted = false
  let transaction = null
  try {
    await downloadArtifact(artifactUrl, archivePath, manifest.artifact.bytes, manifest.artifact.sha256, config)
    status.update('verifying', { target: targetIdentity })
    const archiveRoot = `lenovo-store-operations-${request.tag}`
    await inspectArchive(archivePath, archiveRoot, config)
    await runFixed(config.tarPath, ['-xzf', archivePath, '-C', stagingRoot, '--no-same-owner', '--no-same-permissions'], { timeout: 120000 })
    fs.unlinkSync(archivePath)
    const candidateRoot = path.join(stagingRoot, archiveRoot)
    validateExtractedTree(candidateRoot)
    crossCheckRelease(candidateRoot, manifest)
    status.update('installing')
    const trustedUpdaterSha256 = await prepareCandidate(candidateRoot, config)

    assert(!fs.existsSync(finalPath), '目标 release 已存在，拒绝覆盖', 'RELEASE_EXISTS')
    transaction = {
      schemaVersion: 1,
      stage: 'preparing',
      request,
      oldRelease: path.basename(oldRelease),
      newRelease: finalName,
      oldIdentity,
      targetIdentity,
      updatedAt: new Date().toISOString(),
    }
    writeJsonAtomic(config.transactionPath, transaction, { mode: 0o600 })

    status.update('backing-up')
    serviceStopped = true
    await runFixed('/usr/bin/systemctl', ['stop', config.serviceName], { timeout: 120000 })
    await runFixed('/usr/bin/systemctl', ['start', config.backupServiceName], { timeout: config.installTimeoutMs })
    fs.renameSync(candidateRoot, finalPath)
    candidatePersisted = true
    fsyncDirectory(releasesRoot)
    fs.rmdirSync(stagingRoot)
    fsyncDirectory(releasesRoot)

    transaction = { ...transaction, stage: 'prepared', updatedAt: new Date().toISOString() }
    writeJsonAtomic(config.transactionPath, transaction, { mode: 0o600 })
    status.update('switching')
    replaceSymlink(previousPath, oldRelease, config.releaseRoot)
    switched = true
    replaceSymlink(currentPath, finalPath, config.releaseRoot)
    transaction = { ...transaction, stage: 'switched', updatedAt: new Date().toISOString() }
    writeJsonAtomic(config.transactionPath, transaction, { mode: 0o600 })
    status.update('restarting')
    await restartService(config)
    serviceStopped = false
    status.update('health-check')
    await waitForHealth(config, targetIdentity)
    status.update('finalizing')
    installSignedUpdater(finalPath, config, trustedUpdaterSha256)
    transaction = { ...transaction, stage: 'committed', updatedAt: new Date().toISOString() }
    writeJsonAtomic(config.transactionPath, transaction, { mode: 0o600 })
    status.finish('succeeded', { phase: 'completed', current: readReleaseIdentity(finalPath), target: readReleaseIdentity(finalPath) })
    removeFileDurably(config.transactionPath)
  } catch (error) {
    if (switched) {
      try {
        status.update('rolling-back', { error: { code: error.code || 'UPDATE_FAILED', message: error.message } })
        replaceSymlink(currentPath, oldRelease, config.releaseRoot)
        replaceSymlink(previousPath, oldRelease, config.releaseRoot)
        await restartService(config)
        serviceStopped = false
        await waitForHealth(config, oldIdentity)
        status.finish('failed', { phase: 'rolled-back', current: oldIdentity, target: targetIdentity, rolledBack: true, error: { code: error.code || 'UPDATE_FAILED', message: error.message } })
        removeFileDurably(config.transactionPath)
      } catch (rollbackError) {
        status.finish('rollback-failed', {
          phase: 'rollback-failed',
          error: {
            code: rollbackError.code || 'ROLLBACK_FAILED',
            message: `更新失败且自动回滚未通过健康检查：${rollbackError.message}`,
          },
        })
      }
    } else {
      let failure = error
      if (serviceStopped) {
        try {
          await restartService(config)
          await waitForHealth(config, oldIdentity)
          serviceStopped = false
        } catch (restartError) {
          failure = updaterError(`候选版本切换前失败，且原服务未能恢复：${restartError.message}`, 'ORIGINAL_SERVICE_RESTART_FAILED')
        }
      }
      if (candidatePersisted) {
        try {
          assert(readReleaseIdentity(finalPath).commit === targetIdentity.commit, '待清理候选 release 身份无效', 'INVALID_TRANSACTION')
          removeDirectoryDurably(finalPath, releasesRoot)
        } catch (cleanupError) {
          failure = updaterError(`候选版本切换前失败，且候选目录未能安全清理：${cleanupError.message}`, 'CANDIDATE_CLEANUP_FAILED')
        }
      }
      const rollbackFailed = ['ORIGINAL_SERVICE_RESTART_FAILED', 'CANDIDATE_CLEANUP_FAILED'].includes(failure.code)
      status.finish(rollbackFailed ? 'rollback-failed' : 'failed', {
        phase: rollbackFailed ? 'rollback-failed' : 'failed-before-switch',
        current: oldIdentity,
        target: targetIdentity,
        error: { code: failure.code || 'UPDATE_FAILED', message: failure.message },
      })
      if (!rollbackFailed && fs.existsSync(config.transactionPath)) removeFileDurably(config.transactionPath)
    }
    throw error
  } finally {
    removeDirectoryDurably(stagingRoot, releasesRoot)
  }
}

async function main() {
  assert(process.platform === 'linux', '更新器只能在 Linux 上运行', 'UNSUPPORTED_PLATFORM')
  assert(typeof process.getuid === 'function' && process.getuid() === 0, '更新器必须由 root systemd oneshot 运行', 'ROOT_REQUIRED')
  const config = loadConfig()
  const mode = process.argv[2] || ''
  assert(!mode || mode === '--recover-links-only', '更新器启动参数无效', 'INVALID_ARGUMENT')
  if (mode === '--recover-links-only') {
    recoverLinksBeforeServiceStart(config)
    return
  }
  await recoverInterruptedTransaction(config)
  recoverOrphanedProcessing(config)
  recoverStaleRunningStatus(config)
  const request = claimRequest(config)
  if (!request) return
  writeJsonAtomic(config.transactionPath, {
    schemaVersion: 1,
    stage: 'claimed',
    request,
    updatedAt: new Date().toISOString(),
  }, { mode: 0o600 })
  const status = createStatusWriter(config, request)
  try {
    await install(request, config, status)
  } catch (error) {
    console.error(`[${error.code || 'UPDATER_FAILED'}] ${error.message}`)
    process.exitCode = 1
  } finally {
    removeFileDurably(config.processingPath)
  }
}

main().catch(error => {
  console.error(`[${error.code || 'UPDATER_FATAL'}] ${error.message}`)
  process.exitCode = 1
})
