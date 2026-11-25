import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { isolate, job } from './helpers.mjs'

const home = isolate('storage')
const { storageReport, tidy } = await import('../lib/storage.mjs')
const { openStore } = await import('../lib/store.mjs')
const { snapshot } = await import('../lib/backup.mjs')
const { FOLDERS } = await import('../lib/paths.mjs')

const data = path.join(home, 'app', 'data')
const day = 86400000
function put(rel, content = 'x', ageDays = 0) {
  const file = path.join(home, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  if (ageDays) { const t = new Date(Date.now() - ageDays * day); fs.utimesSync(file, t, t) }
  return file
}

// A workspace with one item of every kind tidy has to decide about.
const store = openStore({ allowNew: true })
const oldJob = store.addApplication(job({ company: 'Maple Analytics', title: 'Data Scientist' }))
const newJob = store.addApplication(job({ company: 'Birch Labs', title: 'Analyst', sourceUrl: 'https://example.com/jobs/birch' }))
const oldSub = store.recordSubmission({ applicationId: oldJob.id, submittedAt: '2026-09-01', confirmedBySubmitter: true })
store.t.update('submission', oldSub.submission.id, (cur) => ({ ...cur, recordedAt: new Date(Date.now() - 45 * day).toISOString() }))
store.recordSubmission({ applicationId: newJob.id, submittedAt: '2026-11-20', confirmedBySubmitter: true })
const src = put('inputs/resume.docx', 'resume bytes')
store.saveMaterial({ kind: 'resume', title: 'Base', file: src })
store.close()
const backupFile = snapshot({ reason: 'manual' }).file

const clearableExpected = {
  render: put('app/data/render/job-1/document.pdf', 'pdf'),
  preview: put('app/data/preview/letter.pdf', 'pdf'),
  oldLog: put('app/data/logs/old.log', 'log', 20),
  oldDiscovery: put('app/data/discovery/old.json', '{}', 40),
  oldClaim: put('app/data/claims/old.json', '{}', 40),
  review: put('app/data/reviews/notes.md', 'notes'),
  oldDraft: put('1 Applications/Drafts/Maple Analytics - Data Scientist/Jordan Example Resume.docx', 'draft'),
}
const keep = {
  newLog: put('app/data/logs/new.log', 'log', 2),
  newDiscovery: put('app/data/discovery/new.json', '{}', 5),
  newClaim: put('app/data/claims/new.json', '{}', 5),
  recentDraft: put('1 Applications/Drafts/Birch Labs - Analyst/Resume.docx', 'draft'),
  looseDraft: put('1 Applications/Drafts/Unrelated.docx', 'draft'),
  library: put('2 Career Library/My CV.docx', 'cv'),
  template: put(`${FOLDERS.templates}/resume-format.json`, '{}'),
}

test('storage report lists every category with sizes', () => {
  const r = storageReport()
  const labels = r.items.map((i) => i.label)
  for (const l of ['Database', 'Database backups', 'Saved document versions', 'Submitted applications', 'PDF render work files', 'Dashboard logs', 'Archive/Clearable (safe to empty by hand)']) assert.ok(labels.includes(l), l)
  const db = r.items.find((i) => i.label === 'Database')
  assert.ok(db.bytes > 0 && db.files === 1)
  assert.equal(r.items.find((i) => i.label === 'Database backups').files, 1)
  assert.match(r.total, /\d (B|KB|MB|GB)$/)
})

test('tidy dry run lists only clearable items and moves nothing', () => {
  const plan = tidy({ dryRun: true, store: openStore() })
  assert.equal(plan.dryRun, true)
  const listed = plan.items.map((i) => i.path).sort()
  const expected = Object.values(clearableExpected).map((p) => (p.includes(`${path.sep}render${path.sep}`) || p.includes(`${path.sep}Drafts${path.sep}`) ? path.dirname(p) : p)).sort()
  assert.deepEqual(listed, expected)
  for (const p of Object.values(clearableExpected)) assert.ok(fs.existsSync(p), `dry run left ${p}`)
  assert.ok(plan.totalBytes > 0)
})

test('tidy --apply moves clearable items into Archive/Clearable/<category> and touches nothing essential', () => {
  const s = openStore()
  const result = tidy({ dryRun: false, store: s })
  s.close()
  assert.equal(result.dryRun, false)
  assert.equal(result.moved.length, Object.keys(clearableExpected).length)
  for (const m of result.moved) {
    assert.ok(m.archivedTo.startsWith(path.join(home, 'Archive', 'Clearable', m.category.replace(/[<>:"/\\|?*]+/g, ' ')) + path.sep), m.archivedTo)
    assert.ok(fs.existsSync(m.archivedTo))
    assert.ok(!fs.existsSync(m.path))
  }
  for (const p of Object.values(keep)) assert.ok(fs.existsSync(p), `kept ${p}`)
  assert.ok(fs.existsSync(path.join(data, 'workspace.sqlite')), 'database untouched')
  assert.ok(fs.existsSync(backupFile), 'backup inside retention untouched')
  assert.equal(fs.readdirSync(path.join(data, 'files')).length, 1, 'stored material files untouched')
  const filed = fs.readdirSync(path.join(home, '1 Applications')).filter((n) => n !== 'Drafts')
  assert.equal(filed.length, 2, 'submitted application folders untouched')
  for (const f of filed) assert.ok(fs.existsSync(path.join(home, '1 Applications', f, 'submission.json')))

  assert.deepEqual(tidy({ dryRun: true, store: openStore() }).items, [], 'nothing left to tidy')
  const report = storageReport()
  const clearable = report.items.find((i) => i.label.startsWith('Archive/Clearable'))
  assert.ok(clearable.bytes > 0)
  const archive = report.items.find((i) => i.label === 'Archive (kept)')
  const walk = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((n, c) => n + walk(path.join(p, c)), 0) : fs.statSync(p).size
  assert.equal(clearable.bytes, walk(path.join(home, 'Archive', 'Clearable')))
  assert.equal(archive.bytes + clearable.bytes, walk(path.join(home, 'Archive')), 'kept + clearable = everything in Archive, counted once')
})
