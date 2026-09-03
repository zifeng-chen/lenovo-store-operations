import semver from 'semver'
import { runtimeInfo } from './runtime-info.js'

export const GITHUB_REPOSITORY = 'zifeng-chen/lenovo-store-operations'
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases`
const RELEASES_PER_PAGE = 100
const MAX_RELEASE_PAGES = 3
const RELEASE_URL_PREFIX = `https://github.com/${GITHUB_REPOSITORY}/releases/`
const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_RETRY_DELAY_MS = 60 * 1000
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_RELEASE_NOTES_CHARS = 8000

function serviceError(message, status = 502, code = 'UPDATE_CHECK_FAILED') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function stableVersionFromTag(tag) {
  const value = String(tag || '').trim()
  if (!STABLE_TAG_PATTERN.test(value)) return null
  const version = semver.valid(value.slice(1))
  return version && !semver.prerelease(version) ? version : null
}

function safeReleaseUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.href.startsWith(RELEASE_URL_PREFIX) ? url.href : null
  } catch {
    return null
  }
}

function normalizeRelease(release) {
  if (!release || release.draft || release.prerelease) return null
  const version = stableVersionFromTag(release.tag_name)
  if (!version) return null
  const publishedAt = typeof release.published_at === 'string' && !Number.isNaN(Date.parse(release.published_at))
    ? release.published_at
    : null
  return {
    version,
    tag: String(release.tag_name),
    name: String(release.name || release.tag_name).slice(0, 200),
    publishedAt,
    url: safeReleaseUrl(release.html_url),
    notes: String(release.body || '').slice(0, MAX_RELEASE_NOTES_CHARS),
  }
}

async function readLimitedText(response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw serviceError('GitHub 更新响应超过大小限制')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw serviceError('GitHub 更新响应超过大小限制')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

function retryDelayFromResponse(response, currentTime) {
  const retryAfterSeconds = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS)
  }
  const resetSeconds = Number(response.headers.get('x-ratelimit-reset'))
  if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
    return Math.min(Math.max(resetSeconds * 1000 - currentTime, DEFAULT_RETRY_DELAY_MS), MAX_RETRY_DELAY_MS)
  }
  return DEFAULT_RETRY_DELAY_MS
}

function githubError(response, currentTime) {
  if (response.status === 403 || response.status === 429) {
    const error = serviceError('GitHub 更新检查暂时受到访问频率限制，请稍后重试', 503, 'GITHUB_RATE_LIMITED')
    error.retryAfterMs = retryDelayFromResponse(response, currentTime)
    return error
  }
  if (response.status >= 500) {
    const error = serviceError('GitHub 更新服务暂时不可用，请稍后重试', 502, 'GITHUB_UNAVAILABLE')
    error.retryAfterMs = DEFAULT_RETRY_DELAY_MS
    return error
  }
  return serviceError(`GitHub 更新检查失败（HTTP ${response.status}）`, 502, 'GITHUB_REQUEST_FAILED')
}

export function createGithubReleaseService({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('更新检查服务缺少 fetch 实现')

  let etag = null
  let latestRelease = null
  let checkedAt = null
  let expiresAt = 0
  let nextRetryAt = 0
  let lastError = null
  let searchTruncated = false
  let inFlight = null

  function snapshot(extra = {}) {
    const checked = Boolean(checkedAt)
    return {
      repository: GITHUB_REPOSITORY,
      channel: runtimeInfo.channel,
      current: runtimeInfo,
      latestRelease,
      updateAvailable: latestRelease ? semver.gt(latestRelease.version, runtimeInfo.version) : (checked ? false : null),
      aheadOfLatest: latestRelease ? semver.gt(runtimeInfo.version, latestRelease.version) : false,
      checkedAt,
      stale: checked && now() >= expiresAt,
      nextRetryAt: nextRetryAt > now() ? new Date(nextRetryAt).toISOString() : null,
      searchTruncated,
      lastError,
      ...extra,
    }
  }

  function status() {
    return snapshot()
  }

  async function requestGithub() {
    const allReleases = []
    let firstPageEtag = null
    let resultTruncated = false

    for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
      const headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'lenovo-store-operations-update-checker',
      }
      if (page === 1 && etag && checkedAt) headers['If-None-Match'] = etag
      const url = `${RELEASES_URL}?per_page=${RELEASES_PER_PAGE}&page=${page}`

      let response
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        const requestError = error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? serviceError('连接 GitHub 超时，业务服务不受影响', 504, 'GITHUB_TIMEOUT')
          : serviceError('无法连接 GitHub，业务服务不受影响', 502, 'GITHUB_NETWORK_ERROR')
        requestError.retryAfterMs = DEFAULT_RETRY_DELAY_MS
        throw requestError
      }

      if (page === 1 && response.status === 304 && checkedAt) {
        checkedAt = new Date(now()).toISOString()
        expiresAt = now() + cacheTtlMs
        nextRetryAt = 0
        lastError = null
        return snapshot({ cache: 'revalidated' })
      }
      if (!response.ok) throw githubError(response, now())
      if (page === 1) firstPageEtag = response.headers.get('etag') || null

      const responseText = await readLimitedText(response)
      let pageReleases
      try {
        pageReleases = JSON.parse(responseText)
      } catch {
        throw serviceError('GitHub 返回了无效的更新信息')
      }
      if (!Array.isArray(pageReleases)) throw serviceError('GitHub 返回的 Release 列表格式无效')
      allReleases.push(...pageReleases)
      if (pageReleases.length < RELEASES_PER_PAGE) break
      if (page === MAX_RELEASE_PAGES) resultTruncated = true
    }

    const stableReleases = allReleases
      .map(normalizeRelease)
      .filter(Boolean)
      .sort((left, right) => semver.rcompare(left.version, right.version))

    latestRelease = stableReleases[0] || null
    searchTruncated = resultTruncated
    etag = firstPageEtag
    checkedAt = new Date(now()).toISOString()
    expiresAt = now() + cacheTtlMs
    nextRetryAt = 0
    lastError = null
    return snapshot({ cache: 'updated' })
  }

  async function check() {
    const currentTime = now()
    if (checkedAt && currentTime < expiresAt) return snapshot({ cache: 'fresh' })
    if (currentTime < nextRetryAt) {
      if (checkedAt) return snapshot({ stale: true, cache: 'retry-backoff' })
      throw serviceError('GitHub 更新检查正在等待重试，请稍后再试', 503, 'GITHUB_RETRY_BACKOFF')
    }
    if (inFlight) return inFlight

    inFlight = requestGithub().catch(error => {
      lastError = error.message
      expiresAt = 0
      const retryDelay = Math.min(Math.max(error.retryAfterMs || DEFAULT_RETRY_DELAY_MS, 1000), MAX_RETRY_DELAY_MS)
      nextRetryAt = now() + retryDelay
      if (checkedAt) return snapshot({ stale: true, cache: 'stale' })
      throw error
    }).finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return Object.freeze({ status, check })
}
