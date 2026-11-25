import { after, test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { isolate, job } from './helpers.mjs'

const home = isolate('store')
const { openStore, canonicalUrl, starScore, StoreError } = await import('../lib/store.mjs')

let n = 0
/** A store on its own database file inside this test file's temp workspace. */
const opened = []
after(() => { for (const s of opened) try { s.close() } catch {} })
function fresh() {
  const s = openStore({ file: path.join(home, 'db', `store-${++n}.sqlite`) })
  opened.push(s)
  return s
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

function rejects(fn, status, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof StoreError, `expected StoreError, got ${error?.constructor?.name}: ${error?.message}`)
    assert.equal(error.status, status, error.message)
    if (pattern) assert.match(error.message, pattern)
    return true
  })
}

const evidence = (url = 'https://boards.greenhouse.io/maple/jobs/1') => [{ url, checkedAt: '2026-11-20T10:00:00Z' }]

describe('applications', () => {
  test('canonicalUrl ignores tracking parameters, fragments, case of host and www', () => {
    const base = 'https://boards.greenhouse.io/maple/jobs/1001'
    assert.equal(canonicalUrl(`${base}?utm_source=x&utm_medium=y`), canonicalUrl(base))
    assert.equal(canonicalUrl(`${base}?gh_src=abc#apply`), canonicalUrl(base))
    assert.equal(canonicalUrl('https://WWW.Example.com/jobs/1/'), canonicalUrl('https://example.com/jobs/1'))
    assert.notEqual(canonicalUrl('https://example.com/job?id=1'), canonicalUrl('https://example.com/job?id=2'))
    // canonical form is stable when fed back in (preflight passes canonical keys back to findApplication)
    for (const u of ['https://example.com/?id=1', 'https://example.com/jobs/?b=2&a=1', `${base}?gh_jid=5`]) {
      assert.equal(canonicalUrl(canonicalUrl(u)), canonicalUrl(u))
    }
  })

  test('adding the same posting through a tracking link is rejected with 409 and the existing id', () => {
    const s = fresh()
    const first = s.addApplication(job())
    assert.equal(first.stage, 'Review')
    assert.equal(first.version, 1)
    assert.throws(() => s.addApplication(job({ sourceUrl: `${job().sourceUrl}?gh_src=linkedin&utm_source=feed` })), (e) => {
      assert.equal(e.status, 409)
      assert.equal(e.details.existingId, first.id)
      return true
    })
    assert.equal(s.applications().length, 1)
  })

  test('a different requisition at the same employer is a different job', () => {
    const s = fresh()
    s.addApplication(job({ sourceUrl: 'https://maple.example.com/careers/job?req=R-1', requisition: 'R-1' }))
    const second = s.addApplication(job({ sourceUrl: 'https://maple.example.com/careers/job?req=R-2', requisition: 'R-2' }))
    assert.ok(second.id)
    assert.equal(s.applications().length, 2)
  })

  test('same company + requisition is a duplicate even with a different link', () => {
    const s = fresh()
    s.addApplication(job({ requisition: 'R-77', sourceUrl: 'https://maple.example.com/a' }))
    rejects(() => s.addApplication(job({ requisition: 'r-77', sourceUrl: 'https://jobs.example.org/b' })), 409)
  })

  test('validation: company, title, stage, priority and http(s) links', () => {
    const s = fresh()
    rejects(() => s.addApplication({ title: 'X' }), 400, /company/)
    rejects(() => s.addApplication({ company: 'X' }), 400, /title/)
    rejects(() => s.addApplication(job({ stage: 'Dreaming' })), 400, /stage/)
    rejects(() => s.addApplication(job({ priority: 9 })), 400, /priority/)
    rejects(() => s.addApplication(job({ sourceUrl: 'javascript:alert(1)' })), 400, /sourceUrl/)
    assert.equal(s.applications().length, 0)
  })

  test('optimistic expectedVersion: stale writes get 409 and change nothing', () => {
    const s = fresh()
    const app = s.addApplication(job())
    const v2 = s.updateApplication(app.id, { notes: 'first edit' }, { expectedVersion: 1 })
    assert.equal(v2.version, 2)
    rejects(() => s.updateApplication(app.id, { notes: 'stale edit' }, { expectedVersion: 1 }), 409)
    assert.equal(s.application(app.id).notes, 'first edit')
    rejects(() => s.updateApplication('missing', { notes: 'x' }), 404)
  })

  test('changing an application link to one already saved is refused', () => {
    const s = fresh()
    const a = s.addApplication(job())
    const b = s.addApplication(job({ sourceUrl: 'https://boards.greenhouse.io/mapleanalytics/jobs/2002' }))
    rejects(() => s.updateApplication(b.id, { sourceUrl: `${a.sourceUrl}?utm_source=x` }), 409)
  })

  test('an update that changes nothing does not create a version', () => {
    const s = fresh()
    const app = s.addApplication(job({ notes: 'same' }))
    const again = s.updateApplication(app.id, { notes: 'same' })
    assert.equal(again.version, 1)
    assert.equal(s.history('application', app.id).length, 1)
  })

  test('history keeps every version with its data', () => {
    const s = fresh()
    const app = s.addApplication(job())
    s.updateApplication(app.id, { stage: 'Preparing' })
    s.updateApplication(app.id, { stage: 'Ready', notes: 'cover letter drafted' })
    const h = s.history('application', app.id)
    assert.deepEqual(h.map((v) => v.version), [1, 2, 3])
    assert.deepEqual(h.map((v) => v.stage), ['Review', 'Preparing', 'Ready'])
    assert.equal(h[2].notes, 'cover letter drafted')
  })

  test('bulkUpdate is atomic: one bad item means none are applied', () => {
    const s = fresh()
    const a = s.addApplication(job())
    const b = s.addApplication(job({ sourceUrl: 'https://boards.greenhouse.io/mapleanalytics/jobs/2' }))
    const revision = s.revision()
    rejects(() => s.bulkUpdate([
      { id: a.id, patch: { stage: 'Preparing' }, expectedVersion: 1 },
      { id: b.id, patch: { stage: 'Preparing' }, expectedVersion: 7 },
    ]), 409)
    assert.equal(s.application(a.id).stage, 'Review')
    assert.equal(s.application(a.id).version, 1)
    assert.equal(s.revision(), revision, 'no events were written')
    rejects(() => s.bulkUpdate([{ id: a.id, patch: { stage: 'Ready' } }, { id: b.id, patch: { stage: 'Nope' } }]), 400)
    assert.equal(s.application(a.id).stage, 'Review')
    const ok = s.bulkUpdate([{ id: a.id, patch: { stage: 'Ready' } }, { id: b.id, patch: { priority: 1 } }])
    assert.equal(ok.length, 2)
    assert.equal(s.application(a.id).stage, 'Ready')
    assert.equal(s.application(b.id).priority, 1)
  })

  test('the store keeps working after a failed transaction', () => {
    const s = fresh()
    const a = s.addApplication(job())
    rejects(() => s.bulkUpdate([{ id: a.id, patch: {} , expectedVersion: 5 }]), 409)
    assert.equal(s.t.inTransaction, false)
    s.updateApplication(a.id, { notes: 'still writable' })
    assert.equal(s.application(a.id).notes, 'still writable')
  })
})

