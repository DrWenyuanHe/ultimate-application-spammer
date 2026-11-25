// Archive-only file handling. Nothing in this project deletes files: anything that would be
// removed or replaced is moved (or copied) into the flat `Archive/` folder and logged.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { dataDir, folder, rootDir } from './paths.mjs'

export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}${p(date.getMinutes())}`
}

export function safeName(text) {
  return String(text).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'item'
}

/** Returns a path inside `dir` named `name` that does not exist yet (adds " (2)", " (3)" ...). */
export function uniquePath(dir, name) {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let candidate = path.join(dir, name)
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`)
  return candidate
}

function log(row) {
  const dir = folder('archive')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'archive-log.csv')
  const cell = (v) => `"${csvSafe(v).replaceAll('"', '""')}"`
  if (!fs.existsSync(file)) fs.writeFileSync(file, 'archived_at,action,original_path,archived_as,reason\n')
  fs.appendFileSync(file, [new Date().toISOString(), row.action, row.original, row.archived, row.reason].map(cell).join(',') + '\n')
}

/** Text for a CSV cell that spreadsheet apps will not run as a formula. */
export function csvSafe(value) {
  const s = String(value ?? '')
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

function relative(p) {
  const rel = path.relative(rootDir(), p)
  return rel.startsWith('..') ? p : rel
}

/**
 * Move a file or folder into Archive/ as "YYYY-MM-DD HHMM <label or original name>".
 * Never overwrites; returns the new path.
 */
export function archiveMove(source, { reason = '', label, clearable } = {}) {
  const src = path.resolve(source)
  if (!fs.existsSync(src)) throw new Error(`Nothing to archive at ${src}`)
  const base = folder('archive')
  if (src === base || src.startsWith(base + path.sep)) throw new Error('Items already in Archive stay where they are')
  // Items that can be regenerated or are not needed go to Archive/Clearable/<category>, which the person may empty by hand.
  const dir = clearable ? path.join(base, 'Clearable', safeName(clearable)) : base
  fs.mkdirSync(dir, { recursive: true })
  const name = `${stamp()} ${safeName(label || path.basename(src))}`
  let target
  if (fs.statSync(src).isDirectory()) {
    // Renaming a folder onto an existing non-empty folder fails on every platform, so a clash cannot destroy anything.
    target = uniquePath(dir, name)
    fs.renameSync(src, target)
  } else {
    // Reserve the destination with an exclusive create, then move the file onto our own empty placeholder.
    for (let i = 0; ; i++) {
      target = uniquePath(dir, name)
      try { fs.closeSync(fs.openSync(target, 'wx')); break } catch (error) { if (error.code !== 'EEXIST' || i > 20) throw error }
    }
    fs.renameSync(src, target)
  }
  log({ action: clearable ? 'moved (clearable)' : 'moved', original: relative(src), archived: relative(target), reason })
  return target
}

/** A new, unused path in Archive/ for something the caller writes (e.g. a database backup). Call
 *  `recordArchived` once the file has been written and checked. */
export function archiveTarget(label) {
  const dir = folder('archive')
  fs.mkdirSync(dir, { recursive: true })
  return uniquePath(dir, `${stamp()} ${safeName(label)}`)
}

export function recordArchived(target, { reason = '', original = '' } = {}) {
  log({ action: 'saved', original, archived: relative(target), reason })
}

/** Copy a file into Archive/ (used for backups before updates); the original stays in place. */
export function archiveCopy(source, { reason = '', label } = {}) {
  const src = path.resolve(source)
  const dir = folder('archive')
  fs.mkdirSync(dir, { recursive: true })
  const target = uniquePath(dir, `${stamp()} ${safeName(label || path.basename(src))}`)
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, target, { recursive: true, errorOnExist: true, force: false })
  else fs.copyFileSync(src, target, fs.constants.COPYFILE_EXCL)
  log({ action: 'copied', original: relative(src), archived: relative(target), reason })
  return target
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

function registryFile() {
  return path.join(dataDir(), 'generated-files.json')
}

function readRegistry() {
  try { return JSON.parse(fs.readFileSync(registryFile(), 'utf8')) } catch { return {} }
}

/**
 * Write a file the app generates (exports, starter templates). The app refreshes its own
 * untouched output in place. If a person edited the file since the app wrote it, the edited copy
 * is archived first so nothing they changed is lost.
 */
export function writeGenerated(file, content, { reason = 'edited copy kept before the app refreshed this file' } = {}) {
  const target = path.resolve(file)
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const registry = readRegistry()
  const key = relative(target)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) {
    const currentHash = sha(fs.readFileSync(target))
    if (currentHash === sha(next)) return { path: target, changed: false }
    if (registry[key] !== currentHash) archiveMove(target, { reason })
  }
  fs.writeFileSync(target, next)
  registry[key] = sha(next)
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(registryFile(), JSON.stringify(registry, null, 2))
  return { path: target, changed: true }
}
