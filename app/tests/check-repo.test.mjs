// Proves check-repo.mjs actually catches what CI relies on it to catch, using fixture trees.
// Violations are assembled from pieces so this file itself stays clean for the real scan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertFixtureRepo, git, gitEnv, hasGit, tempDir } from './helpers.mjs'

const SCRIPT = fileURLToPath(new URL('./check-repo.mjs', import.meta.url))
const at = '@'

function fixture(files, root = tempDir('check-repo')) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return root
}

function check(root, extra = []) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...extra], { encoding: 'utf8', windowsHide: true })
  return { status: r.status, out: r.stdout + r.stderr }
}

const gitignore = 'app/data/\n1 Applications/*\n!1 Applications/README.md\n*.log\n'

test('a clean tree passes', () => {
  const root = fixture({
    '.gitignore': gitignore,
    'app/lib/ok.mjs': "import fs from 'node:fs'\nfs.renameSync('a', 'b')\nconst u = new URL('https://example.com'); u.searchParams.delete('utm_source')\nconst rm = 3\n",
    'README.md': `Contact jordan${at}example.com or (555) 010-0199 or 312-555-0142. Never use rm -rf or Remove-${'Item'}.\n`,
    'data.json': '{"ok": true}',
    'package.json': '{"scripts": {"start": "node app/cli.mjs start", "test": "node --test"}}',
  })
  const r = check(root)
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /all checks passed/)
})

test('deletion APIs and commands are reported with file:line, including multi-line and script forms', () => {
  const root = fixture({
    '.gitignore': gitignore,
    'app/lib/bad.mjs': ['// line 1', `fs.${'rm'}Sync(dir, { recursive: true })`, `await fs.promises.${'unlink'}(file)`, `import { ${'rm'} } from 'node:fs/promises'`, `db.exec('DELETE ${'FROM'} events')`, `db.exec('DROP ${'TRIGGER'} x')`, `git(['${'clean'}', '-fdx'])`, `spawnSync('git', ['reset', '--${'hard'}'])`, `const { ${'rm'} } = fs.promises`, `await fs['${'unlink'}'](file)`].join('\n'),
    'app/lib/multiline.mjs': ['import {', '  readFileSync,', `  ${'rm'},`, "} from 'node:fs/promises'", `spawnSync('${'rm'}', ['-rf', 'x'])`].join('\n'),
    'package.json': `{"scripts": {"clean": "${'rm'} -rf dist", "start": "node app/cli.mjs start"}}`,
    'scripts/tidy.ps1': `Remove-${'Item'} -Recurse -Force out\n`,
    'scripts/tidy.sh': `#!/bin/sh\n${'rm'} -rf build\ngit ${'clean'} -fd\nfind . -name '*.tmp' -${'delete'}\n`,
    'Start.cmd': `@echo off\n${'rd'} /s /q cache\n`,
    'app/tests/allowed.test.mjs': `db.exec('DELETE ${'FROM'} events') // check-repo: allow-deletion\n`,
    'app/lib/sneaky.mjs': `db.exec('DELETE ${'FROM'} events') // check-repo: allow-deletion\n`,
    'docs/policy.md': `Never call fs.${'rm'}Sync or git ${'clean'}.\n`,
  })
  const r = check(root)
  assert.equal(r.status, 1)
  const expected = ['app/lib/bad.mjs:2', 'app/lib/bad.mjs:3', 'app/lib/bad.mjs:4', 'app/lib/bad.mjs:5', 'app/lib/bad.mjs:6', 'app/lib/bad.mjs:7', 'app/lib/bad.mjs:8', 'app/lib/bad.mjs:9', 'app/lib/bad.mjs:10',
    'app/lib/multiline.mjs:1', 'app/lib/multiline.mjs:5', 'package.json:1', 'scripts/tidy.ps1:1', 'scripts/tidy.sh:2', 'scripts/tidy.sh:3', 'scripts/tidy.sh:4', 'Start.cmd:2', 'app/lib/sneaky.mjs:1']
  for (const e of expected) assert.ok(r.out.includes(`[deletion] ${e}:`), `${e} not reported\n${r.out}`)
  assert.ok(!r.out.includes('app/lib/bad.mjs:1:'))
  assert.ok(!r.out.includes('allowed.test.mjs'), 'allow marker respected in app/tests/')
  assert.ok(!r.out.includes('docs/policy.md'), 'documentation may name prohibited commands')
})

