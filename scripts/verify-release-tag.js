import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(currentDir, '..')
const tag = String(process.env.GITHUB_REF_NAME || process.argv[2] || '').trim()
const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function fail(message) {
  console.error(`Release 校验失败：${message}`)
  process.exit(1)
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
}

if (!stableTagPattern.test(tag)) fail('tag 必须严格使用 vX.Y.Z 稳定语义版本格式')
const version = tag.slice(1)
const packageMetadata = readJson('package.json')
const lockMetadata = readJson('package-lock.json')

if (packageMetadata.version !== version) {
  fail(`tag ${tag} 与根 package.json 版本 ${packageMetadata.version} 不一致`)
}
if (lockMetadata.version !== version || lockMetadata.packages?.['']?.version !== version) {
  fail('package-lock.json 根版本与发布 tag 不一致')
}

if (process.env.GITHUB_ACTIONS === 'true') {
  const commit = String(process.env.GITHUB_SHA || '').trim()
  const defaultBranch = String(process.env.GITHUB_EVENT_REPOSITORY_DEFAULT_BRANCH || 'main').trim()
  if (!/^[0-9a-f]{40}$/i.test(commit)) fail('GITHUB_SHA 无效')
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, `origin/${defaultBranch}`], {
      cwd: projectRoot,
      stdio: 'ignore',
      timeout: 5000,
    })
  } catch {
    fail(`tag 对应提交不在默认分支 ${defaultBranch} 上`)
  }
}

const artifactName = `lenovo-store-operations-${tag}.tar.gz`
console.log(`Release 校验通过：${tag} -> ${artifactName}`)

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\nartifact_name=${artifactName}\n`)
}
