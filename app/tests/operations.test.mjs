// The operation registry is the only way agents read or change workspace data, so its contract
// (names, documented inputs, strict validation, envelope) is tested directly here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isolate, job } from './helpers.mjs'

isolate('operations')
const { OPERATIONS, listOperations, describeOperation, validateInput, runOperation } = await import('../lib/operations.mjs')

test('every operation documents a summary and its inputs; required fields are documented inputs', () => {
  const names = Object.keys(OPERATIONS)
  assert.ok(names.length >= 30)
  for (const [name, op] of Object.entries(OPERATIONS)) {
    assert.match(name, /^[a-z]+\.[a-z-]+$/, name)
    assert.equal(typeof op.summary, 'string', name)
    assert.ok(op.summary.length > 10, `${name} summary`)
    assert.equal(typeof op.input, 'object', `${name} input`)
    assert.equal(typeof op.run, 'function', `${name} run`)
    for (const r of op.required || []) assert.ok(r in op.input, `${name}: required "${r}" is not a documented input`)
  }
  const listed = listOperations()
  assert.deepEqual(listed.map((o) => o.name).sort(), names.sort())
  for (const o of listed) assert.deepEqual(Object.keys(o).sort(), ['name', 'required', 'summary'])
})

test('every example passes its own operation\'s validation', () => {
  for (const [name, op] of Object.entries(OPERATIONS)) {
    if (!op.example) continue
    assert.doesNotThrow(() => validateInput(name, op.example), name)
  }
})

test('describeOperation returns inputs, required fields and example; unknown names are 404', () => {
  const d = describeOperation('jobs.update')
  assert.deepEqual(d.required, ['id', 'patch'])
  assert.ok(d.input.expectedVersion)
  assert.ok(d.example)
  assert.equal(describeOperation('search.list').example, null)
  assert.throws(() => describeOperation('jobs.delete'), (e) => e.status === 404)
})

test('validation rejects unknown fields, missing required fields, non-objects and non-integer versions', () => {
  const status = (fn) => { try { fn(); return 200 } catch (e) { return e.status } }
  assert.equal(status(() => validateInput('jobs.add', { job: job(), extra: 1 })), 400)
  assert.equal(status(() => validateInput('jobs.update', { id: 'x' })), 400)
  assert.equal(status(() => validateInput('jobs.update', { id: '', patch: {} })), 400)
  assert.equal(status(() => validateInput('jobs.update', { id: 'x', patch: {}, expectedVersion: 1.5 })), 400)
  assert.equal(status(() => validateInput('jobs.update', { id: 'x', patch: {}, expectedVersion: '1' })), 400)
  assert.equal(status(() => validateInput('jobs.list', [])), 400)
  assert.equal(status(() => validateInput('jobs.list', null)), 400)
  assert.equal(status(() => validateInput('nope.nope', {})), 404)
  assert.equal(status(() => validateInput('jobs.update', { id: 'x', patch: {}, expectedVersion: 2 })), 200)
})

test('runOperation never throws and always returns the envelope', async () => {
  const good = await runOperation('jobs.add', { job: job() })
  assert.deepEqual(Object.keys(good).sort(), ['ok', 'op', 'result'])
  assert.equal(good.ok, true)
  assert.equal(good.op, 'jobs.add')
  const dup = await runOperation('jobs.add', { job: job() })
  assert.deepEqual(Object.keys(dup).sort(), ['error', 'ok', 'op'])
  assert.equal(dup.ok, false)
  assert.equal(dup.error.status, 409)
  assert.equal(dup.error.details.existingId, good.result.id)
  const unknown = await runOperation('jobs.add', { job: job(), why: 'improvised' })
  assert.equal(unknown.error.status, 400)
  assert.match(unknown.error.message, /does not take: why/)
  const missing = await runOperation('nope.nope')
  assert.equal(missing.error.status, 404)
  const crash = await runOperation('docs.check', { file: 'C:/definitely/missing.docx' })
  assert.equal(crash.ok, false)
  assert.ok(crash.error.status >= 400)
})

