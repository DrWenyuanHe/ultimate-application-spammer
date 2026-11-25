import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { isolate } from './helpers.mjs'

const home = isolate('archive')
const { archiveMove, archiveCopy, archiveTarget, recordArchived, csvSafe, stamp, writeGenerated, uniquePath, safeName } = await import('../lib/archive.mjs')

const archiveDir = path.join(home, 'Archive')
const logRows = () => fs.readFileSync(path.join(archiveDir, 'archive-log.csv'), 'utf8').trim().split('\n')

function makeFile(rel, content) {
  const file = path.join(home, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

test('safeName strips characters that are invalid in Windows/macOS file names', () => {
  assert.equal(safeName('Aspen / Health: "Analyst" <Data>?'), 'Aspen Health Analyst Data')
  assert.equal(safeName('   '), 'item')
  assert.ok(safeName('x'.repeat(500)).length <= 120)
})

test('uniquePath never returns an existing path', () => {
  const dir = path.join(home, 'unique')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.txt'), '1')
  fs.writeFileSync(path.join(dir, 'a (2).txt'), '2')
  assert.equal(uniquePath(dir, 'a.txt'), path.join(dir, 'a (3).txt'))
  assert.equal(uniquePath(dir, 'b.txt'), path.join(dir, 'b.txt'))
})

test('archiveMove moves (never overwrites) and logs each move', () => {
  const a = makeFile('1 Applications/Drafts/notes.txt', 'first')
  const movedA = archiveMove(a, { reason: 'replaced by a newer draft' })
  assert.ok(!fs.existsSync(a))
  assert.equal(path.dirname(movedA), archiveDir)
  assert.match(path.basename(movedA), /^\d{4}-\d{2}-\d{2} \d{4} notes\.txt$/)

  // same name again within the same minute → a separate, numbered entry
  const b = makeFile('1 Applications/Drafts/notes.txt', 'second')
  const movedB = archiveMove(b, { reason: 'again' })
  assert.notEqual(movedB, movedA)
  assert.equal(fs.readFileSync(movedA, 'utf8'), 'first')
  assert.equal(fs.readFileSync(movedB, 'utf8'), 'second')

  const rows = logRows()
  assert.equal(rows[0], 'archived_at,action,original_path,archived_as,reason')
  const mine = rows.filter((r) => r.includes('notes.txt'))
  assert.equal(mine.length, 2)
  assert.match(mine[0], /"moved","1 Applications[\\/]Drafts[\\/]notes\.txt","Archive[\\/].*notes\.txt","replaced by a newer draft"/)
})

test('archiveMove handles folders and labels, and refuses missing items and items already archived', () => {
  const dir = path.join(home, 'old folder')
  makeFile('old folder/inner/file.md', 'kept')
  const moved = archiveMove(dir, { label: 'Old "folder": label' })
  assert.match(path.basename(moved), /Old folder label$/)
  assert.equal(fs.readFileSync(path.join(moved, 'inner', 'file.md'), 'utf8'), 'kept')
  assert.throws(() => archiveMove(path.join(home, 'does-not-exist')), /Nothing to archive/)
  assert.throws(() => archiveMove(moved), /already in Archive/)
  assert.throws(() => archiveMove(archiveDir), /already in Archive/)
})

test('archiveCopy keeps the original and never overwrites an existing archive entry', () => {
  const src = makeFile('data/db.sqlite', 'database bytes')
  const c1 = archiveCopy(src, { reason: 'backup' })
  const c2 = archiveCopy(src, { reason: 'backup' })
  assert.notEqual(c1, c2)
  assert.equal(fs.readFileSync(src, 'utf8'), 'database bytes')
  assert.equal(fs.readFileSync(c1, 'utf8'), 'database bytes')
  assert.ok(logRows().some((r) => r.includes('"copied"') && r.includes('"backup"')))
})

test('archiveTarget returns an unused path; recordArchived logs it only once the caller has written it', () => {
  const before = logRows().length
  const t = archiveTarget('before v9 database.sqlite')
  assert.ok(!fs.existsSync(t))
  assert.equal(path.dirname(t), archiveDir)
  assert.equal(logRows().length, before, 'nothing is logged for a path that was never written')
  fs.writeFileSync(t, 'backup')
  recordArchived(t, { reason: 'update', original: 'app/data/workspace.sqlite' })
  assert.ok(logRows().some((r) => r.includes('"saved"') && r.includes('app/data/workspace.sqlite') && r.includes('"update"')))
  assert.notEqual(archiveTarget('before v9 database.sqlite'), t, 'a written target is not handed out again')
})

test('archiveMove never lands on a file that already exists in Archive, even one with the exact stamped name', () => {
  const src = makeFile('clash/report.txt', 'new content')
  const squatter = path.join(archiveDir, `${stamp()} report.txt`)
  fs.mkdirSync(archiveDir, { recursive: true })
  if (!fs.existsSync(squatter)) fs.writeFileSync(squatter, 'already archived')
  const before = fs.readFileSync(squatter, 'utf8')
  const moved = archiveMove(src)
  assert.notEqual(moved, squatter)
  assert.equal(fs.readFileSync(squatter, 'utf8'), before)
  assert.equal(fs.readFileSync(moved, 'utf8'), 'new content')
})

test('clearable items go to Archive/Clearable/<Category> and are logged as clearable', () => {
  const src = makeFile('app/data/render/job-1/document.pdf', 'pdf')
  const moved = archiveMove(path.dirname(src), { clearable: 'Render: work/files', reason: 'temporary' })
  assert.equal(path.dirname(moved), path.join(archiveDir, 'Clearable', 'Render work files'))
  assert.equal(fs.readFileSync(path.join(moved, 'document.pdf'), 'utf8'), 'pdf')
  assert.ok(logRows().some((r) => r.includes('"moved (clearable)"') && r.includes('"temporary"')))
})

test('csvSafe neutralises spreadsheet formulas in the archive log', () => {
  assert.equal(csvSafe('=HYPERLINK("http://example.com")'), `'=HYPERLINK("http://example.com")`)
  for (const lead of ['+', '-', '@', '\t']) assert.equal(csvSafe(`${lead}1`)[0], "'")
  assert.equal(csvSafe('plain'), 'plain')
  assert.equal(csvSafe(undefined), '')
  const src = makeFile('formula.txt', 'x')
  archiveMove(src, { reason: '=cmd|"/c calc"!A1' })
  assert.ok(logRows().some((r) => r.includes(`"'=cmd|""/c calc""!A1"`)))
})

test('writeGenerated refreshes its own untouched output in place without archiving', () => {
  const file = path.join(home, '3 Job Leads', 'Jobs.csv')
  const before = logRows().length
  assert.deepEqual(writeGenerated(file, 'v1\n'), { path: file, changed: true })
  assert.deepEqual(writeGenerated(file, 'v1\n'), { path: file, changed: false })
  assert.equal(writeGenerated(file, Buffer.from('v2\n')).changed, true)
  assert.equal(fs.readFileSync(file, 'utf8'), 'v2\n')
  assert.equal(logRows().length, before, 'nothing archived for untouched generated output')
  const registry = JSON.parse(fs.readFileSync(path.join(home, 'app', 'data', 'generated-files.json'), 'utf8'))
  assert.ok(Object.keys(registry).some((k) => k.endsWith('Jobs.csv')))
})

test('writeGenerated archives a copy the person edited before writing the new version', () => {
  const file = path.join(home, '4 Templates', 'Writing Rules.md')
  writeGenerated(file, '# Rules v1\n')
  fs.writeFileSync(file, '# Rules v1\n\nMy own note.\n')
  writeGenerated(file, '# Rules v2\n')
  assert.equal(fs.readFileSync(file, 'utf8'), '# Rules v2\n')
  const kept = fs.readdirSync(archiveDir).filter((f) => f.endsWith('Writing Rules.md'))
  assert.equal(kept.length, 1)
  assert.equal(fs.readFileSync(path.join(archiveDir, kept[0]), 'utf8'), '# Rules v1\n\nMy own note.\n')

  // a file the app never wrote is also treated as the person's and archived
  const foreign = makeFile('3 Job Leads/Job Leads.md', 'hand written')
  writeGenerated(foreign, 'generated')
  assert.ok(fs.readdirSync(archiveDir).some((f) => f.endsWith('Job Leads.md')))
})
