// Domain commands for applications, research, screening, employers, the career library,
// writing rules and submission records. Every write is versioned; nothing is deleted.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { openDatabase, RecordTable, StoreError } from './db.mjs'
import { APP_DIR, dataDir, dbPath, folder } from './paths.mjs'
import { safeName, uniquePath } from './archive.mjs'
import { boardKey, canonicalUrl, compareByRank, isActionable, localToday, postingFreshness, samePosting, TIERS } from './postings.mjs'
import { PUBLICATION_STATUSES, publicationReport } from './cv.mjs'
import { projectPlan } from './plan.mjs'
import { citedEvidence } from './bullets.mjs'
import { compactFact, rankEvidence } from './match.mjs'

export { StoreError, boardKey, canonicalUrl }

export const STAGES = ['Review', 'Preparing', 'Ready', 'Applied', 'Interview', 'Offer', 'Rejected', 'Withdrawn', 'Archived']
const STAGE_RANK = { Review: 0, Preparing: 1, Ready: 2, Applied: 3, Interview: 4, Offer: 5, Rejected: 6, Withdrawn: 6, Archived: 7 }
export const EVIDENCE_KINDS = ['experience', 'project', 'achievement', 'education', 'skill', 'publication', 'other']
/** provided: from the person's own documents or words, usable straight away. candidate-confirmed and
 *  source-verified are stronger. needs-review is the older name for provided. disputed (sources
 *  disagree) and outdated (replaced) stay in the library but out of documents. */
export const REVIEW_STATUSES = ['provided', 'candidate-confirmed', 'source-verified', 'needs-review', 'disputed', 'outdated']
export const SET_ASIDE = ['disputed', 'outdated']
export const isUsable = (e) => !SET_ASIDE.includes(e?.reviewStatus)
export const MATERIAL_KINDS = ['resume', 'cv', 'cover-letter', 'essay', 'answer', 'passage', 'other']
export const RULE_STATUSES = ['starter', 'proposed', 'approved', 'retired']
/** review-first: the agent fills the form and stops for the person to check; auto-submit: it submits
 *  when every question has a saved answer. Both stop on any question without a saved answer. */
export const SUBMISSION_MODES = ['review-first', 'auto-submit']
const STAR_KINDS = ['experience', 'project', 'achievement']
const LEASE_MINUTES = 30

export function detectPlatform(url) {
  const u = String(url || '').toLowerCase()
  const known = [
    ['myworkdayjobs.com', 'Workday'], ['workday', 'Workday'], ['greenhouse.io', 'Greenhouse'], ['lever.co', 'Lever'],
    ['ashbyhq.com', 'Ashby'], ['smartrecruiters.com', 'SmartRecruiters'], ['icims.com', 'iCIMS'], ['taleo.net', 'Taleo'],
    ['successfactors', 'SuccessFactors'], ['jobvite.com', 'Jobvite'], ['bamboohr.com', 'BambooHR'], ['workable.com', 'Workable'],
    ['oraclecloud.com', 'Oracle Recruiting'], ['peoplesoft', 'PeopleSoft'], ['ultipro', 'UKG'], ['ukg', 'UKG'],
    ['jobbank.gc.ca', 'Job Bank'], ['linkedin.com', 'LinkedIn'], ['indeed.', 'Indeed'],
  ]
  return known.find(([needle]) => u.includes(needle))?.[1] || (u ? 'Company site' : '')
}

const text = (v, max = 20000) => (v === undefined || v === null ? undefined : String(v).trim().slice(0, max))
const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || ''))
const isoDate = (v) => !Number.isNaN(Date.parse(v))
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v
const strings = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : undefined)
const countWords = (v) => (String(v || '').match(/\S+/g) || []).length
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function need(condition, message, status = 400) {
  if (!condition) throw new StoreError(status, message)
}

function slug(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || randomUUID()
}

function applicationFields(input, { partial = false } = {}) {
  const out = {}
  const fields = ['company', 'title', 'location', 'workModel', 'discipline', 'sourceUrl', 'requisition', 'postingStatus', 'stage',
    'whyFit', 'gaps', 'nextAction', 'followUpOn', 'deadline', 'notes', 'appliedAt', 'lastChecked', 'postingCheckNote', 'employerId', 'source', 'salary', 'employmentType', 'interviewAt', 'postedAt', 'dutySplit', 'postingText']
  for (const f of fields) if (input[f] !== undefined) out[f] = text(input[f])
  if (input.aliases !== undefined) {
    out.aliases = strings(input.aliases) || []
    need(out.aliases.every(isUrl), 'aliases must be links to the same posting')
  }
  if (out.postedAt) need(isDay(out.postedAt), 'postedAt must be the date the employer shows (YYYY-MM-DD)')
  if (input.qualificationMap !== undefined) out.qualificationMap = qualificationMap(input.qualificationMap)
  if (input.recommendation !== undefined) out.recommendation = input.recommendation === null ? null : recommendation(input.recommendation)
  if (input.priority !== undefined) {
    const p = Number(input.priority)
    need(Number.isInteger(p) && p >= 1 && p <= 5, 'priority must be a whole number from 1 (high) to 5 (low)')
    out.priority = p
  }
  if (!partial) {
    need(out.company, 'company is required')
    need(out.title, 'title is required')
  }
  if (out.stage !== undefined) need(STAGES.includes(out.stage), `stage must be one of: ${STAGES.join(', ')}`)
  if (out.sourceUrl) need(isUrl(out.sourceUrl), 'sourceUrl must be a web address starting with http:// or https://')
  if (out.sourceUrl !== undefined) out.canonicalUrl = canonicalUrl(out.sourceUrl)
  return out
}

/** Posting requirements matched to evidence: [{ qualification, status, evidence[], required, note }]. */
function qualificationMap(value) {
  need(Array.isArray(value), 'qualificationMap must be a list')
  return value.map((q, i) => {
    need(q && text(q.qualification), `qualificationMap ${i + 1}: qualification is required`)
    const status = text(q.status) || (strings(q.evidence)?.length ? 'met' : 'gap')
    need(['met', 'partial', 'gap'].includes(status), `qualificationMap ${i + 1}: status must be met, partial or gap`)
    return { qualification: text(q.qualification), status, required: q.required === undefined ? undefined : Boolean(q.required), evidence: strings(q.evidence) || [], note: text(q.note) }
  })
}

function recommendation(value) {
  need(value && typeof value === 'object' && Object.hasOwn(TIERS, value.tier), `recommendation.tier must be one of: ${Object.keys(TIERS).join(', ')}`)
  const rank = Number(value.rank ?? 100)
  need(Number.isInteger(rank) && rank >= 1 && rank <= 100000, 'recommendation.rank must be a whole number from 1')
  need(text(value.reason), 'recommendation.reason says why, naming the evidence or the missing requirement')
  const assessedAt = text(value.assessedAt) || localToday()
  need(isDay(assessedAt) && assessedAt <= localToday(), 'recommendation.assessedAt must be today or earlier (YYYY-MM-DD)')
  return { tier: value.tier, rank, reason: text(value.reason, 3000), assessedAt }
}

export class Store {
  constructor(file = dbPath(), { allowNew = false } = {}) {
    this.file = file
    if (!allowNew && file !== ':memory:' && !fs.existsSync(file)) {
      const backups = path.join(path.dirname(file), 'backups')
      if (fs.existsSync(backups) && fs.readdirSync(backups).some((f) => f.endsWith('.sqlite'))) {
        throw new StoreError(409, `The database ${file} is missing but backups exist. Ask your assistant to restore one (operations backup.list, then backup.restore) instead of starting over.`)
      }
    }
    this.db = openDatabase(file)
    this.t = new RecordTable(this.db)
  }