test('read-only operations do not change the revision', async () => {
  const { openStore } = await import('../lib/store.mjs')
  const s = openStore()
  const before = s.revision()
  s.close()
  for (const name of ['jobs.list', 'search.list', 'screen.list', 'employers.list', 'evidence.list', 'evidence.strength', 'materials.list', 'rules.list', 'answers.get', 'profile.get', 'submissions.list']) {
    const r = await runOperation(name, {})
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.error)}`)
  }
  const after = openStore()
  assert.equal(after.revision(), before)
  after.close()
})

// The public contract agents rely on (skills and AGENTS.md name these). Kept independent of
// OPERATIONS so removing or renaming one fails here.
const CONTRACT = [
  'profile.get', 'profile.set', 'answers.get', 'answers.set',
  'jobs.list', 'jobs.get', 'jobs.history', 'jobs.add', 'jobs.update', 'jobs.bulk-update', 'jobs.rank', 'jobs.shortlist', 'postings.check', 'plan.get',
  'search.queue', 'search.list', 'search.claim', 'search.complete', 'search.fail', 'discover.run',
  'screen.preflight', 'screen.record', 'screen.reopen', 'screen.list',
  'employers.list', 'employers.add', 'employers.update', 'employers.sectors', 'employers.import-guide',
  'evidence.list', 'evidence.add', 'evidence.update', 'evidence.get', 'evidence.strength',
  'bullets.save', 'bullets.list', 'bullets.check', 'narratives.list', 'narratives.save', 'publications.report',
  'materials.list', 'materials.get', 'materials.save', 'brief.get', 'packets.create',
  'rules.list', 'rules.save', 'rules.propose', 'rules.revise', 'rules.approve', 'rules.retire',
  'docs.resume', 'docs.cv', 'docs.cover-letter', 'docs.pdf', 'docs.check', 'docs.refresh-templates',
  'submissions.record', 'submissions.list', 'files.archive', 'storage.report', 'storage.tidy',
  'backup.now', 'backup.list', 'backup.mirror', 'backup.restore',
]

test('every operation in the public contract exists', () => {
  const names = new Set(listOperations().map((o) => o.name))
  for (const n of CONTRACT) assert.ok(names.has(n), `missing operation ${n}`)
})

test('inherited object properties are not operations or inputs', () => {
  assert.throws(() => describeOperation('constructor'), (e) => e.status === 404)
  assert.throws(() => validateInput('jobs.list', { constructor: 1 }), (e) => e.status === 400)
})

test('storage.tidy only moves files when apply is literally true', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const file = path.join(process.env.UAS_HOME, 'app', 'data', 'render', 'tidy-type-check', 'x.pdf')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'x')
  for (const apply of ['false', 0, 'no']) {
    const r = await runOperation('storage.tidy', { apply })
    assert.ok(fs.existsSync(file), `apply: ${JSON.stringify(apply)} must not move files`)
    assert.equal(r.ok, false, `apply: ${JSON.stringify(apply)} should be rejected`)
  }
})

test('backup.list works without a live database and does not create one', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { tempDir } = await import('./helpers.mjs')
  const home = tempDir('operations-nodb')
  const previous = process.env.UAS_HOME
  process.env.UAS_HOME = home
  try {
    const empty = await runOperation('backup.list', {})
    assert.equal(empty.ok, true)
    assert.deepEqual(empty.result, [])
    assert.ok(!fs.existsSync(path.join(home, 'app', 'data', 'workspace.sqlite')), 'listing backups did not create an empty database')
  } finally { process.env.UAS_HOME = previous }
})

test('Writing Rules.md keeps the approved wording while a revision is pending', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { FOLDERS } = await import('../lib/paths.mjs')
  const proposed = await runOperation('rules.propose', { rule: { id: 'md-pending', title: 'Pending wording check', rule: 'Original approved wording.' } })
  assert.equal(proposed.ok, true)
  assert.equal((await runOperation('rules.approve', { id: 'md-pending', version: 1, approvalText: 'yes', approvalSource: 'test' })).ok, true)
  assert.equal((await runOperation('rules.revise', { id: 'md-pending', rule: { rule: 'Proposed new wording.' } })).ok, true)
  const md = fs.readFileSync(path.join(process.env.UAS_HOME, FOLDERS.templates, 'Writing Rules.md'), 'utf8')
  assert.ok(md.includes('Original approved wording.'), 'active wording still listed')
  assert.ok(md.includes('Proposed new wording.'), 'proposal listed separately')
})
