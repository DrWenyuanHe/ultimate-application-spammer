// Release-based updates. Users only ever receive tagged releases (vMAJOR.MINOR.PATCH).
// Order of an update: verify the target → stop the dashboard → back up and verify the database →
// archive and stash tracked edits → archive files the release adds over or removes → switch.
// Nothing a person made is overwritten or silently dropped.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { archiveCopy, archiveMove, archiveTarget, recordArchived } from './archive.mjs'
import { CODE_ROOT, dataDir, dbPath, rootDir } from './paths.mjs'

const DAY = 24 * 60 * 60 * 1000

/** Run git. `out` keeps stdout exactly as printed (only a trailing newline is removed). */
export function git(args, { cwd = CODE_ROOT, timeout = 60000 } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (r.error) return { ok: false, out: '', err: r.error.code === 'ETIMEDOUT' ? 'timed out' : r.error.message }
  return { ok: r.status === 0, out: (r.stdout || '').replace(/\r?\n$/, ''), err: (r.stderr || '').trim() }
}

function must(args, opts, what) {
  const r = git(args, opts)
  if (!r.ok) throw new Error(`${what}: ${r.err || 'git failed'}`)
  return r.out
}

export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim())
  return m ? m.slice(1).map(Number) : null
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

export function currentVersion(repo = CODE_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version
}

const stateFile = () => path.join(dataDir(), 'update-state.json')

export function readState() {
  const file = stateFile()
  if (!fs.existsSync(file)) return { history: [] }
  try { return { history: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) } } catch {
    throw new Error(`The update record ${file} is damaged. Move it to Archive/ (node app/cli.mjs archive "${file}") and run the update check again.`)
  }
}

