#!/usr/bin/env node
// Repository hygiene for CI and pre-publish checks. Exits 1 when anything needs fixing.
//   1. No code that deletes files or history (archive-only project).
//   2. No personal data: real-looking email addresses or phone numbers, any term listed in the
//      optional, git-ignored app/data/privacy-denylist.txt (one term per line, # for comments),
//      and no tracked files inside private folders (app/data/, user folders, other ignored paths).
//   3. Every JSON file parses.
//   4. No file over 1 MB.
// Usage: node app/tests/check-repo.mjs [--root DIR] [--denylist FILE] [--staged] [--list]
//   --staged  read file contents from the Git index (what will be committed) instead of the disk.
// Findings never print the personal data they found: values and file names are masked.
// In app/tests/ only, a line may opt out of the deletion scan with the comment
// "check-repo: allow-deletion" (tests that prove the database refuses deletes, and this file).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const ROOT = path.resolve(flag('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'))
const DENYLIST = path.resolve(ROOT, flag('--denylist') || path.join('app', 'data', 'privacy-denylist.txt'))
const STAGED = args.includes('--staged')
const MAX_BYTES = 1024 * 1024
const ALLOW_MARK = 'check-repo: allow-deletion'
const ALLOW_MARK_DIRS = ['app/tests/']
const NEVER_READ = ['.git/', 'node_modules/']
const PRIVATE = ['app/data/']

const problems = []
const report = (kind, file, line, message) => problems.push({ kind, file, line, message })

// ---------- which files count as part of the repository ----------

function globToRegex(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++ } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return re
}

/** Minimal .gitignore support for checkouts without Git (ZIP downloads, fresh exports). */
function gitignoreMatcher(root) {
  let lines = []
  try { lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/) } catch {}
  const rules = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const negate = l.startsWith('!')
    let p = negate ? l.slice(1) : l
    const dirOnly = p.endsWith('/')
    if (dirOnly) p = p.slice(0, -1)
    const anchored = p.includes('/')
    if (p.startsWith('/')) p = p.slice(1)
    const body = globToRegex(p)
    return { negate, dirOnly, re: new RegExp(anchored ? `^${body}$` : `(^|/)${body}$`) }
  })
  return (rel) => {
    // test the file and each parent folder; the last matching rule wins
    const segments = rel.split('/')
    let ignored = false
    for (let i = 1; i <= segments.length; i++) {
      const candidate = segments.slice(0, i).join('/')
      const isDir = i < segments.length
      for (const r of rules) {
        if (r.dirOnly && !isDir) continue
        if (r.re.test(candidate)) ignored = !r.negate
      }
      if (ignored && isDir) return true
    }
    return ignored
  }
}

function walk(root, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if ([...NEVER_READ, ...PRIVATE].some((s) => `${child}/`.startsWith(s))) continue
    if (entry.isDirectory()) walk(root, child, out)
    else if (entry.isFile()) out.push(child)
  }
  return out
}

function gitList(root, extra) {
  const r = spawnSync('git', ['ls-files', '-z', ...extra], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
  if (r.error || r.status !== 0) {
    console.log(`check-repo: could not list files with git (${r.error?.message || r.stderr.trim()}); refusing to report success`)
    process.exit(1)
  }
  return r.stdout.split('\0').filter(Boolean)
}

function repoFiles(root) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', windowsHide: true })
  const same = top.status === 0 && path.resolve(top.stdout.trim()).toLowerCase() === root.toLowerCase()
  if (!same) {
    const ignored = gitignoreMatcher(root)
    return { files: walk(root).filter((f) => !ignored(f)).sort(), source: '.gitignore' }
  }
  // Tracked files that the ignore rules (or the private folders) say should never be committed.
  const trackedIgnored = new Set(gitList(root, ['--cached', '--ignored', '--exclude-standard']))
  const tracked = gitList(root, ['--cached'])
  for (const f of tracked) {
    if (trackedIgnored.has(f) || PRIVATE.some((p) => f.startsWith(p))) report('private-path', f, 0, 'is tracked but lives in a private/ignored location; untrack it (git rm --cached) and keep it local')
  }
  const listed = STAGED ? tracked : [...tracked, ...gitList(root, ['--others', '--exclude-standard'])]
  const files = listed.filter((f) => !trackedIgnored.has(f) && ![...NEVER_READ, ...PRIVATE].some((s) => f.startsWith(s)))
  return { files: [...new Set(files)].sort(), source: STAGED ? 'git index' : 'git' }
}