test('privacy: emails and phone numbers are reported without printing them; ignored folders are not read', () => {
  const caPhone = ['(613)', '722-4810'].join(' ')
  const ukPhone = ['+44', '20', '7946', '0958'].join(' ')
  const privateEmail = `jamie.private${at}mailhost.io`
  const root = fixture({
    '.gitignore': gitignore,
    'app/demo/people.json': JSON.stringify({ email: privateEmail, phone: caPhone, ok: `pat${at}example.org`, fictional: '613-555-0110', mobile: ['613', '722', '4810'].join('') }, null, 1),
    'notes.md': `Call ${ukPhone} tomorrow. Write to you${at}realcompany.ca\n`,
    'app/lib/sizes.mjs': 'const page = [12240, 15840]; const v = "2026-11-25"; const id = "1795629922923"\n',
    '1 Applications/README.md': `Questions: hiring${at}realcompany.ca\n`,
    [`Resume ${'613'}-722-4810.txt`]: 'x',
    '1 Applications/2026-11-20 Real Co - Analyst/submission.json': `{"email": "someone.real${at}gmail.com"}`,
    'app/data/workspace.json': `{"email": "someone.real${at}gmail.com"}`,
    'debug.log': `someone.real${at}gmail.com`,
  })
  const r = check(root)
  assert.equal(r.status, 1)
  assert.match(r.out, /\[privacy\] app\/demo\/people\.json:2: email address/)
  assert.match(r.out, /\[privacy\] app\/demo\/people\.json:3: phone number/)
  assert.match(r.out, /\[privacy\] app\/demo\/people\.json:6: phone number/, 'compact number next to a phone label')
  assert.match(r.out, /\[privacy\] notes\.md:1: phone number/)
  assert.match(r.out, /\[privacy\] notes\.md:1: email address/, 'placeholder-looking names on real domains are not exempt')
  assert.match(r.out, /\[privacy\] 1 Applications\/README\.md:1: email address/)
  assert.match(r.out, /\[privacy\] Resume [#\d-]+\.txt: phone number/, 'file names are checked for phone numbers')
  for (const secret of [privateEmail, caPhone, ukPhone, '722-4810', '6137224810', 'realcompany.ca']) assert.ok(!r.out.includes(secret), `output must not contain ${secret}`)
  assert.ok(!r.out.includes('sizes.mjs'), 'numbers, dates and ids are not phone numbers')
  assert.ok(!r.out.includes('example.org') && !r.out.includes('613-555-0110'))
  assert.ok(!r.out.includes('gmail'), 'git-ignored user folders, app/data and *.log are not read')
})

test('privacy denylist terms are found in content and file names; the term is never printed', () => {
  const root = fixture({
    '.gitignore': gitignore,
    'app/data/privacy-denylist.txt': '# private names\nQuillfeather\nOrchard Vale Clinic\n',
    'app/guides/list.json': '{"employers": ["Orchard Vale Clinic"]}',
    'app/templates/quillfeather-resume.json': '{}',
    'README.md': 'Thanks to quillfeather.\nNot a match: Quillfeathers? no, word boundary.\n',
  })
  const r = check(root)
  assert.equal(r.status, 1)
  assert.match(r.out, /\[privacy\] app\/guides\/list\.json:1: denylisted term #2/)
  assert.match(r.out, /\[privacy\] app\/templates\/q\*+-resume\.json: denylisted term #1/, 'file name reported with the term masked')
  assert.match(r.out, /\[privacy\] README\.md:1: denylisted term #1/)
  assert.ok(!r.out.includes('README.md:2'), 'terms match whole words only')
  assert.ok(!/quillfeather|Orchard Vale/i.test(r.out), 'no denylisted term appears anywhere in the output')
  const custom = check(root, ['--denylist', path.join(root, 'missing.txt')])
  assert.ok(!custom.out.includes('denylisted'), '--denylist points at another file')
})

test('Office documents are inspected: text split across runs and hyperlink targets', async () => {
  const { writeZip } = await import('../lib/zip.mjs')
  const docXml = `<w:document><w:body><w:p><w:r><w:t>jamie.private</w:t></w:r><w:r><w:t>${at}mailhost.io</w:t></w:r></w:p></w:body></w:document>`
  const rels = `<Relationships><Relationship Id="r1" Target="mailto:other.person${at}mailhost.io" TargetMode="External"/></Relationships>`
  const root = fixture({ '.gitignore': gitignore })
  fs.writeFileSync(path.join(root, 'split.docx'), writeZip([{ name: 'word/document.xml', data: docXml }]))
  fs.writeFileSync(path.join(root, 'link.docx'), writeZip([{ name: 'word/document.xml', data: '<w:document/>' }, { name: 'word/_rels/document.xml.rels', data: rels }]))
  fs.writeFileSync(path.join(root, 'broken.docx'), Buffer.from('PK not really a zip'))
  const r = check(root)
  assert.equal(r.status, 1)
  assert.match(r.out, /\[privacy\] split\.docx:\d+: email address/)
  assert.match(r.out, /\[privacy\] link\.docx:\d+: email address/)
  assert.match(r.out, /\[privacy\] broken\.docx: could not be inspected/)
})

test('invalid JSON and files over 1 MB fail the check', () => {
  const root = fixture({
    '.gitignore': gitignore,
    'app/templates/broken.json': '{"a": 1,}',
    'app/ui/huge.js': `// ${'x'.repeat(1024 * 1024 + 10)}\n`,
  })
  const r = check(root)
  assert.equal(r.status, 1)
  assert.match(r.out, /\[json\] app\/templates\/broken\.json: does not parse/)
  assert.match(r.out, /\[size\] app\/ui\/huge\.js: 1\.00 MB is over the 1 MB limit/)
})

test('in a Git checkout: force-tracked private files fail, and --staged checks what will be committed', { skip: !hasGit() && 'git is not installed' }, () => {
  const base = tempDir('check-repo-git')
  const env = gitEnv(base)
  const root = fixture({
    '.gitignore': gitignore,
    'README.md': 'clean\n',
    '1 Applications/README.md': 'Your filed applications live here.\n',
    'app/lib/ok.mjs': 'export const x = 1\n',
  }, path.join(base, 'repo'))
  git(['init', '--quiet'], { cwd: root, env })
  assertFixtureRepo(root, env)
  git(['add', '-A'], { cwd: root, env })
  const clean = check(root)
  assert.equal(clean.status, 0, clean.out)
  assert.match(clean.out, /listed via git/)

  fixture({ '1 Applications/2026-11-20 Real Co/resume.pdf': Buffer.from([0, 1, 2, 3]), 'app/data/workspace.sqlite': Buffer.from([0, 0, 0]) }, root)
  git(['add', '--force', '1 Applications/2026-11-20 Real Co/resume.pdf', 'app/data/workspace.sqlite'], { cwd: root, env })
  const tracked = check(root)
  assert.equal(tracked.status, 1)
  assert.match(tracked.out, /\[private-path\] 1 Applications\/2026-11-20 Real Co\/resume\.pdf/)
  assert.match(tracked.out, /\[private-path\] app\/data\/workspace\.sqlite/)
  assert.ok(!tracked.out.includes('[private-path] 1 Applications/README.md'), 'the README exception stays allowed')
  git(['rm', '--cached', '--quiet', '1 Applications/2026-11-20 Real Co/resume.pdf', 'app/data/workspace.sqlite'], { cwd: root, env }) // untrack only

  // staged content differs from the working tree
  fs.writeFileSync(path.join(root, 'app', 'lib', 'ok.mjs'), `export const contact = 'jamie.private${at}mailhost.io'\n`)
  git(['add', 'app/lib/ok.mjs'], { cwd: root, env })
  fs.writeFileSync(path.join(root, 'app', 'lib', 'ok.mjs'), 'export const x = 1\n')
  assert.equal(check(root).status, 0, 'the working tree is clean')
  const staged = check(root, ['--staged'])
  assert.equal(staged.status, 1)
  assert.match(staged.out, /\[privacy\] app\/lib\/ok\.mjs:1: email address/)
  assert.match(staged.out, /listed via git index/)
})

test('the real repository passes check-repo (without the private denylist, so the result does not depend on local files)', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--denylist', path.join(tempDir('check-repo-nodeny'), 'none.txt')], { encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})
