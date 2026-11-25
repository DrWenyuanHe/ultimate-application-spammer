// Command-line entry points. Workspace data is only read or changed through `op` (see
// operations.mjs). The other commands look after the app itself: setup, health, dashboard, updates.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { APP_DIR, CODE_ROOT, dataDir, rootDir } from './paths.mjs'
import { uniquePath } from './archive.mjs'
import { briefReport, runDoctor } from './doctor.mjs'
import { runSetup } from './setup.mjs'
import { applyUpdate, checkForUpdate, convertToGit, pinLatestRelease, readState, rollback, snooze } from './update.mjs'
import { describeOperation, listOperations, runOperation } from './operations.mjs'

const HELP = `Ultimate Application Spammer (node app/cli.mjs <command>)

Workspace data (the only way agents read or change it)
  op list                               Every operation with a one-line summary
  op describe NAME                      Inputs, required fields and an example
  op run NAME --file INPUT.json         Run it (or --input '<json>' or --stdin)
                                        Prints { ok, op, result } or { ok:false, op, error }

The app itself
  doctor [--brief] [--offline]          Health check (runs automatically at session start)
  setup [--no-demo] [--convert-zip]     First-run setup / repair (safe to re-run)
  start [--demo] [--no-open] [--port N] Start or reuse the dashboard and open it
  stop [--demo] [--port N]              Stop the dashboard
  update check [--force]                Look for a newer release (cached for a day)
  update apply [--version vX.Y.Z]       Install it (backs up the database first)
  update snooze [--days 7]              Don't ask about this release for a while
  update rollback                       Go back to the previous release
  update status
  version
`

// Flags that take no value. Every other flag requires one.
const BOOLEAN_FLAGS = new Set(['brief', 'offline', 'noDemo', 'convertZip', 'demo', 'noOpen', 'force', 'allowBranch', 'help', 'stdin'])

export function parse(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [raw, inline] = a.slice(2).split(/=(.*)/s)
      const key = raw.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      if (BOOLEAN_FLAGS.has(key)) { flags[key] = true; continue }
      const value = inline !== undefined ? inline : argv[i + 1]
      if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new Error(`--${raw} needs a value`)
      flags[key] = value
      if (inline === undefined) i++
    } else positional.push(a)
  }
  return { positional, flags }
}

const print = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))

async function health(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
    return res.ok ? await res.json() : null
  } catch { return null }
}

const sameRoot = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
const ours = (h, demo) => h?.app === 'ultimate-application-spammer' && sameRoot(h.root || '', rootDir()) && Boolean(h.demo) === demo

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

