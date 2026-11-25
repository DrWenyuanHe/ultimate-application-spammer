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
import { APP_DIR, folder, rootDir } from './paths.mjs'
import { archiveMove, safeName, uniquePath, writeGenerated } from './archive.mjs'
import { openStore, StoreError } from './store.mjs'
import { rulesMarkdown, writeTemplates } from './setup.mjs'
import { buildCoverLetter, buildResume, docxText, exportPdf, leftoverPlaceholders, loadFormat, wordCount } from './docx.mjs'
import { readZip } from './zip.mjs'
import { listBackups, restore as restoreBackup, setMirror, snapshot, snapshotIfDue } from './backup.mjs'
import { storageReport, tidy } from './storage.mjs'
import { checkBullets, flattenBullets, plain } from './bullets.mjs'
import { checkPostings } from './links.mjs'
import { pdfPageCount } from './pdf.mjs'

const T = {
  id: 'string — record id',
  version: 'integer — the version you read (protects against overwriting newer changes)',
}

function refreshRules(store) {
  writeGenerated(path.join(folder('templates'), 'Writing Rules.md'), rulesMarkdown(store.rules()))
}

/** Paths agents pass are relative to the workspace folder, as the playbooks write them. */
function inWorkspace(file) {
  if (path.isAbsolute(file)) return file
  const there = path.resolve(rootDir(), file)
  return fs.existsSync(there) || !fs.existsSync(path.resolve(file)) ? there : path.resolve(file)
}

const pdfResult = (file) => ({ pdf: file, pages: pdfPageCount(file) })

const DOCUMENTS = {
  resume: { label: 'Resume', build: (c) => buildResume(flattenBullets(c), loadFormat('resume')) },
  cv: { label: 'CV', build: (c) => buildResume(flattenBullets(c), loadFormat('resume')) },
  'cover-letter': { label: 'Cover Letter', build: (c) => buildCoverLetter(c, loadFormat('cover-letter')) },
}

function buildDocument(store, kind, input) {
  const doc = DOCUMENTS[kind]
  // Pin the evidence first, so a wrong id is reported before any file is written.
  const refs = [...(input.evidenceRefs || []), ...store.evidenceInContent(input.content)]
  const known = new Set(store.evidence().map((e) => e.id))
  const missing = refs.map((r) => (typeof r === 'string' ? r : r?.id)).filter((id) => !known.has(id))
  if (missing.length) throw new StoreError(400, `No career-library record ${missing.join(', ')}. Use the ids from brief.get or evidence.list.`)
  const buffer = doc.build(input.content)
  let target
  if (input.out) {
    const wanted = path.resolve(rootDir(), input.out)
    target = uniquePath(path.dirname(wanted), path.basename(wanted))
  } else {
    let sub = 'Drafts'
    if (input.applicationId) {
      const app = store.application(input.applicationId)
      sub = path.join('Drafts', safeName(`${app.company} - ${app.title}`))
    }
    target = uniquePath(path.join(folder('applications'), sub), `${safeName(input.content.name || 'Document')} ${doc.label}.docx`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, buffer, { flag: 'wx' })
  const result = { docx: target, placeholdersLeft: leftoverPlaceholders(buffer), words: wordCount(docxText(buffer)) }
  if (kind !== 'cover-letter') result.bulletNotes = checkBullets(input.content, store.evidence())
  if (kind === 'resume' && result.words > 950) result.bulletNotes.push({ where: 'Whole resume', code: 'dense', note: `${result.words} words. Two pages read well at about 750 to 900; readers stop finding the strongest points beyond that.` })
  if (kind === 'cv') result.publicationGaps = store.publications().gaps
  if (input.pdf) Object.assign(result, pdfResult(exportPdf(target)))
  if (input.save) {
    const { content: _content, file: _file, ...material } = store.saveMaterial({
      kind, title: input.title || path.basename(target, '.docx'),
      content: JSON.stringify(input.content, null, 2), file: target, applicationId: input.applicationId, evidenceRefs: refs.length || !input.materialId ? refs : undefined, words: result.words,
    }, { id: input.materialId, expectedVersion: input.expectedVersion, actor: 'agent' })
    result.material = { ...material, evidenceRefs: material.evidenceRefs.length }
  }
  return result
}

function checkDocument(given, store, { materialId, version } = {}) {
  const file = inWorkspace(given)
  const buffer = fs.readFileSync(path.resolve(file))
  const xml = readZip(buffer, { only: ['word/document.xml'] }).get('word/document.xml').toString('utf8')
  const result = {
    file: path.resolve(file), placeholdersLeft: leftoverPlaceholders(buffer), words: wordCount(docxText(buffer)),
    fonts: [...new Set([...xml.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]))],
    sizesPt: [...new Set([...xml.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => Number(m[1]) / 2))].sort((a, b) => a - b),
  }
  if (materialId) {
    const m = store.material(materialId, version)
    const doc = DOCUMENTS[m.kind]
    let content
    try { content = JSON.parse(m.content) } catch { /* saved as plain text */ }
    const squash = (v) => plain(v).replace(/\s+/g, ' ').toLowerCase()
    result.matchesSaved = content && doc ? squash(docxText(doc.build(content))) === squash(docxText(buffer)) : squash(m.content) === squash(docxText(buffer))
    result.evidenceChanged = store.materials().find((x) => x.id === materialId)?.evidenceChanged ?? false
  }
  return result
}

