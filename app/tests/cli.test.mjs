// End-to-end through the agent interface: `node app/cli.mjs op run NAME --file|--input|--stdin`.
// Every run prints one JSON envelope and exits 1 when it is not ok. Each child process sees only
// a temp workspace (UAS_HOME).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CLI, childEnv, isolate, job, runCli, runCliAsync, writeJson } from './helpers.mjs'

const home = isolate('cli')
const { FOLDERS } = await import('../lib/paths.mjs')
const cli = (args, env) => runCli(args, { home, env })
let inputs = 0

function parseEnvelope(name, r) {
  let envelope
  try { envelope = JSON.parse(r.stdout) } catch { throw new Error(`op ${name}: not JSON (exit ${r.status})\n${r.stdout}\n${r.stderr}`) }
  assert.deepEqual(Object.keys(envelope).sort(), envelope.ok ? ['ok', 'op', 'result'] : ['error', 'ok', 'op'])
  assert.equal(envelope.op, name)
  assert.equal(r.status, envelope.ok ? 0 : 1, 'exit code matches the envelope')
  return { status: r.status, envelope, error: envelope.error, result: envelope.result }
}
const inputFile = (name, input) => writeJson(home, path.join('inputs', `${++inputs}-${name}.json`), input)
const op = (name, input, { env } = {}) => parseEnvelope(name, cli(['op', 'run', name, '--file', inputFile(name, input)], env))
const ok = (name, input) => {
  const r = op(name, input)
  assert.equal(r.envelope.ok, true, `${name}: ${JSON.stringify(r.error)}`)
  return r.result
}

test('help lists the op interface and the app commands; old data commands are gone', () => {
  const r = cli(['help'])
  assert.equal(r.status, 0)
  for (const c of ['op list', 'op describe NAME', 'op run NAME', 'doctor', 'setup', 'start', 'stop', 'update apply', 'version']) assert.ok(r.stdout.includes(c), c)
  assert.equal(cli([]).status, 0)
  for (const old of ['apps', 'research', 'library', 'archive', 'backup', 'storage']) {
    const x = cli([old, 'list'])
    assert.equal(x.status, 1, old)
    assert.match(x.stderr, /Unknown command/)
  }
})

test('op list / op describe from the command line', () => {
  const list = JSON.parse(cli(['op', 'list']).stdout)
  for (const n of ['jobs.add', 'search.claim', 'submissions.record', 'answers.set', 'evidence.strength', 'backup.restore', 'storage.tidy', 'files.archive']) assert.ok(list.some((o) => o.name === n), n)
  const d = JSON.parse(cli(['op', 'describe', 'jobs.add']).stdout)
  assert.ok(d.example && d.input.job)
  const unknown = cli(['op', 'describe', 'jobs.delete'])
  assert.equal(unknown.status, 1)
  assert.equal(op('jobs.delete', {}).error.status, 404)
})

test('input channels and validation: --file, --input, --stdin, bad JSON, missing flag values, unknown fields', () => {
  assert.match(op('jobs.add', { job: job(), sneaky: true }).error.message, /does not take: sneaky/)
  assert.match(op('jobs.update', { patch: {} }).error.message, /needs: id/)
  assert.equal(op('jobs.update', { id: 'x', patch: {}, expectedVersion: '2' }).error.status, 400)
  const bad = parseEnvelope('jobs.list', cli(['op', 'run', 'jobs.list', '--input', '{not json']))
  assert.equal(bad.error.status, 400)
  const noValue = cli(['op', 'run', 'jobs.list', '--file'])
  assert.equal(noValue.status, 1)
  assert.match(noValue.stdout + noValue.stderr, /--file needs a value/)
  assert.deepEqual(parseEnvelope('jobs.list', cli(['op', 'run', 'jobs.list', '--input', '{"q":"nothing-matches"}'])).result, [])
  assert.deepEqual(parseEnvelope('jobs.list', cli(['op', 'run', 'jobs.list', '--input={"q":"nothing"}'])).result, [])
  const stdin = spawnSync(process.execPath, [CLI, 'op', 'run', 'search.list', '--stdin'], { input: '{}', encoding: 'utf8', env: childEnv(home), windowsHide: true })
  assert.equal(parseEnvelope('search.list', { status: stdin.status, stdout: stdin.stdout }).envelope.ok, true)
})

