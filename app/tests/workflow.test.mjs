// The tailoring workflow: what the person puts in is usable at once, the brief carries all of it,
// checks are notes, and corrections become rules. Plus ranking, screening rechecks, links and plan.
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { isolate, job, tempDir } from './helpers.mjs'

const home = isolate('workflow')
const { openStore } = await import('../lib/store.mjs')
const { runOperation } = await import('../lib/operations.mjs')
const { checkBullets, citedEvidence, flattenBullets } = await import('../lib/bullets.mjs')
const { checkPostings, classifyPage } = await import('../lib/links.mjs')
const { boardKey, canonicalUrl, isActionable, localToday, postingFreshness, samePosting } = await import('../lib/postings.mjs')
const { chanceOfAtLeast, projectPlan, triesFor } = await import('../lib/plan.mjs')

let n = 0
const opened = []
after(() => { for (const s of opened) try { s.close() } catch {} })
function fresh() {
  const s = openStore({ file: path.join(home, 'db', `workflow-${++n}.sqlite`) })
  opened.push(s)
  return s
}
const fails = (fn, status, pattern) => assert.throws(fn, (e) => { assert.equal(e.status, status, e.message); if (pattern) assert.match(e.message, pattern); return true })

function library(s) {
  const role = s.addEvidence({ kind: 'experience', title: 'Research Assistant', organization: 'Riverton Hospital', period: '2023 – present', content: 'Runs screening for two studies.' })
  const win = s.addEvidence({
    kind: 'achievement', title: 'Raised enrolment', parentId: role.id, content: 'Evening calls.',
    star: { situation: 'Behind target', task: 'Booking', action: 'Ran evening calls', result: 'Enrolment rose from 40 to 65' },
    metrics: [{ value: '40 to 65', unit: 'participants', period: 'March–June 2024', baseline: '40' }], sources: [{ label: 'Enrolment log' }], gapsNoted: ['Target was 60 or 65'],
  })
  return { role, win }
}

describe('what the person puts in is usable without confirming it', () => {
  test('new facts are provided, usable and in the brief with every field', () => {
    const s = fresh()
    const { role, win } = library(s)
    assert.equal(win.reviewStatus, 'provided')
    const app = s.addApplication(job())
    const b = s.brief(app.id)
    assert.deepEqual(b.experiences.map((e) => e.id), [role.id])
    const a = b.experiences[0].achievements[0]
    assert.equal(a.id, win.id)
    assert.equal(a.star.result, 'Enrolment rose from 40 to 65')
    assert.equal(a.metrics[0].period, 'March–June 2024')
    assert.deepEqual(a.sources, ['Enrolment log'])
    assert.deepEqual(a.gapsNoted, ['Target was 60 or 65'])
    assert.equal(a.strength, 100)
  })

  test('only disputed and outdated facts are set aside; older needs-review facts still count', () => {
    const s = fresh()
    s.addEvidence({ kind: 'skill', title: 'Old style', reviewStatus: 'needs-review' })
    s.addEvidence({ kind: 'achievement', title: 'Two sources disagree', reviewStatus: 'disputed', gapsNoted: ['40k or 65k'] })
    s.addEvidence({ kind: 'achievement', title: 'Last year', reviewStatus: 'outdated' })
    const b = s.brief(s.addApplication(job()).id)
    assert.deepEqual(b.otherEvidence.map((e) => e.title), ['Old style'])
    assert.deepEqual(b.setAside.map((e) => e.title).sort(), ['Last year', 'Two sources disagree'])
  })

  test('a usable child of a set-aside role is still offered', () => {
    const s = fresh()
    const { role, win } = library(s)
    s.updateEvidence(role.id, { reviewStatus: 'outdated' })
    const b = s.brief(s.addApplication(job()).id)
    assert.deepEqual(b.experiences, [])
    assert.deepEqual(b.otherEvidence.map((e) => e.id), [win.id])
  })

  test('projects sit under their role, and their achievements under them', () => {
    const s = fresh()
    const { role } = library(s)
    const project = s.addEvidence({ kind: 'project', title: 'Tool', parentId: role.id })
    const detail = s.addEvidence({ kind: 'achievement', title: 'Tool adopted', parentId: project.id })
    const loose = s.addEvidence({ kind: 'project', title: 'Side project' })
    const b = s.brief(s.addApplication(job()).id)
    assert.equal(b.experiences[0].achievements.find((x) => x.id === detail.id).under, 'Tool')
    assert.ok(b.experiences[0].achievements.some((x) => x.id === project.id))
    assert.deepEqual(b.projects.map((p) => p.id), [loose.id])
    assert.equal(b.otherEvidence.length, 0, 'nothing is listed twice')
  })
})

