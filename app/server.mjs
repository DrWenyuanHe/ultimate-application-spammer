// Local dashboard server: static UI plus a JSON API over the SQLite store. Loopback only.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { APP_DIR, dataDir, folder, rootDir } from './lib/paths.mjs'
import { openStore, StoreError } from './lib/store.mjs'
import { cachedUpdateStatus, currentVersion } from './lib/update.mjs'
import { listBackups, snapshotIfDue } from './lib/backup.mjs'
import { storageReport } from './lib/storage.mjs'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' }
const MAX_BODY = 2 * 1024 * 1024

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new StoreError(413, 'Request is too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new StoreError(400, 'Request body must be JSON') }
}

async function serveStatic(res, url) {
  const notFound = () => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found') }
  const uiDir = fs.realpathSync(path.join(APP_DIR, 'ui'))
  let urlPath
  try { urlPath = decodeURIComponent(url.pathname) } catch { return notFound() }
  const candidate = path.resolve(uiDir, '.' + (urlPath === '/' ? '/index.html' : urlPath))
  let file
  try { file = fs.realpathSync(candidate) } catch { return notFound() }
  const rel = path.relative(uiDir, file)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(file).isFile()) return notFound()
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
  try { await pipeline(fs.createReadStream(file), res) } catch { res.destroy() }
}

// The browser only needs to know whether private questions were answered, never the answers.
const PRIVATE_QUESTION = /gender|sex\b|pronoun|disabilit|indigenous|aboriginal|racial|race\b|ethnic|visible minorit|2slgbt|lgbt|sexual orientation|veteran|criminal|convict|offen[cs]e|pardon|record suspension|accommodat|medical|health condition|religio|marital|date of birth|\bage\b|social insurance|\bsin\b|salary|compensation|pay\b|reference/i

export function forDashboard(snapshot) {
  const bank = snapshot.screeningAnswers
  const answered = (a) => !(a === undefined || a === null || a === '' || (Array.isArray(a) && !a.length))
  const screeningAnswers = bank && {
    ...bank,
    questions: bank.questions.map(({ answer, ...q }) => ({ ...q, answered: answered(answer) && !q.usingDefault, ...(q.sensitive || q.voluntary || PRIVATE_QUESTION.test(q.question) ? {} : { answer }) })),
    custom: (bank.custom || []).map(({ answer, ...c }) => ({ ...c, answered: answered(answer) })),
  }
  const submissions = (snapshot.submissions || []).map((s) => ({
    ...s,
    answers: (s.answers || []).map((a) => (a.sensitive || a.private || PRIVATE_QUESTION.test(String(a.question)) ? { question: a.question, private: true, answered: answered(a.answer) } : a)),
  }))
  return { ...snapshot, screeningAnswers, submissions }
}

export function createServer({ demo = false } = {}) {
  const store = openStore({ demo })
  const meta = () => ({ version: currentVersion(), demo, root: rootDir() })
  if (!demo) {
    try { snapshotIfDue({ reason: 'daily' }) } catch (error) { console.error(`Backup skipped: ${error.message}`) }
  }
  let server

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1) // drop "api"
    const method = req.method
    const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readBody(req) : {}
    const route = `${method} /${parts.join('/')}`
    const id = parts[1]

    if (route === 'GET /health') return send(res, 200, { status: 'ok', app: 'ultimate-application-spammer', version: currentVersion(), root: rootDir(), storage: 'sqlite', revision: store.revision(), demo })
    if (route === 'POST /shutdown') {
      send(res, 200, { stopping: true })
      setTimeout(() => server.close(() => process.exitCode = 0), 50)
      return
    }
    if (route === 'GET /state') {
      const since = Number(url.searchParams.get('since'))
      const revision = store.revision()
      if (since && since === revision) return send(res, 200, { unchanged: true, revision })
      return send(res, 200, { ...forDashboard(store.snapshot()), meta: meta() })
    }
    // The dashboard only displays information. Every change is made by the person's assistant
    // through `node app/cli.mjs op run ...` (see app/lib/operations.mjs).
    if (route === 'GET /update') return send(res, 200, cachedUpdateStatus())
    if (route === 'GET /guides/employers') return send(res, 200, JSON.parse(fs.readFileSync(path.join(APP_DIR, 'guides', 'employers-by-sector.json'), 'utf8')))
    if (route === 'GET /storage') return send(res, 200, demo ? { demo: true, items: [] } : storageReport())
    if (route === 'GET /backups') return send(res, 200, demo ? [] : listBackups())
    if (method === 'GET' && parts[0] === 'jobs' && id && parts[2] === 'history') return send(res, 200, store.history('application', id))
    if (method === 'GET' && parts[0] === 'materials' && id) return send(res, 200, store.material(id, url.searchParams.get('version')))
    throw new StoreError(404, `No API route ${route}`)
  }

  server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || '')
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new StoreError(403, 'This dashboard only answers on 127.0.0.1')
      let url
      try { url = new URL(req.url, `http://${host}`) } catch { throw new StoreError(400, 'Bad request') }
      if (url.pathname.startsWith('/api/')) {
        const writing = !['GET', 'HEAD'].includes(req.method)
        if (writing && url.pathname !== '/api/shutdown') throw new StoreError(405, 'The dashboard is read-only. Ask your assistant to make changes.')
        const origin = req.headers.origin
        if (origin && origin !== `http://${host}`) throw new StoreError(403, 'Requests from other websites are not allowed')
        if (writing && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new StoreError(415, 'Send JSON with Content-Type: application/json')
        return await api(req, res, url)
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new StoreError(405, 'Method not allowed')
      await serveStatic(res, url)
    } catch (error) {
      const status = error instanceof StoreError ? error.status : 500
      if (status === 500) console.error(error)
      if (!res.headersSent) send(res, status, { error: error.message, details: error.details })
    }
  })
  // Record the port so restore and update can find this dashboard whichever port it uses.
  server.on('listening', () => {
    try {
      fs.mkdirSync(dataDir(), { recursive: true })
      fs.writeFileSync(path.join(dataDir(), demo ? 'dashboard-demo.json' : 'dashboard.json'), JSON.stringify({ port: server.address().port, pid: process.pid, startedAt: new Date().toISOString() }))
    } catch {}
  })
  server.on('close', () => store.close())
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = process.argv.includes('--demo')
  const port = Number(process.env.PORT) || (demo ? 4322 : 4321)
  createServer({ demo }).listen(port, '127.0.0.1', () => console.log(`Dashboard ready at http://127.0.0.1:${port}${demo ? ' (demo data)' : ''}`))
}
