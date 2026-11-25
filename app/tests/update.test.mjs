// Release updates, driven through a throwaway Git "remote" with tags v0.1.0 and v0.2.0.
// The fixture repo contains a copy of the real app code, so each clone runs its own CLI.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { assertFixtureRepo, copyCode, git, gitEnv, hasGit, isolate, job, runCli, tempDir, writeJson } from './helpers.mjs'

isolate('update-unit')
const { compareVersions, parseVersion } = await import('../lib/update.mjs')

test('version parsing and comparison', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3])
  assert.deepEqual(parseVersion('0.10.0'), [0, 10, 0])
  assert.equal(parseVersion('v1.2'), null)
  assert.equal(parseVersion('v1.2.3-beta'), null)
  assert.ok(compareVersions('v0.10.0', 'v0.9.9') > 0, 'numeric, not lexical')
  assert.ok(compareVersions('0.1.0', 'v0.2.0') < 0)
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0)
  assert.deepEqual(['v0.2.0', 'v0.10.0', 'v0.1.0'].sort(compareVersions), ['v0.1.0', 'v0.2.0', 'v0.10.0'])
})

function setVersion(repo, version) {
  const file = path.join(repo, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  pkg.version = version
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
}

/** Build remote.git with two tagged releases; v0.2.0 removes docs/old-guide.md and adds docs/new-guide.md. */
function buildRemote() {
  const base = tempDir('update')
  const env = gitEnv(base)
  const work = path.join(base, 'work')
  fs.mkdirSync(work)
  copyCode(work)
  setVersion(work, '0.1.0')
  fs.mkdirSync(path.join(work, 'docs'))
  fs.writeFileSync(path.join(work, 'docs', 'old-guide.md'), '# Old guide\nRemoved in 0.2.0.\n')
  fs.writeFileSync(path.join(work, 'notes.txt'), 'original line\n')
  fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '# Changelog\n\n## 0.1.0\n\n- First release\n')
  git(['init', '--quiet'], { cwd: work, env })
  assertFixtureRepo(work, env)
  git(['add', '-A'], { cwd: work, env })
  git(['commit', '--quiet', '-m', 'Release 0.1.0'], { cwd: work, env })
  git(['tag', 'v0.1.0'], { cwd: work, env })

  setVersion(work, '0.2.0')
  fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '# Changelog\n\n## 0.2.0\n\n- Faster exports\n- Retired the old guide\n\n## 0.1.0\n\n- First release\n')
  git(['rm', '--cached', '--quiet', 'docs/old-guide.md'], { cwd: work, env }) // untrack only; the file stays on disk
  fs.writeFileSync(path.join(work, 'docs', 'new-guide.md'), '# New guide from the release\n')
  git(['add', 'package.json', 'CHANGELOG.md', 'docs/new-guide.md'], { cwd: work, env })
  git(['commit', '--quiet', '-m', 'Release 0.2.0'], { cwd: work, env })
  git(['tag', 'v0.2.0'], { cwd: work, env })
  git(['tag', 'not-a-release'], { cwd: work, env })

  const remote = path.join(base, 'remote.git')
  git(['clone', '--quiet', '--bare', work, remote], { cwd: base, env })
  return { base, env, remote }
}

function cloneAt(fixture, name, ref, { branch } = {}) {
  const dir = path.join(fixture.base, name)
  git(['clone', '--quiet', fixture.remote, dir], { cwd: fixture.base, env: fixture.env })
  assertFixtureRepo(dir, fixture.env)
  git(branch ? ['switch', '--quiet', '-c', branch, ref] : ['switch', '--quiet', '--detach', ref], { cwd: dir, env: fixture.env })
  return dir
}

