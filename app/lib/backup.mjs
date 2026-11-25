// Database snapshots so progress is hard to lose. Snapshots are consistent single-file copies
// (VACUUM INTO). Retention moves older snapshots to Archive/Clearable — nothing is deleted.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { archiveMove, stamp } from './archive.mjs'
import { dataDir, dbPath, rootDir } from './paths.mjs'

const DAY = 24 * 60 * 60 * 1000
export const KEEP_DAILY = 14
export const KEEP_MONTHLY = 12

export const backupDir = () => path.join(dataDir(), 'backups')
const settingsFile = () => path.join(dataDir(), 'backup-settings.json')

export function backupSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } catch { return {} }
}

/** Optional second folder (e.g. a synced drive) that receives a copy of every snapshot. */
export function setMirror(folderPath) {
  const settings = backupSettings()
  if (folderPath) {
    const abs = path.resolve(folderPath)
    fs.mkdirSync(abs, { recursive: true })
    settings.mirror = abs
  } else {
    delete settings.mirror
  }
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2))
  return settings
}

export function listBackups() {
  if (!fs.existsSync(backupDir())) return []
  return fs.readdirSync(backupDir()).filter((f) => f.endsWith('.sqlite')).map((name) => {
    const file = path.join(backupDir(), name)
    const st = fs.statSync(file)
    return { name, file, bytes: st.size, createdAt: st.mtime.toISOString() }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function verify(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const ok = Object.values(db.prepare('PRAGMA quick_check').get())[0] === 'ok'
    const revision = Number(db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM events').get().n)
    return { ok, revision }
  } finally { db.close() }
}

/** Take a snapshot now. Returns its details, or null when there is no database yet. */
export function snapshot({ reason = 'manual', file = dbPath(), retention = true } = {}) {
  if (!fs.existsSync(file)) return null
  fs.mkdirSync(backupDir(), { recursive: true })
  let target = path.join(backupDir(), `${stamp().replace(' ', ' at ')} ${reason}.sqlite`)
  for (let i = 2; fs.existsSync(target); i++) target = path.join(backupDir(), `${stamp().replace(' ', ' at ')} ${reason} (${i}).sqlite`)
  const db = new DatabaseSync(file)
  try { db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`) } finally { db.close() }
  const check = verify(target)
  if (!check.ok) throw new Error(`Snapshot ${target} failed its integrity check`)
  const result = { file: target, revision: check.revision, bytes: fs.statSync(target).size }
  const { mirror } = backupSettings()
  if (mirror) {
    try {
      fs.mkdirSync(mirror, { recursive: true })
      const copy = path.join(mirror, path.basename(target))
      if (!fs.existsSync(copy)) fs.copyFileSync(target, copy, fs.constants.COPYFILE_EXCL)
      result.mirror = copy
    } catch (error) {
      result.mirrorError = error.message
    }
  }
  if (retention) result.movedToClearable = applyRetention()
  return result
}

/** Snapshot if the newest one is older than a day (called when the dashboard starts). */
export function snapshotIfDue({ reason = 'daily' } = {}) {
  const newest = listBackups()[0]
  if (newest && Date.now() - Date.parse(newest.createdAt) < DAY) return null
  return snapshot({ reason })
}

/** Keep the newest snapshot of each of the last 14 days and 12 months; move the rest to Archive/Clearable. */
export function retentionPlan() {
  const all = listBackups()
  const keep = new Set()
  const days = new Map(), months = new Map()
  for (const b of all) {
    const d = b.createdAt.slice(0, 10), m = b.createdAt.slice(0, 7)
    if (!days.has(d)) days.set(d, b)
    if (!months.has(m)) months.set(m, b)
  }
  ;[...days.values()].slice(0, KEEP_DAILY).forEach((b) => keep.add(b.file))
  ;[...months.values()].slice(0, KEEP_MONTHLY).forEach((b) => keep.add(b.file))
  all.slice(0, 3).forEach((b) => keep.add(b.file)) // always keep the three newest
  return all.filter((b) => !keep.has(b.file))
}

export function applyRetention({ only } = {}) {
  return retentionPlan()
    .filter((b) => !only || only.includes(b.file))
    .map((b) => archiveMove(b.file, { clearable: 'Old backups', reason: 'older than the backup retention window' }))
}

/**
 * Restore a snapshot. The current database is snapshotted first and its files moved to Archive/,
 * so a restore can itself be undone. The dashboard must be closed.
 */
export function restore(backupFile, { file = dbPath() } = {}) {
  const source = path.resolve(backupFile)
  if (!fs.existsSync(source)) throw new Error(`No backup at ${source}`)
  const check = verify(source)
  if (!check.ok) throw new Error('That backup failed its integrity check; choose another one.')
  const before = fs.existsSync(file) ? snapshot({ reason: 'before restore', file, retention: false }) : null
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) archiveMove(f, { label: `replaced by restore ${path.basename(f)}`, reason: `restored ${path.basename(source)}` })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(source, file, fs.constants.COPYFILE_EXCL)
  return { restored: source, revision: check.revision, previous: before?.file || null, root: rootDir() }
}
