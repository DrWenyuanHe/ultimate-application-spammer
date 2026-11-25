// Shared test helpers. Every test works in its own folder under the system temp directory;
// nothing here writes into the checkout and nothing is ever removed (temp folders are left behind).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const CLI = path.join(REPO, 'app', 'cli.mjs')

/** A new, empty folder such as %TEMP%/uas-test-store-<time>-<random>. */
export function tempDir(name) {
  const dir = path.join(os.tmpdir(), `uas-test-${name}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Point this test process at a fresh workspace. The app reads UAS_HOME lazily, so setting it
 * before the first call is enough. UAS_DB / UAS_DATA overrides from the caller's shell are ignored.
 */
export function isolate(name) {
  const home = tempDir(name)
  process.env.UAS_HOME = home
  for (const key of ['UAS_DB', 'UAS_DATA']) Reflect.deleteProperty(process.env, key)
  process.env.PORT = '9' // doctor/start probes hit a closed port instead of a real dashboard
  return home
}

// Variables that would point Git at the caller's repository or index instead of the fixture.
const GIT_SELECTORS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX']
const cleanEnv = () => { const env = { ...process.env }; for (const k of GIT_SELECTORS) Reflect.deleteProperty(env, k); return env }

/** Environment for a child process that must only see `home`. */
export function childEnv(home, extra = {}) {
  const env = { ...cleanEnv(), UAS_HOME: home, PORT: '9', ...extra }
  for (const key of ['UAS_DB', 'UAS_DATA']) if (!(key in extra)) Reflect.deleteProperty(env, key)
  return env
}

export function writeJson(dir, name, value) {
  const file = path.join(dir, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
  return file
}

/** Run a CLI (the checkout's by default) and capture its output. */
export function runCli(args, { home, cli = CLI, env = {}, cwd } = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: cwd || home || REPO, env: childEnv(home, env), encoding: 'utf8', timeout: 180000, windowsHide: true,
  })
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    json() {
      try { return JSON.parse(r.stdout) } catch { throw new Error(`CLI output was not JSON (exit ${r.status}).\nstdout: ${r.stdout}\nstderr: ${r.stderr}`) }
    },
  }
}

/** Like runCli, but without blocking this process (needed when this process also serves HTTP). */
export function runCliAsync(args, { home, cli = CLI, env = {}, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: cwd || home || REPO, env: childEnv(home, env), windowsHide: true })
    let stdout = '', stderr = ''
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    child.on('close', (status) => resolve({ status, stdout, stderr, json: () => JSON.parse(stdout) }))
  })
}

/** Git configuration isolated from the developer's global/system settings (no signing prompts, fixed identity). */
export function gitEnv(dir) {
  const config = path.join(dir, 'gitconfig')
  if (!fs.existsSync(config)) {
    fs.writeFileSync(config, '[user]\n\tname = Test Runner\n\temail = tests@example.com\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n[advice]\n\tdetachedHead = false\n')
  }
  return { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }
}

export function hasGit() {
  return spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0
}

export function git(args, { cwd, env }) {
  const r = spawnSync('git', args, { cwd, env: { ...cleanEnv(), ...env }, encoding: 'utf8', windowsHide: true, timeout: 120000 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr || r.stdout}`)
  return (r.stdout || '').trim()
}

/** Copy the app's code (not app/data or tests) into `dest` so a fixture repo runs the real code. */
export function copyCode(dest) {
  const skip = new Set([path.join(REPO, 'app', 'data'), path.join(REPO, 'app', 'tests')])
  fs.cpSync(path.join(REPO, 'app'), path.join(dest, 'app'), {
    recursive: true, errorOnExist: true, force: false,
    filter: (src) => ![...skip].some((s) => src === s || src.startsWith(s + path.sep)),
  })
  for (const f of ['package.json', '.gitignore']) fs.copyFileSync(path.join(REPO, f), path.join(dest, f), fs.constants.COPYFILE_EXCL)
}

/** A Git checkout of the current code in a temp folder (on branch main), for doctor/install checks. */
export function makeCodeRepo(name) {
  const base = tempDir(name)
  const repo = path.join(base, 'code')
  fs.mkdirSync(repo)
  copyCode(repo)
  const env = gitEnv(base)
  git(['init', '--quiet'], { cwd: repo, env })
  assertFixtureRepo(repo, env)
  git(['add', '-A'], { cwd: repo, env })
  git(['commit', '--quiet', '-m', 'fixture'], { cwd: repo, env })
  return { base, repo, env, cli: path.join(repo, 'app', 'cli.mjs') }
}

/** Refuse to mutate anything unless Git resolves to the fixture's own repository. */
export function assertFixtureRepo(repo, env) {
  const top = path.resolve(git(['rev-parse', '--show-toplevel'], { cwd: repo, env }))
  if (top.toLowerCase() !== path.resolve(repo).toLowerCase()) throw new Error(`Git resolved ${top}, not the fixture ${repo}`)
}

/** Minimal valid application input. */
export function job(overrides = {}) {
  return {
    company: 'Maple Analytics',
    title: 'Data Scientist',
    location: 'Springfield',
    sourceUrl: 'https://boards.greenhouse.io/mapleanalytics/jobs/1001',
    ...overrides,
  }
}
