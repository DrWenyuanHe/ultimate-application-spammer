// The dashboard server is read-only: GET endpoints plus POST /api/shutdown. Every change goes
// through the operation layer, so these tests also prove that no other method can write.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { isolate, job, tempDir } from './helpers.mjs'

const home = isolate('server')
const { createServer } = await import('../server.mjs')
const { openStore } = await import('../lib/store.mjs')

let server, port, appId, materialId, claimToken
before(async () => {
  const s = openStore({ allowNew: true })
  s.seedStarterRules()
  const app = s.addApplication(job())
  s.updateApplication(app.id, { stage: 'Preparing' })
  appId = app.id
  const m = s.saveMaterial({ kind: 'resume', title: 'Base', content: 'first' })
  s.saveMaterial({ kind: 'resume', title: 'Base', content: 'second' }, { id: m.id })
  materialId = m.id
  s.queueResearch({ query: 'claimed task' })
  claimToken = s.claimResearch({ worker: 'test' }).claimToken
  s.close()
  server = await listen(createServer())
  port = server.address().port
})
after(() => new Promise((resolve) => server.close(resolve)))

async function listen(srv) {
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  return srv
}

/** Raw HTTP request (lets tests set Host/Origin/Content-Type and send un-normalised paths). */
function request(method, rawPath, { body, headers = {}, to = port } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const req = http.request({
      host: '127.0.0.1', port: to, method, path: rawPath,
      headers: { host: `127.0.0.1:${to}`, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try { json = JSON.parse(text) } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

test('health identifies the app and its workspace; state supports "unchanged since"', async () => {
  const h = await request('GET', '/api/health')
  assert.equal(h.status, 200)
  assert.equal(h.json.app, 'ultimate-application-spammer')
  assert.equal(h.json.root, home)
  assert.match(h.json.version, /^\d+\.\d+\.\d+$/)
  assert.equal(h.json.demo, false)
  const s = await request('GET', '/api/state')
  assert.equal(s.status, 200)
  assert.equal(s.json.meta.root, home, 'the server uses the isolated workspace')
  assert.equal(s.json.applications.find((a) => a.id === appId).stage, 'Preparing')
  assert.equal(s.json.counts.Preparing, 1)
  assert.ok(s.json.screeningAnswers && s.json.experienceStrength)
  assert.equal(s.json.researchTasks.length, 1)
  assert.equal(s.json.researchTasks[0].status, 'claimed')
  assert.equal(s.json.researchTasks[0].claimToken, undefined)
  assert.ok(!s.text.includes(claimToken), 'the claim token appears nowhere in the dashboard state')
  const same = await request('GET', `/api/state?since=${s.json.revision}`)
  assert.deepEqual(same.json, { unchanged: true, revision: s.json.revision })
})

test('state reflects changes made through the operation layer while the server runs', async () => {
  const { runOperation } = await import('../lib/operations.mjs')
  const before = (await request('GET', '/api/state')).json.revision
  const r = await runOperation('jobs.add', { job: job({ sourceUrl: 'https://example.com/jobs/live' }) })
  assert.equal(r.ok, true)
  const after = await request('GET', `/api/state?since=${before}`)
  assert.ok(after.json.revision > before)
  assert.ok(after.json.applications.some((a) => a.id === r.result.id))
})

test('GET endpoints: history, material versions, guides, storage, backups', async () => {
  const history = await request('GET', `/api/jobs/${appId}/history`)
  assert.deepEqual(history.json.map((v) => v.stage), ['Review', 'Preparing'])
  assert.equal((await request('GET', `/api/materials/${materialId}?version=1`)).json.content, 'first')
  assert.equal((await request('GET', `/api/materials/${materialId}`)).json.content, 'second')
  assert.equal((await request('GET', '/api/materials/missing')).status, 404)
  const guides = await request('GET', '/api/guides/employers')
  assert.equal(guides.status, 200)
  assert.ok(Array.isArray(guides.json.sectors))
  const backups = await request('GET', '/api/backups')
  assert.equal(backups.json.length, 1, 'starting the real dashboard takes a daily backup')
  assert.match(backups.json[0].name, /daily\.sqlite$/)
  const storage = await request('GET', '/api/storage')
  assert.ok(storage.json.items.some((i) => i.label === 'Database backups' && i.files === 1))
  assert.equal((await request('GET', '/api/nope')).status, 404)
})

test('the API is read-only: every write method on every path is 405 and changes nothing', async () => {
  const before = (await request('GET', '/api/state')).json.revision
  const attempts = [
    ['POST', '/api/applications', job({ sourceUrl: 'https://example.com/jobs/write' })],
    ['POST', '/api/jobs', { job: job({ sourceUrl: 'https://example.com/jobs/write2' }) }],
    ['PATCH', `/api/applications/${appId}`, { patch: { stage: 'Offer' } }],
    ['PATCH', `/api/jobs/${appId}`, { patch: { stage: 'Offer' } }],
    ['PUT', `/api/jobs/${appId}`, {}],
    ['DELETE', `/api/jobs/${appId}`, {}],
    ['POST', '/api/profile', { name: 'Intruder' }],
    ['POST', '/api/answers', { answers: {} }],
    ['POST', '/api/backups', {}],
    ['POST', '/api/export', {}],
    ['POST', '/api/rules/x/approve', { version: 1 }],
    ['POST', '/api/op/jobs.add', { job: job() }],
  ]
  for (const [method, p, body] of attempts) {
    const r = await request(method, p, { body })
    assert.equal(r.status, 405, `${method} ${p}`)
  }
  assert.equal((await request('POST', '/api/applications', { body: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 405)
  assert.equal((await request('POST', '/index.html')).status, 405)
  assert.equal((await request('GET', '/api/state')).json.revision, before)
  assert.equal((await request('GET', '/api/backups')).json.length, 1)
})

test('foreign Host headers (DNS rebinding) and cross-origin reads are rejected', async () => {
  assert.equal((await request('GET', '/api/state', { headers: { host: 'attacker.example' } })).status, 403)
  assert.equal((await request('GET', '/api/state', { headers: { host: `attacker.example:${port}` } })).status, 403)
  assert.equal((await request('GET', '/api/state', { headers: { origin: 'https://evil.example' } })).status, 403)
  assert.equal((await request('GET', '/api/state', { headers: { origin: `http://localhost:${port}` } })).status, 403, 'exact origin only')
  assert.equal((await request('GET', '/api/state', { headers: { origin: `http://127.0.0.1:${port}` } })).status, 200)
  assert.equal((await request('GET', '/api/health', { headers: { host: `localhost:${port}`, origin: `http://localhost:${port}` } })).status, 200)
})

const hasUi = fs.existsSync(new URL('../ui/index.html', import.meta.url))

test('static UI: / returns the dashboard HTML with nosniff', { skip: !hasUi && 'app/ui/index.html not present yet' }, async () => {
  const r = await request('GET', '/')
  assert.equal(r.status, 200)
  assert.match(r.headers['content-type'], /text\/html/)
  assert.equal(r.headers['x-content-type-options'], 'nosniff')
  assert.match(r.text, /<html/i)
  assert.equal((await request('HEAD', '/')).status, 200)
})

test('static UI: path traversal outside app/ui is blocked', async () => {
  for (const p of ['/../package.json', '/..%2f..%2fpackage.json', '/..%5c..%5cpackage.json', '/%2e%2e/%2e%2e/package.json', '/..%2fserver.mjs', '/..%2f..%2fapp%2fdata%2fworkspace.sqlite', '/%00', '/C:%5cWindows%5cwin.ini']) {
    const r = await request('GET', p)
    assert.equal(r.status, 404, p)
    assert.ok(!r.text.includes('"name": "ultimate-application-spammer"'), p)
  }
})

test('a malformed percent-encoded path is a client error, not a server crash', async () => {
  const r = await request('GET', '/%E0%A4%A')
  assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`)
})

test('demo mode serves the demo workspace, takes no backup and reports none', async () => {
  // a workspace with a real database but no backups yet, so a mistaken daily snapshot would show
  const demoHome = tempDir('server-demo')
  const previous = process.env.UAS_HOME
  process.env.UAS_HOME = demoHome
  let demo
  try {
    const real = openStore({ allowNew: true })
    real.addApplication(job({ company: 'Real Co', sourceUrl: 'https://example.com/jobs/real' }))
    real.close()
    const s = openStore({ demo: true })
    s.addApplication(job({ company: 'Demo Co', sourceUrl: 'https://example.com/jobs/demo' }))
    s.close()
    const backups = path.join(demoHome, 'app', 'data', 'backups')
    demo = await listen(createServer({ demo: true }))
    const to = demo.address().port
    assert.equal((await request('GET', '/api/health', { to })).json.demo, true)
    const state = (await request('GET', '/api/state', { to })).json
    assert.deepEqual(state.applications.map((a) => a.company), ['Demo Co'], 'only the demo workspace is shown')
    assert.deepEqual((await request('GET', '/api/backups', { to })).json, [])
    assert.equal((await request('GET', '/api/storage', { to })).json.demo, true)
    assert.ok(!fs.existsSync(backups) || fs.readdirSync(backups).length === 0, 'starting the demo took no backup')
  } finally {
    if (demo) await new Promise((resolve) => demo.close(resolve))
    process.env.UAS_HOME = previous
  }
})

test('POST /api/shutdown stops the server; it needs same-origin JSON', async () => {
  const extra = await listen(createServer())
  const to = extra.address().port
  const closed = new Promise((resolve) => extra.on('close', resolve))
  assert.equal((await request('POST', '/api/shutdown', { body: {}, to, headers: { origin: 'https://evil.example' } })).status, 403)
  assert.equal((await request('POST', '/api/shutdown', { body: 'x', to, headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await request('GET', '/api/health', { to })).status, 200, 'still running after refused shutdowns')
  const r = await request('POST', '/api/shutdown', { body: {}, to })
  assert.deepEqual(r.json, { stopping: true })
  await closed
  process.exitCode = undefined // the handler marks a clean exit for the real process
  await assert.rejects(request('GET', '/api/health', { to }))
})