describe('evidence behind documents', () => {
  test('references are pinned, wrong ids are refused, and later changes are flagged', () => {
    const s = fresh()
    const { win } = library(s)
    fails(() => s.saveMaterial({ kind: 'resume', title: 'R', content: 'x', evidenceRefs: ['nope'] }), 400, /No career-library record nope/)
    const m = s.saveMaterial({ kind: 'resume', title: 'R', content: 'x', evidenceRefs: [win.id] })
    assert.deepEqual(m.evidenceRefs, [{ id: win.id, version: 1 }])
    assert.equal(s.materials()[0].evidenceChanged, false)
    s.saveBullets([{ evidenceId: win.id, text: 'A bullet.' }])
    s.updateEvidence(win.id, { reviewStatus: 'candidate-confirmed' })
    assert.equal(s.materials()[0].evidenceChanged, false, 'saving wording or confirming does not change the fact')
    s.updateEvidence(win.id, { content: 'Evening and weekend calls.' })
    assert.equal(s.materials()[0].evidenceChanged, true)
    const v2 = s.saveMaterial({ kind: 'resume', title: 'R', content: 'y' }, { id: m.id })
    assert.deepEqual(v2.evidenceRefs, m.evidenceRefs, 'a text-only revision keeps its evidence')
  })

  test('packets never need approval; they freeze posting and facts and only warn', () => {
    const s = fresh()
    const { win } = library(s)
    const app = s.addApplication(job())
    const m = s.saveMaterial({ kind: 'answer', title: 'Why', content: 'one two three four', wordLimit: 3, applicationId: app.id, evidenceRefs: [win.id] })
    s.updateEvidence(win.id, { content: 'Changed.' })
    const p = s.createPacket({ applicationId: app.id, items: [{ materialId: m.id }] })
    assert.equal(p.warnings.length, 2)
    assert.match(p.warnings.join(' '), /4 words; the limit is 3[\s\S]*Raised enrolment/)
    assert.equal(p.evidence[0].snapshot.content, 'Evening calls.')
    assert.equal(p.posting.title, app.title)
  })

  test('materials saved by earlier versions (plain ids) still work', () => {
    const s = fresh()
    const { win } = library(s)
    const old = s.t.create('material', { kind: 'resume', title: 'Old', content: 'x', evidenceRefs: [win.id, 'gone'], reviewStatus: 'draft' })
    assert.equal(s.materials().find((m) => m.id === old.id).evidenceChanged, true)
    const app = s.addApplication(job())
    assert.ok(s.brief(app.id))
    assert.ok(s.createPacket({ applicationId: app.id, items: [{ materialId: old.id }] }).warnings.length)
  })

  test('the qualification map is saved on the job', () => {
    const s = fresh()
    const { win } = library(s)
    const app = s.addApplication(job())
    const up = s.updateApplication(app.id, { qualificationMap: [{ qualification: 'Recruitment', required: true, evidence: [win.id] }, { qualification: 'Ethics' }] })
    assert.deepEqual(up.qualificationMap.map((q) => q.status), ['met', 'gap'])
    fails(() => s.updateApplication(app.id, { qualificationMap: [{ status: 'met' }] }), 400, /qualification is required/)
    assert.equal(s.brief(app.id).application.qualificationMap.length, 2)
  })
})

describe('reading a large library', () => {
  test('matches the posting text, shortens long records, keeps their cautions and gives the rest on request', () => {
    const s = fresh()
    const { role } = library(s)
    const grant = s.addEvidence({ kind: 'achievement', title: 'Grant proposal', parentId: role.id, content: `Wrote the funded proposal and its milestones. This does not establish post-award reporting.\n\nREUSABLE WORDING\nWrote the full funded proposal.\n\n${'Background detail. '.repeat(500)}` })
    s.addEvidence({ kind: 'achievement', title: 'Swim club', content: 'Coached swimmers.' })
    const app = s.addApplication(job({ title: 'Grants Lead', postingText: 'Union: swim staff\nWrite grant proposals, track milestones and coordinate reporting.' }))
    const b = s.brief(app.id)
    assert.equal(b.topMatches[0].id, grant.id)
    assert.ok(!b.topMatches.some((m) => m.title === 'Swim club'))
    assert.equal(b.postingTextMissing, undefined)
    const item = b.experiences[0].achievements.find((x) => x.id === grant.id)
    assert.equal(item.more, true)
    assert.ok(item.content.length < 6100)
    assert.match(item.cautions[0], /does not establish/)
    assert.equal(item.wording, 'Wrote the full funded proposal.')
    assert.ok(s.evidenceByIds([grant.id])[0].content.length > 3000)
    fails(() => s.evidenceByIds(['x']), 404)
    assert.ok(s.brief(app.id, { detail: 'full' }).experiences[0].achievements.find((x) => x.id === grant.id).content.length > 3000)
    assert.ok(s.brief(s.addApplication(job({ sourceUrl: 'https://example.com/jobs/other' })).id).postingTextMissing)
    assert.equal(s.snapshot().applications[0].postingText, undefined, 'the dashboard does not carry posting text')
  })

  test('a loop in the library does not hang the brief', () => {
    const s = fresh()
    const { role, win } = library(s)
    s.updateEvidence(role.id, { parentId: win.id })
    assert.ok(s.brief(s.addApplication(job()).id))
  })
})