function writeState(state) {
  fs.mkdirSync(dataDir(), { recursive: true })
  const tmp = `${stateFile()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, stateFile())
}

const samePath = (a, b) => {
  const norm = (p) => { try { return fs.realpathSync.native(p) } catch { return path.resolve(p) } }
  const [x, y] = [norm(a), norm(b)]
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

/** How this copy is installed: release (detached tag), branch (contributor), not-git, or incomplete. */
export function installMode(repo = CODE_ROOT) {
  const top = git(['rev-parse', '--show-toplevel'], { cwd: repo })
  if (!top.ok || !samePath(top.out, repo)) return { mode: 'not-git' }
  if (!git(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: repo }).ok) return { mode: 'incomplete' }
  const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: repo })
  const tag = git(['describe', '--tags', '--exact-match', 'HEAD'], { cwd: repo })
  if (branch.ok && branch.out) return { mode: 'branch', branch: branch.out, tag: tag.ok ? tag.out : null }
  return { mode: 'release', tag: tag.ok ? tag.out : null }
}

function releaseNotes(tag, repo) {
  const r = git(['show', `${tag}:CHANGELOG.md`], { cwd: repo })
  if (!r.ok) return ''
  const version = tag.replace(/^v/, '')
  const lines = r.out.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes(version))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
}

/**
 * Check the public repository for a newer release using `git ls-remote` (no account, token or
 * personal data). Cached for a day unless `force`.
 */
export function checkForUpdate({ force = false, repo = CODE_ROOT, timeout = 8000 } = {}) {
  const state = readState()
  const current = currentVersion(repo)
  const fresh = state.lastCheckedAt && Date.now() - Date.parse(state.lastCheckedAt) < DAY && state.checkedVersion === current
  if (fresh && !force) return summarize(state, current)
  const mode = installMode(repo)
  if (mode.mode === 'not-git' || mode.mode === 'incomplete') return { current, available: false, shouldPrompt: false, error: 'This copy is not linked to the public repository yet, so updates cannot be checked. Run `node app/cli.mjs setup --convert-zip`.' }
  const remote = git(['ls-remote', '--tags', '--refs', 'origin'], { cwd: repo, timeout })
  if (!remote.ok) return { ...summarize(state, current), error: `Could not reach the update server (${remote.err.split('\n')[0] || 'offline'})` }
  const tags = remote.out.split('\n').map((l) => l.split('refs/tags/')[1]).filter((t) => parseVersion(t))
  const latest = tags.sort(compareVersions).at(-1) || null
  let notes = ''
  if (latest && compareVersions(latest, current) > 0) {
    git(['fetch', '--quiet', '--no-tags', 'origin', `refs/tags/${latest}:refs/tags/${latest}`], { cwd: repo, timeout: 60000 })
    notes = releaseNotes(latest, repo)
  }
  const next = { ...readState(), lastCheckedAt: new Date().toISOString(), checkedVersion: current, latest, notes }
  writeState(next)
  return summarize(next, current)
}

function summarize(state, current) {
  const available = Boolean(state.latest && compareVersions(state.latest, current) > 0)
  const snoozed = Boolean(available && state.snoozed?.version === state.latest && Date.parse(state.snoozed.until) > Date.now())
  return { current, latest: state.latest || null, available, snoozed, shouldPrompt: available && !snoozed, notes: state.notes || '', lastCheckedAt: state.lastCheckedAt }
}

/** Last known update status without touching the network or writing files (for the dashboard). */
export function cachedUpdateStatus(repo = CODE_ROOT) {
  try { return summarize(readState(), currentVersion(repo)) } catch (error) { return { available: false, shouldPrompt: false, error: error.message } }
}

export function snooze({ version, days = 7 } = {}) {
  const state = readState()
  const target = version || state.latest
  if (!target) return { snoozed: false }
  state.snoozed = { version: target, until: new Date(Date.now() + days * DAY).toISOString() }
  writeState(state)
  return { snoozed: true, version: target, until: state.snoozed.until }
}

// ---------- helpers for apply / rollback ----------

/** Paths from a NUL-separated porcelain v1 status (handles renames, spaces and non-ASCII). */
function trackedChanges(repo) {
  const r = git(['status', '--porcelain=v1', '-z', '--untracked-files=no'], { cwd: repo })
  if (!r.ok) throw new Error(`Could not read local changes: ${r.err}`)
  const parts = r.out.split('\0').filter(Boolean)
  const files = []
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2)
    files.push(parts[i].slice(3))
    if (code.includes('R') || code.includes('C')) i++ // next entry is the rename source
  }
  return [...new Set(files)]
}

function diffNames(from, to, filter, repo) {
  const r = git(['diff', '--name-only', '-z', `--diff-filter=${filter}`, from, to], { cwd: repo })
  if (!r.ok) throw new Error(`Could not compare releases: ${r.err}`)
  return r.out.split('\0').filter(Boolean)
}

function commitOf(ref, repo) {
  const r = git(['rev-parse', '-q', '--verify', `${ref}^{commit}`], { cwd: repo })
  return r.ok ? r.out.trim() : null
}

/** Before switching from `from` to `to`: keep copies of files that will disappear, and move aside
 *  untracked/ignored files sitting where the target release puts a tracked file. */
function protectPaths(from, to, label, repo) {
  const report = { removed: [], movedAside: [] }
  for (const file of diffNames(from, to, 'D', repo)) {
    const abs = path.join(repo, file)
    if (fs.existsSync(abs)) report.removed.push(archiveCopy(abs, { label: `${label} removed ${file.replaceAll('/', ' - ')}`, reason: `file not part of ${label}` }))
  }
  for (const file of diffNames(from, to, 'A', repo)) {
    const abs = path.join(repo, file)
    if (fs.existsSync(abs)) report.movedAside.push(archiveMove(abs, { label: `${label} moved aside ${file.replaceAll('/', ' - ')}`, reason: `${label} adds a file at this path` }))
  }
  return report
}

function snapshotDatabase(file, label, reason) {
  const target = archiveTarget(label)
  const db = new DatabaseSync(file)
  try { db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`) } finally { db.close() }
  const check = new DatabaseSync(target, { readOnly: true })
  try {
    const ok = check.prepare('PRAGMA quick_check').get()
    if (Object.values(ok)[0] !== 'ok') throw new Error(`Backup ${target} failed its integrity check`)
  } finally { check.close() }
  recordArchived(target, { reason, original: path.relative(rootDir(), file) })
  return target
}

async function dashboardsFor(root) {
  const ports = new Set([Number(process.env.PORT) || 4321, 4321, 4322])
  for (const name of ['dashboard.json', 'dashboard-demo.json']) {
    try { ports.add(Number(JSON.parse(fs.readFileSync(path.join(dataDir(), name), 'utf8')).port)) } catch {}
  }
  const found = []
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) })
      const h = res.ok ? await res.json() : null
      if (h?.app === 'ultimate-application-spammer' && samePath(h.root, root)) found.push({ port, demo: h.demo })
    } catch {}
  }
  return found
}