describe('append-only database', () => {
  test('triggers block DELETE/UPDATE on events and record_versions, and DELETE on records', () => {
    const s = fresh()
    const app = s.addApplication(job())
    s.updateApplication(app.id, { notes: 'v2' })
    const blocked = [
      'DELETE FROM events', // check-repo: allow-deletion (verifies the trigger blocks it)
      "UPDATE events SET type = 'tampered'",
      'DELETE FROM record_versions', // check-repo: allow-deletion
      "UPDATE record_versions SET data = '{}'",
      'DELETE FROM records', // check-repo: allow-deletion
    ]
    for (const sql of blocked) assert.throws(() => s.db.exec(sql), /append-only|never deleted/, sql)
    assert.equal(s.history('application', app.id).length, 2)
    assert.equal(s.application(app.id).notes, 'v2')
    assert.ok(s.revision() >= 2)
  })

  test('INSERT OR REPLACE cannot overwrite events, history or current records', () => {
    const s = fresh()
    const app = s.addApplication(job())
    const before = s.history('application', app.id)
    const replaces = [
      "INSERT OR REPLACE INTO events (seq, at, actor, type, kind, record_id, version, payload) VALUES (1, 'x', 'x', 'x', 'x', 'x', 1, '{}')",
      `INSERT OR REPLACE INTO record_versions (kind, id, version, data, at, actor) VALUES ('application', '${app.id}', 1, '{}', 'x', 'x')`,
      `INSERT OR REPLACE INTO records (kind, id, version, data, created_at, updated_at) VALUES ('application', '${app.id}', 1, '{}', 'x', 'x')`,
    ]
    for (const sql of replaces) assert.throws(() => s.db.exec(sql), /append-only|never deleted/, sql)
    assert.deepEqual(s.history('application', app.id), before)
    assert.equal(s.application(app.id).company, 'Maple Analytics')
  })

  test('reopening a database keeps data and schema version', () => {
    const file = path.join(home, 'db', 'reopen.sqlite')
    const a = openStore({ file })
    const app = a.addApplication(job())
    a.close()
    const b = openStore({ file })
    assert.equal(b.application(app.id).company, 'Maple Analytics')
    assert.equal(b.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '1')
  })

  test('a database from a newer schema is refused instead of being modified', () => {
    const file = path.join(home, 'db', 'future.sqlite')
    const a = openStore({ file })
    a.db.prepare("UPDATE meta SET value = '999' WHERE key = 'schema_version'").run()
    a.close()
    assert.throws(() => openStore({ file }), /newer version/)
  })
})

describe('research queue', () => {
  const finding = (over = {}) => ({
    company: 'Birch Labs', title: 'Research Scientist', sourceUrl: 'https://jobs.lever.co/birch/abc-123',
    checkedAt: '2026-11-24T09:00:00Z', postingStatus: 'open', note: 'Posting open; deadline listed', ...over,
  })

  test('queue → claim (token + lease) → complete adds cited findings', () => {
    const s = fresh()
    const task = s.queueResearch({ title: 'Research scientist roles', query: 'research scientist', location: 'Remote' })
    assert.equal(task.status, 'queued')
    const claim = s.claimResearch({ worker: 'agent-1' })
    assert.equal(claim.task.id, task.id)
    assert.match(claim.claimToken, /^[0-9a-f]{24}$/)
    assert.ok(Date.parse(claim.leaseUntil) > Date.now())
    assert.equal(s.claimResearch({ worker: 'agent-2' }), null, 'an active claim is not handed out twice')
    const done = s.completeResearch({ taskId: task.id, claimToken: claim.claimToken, summary: 'one match', findings: [finding()] })
    assert.equal(done.task.status, 'completed')
    assert.equal(done.task.resultCount, 1)
    assert.equal(done.task.claimToken, undefined, 'token is not kept on the completed task')
    assert.equal(done.results[0].action, 'added')
    const app = s.application(done.results[0].id)
    assert.equal(app.stage, 'Review')
    assert.equal(app.source, 'research')
    assert.equal(app.lastChecked, '2026-11-24T09:00:00Z')
  })

  test('findings must cite an employer link and checkedAt; bad input changes nothing', () => {
    const s = fresh()
    const task = s.queueResearch({ query: 'analyst' })
    const { claimToken } = s.claimResearch()
    rejects(() => s.completeResearch({ taskId: task.id, claimToken, findings: [finding({ sourceUrl: 'not a link' })] }), 400, /sourceUrl/)
    rejects(() => s.completeResearch({ taskId: task.id, claimToken, findings: [finding({ checkedAt: undefined })] }), 400, /checkedAt/)
    rejects(() => s.completeResearch({ taskId: task.id, claimToken, findings: [finding({ checkedAt: 'yesterday-ish' })] }), 400, /checkedAt/)
    assert.equal(s.applications().length, 0)
    assert.equal(s.researchTasks()[0].status, 'claimed')
  })

  test('refreshing an existing job keeps its stage and notes, updating only posting evidence', () => {
    const s = fresh()
    const existing = s.addApplication(job({ company: 'Birch Labs', title: 'Research Scientist', sourceUrl: 'https://jobs.lever.co/birch/abc-123', notes: 'Spoke to recruiter' }))
    s.updateApplication(existing.id, { stage: 'Interview' })
    const task = s.queueResearch({ query: 'birch' })
    const { claimToken } = s.claimResearch()
    const done = s.completeResearch({ taskId: task.id, claimToken, findings: [finding({ sourceUrl: 'https://jobs.lever.co/birch/abc-123?lever-source=LinkedIn', postingStatus: 'closed', stage: 'Review', notes: 'overwrite attempt' })] })
    assert.equal(done.results[0].action, 'refreshed')
    const app = s.application(existing.id)
    assert.equal(app.stage, 'Interview')
    assert.equal(app.notes, 'Spoke to recruiter')
    assert.equal(app.postingStatus, 'closed')
    assert.equal(app.lastChecked, '2026-11-24T09:00:00Z')
    assert.equal(s.applications().length, 1)
  })

  test('wrong token → 409; an expired lease can be reclaimed and the old token stops working', () => {
    const s = fresh()
    const task = s.queueResearch({ query: 'lab manager' })
    const first = s.claimResearch({ worker: 'slow-agent' })
    rejects(() => s.completeResearch({ taskId: task.id, claimToken: 'not-the-token', findings: [] }), 409)
    // simulate lease expiry through the normal versioned update path
    s.t.update('research_task', task.id, (cur) => ({ ...cur, leaseUntil: new Date(Date.now() - 60000).toISOString() }))
    const second = s.claimResearch({ worker: 'fresh-agent' })
    assert.ok(second, 'expired lease is reclaimable')
    assert.notEqual(second.claimToken, first.claimToken)
    rejects(() => s.completeResearch({ taskId: task.id, claimToken: first.claimToken, findings: [] }), 409)
    const done = s.completeResearch({ taskId: task.id, claimToken: second.claimToken, findings: [] })
    assert.equal(done.task.status, 'completed')
    rejects(() => s.completeResearch({ taskId: task.id, claimToken: second.claimToken, findings: [] }), 409, /not active/)
  })

  test('completing after the lease expired (before anyone reclaims it) is refused', () => {
    const s = fresh()
    const task = s.queueResearch({ query: 'expired lease' })
    const { claimToken } = s.claimResearch()
    s.t.update('research_task', task.id, (cur) => ({ ...cur, leaseUntil: new Date(Date.now() - 60000).toISOString() }))
    rejects(() => s.completeResearch({ taskId: task.id, claimToken, findings: [] }), 409)
  })

  test('the claim token is not exposed in the dashboard snapshot', () => {
    const s = fresh()
    s.queueResearch({ query: 'token check' })
    s.claimResearch()
    assert.equal(s.snapshot().researchTasks[0].claimToken, undefined)
  })
})