describe('narratives and the bullet bank', () => {
  test('a narrative is suggested by field and resolves to current facts', () => {
    const s = fresh()
    const { role, win } = library(s)
    fails(() => s.saveNarrative({ label: 'X', experience: ['missing'] }), 404)
    const nar = s.saveNarrative({ label: 'Research coordination', disciplines: ['Coordinator'], experience: [{ evidenceId: role.id, achievements: [win.id] }] })
    s.saveNarrative({ label: 'Operations', disciplines: ['Operations'] })
    const b = s.brief(s.addApplication(job({ title: 'Research Coordinator' })).id)
    assert.equal(b.suggestedNarrative, nar.id)
    assert.equal(b.narratives.find((x) => x.suggested).experience[0].achievements[0].title, 'Raised enrolment')
    assert.deepEqual(b.experiences[0].achievements[0].narratives, [nar.id])
    const changed = s.saveNarrative({ headline: 'Coordinator' }, { id: nar.id })
    assert.equal(changed.experience.length, 1, 'fields that were not sent are kept')
  })

  test('bullets are kept once with their fact and survive other edits', () => {
    const s = fresh()
    const { win } = library(s)
    assert.equal(s.saveBullets([{ evidenceId: win.id, text: 'Raised enrolment from 40 to 65 (2024).', usedFor: 'Cedar' }])[0].added, true)
    assert.equal(s.saveBullets([{ evidenceId: win.id, text: 'Raised enrolment from 40 to 65 (2024).' }])[0].added, false)
    s.updateEvidence(win.id, { content: 'New content.' })
    assert.equal(s.bullets({ q: 'enrolment' })[0].usedFor, 'Cedar')
    s.updateEvidence(win.id, { reviewStatus: 'disputed' })
    assert.deepEqual(s.bullets(), [])
    fails(() => s.saveBullets([{ evidenceId: 'x', text: 'y' }]), 404)
  })
})