// ---------- rules ----------

/* eslint-disable */
const DELETION = [
  ['fs.rm / rmdir / unlink', /\bfs(?:\.promises)?\.(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\b/], // check-repo: allow-deletion
  ['rmSync / rmdirSync / unlinkSync', /\b(?:rmSync|rmdirSync|unlinkSync)\b/], // check-repo: allow-deletion
  ['unlink() / rmdir() call', /\b(?:unlink|rmdir)\s*\(/], // check-repo: allow-deletion
  ['fs deletion by name', /\b(?:fs|fsp|promises)\s*\[\s*['"](?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)['"]\s*\]/], // check-repo: allow-deletion
  ['Remove-Item', /\bRemove-Item\b/i], // check-repo: allow-deletion
  ['cmd rd/rmdir/del/erase', /(?:^|[\s&|(;@"'])(?:rd|rmdir|del|erase)\s+(?:\/[a-z]\s+)*["'%\w.\\]/im], // check-repo: allow-deletion
  ['shell rm', /(?:^|[\s;&|`("'])(?:rm|rimraf|trash)\s+(?:-[a-zA-Z]+\s+)*[\w"'.$~/*]/m], // check-repo: allow-deletion
  ['find -delete', /\bfind\b[^\n]*\s-delete\b/], // check-repo: allow-deletion
  ['git rm (without --cached)', /\bgit\s+rm\b(?![^\n]*--cached)/], // check-repo: allow-deletion
  ['git clean', /\bgit\s+clean\b|['"]clean['"]\s*,\s*['"]-/], // check-repo: allow-deletion
  ['reset --hard', /\breset\s+--hard\b|['"]reset['"]\s*,\s*['"]--hard['"]/], // check-repo: allow-deletion
  ['git stash drop/clear', /\bstash\s+(?:drop|clear)\b|['"]stash['"]\s*,\s*['"](?:drop|clear)['"]/], // check-repo: allow-deletion
  ['git checkout -- / restore', /\bgit\s+checkout\s+(?:\S+\s+)?--\s|\bgit\s+restore\b|['"]restore['"]\s*,\s*['"]--/], // check-repo: allow-deletion
  ['SQL DELETE FROM', /\bDELETE\s+FROM\b/i], // check-repo: allow-deletion
  ['SQL DROP', /\bDROP\s+(?:TABLE|TRIGGER|INDEX|VIEW|COLUMN)\b/i], // check-repo: allow-deletion
  ['Python delete', /\bshutil\.rmtree\b|\bos\.(?:remove|unlink|rmdir|removedirs)\s*\(/], // check-repo: allow-deletion
  ['overwrite copy (force: true)', /\bcpSync\s*\([^)]*\bforce\s*:\s*true/], // check-repo: allow-deletion
]
// Checked against the whole file so declarations split over several lines are caught.
const DELETION_MULTILINE = [
  ['fs deletion import', /import\s*\{[^}]*\b(?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\b[^}]*\}\s*from\s*['"](?:node:)?fs/g], // check-repo: allow-deletion
  ['fs deletion destructure', /\{[^}]*\b(?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\b[^}]*\}\s*=\s*(?:await\s+import\(\s*['"](?:node:)?fs|require\(\s*['"](?:node:)?fs|fs\b|fsp\b|promises\b)/g], // check-repo: allow-deletion
  ['subprocess rm/del', /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*['"](?:rm|rmdir|del|rd|rimraf)['"]/g], // check-repo: allow-deletion
]
/* eslint-enable */

const SCRIPT_EXT = /\.(?:mjs|cjs|js|ts|tsx|jsx|json|sh|bash|zsh|command|cmd|bat|ps1|psm1|py|yml|yaml|toml|html|sql)$/i
const isDoc = (f) => /\.(?:md|markdown|txt)$/i.test(f) || /(^|\/)(LICENSE|CHANGELOG)$/i.test(f)
// Shell-command patterns are only meaningful in scripts (package.json "scripts" run in a shell).
const SHELL_ONLY = new Set(['cmd rd/rmdir/del/erase', 'shell rm', 'find -delete'])
const isShell = (f) => /\.(?:sh|bash|zsh|command|cmd|bat|ps1|psm1|yml|yaml)$/i.test(f) || /(^|\/)package\.json$/i.test(f) || !path.extname(f)

const LOCAL_CHAR = /[A-Za-z0-9._%+-]/
const DOMAIN_CHAR = /[A-Za-z0-9.-]/
const DOMAIN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/

/** Email addresses in `text`, found by expanding around each "@" (linear, so huge lines stay fast). */
function findEmails(text) {
  const found = []
  for (let at = text.indexOf('@'); at >= 0; at = text.indexOf('@', at + 1)) {
    let s = at
    while (s > 0 && LOCAL_CHAR.test(text[s - 1])) s--
    let e = at + 1
    while (e < text.length && DOMAIN_CHAR.test(text[e])) e++
    const local = text.slice(s, at)
    const domain = text.slice(at + 1, e).replace(/[.-]+$/, '')
    if (local && DOMAIN.test(domain)) found.push(`${local}@${domain}`)
  }
  return found
}
// Only reserved documentation domains (RFC 2606/6761) and a few exact, non-personal addresses.
const SAFE_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/i
const SAFE_EMAIL = new Set(['git@github.com', 'noreply@github.com'])
const PHONE = /(?<![\w.\/-])(?:\+?1[\s.-]?)?(?:\((\d{3})\)\s?|(\d{3})[\s.-])(\d{3})[\s.-](\d{4})(?![\w-])/g
const INTL_PHONE = /(?<![\w.\/-])\+(?!1[\s.-]?\(?\d{3})\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]\d{2,5}){2,4}(?![\w-])/g
// Unformatted numbers are only treated as phones next to a phone-like label.
const COMPACT_PHONE = /\b(?:phone|tel|telephone|mobile|cell)\b["']?\s*[:=]\s*["']?(\+?1?(\d{3})(\d{3})(\d{4}))\b/gi

function emailAllowed(address) {
  const lower = address.toLowerCase()
  const domain = lower.split('@')[1]
  return SAFE_EMAIL.has(lower) || domain.endsWith('users.noreply.github.com') || SAFE_EMAIL_DOMAIN.test(domain)
}

/** Fictional numbers only: 555-0100..555-0199 (NANP reserved) or the unassigned area code 555. */
function phoneAllowed(area, exchange, line) {
  return area === '555' || (exchange === '555' && /^01\d\d$/.test(line))
}

function readDenylist() {
  if (!fs.existsSync(DENYLIST)) return []
  return fs.readFileSync(DENYLIST, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((term, i) => {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const left = /^\w/.test(term) ? '(?<![A-Za-z0-9])' : ''
    const right = /\w$/.test(term) ? '(?![A-Za-z0-9])' : ''
    return { index: i + 1, re: new RegExp(left + esc + right, 'gi') }
  })
}

// ---------- masking: never print what was found ----------

const maskEmail = (e) => { const [l, d] = e.split('@'); return `${l[0]}***@${d[0]}***${d.slice(d.lastIndexOf('.'))}` }
const maskDigits = (p) => p.replace(/\d(?=(?:\D*\d){2})/g, '#')
function redact(text, denylist) {
  let out = text
  for (const e of findEmails(out)) out = out.split(e).join(maskEmail(e))
  out = out.replace(PHONE, (m) => maskDigits(m)).replace(INTL_PHONE, (m) => maskDigits(m))
  for (const t of denylist) out = out.replace(t.re, (m) => `${m[0]}${'*'.repeat(Math.max(2, m.length - 1))}`)
  return out
}

// ---------- reading content ----------

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0)
}

function readContent(file) {
  if (!STAGED) return fs.readFileSync(path.join(ROOT, file))
  const r = spawnSync('git', ['show', `:${file}`], { cwd: ROOT, windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`could not read ${file} from the index`)
  return r.stdout
}

/** Text inside Office files (ZIPs of XML): run text joined without gaps, plus relationship targets. */
async function officeText(buf, file) {
  try {
    const { readZip } = await import(new URL('../lib/zip.mjs', import.meta.url))
    const parts = [...readZip(buf)]
    const xml = parts.filter(([n]) => n.endsWith('.xml')).map(([, b]) => b.toString('utf8').replace(/<\/w:p>|<w:br\/>|<\/a:p>/g, '\n').replace(/<[^>]+>/g, ''))
    const rels = parts.filter(([n]) => n.endsWith('.rels')).flatMap(([, b]) => [...b.toString('utf8').matchAll(/Target="([^"]+)"/g)].map((m) => decodeURIComponent(m[1])))
    return [...xml, ...rels].join('\n')
  } catch (error) {
    report('privacy', file, 0, `could not be inspected (${error.message}); remove it from the repository or fix it`)
    return ''
  }
}

// ---------- run ----------

const { files, source } = repoFiles(ROOT)
const denylist = readDenylist()

function scanPrivacy(file, text, lineOf) {
  for (const e of findEmails(text)) if (!emailAllowed(e)) report('privacy', file, lineOf, 'email address (use @example.com)')
  for (const m of text.matchAll(PHONE)) if (!phoneAllowed(m[1] || m[2], m[3], m[4])) report('privacy', file, lineOf, 'phone number (use 555-01xx)')
  for (const _ of text.matchAll(INTL_PHONE)) report('privacy', file, lineOf, 'phone number (use 555-01xx)')
  for (const m of text.matchAll(COMPACT_PHONE)) if (!phoneAllowed(m[2], m[3], m[4])) report('privacy', file, lineOf, 'phone number (use 555-01xx)')
  for (const t of denylist) { t.re.lastIndex = 0; if (t.re.test(text)) report('privacy', file, lineOf, `denylisted term #${t.index}`) }
}

for (const file of files) {
  scanPrivacy(file, file.replace(/[/_]/g, ' '), 0) // the path itself

  let buf
  try { buf = readContent(file) } catch (error) { report('read', file, 0, error.message); continue }
  if (buf.length > MAX_BYTES) report('size', file, 0, `${(buf.length / 1048576).toFixed(2)} MB is over the 1 MB limit`)

  let text
  if (/\.(?:docx|xlsx|pptx)$/i.test(file)) text = await officeText(buf, file)
  else if (isBinary(buf)) continue
  else text = buf.toString('utf8')
  const lines = text.split(/\r?\n/)

  if (!isDoc(file) && (SCRIPT_EXT.test(file) || isShell(file))) {
    const markAllowed = ALLOW_MARK_DIRS.some((d) => file.startsWith(d))
    const allowedLine = (l) => markAllowed && l.includes(ALLOW_MARK)
    lines.forEach((l, i) => {
      if (allowedLine(l)) return
      for (const [name, re] of DELETION) {
        if (SHELL_ONLY.has(name) && !isShell(file)) continue
        if (re.test(l)) report('deletion', file, i + 1, `${name}: ${l.trim().slice(0, 140)}`)
      }
    })
    for (const [name, re] of DELETION_MULTILINE) {
      for (const m of text.matchAll(re)) {
        const line = text.slice(0, m.index).split(/\r?\n/).length
        if (allowedLine(lines[line - 1])) continue
        if (problems.some((p) => p.kind === 'deletion' && p.file === file && p.line === line)) continue
        report('deletion', file, line, `${name}: ${m[0].replace(/\s+/g, ' ').slice(0, 140)}`)
      }
    }
  }

  lines.forEach((l, i) => scanPrivacy(file, l, i + 1))

  if (/\.json$/i.test(file)) {
    try { JSON.parse(buf.toString('utf8')) } catch (error) { report('json', file, 0, `does not parse: ${error.message}`) }
  }
}

if (args.includes('--list')) for (const f of files) console.log(`file: ${redact(f, denylist)}`)
for (const p of problems) console.log(`[${p.kind}] ${redact(p.file, denylist)}${p.line ? `:${p.line}` : ''}: ${redact(p.message, denylist)}`)
const counts = problems.reduce((o, p) => ({ ...o, [p.kind]: (o[p.kind] || 0) + 1 }), {})
console.log(`check-repo: ${files.length} files (listed via ${source}), denylist ${denylist.length ? `${denylist.length} terms` : 'not present'}; ${problems.length ? `${problems.length} problem(s) ${JSON.stringify(counts)}` : 'all checks passed'}`)
process.exit(problems.length ? 1 : 0)