describe('screening', () => {
  const decision = (over = {}) => ({
    company: 'Cedar Institute', title: 'Program Coordinator', sourceUrl: 'https://cedar.example.org/jobs/42',
    decision: 'reject', reason: 'Lab-only role', evidence: evidence('https://cedar.example.org/jobs/42'), ...over,
  })

  test('preflight reports eligible / existing-application / already-decided / duplicate-in-batch / invalid', () => {
    const s = fresh()
    const saved = s.addApplication(job({ sourceUrl: 'https://maple.example.com/jobs/1' }))
    s.recordScreening({ criteriaVersion: 'v1', decisions: [decision()] })
    const r = s.screeningPreflight({
      criteriaVersion: 'v2',
      candidates: [
        { company: 'New Co', title: 'Analyst', sourceUrl: 'https://new.example.com/jobs/9' },
        { company: 'Maple Analytics', title: 'Data Scientist', sourceUrl: 'https://maple.example.com/jobs/1?utm_source=board' },
        { company: 'Cedar Institute', title: 'Program Coordinator', url: 'https://cedar.example.org/jobs/42' },
        { company: 'New Co', title: 'Analyst (repost)', sourceUrl: 'https://new.example.com/jobs/9?gh_src=x' },
        { company: 'No Link Co', title: 'Mystery' },
      ],
    })
    assert.deepEqual(r.report.map((x) => x.status), ['eligible', 'existing-application', 'already-decided', 'duplicate-in-batch', 'invalid'])
    assert.equal(r.report[1].applicationId, saved.id)
    assert.equal(r.report[2].decision, 'reject')
    assert.deepEqual(r.counts, { eligible: 1, 'existing-application': 1, 'already-decided': 1, 'duplicate-in-batch': 1, invalid: 1 })
    assert.equal(r.eligible.length, 1)
    rejects(() => s.screeningPreflight({ candidates: [] }), 400, /criteriaVersion/)
  })

  test('record requires employer evidence and a reason; nothing partial is saved', () => {
    const s = fresh()
    rejects(() => s.recordScreening({ decisions: [decision({ evidence: [] })] }), 400, /evidence/)
    rejects(() => s.recordScreening({ decisions: [decision({ evidence: [{ url: 'https://cedar.example.org/jobs/42' }] })] }), 400, /evidence/)
    rejects(() => s.recordScreening({ decisions: [decision({ reason: '' })] }), 400, /reason/)
    rejects(() => s.recordScreening({ decisions: [decision({ decision: 'maybe' })] }), 400, /decision/)
    rejects(() => s.recordScreening({ decisions: [decision(), decision({ sourceUrl: 'https://cedar.example.org/jobs/43', evidence: 'none' })] }), 400)
    assert.equal(s.screeningDecisions().length, 0)
  })

  test('a re-decision needs recheckReason and supersedes the earlier one', () => {
    const s = fresh()
    const [first] = s.recordScreening({ criteriaVersion: 'v1', decisions: [decision({ decision: 'hold', reason: 'Duty split unclear' })] })
    rejects(() => s.recordScreening({ criteriaVersion: 'v1', decisions: [decision({ sourceUrl: 'https://cedar.example.org/jobs/42?utm_campaign=x' })] }), 409, /recheckReason/)
    const [second] = s.recordScreening({ criteriaVersion: 'v2', decisions: [decision({ recheckReason: 'Employer published duty split' })] })
    const all = s.screeningDecisions()
    assert.equal(all.length, 2)
    assert.equal(all.find((d) => d.id === first.id).superseded, true)
    const current = all.find((d) => d.id === second.id)
    assert.equal(current.previousDecisionId, first.id)
    assert.equal(current.criteriaVersion, 'v2')
    const pre = s.screeningPreflight({ criteriaVersion: 'v2', candidates: [{ sourceUrl: 'https://cedar.example.org/jobs/42' }] })
    assert.equal(pre.report[0].decision, 'reject')
  })

  test('shortlist creates an application (once) with the screening evidence', () => {
    const s = fresh()
    const [r] = s.recordScreening({ criteriaVersion: 'v1', decisions: [decision({ decision: 'shortlist', reason: 'Strong match on grants work' })] })
    assert.ok(r.applicationId)
    const app = s.application(r.applicationId)
    assert.equal(app.stage, 'Review')
    assert.equal(app.source, 'screening')
    assert.equal(app.whyFit, 'Strong match on grants work')
    assert.equal(app.lastChecked, '2026-11-20T10:00:00Z')
    const [again] = s.recordScreening({ decisions: [decision({ decision: 'shortlist', recheckReason: 'confirm', sourceUrl: 'https://cedar.example.org/jobs/42?ref=feed' })] })
    assert.equal(again.applicationId, r.applicationId)
    assert.equal(s.applications().length, 1)
    const [reject] = s.recordScreening({ decisions: [decision({ sourceUrl: 'https://cedar.example.org/jobs/99', evidence: evidence('https://cedar.example.org/jobs/99') })] })
    assert.equal(reject.applicationId, undefined)
  })
})

