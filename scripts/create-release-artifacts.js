import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(currentDir, '..')
const repository = 'zifeng-chen/lenovo-store-operations'
const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const packageMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const tag = String(process.env.GITHUB_REF_NAME || process.argv[2] || '').trim()
const version = tag.slice(1)
const outputDirectory = path.join(projectRoot, 'release-assets')
const releaseDirectoryName = `lenovo-store-operations-${tag}`
const artifactName = `${releaseDirectoryName}.tar.gz`
const requiredDistDirectories = [
  'apps/web/dist',
  'apps/computer-labels/dist',
  'apps/price-labels/dist',
  'apps/receipt-assistant/dist',
  'apps/employee-badges/dist',
]

function fail(message) {
  throw new Error(`Release 打包失败：${message}`)
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    timeout: options.timeout || 120000,
  })
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function removeForbiddenContent(releaseRoot) {
  for (const relativePath of ['.git', '.github', '.kiro', 'data', 'secrets', 'credentials', 'node_modules', 'release-assets', 'semantic-review']) {
    fs.rmSync(path.join(releaseRoot, relativePath), { recursive: true, force: true })
  }
}

function validateReleaseTree(releaseRoot) {
  const requiredFiles = [
    'package.json',
    'package-lock.json',
    '.nvmrc',
    'apps/server/src/server.js',
    'apps/server/src/system/runtime-info.js',
    'packages/shared/package.json',
    'scripts/backup-data.js',
    'ops/updater/updater.mjs',
    'ops/systemd/lenovo-store-updater.service',
    ...requiredDistDirectories.map(directory => `${directory}/index.html`),
  ]
  for (const relativePath of requiredFiles) {
    if (!fs.existsSync(path.join(releaseRoot, relativePath))) fail(`发布包缺少 ${relativePath}`)
  }

  const forbiddenDirectoryNames = new Set(['.git', '.github', '.kiro', 'data', 'secrets', 'credentials', 'node_modules', 'release-assets'])
  const forbiddenFilePattern = /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:sqlite|sqlite3|db|db3|lsbackup|key|pem|p12|pfx|crt|cer|der|jks|keystore|kdbx)|.*-(?:wal|shm|journal|backup))$/i
  const stack = [releaseRoot]
  while (stack.length) {
    const directory = stack.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(releaseRoot, absolutePath).split(path.sep).join('/')
      if (entry.isSymbolicLink()) fail(`发布包包含符号链接 ${relativePath}`)
      if (entry.isDirectory()) {
        if (forbiddenDirectoryNames.has(entry.name.toLowerCase())) fail(`发布包包含禁止目录 ${relativePath}`)
        stack.push(absolutePath)
      } else if (forbiddenFilePattern.test(relativePath)) {
        fail(`发布包包含敏感或运行时文件 ${relativePath}`)
      }
    }
  }
}

if (!stableTagPattern.test(tag)) fail('必须提供严格的 vX.Y.Z 稳定版本 tag')
if (packageMetadata.version !== version) fail(`tag ${tag} 与根 package.json 版本 ${packageMetadata.version} 不一致`)

const commit = String(process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD'], { capture: true })).trim()
if (!/^[0-9a-f]{40}$/i.test(commit)) fail('发布提交哈希无效')
const commitTimestamp = run('git', ['show', '-s', '--format=%cI', commit], { capture: true }).trim()
const sourceDateEpoch = run('git', ['show', '-s', '--format=%ct', commit], { capture: true }).trim()
const builtAt = String(process.env.RELEASE_BUILT_AT || new Date().toISOString()).trim()
if (Number.isNaN(Date.parse(builtAt))) fail('RELEASE_BUILT_AT 不是有效时间')
const nodeVersion = fs.readFileSync(path.join(projectRoot, '.nvmrc'), 'utf8').trim()
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lenovo-store-release-'))

try {
  const sourceArchive = path.join(temporaryRoot, 'source.tar')
  const stagingRoot = path.join(temporaryRoot, 'staging')
  const releaseRoot = path.join(stagingRoot, releaseDirectoryName)
  fs.mkdirSync(stagingRoot, { recursive: true })

  run('git', ['archive', '--format=tar', `--prefix=${releaseDirectoryName}/`, '-o', sourceArchive, commit])
  run('tar', ['-xf', sourceArchive, '-C', stagingRoot])
  removeForbiddenContent(releaseRoot)

  for (const relativeDirectory of requiredDistDirectories) {
    const source = path.join(projectRoot, relativeDirectory)
    if (!fs.existsSync(path.join(source, 'index.html'))) fail(`构建产物不存在：${relativeDirectory}/index.html`)
    fs.cpSync(source, path.join(releaseRoot, relativeDirectory), { recursive: true, force: true })
  }

  const releaseInfo = {
    manifestSchemaVersion: 1,
    repository,
    channel: 'stable',
    version,
    tag,
    commit,
    commitTimestamp,
    builtAt,
    nodeVersion,
    nodeEngine: packageMetadata.engines?.node || null,
  }
  fs.writeFileSync(path.join(releaseRoot, 'release-info.json'), `${JSON.stringify(releaseInfo, null, 2)}\n`)
  validateReleaseTree(releaseRoot)

  fs.rmSync(outputDirectory, { recursive: true, force: true })
  fs.mkdirSync(outputDirectory, { recursive: true })
  const artifactPath = path.join(outputDirectory, artifactName)
  const tarArguments = process.platform === 'linux'
    ? ['--sort=name', `--mtime=@${sourceDateEpoch}`, '--owner=0', '--group=0', '--numeric-owner', '-czf', artifactPath, '-C', stagingRoot, releaseDirectoryName]
    : ['-czf', artifactPath, '-C', stagingRoot, releaseDirectoryName]
  run('tar', tarArguments)

  const archiveEntries = run('tar', ['-tzf', artifactPath], { capture: true }).trim().split('\n')
  for (const entry of archiveEntries) {
    if (entry.startsWith('/') || entry.split('/').includes('..')) fail(`压缩包包含不安全路径：${entry}`)
  }

  const artifactDigest = sha256(artifactPath)
  const artifactBytes = fs.statSync(artifactPath).size
  const manifest = {
    manifestSchemaVersion: 1,
    repository,
    channel: 'stable',
    version,
    tag,
    commit,
    commitTimestamp,
    builtAt,
    node: {
      version: nodeVersion,
      engine: packageMetadata.engines?.node || null,
    },
    dataCompatibility: {
      schemaVersion: 1,
      irreversibleMigration: false,
    },
    platformCompatibility: {
      updaterContractVersion: 1,
    },
    artifact: {
      name: artifactName,
      bytes: artifactBytes,
      sha256: artifactDigest,
      format: 'tar+gzip',
      installMode: 'npm-ci-on-target',
    },
    healthCheckPath: '/api/system/health',
  }
  const manifestPath = path.join(outputDirectory, 'manifest.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const checksums = [
    `${artifactDigest}  ${artifactName}`,
    `${sha256(manifestPath)}  manifest.json`,
  ]
  fs.writeFileSync(path.join(outputDirectory, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
  console.log(`Release 产物已生成：${path.relative(projectRoot, outputDirectory)}`)
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