describe('bullet notes', () => {
  const role = { id: 'r', kind: 'experience', title: 'Assistant' }
  const win = { id: 'w', kind: 'achievement', title: 'Raised enrolment', parentId: 'r', star: { result: 'rose' }, metrics: [{ value: '40 to 65', unit: 'people', period: 'June 2024' }] }
  const content = (bullets, extra = {}) => ({ name: 'A', sections: [{ heading: 'Experience', entries: [{ title: 'Assistant', evidenceId: 'r', bullets, ...extra }] }] })
  const codes = (bullets, evidence = [role, win]) => checkBullets(content(bullets), evidence).map((x) => x.code)

  test('flags what weakens a bullet and stays quiet on a good one', () => {
    assert.deepEqual(codes(['Ran evening calls, raising enrolment from 40 to 65 (June 2024).']), [])
    assert.ok(codes(['Responsible for enrolment.']).includes('weak-start'))
    assert.ok(codes(['Ran calls, raising enrolment to 90 people (2024).']).includes('number-not-in-evidence'))
    assert.ok(codes(['Raised enrolment from 40 to 65.']).includes('date-the-number'))
    assert.ok(codes(['Planned visits; kept binders.']).includes('semicolon'))
    assert.ok(codes(['Ran calls for my team in 2024 and delivered them.']).includes('first-person'))
    assert.ok(codes([`Built ${'a very '.repeat(45)}long tool`]).includes('long'))
    assert.ok(codes(['Built a.', 'Built b.', 'Built c.']).includes('repeated-start'))
    assert.ok(codes(['']).includes('empty'))
    const note = checkBullets(content(['Kept study binders and forms.']), [role, win]).find((x) => x.code === 'no-outcome')
    assert.match(note.note, /"Raised enrolment" records a result/)
  })

  test('names unknown and set-aside evidence, and bullets with none', () => {
    const marked = content([{ text: 'Delivered it.', evidence: ['ghost'] }, { text: 'Delivered that.', evidence: ['w'] }])
    const notes = checkBullets(marked, [role, { ...win, reviewStatus: 'disputed' }]).map((x) => x.code)
    assert.ok(notes.includes('unknown-evidence') && notes.includes('set-aside'))
    const bare = checkBullets({ sections: [{ heading: 'Skills', bullets: ['Delivered talks.'] }] }, [role])
    assert.deepEqual(bare.map((x) => x.code), ['no-evidence'])
    assert.deepEqual(checkBullets({ sections: [{ type: 'education', entries: [{ title: 'BSc', bullets: ['Responsible.'] }] }] }, [role]), [])
  })

  test('flags numbers another record doubts, dropped qualifiers, and loose numbers outside bullets', () => {
    const plainRec = { id: 'p', kind: 'achievement', title: 'Partners', parentId: 'r', content: 'Built partnerships from zero to 30.' }
    const doubt = { id: 'q', kind: 'achievement', title: 'Outreach ownership', content: 'Ran all outreach. This does not establish a current total of 30 partnerships.' }
    const bullet = [{ text: 'Ran all outreach, building 30 partnerships.', evidence: ['p'] }]
    const hit = checkBullets(content(bullet), [role, plainRec, doubt]).find((x) => x.code === 'number-in-doubt')
    assert.match(hit.note, /Outreach ownership/)
    assert.ok(!checkBullets(content(bullet), [role, plainRec]).some((x) => x.code === 'number-in-doubt'))
    const study = { id: 's', kind: 'project', title: 'Study', parentId: 'r', content: 'Included 80 analyzable baseline participants.' }
    const q = (text) => checkBullets(content([{ text, evidence: ['s'] }]), [role, study]).map((x) => x.code)
    assert.ok(q('Led an 80-participant study.').includes('qualifier'))
    assert.ok(!q('Led a study with 80 analyzable baseline participants.').includes('qualifier'))
    const old = { id: 'o', kind: 'project', title: 'Site users', content: 'The earlier estimate of 20 users is superseded.' }
    assert.ok(!checkBullets(content(['Reached 65 people (week of October 20–26, 2024), raised from 40 users.']), [role, win, old]).some((x) => x.code === 'number-in-doubt'), 'days of the month are not counts')
    const oneBad = { id: 'm', kind: 'achievement', title: 'Outreach', parentId: 'r', content: 'Ran outreach.', metrics: [{ value: '300', unit: 'leads', period: '2024', doubt: 'no source' }] }
    assert.ok(checkBullets(content([{ text: 'Ran outreach, producing 300 leads in 2024.', evidence: ['m'] }]), [role, oneBad]).some((x) => x.code === 'number-in-doubt'))
    assert.deepEqual(citedEvidence({ sections: [{ heading: 'A', intro: 'x', evidence: ['m'] }] }), ['m'])
    const loose = checkBullets({ ...content([]), summary: 'Raised enrolment to 99 people.' }, [role, win])
    assert.deepEqual(loose.map((x) => [x.where, x.code]), [['Summary', 'number-not-in-evidence']])
    assert.deepEqual(codes(['Recruited three people, raising enrolment from 40 to 65 (June 2024).']), ['number-not-in-evidence'], 'number words count')
  })

  test('marked bullets are flattened for rendering and their evidence collected', () => {
    const c = content([{ text: '**Lead.** Did it.', evidence: 'w' }, 'Plain.'])
    assert.deepEqual(flattenBullets(c).sections[0].entries[0].bullets, ['**Lead.** Did it.', 'Plain.'])
    assert.deepEqual(citedEvidence(c), ['r', 'w'])
    assert.deepEqual(flattenBullets({ name: 'x' }), { name: 'x' })
  })
})