  close() { this.db.close() }
  revision() { return this.t.revision() }
  history(kind, id) { return this.t.versions(kind, id) }

  // ---------- profile ----------
  profile() { return this.t.get('profile', 'me') }

  setProfile(input, { actor = 'user', expectedVersion } = {}) {
    const allowed = ['name', 'preferredName', 'email', 'phone', 'city', 'links', 'headline', 'disciplines', 'locations', 'workModels', 'searchNotes', 'employmentPreferences', 'submissionMode', 'searchGoal', 'publicationName']
    const data = Object.fromEntries(Object.entries(input || {}).filter(([k]) => allowed.includes(k)))
    if (data.submissionMode !== undefined) need(SUBMISSION_MODES.includes(data.submissionMode), `submissionMode must be one of: ${SUBMISSION_MODES.join(', ')}`)
    return this.t.get('profile', 'me')
      ? this.t.update('profile', 'me', (cur) => ({ ...cur, ...data }), { actor, expectedVersion })
      : this.t.create('profile', data, { id: 'me', actor })
  }

  // ---------- applications ----------
  applications({ stage, q } = {}) {
    let rows = this.t.list('application')
    if (stage) rows = rows.filter((a) => a.stage === stage)
    if (q) {
      const needle = String(q).toLowerCase()
      rows = rows.filter((a) => [a.company, a.title, a.location, a.notes, a.discipline].some((v) => String(v || '').toLowerCase().includes(needle)))
    }
    return rows.sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  application(id) {
    const app = this.t.get('application', id)
    need(app, `No application ${id}`, 404)
    return app
  }

  findApplication(posting, { excludeId } = {}) {
    if (!posting?.sourceUrl && !posting?.url && !posting?.requisition) return undefined
    return this.t.list('application').find((a) => a.id !== excludeId && samePosting(a, posting))
  }

  /** Rank several jobs at once; all succeed or none do. Only the recommendation changes. */
  rankApplications(items, { actor = 'user' } = {}) {
    need(Array.isArray(items) && items.length, 'Provide a list of { id, tier, rank, reason } items')
    need(new Set(items.map((i) => i.id)).size === items.length, 'Each job can be ranked once per call')
    return this.t.transaction(() => items.map(({ id, expectedVersion, ...rec }) => {
      this.application(id)
      const a = this.t.update('application', id, (cur) => ({ ...cur, recommendation: recommendation(rec) }), { expectedVersion, actor, type: 'ranked' })
      return { id: a.id, company: a.company, title: a.title, version: a.version, recommendation: a.recommendation }
    }))
  }

  /** Jobs worth acting on now, best first, plus the ones that need a check before anything else. */
  shortlist({ today = localToday() } = {}) {
    const view = (a) => ({ id: a.id, version: a.version, company: a.company, title: a.title, stage: a.stage, location: a.location, sourceUrl: a.sourceUrl, deadline: a.deadline, recommendation: a.recommendation, nextAction: a.nextAction, freshness: postingFreshness(a, today) })
    const open = this.applications().filter((a) => !a.appliedAt && ['Review', 'Preparing', 'Ready'].includes(a.stage)).sort((a, b) => compareByRank(a, b, today))
    const now = open.filter((a) => isActionable(a, today))
    const check = open.filter((a) => { const f = postingFreshness(a, today); return f.status === 'verify' || (f.canApply && a.recommendation?.tier === 'Hold') })
    return { today, applyNow: now.map(view), checkFirst: check.map(view), closedOrExpired: open.filter((a) => ['closed', 'expired'].includes(postingFreshness(a, today).status)).map(view) }
  }

  evidenceByIds(ids) {
    need(Array.isArray(ids) && ids.length, 'ids must be a list of evidence ids')
    return ids.map((id) => { const e = this.t.get('evidence', id); need(e, `No career-library record ${id}`, 404); return e })
  }

  searchPlan({ today } = {}) {
    const apps = this.applications()
    return projectPlan(this.profile()?.searchGoal, { today, submitted: apps.filter((a) => a.appliedAt || ['Applied', 'Interview', 'Offer', 'Rejected'].includes(a.stage)).length, offers: apps.filter((a) => a.stage === 'Offer').length })
  }

  addApplication(input, { actor = 'user' } = {}) {
    const data = applicationFields(input)
    return this.t.transaction(() => {
      const existing = this.findApplication(data)
      if (existing) throw new StoreError(409, `This posting is already saved: ${existing.company} — ${existing.title}`, { existingId: existing.id })
      return this.t.create('application', { stage: 'Review', priority: 2, postingStatus: 'unknown', ...data }, { actor })
    })
  }

  updateApplication(id, patch, { expectedVersion, actor = 'user' } = {}) {
    const data = applicationFields(patch, { partial: true })
    return this.t.transaction(() => {
      const current = this.application(id)
      const merged = { ...current, ...data }
      if (data.canonicalUrl !== undefined || data.requisition !== undefined || data.company !== undefined || data.aliases !== undefined) {
        const other = this.findApplication(merged, { excludeId: id })
        need(!other, `Another saved application already uses that posting (${other?.company} — ${other?.title}, ${other?.id})`, 409)
      }
      return this.t.update('application', id, (cur) => ({ ...cur, ...data }), { expectedVersion, actor })
    })
  }

  /** Apply the same patch to several applications atomically. */
  bulkUpdate(items, { actor = 'user' } = {}) {
    need(Array.isArray(items) && items.length, 'Provide a list of { id, patch, expectedVersion } items')
    return this.t.transaction(() => items.map((item) => this.updateApplication(item.id, item.patch || {}, { expectedVersion: item.expectedVersion, actor })))
  }

  // ---------- research queue ----------
  researchTasks() { return this.t.list('research_task') }

  queueResearch(input, { actor = 'user' } = {}) {
    need(text(input.query) || text(input.title), 'Describe the search with a title or query')
    return this.t.create('research_task', {
      title: text(input.title) || text(input.query), query: text(input.query) || text(input.title), location: text(input.location) || '',
      notes: text(input.notes) || '', status: 'queued', resultCount: 0,
    }, { actor })
  }

  claimResearch({ worker = 'agent', taskId } = {}) {
    return this.t.transaction(() => {
      const now = Date.now()
      const open = this.researchTasks().filter((t) => t.status === 'queued' || (t.status === 'claimed' && Date.parse(t.leaseUntil) < now))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      const task = taskId ? open.find((t) => t.id === taskId) : open[0]
      if (!task) return null
      const claimToken = randomBytes(12).toString('hex')
      const leaseUntil = new Date(now + LEASE_MINUTES * 60000).toISOString()
      const claimed = this.t.update('research_task', task.id, (cur) => ({ ...cur, status: 'claimed', claimedBy: text(worker), claimToken, leaseUntil }), { actor: worker, type: 'claimed' })
      return { task: claimed, claimToken, leaseUntil }
    })
  }

  /**
   * Finish a claimed task. Findings must cite an employer posting and the time it was checked.
   * Existing applications keep their stage and notes; only posting evidence is refreshed.
   */
  completeResearch({ taskId, claimToken, summary, findings = [] }, { actor = 'agent' } = {}) {
    need(Array.isArray(findings), 'findings must be a list')
    findings.forEach((f, i) => {
      need(f && text(f.company) && text(f.title), `finding ${i + 1}: company and title are required`)
      need(isUrl(f.sourceUrl), `finding ${i + 1}: sourceUrl must be the employer's posting link`)
      need(f.checkedAt && isoDate(f.checkedAt), `finding ${i + 1}: checkedAt (when the posting was opened) is required`)
    })
    return this.t.transaction(() => {
      const task = this.t.get('research_task', taskId)
      need(task, `No research task ${taskId}`, 404)
      need(task.status === 'claimed' && task.claimToken === claimToken, 'This claim is not active. Claim the task again before completing it.', 409)
      need(Date.parse(task.leaseUntil) > Date.now(), 'This claim expired (claims last 30 minutes). Claim the task again and re-check the postings.', 409)
      const results = findings.map((f) => {
        const existing = this.findApplication(f)
        if (existing?.lastChecked && Date.parse(existing.lastChecked) > Date.parse(f.checkedAt)) return { action: 'kept-newer-check', application: existing }
        const evidence = {
          postingStatus: text(f.postingStatus) || 'open', lastChecked: text(f.checkedAt), postingCheckNote: text(f.note), deadline: text(f.deadline), postedAt: text(f.postedAt),
          recommendation: f.recommendation ? recommendation(f.recommendation) : undefined,
        }
        if (existing) {
          return { action: 'refreshed', application: this.t.update('application', existing.id, (cur) => ({ ...cur, ...Object.fromEntries(Object.entries(evidence).filter(([, v]) => v !== undefined)) }), { actor, type: 'research-refresh' }) }
        }
        const data = applicationFields({ ...f, stage: 'Review', source: 'research', ...Object.fromEntries(Object.entries(evidence).filter(([, v]) => v !== undefined)) })
        return { action: 'added', application: this.t.create('application', { priority: 2, ...data }, { actor, type: 'research-finding' }) }
      })
      const done = this.t.update('research_task', taskId, (cur) => {
        const { claimToken: _token, ...rest } = cur
        return { ...rest, status: 'completed', summary: text(summary) || '', resultCount: results.length, completedAt: new Date().toISOString() }
      }, { actor, type: 'completed' })
      return { task: done, results: results.map((r) => ({ action: r.action, id: r.application.id, company: r.application.company, title: r.application.title })) }
    })
  }

  /** Put a claimed search back with the reason it could not be finished. */
  failResearch({ taskId, claimToken, reason }, { actor = 'agent' } = {}) {
    need(text(reason), 'Say why the search could not be finished')
    return this.t.transaction(() => {
      const task = this.t.get('research_task', taskId)
      need(task, `No research task ${taskId}`, 404)
      need(task.status === 'claimed' && task.claimToken === claimToken, 'This claim is not active.', 409)
      return this.t.update('research_task', taskId, (cur) => {
        const { claimToken: _t, leaseUntil: _l, claimedBy: _c, ...rest } = cur
        return { ...rest, status: 'queued', lastProblem: text(reason) }
      }, { actor, type: 'failed' })
    })
  }

  // ---------- screening ----------
  screeningDecisions() { return this.t.list('screening_decision') }

  /** The decision in force for a posting, matching tracking links, board numbers and aliases. */
  #decisionFor(posting, decisions) {
    return decisions.find((d) => !d.superseded && samePosting(d, posting))
  }

