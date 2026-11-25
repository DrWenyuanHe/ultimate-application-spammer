// Fast health check run at the start of every agent session (Claude Code hook / AGENTS.md rule).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { FOLDERS, dataDir, dbPath, folder, rootDir } from './paths.mjs'
import { checkForUpdate, currentVersion, installMode } from './update.mjs'
import { pdfConverter } from './docx.mjs'

const WEEK = 7 * 24 * 60 * 60 * 1000

function cachedConverter() {
  const file = path.join(dataDir(), 'doctor-cache.json')
  let cache = {}
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  if (cache.checkedAt && Date.now() - Date.parse(cache.checkedAt) < WEEK) return cache.converter
  const converter = pdfConverter()
  if (fs.existsSync(dataDir())) fs.writeFileSync(file, JSON.stringify({ checkedAt: new Date().toISOString(), converter }, null, 2))
  return converter
}

export async function runDoctor({ network = true, port = Number(process.env.PORT) || 4321 } = {}) {
  const checks = []
  const add = (id, ok, detail, fix) => checks.push({ id, ok, detail, fix })
  const major = Number(process.versions.node.split('.')[0])
  add('node', major >= 24, `Node ${process.versions.node}`, 'Install Node.js 24 LTS or newer (Windows: winget install OpenJS.NodeJS.LTS; macOS: brew install node).')
  const gitV = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true })
  add('git', gitV.status === 0, gitV.status === 0 ? gitV.stdout.trim() : 'Git not found', 'Install Git (Windows: winget install Git.Git; macOS: xcode-select --install). Needed for updates.')
  const mode = gitV.status === 0 ? installMode() : { mode: 'unknown' }
  add('install', !['not-git', 'incomplete'].includes(mode.mode), `Install type: ${mode.mode}${mode.tag ? ` (${mode.tag})` : mode.branch ? ` (branch ${mode.branch})` : ''}`, 'Run `node app/cli.mjs setup --convert-zip` so updates work.')
  const missing = Object.values(FOLDERS).filter((f) => !fs.existsSync(path.join(rootDir(), f)))
  const setupDone = fs.existsSync(path.join(dataDir(), 'setup-state.json'))
  add('folders', missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : 'All folders present', 'Run `node app/cli.mjs setup`.')
  add('database', fs.existsSync(dbPath()), fs.existsSync(dbPath()) ? 'Database found' : 'No database yet', 'Run `node app/cli.mjs setup`.')
  let profile = false
  if (fs.existsSync(dbPath()) && major >= 24) {
    try {
      const { openStore } = await import('./store.mjs')
      const store = openStore()
      profile = Boolean(store.profile()?.name)
      const answers = store.screeningAnswers()
      add('screening-answers', answers.complete, answers.complete ? 'Common application questions answered' : `${answers.missingRequired.length} common application questions not answered yet`, 'Run the onboarding questions in app/skills/onboarding.md.')
      add('experience', true, `${store.experienceStrength().total} experiences recorded`)
      store.close()
      add('database-open', true, 'Database opens and is up to date')
    } catch (error) {
      add('database-open', false, error.message, 'Ask your agent to run the setup skill in repair mode.')
    }
  }
  add('profile', profile, profile ? 'Profile saved' : 'Profile not filled in yet', 'Run the onboarding skill (app/skills/onboarding.md).')
  add('templates', fs.existsSync(path.join(folder('templates'), 'Resume master.docx')), 'Word masters in 3 Templates', 'Run the docs.refresh-templates operation.')
  if (setupDone) {
    let setupVersion
    try { setupVersion = JSON.parse(fs.readFileSync(path.join(dataDir(), 'setup-state.json'), 'utf8')).version } catch {}
    add('app-version', setupVersion === safeVersion(), setupVersion === safeVersion() ? `Rules and templates from v${setupVersion}` : 'The app was updated; its rules and templates need a refresh', 'Run `node app/cli.mjs setup` (no need to ask).')
  }
  const converter = setupDone ? cachedConverter() : null
  checks.push({ id: 'pdf', ok: true, optional: true, detail: converter ? `PDF export via ${converter.kind}` : 'No PDF converter (optional)', fix: converter ? undefined : 'Optional: install LibreOffice (winget install TheDocumentFoundation.LibreOffice / brew install --cask libreoffice) to export PDFs.' })

  let dashboard = false
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) })
    const h = res.ok ? await res.json() : null
    dashboard = h?.app === 'ultimate-application-spammer' && path.resolve(h.root || '').toLowerCase() === rootDir().toLowerCase()
  } catch {}

  let update = null
  if (network && mode.mode !== 'not-git' && gitV.status === 0) {
    try { update = checkForUpdate({ timeout: 6000 }) } catch (error) { update = { error: error.message } }
  }
  const onboardingIds = ['profile', 'screening-answers']
  const required = checks.filter((c) => !c.optional && !onboardingIds.includes(c.id))
  const onboarded = checks.filter((c) => onboardingIds.includes(c.id)).every((c) => c.ok) && profile
  const status = !setupDone ? 'first-run' : !required.every((c) => c.ok) ? 'needs-repair' : onboarded ? 'ready' : 'onboarding-needed'
  return { status, version: safeVersion(), dashboard, checks, update }
}

function safeVersion() {
  try { return currentVersion() } catch { return 'unknown' }
}

/** One short block for the session-start hook. */
export function briefReport(r) {
  const lines = [`[Ultimate Application Spammer v${r.version}] status: ${r.status}${r.dashboard ? ' · dashboard running' : ''}`]
  if (r.status === 'first-run') lines.push('First run: before anything else, follow app/skills/setup.md (it checks prerequisites, creates folders and asks a few setup questions).')
  if (r.status === 'needs-repair') lines.push(`Needs repair: ${r.checks.filter((c) => !c.ok && !c.optional && !['profile', 'screening-answers'].includes(c.id)).map((c) => `${c.id} — ${c.fix}`).join(' | ')}. Follow app/skills/setup.md in repair mode.`)
  if (r.status === 'onboarding-needed') lines.push(`Onboarding not finished (${r.checks.filter((c) => ['profile', 'screening-answers'].includes(c.id) && !c.ok).map((c) => c.detail).join('; ')}). When the person is ready, follow app/skills/onboarding.md: profile and common application questions, then importing their resumes, CVs and cover letters.`)
  if (r.update?.shouldPrompt) lines.push(`Update available: v${r.update.current} → ${r.update.latest}. After the current task finishes, ask the person "Version ${r.update.latest} is available — install it now? (yes/no)" and follow app/skills/update.md (it reads the release notes with: node app/cli.mjs update check).`)
  return lines.join('\n')
}