describe('documents through operations', () => {
  test('docs.resume cites evidence from the content, notes problems and never blocks; docs.check compares with the saved text', async () => {
    const previous = process.env.UAS_HOME
    process.env.UAS_HOME = tempDir('workflow-docs')
    try {
      const op = async (name, input) => { const r = await runOperation(name, input); assert.equal(r.ok, true, `${name}: ${r.error?.message}`); return r.result }
      const app = await op('jobs.add', { job: job() })
      const role = await op('evidence.add', { item: { kind: 'experience', title: 'Assistant' } })
      const content = { name: 'Jo Lee', sections: [{ heading: 'Experience', entries: [{ title: 'Assistant', evidenceId: role.id, bullets: [{ text: '**Calls.** Responsible for 90 calls; *and* more.' }] }] }] }
      const built = await op('docs.resume', { applicationId: app.id, save: true, content })
      assert.equal(built.material.evidenceRefs, 1)
      assert.deepEqual((await op('materials.get', { id: built.material.id })).evidenceRefs, [{ id: role.id, version: 1 }])
      assert.ok(built.bulletNotes.some((x) => x.code === 'number-not-in-evidence'))
      const check = await op('docs.check', { file: built.docx, materialId: built.material.id })
      assert.equal(check.matchesSaved, true)
      await op('materials.save', { id: built.material.id, material: { kind: 'resume', title: 'R', content: JSON.stringify({ ...content, summary: 'Changed' }) } })
      assert.equal((await op('docs.check', { file: built.docx, materialId: built.material.id })).matchesSaved, false)
      assert.equal((await op('docs.check', { file: built.docx, materialId: built.material.id, version: 1 })).matchesSaved, true)

      const before = fs.readdirSync(path.dirname(built.docx)).length
      const wrong = await runOperation('docs.resume', { applicationId: app.id, content, evidenceRefs: ['nope'] })
      assert.equal(wrong.error.status, 400)
      assert.equal(fs.readdirSync(path.dirname(built.docx)).length, before, 'no file is written for a wrong id')

      const text = await op('docs.text', { file: path.relative(process.env.UAS_HOME, built.docx) })
      assert.match(text.text, /Jo Lee/i, 'paths are read from the workspace folder')

      const pub = await op('evidence.add', { item: { kind: 'publication', title: 'Paper', publication: { authors: ['Lee J'], status: 'published' } } })
      const cv = await op('docs.cv', { applicationId: app.id, save: true, content })
      assert.equal(cv.material.kind, 'cv')
      assert.match(path.basename(cv.docx), /CV\.docx$/)
      assert.deepEqual(cv.publicationGaps, [{ id: pub.id, title: 'Paper', missing: ['venue', 'year'] }])
      assert.equal((await runOperation('bullets.check', {})).error.status, 400)
      assert.ok((await op('bullets.check', { materialId: built.material.id, version: 1 })).notes.length)
    } finally { process.env.UAS_HOME = previous }
  })

  test('publications stay in separate status groups', () => {
    const s = fresh()
    const add = (title, publication) => s.addEvidence({ kind: 'publication', title, publication })
    add('A', { authors: ['X'], venue: 'J', year: 2024, status: 'published' })
    add('B', { authors: ['X'], status: 'in-preparation' })
    add('C', undefined)
    const r = s.publications()
    assert.deepEqual([r.counts.published, r.counts['in-preparation']], [1, 1])
    assert.deepEqual(r.gaps.map((g) => [g.title, g.missing]), [['C', ['authors', 'status', 'venue', 'year']]])
    fails(() => add('D', { status: 'nearly' }), 400, /publication.status/)
  })
})

describe('rules from corrections', () => {
  const rule = { title: 'Say wrote', rule: 'Say "wrote" when the person wrote it.', materialKinds: ['resume'] }
  const said = { approvalText: 'I did all of the drafting', approvalSource: 'chat, 2026-11-25' }

  test('a correction is in force at once, with the person\'s words kept', () => {
    const s = fresh()
    const r = s.saveRule(rule, said)
    assert.equal(r.status, 'approved')
    assert.equal(r.approvals[0].approvalText, said.approvalText)
    const again = s.saveRule({ id: r.id, rule: 'Say "wrote the full proposal".' }, said)
    assert.equal(again.status, 'approved')
    assert.equal(again.title, rule.title, 'fields that were not sent are kept')
    assert.match(s.activeRules().find((x) => x.id === r.id).rule, /full proposal/)
    fails(() => s.saveRule(rule, { approvalSource: 'chat' }), 400, /approvalText/)
  })

  test('rules limited to a job, narrative or document kind apply only there', () => {
    const s = fresh()
    const { win } = library(s)
    const a = s.addApplication(job())
    const b = s.addApplication(job({ sourceUrl: 'https://boards.greenhouse.io/mapleanalytics/jobs/2002' }))
    const r = s.saveRule({ ...rule, applicationIds: [a.id], evidenceRefs: [win.id] }, said)
    assert.ok(s.brief(a.id).rules.active.some((x) => x.id === r.id))
    const other = s.brief(b.id)
    assert.ok(!other.rules.active.some((x) => x.id === r.id))
    assert.equal(other.rules.outsideScope, 1)
    assert.ok(!s.brief(a.id, { materialKind: 'cover-letter' }).rules.active.some((x) => x.id === r.id))
    s.updateEvidence(win.id, { content: 'New.' })
    assert.equal(s.brief(a.id).rules.active.find((x) => x.id === r.id).evidenceChanged[0].id, win.id)
  })

  test('bundled rules are all on, and refresh reaches only rules the person never touched', () => {
    const s = fresh()
    s.seedStarterRules()
    assert.ok(s.rules().every((r) => r.status === 'starter'))
    // as left by v0.1.x: seeded as a suggestion with older wording, no "bundled" mark
    const untouched = s.rules()[0].id
    const retired = s.rules()[1].id
    const own = s.rules()[2].id
    const f2 = fresh()
    const seedOld = (id) => f2.t.create('rule', { title: id, rule: 'old wording', status: 'proposed', approvals: [] }, { id, actor: 'setup', type: 'seeded' })
    for (const id of [untouched, retired, own]) seedOld(id)
    f2.retireRule(retired, { reason: 'no thanks' })
    f2.saveRule({ id: own, rule: 'my wording' }, said)
    const result = f2.seedStarterRules()
    assert.equal(result.refreshed, 1)
    const status = (id) => f2.rules().find((r) => r.id === id)
    assert.equal(status(untouched).status, 'starter')
    assert.notEqual(status(untouched).rule, 'old wording')
    assert.equal(status(retired).status, 'retired')
    assert.equal(status(own).rule, 'my wording')
    assert.deepEqual(f2.seedStarterRules(), { added: 0, refreshed: 0 })
  })
})