  /** May this decided posting be screened again without a special reason? */
  #recheckDue(d, today = localToday()) {
    if (d.reopenedAt) return `Reopened: ${d.reopenReason}`
    if (d.decision === 'hold' && d.recheckAfter && d.recheckAfter <= today) return `Hold recheck date reached (${d.recheckAfter})`
    return null
  }

  screeningPreflight({ candidates, criteriaVersion, today = localToday() }) {
    need(Array.isArray(candidates), 'candidates must be a list')
    need(text(criteriaVersion), 'criteriaVersion is required so later rechecks can tell which rules were used')
    const decisions = this.screeningDecisions()
    const seen = []
    const report = candidates.map((c, index) => {
      const sourceUrl = c.sourceUrl || c.url
      const posting = { company: c.company, title: c.title, sourceUrl, requisition: c.requisition, aliases: c.aliases }
      const base = { index, company: c.company, title: c.title, sourceUrl, requisition: c.requisition, key: canonicalUrl(sourceUrl) }
      if (!base.key) return { ...base, status: 'invalid', reason: 'Missing posting link' }
      if (seen.some((s) => samePosting(s, posting))) return { ...base, status: 'duplicate-in-batch' }
      seen.push(posting)
      const app = this.findApplication(posting)
      if (app) return { ...base, status: 'existing-application', applicationId: app.id, stage: app.stage }
      const prior = this.#decisionFor(posting, decisions)
      if (!prior) return { ...base, status: 'eligible' }
      const previous = { decision: prior.decision, decisionId: prior.id, criteriaVersion: prior.criteriaVersion, criteriaChanged: prior.criteriaVersion !== criteriaVersion, reason: prior.reason }
      const due = this.#recheckDue(prior, today)
      return due ? { ...base, status: 'eligible', recheck: due, previous } : { ...base, status: 'already-decided', ...previous, recheckAfter: prior.recheckAfter }
    })
    const counts = report.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] || 0) + 1 }), {})
    return { criteriaVersion, checkedAt: new Date().toISOString(), counts, eligible: report.filter((r) => r.status === 'eligible'), report }
  }

  /** Make a finished decision eligible again, keeping the earlier decision in the history. */
  reopenScreening({ id, reason, expectedVersion }, { actor = 'agent' } = {}) {
    need(text(reason), 'Say why the decision is being reopened')
    const d = this.t.get('screening_decision', id)
    need(d, `No screening decision ${id}`, 404)
    need(!d.superseded, 'A newer decision replaced this one; reopen that instead', 409)
    return this.t.update('screening_decision', id, (cur) => ({ ...cur, reopenedAt: new Date().toISOString(), reopenReason: text(reason) }), { expectedVersion, actor, type: 'reopened' })
  }

  recordScreening({ decisions, criteriaVersion }, { actor = 'agent' } = {}) {
    need(Array.isArray(decisions) && decisions.length, 'Provide at least one decision')
    decisions.forEach((d, i) => {
      need(['shortlist', 'reject', 'hold'].includes(d.decision), `decision ${i + 1}: decision must be shortlist, reject or hold`)
      need(text(d.company) && text(d.title), `decision ${i + 1}: company and title are required`)
      need(isUrl(d.sourceUrl), `decision ${i + 1}: sourceUrl must be the employer's posting link`)
      need(text(d.reason), `decision ${i + 1}: give the reason for the decision`)
      need(Array.isArray(d.evidence) && d.evidence.length && d.evidence.every((e) => isUrl(e.url) && isoDate(e.checkedAt)),
        `decision ${i + 1}: evidence needs at least one { url, checkedAt } from the employer`)
      if (d.recheckAfter !== undefined) need(d.decision === 'hold' && isDay(d.recheckAfter), `decision ${i + 1}: recheckAfter is a date (YYYY-MM-DD) for holds`)
    })
    return this.t.transaction(() => decisions.map((d) => {
      const key = canonicalUrl(d.sourceUrl)
      const prior = this.#decisionFor(d, this.screeningDecisions())
      if (prior) {
        need(text(d.recheckReason) || this.#recheckDue(prior), `${d.company} — ${d.title} was already decided (${prior.decision}). Add recheckReason to record a deliberate recheck.`, 409)
        this.t.update('screening_decision', prior.id, (cur) => ({ ...cur, superseded: true }), { actor, type: 'superseded' })
      }
      const record = this.t.create('screening_decision', {
        key, company: text(d.company), title: text(d.title), sourceUrl: text(d.sourceUrl), requisition: text(d.requisition),
        decision: d.decision, reason: text(d.reason), evidence: d.evidence, criteriaVersion: text(d.criteriaVersion || criteriaVersion),
        recheckReason: text(d.recheckReason) || (prior ? this.#recheckDue(prior) : undefined) || undefined, previousDecisionId: prior?.id, recheckAfter: text(d.recheckAfter), aliases: strings(d.aliases),
      }, { actor, type: 'screened' })
      let applicationId
      if (d.decision === 'shortlist' && d.createApplication !== false) {
        const existing = this.findApplication(d)
        applicationId = existing?.id || this.t.create('application', {
          priority: 2, ...applicationFields({ ...d, stage: 'Review', source: 'screening', whyFit: d.whyFit || d.reason, lastChecked: d.evidence[0].checkedAt, postingStatus: d.postingStatus || 'open' }),
        }, { actor, type: 'shortlisted' }).id
      }
      return { id: record.id, decision: record.decision, company: record.company, title: record.title, applicationId }
    }))
  }

  // ---------- employers ----------
  employers({ sector, q } = {}) {
    let rows = this.t.list('employer').sort((a, b) => a.name.localeCompare(b.name))
    if (sector) rows = rows.filter((e) => e.sector === sector)
    if (q) rows = rows.filter((e) => `${e.name} ${e.sector} ${e.notes || ''}`.toLowerCase().includes(String(q).toLowerCase()))
    return rows
  }

  addEmployer(input, { actor = 'user' } = {}) {
    need(text(input.name), 'name is required')
    for (const f of ['website', 'careersUrl']) if (input[f]) need(isUrl(input[f]), `${f} must start with http:// or https://`)
    const id = slug(input.name)
    need(!this.t.get('employer', id), `${input.name} is already in the employer list`, 409)
    return this.t.create('employer', {
      name: text(input.name), sector: text(input.sector) || 'Other', website: text(input.website), careersUrl: text(input.careersUrl),
      platform: text(input.platform) || detectPlatform(input.careersUrl), locations: text(input.locations), notes: text(input.notes),
      priority: input.priority ? Number(input.priority) : 3, board: input.board,
    }, { id, actor })
  }

  updateEmployer(id, patch, { expectedVersion, actor = 'user' } = {}) {
    const allowed = ['sector', 'website', 'careersUrl', 'platform', 'locations', 'notes', 'priority', 'board']
    const data = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)))
    return this.t.update('employer', id, (cur) => ({ ...cur, ...data }), { expectedVersion, actor })
  }

  /** Copy employers from the bundled sector guide into this workspace (optional, user-chosen). */
  importEmployerGuide({ sectors } = {}, { actor = 'user' } = {}) {
    const guide = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'guides', 'employers-by-sector.json'), 'utf8'))
    const wanted = sectors?.length ? new Set(sectors.map((s) => s.toLowerCase())) : null
    return this.t.transaction(() => {
      let added = 0, skipped = 0
      for (const group of guide.sectors) {
        if (wanted && !wanted.has(group.sector.toLowerCase()) && !wanted.has(group.id)) continue
        for (const e of group.employers) {
          if (this.t.get('employer', slug(e.name))) { skipped++; continue }
          this.addEmployer({ ...e, sector: group.sector, notes: e.notes }, { actor })
          added++
        }
      }
      return { added, skipped }
    })
  }

  // ---------- career library ----------
  evidence({ kind, q } = {}) {
    let rows = this.t.list('evidence')
    if (kind) rows = rows.filter((e) => e.kind === kind)
    if (q) rows = rows.filter((e) => `${e.title} ${e.organization || ''} ${e.content || ''} ${(e.skills || []).join(' ')}`.toLowerCase().includes(String(q).toLowerCase()))
    return rows
  }

  addEvidence(input, { actor = 'user' } = {}) {
    return this.t.create('evidence', this.#evidenceFields(input), { actor })
  }

  updateEvidence(id, patch, { expectedVersion, actor = 'user' } = {}) {
    return this.t.update('evidence', id, (cur) => this.#evidenceFields({ ...cur, ...patch }), { expectedVersion, actor })
  }

  #evidenceFields(input) {
    need(EVIDENCE_KINDS.includes(input.kind), `kind must be one of: ${EVIDENCE_KINDS.join(', ')}`)
    need(text(input.title), 'title is required')
    const reviewStatus = input.reviewStatus || 'provided'
    need(REVIEW_STATUSES.includes(reviewStatus), `reviewStatus must be one of: ${REVIEW_STATUSES.join(', ')}`)
    const star = input.star && typeof input.star === 'object'
      ? Object.fromEntries(['situation', 'task', 'action', 'result'].map((k) => [k, text(input.star[k])]).filter(([, v]) => v))
      : undefined
    const metrics = Array.isArray(input.metrics) ? input.metrics.map((m, i) => {
      need(m && text(m.value), `metric ${i + 1}: value is required`)
      return { value: text(m.value), unit: text(m.unit), period: text(m.period), baseline: text(m.baseline), source: text(m.source), note: text(m.note), doubt: text(m.doubt) }
    }) : undefined
    const sources = Array.isArray(input.sources) ? input.sources.map((s) => ({ label: text(s.label), locator: text(s.locator), documentId: text(s.documentId) })) : undefined
    return {
      kind: input.kind, title: text(input.title), organization: text(input.organization), period: text(input.period), content: text(input.content),
      skills: Array.isArray(input.skills) ? input.skills.map(String) : undefined, parentId: text(input.parentId), source: text(input.source), reviewStatus,
      star, metrics, sources, gapsNoted: Array.isArray(input.gapsNoted) ? input.gapsNoted.map(String) : undefined,
      bullets: bulletBank(input.bullets), publication: publicationFields(input.publication),
    }
  }

  /** Keep good bullet wording with the fact it describes, for reuse. Repeats are ignored. */
  saveBullets(items, { actor = 'user' } = {}) {
    need(Array.isArray(items) && items.length, 'Provide a list of { evidenceId, text } items')
    return this.t.transaction(() => items.map((item, i) => {
      need(text(item.text), `item ${i + 1}: text is required`)
      const cur = this.t.get('evidence', item.evidenceId)
      need(cur, `item ${i + 1}: no evidence ${item.evidenceId}`, 404)
      if ((cur.bullets || []).some((b) => b.text === text(item.text))) return { evidenceId: cur.id, version: cur.version, added: false }
      const next = this.t.update('evidence', cur.id, (e) => ({ ...e, bullets: [...(e.bullets || []), ...bulletBank([{ ...item, savedAt: new Date().toISOString() }])] }), { actor, type: 'bullet-saved' })
      return { evidenceId: next.id, version: next.version, added: true }
    }))
  }

  bullets({ q, evidenceId, narrative } = {}) {
    const needle = String(q || '').toLowerCase()
    return this.evidence().filter((e) => isUsable(e) && (!evidenceId || e.id === evidenceId)).flatMap((e) => (e.bullets || [])
      .filter((b) => (!needle || `${b.text} ${e.title}`.toLowerCase().includes(needle)) && (!narrative || !b.narratives?.length || b.narratives.includes(narrative)))
      .map((b) => ({ ...b, evidenceId: e.id, title: e.title, organization: e.organization })))
  }

  publications() { return publicationReport(this.evidence()) }

  // ---------- narratives ----------
  /** Reusable resume angles (for example research, operations): what to lead with and in what order. */
  narratives() { return this.t.list('narrative').sort((a, b) => a.label.localeCompare(b.label)) }

  saveNarrative(input, { id, expectedVersion, actor = 'user' } = {}) {
    const cur = id ? this.t.get('narrative', id) : undefined
    need(!id || cur, `No narrative ${id}`, 404)
    const merged = { ...cur, ...input }
    need(text(merged.label), 'label is required')
    const order = (Array.isArray(merged.experience) ? merged.experience : []).map((e, i) => {
      const item = typeof e === 'string' ? { evidenceId: e } : e
      need(this.t.get('evidence', item?.evidenceId), `experience ${i + 1}: no evidence ${item?.evidenceId}`, 404)
      for (const a of strings(item.achievements) || []) need(this.t.get('evidence', a), `experience ${i + 1}: no evidence ${a}`, 404)
      return { evidenceId: item.evidenceId, achievements: strings(item.achievements) }
    })
    const data = { label: text(merged.label), headline: text(merged.headline), summary: text(merged.summary), capabilities: strings(merged.capabilities), disciplines: strings(merged.disciplines), experience: order }
    return cur ? this.t.update('narrative', id, () => data, { expectedVersion, actor }) : this.t.create('narrative', data, { id: slug(data.label), actor })
  }

  /** How complete each experience/project/achievement is as a STAR story with evidence. */
  experienceStrength() {
    const rows = this.evidence().filter((e) => STAR_KINDS.includes(e.kind)).map((e) => ({ id: e.id, version: e.version, kind: e.kind, title: e.title, organization: e.organization, period: e.period, reviewStatus: e.reviewStatus, ...starScore(e) }))
    rows.sort((a, b) => a.score - b.score || String(a.title).localeCompare(String(b.title)))
    const average = rows.length ? Math.round(rows.reduce((n, r) => n + r.score, 0) / rows.length) : 0
    return { average, complete: rows.filter((r) => r.score === 100).length, total: rows.length, items: rows }
  }

  // ---------- screening answers (onboarding) ----------
  /** The question bank merged with the person's saved answers. Stays on this computer. */
  screeningAnswers() {
    const bank = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'templates', 'screening-questions.json'), 'utf8')).questions
    const saved = this.t.get('screening_answers', 'me')
    const answers = saved?.answers || {}
    const custom = saved?.custom || []
    const questions = bank.map((q) => ({ ...q, answer: answers[q.id]?.answer ?? (q.voluntary ? q.default : undefined), answeredAt: answers[q.id]?.at, usingDefault: answers[q.id] === undefined && Boolean(q.voluntary) }))
    const blank = (a) => a === undefined || a === null || (typeof a === 'string' && !a.trim()) || (Array.isArray(a) && !a.length)
    const missingRequired = questions.filter((q) => q.required && blank(q.answer)).map((q) => q.id)
    return { version: saved?.version || 0, questions, custom, missingRequired, complete: missingRequired.length === 0 }
  }

  /** Save answers: { answers: { questionId: value }, custom: [{ question, answer }] } (custom = extra questions met on real forms). */
  setScreeningAnswers({ answers = {}, custom = [] }, { expectedVersion, actor = 'user' } = {}) {
    const bank = new Set(JSON.parse(fs.readFileSync(path.join(APP_DIR, 'templates', 'screening-questions.json'), 'utf8')).questions.map((q) => q.id))
    for (const id of Object.keys(answers)) need(bank.has(id), `Unknown question id ${id}; put form-specific questions in "custom"`)
    custom.forEach((c, i) => need(text(c.question) && c.answer !== undefined, `custom answer ${i + 1} needs question and answer`))
    const at = new Date().toISOString()
    const merge = (cur = {}) => {
      const next = { ...(cur.answers || {}) }
      for (const [id, value] of Object.entries(answers)) next[id] = { answer: Array.isArray(value) ? value.map(String) : text(value), at }
      const keyOf = (c) => `${String(c.employer || '').toLowerCase()}\u0000${c.question.toLowerCase()}`
      const byQuestion = new Map((cur.custom || []).map((c) => [keyOf(c), c]))
      for (const c of custom) {
        const entry = { question: text(c.question), answer: Array.isArray(c.answer) ? c.answer.map(String) : text(c.answer), at, employer: text(c.employer) }
        byQuestion.set(keyOf(entry), entry)
      }
      return { answers: next, custom: [...byQuestion.values()] }
    }
    return this.t.get('screening_answers', 'me')
      ? this.t.update('screening_answers', 'me', (cur) => merge(cur), { expectedVersion, actor })
      : this.t.create('screening_answers', merge(), { id: 'me', actor })
  }

  materials({ kind } = {}) {
    const current = new Map(this.evidence().map((e) => [e.id, e]))
    return this.t.list('material').filter((m) => !kind || m.kind === kind).map(({ content, ...m }) => ({ ...m, excerpt: String(content || '').slice(0, 240), evidenceChanged: this.#changedEvidence(m.evidenceRefs, current).length > 0 }))
  }

  /** References whose fact changed, was set aside or no longer exists. Older plain-id references are not pinned. */
  #changedEvidence(refs, current) {
    return (refs || []).flatMap((r) => {
      const id = typeof r === 'string' ? r : r.id
      const e = current.get(id)
      if (e && isUsable(e) && (typeof r === 'string' || e.version === r.version)) return []
      const pinned = e && isUsable(e) ? this.t.version('evidence', id, r.version) : undefined
      if (pinned && factOf(pinned) === factOf(e)) return []
      return [{ id, title: e?.title, was: typeof r === 'string' ? undefined : r.version, now: e?.version, reviewStatus: e?.reviewStatus }]
    })
  }

  /** Pin references to exact evidence versions. Accepts ids or { id, version }. */
  #pinEvidence(refs) {
    if (refs === undefined) return undefined
    need(Array.isArray(refs), 'evidenceRefs must be a list of evidence ids')
    const out = new Map()
    for (const r of refs) {
      const id = typeof r === 'string' ? r : r?.id
      const e = this.t.get('evidence', id)
      need(e, `No career-library record ${id}. Use the ids from brief.get or evidence.list.`)
      const version = typeof r === 'object' && Number.isInteger(r.version) ? r.version : e.version
      need(this.t.version('evidence', id, version), `${id} has no version ${version}`)
      out.set(id, { id, version })
    }
    return [...out.values()]
  }

  material(id, version) {
    const m = version ? this.t.version('material', id, Number(version)) : this.t.get('material', id)
    need(m, `No material ${id}${version ? ` version ${version}` : ''}`, 404)
    return m
  }

  /** Save a material (text and/or a file). Files are stored by content hash and never overwritten. */
  saveMaterial(input, { id, expectedVersion, actor = 'user' } = {}) {
    need(MATERIAL_KINDS.includes(input.kind), `kind must be one of: ${MATERIAL_KINDS.join(', ')}`)
    need(text(input.title), 'title is required')
    need(text(input.content) || input.file, 'Provide content text or a file')
    const applicationId = text(input.applicationId)
    if (applicationId) this.application(applicationId)
    const wordLimit = input.wordLimit === undefined || input.wordLimit === null ? undefined : Number(input.wordLimit)
    if (wordLimit !== undefined) need(Number.isInteger(wordLimit) && wordLimit > 0, 'wordLimit must be a whole number')
    const evidenceRefs = this.#pinEvidence(input.evidenceRefs)
    let file
    if (input.file) {
      const src = path.resolve(input.file)
      need(fs.existsSync(src), `File not found: ${src}`)
      const buf = fs.readFileSync(src)
      const hash = sha256(buf)
      const store = path.join(dataDir(), 'files')
      fs.mkdirSync(store, { recursive: true })
      const target = path.join(store, `${hash}${path.extname(src).toLowerCase()}`)
      if (!fs.existsSync(target)) fs.writeFileSync(target, buf, { flag: 'wx' })
      file = { name: path.basename(src), sha256: hash, bytes: buf.length, stored: path.relative(dataDir(), target) }
    }
    const data = {
      kind: input.kind, title: text(input.title), content: text(input.content, 200000), file, applicationId,
      evidenceRefs, reviewStatus: input.reviewStatus === 'approved' ? 'approved' : 'draft',
      prompt: text(input.prompt), wordLimit, words: input.words ?? (input.content === undefined ? undefined : countWords(input.content)), notes: text(input.notes),
    }
    const keep = (cur) => Object.fromEntries(['file', 'evidenceRefs', 'applicationId', 'prompt', 'wordLimit', 'notes'].filter((k) => data[k] === undefined).map((k) => [k, cur[k]]))
    return id
      ? this.t.update('material', id, (cur) => ({ ...cur, ...data, ...keep(cur) }), { expectedVersion, actor })
      : this.t.create('material', { ...data, evidenceRefs: evidenceRefs || [] }, { actor })
  }

  // ---------- writing rules ----------
  rules({ status } = {}) {
    return this.t.list('rule').filter((r) => !status || r.status === status).sort((a, b) => a.title.localeCompare(b.title))
  }

  #ruleFields(input) {
    need(text(input.title), 'title is required')
    need(text(input.rule), 'rule text is required')
    return {
      title: text(input.title), rule: text(input.rule), rationale: text(input.rationale), whenRelevant: text(input.whenRelevant),
      materialKinds: Array.isArray(input.materialKinds) ? input.materialKinds : ['resume', 'cv', 'cover-letter', 'essay', 'answer'],
      example: text(input.example), proposalSource: text(input.proposalSource),
      narrativeIds: strings(input.narrativeIds), applicationIds: strings(input.applicationIds), evidenceRefs: this.#pinEvidence(input.evidenceRefs),
    }
  }

  /**
   * Save a rule the person stated, in force straight away. Their own words are the approval, so no
   * second question is needed. With an id, the rule's wording is replaced.
   */
  saveRule(input, { approvalText, approvalSource, expectedVersion, actor = 'agent' } = {}) {
    need(text(approvalText), 'approvalText must quote what the person said')
    need(text(approvalSource), 'approvalSource must say where they said it (e.g. "chat, 2026-11-25")')
    const id = text(input.id) || slug(input.title)
    return this.t.transaction(() => {
      const cur = this.t.get('rule', id)
      const draft = cur ? this.reviseRule(id, input, { expectedVersion, actor }) : this.proposeRule({ ...input, id }, { actor })
      return this.approveRule(id, { version: draft.version, approvalText, approvalSource }, { actor })
    })
  }

  proposeRule(input, { actor = 'agent' } = {}) {
    const id = text(input.id) || slug(input.title)
    return this.t.create('rule', { ...this.#ruleFields(input), status: 'proposed', approvals: [] }, { id, actor, type: 'proposed' })
  }

  /** Propose new wording. The active wording stays in use until the new version is approved. */
  reviseRule(id, input, { expectedVersion, actor = 'agent' } = {}) {
    return this.t.update('rule', id, ({ bundled: _bundled, ...cur }) => ({
      ...cur, ...this.#ruleFields({ ...cur, ...input }), status: 'proposed',
      active: cur.active || (cur.status === 'approved' || cur.status === 'starter'
        ? { version: this.t.get('rule', id).version, status: cur.status, title: cur.title, rule: cur.rule, whenRelevant: cur.whenRelevant, materialKinds: cur.materialKinds, example: cur.example, narrativeIds: cur.narrativeIds, applicationIds: cur.applicationIds }
        : undefined),
    }), { expectedVersion, actor, type: 'revised' })
  }

  approveRule(id, { version, approvalText, approvalSource }, { actor = 'user' } = {}) {
    need(text(approvalText), 'approvalText must quote what the person actually said')
    need(text(approvalSource), 'approvalSource must say where the approval was given (e.g. "chat, 2026-11-25")')
    const cur = this.t.get('rule', id)
    need(cur, `No rule ${id}`, 404)
    need(Number(version) === cur.version, `Approval must name the current version (${cur.version}) of ${id}`, 409)
    return this.t.update('rule', id, (r) => {
      const { active: _old, bundled: _bundled, ...rest } = r
      return { ...rest, status: 'approved', approvals: [...(r.approvals || []), { version: cur.version, approvalText: text(approvalText), approvalSource: text(approvalSource), at: new Date().toISOString() }] }
    }, { expectedVersion: cur.version, actor, type: 'approved' })
  }

  retireRule(id, { reason, expectedVersion }, { actor = 'user' } = {}) {
    need(text(reason), 'Give a reason for retiring the rule')
    return this.t.update('rule', id, (r) => {
      const { active: _active, bundled: _bundled, ...rest } = r
      return { ...rest, status: 'retired', retiredReason: text(reason) }
    }, { actor, type: 'retired', expectedVersion })
  }

  /**
   * Rules in force: approved/starter wording, or the last active wording of a pending revision.
   * Pass a job, narrative or document kind to leave out rules scoped to something else.
   */
  activeRules({ applicationId, narrativeId, materialKind } = {}) {
    const scoped = applicationId !== undefined || narrativeId !== undefined || materialKind !== undefined
    return this.rules().flatMap((r) => {
      if (r.status === 'approved' || r.status === 'starter') return [{ id: r.id, version: r.version, status: r.status, title: r.title, rule: r.rule, whenRelevant: r.whenRelevant, materialKinds: r.materialKinds, example: r.example, narrativeIds: r.narrativeIds, applicationIds: r.applicationIds, evidenceRefs: r.evidenceRefs }]
      if (r.status === 'proposed' && r.active) return [{ ...r.active, id: r.id, status: r.active.status || 'approved', pendingRevision: r.version }]
      return []
    }).filter((r) => !scoped || inScope(r, { applicationId, narrativeId, materialKind }))
  }

  /**
   * Add bundled rules that are missing, and refresh ones the person never touched (no approval,
   * revision or retirement). Anything the person decided is left alone.
   */
  seedStarterRules({ actor = 'setup' } = {}) {
    const file = path.join(APP_DIR, 'templates', 'writing-rules.json')
    const { rules } = JSON.parse(fs.readFileSync(file, 'utf8'))
    return this.t.transaction(() => {
      let added = 0
      let refreshed = 0
      for (const r of rules) {
        const data = { ...this.#ruleFields(r), status: r.status === 'starter' ? 'starter' : 'proposed', approvals: [], bundled: true }
        const cur = this.t.get('rule', r.id)
        if (!cur) {
          this.t.create('rule', data, { id: r.id, actor, type: 'seeded' })
          added++
          continue
        }
        const untouched = ['starter', 'proposed'].includes(cur.status) && !cur.approvals?.length && !cur.active && (cur.bundled || (cur.version === 1 && this.t.versions('rule', r.id)[0]?.actor === actor))
        if (untouched && this.t.update('rule', r.id, () => data, { actor, type: 'seeded' }).version !== cur.version) refreshed++
      }
      return { added, refreshed }
    })
  }

  // ---------- briefs, packets, submissions ----------
  /** Everything an agent needs to tailor materials for one application. */
  brief(applicationId, { materialKind, narrative, detail = 'compact' } = {}) {
    need(['compact', 'full'].includes(detail), 'detail must be compact or full')
    const application = this.application(applicationId)
    const all = this.evidence()
    const byId = new Map(all.map((e) => [e.id, e]))
    const usable = all.filter(isUsable)
    const narratives = this.narratives()
    need(!narrative || narratives.some((n) => n.id === narrative), `No narrative ${narrative}. Saved: ${narratives.map((n) => n.id).join(', ') || 'none'}`, 404)
    const wanted = `${application.discipline || ''} ${application.title || ''}`.toLowerCase()
    const matched = narratives.map((n) => ({ n, on: n.disciplines?.find((d) => wanted.includes(d.toLowerCase())) })).find((x) => x.on)
    const suggested = narrative || matched?.n.id || null
    const usedBy = (id) => narratives.filter((n) => n.experience.some((e) => e.evidenceId === id || e.achievements?.includes(id))).map((n) => n.id)
    const topMatches = rankEvidence([application.postingText, application.title, application.discipline, ...(application.qualificationMap || []).map((q) => q.qualification)].join(' '), usable)
      .map((m) => ({ ...m, narratives: usedBy(m.id) }))
    const top = new Set(topMatches.map((m) => m.id))
    const view = (e) => {
      const base = detail === 'full' ? (({ createdAt: _c, updatedAt: _u, ...rest }) => rest)(e) : (top.has(e.id) ? compactFact(e, 6000) : compactFact(e, 320, 3))
      return { ...base, narratives: usedBy(e.id), strength: STAR_KINDS.includes(e.kind) ? starScore(e).score : undefined }
    }
    // Every descendant of a role is listed under it, with the title it sits under.
    const placed = new Set()
    const descend = (id, under, seen = new Set([id])) => usable.filter((e) => e.parentId === id && !seen.has(e.id)).flatMap((e) => {
      seen.add(e.id)
      placed.add(e.id)
      return [{ ...view(e), under }, ...descend(e.id, e.title, seen)]
    })
    const tree = (kind) => usable.filter((e) => e.kind === kind && !isUsable(byId.get(e.parentId) || { reviewStatus: 'outdated' })).map((e) => {
      placed.add(e.id)
      return { ...view(e), achievements: descend(e.id) }
    })
    const experiences = tree('experience')
    const projects = tree('project')
    const name = (id) => ({ id, title: byId.get(id)?.title, ...(byId.has(id) ? {} : { missing: true }) })
    const scope = { applicationId, narrativeId: suggested, materialKind }
    const rules = this.activeRules(scope)
    return {
      generatedAt: new Date().toISOString(),
      application: { ...application, freshness: postingFreshness(application) },
      profile: this.profile(),
      suggestedNarrative: suggested,
      suggestedBecause: narrative ? 'chosen' : matched ? `the job matches "${matched.on}"` : 'no saved narrative matches this job',
      narratives: narratives.map(({ createdAt: _c, updatedAt: _u, ...n }) => (n.id === suggested
        ? { ...n, suggested: true, experience: n.experience.map((e) => ({ ...name(e.evidenceId), achievements: e.achievements?.map(name) })) }
        : { id: n.id, label: n.label, headline: n.headline })),
      topMatches,
      postingTextMissing: application.postingText ? undefined : 'Save the posting text on the job (postingText) so evidence can be matched to it.',
      rules: {
        active: rules.map((r) => ({ ...r, evidenceChanged: this.#changedEvidence(r.evidenceRefs, byId) })),
        proposed: this.rules({ status: 'proposed' }).filter((r) => !r.active && inScope(r, scope)).map(({ id, version, title, rule, whenRelevant, materialKinds, example }) => ({ id, version, title, rule, whenRelevant, materialKinds, example })),
        outsideScope: this.activeRules().length - rules.length,
      },
      experiences, projects,
      otherEvidence: usable.filter((e) => !placed.has(e.id)).map(view),
      setAside: all.filter((e) => !isUsable(e)).map(({ id, title, reviewStatus, gapsNoted }) => ({ id, title, reviewStatus, gapsNoted })),
      reviewStatusCounts: all.reduce((o, e) => ({ ...o, [e.reviewStatus]: (o[e.reviewStatus] || 0) + 1 }), {}),
      materials: this.materials().filter((m) => (!m.applicationId || m.applicationId === applicationId) && m.kind !== 'other').map(({ id, version, kind, title, applicationId: a, reviewStatus, evidenceChanged, prompt, wordLimit, words }) => ({ id, version, kind, title, applicationId: a, reviewStatus, evidenceChanged, prompt, wordLimit, words })),
      previousSubmissions: this.submissions().filter((s) => s.applicationId === applicationId),
      checklist: JSON.parse(fs.readFileSync(path.join(APP_DIR, 'templates', 'review-checklist.json'), 'utf8')).steps,
      guidance: [
        'Everything here came from the person and can be used without asking them to confirm it. Leave out what is in setAside.',
        'topMatches lists facts that share the posting\'s words, best first. Start there and from the suggested narrative; the posting decides, so drop the narrative\'s order when stronger evidence lies elsewhere.',
        'Reuse saved bullets and wording when they fit. Otherwise write from star, metrics and content. "more": true means evidence.get has the rest; read it before relying on the record.',
        'cautions and gapsNoted say what may not be claimed. A caution in one record also limits the same number or claim in another: leave that number out, without asking.',
        'Follow rules.active where whenRelevant fits. If a rule lists evidenceChanged, check its example against the current fact.',
        'Name gaps in the hand-over. Ask only about something this application needs and the library does not have.',
      ],
    }
  }

  packets() { return this.t.list('packet') }

  /** Freeze the exact documents, posting and facts behind one application. Notes never block it. */
  createPacket({ applicationId, items = [], answers = [], notes }, { actor = 'user' } = {}) {
    const application = this.application(applicationId)
    need(items.length, 'A packet needs at least one material version')
    const current = new Map(this.evidence().map((e) => [e.id, e]))
    const warnings = []
    const refs = new Map()
    const frozen = items.map((i) => {
      const m = this.material(i.materialId, i.version)
      if (m.applicationId && m.applicationId !== applicationId) warnings.push(`"${m.title}" was written for a different job.`)
      if (m.wordLimit && m.words > m.wordLimit) warnings.push(`"${m.title}" is ${m.words} words; the limit is ${m.wordLimit}.`)
      const changed = this.#changedEvidence(m.evidenceRefs, current)
      if (changed.length) warnings.push(`"${m.title}" uses facts that changed since it was written: ${changed.map((c) => c.title || c.id).join(', ')}.`)
      for (const r of m.evidenceRefs || []) if (typeof r === 'object') refs.set(`${r.id}@${r.version}`, r)
      return { materialId: i.materialId, version: m.version, kind: m.kind, title: m.title, sha256: m.file?.sha256 }
    })
    return this.t.create('packet', {
      applicationId, items: frozen, answers, notes: text(notes), warnings,
      posting: { company: application.company, title: application.title, sourceUrl: application.sourceUrl, requisition: application.requisition, postingStatus: application.postingStatus, lastChecked: application.lastChecked, deadline: application.deadline, postingText: application.postingText, version: application.version, qualificationMap: application.qualificationMap },
      evidence: [...refs.values()].map((r) => ({ ...r, snapshot: this.t.version('evidence', r.id, r.version) })),
    }, { actor })
  }

  /** Evidence a document's content names, so callers do not have to list it twice. */
  evidenceInContent(content) {
    return citedEvidence(content).filter((id) => this.t.get('evidence', id))
  }

  submissions() { return this.t.list('submission') }

  /**
   * Record what was actually filed. Copies the exact files into
   * "1 Applications/<date> <Employer> - <Role>/" with hashes, and moves the application to Applied.
   */
  recordSubmission(input, { actor = 'user' } = {}) {
    const app = this.application(input.applicationId)
    if (input.submissionMode !== undefined) need(SUBMISSION_MODES.includes(input.submissionMode), `submissionMode must be one of: ${SUBMISSION_MODES.join(', ')}`)
    need(input.confirmedBySubmitter === true, 'Only record a submission after the person confirms they actually submitted it (confirmedBySubmitter: true)')
    need(validSubmissionDate(input.submittedAt), 'submittedAt must be a real date: YYYY-MM-DD, or YYYY-MM / YYYY when the day is unknown')
    const precision = input.submittedAt.length === 10 ? 'day' : input.submittedAt.length === 7 ? 'month' : 'year'
    const files = (input.files || []).map((f) => path.resolve(typeof f === 'string' ? f : f.path))
    files.forEach((f) => need(fs.existsSync(f) && fs.statSync(f).isFile(), `Not a file: ${f}`))
    if (input.packetId) {
      const packet = this.t.get('packet', input.packetId)
      need(packet, `No packet ${input.packetId}`, 404)
      need(packet.applicationId === app.id, `Packet ${input.packetId} belongs to a different application`, 409)
    }

    const dir = uniquePath(folder('applications'), safeName(`${input.submittedAt.slice(0, 10)} ${app.company} - ${app.title}`))
    fs.mkdirSync(dir, { recursive: true })
    const copied = files.map((src) => {
      const base = path.basename(src)
      const target = uniquePath(dir, RESERVED_NAMES.has(base.toLowerCase()) ? `attachment - ${base}` : base)
      fs.copyFileSync(src, target, fs.constants.COPYFILE_EXCL)
      const buf = fs.readFileSync(target)
      return { name: path.basename(target), originalPath: src, sha256: sha256(buf), bytes: buf.length }
    })
    const manifest = {
      applicationId: app.id, company: app.company, title: app.title, requisition: app.requisition, postingUrl: app.sourceUrl,
      submittedAt: input.submittedAt, datePrecision: precision, recordedAt: new Date().toISOString(), method: text(input.method) || 'unknown',
      packetId: input.packetId, files: copied, answers: input.answers || [], pastedText: input.pastedText || [],
      receipt: input.receipt || null, historical: Boolean(input.historical), gaps: input.gaps || [],
      submittedBy: input.submittedBy === 'agent' ? 'agent' : 'person', submissionMode: text(input.submissionMode), formUrl: text(input.formUrl),
    }
    fs.writeFileSync(path.join(dir, 'submission.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
    fs.writeFileSync(path.join(dir, 'What I submitted.md'), submissionSummary(manifest), { flag: 'wx' })
    return this.t.transaction(() => {
      const record = this.t.create('submission', { ...manifest, folder: path.relative(folder('applications'), dir) }, { actor, type: 'submitted' })
      const latest = this.application(app.id)
      if (STAGE_RANK[latest.stage] < STAGE_RANK.Applied) {
        // The old next step ("Submit…", "Draft…") is done; leave a sensible one until the agent sets a follow-up date.
        this.t.update('application', app.id, (cur) => ({ ...cur, stage: 'Applied', appliedAt: input.submittedAt, nextAction: 'Wait to hear back; follow up if no reply' }), { actor, type: 'submitted' })
      }
      return { submission: record, folder: dir }
    })
  }

  // ---------- snapshot for the dashboard ----------
  snapshot() {
    return this.t.read(() => this.#snapshot())
  }

  #snapshot() {
    const today = localToday()
    const applications = this.applications().map((a) => ({ ...a, freshness: postingFreshness(a, today), postingText: undefined }))
    const counts = Object.fromEntries(STAGES.map((s) => [s, applications.filter((a) => a.stage === s).length]))
    return {
      revision: this.revision(), stages: STAGES, counts, profile: this.profile(), applications,
      researchTasks: this.researchTasks().map(({ claimToken, ...t }) => t),
      screening: this.screeningDecisions().slice(0, 200),
      employers: this.employers(), evidence: this.evidence(), materials: this.materials(), rules: this.rules(),
      submissions: this.submissions(), activity: this.t.activity(40),
      narratives: this.narratives(), experienceStrength: this.experienceStrength(), screeningAnswers: this.screeningAnswers(),
    }
  }
}

/** A rule applies unless it is limited to other jobs, narratives or kinds of document. */
function inScope(r, { applicationId, narrativeId, materialKind }) {
  return (!r.applicationIds?.length || r.applicationIds.includes(applicationId)) &&
    (!r.narrativeIds?.length || r.narrativeIds.includes(narrativeId)) &&
    (!materialKind || !r.materialKinds?.length || r.materialKinds.includes(materialKind))
}

/** The parts of a fact a document relies on. Saved bullets and review status do not change the fact. */
function factOf({ kind, title, organization, period, content, skills, parentId, star, metrics, gapsNoted, publication }) {
  return JSON.stringify([kind, title, organization, period, content, skills, parentId, star, metrics, gapsNoted, publication])
}

function bulletBank(value) {
  if (!Array.isArray(value)) return undefined
  return value.map((b) => (typeof b === 'string' ? { text: text(b, 2000) } : { text: text(b?.text, 2000), narratives: strings(b?.narratives), usedFor: text(b?.usedFor), savedAt: text(b?.savedAt) })).filter((b) => b.text)
}

function publicationFields(p) {
  if (!p || typeof p !== 'object') return undefined
  if (p.status !== undefined) need(PUBLICATION_STATUSES.includes(p.status), `publication.status must be one of: ${PUBLICATION_STATUSES.join(', ')}`)
  return { authors: strings(p.authors), venue: text(p.venue), year: text(p.year), status: p.status, doi: text(p.doi), role: text(p.role) }
}

const RESERVED_NAMES = new Set(['submission.json', 'what i submitted.md'])

function validSubmissionDate(value) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(value || ''))
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), m[2] ? Number(m[2]) : 1, m[3] ? Number(m[3]) : 1]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return y >= 1950 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && date.getTime() <= Date.now() + 86400000
}

/** STAR completeness: each of situation, task, action, result, a dated metric with a unit, and a source. */
export function starScore(e) {
  const star = e.star || {}
  const checks = {
    situation: Boolean(star.situation), task: Boolean(star.task), action: Boolean(star.action), result: Boolean(star.result),
    measuredResult: (e.metrics || []).some((m) => m.value && m.unit && m.period),
    evidence: (e.sources || []).length > 0 || Boolean(e.source) || e.reviewStatus === 'source-verified',
  }
  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k)
  return { score: Math.round((100 * (6 - missing.length)) / 6), missing, usable: isUsable(e) }
}

function submissionSummary(m) {
  const lines = [
    `# ${m.company} — ${m.title}`, '',
    `- Submitted: ${m.submittedAt} (${m.datePrecision} precision)${m.historical ? ' — reconstructed historical record' : ''}`,
    `- Method: ${m.method}${m.submittedBy === 'agent' ? ` (submitted by the assistant, mode: ${m.submissionMode || 'not recorded'})` : ''}`, m.postingUrl ? `- Posting: ${m.postingUrl}` : null, m.requisition ? `- Requisition: ${m.requisition}` : null,
    `- Recorded: ${m.recordedAt}`, '', '## Files filed', ...(m.files.length ? m.files.map((f) => `- ${f.name} (sha256 ${f.sha256.slice(0, 12)}…)`) : ['- None recorded']),
  ]
  if (m.pastedText.length) lines.push('', '## Text pasted into the form', ...m.pastedText.flatMap((p) => ['', `### ${p.label || 'Text'}`, '', p.text]))
  if (m.answers.length) lines.push('', '## Questions asked on the form', ...m.answers.flatMap((a) => ['', `**${a.question}**${a.required === false ? ' (optional)' : ''}`, '', Array.isArray(a.answer) ? a.answer.join(', ') : String(a.answer), ...(a.source ? [`*Answer source: ${a.source}*`] : [])]))
  if (m.receipt) lines.push('', '## Receipt', '', typeof m.receipt === 'string' ? m.receipt : JSON.stringify(m.receipt, null, 2))
  if (m.gaps.length) lines.push('', '## Not captured', ...m.gaps.map((g) => `- ${g}`))
  return lines.filter((l) => l !== null).join('\n') + '\n'
}

export function openStore(options = {}) {
  return new Store(options.file || dbPath({ demo: options.demo }), { allowNew: options.allowNew || options.demo })
}