describe('employers', () => {
  test('add, duplicate name (case/punctuation-insensitive) → 409, link validation, platform detection', () => {
    const s = fresh()
    const e = s.addEmployer({ name: 'Aspen Health', sector: 'Health', careersUrl: 'https://aspen.wd3.myworkdayjobs.com/External' })
    assert.equal(e.id, 'aspen-health')
    assert.equal(e.platform, 'Workday')
    rejects(() => s.addEmployer({ name: 'ASPEN  health!' }), 409)
    rejects(() => s.addEmployer({ name: 'Bad Link', careersUrl: 'ftp://example.com' }), 400, /careersUrl/)
    rejects(() => s.addEmployer({ sector: 'x' }), 400, /name/)
    const u = s.updateEmployer(e.id, { notes: 'Large hiring cycle in spring', name: 'Renamed?' })
    assert.equal(u.notes, 'Large hiring cycle in spring')
    assert.equal(u.name, 'Aspen Health', 'name is not editable through updateEmployer')
  })
})

describe('career library', () => {
  test('evidence validation and review status', () => {
    const s = fresh()
    rejects(() => s.addEvidence({ kind: 'hobby', title: 'x' }), 400, /kind/)
    rejects(() => s.addEvidence({ kind: 'project' }), 400, /title/)
    rejects(() => s.addEvidence({ kind: 'project', title: 'x', reviewStatus: 'approved' }), 400, /reviewStatus/)
    const ev = s.addEvidence({ kind: 'achievement', title: 'Rewrote a grant that was funded', skills: ['writing', 7] })
    assert.equal(ev.reviewStatus, 'needs-review')
    assert.deepEqual(ev.skills, ['writing', '7'])
    const up = s.updateEvidence(ev.id, { reviewStatus: 'candidate-confirmed' }, { expectedVersion: 1 })
    assert.equal(up.version, 2)
    assert.equal(up.title, 'Rewrote a grant that was funded')
    rejects(() => s.updateEvidence(ev.id, { reviewStatus: 'source-verified' }, { expectedVersion: 1 }), 409)
  })

  test('materials are versioned; files are stored once by content hash and never overwritten', () => {
    const s = fresh()
    const src = path.join(home, 'inputs', `resume-${n}.DOCX`)
    fs.mkdirSync(path.dirname(src), { recursive: true })
    fs.writeFileSync(src, 'fake docx bytes v1')
    const m = s.saveMaterial({ kind: 'resume', title: 'Base resume', content: 'v1 text', file: src })
    const hash = sha(Buffer.from('fake docx bytes v1'))
    assert.equal(m.file.sha256, hash)
    const stored = path.join(home, 'app', 'data', m.file.stored)
    assert.equal(path.basename(stored), `${hash}.docx`)
    assert.equal(fs.readFileSync(stored, 'utf8'), 'fake docx bytes v1')

    // same bytes under another name reuse the stored file
    const copy = path.join(path.dirname(src), `copy-${n}.docx`)
    fs.writeFileSync(copy, 'fake docx bytes v1')
    const m2 = s.saveMaterial({ kind: 'resume', title: 'Copy', file: copy })
    assert.equal(m2.file.stored, m.file.stored)

    const v2 = s.saveMaterial({ kind: 'resume', title: 'Base resume', content: 'v2 text' }, { id: m.id, expectedVersion: 1 })
    assert.equal(v2.version, 2)
    assert.equal(v2.file.sha256, hash, 'file reference is kept when only text changes')
    assert.equal(s.material(m.id, 1).content, 'v1 text')
    assert.equal(s.material(m.id).content, 'v2 text')
    rejects(() => s.saveMaterial({ kind: 'resume', title: 'x', content: 'y' }, { id: m.id, expectedVersion: 1 }), 409)
    rejects(() => s.saveMaterial({ kind: 'poem', title: 'x', content: 'y' }), 400, /kind/)
    rejects(() => s.saveMaterial({ kind: 'resume', title: 'x' }), 400, /content/)
    rejects(() => s.material(m.id, 9), 404)
    assert.equal(s.materials().find((x) => x.id === m.id).content, undefined, 'list view carries an excerpt, not full content')
  })

  test('packets freeze the material versions they were built from', () => {
    const s = fresh()
    const app = s.addApplication(job())
    const m = s.saveMaterial({ kind: 'cover-letter', title: 'Letter', content: 'draft one' })
    const packet = s.createPacket({ applicationId: app.id, items: [{ materialId: m.id }] })
    s.saveMaterial({ kind: 'cover-letter', title: 'Letter', content: 'draft two' }, { id: m.id })
    const frozen = s.packets().find((p) => p.id === packet.id).items[0]
    assert.equal(frozen.version, 1)
    assert.equal(s.material(frozen.materialId, frozen.version).content, 'draft one')
    rejects(() => s.createPacket({ applicationId: app.id, items: [] }), 400)
    rejects(() => s.createPacket({ applicationId: 'missing', items: [{ materialId: m.id }] }), 404)
  })
})

