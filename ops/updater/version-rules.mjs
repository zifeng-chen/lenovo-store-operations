// 版本号规则：a.b.c，a 任意非负整数，b 与 c 各限 0-9，逢 9 进位。
// 与 semver 不同：0.10.4 / 0.0.10 都非法，0.9.9 的下一个是 1.0.0。

export const TAG_PATTERN = /^v(0|[1-9]\d*)\.(\d)\.(\d)$/

export function isVersionTag(tag) {
  return typeof tag === 'string' && TAG_PATTERN.test(tag)
}

export function parseVersionTag(tag) {
  const match = TAG_PATTERN.exec(tag)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareVersionTags(leftTag, rightTag) {
  const left = parseVersionTag(leftTag)
  const right = parseVersionTag(rightTag)
  if (!left || !right) return null
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

export function incrementVersionTag(tag) {
  const parts = parseVersionTag(tag)
  if (!parts) return null
  const [major, minor, patch] = parts
  if (patch < 9) return `v${major}.${minor}.${patch + 1}`
  if (minor < 9) return `v${major}.${minor + 1}.0`
  return `v${major + 1}.0.0`
}
