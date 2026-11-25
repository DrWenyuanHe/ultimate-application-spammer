// Storage report and tidy-up. Tidy never deletes: it moves regenerable or non-essential items
// into Archive/Clearable/<category>. The person empties that folder by hand when they want space.
// Never touched: the database, backups inside the retention window, stored material files,
// submitted applications, the career library and templates.
import fs from 'node:fs'
import path from 'node:path'
import { archiveMove } from './archive.mjs'
import { dataDir, folder } from './paths.mjs'
import { backupDir, retentionPlan } from './backup.mjs'
import { safeName } from './archive.mjs'

const DAY = 24 * 60 * 60 * 1000

function size(p) {
  if (!fs.existsSync(p)) return { bytes: 0, files: 0 }
  const st = fs.statSync(p)
  if (!st.isDirectory()) return { bytes: st.size, files: 1 }
  let bytes = 0, files = 0
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const s = size(path.join(p, entry.name))
    bytes += s.bytes
    files += s.files
  }
  return { bytes, files }
}

const human = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`

export function storageReport() {
  const d = dataDir()
  const rows = [
    ['Database', path.join(d, 'workspace.sqlite'), 'essential'],
    ['Database backups', backupDir(), 'essential (older ones are tidied by retention)'],
    ['Saved document versions', path.join(d, 'files'), 'essential (deduplicated by content)'],
    ['Submitted applications', folder('applications'), 'essential — exactly what was filed'],
    ['Career library sources', folder('library'), 'essential — your original documents'],
    ['Templates', folder('templates'), 'essential'],
    ['PDF render work files', path.join(d, 'render'), 'clearable'],
    ['Previews', path.join(d, 'preview'), 'clearable'],
    ['Dashboard logs', path.join(d, 'logs'), 'clearable after 14 days'],
    ['Raw job-board results', path.join(d, 'discovery'), 'clearable after 30 days'],
    ['Research claim files', path.join(d, 'claims'), 'clearable after 30 days'],
    ['Code review notes', path.join(d, 'reviews'), 'clearable'],
    ['Archive (kept)', folder('archive'), 'your decision'],
    ['Archive/Clearable (safe to empty by hand)', path.join(folder('archive'), 'Clearable'), 'safe to delete yourself'],
  ]
  const items = rows.map(([label, p, status]) => ({ label, path: p, status, ...size(p) }))
  for (const i of items) i.size = human(i.bytes)
  const archive = items.find((i) => i.label === 'Archive (kept)')
  const clearable = items.find((i) => i.label.startsWith('Archive/Clearable'))
  archive.bytes -= clearable.bytes
  archive.files -= clearable.files
  archive.size = human(archive.bytes)
  return { items, total: human(items.reduce((n, i) => n + (i.label.startsWith('Archive/Clearable') ? 0 : i.bytes), 0) + clearable.bytes) }
}

function olderThan(p, days) {
  return Date.now() - fs.statSync(p).mtimeMs > days * DAY
}

/**
 * List (dryRun) or move clearable items. `store` is used to find drafts whose job already has a
 * recorded submission more than 30 days ago (the submitted copy is kept in "1 Applications").
 */
export function tidy({ dryRun = true, store, paths } = {}) {
  const d = dataDir()
  const plan = []
  const add = (p, category, reason) => plan.push({ path: p, category, reason, ...size(p) })
  const children = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => path.join(dir, n)) : [])
  for (const p of children(path.join(d, 'render'))) add(p, 'Render work files', 'temporary PDF conversion files')
  for (const p of children(path.join(d, 'preview'))) add(p, 'Previews', 'preview output')
  for (const p of children(path.join(d, 'logs'))) if (olderThan(p, 14)) add(p, 'Logs', 'dashboard log older than 14 days')
  for (const p of children(path.join(d, 'discovery'))) if (olderThan(p, 30)) add(p, 'Raw job-board results', 'raw search results older than 30 days (decisions are in the database)')
  for (const p of children(path.join(d, 'claims'))) if (olderThan(p, 30)) add(p, 'Research claims', 'finished research claim older than 30 days')
  for (const p of children(path.join(d, 'reviews'))) add(p, 'Review notes', 'code review notes')
  if (store) {
    // Drafts folders are named "<Employer> - <Role>" for the application they belong to.
    const oldSubmissions = store.submissions().filter((s) => Date.now() - Date.parse(s.recordedAt || s.createdAt) > 30 * DAY)
    const folders = new Map()
    for (const s of oldSubmissions) {
      const app = store.applications().find((a) => a.id === s.applicationId)
      if (app) folders.set(safeName(`${app.company} - ${app.title}`).toLowerCase(), app.id)
    }
    for (const p of children(path.join(folder('applications'), 'Drafts'))) {
      if (fs.statSync(p).isDirectory() && folders.has(path.basename(p).toLowerCase())) {
        add(p, 'Superseded drafts', 'drafts for a job submitted over 30 days ago; the filed copy is kept in its application folder')
      }
    }
  }
  for (const b of retentionPlan()) add(b.file, 'Old backups', 'database snapshot outside the 14-day / 12-month retention window')
  const selected = paths?.length ? plan.filter((i) => paths.some((p) => path.resolve(p) === path.resolve(i.path))) : plan
  if (paths?.length && selected.length !== paths.length) throw new Error('Some paths are not in the tidy list; run storage.tidy without apply to see the list.')
  const total = selected.reduce((n, i) => n + i.bytes, 0)
  if (dryRun) return { dryRun: true, items: plan, totalBytes: plan.reduce((n, i) => n + i.bytes, 0) }
  const moved = selected.map((i) => ({ ...i, archivedTo: archiveMove(i.path, { clearable: i.category, reason: i.reason }) }))
  return { dryRun: false, moved, totalBytes: total, next: 'Everything moved is in Archive/Clearable. Delete that folder yourself when you want the space back.' }
}