describe('writing rules', () => {
  const starter = JSON.parse(fs.readFileSync(new URL('../templates/writing-rules.json', import.meta.url), 'utf8')).rules

  test('seedStarterRules adds every bundled rule once; starters are active, proposals are not', () => {
    const s = fresh()
    assert.equal(s.seedStarterRules().added, starter.length)
    assert.equal(s.seedStarterRules().added, 0)
    const starters = starter.filter((r) => r.status === 'starter').length
    assert.equal(s.activeRules().length, starters)
    assert.equal(s.rules({ status: 'proposed' }).length, starter.length - starters)
  })

  test('propose → approve needs quoted text, a source and the current version', () => {
    const s = fresh()
    const r = s.proposeRule({ title: 'Use plain verbs', rule: 'Prefer "led" over "spearheaded".' })
    assert.equal(r.status, 'proposed')
    assert.equal(s.activeRules().length, 0)
    rejects(() => s.approveRule(r.id, { version: 1, approvalSource: 'chat' }), 400, /approvalText/)
    rejects(() => s.approveRule(r.id, { version: 1, approvalText: 'yes' }), 400, /approvalSource/)
    rejects(() => s.approveRule(r.id, { version: 2, approvalText: 'yes', approvalSource: 'chat' }), 409)
    rejects(() => s.approveRule('nope', { version: 1, approvalText: 'yes', approvalSource: 'chat' }), 404)
    const ok = s.approveRule(r.id, { version: 1, approvalText: 'Yes, use that rule', approvalSource: 'chat, 2026-11-25' })
    assert.equal(ok.status, 'approved')
    assert.equal(ok.approvals[0].version, 1)
    assert.equal(ok.approvals[0].approvalText, 'Yes, use that rule')
    assert.deepEqual(s.activeRules().map((x) => x.rule), ['Prefer "led" over "spearheaded".'])
    rejects(() => s.proposeRule({ title: 'Use plain verbs', rule: 'dup' }), 409)
  })

  test('revise keeps the old approved wording active until the new version is approved', () => {
    const s = fresh()
    const r = s.proposeRule({ id: 'dates', title: 'Date metrics', rule: 'Date every metric.' })
    s.approveRule(r.id, { version: 1, approvalText: 'ok', approvalSource: 'chat' })
    const revised = s.reviseRule(r.id, { rule: 'Date and define every metric.' })
    assert.equal(revised.status, 'proposed')
    let active = s.activeRules()
    assert.equal(active.length, 1)
    assert.equal(active[0].rule, 'Date every metric.')
    assert.equal(active[0].pendingRevision, revised.version)
    // a second revision before approval still keeps the originally approved wording
    const again = s.reviseRule(r.id, { rule: 'Date, define and source every metric.' })
    assert.equal(s.activeRules()[0].rule, 'Date every metric.')
    rejects(() => s.approveRule(r.id, { version: revised.version, approvalText: 'ok', approvalSource: 'chat' }), 409)
    s.approveRule(r.id, { version: again.version, approvalText: 'ok', approvalSource: 'chat' })
    active = s.activeRules()
    assert.equal(active[0].rule, 'Date, define and source every metric.')
    assert.equal(active[0].pendingRevision, undefined)
    assert.equal(s.rules()[0].active, undefined)
  })

  test('retire removes a rule from the active set and needs a reason', () => {
    const s = fresh()
    s.seedStarterRules()
    const before = s.activeRules().length
    const id = starter.find((x) => x.status === 'starter').id
    rejects(() => s.retireRule(id, {}), 400, /reason/)
    const retired = s.retireRule(id, { reason: 'Person asked to stop using it' })
    assert.equal(retired.status, 'retired')
    assert.equal(s.activeRules().length, before - 1)
    assert.ok(!s.activeRules().some((x) => x.id === id))
  })
})

