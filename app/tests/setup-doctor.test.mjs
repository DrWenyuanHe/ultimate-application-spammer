import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { hasGit, isolate, makeCodeRepo, runCli, tempDir } from './helpers.mjs'

isolate('setup')
const { runSetup } = await import('../lib/setup.mjs')
const { briefReport } = await import('../lib/doctor.mjs')
const { openStore } = await import('../lib/store.mjs')
const { archiveMove } = await import('../lib/archive.mjs')
const { FOLDERS } = await import('../lib/paths.mjs')

const bundledRules = JSON.parse(fs.readFileSync(new URL('../templates/writing-rules.json', import.meta.url), 'utf8')).rules

/** Run setup against a specific workspace folder. */
function setupIn(home, options) {
  const previous = process.env.UAS_HOME
  process.env.UAS_HOME = home
  try { return runSetup(options) } finally { process.env.UAS_HOME = previous }
}

test('setup creates folders, database, starter rules, templates and the demo workspace', () => {
  const home = tempDir('setup-first')
  const report = setupIn(home, { demo: true })
  assert.deepEqual(report.createdFolders.sort(), Object.values(FOLDERS).sort())
  for (const f of Object.values(FOLDERS)) assert.ok(fs.statSync(path.join(home, f)).isDirectory(), f)
  assert.ok(fs.existsSync(path.join(home, 'app', 'data', 'workspace.sqlite')))
  assert.ok(fs.existsSync(path.join(home, 'app', 'data', 'demo.sqlite')))
  assert.ok(fs.existsSync(path.join(home, 'app', 'data', 'setup-state.json')))
  assert.equal(report.rules.added, bundledRules.length)
  assert.equal(report.demoLoaded, true)
  assert.equal(report.profileComplete, false)
  const templates = path.join(home, FOLDERS.templates)
  for (const f of ['resume-format.json', 'cover-letter-format.json', 'Resume master.docx', 'Cover letter master.docx', 'Format Guide.md', 'Review Checklist.md', 'Writing Rules.md',
    path.join('Examples', 'Example resume (fictional).docx'), path.join('Examples', 'Example cover letter (fictional).docx')]) {
    assert.ok(fs.existsSync(path.join(templates, f)), f)
  }
  assert.ok(!fs.existsSync(path.join(home, '3 Job Leads')), 'no job-lead export folder any more')
  assert.equal(report.views, undefined)
  assert.ok(report.templates.every((p) => !path.isAbsolute(p)))

  const previous = process.env.UAS_HOME
  process.env.UAS_HOME = home
  try {
    const demo = openStore({ demo: true })
    const demoJson = JSON.parse(fs.readFileSync(new URL('../demo/demo.json', import.meta.url), 'utf8'))
    assert.equal(demo.applications().length, demoJson.applications.length)
    assert.equal(demo.profile().name, demoJson.profile.name)
    demo.close()
    const real = openStore()
    assert.equal(real.applications().length, 0, 'the real workspace starts empty')
    assert.equal(real.profile(), null)
    real.close()
  } finally { process.env.UAS_HOME = previous }
})

test('re-running setup is idempotent and keeps what the person edited', () => {
  const home = tempDir('setup-rerun')
  setupIn(home, { demo: true })
  const formatFile = path.join(home, FOLDERS.templates, 'resume-format.json')
  const edited = JSON.parse(fs.readFileSync(formatFile, 'utf8'))
  edited.font = 'Garamond'
  fs.writeFileSync(formatFile, JSON.stringify(edited, null, 2))
  const guide = path.join(home, FOLDERS.templates, 'Format Guide.md')
  fs.appendFileSync(guide, '\nMy personal note.\n')

  const again = setupIn(home, { demo: true })
  assert.deepEqual(again.createdFolders, [])
  assert.equal(again.rules.added, 0)
  assert.equal(again.demoLoaded, false)
  assert.equal(JSON.parse(fs.readFileSync(formatFile, 'utf8')).font, 'Garamond', 'edited format file is kept')
  const archived = fs.readdirSync(path.join(home, 'Archive')).filter((f) => f.endsWith('Format Guide.md'))
  assert.equal(archived.length, 1, 'the edited guide was archived before refresh')
  assert.match(fs.readFileSync(path.join(home, 'Archive', archived[0]), 'utf8'), /My personal note/)

  const previous = process.env.UAS_HOME
  process.env.UAS_HOME = home
  try {
    const s = openStore()
    assert.equal(s.rules().length, bundledRules.length)
    s.close()
    const demo = openStore({ demo: true })
    const demoJson = JSON.parse(fs.readFileSync(new URL('../demo/demo.json', import.meta.url), 'utf8'))
    assert.equal(demo.applications().length, demoJson.applications.length, 'demo is not loaded twice')
    demo.close()
  } finally { process.env.UAS_HOME = previous }
})

test('the Word master is rebuilt from the person\'s edited format file', async () => {
  const home = tempDir('setup-format')
  setupIn(home, { demo: false })
  const formatFile = path.join(home, FOLDERS.templates, 'resume-format.json')
  const edited = JSON.parse(fs.readFileSync(formatFile, 'utf8'))
  edited.font = 'Garamond'
  fs.writeFileSync(formatFile, JSON.stringify(edited))
  setupIn(home, { demo: false })
  const { readZip } = await import('../lib/zip.mjs')
  const xml = readZip(fs.readFileSync(path.join(home, FOLDERS.templates, 'Resume master.docx'))).get('word/document.xml').toString()
  assert.match(xml, /w:ascii="Garamond"/)
  assert.ok(!fs.existsSync(path.join(home, 'app', 'data', 'demo.sqlite')), '--no-demo does not create the demo database')
})