describe('postings: identity, freshness, ranking', () => {
  test('board numbers, hash routes and job-number references', () => {
    assert.equal(boardKey('https://boards.greenhouse.io/Lab/jobs/12'), boardKey('https://job-boards.greenhouse.io/lab/jobs/12?gh_src=x'))
    assert.equal(boardKey('https://jobs.smartrecruiters.com/Org/744-old-title'), boardKey('https://jobs.smartrecruiters.com/Org/744-new-title'))
    assert.equal(boardKey('https://a.wd3.myworkdayjobs.com/en-US/Ext/job/City/Title_R-1'), boardKey('https://a.wd3.myworkdayjobs.com/fr-CA/Ext/job/Other_R-1'))
    assert.notEqual(canonicalUrl('https://x.example.com/#/jobs/1'), canonicalUrl('https://x.example.com/#/jobs/2'))
    assert.notEqual(canonicalUrl('https://x.example.com/job?ref=1001'), canonicalUrl('https://x.example.com/job?ref=1002'))
    assert.equal(canonicalUrl('https://x.example.com/job?ref=linkedin'), canonicalUrl('https://x.example.com/job'))
    assert.ok(samePosting({ sourceUrl: 'https://a.example.com/1' }, { sourceUrl: 'https://b.example.com/1', aliases: ['https://a.example.com/1'] }))
    assert.ok(!samePosting({ sourceUrl: 'https://a.example.com/1', requisition: 'R1' }, { sourceUrl: 'https://a.example.com/1', requisition: 'R2' }))
  })

  test('freshness is worked out when read and never changes the record', () => {
    const t = '2026-11-25'
    const f = (x) => postingFreshness({ postingStatus: 'open', lastChecked: '2026-11-20', ...x }, t).status
    assert.equal(f({}), 'current')
    assert.equal(f({ lastChecked: '2026-11-10' }), 'verify')
    assert.equal(f({ lastChecked: undefined }), 'verify')
    assert.equal(f({ lastChecked: '2026-12-01' }), 'verify', 'a future check date is not evidence')
    assert.equal(f({ deadline: '2026-11-24' }), 'expired')
    assert.equal(f({ deadline: 'open until filled' }), 'current')
    assert.equal(f({ postingStatus: 'closed' }), 'closed')
    assert.equal(f({ postingStatus: 'unknown' }), 'verify')
    const lateToday = new Date(2026, 10, 25, 23, 30).toISOString()
    assert.equal(f({ lastChecked: lateToday }), 'current', 'a late-evening check is today')
    assert.equal(postingFreshness({ postingStatus: 'open', lastChecked: t, postedAt: '2026-10-01' }, t).olderPosting, true)
    assert.equal(isActionable({ stage: 'Review', postingStatus: 'open', lastChecked: t, recommendation: { tier: 'Hold' } }, t), false)
  })

  test('ranking orders the shortlist, holds stay out, stages do not change', () => {
    const s = fresh()
    const add = (i, extra) => s.addApplication(job({ title: `Job ${i}`, sourceUrl: `https://example.com/jobs/${i}`, postingStatus: 'open', lastChecked: new Date().toISOString(), ...extra }))
    const a = add(1), b = add(2), c = add(3), d = add(4, { lastChecked: '2020-01-01' })
    s.rankApplications([{ id: a.id, tier: 'B', rank: 1, reason: 'ok' }, { id: b.id, tier: 'A', rank: 2, reason: 'great' }, { id: c.id, tier: 'Hold', rank: 3, reason: 'licence not established' }])
    const list = s.shortlist()
    assert.deepEqual(list.applyNow.map((x) => x.id), [b.id, a.id])
    assert.deepEqual(new Set(list.checkFirst.map((x) => x.id)), new Set([c.id, d.id]))
    assert.equal(s.application(b.id).stage, 'Review')
    fails(() => s.rankApplications([{ id: a.id, tier: 'A', rank: 1, reason: 'x' }, { id: b.id, tier: 'Z', rank: 1, reason: 'x' }]), 400)
    assert.equal(s.application(a.id).recommendation.tier, 'B', 'nothing from a refused batch is saved')
  })
})