describe('brief and submissions', () => {
  function setup() {
    const s = fresh()
    s.setProfile({ name: 'Jordan Example', email: 'jordan@example.com', notAllowed: 'dropped' })
    s.seedStarterRules()
    s.addEvidence({ kind: 'project', title: 'Built a dashboard', content: 'Used weekly by 40 people' })
    s.addEvidence({ kind: 'skill', title: 'Python', reviewStatus: 'candidate-confirmed' })
    s.saveMaterial({ kind: 'resume', title: 'Base resume', content: '{}' })
    s.saveMaterial({ kind: 'answer', title: 'Why us', content: 'Because' })
    const app = s.addApplication(job({ company: 'Aspen / Health', title: 'Analyst: Data', requisition: 'R-9' }))
    return { s, app }
  }

  test('brief contains the application, profile, rules split, evidence, templates and checklist', () => {
    const { s, app } = setup()
    const b = s.brief(app.id)
    assert.equal(b.application.id, app.id)
    assert.equal(b.profile.name, 'Jordan Example')
    assert.equal(b.profile.notAllowed, undefined)
    assert.ok(b.rules.active.length > 0)
    assert.ok(b.rules.proposed.length > 0)
    assert.ok(b.rules.active.every((r) => r.status === 'starter' || r.status === 'approved'))
    assert.equal(b.evidence.length, 2)
    assert.equal(b.unreviewedEvidence, 1)
    assert.deepEqual(b.templates.map((t) => t.kind), ['resume'])
    assert.ok(Array.isArray(b.checklist) && b.checklist.length > 0)
    assert.deepEqual(b.previousSubmissions, [])
    assert.throws(() => s.brief('missing'), (e) => e.status === 404)
  })

  test('recordSubmission requires the person to confirm they submitted', () => {
    const { s, app } = setup()
    rejects(() => s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20' }), 400, /confirm/)
    rejects(() => s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: 'yes' }), 400, /confirm/)
    rejects(() => s.recordSubmission({ applicationId: app.id, confirmedBySubmitter: true }), 400, /submittedAt/)
    rejects(() => s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, files: [path.join(home, 'missing.pdf')] }), 400, /File not found|Not a file/)
    assert.equal(s.submissions().length, 0)
    assert.equal(s.application(app.id).stage, 'Review')
  })

  test('recordSubmission copies exact files with hashes, writes the manifest + summary, and moves the stage to Applied', () => {
    const { s, app } = setup()
    const dir = path.join(home, 'filed', String(n))
    fs.mkdirSync(path.join(dir, 'other'), { recursive: true })
    const resume = path.join(dir, 'Resume.pdf')
    const letter = path.join(dir, 'other', 'Resume.pdf') // same basename → kept as a second file, not overwritten
    fs.writeFileSync(resume, 'resume bytes')
    fs.writeFileSync(letter, 'letter bytes')
    const { submission, folder } = s.recordSubmission({
      applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, method: 'Workday',
      files: [resume, { path: letter }], answers: [{ question: 'Authorized to work?', answer: 'Yes' }],
      pastedText: [{ label: 'Cover letter', text: 'Dear team' }], receipt: 'Confirmation #123',
    })
    assert.equal(path.dirname(folder), path.join(home, '1 Applications'))
    assert.equal(path.basename(folder), '2026-11-20 Aspen Health - Analyst Data')
    const names = submission.files.map((f) => f.name)
    assert.deepEqual(names, ['Resume.pdf', 'Resume (2).pdf'])
    assert.equal(submission.files[0].sha256, sha(Buffer.from('resume bytes')))
    assert.equal(submission.files[1].sha256, sha(Buffer.from('letter bytes')))
    assert.equal(fs.readFileSync(path.join(folder, 'Resume (2).pdf'), 'utf8'), 'letter bytes')
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'submission.json'), 'utf8'))
    assert.equal(manifest.datePrecision, 'day')
    assert.equal(manifest.method, 'Workday')
    assert.equal(manifest.requisition, 'R-9')
    const summary = fs.readFileSync(path.join(folder, 'What I submitted.md'), 'utf8')
    for (const expected of ['Aspen / Health', 'Authorized to work?', 'Dear team', 'Confirmation #123', submission.files[0].sha256.slice(0, 12)]) assert.ok(summary.includes(expected), expected)
    const after = s.application(app.id)
    assert.equal(after.stage, 'Applied')
    assert.equal(after.appliedAt, '2026-11-20')
    assert.equal(s.brief(app.id).previousSubmissions.length, 1)

    // editing the original afterwards does not change the filed copy
    fs.writeFileSync(resume, 'edited later')
    assert.equal(fs.readFileSync(path.join(folder, 'Resume.pdf'), 'utf8'), 'resume bytes')
  })

  test('a second submission never overwrites the first, and Interview/Offer are never downgraded', () => {
    const { s, app } = setup()
    const first = s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-21', confirmedBySubmitter: true })
    s.updateApplication(app.id, { stage: 'Interview' })
    const second = s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-21', confirmedBySubmitter: true, historical: true, gaps: ['Screening answers not captured'] })
    assert.notEqual(first.folder, second.folder)
    assert.match(path.basename(second.folder), / \(\d+\)$/)
    assert.ok(fs.existsSync(path.join(first.folder, 'submission.json')))
    assert.equal(s.application(app.id).stage, 'Interview')
    s.updateApplication(app.id, { stage: 'Offer' })
    s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11', confirmedBySubmitter: true })
    assert.equal(s.application(app.id).stage, 'Offer')
    const precisions = s.submissions().map((x) => x.datePrecision).sort()
    assert.deepEqual(precisions, ['day', 'day', 'month'])
    assert.match(fs.readFileSync(path.join(second.folder, 'What I submitted.md'), 'utf8'), /Screening answers not captured/)
  })

  test('malformed, impossible and future submittedAt values are rejected', () => {
    const { s, app } = setup()
    const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
    for (const bad of ['20261125', '2026-11-25junk', '2026-1', '2026-02-30', '2026-13', '1900', future, 'yesterday']) {
      rejects(() => s.recordSubmission({ applicationId: app.id, submittedAt: bad, confirmedBySubmitter: true }), 400, /submittedAt/)
    }
    assert.equal(s.submissions().length, 0)
    assert.equal(s.recordSubmission({ applicationId: app.id, submittedAt: '2024', confirmedBySubmitter: true, historical: true }).submission.datePrecision, 'year')
  })

  test('a packet from another application cannot be attached to a submission', () => {
    const { s, app } = setup()
    const other = s.addApplication(job({ sourceUrl: 'https://example.com/jobs/other' }))
    const m = s.saveMaterial({ kind: 'resume', title: 'R', content: 'x' })
    const packet = s.createPacket({ applicationId: other.id, items: [{ materialId: m.id }] })
    rejects(() => s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, packetId: packet.id }), 409, /different application/)
    rejects(() => s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, packetId: 'missing' }), 404)
    const own = s.createPacket({ applicationId: app.id, items: [{ materialId: m.id }] })
    assert.equal(s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, packetId: own.id }).submission.packetId, own.id)
  })

  test('attachments named like the manifest are renamed instead of colliding with it', () => {
    const { s, app } = setup()
    const dir = path.join(home, 'reserved', String(n))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'submission.json'), '{"mine": true}')
    fs.writeFileSync(path.join(dir, 'What I submitted.md'), 'my own notes')
    const { submission, folder } = s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, files: [path.join(dir, 'submission.json'), path.join(dir, 'What I submitted.md')] })
    assert.deepEqual(submission.files.map((f) => f.name), ['attachment - submission.json', 'attachment - What I submitted.md'])
    assert.equal(fs.readFileSync(path.join(folder, 'attachment - submission.json'), 'utf8'), '{"mine": true}')
    assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'submission.json'), 'utf8')).applicationId, app.id)
  })

  test('agent submissions record who submitted, the mode and the form link', () => {
    const { s, app } = setup()
    const { submission, folder } = s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, submittedBy: 'agent', submissionMode: 'review-first', formUrl: 'https://example.com/apply/1' })
    assert.equal(submission.submittedBy, 'agent')
    assert.equal(submission.submissionMode, 'review-first')
    assert.equal(submission.formUrl, 'https://example.com/apply/1')
    assert.match(fs.readFileSync(path.join(folder, 'What I submitted.md'), 'utf8'), /submitted by the assistant, mode: review-first/)
    const person = s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, submittedBy: 'someone else' })
    assert.equal(person.submission.submittedBy, 'person')
  })

  test('an unknown submissionMode on a submission record is rejected', () => {
    const { s, app } = setup()
    rejects(() => s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, submittedBy: 'agent', submissionMode: 'yolo' }), 400, /submissionMode/)
  })
})

