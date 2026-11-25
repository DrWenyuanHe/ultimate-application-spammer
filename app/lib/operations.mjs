// The one way agents change or read workspace data.
//
//   node app/cli.mjs op list                      names and summaries
//   node app/cli.mjs op describe <name>           inputs, required fields and an example
//   node app/cli.mjs op run <name> --file in.json (or --input '<json>', or --stdin)
//
// Every run prints one JSON envelope: { "ok": true, "op", "result" } or
// { "ok": false, "op", "error": { "status", "message", "details" } } (exit code 1).
// Unknown input fields are rejected so agents cannot improvise. To add an operation, add one
// entry to OPERATIONS below (name, summary, input, required, example, run) and a test.
import fs from 'node:fs'
import path from 'node:path'
import { APP_DIR, folder } from './paths.mjs'
import { archiveMove, safeName, uniquePath, writeGenerated } from './archive.mjs'
import { openStore, StoreError } from './store.mjs'
import { rulesMarkdown, writeTemplates } from './setup.mjs'
import { buildCoverLetter, buildResume, docxText, exportPdf, leftoverPlaceholders, loadFormat, wordCount } from './docx.mjs'
import { readZip } from './zip.mjs'
import { listBackups, restore as restoreBackup, setMirror, snapshot, snapshotIfDue } from './backup.mjs'
import { storageReport, tidy } from './storage.mjs'

const T = {
  id: 'string — record id',
  version: 'integer — the version you read (protects against overwriting newer changes)',
}

function refreshRules(store) {
  writeGenerated(path.join(folder('templates'), 'Writing Rules.md'), rulesMarkdown(store.rules()))
}

function buildDocument(store, kind, input) {
  const buffer = kind === 'resume' ? buildResume(input.content, loadFormat('resume')) : buildCoverLetter(input.content, loadFormat('cover-letter'))
  let target
  if (input.out) {
    target = uniquePath(path.dirname(path.resolve(input.out)), path.basename(input.out))
  } else {
    let sub = 'Drafts'
    if (input.applicationId) {
      const app = store.application(input.applicationId)
      sub = path.join('Drafts', safeName(`${app.company} - ${app.title}`))
    }
    target = uniquePath(path.join(folder('applications'), sub), `${safeName(input.content.name || 'Document')} ${kind === 'resume' ? 'Resume' : 'Cover Letter'}.docx`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, buffer, { flag: 'wx' })
  const result = { docx: target, placeholdersLeft: leftoverPlaceholders(buffer), words: wordCount(docxText(buffer)) }
  if (input.pdf) result.pdf = exportPdf(target)
  if (input.save) {
    result.material = store.saveMaterial({
      kind: kind === 'resume' ? 'resume' : 'cover-letter', title: input.title || path.basename(target, '.docx'),
      content: JSON.stringify(input.content, null, 2), file: target, applicationId: input.applicationId, evidenceRefs: input.evidenceRefs,
    }, { id: input.materialId, expectedVersion: input.expectedVersion, actor: 'agent' })
  }
  return result
}

function checkDocument(file) {
  const buffer = fs.readFileSync(path.resolve(file))
  const xml = readZip(buffer, { only: ['word/document.xml'] }).get('word/document.xml').toString('utf8')
  return {
    file: path.resolve(file), placeholdersLeft: leftoverPlaceholders(buffer), words: wordCount(docxText(buffer)),
    fonts: [...new Set([...xml.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]))],
    sizesPt: [...new Set([...xml.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => Number(m[1]) / 2))].sort((a, b) => a - b),
  }
}

const many = (store, input, key, fn) => (Array.isArray(input[key]) ? store.t.transaction(() => input[key].map(fn)) : fn(input[key]))