const many = (store, input, key, fn) => (Array.isArray(input[key]) ? store.t.transaction(() => input[key].map(fn)) : fn(input[key]))

export const OPERATIONS = {
  // ---------- profile and onboarding ----------
  'profile.get': { summary: 'Read the person\'s profile (name, contact, targets, submissionMode).', input: {}, run: (s) => s.profile() || { empty: true } },
  'profile.set': {
    summary: 'Save profile fields. Only send fields that change.',
    input: { fields: 'object — any of name, preferredName, publicationName, email, phone, city, links[], headline, disciplines[], locations[], workModels[], employmentPreferences, searchNotes, submissionMode ("review-first" | "auto-submit"), searchGoal { offers, applications, startDate, endDate, interviewRate, interviewToOfferRate, minutesPerApplication, hoursPerWeek, openingsPerWeek }', expectedVersion: T.version },
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
  'jobs.list': { summary: 'List jobs, optionally by stage or search text.', input: { stage: 'string — one of the stages', q: 'string — search text' }, run: (s, i) => s.applications(i).map(({ postingText, ...a }) => ({ ...a, hasPostingText: Boolean(postingText) })) },
  'jobs.get': { summary: 'One job with all fields.', input: { id: T.id }, required: ['id'], run: (s, i) => s.application(i.id) },
  'jobs.history': { summary: 'Every saved version of a job.', input: { id: T.id }, required: ['id'], run: (s, i) => s.history('application', i.id) },
  'jobs.add': {
    summary: 'Save a job found on an employer posting (or several with "jobs"). Duplicates of the same posting are refused.',
    input: { job: 'object — company, title, sourceUrl, location, workModel, discipline, requisition, deadline, whyFit, gaps, nextAction, priority 1-5, postingStatus, lastChecked, postedAt, postingText, dutySplit, aliases[], salary, employmentType', jobs: 'array — several job objects' },
    example: { job: { company: 'Northwind Biosciences', title: 'Research Coordinator', sourceUrl: 'https://boards.greenhouse.io/northwind-example/jobs/1', location: 'Springfield', whyFit: 'Grant writing and coordination', gaps: 'Budget ownership', lastChecked: '2026-11-25T15:00:00Z' } },
    run: (s, i) => (i.jobs ? many(s, i, 'jobs', (j) => s.addApplication(j, { actor: 'agent' })) : s.addApplication(i.job, { actor: 'agent' })),
  },
  'jobs.update': {
    summary: 'Change a job: stage, priority, nextAction, followUpOn, deadline, notes, whyFit, gaps, posting details.',
    input: { id: T.id, patch: 'object — fields to change (stage: Review|Preparing|Ready|Applied|Interview|Offer|Rejected|Withdrawn|Archived; postingText: the duties and qualifications as posted; qualificationMap: [{ qualification, status: met|partial|gap, evidence: [ids], required, note }])', expectedVersion: T.version },
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
  'jobs.rank': {
    summary: 'Rate jobs against the person\'s evidence: A prioritize, B good option, C stretch, Hold when a required qualification or eligibility is unmet or unconfirmed. Stages do not change.',
    input: { items: 'array — [{ id, tier, rank, reason, assessedAt?, expectedVersion? }]; rank 1 is best' }, required: ['items'],
    example: { items: [{ id: 'JOB_ID', tier: 'A', rank: 1, reason: 'Meets every required qualification; recruitment and REDCap are in the library.' }] },
    run: (s, i) => s.rankApplications(i.items, { actor: 'agent' }),
  },
  'jobs.shortlist': { summary: 'Jobs worth acting on now (open, checked in the last 14 days, not on hold), best first, plus ones to check first.', input: {}, run: (s) => s.shortlist() },
  'postings.check': {
    summary: 'Open posting links (read-only) and say whether each still shows the right job. Nothing is saved; record what you find with jobs.update.',
    input: { jobIds: 'array — saved jobs', postings: 'array — [{ company, title, sourceUrl }] not saved yet' },
    run: (s, i) => checkPostings([...(i.jobIds || []).map((id) => { const a = s.application(id); return { id, company: a.company, title: a.title, sourceUrl: a.sourceUrl } }), ...(i.postings || [])]),
  },
  'plan.get': { summary: 'Pace, workload and a rough chance of reaching the saved searchGoal. Assumptions, not a forecast.', input: {}, run: (s) => s.searchPlan() },

  'search.queue': { summary: 'Record a search to run (so it shows on the dashboard and can be resumed).', input: { title: 'string', query: 'string', location: 'string', notes: 'string' }, required: ['query'], run: (s, i) => s.queueResearch(i, { actor: 'agent' }) },
  'search.list': { summary: 'Searches and their status.', input: {}, run: (s) => s.researchTasks().map(({ claimToken, ...t }) => t) },
  'search.claim': {
    summary: 'Claim the next queued search (30-minute lease). Keep the returned claimToken for search.complete.',
    input: { worker: 'string — your agent name', taskId: 'string — a specific task' },
    run: (s, i) => s.claimResearch({ worker: i.worker || 'agent', taskId: i.taskId }) || { claimed: false, message: 'No queued searches.' },
  },
  'search.complete': {
    summary: 'Finish a claimed search with verified findings. Each finding is a job opened on the employer\'s own posting.',
    input: { taskId: 'string', claimToken: 'string', summary: 'string', findings: 'array — [{ company, title, sourceUrl, checkedAt, location, requisition, deadline, postedAt, postingStatus, whyFit, gaps, note, recommendation? }]' },
    required: ['taskId', 'claimToken', 'findings'],
    run: (s, i) => s.completeResearch(i, { actor: 'agent' }),
  },
  'search.fail': { summary: 'Put a claimed search back in the queue with the reason it could not be finished.', input: { taskId: 'string', claimToken: 'string', reason: 'string' }, required: ['taskId', 'claimToken', 'reason'], run: (s, i) => s.failResearch(i, { actor: 'agent' }) },
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
    input: { candidates: 'array — [{ company, title, sourceUrl, requisition, aliases? }]', criteriaVersion: 'string — name/version of the criteria you are applying' },
    required: ['candidates', 'criteriaVersion'],
    run: (s, i) => s.screeningPreflight({ candidates: i.candidates, criteriaVersion: i.criteriaVersion }),
  },
  'screen.record': {
    summary: 'Save shortlist / reject / hold decisions with reasons and posting evidence. Shortlisted jobs appear on the dashboard.',
    input: { decisions: 'array — [{ company, title, sourceUrl, requisition, decision, reason, evidence: [{ url, checkedAt }], whyFit, gaps, location, recheckAfter (holds), aliases, recheckReason }]', criteriaVersion: 'string' },
    required: ['decisions'],
    run: (s, i) => s.recordScreening(i),
  },
  'screen.reopen': { summary: 'Make a finished screening decision eligible again. The earlier decision is kept.', input: { id: T.id, reason: 'string', expectedVersion: T.version }, required: ['id', 'reason'], run: (s, i) => s.reopenScreening(i, { actor: 'agent' }) },
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
    summary: 'Save career facts (one with "item" or several with "items"). Facts from the person\'s documents or words are usable straight away (provided).',
    input: { item: 'object — kind (experience|project|achievement|education|skill|publication|other), title, organization, period, content, skills[], parentId, star{situation,task,action,result}, metrics[{value,unit,period,baseline,source,note,doubt (why this one number should stay out)}], sources[{label,locator,documentId}], gapsNoted[], bullets[], publication{authors[],venue,year,status,doi,role}, reviewStatus (provided|candidate-confirmed|source-verified|disputed|outdated)', items: 'array' },
    example: { item: { kind: 'achievement', title: 'Coordinated a three-clinic study', organization: 'Springfield University', period: '2022 – 2024', star: { situation: '…', task: '…', action: '…', result: '…' }, metrics: [{ value: '3', unit: 'partner clinics', period: '2022 – 2024' }], sources: [{ label: 'CV 2024.pdf', locator: 'page 2' }] } },
    run: (s, i) => (i.items ? many(s, i, 'items', (e) => s.addEvidence(e, { actor: 'agent' })) : s.addEvidence(i.item, { actor: 'agent' })),
  },
  'evidence.update': {
    summary: 'Change a career fact (STAR fields, metrics, sources, review status). Use disputed when sources disagree and outdated when a newer fact replaces it; both stay out of documents.',
    input: { id: T.id, patch: 'object', expectedVersion: T.version }, required: ['id', 'patch'],
    run: (s, i) => s.updateEvidence(i.id, i.patch, { expectedVersion: i.expectedVersion, actor: 'agent' }),
  },
  'evidence.get': { summary: 'Full career-library records by id (the brief shortens long ones).', input: { ids: 'array — evidence ids' }, required: ['ids'], run: (s, i) => s.evidenceByIds(i.ids) },
  'evidence.strength': { summary: 'STAR completeness of each experience, weakest first, with what is missing.', input: {}, run: (s) => s.experienceStrength() },
  'bullets.save': { summary: 'Keep good bullet wording with the career fact it describes, for reuse.', input: { items: 'array — [{ evidenceId, text, narratives?, usedFor? }]' }, required: ['items'], run: (s, i) => s.saveBullets(i.items, { actor: 'agent' }) },
  'bullets.list': { summary: 'Saved bullet wording, by search text, fact or narrative.', input: { q: 'string', evidenceId: T.id, narrative: 'string' }, run: (s, i) => s.bullets(i) },
  'bullets.check': {
    summary: 'Notes on resume bullets: numbers not in the evidence, missing dates or outcomes, weak starts, length, repetition. Notes never block anything.',
    input: { content: 'object — resume content', materialId: 'string — check a saved resume instead', version: 'integer' },
    run: (s, i) => { if (!i.content && !i.materialId) throw new StoreError(400, 'Give content or materialId'); return { notes: checkBullets(i.content || JSON.parse(s.material(i.materialId, i.version).content), s.evidence()) } },
  },
  'narratives.list': { summary: 'Reusable resume angles: what to lead with, in what order, for which fields.', input: {}, run: (s) => s.narratives() },
  'narratives.save': {
    summary: 'Save or change a resume angle.',
    input: { narrative: 'object — label, headline, summary, capabilities[], disciplines[], experience[{ evidenceId, achievements[] }]', id: 'string — to change an existing one', expectedVersion: T.version }, required: ['narrative'],
    run: (s, i) => s.saveNarrative(i.narrative, { id: i.id, expectedVersion: i.expectedVersion, actor: 'agent' }),
  },
  'publications.report': { summary: 'Saved publications by status, and what each citation still needs for an academic CV.', input: {}, run: (s) => s.publications() },
  'materials.list': { summary: 'Saved resumes, CVs, letters, essays and source documents.', input: { kind: 'string' }, run: (s, i) => s.materials(i) },
  'materials.get': { summary: 'One material, current or a specific version.', input: { id: T.id, version: 'integer' }, required: ['id'], run: (s, i) => s.material(i.id, i.version) },
  'materials.save': {
    summary: 'Save a material version (text and/or a file such as an original resume). Earlier versions are kept.',
    input: { material: 'object — kind (resume|cv|cover-letter|essay|answer|passage|other), title, content, file (path), applicationId, evidenceRefs[], prompt, wordLimit, reviewStatus, notes', id: 'string — to add a new version of an existing material', expectedVersion: T.version },
    required: ['material'],
    run: (s, i) => s.saveMaterial(i.material, { id: i.id, expectedVersion: i.expectedVersion, actor: 'agent' }),
  },
  'brief.get': { summary: 'Everything needed to tailor documents for one job: posting, profile, narratives, rules in force, all usable evidence with stories, numbers and bullets, checklist.', input: { applicationId: T.id, materialKind: 'string — resume|cv|cover-letter|essay|answer, to show only its rules', narrative: 'string — use this narrative', detail: 'string — compact (default) or full' }, required: ['applicationId'], run: (s, i) => s.brief(i.applicationId, { materialKind: i.materialKind, narrative: i.narrative, detail: i.detail }) },
  'packets.create': { summary: 'Freeze the exact documents, posting and facts behind one application. Warnings are notes; they never block.', input: { applicationId: T.id, items: 'array — [{ materialId, version }]', answers: 'array', notes: 'string' }, required: ['applicationId', 'items'], run: (s, i) => s.createPacket(i, { actor: 'agent' }) },

  // ---------- writing rules ----------
  'rules.list': { summary: 'Writing rules: active ones and all with status.', input: { status: 'string' }, run: (s, i) => (i.status ? s.rules({ status: i.status }) : { active: s.activeRules(), all: s.rules() }) },
  'rules.save': {
    summary: 'Save a writing rule from something the person said (a correction or preference), in force straight away. Their words are the approval; do not ask again.',
    input: { rule: 'object — id? (to replace one), title, rule, whenRelevant, materialKinds[], example, narrativeIds[], applicationIds[] (limit to these jobs), evidenceRefs[]', approvalText: 'string — their words', approvalSource: 'string — e.g. "chat, 2026-11-25"', expectedVersion: T.version },
    required: ['rule', 'approvalText', 'approvalSource'],
    run: (s, i) => { const r = s.saveRule(i.rule, { approvalText: i.approvalText, approvalSource: i.approvalSource, expectedVersion: i.expectedVersion }); refreshRules(s); return r },
  },
  'rules.propose': { summary: 'Suggest a reusable writing rule (it is not used until the person approves it).', input: { rule: 'object — id?, title, rule, rationale, whenRelevant, materialKinds[], example, narrativeIds[], applicationIds[], evidenceRefs[]' }, required: ['rule'], run: (s, i) => { const r = s.proposeRule(i.rule); refreshRules(s); return r } },
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
    summary: 'Render a resume .docx (and optionally PDF) from content JSON using the format in 3 Templates. Returns bulletNotes.',
    input: { content: 'object — see 3 Templates/Format Guide.md', applicationId: T.id, out: 'string — file path', pdf: 'boolean', save: 'boolean — also save as a material version', title: 'string', materialId: 'string', expectedVersion: T.version, evidenceRefs: 'array' },
    required: ['content'],
    example: { applicationId: 'JOB_ID', save: true, title: 'Resume - Example Lab', content: { name: 'Alex Rivera', contact: ['Springfield', 'alex@example.com'], summary: '…', sections: [{ heading: 'Grant Development', bullets: [{ text: '**Field grant (2024).** Wrote the proposal (PI: Dr. Example); funded for two years.', evidence: ['EVIDENCE_ID'] }] }, { heading: 'Experience', entries: [{ title: 'Coordinator', organization: 'Example Lab', dates: '2022 – present', evidenceId: 'EVIDENCE_ID', bullets: ['…'] }] }, { heading: 'Education', type: 'education', entries: [{ title: 'BSc', organization: 'Example University', dates: '2021' }] }] } },
    run: (s, i) => buildDocument(s, 'resume', i),
  },
  'docs.cv': {
    summary: 'Render an academic CV .docx from content JSON (same shape as a resume, any length). Returns bulletNotes and publicationGaps.',
    input: { content: 'object — see 3 Templates/Format Guide.md', applicationId: T.id, out: 'string — file path', pdf: 'boolean', save: 'boolean', title: 'string', materialId: 'string', expectedVersion: T.version, evidenceRefs: 'array' },
    required: ['content'],
    run: (s, i) => buildDocument(s, 'cv', i),
  },
  'docs.cover-letter': {
    summary: 'Render a cover letter .docx (and optionally PDF) from content JSON.',
    input: { content: 'object', applicationId: T.id, out: 'string', pdf: 'boolean', save: 'boolean', title: 'string', materialId: 'string', expectedVersion: T.version, evidenceRefs: 'array' },
    required: ['content'],
    run: (s, i) => buildDocument(s, 'cover-letter', i),
  },
  'docs.pdf': { summary: 'Export a .docx to PDF next to it. Returns the page count.', input: { file: 'string' }, required: ['file'], example: { file: '1 Applications/Drafts/Example Lab - Coordinator/Alex Rivera Resume.docx' }, run: (s, i) => pdfResult(exportPdf(inWorkspace(i.file))) },
  'docs.text': { summary: 'Plain text of a .docx (e.g. an imported resume) for reading.', input: { file: 'string' }, required: ['file'], run: (s, i) => { const file = inWorkspace(i.file); return { file, text: docxText(fs.readFileSync(file)) } } },
  'docs.check': { summary: 'Leftover placeholders, word count, fonts and sizes in a .docx, and whether its text matches the saved material.', input: { file: 'string', materialId: 'string — compare with this saved material', version: 'integer' }, required: ['file'], run: (s, i) => checkDocument(i.file, s, i) },
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
const NO_STORE = new Set(['backup.restore', 'backup.list', 'backup.now', 'backup.mirror', 'storage.report', 'files.archive', 'docs.pdf', 'docs.text'])
OPERATIONS['backup.restore'] = {
  summary: 'Restore a snapshot (the current database is backed up first). The dashboard must be closed.',
  input: { file: 'string — from backup.list' }, required: ['file'],
  run: (s, i) => restoreBackup(i.file),
}

const READ_ONLY = /\.(list|get|history|strength|sectors|report|check|text|shortlist)$|^brief\.|^discover\.|^screen\.preflight$/

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