test('briefReport summarises each status in a few lines', () => {
  const base = { version: '0.1.0', dashboard: false, checks: [], update: null }
  assert.match(briefReport({ ...base, status: 'first-run' }), /status: first-run[\s\S]*app\/skills\/setup\.md/)
  const onboarding = briefReport({ ...base, status: 'onboarding-needed', checks: [{ id: 'profile', ok: false, detail: 'Profile not filled in yet' }, { id: 'screening-answers', ok: false, detail: '3 common application questions not answered yet' }, { id: 'folders', ok: true, detail: 'fine' }] })
  assert.ok(onboarding.includes('Onboarding not finished (Profile not filled in yet; 3 common application questions not answered yet)'), onboarding)
  assert.ok(onboarding.includes('app/skills/onboarding.md'))
  assert.ok(!onboarding.includes('fine'))
  const repair = briefReport({ ...base, status: 'needs-repair', checks: [{ id: 'folders', ok: false, fix: 'Run setup.' }, { id: 'pdf', ok: false, optional: true, fix: 'optional' }, { id: 'profile', ok: false, fix: 'ask' }, { id: 'screening-answers', ok: false, fix: 'answer' }] })
  assert.match(repair, /Needs repair: folders — Run setup\./)
  assert.ok(!repair.includes('pdf —') && !repair.includes('profile —') && !repair.includes('screening-answers —'), 'onboarding items are not repairs')
  const ready = briefReport({ ...base, status: 'ready', dashboard: true, update: { shouldPrompt: true, current: '0.1.0', latest: 'v0.2.0', notes: 'Faster\n\n- exports' } })
  assert.match(ready, /^\[Ultimate Application Spammer v0\.1\.0\] status: ready · dashboard running/)
  assert.match(ready, /Version v0\.2\.0 is available/)
  assert.ok(!ready.includes('Faster'), 'remote release notes are not injected into the session-start text')
  assert.match(ready, /update check/)
  assert.ok(!briefReport({ ...base, status: 'ready', update: { shouldPrompt: false, latest: 'v0.2.0' } }).includes('available'))
})

test('doctor: first-run → onboarding-needed → ready, and needs-repair when a folder goes missing', { skip: !hasGit() && 'git is not installed', timeout: 300000 }, () => {
  // doctor inspects the code checkout's Git state, so run a Git copy of the code, never the real checkout.
  const { cli } = makeCodeRepo('doctor-code')
  const home = tempDir('doctor-home')
  const doctor = () => {
    const r = runCli(['doctor', '--offline'], { home, cli })
    assert.equal(r.status, 0, r.stderr)
    return r.json()
  }

  let report = doctor()
  assert.equal(report.status, 'first-run')
  assert.equal(report.update, null, '--offline makes no update check')
  const brief = runCli(['doctor', '--offline', '--brief'], { home, cli })
  assert.match(brief.stdout, /status: first-run/)

  setupIn(home, { demo: false })
  report = doctor()
  assert.equal(report.status, 'onboarding-needed', JSON.stringify(report.checks.filter((c) => !c.ok)))
  for (const id of ['node', 'git', 'install', 'folders', 'database', 'database-open', 'templates']) {
    assert.equal(report.checks.find((c) => c.id === id)?.ok, true, id)
  }

  assert.equal(report.checks.find((c) => c.id === 'screening-answers')?.ok, false)
  const set = runCli(['op', 'run', 'profile.set', '--file', writeProfile(home)], { home, cli })
  assert.equal(set.status, 0, set.stderr)
  report = doctor()
  assert.equal(report.status, 'onboarding-needed', 'a profile alone is not enough')
  assert.match(runCli(['doctor', '--offline', '--brief'], { home, cli }).stdout, /common application questions not answered/)

  const bank = JSON.parse(fs.readFileSync(new URL('../templates/screening-questions.json', import.meta.url), 'utf8')).questions
  const required = bank.filter((q) => q.required)
  const answersFile = path.join(home, 'answers-input.json')
  fs.writeFileSync(answersFile, JSON.stringify({ answers: Object.fromEntries(required.slice(1).map((q) => [q.id, q.options?.[0] ?? 'Answer'])) }))
  assert.equal(runCli(['op', 'run', 'answers.set', '--file', answersFile], { home, cli }).status, 0)
  assert.equal(doctor().status, 'onboarding-needed', 'one required answer still missing')
  fs.writeFileSync(answersFile.replace('.json', '-2.json'), JSON.stringify({ answers: { [required[0].id]: required[0].options?.[0] ?? 'Answer' } }))
  assert.equal(runCli(['op', 'run', 'answers.set', '--file', answersFile.replace('.json', '-2.json')], { home, cli }).status, 0)
  report = doctor()
  assert.equal(report.status, 'ready', JSON.stringify(report.checks.filter((c) => !c.ok)))

  const previous = process.env.UAS_HOME
  process.env.UAS_HOME = home
  try { archiveMove(path.join(home, FOLDERS.guides), { reason: 'test: simulate a missing folder' }) } finally { process.env.UAS_HOME = previous }
  report = doctor()
  assert.equal(report.status, 'needs-repair')
  assert.match(runCli(['doctor', '--offline', '--brief'], { home, cli }).stdout, /Needs repair: folders/)
})

function writeProfile(home) {
  const file = path.join(home, 'profile-input.json')
  fs.writeFileSync(file, JSON.stringify({ fields: { name: 'Jordan Example', email: 'jordan@example.com', city: 'Springfield' } }))
  return file
}