export const OPERATIONS = {
  // ---------- profile and onboarding ----------
  'profile.get': { summary: 'Read the person\'s profile (name, contact, targets, submissionMode).', input: {}, run: (s) => s.profile() || { empty: true } },
  'profile.set': {
    summary: 'Save profile fields. Only send fields that change.',
    input: { fields: 'object — any of name, preferredName, email, phone, city, links[], headline, disciplines[], locations[], workModels[], employmentPreferences, searchNotes, submissionMode ("review-first" | "auto-submit")', expectedVersion: T.version },
    required: ['fields'],
    example: { fields: { name: 'Alex Rivera', city: 'Springfield', submissionMode: 'review-first' } },
    run: (s, i) => s.setProfile(i.fields, { expectedVersion: i.expectedVersion, actor: 'agent' }),
  },
  'answers.get': { summary: 'Common application questions with saved answers, plus which required ones are missing.', input: {}, run: (s) => s.screeningAnswers() },
  'answers.set': {
    summary: 'Save answers to common application questions (ids from answers.get) and form-specific custom questions.',
    input: { answers: 'object — { questionId: answer or [answers] }', custom: 'array — [{ question, answer, employer? }] for questions met on a real form', expectedVersion: T.version },
    example: { answers: { 'work-eligibility': 'Yes', 'notice-period': 'Two weeks' }, custom: [{ question: 'Do you have experience with grant databases?', answer: 'Yes — three years' }] },
    run: (s, i) => s.setScreeningAnswers({ answers: i.answers || {}, custom: i.custom || [] }, { expectedVersion: i.expectedVersion, actor: 'agent' }),
  },

  // ---------- jobs (opportunities and applications) ----------
  'jobs.list': { summary: 'List jobs, optionally by stage or search text.', input: { stage: 'string — one of the stages', q: 'string — search text' }, run: (s, i) => s.applications(i) },
  'jobs.get': { summary: 'One job with all fields.', input: { id: T.id }, required: ['id'], run: (s, i) => s.application(i.id) },
  'jobs.history': { summary: 'Every saved version of a job.', input: { id: T.id }, required: ['id'], run: (s, i) => s.history('application', i.id) },
  'jobs.add': {
    summary: 'Save a job found on an employer posting (or several with "jobs"). Duplicates of the same posting are refused.',
    input: { job: 'object — company, title, sourceUrl, location, workModel, discipline, requisition, deadline, whyFit, gaps, nextAction, priority 1-5, postingStatus, lastChecked, salary, employmentType', jobs: 'array — several job objects' },
    example: { job: { company: 'Northwind Biosciences', title: 'Research Coordinator', sourceUrl: 'https://boards.greenhouse.io/northwind-example/jobs/1', location: 'Springfield', whyFit: 'Grant writing and coordination', gaps: 'Budget ownership', lastChecked: '2026-11-25T15:00:00Z' } },
    run: (s, i) => (i.jobs ? many(s, i, 'jobs', (j) => s.addApplication(j, { actor: 'agent' })) : s.addApplication(i.job, { actor: 'agent' })),
  },
  'jobs.update': {
    summary: 'Change a job: stage, priority, nextAction, followUpOn, deadline, notes, whyFit, gaps, posting details.',
    input: { id: T.id, patch: 'object — fields to change (stage: Review|Preparing|Ready|Applied|Interview|Offer|Rejected|Withdrawn|Archived)', expectedVersion: T.version },
    required: ['id', 'patch'],
    example: { id: 'JOB_ID', patch: { stage: 'Interview', nextAction: 'Panel interview Dec 2, 10:00' }, expectedVersion: 3 },
    run: (s, i) => s.updateApplication(i.id, i.patch, { expectedVersion: i.expectedVersion, actor: 'agent' }),
  },
  'jobs.bulk-update': {
    summary: 'Apply changes to several jobs at once; all succeed or none do.',
    input: { items: 'array — [{ id, patch, expectedVersion }]' }, required: ['items'],
    run: (s, i) => s.bulkUpdate(i.items, { actor: 'agent' }),
  },

  // ---------- searching ----------
  'search.queue': { summary: 'Record a search to run (so it shows on the dashboard and can be resumed).', input: { title: 'string', query: 'string', location: 'string', notes: 'string' }, required: ['query'], run: (s, i) => s.queueResearch(i, { actor: 'agent' }) },
  'search.list': { summary: 'Searches and their status.', input: {}, run: (s) => s.researchTasks().map(({ claimToken, ...t }) => t) },
  'search.claim': {
    summary: 'Claim the next queued search (30-minute lease). Keep the returned claimToken for search.complete.',
    input: { worker: 'string — your agent name', taskId: 'string — a specific task' },
    run: (s, i) => s.claimResearch({ worker: i.worker || 'agent', taskId: i.taskId }) || { claimed: false, message: 'No queued searches.' },
  },
  'search.complete': {
    summary: 'Finish a claimed search with verified findings. Each finding is a job opened on the employer\'s own posting.',
    input: { taskId: 'string', claimToken: 'string', summary: 'string', findings: 'array — [{ company, title, sourceUrl, checkedAt, location, requisition, deadline, postingStatus, whyFit, gaps, note }]' },
    required: ['taskId', 'claimToken', 'findings'],
    run: (s, i) => s.completeResearch(i, { actor: 'agent' }),
  },
  'discover.run': {
    summary: 'Pull current postings from an employer\'s job board (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Job Bank). Results are leads to screen, not verified jobs.',
    input: { employerId: 'string — from employers.list', url: 'string — a careers board link', platform: 'string', board: 'string', host: 'string', tenant: 'string', site: 'string', company: 'string', keyword: 'string', location: 'string', limit: 'integer' },
    example: { employerId: 'northwind-biosciences', keyword: 'research', location: 'Springfield' },
    run: async (s, i) => {
      const { discover, discoverEmployer, boardFromUrl } = await import('./discovery.mjs')
      const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
      const options = defined({ keyword: i.keyword, location: i.location, limit: i.limit })
      if (i.employerId) {
        const employer = s.employers().find((e) => e.id === i.employerId)
        if (!employer) throw new StoreError(404, `No employer ${i.employerId}`)
        return discoverEmployer(employer, options)
      }
      if (i.url) {
        if (!boardFromUrl(i.url)) throw new StoreError(400, 'That careers link is not a supported job board (Greenhouse, Lever, Ashby, SmartRecruiters, Workday or Job Bank); open it in a browser instead.')
        return discoverEmployer(defined({ name: i.company, careersUrl: i.url }), options)
      }
      return discover(defined({ platform: i.platform, board: i.board, host: i.host, tenant: i.tenant, site: i.site, company: i.company, ...options }))
    },
  },
  'screen.preflight': {
    summary: 'Before screening a batch: which candidates are new, already saved, already decided or duplicates.',
    input: { candidates: 'array — [{ company, title, sourceUrl, requisition }]', criteriaVersion: 'string — name/version of the criteria you are applying' },
    required: ['candidates', 'criteriaVersion'],
    run: (s, i) => s.screeningPreflight(i),
  },
  'screen.record': {
    summary: 'Save shortlist / reject / hold decisions with reasons and posting evidence. Shortlisted jobs appear on the dashboard.',
    input: { decisions: 'array — [{ company, title, sourceUrl, requisition, decision, reason, evidence: [{ url, checkedAt }], whyFit, gaps, location, recheckReason }]', criteriaVersion: 'string' },
    required: ['decisions'],
    run: (s, i) => s.recordScreening(i),
  },
  'screen.list': { summary: 'All screening decisions.', input: {}, run: (s) => s.screeningDecisions() },

  // ---------- employers ----------
  'employers.list': { summary: 'Employers being tracked.', input: { sector: 'string', q: 'string' }, run: (s, i) => s.employers(i) },
  'employers.add': {
    summary: 'Track an employer (or several with "employers").',
    input: { employer: 'object — name, sector, website, careersUrl, platform, locations, notes, priority', employers: 'array' },
    run: (s, i) => (i.employers ? many(s, i, 'employers', (e) => s.addEmployer(e, { actor: 'agent' })) : s.addEmployer(i.employer, { actor: 'agent' })),
  },
  'employers.update': { summary: 'Change an employer\'s details.', input: { id: T.id, patch: 'object', expectedVersion: T.version }, required: ['id', 'patch'], run: (s, i) => s.updateEmployer(i.id, i.patch, { expectedVersion: i.expectedVersion, actor: 'agent' }) },
  'employers.sectors': {
    summary: 'Sectors in the optional starter employer guide.', input: {},
    run: () => JSON.parse(fs.readFileSync(path.join(APP_DIR, 'guides', 'employers-by-sector.json'), 'utf8')).sectors.map((g) => ({ id: g.id, sector: g.sector, employers: g.employers.length, description: g.description })),
  },
  'employers.import-guide': { summary: 'Add starter employers for chosen sectors (only when the person asks).', input: { sectors: 'array — sector ids' }, run: (s, i) => s.importEmployerGuide({ sectors: i.sectors }, { actor: 'agent' }) },

  // ---------- career library ----------
  'evidence.list': { summary: 'Experiences, projects, achievements, education and skills.', input: { kind: 'string', q: 'string' }, run: (s, i) => s.evidence(i) },
  'evidence.add': {
    summary: 'Save career facts (one with "item" or several with "items"). New facts start as needs-review.',
    input: { item: 'object — kind (experience|project|achievement|education|skill|publication|other), title, organization, period, content, skills[], parentId, star{situation,task,action,result}, metrics[{value,unit,period,baseline,source,note}], sources[{label,locator,documentId}], gapsNoted[], reviewStatus', items: 'array' },
    example: { item: { kind: 'achievement', title: 'Coordinated a three-clinic study', organization: 'Springfield University', period: '2022 – 2024', star: { situation: '…', task: '…', action: '…', result: '…' }, metrics: [{ value: '3', unit: 'partner clinics', period: '2022 – 2024' }], sources: [{ label: 'CV 2024.pdf', locator: 'page 2' }] } },
    run: (s, i) => (i.items ? many(s, i, 'items', (e) => s.addEvidence(e, { actor: 'agent' })) : s.addEvidence(i.item, { actor: 'agent' })),
  },
  'evidence.update': {
    summary: 'Change a career fact (STAR fields, metrics, sources, review status). Mark candidate-confirmed only after the person confirms.',
    input: { id: T.id, patch: 'object', expectedVersion: T.version }, required: ['id', 'patch'],
    run: (s, i) => s.updateEvidence(i.id, i.patch, { expectedVersion: i.expectedVersion, actor: 'agent' }),
  },
  'evidence.strength': { summary: 'STAR completeness of each experience, weakest first, with what is missing.', input: {}, run: (s) => s.experienceStrength() },
  'materials.list': { summary: 'Saved resumes, CVs, letters, essays and source documents.', input: { kind: 'string' }, run: (s, i) => s.materials(i) },
  'materials.get': { summary: 'One material, current or a specific version.', input: { id: T.id, version: 'integer' }, required: ['id'], run: (s, i) => s.material(i.id, i.version) },
  'materials.save': {
    summary: 'Save a material version (text and/or a file such as an original resume). Earlier versions are kept.',
    input: { material: 'object — kind (resume|cv|cover-letter|essay|answer|passage|other), title, content, file (path), applicationId, evidenceRefs[], reviewStatus, notes', id: 'string — to add a new version of an existing material', expectedVersion: T.version },
    required: ['material'],
    run: (s, i) => s.saveMaterial(i.material, { id: i.id, expectedVersion: i.expectedVersion, actor: 'agent' }),
  },
  'brief.get': { summary: 'Everything needed to tailor documents for one job: posting, profile, active rules, evidence, checklist.', input: { applicationId: T.id }, required: ['applicationId'], run: (s, i) => s.brief(i.applicationId) },
  'packets.create': { summary: 'Freeze the exact material versions chosen for one application.', input: { applicationId: T.id, items: 'array — [{ materialId, version }]', answers: 'array', notes: 'string' }, required: ['applicationId', 'items'], run: (s, i) => s.createPacket(i, { actor: 'agent' }) },

  // ---------- writing rules ----------
  'rules.list': { summary: 'Writing rules: active ones and all with status.', input: { status: 'string' }, run: (s, i) => (i.status ? s.rules({ status: i.status }) : { active: s.activeRules(), all: s.rules() }) },
  'rules.propose': { summary: 'Suggest a reusable writing rule (it is not used until the person approves it).', input: { rule: 'object — id?, title, rule, rationale, whenRelevant, materialKinds[], example' }, required: ['rule'], run: (s, i) => { const r = s.proposeRule(i.rule); refreshRules(s); return r } },
  'rules.revise': { summary: 'Propose new wording; the old wording stays active until approved.', input: { id: T.id, rule: 'object', expectedVersion: T.version }, required: ['id', 'rule'], run: (s, i) => { const r = s.reviseRule(i.id, i.rule, { expectedVersion: i.expectedVersion }); refreshRules(s); return r } },
  'rules.approve': {
    summary: 'Record the person\'s explicit approval of a rule version, quoting what they said.',
    input: { id: T.id, version: 'integer — current version', approvalText: 'string — their words', approvalSource: 'string — e.g. "chat, 2026-11-25"' },
    required: ['id', 'version', 'approvalText', 'approvalSource'],
    run: (s, i) => { const r = s.approveRule(i.id, i, { actor: 'agent' }); refreshRules(s); return r },
  },
  'rules.retire': { summary: 'Stop using a rule (when the person asks).', input: { id: T.id, reason: 'string', expectedVersion: T.version }, required: ['id', 'reason'], run: (s, i) => { const r = s.retireRule(i.id, i, { actor: 'agent' }); refreshRules(s); return r } },

  // ---------- documents ----------
  'docs.resume': {
    summary: 'Render a resume .docx (and optionally PDF) from content JSON using the format in 3 Templates.',
    input: { content: 'object — see 3 Templates/Format Guide.md', applicationId: T.id, out: 'string — file path', pdf: 'boolean', save: 'boolean — also save as a material version', title: 'string', materialId: 'string', expectedVersion: T.version, evidenceRefs: 'array' },
    required: ['content'],
    run: (s, i) => buildDocument(s, 'resume', i),
  },
  'docs.cover-letter': {
    summary: 'Render a cover letter .docx (and optionally PDF) from content JSON.',
    input: { content: 'object', applicationId: T.id, out: 'string', pdf: 'boolean', save: 'boolean', title: 'string', materialId: 'string', expectedVersion: T.version, evidenceRefs: 'array' },
    required: ['content'],
    run: (s, i) => buildDocument(s, 'cover-letter', i),
  },
  'docs.pdf': { summary: 'Export a .docx to PDF next to it.', input: { file: 'string' }, required: ['file'], run: (s, i) => ({ pdf: exportPdf(i.file) }) },
  'docs.text': { summary: 'Plain text of a .docx (e.g. an imported resume) for reading.', input: { file: 'string' }, required: ['file'], run: (s, i) => ({ file: path.resolve(i.file), text: docxText(fs.readFileSync(path.resolve(i.file))) }) },
  'docs.check': { summary: 'Leftover placeholders, word count, fonts and sizes in a .docx.', input: { file: 'string' }, required: ['file'], run: (s, i) => checkDocument(i.file) },
  'docs.refresh-templates': { summary: 'Rebuild the Word masters and examples after the format files change.', input: {}, run: (s) => writeTemplates(s) },

  // ---------- submissions ----------
  'submissions.record': {
    summary: 'Record exactly what was submitted (files, pasted text, every question and answer, receipt). Copies files into 1 Applications.',
    input: {
      applicationId: T.id, confirmedBySubmitter: 'boolean — true only after the submission really happened', submittedAt: 'string — YYYY-MM-DD (or YYYY-MM / YYYY)',
      method: 'string — portal-form | upload | email | other', submittedBy: '"person" | "agent"', submissionMode: 'string', formUrl: 'string', files: 'array — paths of the exact files uploaded',
      pastedText: 'array — [{ label, text }]', answers: 'array — [{ question, answer, required?, source? }] every question on the form', receipt: 'string or object — confirmation number / page text',
      packetId: 'string', historical: 'boolean', gaps: 'array — things that could not be captured',
    },
    required: ['applicationId', 'confirmedBySubmitter', 'submittedAt'],
    run: (s, i) => s.recordSubmission(i, { actor: 'agent' }),
  },
  'submissions.list': { summary: 'Recorded submissions.', input: {}, run: (s) => s.submissions() },

  // ---------- files, storage and backups ----------
  'files.archive': { summary: 'Move a file or folder into Archive/ (the only way agents remove anything).', input: { path: 'string', reason: 'string' }, required: ['path', 'reason'], run: (s, i) => ({ archivedTo: archiveMove(i.path, { reason: i.reason }) }) },
  'storage.report': { summary: 'Space used by category and what is clearable.', input: {}, run: () => storageReport() },
  'storage.tidy': { summary: 'List clearable items, or with apply:true move them (or only the listed paths) to Archive/Clearable. The person deletes that folder by hand.', input: { apply: 'boolean', paths: 'array — only these paths from the dry-run list' }, run: (s, i) => tidy({ dryRun: !i.apply, store: s, paths: i.paths }) },
  'backup.now': { summary: 'Snapshot the database now.', input: {}, run: () => snapshot({ reason: 'manual' }) || { message: 'No database yet.' } },
  'backup.list': { summary: 'Database snapshots, newest first.', input: {}, run: () => listBackups() },
  'backup.mirror': { summary: 'Also copy every snapshot to a second folder (e.g. a synced drive); folder:null turns it off.', input: { folder: 'string or null — folder path' }, run: (s, i) => setMirror(i.folder || null) },
}