describe('screening and searches', () => {
  const decision = (extra = {}) => ({ company: 'Lab', title: 'Analyst', sourceUrl: 'https://boards.greenhouse.io/lab/jobs/9', decision: 'hold', reason: 'Licence not established', evidence: [{ url: 'https://boards.greenhouse.io/lab/jobs/9', checkedAt: '2026-11-25T10:00:00Z' }], ...extra })
  const look = (s, extra = {}) => s.screeningPreflight({ criteriaVersion: 'v2', candidates: [{ company: 'Lab', title: 'Analyst', sourceUrl: 'https://job-boards.greenhouse.io/lab/jobs/9', ...extra }] }).report[0]

  test('a dated hold comes back on its date; another host for the same board number is the same posting', () => {
    const s = fresh()
    s.recordScreening({ criteriaVersion: 'v1', decisions: [decision({ recheckAfter: '2999-01-01' })] })
    const waiting = look(s)
    assert.equal(waiting.status, 'already-decided')
    assert.equal(waiting.criteriaChanged, true)
    const due = fresh()
    due.recordScreening({ criteriaVersion: 'v1', decisions: [decision({ recheckAfter: localToday() })] })
    assert.equal(look(due).status, 'eligible')
    due.recordScreening({ criteriaVersion: 'v2', decisions: [decision({ decision: 'reject', reason: 'Licence required' })] })
    assert.equal(look(due).status, 'already-decided')
    fails(() => due.recordScreening({ decisions: [decision({ decision: 'reject', recheckAfter: '2027-01-01', recheckReason: 'x' })] }), 400, /recheckAfter/)
  })

  test('reopening makes a decision eligible and keeps it; different requisitions stay apart', () => {
    const s = fresh()
    const [d] = s.recordScreening({ criteriaVersion: 'v1', decisions: [decision({ decision: 'reject', requisition: 'R-1' })] })
    assert.equal(look(s, { requisition: 'R-2' }).status, 'eligible')
    assert.equal(look(s, { requisition: 'R-1' }).status, 'already-decided')
    s.reopenScreening({ id: d.id, reason: 'Employer clarified' })
    assert.match(look(s, { requisition: 'R-1' }).recheck, /Employer clarified/)
    s.recordScreening({ criteriaVersion: 'v2', decisions: [decision({ decision: 'reject', requisition: 'R-1' })] })
    assert.equal(look(s, { requisition: 'R-1' }).status, 'already-decided')
    fails(() => s.reopenScreening({ id: d.id, reason: 'again' }), 409)
  })

  test('an unfinished search goes back in the queue; an older check never replaces a newer one', () => {
    const s = fresh()
    const app = s.addApplication(job({ lastChecked: '2026-11-25T12:00:00Z', postingStatus: 'closed' }))
    const t = s.queueResearch({ query: 'q' })
    const first = s.claimResearch({})
    fails(() => s.failResearch({ taskId: t.id, claimToken: 'wrong', reason: 'x' }), 409)
    assert.equal(s.failResearch({ taskId: t.id, claimToken: first.claimToken, reason: 'Site down' }).status, 'queued')
    const second = s.claimResearch({})
    const done = s.completeResearch({ taskId: t.id, claimToken: second.claimToken, findings: [{ company: app.company, title: app.title, sourceUrl: app.sourceUrl, checkedAt: '2026-11-20T12:00:00Z', postingStatus: 'open' }] })
    assert.equal(done.results[0].action, 'kept-newer-check')
    assert.equal(s.application(app.id).postingStatus, 'closed')
  })
})

