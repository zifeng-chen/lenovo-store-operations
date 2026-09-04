const billingDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function formatCalendarDate(date) {
  const parts = Object.fromEntries(
    billingDateFormatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function isValidCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function currentCalendarDate() {
  return formatCalendarDate(new Date())
}

export function normalizeAddedDate(value, createdAt, fallback = currentCalendarDate()) {
  if (isValidCalendarDate(value)) return value
  if (typeof createdAt !== 'string') return fallback

  const normalizedCreatedAt = createdAt.trim()
  if (isValidCalendarDate(normalizedCreatedAt)) return normalizedCreatedAt
  const utcTimestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalizedCreatedAt)
    ? `${normalizedCreatedAt.replace(' ', 'T')}Z`
    : normalizedCreatedAt
  const createdInstant = new Date(utcTimestamp)
  if (Number.isFinite(createdInstant.getTime())) return formatCalendarDate(createdInstant)

  const createdDate = normalizedCreatedAt.slice(0, 10)
  return isValidCalendarDate(createdDate) ? createdDate : fallback
}