// Operations that must not hold the database open (they replace or check it).
const NO_STORE = new Set(['backup.restore', 'backup.list', 'backup.now', 'backup.mirror', 'storage.report', 'files.archive', 'docs.pdf', 'docs.check', 'docs.text'])
OPERATIONS['backup.restore'] = {
  summary: 'Restore a snapshot (the current database is backed up first). The dashboard must be closed.',
  input: { file: 'string — from backup.list' }, required: ['file'],
  run: (s, i) => restoreBackup(i.file),
}

const READ_ONLY = /\.(list|get|history|strength|sectors|report|check|text)$|^brief\.|^discover\.|^screen\.preflight$/

export function listOperations() {
  return Object.entries(OPERATIONS).map(([name, op]) => ({ name, summary: op.summary, required: op.required || [] }))
}

const lookup = (name) => (Object.hasOwn(OPERATIONS, name) ? OPERATIONS[name] : undefined)

/** The declared type of an input field is the first word of its description. */
function typeOk(declared, value) {
  const type = String(declared).split(/[\s—]/)[0]
  if (value === null) return /null/.test(declared)
  switch (type) {
    case 'boolean': return typeof value === 'boolean'
    case 'integer': return Number.isInteger(value)
    case 'array': return Array.isArray(value)
    case 'object': return typeof value === 'object' && !Array.isArray(value)
    case 'string': return typeof value === 'string' || (/or object/.test(declared) && typeof value === 'object')
    default: return true
  }
}