test('profile and answers', () => {
  assert.deepEqual(ok('profile.get', {}), { empty: true })
  const p = ok('profile.set', { fields: { name: 'Jordan Example', submissionMode: 'review-first' } })
  assert.equal(op('profile.set', { fields: { submissionMode: 'yolo' } }).error.status, 400)
  assert.equal(op('profile.set', { fields: { city: 'X' }, expectedVersion: p.version + 9 }).error.status, 409)
  const before = ok('answers.get', {})
  assert.ok(before.missingRequired.length > 0)
  assert.equal(op('answers.set', { answers: { 'not-a-question': 'x' } }).error.status, 400)
  const id = before.missingRequired[0]
  ok('answers.set', { answers: { [id]: 'Yes' }, custom: [{ question: 'Earliest start?', answer: 'Two weeks' }] })
  const after = ok('answers.get', {})
  assert.ok(!after.missingRequired.includes(id))
  assert.equal(after.custom[0].answer, 'Two weeks')
})

let jobId
test('jobs: add, duplicate, all-or-nothing batch, update with versions, bulk update, history', () => {
  const created = ok('jobs.add', { job: job() })
  jobId = created.id
  assert.ok(fs.existsSync(path.join(home, 'app', 'data', 'workspace.sqlite')), 'database lives in UAS_HOME')
  const dup = op('jobs.add', { job: job({ sourceUrl: `${job().sourceUrl}?utm_source=mail` }) })
  assert.equal(dup.error.status, 409)
  assert.equal(dup.error.details.existingId, created.id)
  const count = ok('jobs.list', {}).length
  assert.equal(op('jobs.add', { jobs: [job({ sourceUrl: 'https://example.com/jobs/a' }), job({ sourceUrl: 'https://example.com/jobs/a?gh_src=1' })] }).status, 1)
  assert.equal(ok('jobs.list', {}).length, count)
  assert.equal(op('jobs.update', { id: created.id, patch: { stage: 'Ready' }, expectedVersion: 5 }).error.status, 409)
  assert.equal(ok('jobs.update', { id: created.id, patch: { stage: 'Preparing' }, expectedVersion: 1 }).version, 2)
  const other = ok('jobs.add', { job: job({ sourceUrl: 'https://example.com/jobs/b' }) })
  assert.equal(op('jobs.bulk-update', { items: [{ id: other.id, patch: { priority: 1 } }, { id: created.id, patch: { stage: 'Nope' } }] }).error.status, 400)
  assert.equal(ok('jobs.get', { id: other.id }).priority, 2, 'bulk update is atomic')
  assert.equal(ok('jobs.history', { id: created.id }).length, 2)
})

test('search: queue → claim → complete; token never listed and not replayable', () => {
  const task = ok('search.queue', { title: 'Analyst roles', query: 'data analyst', location: 'Remote' })
  const claim = ok('search.claim', { worker: 'test-agent' })
  assert.equal(claim.task.id, task.id)
  assert.match(claim.claimToken, /^[0-9a-f]+$/)
  assert.ok(!JSON.stringify(ok('search.list', {})).includes(claim.claimToken))
  assert.equal(ok('search.claim', {}).claimed, false, 'nothing else queued')
  const findings = [{ company: 'Birch Labs', title: 'Data Analyst', sourceUrl: 'https://jobs.lever.co/birch/xyz', checkedAt: '2026-11-24T12:00:00Z' }]
  assert.equal(op('search.complete', { taskId: task.id, claimToken: 'wrong', findings }).error.status, 409)
  const done = ok('search.complete', { taskId: task.id, claimToken: claim.claimToken, summary: 'Found one', findings })
  assert.equal(done.results[0].action, 'added')
  assert.equal(op('search.complete', { taskId: task.id, claimToken: claim.claimToken, findings }).error.status, 409)
})

test('screen: preflight then record decisions with evidence', () => {
  const candidates = [{ company: 'New Co', title: 'Analyst', sourceUrl: 'https://new.example.com/jobs/9' }, { company: 'Maple Analytics', title: 'Data Scientist', sourceUrl: job().sourceUrl }]
  const pre = ok('screen.preflight', { candidates, criteriaVersion: 'v1' })
  assert.deepEqual(pre.report.map((r) => r.status), ['eligible', 'existing-application'])
  assert.match(op('screen.preflight', { candidates }).error.message, /needs: criteriaVersion/)
  const decision = { company: 'New Co', title: 'Analyst', sourceUrl: 'https://new.example.com/jobs/9', decision: 'shortlist', reason: 'Strong fit', evidence: [{ url: 'https://new.example.com/jobs/9', checkedAt: '2026-11-24T10:00:00Z' }] }
  assert.equal(op('screen.record', { decisions: [{ ...decision, evidence: [] }], criteriaVersion: 'v1' }).error.status, 400)
  const [rec] = ok('screen.record', { decisions: [decision], criteriaVersion: 'v1' })
  assert.ok(rec.applicationId)
  assert.equal(op('screen.record', { decisions: [decision] }).error.status, 409, 'a re-decision needs recheckReason')
  assert.equal(ok('screen.list', {}).length, 1)
})