describe('profile, answers and experience strength', () => {
  const bank = JSON.parse(fs.readFileSync(new URL('../templates/screening-questions.json', import.meta.url), 'utf8')).questions
  const required = bank.filter((q) => q.required).map((q) => q.id)

  test('profile: allowed fields only, submissionMode validated, expectedVersion guards edits', () => {
    const s = fresh()
    const p = s.setProfile({ name: 'Jordan Example', submissionMode: 'review-first', password: 'never stored' })
    assert.equal(p.password, undefined)
    rejects(() => s.setProfile({ submissionMode: 'yolo' }), 400, /submissionMode/)
    s.setProfile({ city: 'Springfield' }, { expectedVersion: 1 })
    rejects(() => s.setProfile({ city: 'Shelbyville' }, { expectedVersion: 1 }), 409)
    assert.equal(s.profile().city, 'Springfield')
    assert.equal(s.profile().name, 'Jordan Example', 'partial updates keep other fields')
  })

  test('screening answers: bank merged with saved answers, voluntary defaults, missingRequired', () => {
    const s = fresh()
    const empty = s.screeningAnswers()
    assert.equal(empty.questions.length, bank.length)
    assert.deepEqual(empty.missingRequired.sort(), [...required].sort())
    assert.equal(empty.complete, false)
    const voluntary = empty.questions.find((q) => q.voluntary)
    assert.ok(voluntary, 'bank has voluntary self-identification questions')
    assert.equal(voluntary.answer, voluntary.default)
    assert.equal(voluntary.usingDefault, true)

    rejects(() => s.setScreeningAnswers({ answers: { 'not-a-question': 'x' } }), 400, /Unknown question/)
    rejects(() => s.setScreeningAnswers({ custom: [{ question: 'Why us?' }] }), 400, /custom/)
    assert.equal(s.t.get('screening_answers', 'me'), null, 'rejected input saved nothing')

    const half = Object.fromEntries(required.slice(0, 2).map((id) => [id, 'Yes']))
    const v1 = s.setScreeningAnswers({ answers: half })
    assert.equal(s.screeningAnswers().missingRequired.length, required.length - 2)
    rejects(() => s.setScreeningAnswers({ answers: { [required[2]]: 'No' } }, { expectedVersion: v1.version + 3 }), 409)
    const rest = Object.fromEntries(required.slice(2).map((id) => [id, ['English', 'French']]))
    s.setScreeningAnswers({ answers: rest, custom: [{ question: 'Why do you want this role?', answer: 'Mission fit', employer: 'Aspen Health' }] })
    const done = s.screeningAnswers()
    assert.equal(done.complete, true)
    assert.deepEqual(done.missingRequired, [])
    assert.deepEqual(done.questions.find((q) => q.id === required[2]).answer, ['English', 'French'])
    assert.equal(done.questions.find((q) => q.id === required[0]).answer, 'Yes', 'earlier answers are kept')

    s.setScreeningAnswers({ answers: { [voluntary.id]: 'Decline' }, custom: [{ question: '  WHY do you want this role?', answer: 'Updated answer', employer: 'aspen health' }, { question: 'Earliest start date?', answer: 'Two weeks' }] })
    const merged = s.screeningAnswers()
    assert.equal(merged.custom.length, 2, 'custom questions merge by question text')
    assert.equal(merged.custom.find((c) => /why do you want/i.test(c.question)).answer, 'Updated answer')
    assert.equal(merged.questions.find((q) => q.id === voluntary.id).usingDefault, false)
    assert.ok(s.history('screening_answers', 'me').length >= 3, 'answers are versioned')
  })

  test('an empty answer to a required question still counts as missing', () => {
    const s = fresh()
    s.setScreeningAnswers({ answers: Object.fromEntries(required.map((id) => [id, 'Yes'])) })
    assert.equal(s.screeningAnswers().complete, true)
    s.setScreeningAnswers({ answers: { [required[0]]: '' } })
    assert.deepEqual(s.screeningAnswers().missingRequired, [required[0]])
  })

  test('evidence keeps STAR parts, metrics and sources; a metric needs a value', () => {
    const s = fresh()
    rejects(() => s.addEvidence({ kind: 'achievement', title: 'x', metrics: [{ unit: '%' }] }), 400, /metric 1/)
    const e = s.addEvidence({
      kind: 'achievement', title: 'Cut turnaround time',
      star: { situation: 'Backlog of 200 requests', task: 'Clear it', action: 'Built a triage sheet', result: 'Cleared in 6 weeks', extra: 'dropped' },
      metrics: [{ value: '40', unit: '%', period: '2025', baseline: '10 days', source: 'team report' }],
      sources: [{ label: 'Team report', locator: 'p. 3' }],
    })
    assert.deepEqual(Object.keys(e.star), ['situation', 'task', 'action', 'result'])
    assert.equal(e.metrics[0].value, '40')
    assert.equal(e.sources[0].locator, 'p. 3')
  })

  test('starScore and experienceStrength rank the weakest stories first', () => {
    const s = fresh()
    s.addEvidence({ kind: 'experience', title: 'Bare role' })
    s.addEvidence({ kind: 'skill', title: 'Python' }) // not a STAR kind
    s.addEvidence({
      kind: 'project', title: 'Complete story', reviewStatus: 'candidate-confirmed',
      star: { situation: 's', task: 't', action: 'a', result: 'r' }, metrics: [{ value: '3', unit: 'clinics', period: '2024' }], sources: [{ label: 'Paper' }],
    })
    s.addEvidence({ kind: 'achievement', title: 'Half story', star: { situation: 's', action: 'a' }, metrics: [{ value: '12' }], source: 'CV 2025' })
    const strength = s.experienceStrength()
    assert.equal(strength.total, 3)
    assert.equal(strength.complete, 1)
    assert.deepEqual(strength.items.map((i) => i.title), ['Bare role', 'Half story', 'Complete story'])
    const half = strength.items[1]
    assert.equal(half.score, 50)
    assert.deepEqual(half.missing.sort(), ['measuredResult', 'result', 'task'])
    assert.equal(strength.items[0].score, 0)
    assert.equal(strength.items[2].confirmed, true)
    assert.equal(strength.average, Math.round((0 + 50 + 100) / 3))
    assert.equal(starScore({ reviewStatus: 'source-verified' }).missing.includes('evidence'), false)
  })
})