async function stopDashboards(root) {
  const running = await dashboardsFor(root)
  for (const d of running) {
    try {
      await fetch(`http://127.0.0.1:${d.port}/api/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${d.port}` }, body: '{}', signal: AbortSignal.timeout(2000) })
    } catch {}
  }
  for (let i = 0; i < 20 && (await dashboardsFor(root)).length; i++) await new Promise((r) => setTimeout(r, 250))
  if ((await dashboardsFor(root)).length) throw new Error('The dashboard is still running. Close it, then try again.')
  return running
}

/** Install a release. Returns a report of everything that was archived or changed. */
export async function applyUpdate({ version, repo = CODE_ROOT, allowBranch = false } = {}) {
  const state = readState()
  const target = version ? (version.startsWith('v') ? version : `v${version}`) : state.latest
  if (!target || !parseVersion(target)) throw new Error('No newer release is known. Run `update check` first.')
  const from = currentVersion(repo)
  if (compareVersions(target, from) <= 0) throw new Error(`Already on ${from}; ${target} is not newer.`)
  const mode = installMode(repo)
  if (mode.mode === 'not-git' || mode.mode === 'incomplete') throw new Error('This copy is not linked to the public repository. Run `node app/cli.mjs setup --convert-zip` first.')
  if (mode.mode === 'branch' && !allowBranch) throw new Error(`This is a contributor checkout on branch ${mode.branch}. Use git directly, or pass --allow-branch.`)
  if (!commitOf(`refs/tags/${target}`, repo)) {
    const fetched = git(['fetch', '--quiet', '--no-tags', 'origin', `refs/tags/${target}:refs/tags/${target}`], { cwd: repo, timeout: 120000 })
    if (!fetched.ok) throw new Error(`Could not download ${target}: ${fetched.err}`)
  }
  const toCommit = commitOf(`refs/tags/${target}`, repo)
  const fromCommit = commitOf('HEAD', repo)
  if (!toCommit || !fromCommit) throw new Error(`Release ${target} could not be resolved`)

  const report = { from: `v${from}`, to: target, archivedEdits: [], removedFiles: [], movedAside: [], databaseBackup: null, stoppedDashboards: [] }
  report.stoppedDashboards = await stopDashboards(rootDir())

  const dbFile = dbPath()
  if (fs.existsSync(dbFile)) report.databaseBackup = snapshotDatabase(dbFile, `before ${target} database.sqlite`, `database backup before updating to ${target}`)

  const dirty = trackedChanges(repo)
  for (const file of dirty) {
    const abs = path.join(repo, file)
    if (fs.existsSync(abs)) report.archivedEdits.push(archiveCopy(abs, { label: `before ${target} ${file.replaceAll('/', ' - ')}`, reason: `local edit kept before updating to ${target}` }))
  }
  let stash = null
  if (dirty.length) {
    must(['stash', 'push', '--quiet', '-m', `Local edits saved before updating to ${target}`], { cwd: repo }, 'Could not set aside local edits')
    stash = commitOf('stash@{0}', repo)
  }

  try {
    const protectedPaths = protectPaths(fromCommit, toCommit, target, repo)
    report.removedFiles = protectedPaths.removed
    report.movedAside = protectedPaths.movedAside
    must(['-c', 'advice.detachedHead=false', 'switch', '--detach', '--no-overwrite-ignore', toCommit], { cwd: repo }, `Update to ${target} failed`)
  } catch (error) {
    if (stash) git(['stash', 'apply', '--quiet', stash], { cwd: repo })
    throw new Error(`${error.message}. Nothing was switched; your edits were restored and copies are in Archive/.`)
  }

  const next = readState()
  next.history = [...(next.history || []), { from: report.from, fromCommit, to: target, toCommit, at: new Date().toISOString(), dbFile: fs.existsSync(dbFile) ? dbFile : null, databaseBackup: report.databaseBackup, stash }]
  delete next.snoozed
  next.checkedVersion = target.replace(/^v/, '')
  writeState(next)
  report.restartDashboard = report.stoppedDashboards.length > 0
  return report
}