test('employers: add, duplicate, update, list', () => {
  const e = ok('employers.add', { employer: { name: 'Aspen Health', sector: 'Health', careersUrl: 'https://aspen.wd3.myworkdayjobs.com/External' } })
  assert.equal(e.platform, 'Workday')
  assert.equal(op('employers.add', { employer: { name: 'aspen health' } }).error.status, 409)
  assert.equal(ok('employers.update', { id: e.id, patch: { notes: 'Spring cycle' }, expectedVersion: 1 }).notes, 'Spring cycle')
  assert.equal(ok('employers.list', { q: 'aspen' }).length, 1)
})

let materialId
test('evidence + strength, materials (versions and files), brief and packets', () => {
  const ev = ok('evidence.add', { item: { kind: 'experience', title: 'Lab coordinator', star: { situation: 's', task: 't' } } })
  assert.equal(op('evidence.add', { item: { kind: 'hobby', title: 'x' } }).error.status, 400)
  ok('evidence.update', { id: ev.id, patch: { reviewStatus: 'candidate-confirmed' }, expectedVersion: 1 })
  const strength = ok('evidence.strength', {})
  assert.equal(strength.total, 1)
  assert.deepEqual(strength.items[0].missing.sort(), ['action', 'evidence', 'measuredResult', 'result'])

  const src = path.join(home, 'inputs', 'Base resume.docx')
  fs.writeFileSync(src, 'docx bytes')
  const m = ok('materials.save', { material: { kind: 'resume', title: 'Base resume', content: 'v1', file: src } })
  materialId = m.id
  ok('materials.save', { material: { kind: 'resume', title: 'Base resume', content: 'v2' }, id: m.id, expectedVersion: 1 })
  assert.equal(ok('materials.get', { id: m.id, version: 1 }).content, 'v1')
  assert.equal(ok('materials.list', { kind: 'resume' }).length, 1)

  const brief = ok('brief.get', { applicationId: jobId })
  assert.equal(brief.application.id, jobId)
  assert.equal(brief.evidence.length, 1)
  assert.deepEqual(brief.templates.map((t) => t.id), [m.id])
  const packet = ok('packets.create', { applicationId: jobId, items: [{ materialId: m.id, version: 1 }] })
  assert.equal(packet.items[0].version, 1)
})

test('rules: propose, approve (text, source, current version), retire', () => {
  const rule = ok('rules.propose', { rule: { title: 'Short bullets', rule: 'Keep bullets under two lines.' } })
  assert.match(op('rules.approve', { id: rule.id, version: 1, approvalSource: 'chat' }).error.message, /needs: approvalText/)
  assert.equal(op('rules.approve', { id: rule.id, version: 2, approvalText: 'yes', approvalSource: 'chat' }).error.status, 409)
  assert.equal(ok('rules.approve', { id: rule.id, version: 1, approvalText: 'yes please', approvalSource: 'chat, 2026-11-25' }).status, 'approved')
  assert.ok(ok('rules.list', {}).active.some((r) => r.id === rule.id))
  assert.match(fs.readFileSync(path.join(home, FOLDERS.templates, 'Writing Rules.md'), 'utf8'), /Short bullets/)
  assert.equal(ok('rules.retire', { id: rule.id, reason: 'asked to stop' }).status, 'retired')
})

test('docs: resume into "1 Applications/Drafts" (never overwriting), check, cover letter for a job', () => {
  const content = { name: 'Jordan Example', contact: ['Springfield', 'jordan@example.com'], summary: 'Analyst with **five** years of experience.' }
  const first = ok('docs.resume', { content })
  assert.equal(path.dirname(first.docx), path.join(home, FOLDERS.applications, 'Drafts'))
  assert.equal(path.basename(first.docx), 'Jordan Example Resume.docx')
  assert.deepEqual(first.placeholdersLeft, [])
  assert.equal(path.basename(ok('docs.resume', { content }).docx), 'Jordan Example Resume (2).docx')
  const check = ok('docs.check', { file: first.docx })
  assert.deepEqual(check.fonts, ['Times New Roman'])
  assert.ok(check.sizesPt.includes(18))
  const letter = ok('docs.cover-letter', { content: { name: 'Jordan Example', paragraphs: ['Hello'] }, applicationId: jobId, save: true })
  assert.equal(path.basename(path.dirname(letter.docx)), 'Maple Analytics - Data Scientist')
  assert.equal(letter.material.kind, 'cover-letter')
  assert.equal(op('docs.resume', { content: { summary: 'no name' } }).status, 1)
})