describe('concurrency guards added in the core rewrite', () => {
  test('changing requisition/company on update cannot collide with another saved job', () => {
    const s = fresh()
    s.addApplication(job({ requisition: 'R-1', sourceUrl: 'https://example.com/jobs/r1' }))
    const b = s.addApplication(job({ requisition: 'R-2', sourceUrl: 'https://example.com/jobs/r2' }))
    rejects(() => s.updateApplication(b.id, { requisition: 'r-1' }), 409)
    const c = s.addApplication(job({ company: 'Other Co', requisition: 'R-1', sourceUrl: 'https://example.com/jobs/r3' }))
    rejects(() => s.updateApplication(c.id, { company: 'maple analytics' }), 409)
    assert.equal(s.updateApplication(b.id, { notes: 'unrelated edit' }).version, 2, 'edits that do not touch identity still work')
  })

  test('retireRule honours expectedVersion and clears a pending revision\'s active wording', () => {
    const s = fresh()
    s.seedStarterRules()
    const starterRule = s.rules({ status: 'starter' })[0]
    const revised = s.reviseRule(starterRule.id, { rule: 'New wording' })
    const active = s.activeRules().find((r) => r.id === starterRule.id)
    assert.equal(active.rule, starterRule.rule)
    assert.equal(active.status, 'starter', 'the pending revision keeps the original status')
    assert.deepEqual(active.materialKinds, starterRule.materialKinds, 'and the full previous rule')
    assert.equal(active.whenRelevant, starterRule.whenRelevant)
    rejects(() => s.retireRule(starterRule.id, { reason: 'no longer wanted', expectedVersion: revised.version - 1 }), 409)
    const retired = s.retireRule(starterRule.id, { reason: 'no longer wanted', expectedVersion: revised.version })
    assert.equal(retired.active, undefined)
    assert.ok(!s.activeRules().some((r) => r.id === starterRule.id), 'retiring removes the old wording too')
  })

  test('a missing database with backups present is refused instead of silently starting empty', () => {
    const dir = path.join(home, 'guard', String(++n))
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'backups', '2026-11-01 at 0900 daily.sqlite'), 'stand-in backup')
    const file = path.join(dir, 'workspace.sqlite')
    rejects(() => openStore({ file }), 409, /backups exist/)
    assert.ok(!fs.existsSync(file), 'no empty database was created')
    const allowed = openStore({ file, allowNew: true })
    assert.equal(allowed.applications().length, 0)
    allowed.close()
    openStore({ file }).close() // once it exists, it opens normally
  })

  test('snapshot() is one consistent read even when another connection writes mid-snapshot', () => {
    const s = fresh()
    s.addApplication(job())
    const writer = openStore({ file: s.file })
    opened.push(writer)
    const revisionBefore = s.revision()
    // Commit a write from a second connection after the snapshot has started reading.
    const original = s.screeningDecisions.bind(s)
    let wrote = false
    s.screeningDecisions = () => {
      if (!wrote) { writer.addApplication(job({ sourceUrl: 'https://example.com/jobs/concurrent' })); wrote = true }
      return original()
    }
    const snap = s.snapshot()
    s.screeningDecisions = original
    assert.ok(wrote)
    assert.equal(snap.revision, revisionBefore, 'revision is from the same snapshot as the lists')
    assert.equal(snap.applications.length, 1)
    assert.equal(snap.counts.Review, 1)
    assert.equal(snap.activity[0].seq, revisionBefore, 'activity read after the write still shows the snapshot state')
    assert.equal(s.t.inTransaction, false)
    assert.equal(s.applications().length, 2, 'the next read sees the committed write')
    s.addApplication(job({ sourceUrl: 'https://example.com/jobs/after-snapshot' }))
  })

  test('custom answers for the same question are kept per employer', () => {
    const s = fresh()
    s.setScreeningAnswers({ custom: [{ question: 'Why us?', answer: 'Alpha mission', employer: 'Alpha' }] })
    s.setScreeningAnswers({ custom: [{ question: 'why us?', answer: 'Beta mission', employer: 'Beta' }] })
    s.setScreeningAnswers({ custom: [{ question: 'Why us?', answer: 'Generic' }] })
    const custom = s.screeningAnswers().custom
    assert.equal(custom.length, 3)
    assert.equal(custom.find((c) => c.employer === 'Alpha').answer, 'Alpha mission')
    assert.equal(custom.find((c) => c.employer === 'Beta').answer, 'Beta mission')
    s.setScreeningAnswers({ custom: [{ question: 'Why us?', answer: 'Alpha v2', employer: 'Alpha' }] })
    const again = s.screeningAnswers().custom
    assert.equal(again.length, 3)
    assert.equal(again.find((c) => c.employer === 'Alpha').answer, 'Alpha v2')
    assert.equal(again.find((c) => c.employer === 'Beta').answer, 'Beta mission')
  })

  test('empty selections do not count as answering a required question', () => {
    const s = fresh()
    const bank = JSON.parse(fs.readFileSync(new URL('../templates/screening-questions.json', import.meta.url), 'utf8')).questions
    s.setScreeningAnswers({ answers: Object.fromEntries(bank.filter((q) => q.required).map((q) => [q.id, []])) })
    assert.equal(s.screeningAnswers().complete, false)
  })

  test('a folder given as an attachment is refused before anything is written', () => {
    const s = fresh()
    const app = s.addApplication(job({ company: 'Folder Test Co', sourceUrl: 'https://example.com/jobs/folder-test' }))
    const dir = path.join(home, 'attach', String(n))
    fs.mkdirSync(path.join(dir, 'a-folder'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'ok.pdf'), 'x')
    const before = fs.existsSync(path.join(home, '1 Applications')) ? fs.readdirSync(path.join(home, '1 Applications')) : []
    assert.throws(() => s.recordSubmission({ applicationId: app.id, submittedAt: '2026-11-20', confirmedBySubmitter: true, files: [path.join(dir, 'ok.pdf'), path.join(dir, 'a-folder')] }))
    const afterList = fs.existsSync(path.join(home, '1 Applications')) ? fs.readdirSync(path.join(home, '1 Applications')) : []
    assert.deepEqual(afterList, before, 'no partial filing folder')
    assert.equal(s.submissions().length, 0)
  })
})
