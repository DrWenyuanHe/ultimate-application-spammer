import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isolate, job, tempDir } from './helpers.mjs'

isolate('backup')
const backup = await import('../lib/backup.mjs')
const { openStore } = await import('../lib/store.mjs')

/** Run `fn` with UAS_HOME pointed at a fresh workspace. */
function inHome(name, fn) {
  const home = tempDir(name)
  const previous = process.env.UAS_HOME
  process.env.UAS_HOME = home
  try { return fn(home) } finally { process.env.UAS_HOME = previous }
}

function seed(count, { offset = 0 } = {}) {
  const s = openStore({ allowNew: true })
  for (let i = 0; i < count; i++) s.addApplication(job({ sourceUrl: `https://example.com/jobs/${offset + i}` }))
  const revision = s.revision()
  s.close()
  return revision
}

const appCount = (file) => {
  const db = new DatabaseSync(file, { readOnly: true })
  try { return Number(db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind = 'application'").get().n) } finally { db.close() }
}
const setTime = (file, date) => fs.utimesSync(file, date, date)
const live = (home) => path.join(home, 'app', 'data', 'workspace.sqlite')

test('snapshot: nothing to do without a database; otherwise a verified copy with the revision', () => inHome('backup-snap', (home) => {
  assert.equal(backup.snapshot(), null)
  const revision = seed(2)
  const snap = backup.snapshot({ reason: 'manual' })
  assert.equal(path.dirname(snap.file), path.join(home, 'app', 'data', 'backups'))
  assert.match(path.basename(snap.file), /^\d{4}-\d{2}-\d{2} at \d{4} manual\.sqlite$/)
  assert.equal(snap.revision, revision)
  assert.equal(appCount(snap.file), 2)
  const second = backup.snapshot({ reason: 'manual' })
  assert.notEqual(second.file, snap.file, 'a second snapshot in the same minute gets its own file')
  assert.equal(backup.listBackups().length, 2)
}))

test('snapshot copies to a mirror folder, and a broken mirror does not fail the backup', () => inHome('backup-mirror', (home) => {
  seed(1)
  const mirror = path.join(home, 'Synced drive', 'UAS backups')
  assert.equal(backup.setMirror(mirror).mirror, mirror)
  const snap = backup.snapshot()
  assert.equal(snap.mirror, path.join(mirror, path.basename(snap.file)))
  assert.deepEqual(fs.readFileSync(snap.mirror), fs.readFileSync(snap.file))

  const notAFolder = path.join(home, 'mirror-is-a-file')
  fs.writeFileSync(notAFolder, 'x')
  fs.writeFileSync(path.join(home, 'app', 'data', 'backup-settings.json'), JSON.stringify({ mirror: notAFolder }))
  const again = backup.snapshot()
  assert.ok(again.mirrorError, 'mirror problem is reported')
  assert.ok(fs.existsSync(again.file), 'the local snapshot still exists')
  assert.equal(backup.setMirror(null).mirror, undefined)
}))

test('snapshotIfDue only snapshots when the newest backup is over a day old', () => inHome('backup-due', () => {
  seed(1)
  const first = backup.snapshotIfDue()
  assert.ok(first, 'no backups yet → snapshot')
  assert.equal(backup.snapshotIfDue(), null, 'fresh backup → nothing to do')
  setTime(first.file, new Date(Date.now() - 2 * 86400000))
  const due = backup.snapshotIfDue()
  assert.ok(due)
  assert.match(path.basename(due.file), /daily( \(\d+\))?\.sqlite$/)
}))

test('retention keeps 14 daily, 12 monthly and the 3 newest; the rest move to Archive/Clearable/Old backups', () => inHome('backup-retention', (home) => {
  seed(1)
  const template = backup.snapshot({ reason: 'template' }).file
  const dir = backup.backupDir()
  const make = (iso) => {
    const file = path.join(dir, `fixture ${iso.replace(/:/g, '')}.sqlite`)
    fs.copyFileSync(template, file, fs.constants.COPYFILE_EXCL)
    setTime(file, new Date(iso))
    return path.basename(file)
  }
  setTime(template, new Date('2020-01-01T00:00:00Z')) // the template becomes an old extra
  const D = Date.UTC(2026, 9, 15, 12) // 2026-10-15 12:00 UTC
  const hour = 3600000, day = 86400000
  const sameDay = [0, 1, 2, 3].map((h) => make(new Date(D - h * hour).toISOString()))
  const daily = Array.from({ length: 15 }, (_, i) => make(new Date(D - (i + 1) * day).toISOString())) // Oct 14 … Sep 30
  const monthly = Array.from({ length: 15 }, (_, i) => make(new Date(Date.UTC(2026, 7 - i, 10, 12)).toISOString())) // Aug 2026 … Jun 2025

  const moved = backup.applyRetention().map((p) => path.basename(p))
  const expectedMoved = [
    sameDay[3], // 4th backup of the newest day
    daily[13], // Oct 1: 15th distinct day, and October's newest is Oct 15
    ...monthly.slice(10), // Oct 2025 … Jun 2025: beyond 12 months
    path.basename(template), // 2020
  ]
  assert.equal(moved.length, expectedMoved.length, moved.join('\n'))
  for (const name of expectedMoved) assert.ok(moved.some((m) => m.endsWith(name)), `${name} should move`)
  const kept = new Set(fs.readdirSync(dir))
  for (const name of [...sameDay.slice(0, 3), ...daily.slice(0, 13), daily[14], ...monthly.slice(0, 10)]) assert.ok(kept.has(name), `${name} should stay`)
  const clearable = path.join(home, 'Archive', 'Clearable', 'Old backups')
  assert.equal(fs.readdirSync(clearable).length, expectedMoved.length, 'moved, not deleted')
  assert.deepEqual(backup.applyRetention(), [], 'retention is stable')
}))

test('restore snapshots the current database first, archives db/wal/shm and installs the backup', () => inHome('backup-restore', (home) => {
  seed(1)
  const old = backup.snapshot({ reason: 'manual' })
  seed(2, { offset: 10 })
  assert.equal(appCount(live(home)), 3)

  const result = backup.restore(old.file)
  assert.equal(result.restored, old.file)
  assert.equal(appCount(live(home)), 1, 'restored contents')
  assert.ok(result.previous, 'current database was snapshotted first')
  assert.equal(appCount(result.previous), 3)
  const archived = fs.readdirSync(path.join(home, 'Archive'))
  assert.ok(archived.some((f) => f.endsWith('replaced by restore workspace.sqlite')))
  const s = openStore()
  assert.equal(s.applications().length, 1, 'restored database opens normally')
  s.close()
}))

test('restore refuses a corrupt or missing backup and leaves the live database alone', () => inHome('backup-corrupt', (home) => {
  seed(2)
  const bad = path.join(home, 'not-a-database.sqlite')
  fs.writeFileSync(bad, 'this is not sqlite '.repeat(200))
  assert.throws(() => backup.restore(bad))
  assert.throws(() => backup.restore(path.join(home, 'missing.sqlite')), /No backup/)
  assert.equal(appCount(live(home)), 2)
  assert.ok(!fs.existsSync(path.join(home, 'Archive')) || !fs.readdirSync(path.join(home, 'Archive')).some((f) => f.includes('replaced by restore')))
}))

test('restoring an older backup from a busy day still works', () => inHome('backup-restore-busy', (home) => {
  seed(1)
  const oldest = backup.snapshot({ reason: 'manual' })
  seed(1, { offset: 20 })
  const middle = backup.snapshot({ reason: 'manual' })
  const newest = backup.snapshot({ reason: 'manual' })
  const now = Date.now()
  setTime(oldest.file, new Date(now - 3 * 60000))
  setTime(middle.file, new Date(now - 2 * 60000))
  setTime(newest.file, new Date(now - 60000))
  // the "before restore" snapshot pushes `oldest` out of the three-newest window
  const result = backup.restore(oldest.file)
  assert.equal(appCount(live(home)), 1)
  assert.equal(result.restored, oldest.file)
}))
