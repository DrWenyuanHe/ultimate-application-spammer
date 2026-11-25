// Posting identity, freshness and ranking. Pure functions: nothing here changes a saved record.

const TRACKING = /^(utm_.*|gh_src|lever-source(\[\])?|lever-origin|lever-via|trk|trackingid|tracking|mode|iis|iisn|sid|share|from|src|referrer|referer)$/i
// Some career sites key postings by ?ref= or ?source=. Drop these only when the value reads as a
// channel name (linkedin, indeed) rather than a job number.
const CHANNEL = /^(ref|source)$/i

/** Normalise a posting URL so tracking-link variants of the same posting compare equal. */
export function canonicalUrl(value) {
  if (!value) return ''
  let url
  try { url = new URL(String(value).trim()) } catch { return String(value).trim().toLowerCase() }
  // Hash-routed career sites (#/jobs/123) identify the posting in the fragment.
  if (!/^#!?\//.test(url.hash)) url.hash = ''
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  for (const [key, item] of [...url.searchParams]) if (TRACKING.test(key) || (CHANNEL.test(key) && !/\d/.test(item))) url.searchParams.delete(key)
  url.searchParams.sort()
  let out = url.toString()
  if (out.endsWith('/')) out = out.slice(0, -1)
  return out.replace(/\/\?/, '?')
}

/** Identity on a known job board, so links that differ only by host, locale or title still match. */
export function boardKey(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { return undefined }
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter(Boolean)
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host)) {
    const id = parts[1] === 'jobs' ? parts[2] : url.searchParams.get('gh_jid')
    if (parts[0] && /^\d+$/.test(id ?? '')) return `greenhouse:${parts[0].toLowerCase()}:${id}`
  }
  if (['jobs.lever.co', 'jobs.eu.lever.co', 'jobs.ashbyhq.com'].includes(host) && parts.length >= 2 && /^[a-f0-9-]{32,36}$/i.test(parts[1])) {
    return `${host === 'jobs.ashbyhq.com' ? 'ashby' : 'lever'}:${parts[0].toLowerCase()}:${parts[1].toLowerCase()}`
  }
  if (host === 'jobs.smartrecruiters.com' && parts.length >= 2) {
    const m = parts[1].match(/^(\d+)(?:-|$)/)
    if (m) return `smartrecruiters:${parts[0].toLowerCase()}:${m[1]}`
  }
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(host)) {
    const at = parts.indexOf('job')
    const m = parts.at(-1)?.match(/_([^_]+)$/)
    if (at > 0 && m) return `workday:${host.split('.')[0]}:${parts[at - 1].toLowerCase()}:${m[1].toLowerCase()}`
  }
  return undefined
}

const norm = (v) => String(v || '').trim().toLowerCase()

/** Every identity key of one posting: its link, its board number, and any confirmed alias links. */
export function postingKeys({ sourceUrl, url, aliases } = {}) {
  const keys = new Set()
  for (const link of [sourceUrl || url, ...(Array.isArray(aliases) ? aliases : [])]) {
    const c = canonicalUrl(link)
    if (c) keys.add(`url:${c}`)
    const b = boardKey(link)
    if (b) keys.add(`board:${b}`)
  }
  return keys
}

/** Same posting? A shared link or board number matches unless both name different requisitions. */
export function samePosting(a, b) {
  const ra = norm(a.requisition)
  const rb = norm(b.requisition)
  if (ra && rb && ra === rb && norm(a.company) && norm(a.company) === norm(b.company)) return true
  if (ra && rb && ra !== rb) return false
  const keys = postingKeys(a)
  return [...postingKeys(b)].some((k) => keys.has(k))
}

// ---------- freshness ----------
export const CHECK_EVERY_DAYS = 14
export const OLD_POSTING_DAYS = 30
const DAY = 86400000

/** Today's date on this computer, as YYYY-MM-DD. */
export function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** Timestamps count on the day they fall on this computer, so an evening check is never "tomorrow". */
function dayNumber(value) {
  const s = String(value || '')
  const day = /T\d/.test(s) && !Number.isNaN(Date.parse(s)) ? localToday(new Date(s)) : s.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined
  const t = Date.parse(`${day}T12:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === day ? Math.floor(t / DAY) : undefined
}

const age = (value, today) => {
  const now = dayNumber(today)
  const then = dayNumber(value)
  return now === undefined || then === undefined || then > now ? undefined : now - then
}

export const isPreApplication = (a) => !a.appliedAt && ['Review', 'Preparing', 'Ready'].includes(a.stage)

/** Worked out when read: time passing never changes a saved stage or check date. */
export function postingFreshness(a, today = localToday()) {
  const daysSinceCheck = age(a.lastChecked, today)
  const daysSincePosted = age(a.postedAt, today)
  const base = { daysSinceCheck, daysSincePosted, olderPosting: daysSincePosted !== undefined && daysSincePosted > OLD_POSTING_DAYS }
  const no = (status, label, reason) => ({ ...base, status, label, reason, canApply: false })
  const posting = norm(a.postingStatus)
  if (posting === 'closed') return no('closed', 'Posting closed', 'The employer confirmed the posting is closed.')
  const deadline = dayNumber(a.deadline)
  if (deadline !== undefined && deadline < dayNumber(today)) return no('expired', 'Deadline passed', 'The saved deadline has passed. Check for an extension.')
  if (!['open', 'active'].includes(posting)) return no('verify', 'Check posting', 'Confirm on the employer\'s page that the posting is open.')
  if (daysSinceCheck === undefined) return no('verify', 'Check posting', 'There is no date for the last check.')
  if (daysSinceCheck > CHECK_EVERY_DAYS) return no('verify', 'Recheck posting', `Last checked ${daysSinceCheck} days ago.`)
  return { ...base, status: 'current', label: 'Open', reason: base.olderPosting ? 'Open, but posted over 30 days ago.' : 'Checked in the last 14 days.', canApply: true }
}

// ---------- ranking ----------
export const TIERS = { A: 'Prioritize', B: 'Good option', C: 'Stretch', Hold: 'Check first' }
const TIER_ORDER = { A: 0, B: 1, C: 2, Hold: 3 }

/** Worth acting on now: not applied yet, not held, and open as of a recent check. */
export function isActionable(a, today = localToday()) {
  return isPreApplication(a) && a.recommendation?.tier !== 'Hold' && postingFreshness(a, today).canApply
}

export function compareByRank(a, b, today = localToday()) {
  const old = (x) => (isPreApplication(x) && postingFreshness(x, today).olderPosting ? 1 : 0)
  const l = a.recommendation
  const r = b.recommendation
  const name = `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`)
  if (l && r) return TIER_ORDER[l.tier] - TIER_ORDER[r.tier] || old(a) - old(b) || l.rank - r.rank || name
  if (l || r) return l ? -1 : 1
  return old(a) - old(b) || (a.priority ?? 3) - (b.priority ?? 3) || name
}