/** Go back to the release that was installed before the last update, restoring its database backup. */
export async function rollback({ repo = CODE_ROOT } = {}) {
  const state = readState()
  const last = state.history?.at(-1)
  if (!last || last.rolledBack) throw new Error('There is no update to roll back.')
  const head = commitOf('HEAD', repo)
  if (head !== last.toCommit) throw new Error(`This copy is not on the release installed by the last update (${last.to}), so rollback would be unsafe.`)
  if (last.databaseBackup && !fs.existsSync(last.databaseBackup)) throw new Error(`The database backup ${last.databaseBackup} is missing. Rollback stopped before changing anything.`)
  if (last.dbFile && !samePath(last.dbFile, dbPath())) throw new Error(`The last update backed up ${last.dbFile}, but this workspace uses ${dbPath()}. Rollback stopped.`)
  if (trackedChanges(repo).length) throw new Error('There are edits to app files since the update. Archive them first (node app/cli.mjs archive PATH), then retry.')
  const stopped = await stopDashboards(rootDir())

  let restored = null, currentSnapshot = null
  const file = dbPath()
  if (last.databaseBackup) {
    if (fs.existsSync(file)) currentSnapshot = snapshotDatabase(file, `${last.to} database before rollback.sqlite`, `rollback from ${last.to}`)
    for (const extra of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(extra)) archiveMove(extra, { label: `${last.to} raw ${path.basename(extra)}`, reason: `rollback from ${last.to}` })
    fs.copyFileSync(last.databaseBackup, file, fs.constants.COPYFILE_EXCL)
    restored = last.databaseBackup
  }
  const protectedPaths = protectPaths(last.toCommit, last.fromCommit, `rollback to ${last.from}`, repo)
  must(['-c', 'advice.detachedHead=false', 'switch', '--detach', '--no-overwrite-ignore', last.fromCommit], { cwd: repo },
    `Could not switch the app back to ${last.from} (the database was already restored; the newer database is saved at ${currentSnapshot || 'n/a'})`)
  const next = readState()
  next.history.at(-1).rolledBack = new Date().toISOString()
  next.checkedVersion = last.from.replace(/^v/, '')
  next.snoozed = { version: last.to, until: new Date(Date.now() + 7 * DAY).toISOString() }
  writeState(next)
  return { to: last.from, from: last.to, restoredDatabase: restored, currentDatabaseSnapshot: currentSnapshot, ...protectedPaths, stoppedDashboards: stopped, restartDashboard: stopped.length > 0 }
}

/**
 * Link a ZIP download to the public repository at its matching release, without touching files on
 * disk. Safe to re-run if a previous attempt stopped half-way (e.g. offline).
 */
export function convertToGit({ repo = CODE_ROOT, remote }) {
  const mode = installMode(repo)
  if (mode.mode === 'release' || mode.mode === 'branch') return { converted: false, reason: 'already linked to the repository' }
  if (!remote) throw new Error('package.json has no repository URL')
  const version = `v${currentVersion(repo)}`
  // A folder inside some other repository still gets its own repository here (installMode compares the top level).
  if (mode.mode === 'not-git') must(['init', '--quiet'], { cwd: repo }, 'git init failed')
  if (!git(['remote', 'get-url', 'origin'], { cwd: repo }).ok) must(['remote', 'add', 'origin', remote], { cwd: repo }, 'Could not add the repository address')
  must(['fetch', '--quiet', '--tags', 'origin'], { cwd: repo, timeout: 180000 }, 'Could not download release information (are you online?)')
  if (!commitOf(`refs/tags/${version}`, repo)) throw new Error(`Release ${version} was not found on the server`)
  must(['reset', '--quiet', '--mixed', version], { cwd: repo }, `Could not link this folder to ${version}`)
  const differences = trackedChanges(repo)
  if (differences.length) return { converted: true, version, pinned: false, differences, note: 'Some app files differ from the release; they were left as they are.' }
  must(['-c', 'advice.detachedHead=false', 'switch', '--detach', '--quiet', version], { cwd: repo }, 'Could not switch to the release')
  return { converted: true, version, pinned: commitOf('HEAD', repo) === commitOf(version, repo) }
}

/** For fresh clones that are still on a branch: move to the matching release tag. */
export function pinLatestRelease({ repo = CODE_ROOT } = {}) {
  const mode = installMode(repo)
  if (mode.mode !== 'branch') return { pinned: false, mode: mode.mode }
  const current = `v${currentVersion(repo)}`
  if (trackedChanges(repo).length) return { pinned: false, reason: 'local edits on the branch' }
  const tagCommit = commitOf(`refs/tags/${current}`, repo)
  if (!tagCommit) return { pinned: false, reason: `no ${current} release tag (contributor or pre-release checkout)` }
  if (commitOf('HEAD', repo) !== tagCommit) return { pinned: false, reason: 'branch has commits beyond the release' }
  const r = git(['-c', 'advice.detachedHead=false', 'switch', '--detach', '--quiet', current], { cwd: repo })
  return { pinned: r.ok, version: current, error: r.ok ? undefined : r.err }
}
