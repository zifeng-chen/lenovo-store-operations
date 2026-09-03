import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(currentDir, '../../../..')
const PACKAGE_PATH = path.join(PROJECT_ROOT, 'package.json')
const RELEASE_INFO_PATH = path.join(PROJECT_ROOT, 'release-info.json')
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/i

function readJson(filePath, { required = false } = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    if (!required && error.code === 'ENOENT') return null
    throw new Error(`无法读取版本信息 ${filePath}：${error.message}`)
  }
}

function normalizeStableVersion(value, source) {
  const version = semver.valid(String(value || '').trim())
  if (!version || semver.prerelease(version)) throw new Error(`${source} 必须是稳定语义版本号`)
  return version
}

function normalizeFullCommit(value, source, { required = false } = {}) {
  const commit = String(value || '').trim()
  if (!commit && !required) return null
  if (!FULL_COMMIT_PATTERN.test(commit)) throw new Error(`${source} 必须是完整的 40 位 Git 提交哈希`)
  return commit.toLowerCase()
}

function readGitCommit() {
  try {
    return normalizeFullCommit(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }), 'Git HEAD', { required: true })
  } catch {
    return null
  }
}

const packageMetadata = readJson(PACKAGE_PATH, { required: true })
const packageVersion = normalizeStableVersion(packageMetadata.version, '根 package.json 的 version')
const releaseMetadata = readJson(RELEASE_INFO_PATH)

let releaseCommit = null
if (releaseMetadata) {
  const releaseVersion = normalizeStableVersion(releaseMetadata.version, 'release-info.json 的 version')
  if (releaseVersion !== packageVersion) throw new Error('release-info.json 与根 package.json 的版本不一致')
  if (releaseMetadata.repository !== 'zifeng-chen/lenovo-store-operations') {
    throw new Error('release-info.json 的仓库标识无效')
  }
  releaseCommit = normalizeFullCommit(releaseMetadata.commit, 'release-info.json 的 commit', { required: true })
}

const environmentCommit = process.env.LENOVO_STORE_COMMIT_SHA
  ? normalizeFullCommit(process.env.LENOVO_STORE_COMMIT_SHA, 'LENOVO_STORE_COMMIT_SHA', { required: true })
  : null
const commit = releaseCommit || environmentCommit || readGitCommit()

export const runtimeInfo = Object.freeze({
  version: packageVersion,
  commit,
  shortCommit: commit?.slice(0, 7) || null,
  channel: 'stable',
})