describe('posting links', () => {
  const posting = { company: 'Cedar Health', title: 'Research Coordinator', sourceUrl: 'https://careers.example.org/jobs/2231' }
  const page = (body, title = 'Research Coordinator | Cedar Health') => `<html><head><title>${title}</title></head><body>${body}</body></html>`
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }]
  const html = (body, init = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init })
  const one = async (fetchRequest, p = posting, opts = {}) => (await checkPostings([p], { fetchRequest, lookup, ...opts })).results[0]

  test('recognises the right job, a closed page, another job and a security check', async () => {
    assert.equal((await one(async () => html(page('<h1>Research Coordinator</h1> Cedar Health <a href="/apply">Apply now</a>')))).outcome, 'verified')
    assert.equal((await one(async () => html(page('This position is no longer available')))).outcome, 'unavailable')
    assert.equal(classifyPage(page('<script type="application/ld+json">{"@type":"JobPosting","title":"Chef"}</script>', 'Chef'), posting, posting.sourceUrl).outcome, 'unavailable')
    assert.equal((await one(async () => html(page('Verify you are human', 'Just a moment')))).outcome, 'blocked')
    assert.equal((await one(async () => html(page('<div id="app"></div>', 'Careers')))).outcome, 'needs-browser-check')
    assert.equal((await one(async () => new Response('', { status: 404 }))).outcome, 'unavailable')
    assert.equal((await one(async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }))).outcome, 'needs-browser-check')
  })

  test('follows redirects safely and reports dead ends', async () => {
    const toBoard = async (url) => (url.endsWith('2231') ? new Response(null, { status: 302, headers: { location: '/careers' } }) : html('x'))
    assert.match((await one(toBoard)).reason, /general careers page/)
    const loop = async () => new Response(null, { status: 302, headers: { location: posting.sourceUrl } })
    assert.match((await one(loop)).reason, /loop/)
    const never = () => new Promise(() => {})
    assert.equal((await one(never, posting, { timeoutMs: 20 })).outcome, 'blocked')
  })

  test('never contacts private addresses or non-https links', async () => {
    let called = 0
    const spy = async () => { called++; return html('x') }
    for (const sourceUrl of ['http://example.org/1', 'https://localhost/1', 'https://127.0.0.1/1', 'https://user:pw@example.org/', 'not a link', 'https://example.org:8443/1']) {
      assert.equal((await one(spy, { ...posting, sourceUrl })).outcome, 'unsafe', sourceUrl)
    }
    assert.equal((await one(spy, posting, { lookup: async () => [{ address: '10.0.0.5', family: 4 }] })).outcome, 'unsafe')
    const hop = async (url) => (url.includes('2231') ? new Response(null, { status: 302, headers: { location: 'https://192.168.0.1/' } }) : spy())
    assert.equal((await one(hop)).outcome, 'unsafe')
    assert.equal(called, 0)
  })
})

describe('search plan', () => {
  test('binomial tail and search for a count', () => {
    assert.equal(chanceOfAtLeast(10, 0.5, 0), 1)
    assert.ok(Math.abs(chanceOfAtLeast(2, 0.5, 1) - 0.75) < 1e-12)
    assert.ok(Math.abs(chanceOfAtLeast(1000, 0.0018, 1) - (1 - 0.9982 ** 1000)) < 1e-9)
    assert.equal(chanceOfAtLeast(3, 0.2, 4), 0)
    const t = triesFor(1, 0.0018, 0.9)
    assert.ok(chanceOfAtLeast(t, 0.0018, 1) >= 0.9 && chanceOfAtLeast(t - 1, 0.0018, 1) < 0.9)
    assert.equal(triesFor(1, 0, 0.9), null)
  })

  test('pace, capacity and what was already sent', () => {
    const goal = { offers: 1, applications: 100, endDate: '2026-12-04', minutesPerApplication: 30, hoursPerWeek: 5 }
    const p = projectPlan(goal, { today: '2026-11-23', submitted: 20 })
    assert.equal(p.weekdaysLeft, 10)
    assert.equal(p.perWeekday, 8)
    assert.equal(p.achievableApplications, 20)
    assert.equal(p.limited, true)
    assert.equal(projectPlan({ ...goal, endDate: '2026-11-01' }, { today: '2026-11-23' }).perWeek, null)
    fails(() => projectPlan(undefined), 400, /searchGoal/)
    fails(() => projectPlan({ ...goal, endDate: '2026-02-30' }), 400, /real date/)
    const s = fresh()
    s.setProfile({ searchGoal: goal })
    assert.equal(s.searchPlan({ today: '2026-11-23' }).applicationsLeft, 100)
  })
})
