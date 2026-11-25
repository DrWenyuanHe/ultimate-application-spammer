// Application planning: pace, workload and a rough chance of reaching an offer goal. The rates are
// assumptions the person chose, not a forecast, and nothing here changes a saved record.
import { StoreError } from './db.mjs'
import { localToday } from './postings.mjs'

const DAY = 86400000
const bad = (message) => { throw new StoreError(400, message) }

function dayNumber(value, name) {
  const t = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== value) bad(`${name} must be a real date (YYYY-MM-DD)`)
  return t / DAY
}
const whole = (v, name) => (Number.isSafeInteger(v) && v >= 0 && v <= 1e6 ? v : bad(`${name} must be a whole number from 0 to 1,000,000`))
const rate = (v, name) => (Number.isFinite(v) && v >= 0 && v <= 1 ? v : bad(`${name} must be between 0 and 1`))

/** Chance of at least `needed` successes in `trials` independent tries (exact binomial tail, in logs). */
export function chanceOfAtLeast(trials, p, needed) {
  if (needed <= 0) return 1
  if (trials < needed || p === 0) return 0
  if (p === 1) return 1
  const logP = Math.log(p)
  const logQ = Math.log1p(-p)
  if (trials * p < needed) {
    let logChoose = 0
    for (let i = 1; i <= Math.min(needed, trials - needed); i++) logChoose += Math.log(trials - i + 1) - Math.log(i)
    let term = Math.exp(logChoose + needed * logP + (trials - needed) * logQ)
    let tail = term
    for (let k = needed; k < trials; k++) {
      term *= ((trials - k) / (k + 1)) * (p / (1 - p))
      tail += term
      if (term <= tail * Number.EPSILON) break
    }
    return Math.min(1, Math.max(0, tail))
  }
  let logTerm = trials * logQ
  let max = logTerm
  let sum = 1
  for (let k = 1; k < needed; k++) {
    logTerm += Math.log(trials - k + 1) - Math.log(k) + logP - logQ
    const next = Math.max(max, logTerm)
    sum = sum * Math.exp(max - next) + Math.exp(logTerm - next)
    max = next
  }
  return Math.max(0, -Math.expm1(Math.min(0, max + Math.log(sum))))
}

/** Fewest tries that reach the wanted chance, or null when no realistic number does. */
export function triesFor(needed, p, chance) {
  if (needed <= 0) return 0
  if (p === 0 || chance >= 1) return null
  if (p === 1) return needed
  let high = needed
  while (chanceOfAtLeast(high, p, needed) < chance) {
    high *= 2
    if (high > 1e6) return null
  }
  let low = needed
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (chanceOfAtLeast(mid, p, needed) >= chance) high = mid
    else low = mid + 1
  }
  return low
}

const round = (n, places = 4) => Number(n.toFixed(places))

export function projectPlan(goal, { submitted = 0, offers = 0, today = localToday() } = {}) {
  if (!goal || typeof goal !== 'object') bad('Save a search goal first: profile.set with fields.searchGoal { offers, applications, endDate }.')
  const wantOffers = whole(goal.offers, 'searchGoal.offers')
  const wantApps = whole(goal.applications, 'searchGoal.applications')
  const now = dayNumber(today, 'today')
  const first = goal.startDate ? Math.max(now, dayNumber(goal.startDate, 'searchGoal.startDate')) : now
  const last = dayNumber(goal.endDate, 'searchGoal.endDate')
  if (last - first > 3660) bad('searchGoal.endDate must be within ten years')
  const interviewRate = rate(goal.interviewRate ?? 0.03, 'searchGoal.interviewRate')
  const offerRate = rate(goal.interviewToOfferRate ?? 0.06, 'searchGoal.interviewToOfferRate')
  const minutes = goal.minutesPerApplication ?? 20
  if (!(Number.isFinite(minutes) && minutes > 0 && minutes <= 1440)) bad('searchGoal.minutesPerApplication must be more than 0 and at most 1440')
  for (const [k, max] of [['hoursPerWeek', 168], ['openingsPerWeek', 10000]]) {
    const v = goal[k]
    if (v !== undefined && v !== null && !(Number.isFinite(v) && v >= 0 && v <= max)) bad(`searchGoal.${k} must be between 0 and ${max}`)
  }
  let weekdays = 0
  for (let d = first; d <= last; d++) if (![0, 6].includes(new Date(d * DAY).getUTCDay())) weekdays++
  const left = Math.max(0, wantApps - submitted)
  const offersLeft = Math.max(0, wantOffers - offers)
  const limits = [goal.openingsPerWeek, Number.isFinite(goal.hoursPerWeek) ? (goal.hoursPerWeek * 60) / minutes : undefined].filter((v) => v !== undefined && v !== null)
  const achievable = weekdays ? Math.min(left, limits.length ? Math.floor((Math.min(...limits) * weekdays) / 5) : left) : 0
  const perWeek = weekdays ? (left / weekdays) * 5 : null
  const scenario = (label, i, o) => {
    const p = i * o
    return { label, interviewRate: round(i), interviewToOfferRate: round(o), expectedOffers: round(achievable * p, 2), chanceOfGoal: round(chanceOfAtLeast(achievable, p, offersLeft)), applicationsFor90Percent: triesFor(offersLeft, p, 0.9) }
  }
  return {
    today, applicationsLeft: left, offersLeft, weekdaysLeft: weekdays,
    perWeekday: weekdays ? Math.ceil(left / weekdays) : null, perWeek: perWeek === null ? null : round(perWeek, 1),
    hoursPerWeekNeeded: perWeek === null ? null : round((perWeek * minutes) / 60, 1),
    achievableApplications: achievable, limited: achievable < left,
    scenarios: [scenario('Lower rates', interviewRate * (2 / 3), offerRate * (5 / 6)), scenario('Planning rates', interviewRate, offerRate), scenario('Higher rates', Math.min(1, interviewRate * 1.2), Math.min(1, offerRate * 1.2))],
    note: 'The rates are assumptions, not a forecast. The model treats applications as independent and leaves out ones already sent.',
  }
}