async function start(flags) {
  const demo = Boolean(flags.demo)
  const port = Number(flags.port) || Number(process.env.PORT) || (demo ? 4322 : 4321)
  const url = `http://127.0.0.1:${port}`
  let running = await health(port)
  if (running && !ours(running, demo)) {
    throw new Error(`Port ${port} is already used by ${running.app === 'ultimate-application-spammer' ? `another workspace (${running.root}${running.demo ? ', demo' : ''})` : 'another program'}. Use --port to pick another.`)
  }
  if (!running) {
    const logs = path.join(dataDir(), 'logs')
    fs.mkdirSync(logs, { recursive: true })
    const logFile = uniquePath(logs, `dashboard ${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
    const out = fs.openSync(logFile, 'a')
    const child = spawn(process.execPath, [path.join(APP_DIR, 'server.mjs'), ...(demo ? ['--demo'] : [])], {
      cwd: rootDir(), env: { ...process.env, PORT: String(port) }, detached: true, stdio: ['ignore', out, out], windowsHide: true,
    })
    child.unref()
    for (let i = 0; i < 40 && !ours(running, demo); i++) {
      await new Promise((r) => setTimeout(r, 250))
      running = await health(port)
    }
    if (!ours(running, demo)) throw new Error(`The dashboard did not start. Details are in ${logFile}`)
  }
  if (!flags.noOpen) openBrowser(url)
  return { url, demo, revision: running.revision }
}

async function stop(flags) {
  const demo = Boolean(flags.demo)
  const port = Number(flags.port) || Number(process.env.PORT) || (demo ? 4322 : 4321)
  const running = await health(port)
  if (!ours(running, demo)) return { stopped: false, message: 'No dashboard for this workspace is running on that port.' }
  await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
  for (let i = 0; i < 20 && (await health(port)); i++) await new Promise((r) => setTimeout(r, 250))
  return { stopped: !(await health(port)) }
}

/** Restart dashboards that an update stopped, using the newly installed code. */
function restartAfterUpdate(stopped) {
  return stopped.map((d) => {
    const r = spawnSync(process.execPath, [path.join(APP_DIR, 'cli.mjs'), 'start', '--no-open', '--port', String(d.port), ...(d.demo ? ['--demo'] : [])], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    return { port: d.port, restarted: r.status === 0 }
  })
}

/** Ports a dashboard for this workspace may be using (defaults plus the last recorded ports). */
export function knownPorts() {
  const ports = new Set([Number(process.env.PORT) || 4321, 4321])
  for (const name of ['dashboard.json', 'dashboard-demo.json']) {
    try { ports.add(Number(JSON.parse(fs.readFileSync(path.join(dataDir(), name), 'utf8')).port)) } catch {}
  }
  return [...ports].filter((p) => Number.isInteger(p) && p > 0)
}

async function readInput(flags) {
  if (flags.file) return JSON.parse(fs.readFileSync(path.resolve(flags.file), 'utf8'))
  if (flags.input) return JSON.parse(flags.input)
  if (flags.stdin) {
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  }
  return {}
}

export async function main(argv) {
  let parsed
  try { parsed = parse(argv) } catch (error) {
    if (argv[0] === 'op' && argv[1] === 'run') {
      print({ ok: false, op: argv[2] || null, error: { status: 400, message: error.message } })
      process.exitCode = 1
      return
    }
    throw error
  }
  const { positional: [cmd, sub, arg], flags } = parsed
  switch (cmd) {
    case undefined: case 'help': return print(HELP)

    case 'op': {
      if (sub === 'list' || sub === undefined) return print(listOperations())
      if (sub === 'describe') return print(describeOperation(arg))
      if (sub === 'run') {
        let input
        try { input = await readInput(flags) } catch (error) {
          print({ ok: false, op: arg, error: { status: 400, message: `Could not read the input JSON: ${error.message}` } })
          process.exitCode = 1
          return
        }
        if (arg === 'backup.restore') {
          for (const port of knownPorts()) {
            if (ours(await health(port), false)) {
              print({ ok: false, op: arg, error: { status: 409, message: 'Close the dashboard first (run: node app/cli.mjs stop), then restore.' } })
              process.exitCode = 1
              return
            }
          }
        }
        const envelope = await runOperation(arg, input)
        print(envelope)
        if (!envelope.ok) process.exitCode = 1
        return
      }
      break
    }

    case 'doctor': {
      const report = await runDoctor({ network: !flags.offline })
      return print(flags.brief ? briefReport(report) : report)
    }

    case 'setup': {
      const out = {}
      if (flags.convertZip) {
        const pkg = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, 'package.json'), 'utf8'))
        out.git = convertToGit({ remote: pkg.repository?.url })
      } else {
        out.release = pinLatestRelease()
      }
      Object.assign(out, runSetup({ demo: !flags.noDemo }))
      return print(out)
    }

    case 'start': return print(await start(flags))
    case 'stop': return print(await stop(flags))

    case 'update': {
      if (sub === 'check' || sub === undefined) return print(checkForUpdate({ force: Boolean(flags.force) }))
      if (sub === 'apply') {
        const report = await applyUpdate({ version: flags.version, allowBranch: Boolean(flags.allowBranch) })
        if (report.restartDashboard) report.dashboard = restartAfterUpdate(report.stoppedDashboards)
        return print(report)
      }
      if (sub === 'snooze') return print(snooze({ days: Number(flags.days) || 7 }))
      if (sub === 'rollback') {
        const report = await rollback()
        if (report.restartDashboard) report.dashboard = restartAfterUpdate(report.stoppedDashboards)
        return print(report)
      }
      if (sub === 'status') return print(readState())
      break
    }

    case 'version': return print(JSON.parse(fs.readFileSync(path.join(CODE_ROOT, 'package.json'), 'utf8')).version)
  }
  throw new Error(`Unknown command: ${argv.join(' ')}\n\n${HELP}`)
}