const countApps = (file) => {
  const db = new DatabaseSync(file, { readOnly: true })
  try { return Number(db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind = 'application'").get().n) } finally { db.close() }
}

describe('update check / snooze / apply / rollback', { skip: !hasGit() && 'git is not installed', timeout: 600000 }, () => {
  const fixture = hasGit() ? buildRemote() : null
  const clone = fixture && cloneAt(fixture, 'clone', 'v0.1.0')
  const home = tempDir('update-home')
  const cli = clone && path.join(clone, 'app', 'cli.mjs')
  const run = (args, dir = cli) => runCli(args, { home, cli: dir, env: fixture.env })
  const ok = (args, dir) => {
    const r = run(args, dir)
    assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}\n${r.stdout}`)
    return r.json()
  }
  const commit = (dir, ref) => git(['rev-parse', `${ref}^{commit}`], { cwd: dir, env: fixture.env })
  const head = (dir) => ['v0.1.0', 'v0.2.0'].find((t) => commit(dir, t) === commit(dir, 'HEAD')) || commit(dir, 'HEAD')
  const addJob = (name, over) => ok(['op', 'run', 'jobs.add', '--file', writeJson(home, name, { job: job(over) })])
  let report

  test('check finds v0.2.0 and its release notes', () => {
    const r = ok(['update', 'check', '--force'])
    assert.equal(r.current, '0.1.0')
    assert.equal(r.latest, 'v0.2.0')
    assert.equal(r.available, true)
    assert.equal(r.shouldPrompt, true)
    assert.match(r.notes, /Faster exports/)
    assert.ok(!r.notes.includes('First release'), 'notes are only the new section')
    assert.ok(fs.existsSync(path.join(home, 'app', 'data', 'update-state.json')), 'state is kept in the isolated workspace')
  })

  test('snooze hides the prompt for that release', () => {
    const s = ok(['update', 'snooze', '--days', '3'])
    assert.equal(s.snoozed, true)
    assert.equal(s.version, 'v0.2.0')
    const r = ok(['update', 'check'])
    assert.equal(r.available, true)
    assert.equal(r.snoozed, true)
    assert.equal(r.shouldPrompt, false)
    assert.equal(ok(['update', 'check', '--force']).shouldPrompt, false)
  })

  test('a contributor branch checkout refuses to update without --allow-branch', () => {
    const branchClone = cloneAt(fixture, 'branch-clone', 'v0.1.0', { branch: 'dev' })
    const r = run(['update', 'apply', '--version', 'v0.2.0'], path.join(branchClone, 'app', 'cli.mjs'))
    assert.equal(r.status, 1)
    assert.match(r.stderr, /branch dev/)
    assert.equal(git(['symbolic-ref', '--short', 'HEAD'], { cwd: branchClone, env: fixture.env }), 'dev')
    assert.equal(JSON.parse(fs.readFileSync(path.join(branchClone, 'package.json'), 'utf8')).version, '0.1.0')
  })

  test('apply backs up the database, archives removed files and local edits, and switches to the tag', () => {
    addJob('job1.json')
    fs.writeFileSync(path.join(clone, 'docs', 'new-guide.md'), 'my own untracked notes at a path the release adds\n')
    const dbFile = path.join(home, 'app', 'data', 'workspace.sqlite')
    assert.equal(countApps(dbFile), 1)
    fs.writeFileSync(path.join(clone, 'notes.txt'), 'original line\nmy local edit\n')

    report = ok(['update', 'apply'])
    assert.equal(report.from, 'v0.1.0')
    assert.equal(report.to, 'v0.2.0')
    assert.equal(head(clone), 'v0.2.0')
    assert.equal(JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf8')).version, '0.2.0')

    assert.ok(report.databaseBackup, 'database backup path reported')
    assert.equal(path.dirname(report.databaseBackup), path.join(home, 'Archive'))
    assert.equal(countApps(report.databaseBackup), 1)
    assert.equal(countApps(dbFile), 1, 'live database untouched')

    assert.equal(report.removedFiles.length, 1)
    assert.match(path.basename(report.removedFiles[0]), /v0\.2\.0 removed docs - old-guide\.md$/)
    assert.match(fs.readFileSync(report.removedFiles[0], 'utf8'), /Old guide/)
    assert.ok(!fs.existsSync(path.join(clone, 'docs', 'old-guide.md')), 'the release no longer has the file (it was archived first)')

    // an untracked file where the release adds one is moved aside, not overwritten
    assert.equal(report.movedAside.length, 1)
    assert.equal(fs.readFileSync(report.movedAside[0], 'utf8'), 'my own untracked notes at a path the release adds\n')
    assert.equal(fs.readFileSync(path.join(clone, 'docs', 'new-guide.md'), 'utf8'), '# New guide from the release\n')

    // the local edit is kept in a stash, not lost
    const stash = git(['stash', 'list'], { cwd: clone, env: fixture.env })
    assert.match(stash, /Local edits saved before updating to v0\.2\.0/)
    assert.match(git(['stash', 'show', '-p', 'stash@{0}'], { cwd: clone, env: fixture.env }), /\+my local edit/)

    const log = fs.readFileSync(path.join(home, 'Archive', 'archive-log.csv'), 'utf8')
    assert.match(log, /database backup before updating to v0\.2\.0/)

    const after = ok(['update', 'check'])
    assert.equal(after.current, '0.2.0')
    assert.equal(after.available, false)
    const history = ok(['update', 'status']).history
    assert.equal(history.length, 1)
    assert.equal(history[0].toCommit, commit(clone, 'v0.2.0'))
    assert.equal(history[0].fromCommit, commit(clone, 'v0.1.0'))
    assert.equal(history[0].dbFile, dbFile)
    assert.ok(history[0].stash, 'stash id recorded')
  })

  test('apply also copies a locally edited tracked file into Archive', () => {
    assert.equal(report?.archivedEdits?.length, 1)
    assert.match(fs.readFileSync(report.archivedEdits[0], 'utf8'), /my local edit/)
  })

  test('rollback refuses unsafe situations without changing anything', () => {
    const before = commit(clone, 'HEAD')
    // 1. tracked edits since the update
    fs.writeFileSync(path.join(clone, 'notes.txt'), 'original line\nedited after update\n')
    let r = run(['update', 'rollback'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /edits to app files/)
    fs.writeFileSync(path.join(clone, 'notes.txt'), 'original line\n') // put the release content back
    // 2. HEAD is not the release the update installed
    git(['switch', '--quiet', '--detach', 'v0.1.0'], { cwd: clone, env: fixture.env })
    r = run(['update', 'rollback'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /not on the release installed by the last update/)
    git(['switch', '--quiet', '--detach', before], { cwd: clone, env: fixture.env })
    // 3. a different database than the one that was backed up
    r = runCli(['update', 'rollback'], { home, cli, env: { ...fixture.env, UAS_DB: path.join(home, 'other.sqlite') } })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /backed up/)
    // 4. the backup went missing
    const hidden = `${report.databaseBackup}.moved-by-test`
    fs.renameSync(report.databaseBackup, hidden)
    try {
      r = run(['update', 'rollback'])
      assert.equal(r.status, 1)
      assert.match(r.stderr, /backup .* is missing/)
    } finally { fs.renameSync(hidden, report.databaseBackup) }
    assert.equal(commit(clone, 'HEAD'), before)
    assert.ok(!ok(['update', 'status']).history.at(-1).rolledBack)
  })

  test('rollback returns to v0.1.0 and restores the database backup (archiving the newer one)', () => {
    addJob('job2.json', { sourceUrl: 'https://boards.greenhouse.io/mapleanalytics/jobs/2' })
    const dbFile = path.join(home, 'app', 'data', 'workspace.sqlite')
    assert.equal(countApps(dbFile), 2)

    const r = ok(['update', 'rollback'])
    assert.equal(r.to, 'v0.1.0')
    assert.equal(r.from, 'v0.2.0')
    assert.equal(r.restoredDatabase, report.databaseBackup)
    assert.equal(head(clone), 'v0.1.0')
    assert.equal(countApps(dbFile), 1, 'database restored from the backup')
    assert.ok(fs.existsSync(report.databaseBackup), 'backup itself is kept')
    const newer = fs.readdirSync(path.join(home, 'Archive')).find((f) => f.endsWith('v0.2.0 database before rollback.sqlite'))
    assert.ok(newer, 'the post-update database was archived, not replaced')
    assert.equal(countApps(path.join(home, 'Archive', newer)), 2)

    const check = ok(['update', 'check'])
    assert.equal(check.current, '0.1.0')
    assert.equal(check.shouldPrompt, false, 'the rolled-back release is snoozed')

    const again = run(['update', 'rollback'])
    assert.equal(again.status, 1)
    assert.match(again.stderr, /no update to roll back/)
  })

  test('a damaged update state file is reported, not silently reset', () => {
    const other = tempDir('update-corrupt')
    fs.mkdirSync(path.join(other, 'app', 'data'), { recursive: true })
    fs.writeFileSync(path.join(other, 'app', 'data', 'update-state.json'), '{ not json')
    const r = runCli(['update', 'status'], { home: other, cli, env: fixture.env })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /damaged/)
    assert.equal(fs.readFileSync(path.join(other, 'app', 'data', 'update-state.json'), 'utf8'), '{ not json', 'left as is for the person to archive')
  })

  test('apply refuses a version that is not newer', () => {
    const r = run(['update', 'apply', '--version', '0.1.0'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /not newer/)
  })
})