test('submissions: record needs confirmation; files are copied into 1 Applications', () => {
  const file = path.join(home, 'inputs', 'Resume as sent.pdf')
  fs.writeFileSync(file, 'pdf bytes')
  assert.equal(op('submissions.record', { applicationId: jobId, submittedAt: '2026-11-20', confirmedBySubmitter: false }).error.status, 400)
  const r = ok('submissions.record', { applicationId: jobId, submittedAt: '2026-11-20', confirmedBySubmitter: true, files: [file], answers: [{ question: 'Eligible?', answer: 'Yes' }] })
  assert.ok(fs.existsSync(path.join(r.folder, 'Resume as sent.pdf')))
  assert.ok(r.folder.startsWith(path.join(home, FOLDERS.applications)))
  assert.equal(ok('jobs.get', { id: jobId }).stage, 'Applied')
  assert.equal(ok('submissions.list', {}).length, 1)
})

test('files.archive moves a file into Archive/ with a reason', () => {
  const file = path.join(home, FOLDERS.library, 'old notes.txt')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'old')
  assert.match(op('files.archive', { path: file }).error.message, /needs: reason/)
  const r = ok('files.archive', { path: file, reason: 'superseded' })
  assert.ok(!fs.existsSync(file))
  assert.equal(path.dirname(r.archivedTo), path.join(home, 'Archive'))
  assert.equal(fs.readFileSync(r.archivedTo, 'utf8'), 'old')
  assert.equal(op('files.archive', { path: path.join(home, 'missing.txt'), reason: 'x' }).status, 1)
})

test('storage.report and storage.tidy (dry run unless apply:true)', () => {
  const render = path.join(home, 'app', 'data', 'render', 'job-x', 'document.pdf')
  fs.mkdirSync(path.dirname(render), { recursive: true })
  fs.writeFileSync(render, 'pdf')
  assert.ok(ok('storage.report', {}).items.some((i) => i.label === 'Database' && i.bytes > 0))
  const plan = ok('storage.tidy', {})
  assert.equal(plan.dryRun, true)
  assert.ok(plan.items.some((i) => i.path === path.dirname(render)))
  assert.ok(fs.existsSync(render))
  const applied = ok('storage.tidy', { apply: true })
  assert.ok(applied.moved.some((m) => m.archivedTo.includes(path.join('Archive', 'Clearable'))))
  assert.ok(!fs.existsSync(render))
})

test('backup: now / list / restore; restore is refused while this workspace\'s dashboard runs', async () => {
  const snap = ok('backup.now', {})
  assert.ok(fs.existsSync(snap.file))
  assert.ok(ok('backup.list', {}).some((b) => b.file === snap.file))
  const extra = ok('jobs.add', { job: job({ sourceUrl: 'https://example.com/jobs/after-backup' }) })

  const { createServer } = await import('../server.mjs')
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    // async spawn: this process must keep answering the child's health probe
    const blocked = parseEnvelope('backup.restore', await runCliAsync(['op', 'run', 'backup.restore', '--file', inputFile('backup.restore', { file: snap.file })], { home, env: { PORT: String(port) } }))
    assert.equal(blocked.error?.status, 409, JSON.stringify(blocked.envelope))
    assert.match(blocked.error.message, /Close the dashboard/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  assert.equal(ok('jobs.get', { id: extra.id }).id, extra.id, 'nothing was restored while blocked')
  const restored = op('backup.restore', { file: snap.file })
  assert.equal(restored.envelope.ok, true, JSON.stringify(restored.error))
  assert.equal(op('jobs.get', { id: extra.id }).error.status, 404, 'database rolled back to the snapshot')
  assert.ok(restored.result.previous, 'the replaced database was snapshotted first')
})

test('version prints the package version', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(cli(['version']).stdout.trim(), pkg.version)
})

test('argument errors on "op run" still print the JSON envelope', () => {
  const r = parseEnvelope('jobs.list', cli(['op', 'run', 'jobs.list', '--file']))
  assert.equal(r.error.status, 400)
})

test('backup.restore is refused while a dashboard for this workspace runs on a non-default port', async () => {
  const snap = ok('backup.now', {})
  const { createServer } = await import('../server.mjs')
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    // the restoring process does NOT know the dashboard's port, exactly like a fresh agent session
    const r = parseEnvelope('backup.restore', await runCliAsync(['op', 'run', 'backup.restore', '--file', inputFile('backup.restore', { file: snap.file })], { home }))
    assert.equal(r.error?.status, 409, JSON.stringify(r.envelope))
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