export function describeOperation(name) {
  const op = lookup(name)
  if (!op) throw new StoreError(404, `Unknown operation ${name}. Run "op list".`)
  return { name, summary: op.summary, input: op.input, required: op.required || [], example: op.example || null }
}

export function validateInput(name, input) {
  const op = lookup(name)
  if (!op) throw new StoreError(404, `Unknown operation ${name}. Run "op list".`)
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new StoreError(400, 'Input must be a JSON object')
  const unknown = Object.keys(input).filter((k) => !Object.hasOwn(op.input, k))
  if (unknown.length) throw new StoreError(400, `${name} does not take: ${unknown.join(', ')}. Allowed: ${Object.keys(op.input).join(', ') || '(none)'}`)
  const missing = (op.required || []).filter((k) => input[k] === undefined || input[k] === null || input[k] === '')
  if (missing.length) throw new StoreError(400, `${name} needs: ${missing.join(', ')}`)
  const wrong = Object.entries(input).filter(([k, v]) => v !== undefined && !typeOk(op.input[k], v)).map(([k]) => `${k} (${String(op.input[k]).split(/[\s—]/)[0]})`)
  if (wrong.length) throw new StoreError(400, `${name}: wrong type for ${wrong.join(', ')}`)
}

/** Run an operation and return the JSON envelope. Never throws. */
export async function runOperation(name, input = {}, { store: given } = {}) {
  try {
    validateInput(name, input)
    if (NO_STORE.has(name)) return { ok: true, op: name, result: await lookup(name).run(null, input) }
    const store = given || openStore()
    if (!READ_ONLY.test(name)) {
      try { snapshotIfDue({ reason: 'daily' }) } catch { /* a failed daily snapshot never blocks work; doctor reports backup age */ }
    }
    try {
      return { ok: true, op: name, result: await lookup(name).run(store, input) }
    } finally {
      if (!given) store.close()
    }
  } catch (error) {
    return { ok: false, op: name, error: { status: error.status || 500, message: error.message, details: error.details } }
  }
}
