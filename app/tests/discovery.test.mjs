import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLATFORMS, boardFromUrl, discover, discoverEmployer, parseJobBankFeed, workdayPostedDate,
} from '../lib/discovery.mjs'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'discovery')
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8')

/** A fetch stand-in: `route(url, init)` returns a body string/object, { status, body }, or throws. No network. */
function fakeFetch(route) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const out = await route(String(url), init, calls.length - 1)
    const { status = 200, body = '' } = out && typeof out === 'object' && 'status' in out ? out : { body: out }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }
  impl.calls = calls
  return impl
}

const API_HOSTS = /boards-api\.greenhouse\.io|api(\.eu)?\.lever\.co|api\.ashbyhq\.com|api\.smartrecruiters\.com|\/wday\/cxs\/|jobSearchRSSfeed/

function assertCandidateShape(c) {
  for (const key of ['company', 'title', 'sourceUrl', 'platform']) assert.ok(c[key], `candidate missing ${key}: ${JSON.stringify(c)}`)
  assert.match(c.sourceUrl, /^https:\/\//)
  assert.doesNotMatch(c.sourceUrl, API_HOSTS, 'sourceUrl must be the human posting page, not an API URL')
  assert.ok(!('_keywordText' in c) && !('_locationText' in c), 'internal fields must not leak')
}

describe('boardFromUrl', () => {
  const cases = [
    ['https://boards.greenhouse.io/acme', { platform: 'greenhouse', board: 'acme' }],
    ['https://job-boards.greenhouse.io/acme/jobs/123', { platform: 'greenhouse', board: 'acme' }],
    ['boards.greenhouse.io/embed/job_board?for=acme', { platform: 'greenhouse', board: 'acme' }],
    ['https://boards-api.greenhouse.io/v1/boards/acme/jobs', { platform: 'greenhouse', board: 'acme' }],
    ['https://jobs.lever.co/acme', { platform: 'lever', board: 'acme' }],
    ['https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555?lever-source=x', { platform: 'lever', board: 'acme' }],
    ['https://jobs.eu.lever.co/acme', { platform: 'lever', board: 'acme', region: 'eu' }],
    ['https://jobs.ashbyhq.com/acme', { platform: 'ashby', board: 'acme' }],
    ['https://jobs.ashbyhq.com/Acme%20Co', { platform: 'ashby', board: 'Acme Co' }],
    ['https://job-boards.eu.greenhouse.io/acme', { platform: 'greenhouse', board: 'acme', region: 'eu' }],
    ['https://acme.wd1.myworkdayjobs.com/US', { platform: 'workday', host: 'acme.wd1.myworkdayjobs.com', tenant: 'acme', site: 'US' }],
    ['https://acme.wd1.myworkdayjobs.com/US/job/Place/Role_R1', { platform: 'workday', host: 'acme.wd1.myworkdayjobs.com', tenant: 'acme', site: 'US' }],
    ['https://acme.wd1.myworkdayjobs.com/fr/External', { platform: 'workday', host: 'acme.wd1.myworkdayjobs.com', tenant: 'acme', site: 'External' }],
    ['https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=cook&locationstring=Toronto&mid=22437&d=50', { platform: 'jobbank', keyword: 'cook', jobBankArea: { mid: '22437', d: '50' } }],
    ['https://careers.smartrecruiters.com/Acme', { platform: 'smartrecruiters', board: 'Acme' }],
    ['https://jobs.smartrecruiters.com/Acme/744000000000001-research-scientist', { platform: 'smartrecruiters', board: 'Acme' }],
    ['https://acme.wd3.myworkdayjobs.com/en-US/External', { platform: 'workday', host: 'acme.wd3.myworkdayjobs.com', tenant: 'acme', site: 'External' }],
    ['https://acme.wd3.myworkdayjobs.com/External/job/Canada-Toronto/Scientist_R1', { platform: 'workday', host: 'acme.wd3.myworkdayjobs.com', tenant: 'acme', site: 'External' }],
    ['https://acme.wd5.myworkdayjobs.com/fr-CA/Careers', { platform: 'workday', host: 'acme.wd5.myworkdayjobs.com', tenant: 'acme', site: 'Careers' }],
    ['https://wd3.myworkdaysite.com/en-US/recruiting/acme/Jobs', { platform: 'workday', host: 'wd3.myworkdaysite.com', tenant: 'acme', site: 'Jobs' }],
    ['https://acme.wd3.myworkdayjobs.com/', null],
    ['https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=chemist&fprov=ON', { platform: 'jobbank', keyword: 'chemist', location: 'ON' }],
    ['https://example.com/careers', null],
    ['https://acme.icims.com/jobs', null],
    ['not a url at all', null],
    ['', null],
    [undefined, null],
    ['ftp://boards.greenhouse.io/acme', null],
  ]
  for (const [input, expected] of cases) {
    test(`${input} -> ${expected ? expected.platform : 'null'}`, () => assert.deepEqual(boardFromUrl(input), expected))
  }
})

describe('per-platform normalisation', () => {
  test('greenhouse', async () => {
    const fetchImpl = fakeFetch(() => fixture('greenhouse-jobs.json'))
    const result = await discover({ platform: 'greenhouse', board: 'northwindlabs', fetchImpl })
    assert.equal(fetchImpl.calls[0].url, 'https://boards-api.greenhouse.io/v1/boards/northwindlabs/jobs?content=false')
    assert.equal(fetchImpl.calls[0].init.headers['User-Agent'], 'ultimate-application-spammer (job search helper)')
    assert.deepEqual(result.source, { platform: 'greenhouse', board: 'northwindlabs' })
    assert.equal(result.candidates.length, 3)
    result.candidates.forEach(assertCandidateShape)
    assert.deepEqual(result.candidates[0], {
      company: 'Northwind Labs', title: 'Research Scientist, Protein Design', location: 'Toronto, Ontario, Canada',
      sourceUrl: 'https://job-boards.greenhouse.io/northwindlabs/jobs/4001001', requisition: 'NW-101',
      postedAt: '2026-11-18T14:30:00.000Z', updatedAt: '2026-11-20T15:00:00.000Z', platform: 'greenhouse',
    })
    assert.equal(result.candidates[1].postedAt, undefined, 'an update time is not a publication date')
    // Employer-hosted absolute_url is kept; missing requisition falls back to the job id.
    assert.equal(result.candidates[1].sourceUrl, 'https://northwindlabs.example/careers?gh_jid=4001002')
    assert.equal(result.candidates[1].requisition, '4001002')
    assert.equal(result.candidates[1].remote, true)
    assert.equal(result.diagnostics.pagesFetched, 1)
    assert.equal(result.diagnostics.totalSeen, 3)
    assert.equal(result.diagnostics.truncated, false)
    assert.equal(result.diagnostics.complete, true)
    assert.match(result.diagnostics.note, /does not prove that no suitable jobs exist/)
    assert.ok(!Number.isNaN(Date.parse(result.fetchedAt)))
  })

  test('lever', async () => {
    const fetchImpl = fakeFetch(() => fixture('lever-postings.json'))
    const result = await discover({ platform: 'lever', board: 'contosorobotics', company: 'Contoso Robotics', fetchImpl })
    assert.equal(fetchImpl.calls[0].url, 'https://api.lever.co/v0/postings/contosorobotics?mode=json&limit=100&skip=0')
    result.candidates.forEach(assertCandidateShape)
    const [ml, ap] = result.candidates
    assert.equal(ml.company, 'Contoso Robotics')
    assert.equal(ml.title, 'Machine Learning Scientist')
    assert.equal(ml.location, 'Vancouver, BC')
    assert.equal(ml.sourceUrl, 'https://jobs.lever.co/contosorobotics/11111111-2222-3333-4444-555555555555')
    assert.equal(ml.requisition, '11111111-2222-3333-4444-555555555555')
    assert.equal(ml.postedAt, new Date(1795000000000).toISOString())
    assert.equal(ml.employmentType, 'Full-time')
    assert.equal(ml.remote, false)
    assert.ok(ml.excerpt.startsWith('Contoso Robotics builds'))
    assert.equal(ap.remote, true)
    assert.equal(ap.employmentType, 'Contract')
  })

  test('lever EU accounts use the EU API host', async () => {
    const fetchImpl = fakeFetch(() => '[]')
    await discover({ ...boardFromUrl('https://jobs.eu.lever.co/acme'), fetchImpl })
    assert.match(fetchImpl.calls[0].url, /^https:\/\/api\.eu\.lever\.co\/v0\/postings\/acme\?/)
  })

  test('ashby skips unlisted jobs', async () => {
    const fetchImpl = fakeFetch(() => fixture('ashby-board.json'))
    const result = await discover({ platform: 'ashby', board: 'fabrikambio', company: 'Fabrikam Bio', fetchImpl })
    assert.equal(fetchImpl.calls[0].url, 'https://api.ashbyhq.com/posting-api/job-board/fabrikambio?includeCompensation=false')
    assert.deepEqual(result.candidates.map((c) => c.title), ['Computational Chemist', 'Lab Technician'])
    result.candidates.forEach(assertCandidateShape)
    const chem = result.candidates[0]
    assert.equal(chem.sourceUrl, 'https://jobs.ashbyhq.com/fabrikambio/aaaaaaaa-0000-4000-8000-000000000001')
    assert.equal(chem.location, 'Ottawa, ON; Remote - Canada')
    assert.equal(chem.employmentType, 'Full-time')
    assert.equal(chem.remote, false)
    assert.equal(chem.postedAt, '2026-11-10T14:29:08.532Z')
    assert.equal(result.candidates[1].employmentType, 'Internship')
    assert.equal(result.candidates[1].remote, true)
  })

  test('smartrecruiters builds the public posting link', async () => {
    const fetchImpl = fakeFetch(() => fixture('smartrecruiters-postings.json'))
    const result = await discover({ platform: 'smartrecruiters', board: 'TailspinHealth', fetchImpl })
    assert.equal(fetchImpl.calls[0].url, 'https://api.smartrecruiters.com/v1/companies/TailspinHealth/postings?limit=100&offset=0')
    result.candidates.forEach(assertCandidateShape)
    const [bio, support] = result.candidates
    assert.equal(bio.company, 'Tailspin Health')
    assert.equal(bio.sourceUrl, 'https://jobs.smartrecruiters.com/TailspinHealth/744000000000001')
    assert.equal(bio.requisition, 'REF1001T')
    assert.equal(bio.employmentType, 'Full-time')
    assert.equal(bio.location, 'Halifax, NS, Canada (Hybrid)')
    assert.equal(support.requisition, '744000000000002')
    assert.equal(support.remote, true)
    assert.equal(result.diagnostics.totalReported, 2)
    assert.equal(fetchImpl.calls.length, 1, 'stops when totalFound is reached')
  })

  test('workday posts searchText and builds posting links', async () => {
    const fetchImpl = fakeFetch(() => fixture('workday-page0.json'))
    const result = await discover({
      platform: 'workday', host: 'globex.wd3.myworkdayjobs.com', tenant: 'globex', site: 'GlobexCareers',
      keyword: 'research scientist', company: 'Globex', fetchImpl,
    })
    const call = fetchImpl.calls[0]
    assert.equal(call.url, 'https://globex.wd3.myworkdayjobs.com/wday/cxs/globex/GlobexCareers/jobs')
    assert.equal(call.init.method, 'POST')
    assert.deepEqual(JSON.parse(call.init.body), { appliedFacets: {}, limit: 20, offset: 0, searchText: 'research scientist' })
    assert.equal(call.init.headers['Content-Type'], 'application/json')
    result.candidates.forEach(assertCandidateShape)
    const [a, b, c] = result.candidates
    assert.equal(a.sourceUrl, 'https://globex.wd3.myworkdayjobs.com/GlobexCareers/job/Canada-Toronto-King-Street/Senior-Research-Scientist_R0012345')
    assert.equal(a.requisition, 'R0012345')
    assert.equal(a.postedAt, result.fetchedAt.slice(0, 10))
    assert.equal(a.postedText, 'Posted Today')
    assert.equal(b.location, '2 Locations (including Canada Montreal Campus)')
    assert.equal(c.requisition, 'R0012347', 'requisition falls back to the path suffix')
    assert.equal(c.postedAt, undefined)
    assert.equal(c.remote, true)
    assert.deepEqual(result.source, { platform: 'workday', host: 'globex.wd3.myworkdayjobs.com', tenant: 'globex', site: 'GlobexCareers', keyword: 'research scientist' })
  })

  test('workday on myworkdaysite.com keeps the /recruiting path', async () => {
    const fetchImpl = fakeFetch(() => fixture('workday-page0.json'))
    const result = await discover({ ...boardFromUrl('https://wd3.myworkdaysite.com/recruiting/globex/Jobs'), fetchImpl })
    assert.equal(fetchImpl.calls[0].url, 'https://wd3.myworkdaysite.com/wday/cxs/globex/Jobs/jobs')
    assert.match(result.candidates[0].sourceUrl, /^https:\/\/wd3\.myworkdaysite\.com\/recruiting\/globex\/Jobs\/job\//)
  })

  test('jobbank parses CDATA and entity-escaped entries', async () => {
    const fetchImpl = fakeFetch((url, init, i) => (i === 0 ? fixture('jobbank-feed.xml') : fixture('jobbank-empty.xml')))
    const result = await discover({ platform: 'jobbank', keyword: 'chemist', fetchImpl })
    assert.equal(fetchImpl.calls[0].url, 'https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed?searchstring=chemist')
    assert.equal(fetchImpl.calls[1].url, 'https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed?searchstring=chemist&page=2')
    assert.equal(result.candidates.length, 3)
    result.candidates.forEach(assertCandidateShape)
    assert.deepEqual(result.candidates[0], {
      company: 'Example Polymers Inc.', title: 'chemist', location: 'Sarnia (ON)',
      sourceUrl: 'https://www.jobbank.gc.ca/jobsearch/jobposting/90000001', requisition: '1000001',
      updatedAt: '2026-11-25T07:53:00.000Z', platform: 'jobbank', salary: '$38.00 hourly',
    })
    assert.equal(result.candidates[1].title, 'quality control chemist & analyst')
    assert.equal(result.candidates[1].company, 'Laboratoires Exemple Ltée')
    assert.equal(result.candidates[1].salary, '$30.00 to $34.00 hourly')
    assert.match(result.diagnostics.note, /Job Bank feed/)
    assert.deepEqual(result.source, { platform: 'jobbank', keyword: 'chemist' })
  })

  test('jobbank province codes filter on the server and by "(XX)"', async () => {
    const fetchImpl = fakeFetch((url, init, i) => (i === 0 ? fixture('jobbank-feed.xml') : fixture('jobbank-empty.xml')))
    const result = await discover({ platform: 'jobbank', keyword: 'chemist', location: 'on', fetchImpl })
    assert.match(fetchImpl.calls[0].url, /[?&]fprov=ON(&|$)/)
    assert.deepEqual(result.candidates.map((c) => c.location), ['Sarnia (ON)'])
  })

  test('parseJobBankFeed also reads RSS 2.0 items', () => {
    const rss = '<rss><channel><item><title>lab chemist</title><link>https://www.jobbank.gc.ca/jobsearch/jobposting/1</link>' +
      '<pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate><description>&lt;b&gt;Location:&lt;/b&gt; Regina (SK)&lt;br/&gt;&lt;b&gt;Employer:&lt;/b&gt; Demo Co</description></item></channel></rss>'
    const [e] = parseJobBankFeed(rss)
    assert.equal(e.title, 'lab chemist')
    assert.equal(e.sourceUrl, 'https://www.jobbank.gc.ca/jobsearch/jobposting/1')
    assert.equal(e.location, 'Regina (SK)')
    assert.equal(e.employer, 'Demo Co')
  })
})

describe('filters', () => {
  test('keyword is a case-insensitive match on title or team; location on location text', async () => {
    const fetchImpl = fakeFetch(() => fixture('lever-postings.json'))
    const byTeam = await discover({ platform: 'lever', board: 'contosorobotics', keyword: 'APPLIED research', fetchImpl })
    assert.deepEqual(byTeam.candidates.map((c) => c.title), ['Machine Learning Scientist'])
    const byLocation = await discover({ platform: 'lever', board: 'contosorobotics', location: 'montreal', fetchImpl })
    assert.deepEqual(byLocation.candidates.map((c) => c.title), ['Machine Learning Scientist'], 'secondary locations count')
    const remote = await discover({ platform: 'lever', board: 'contosorobotics', location: 'Remote', fetchImpl })
    assert.deepEqual(remote.candidates.map((c) => c.title), ['Accounts Payable Specialist'], 'workplace type counts as location text')
    const none = await discover({ platform: 'lever', board: 'contosorobotics', keyword: 'astronaut', fetchImpl })
    assert.equal(none.candidates.length, 0)
    assert.equal(none.diagnostics.totalSeen, 2)
    assert.match(none.diagnostics.note, /does not prove/)
  })

  test('greenhouse keyword and location filters', async () => {
    const fetchImpl = fakeFetch(() => fixture('greenhouse-jobs.json'))
    const r = await discover({ platform: 'greenhouse', board: 'northwindlabs', keyword: 'scientist', location: 'toronto', fetchImpl })
    assert.deepEqual(r.candidates.map((c) => c.requisition), ['NW-101'])
    assert.equal(r.source.keyword, 'scientist')
    assert.equal(r.source.location, 'toronto')
  })

  test('smartrecruiters matches keywords locally (no q) over title and department', async () => {
    const fetchImpl = fakeFetch(() => fixture('smartrecruiters-postings.json'))
    const r = await discover({ platform: 'smartrecruiters', board: 'TailspinHealth', keyword: 'research & dev', fetchImpl })
    assert.equal(new URL(fetchImpl.calls[0].url).searchParams.has('q'), false)
    assert.deepEqual(r.candidates.map((c) => c.title), ['Bioinformatics Scientist'])
  })

  test('workday keyword is left to the server; location filters client-side using the path hint', async () => {
    const fetchImpl = fakeFetch(() => fixture('workday-page0.json'))
    const r = await discover({ platform: 'workday', host: 'globex.wd3.myworkdayjobs.com', tenant: 'globex', site: 'X', keyword: 'zzz', location: 'montreal', fetchImpl })
    assert.deepEqual(r.candidates.map((c) => c.requisition), ['R0012346'])
    assert.match(r.diagnostics.keywordMatching, /workday search/)
  })
})

describe('pagination and truncation', () => {
  const leverJob = (i) => ({ id: `job-${i}`, text: `Scientist ${i}`, categories: { location: 'Toronto' }, createdAt: 1795000000000, hostedUrl: `https://jobs.lever.co/acme/job-${i}` })

  test('lever pages with skip until a short page', async () => {
    const fetchImpl = fakeFetch((url) => {
      const skip = Number(new URL(url).searchParams.get('skip'))
      const count = skip === 0 ? 100 : skip === 100 ? 30 : 0
      return Array.from({ length: count }, (_, i) => leverJob(skip + i))
    })
    const r = await discover({ platform: 'lever', board: 'acme', limit: 500, fetchImpl })
    assert.equal(fetchImpl.calls.length, 2)
    assert.equal(r.candidates.length, 130)
    assert.equal(r.diagnostics.pagesFetched, 2)
    assert.equal(r.diagnostics.truncated, false)
  })

  test('limit truncates and stops fetching', async () => {
    const fetchImpl = fakeFetch(() => Array.from({ length: 100 }, (_, i) => leverJob(i)))
    const r = await discover({ platform: 'lever', board: 'acme', limit: 10, fetchImpl })
    assert.equal(r.candidates.length, 10)
    assert.equal(r.diagnostics.truncated, true)
    assert.equal(r.diagnostics.truncatedBy, 'limit')
    assert.equal(r.diagnostics.complete, false)
    assert.equal(fetchImpl.calls.length, 1)
    assert.match(r.diagnostics.note, /limit of 10/)
  })

  test('exactly reaching the limit on a single-page board is not truncation', async () => {
    const fetchImpl = fakeFetch(() => fixture('greenhouse-jobs.json'))
    const r = await discover({ platform: 'greenhouse', board: 'northwindlabs', limit: 3, fetchImpl })
    assert.equal(r.candidates.length, 3)
    assert.equal(r.diagnostics.truncated, false)
  })

  test('page cap truncates', async () => {
    const fetchImpl = fakeFetch((url) => {
      const skip = Number(new URL(url).searchParams.get('skip'))
      return Array.from({ length: 100 }, (_, i) => ({ ...leverJob(skip + i), text: 'Accountant' }))
    })
    const r = await discover({ platform: 'lever', board: 'acme', keyword: 'scientist', maxPages: 3, fetchImpl })
    assert.equal(fetchImpl.calls.length, 3)
    assert.equal(r.candidates.length, 0)
    assert.equal(r.diagnostics.totalSeen, 300)
    assert.equal(r.diagnostics.truncated, true)
    assert.equal(r.diagnostics.truncatedBy, 'page-cap')
    assert.match(r.diagnostics.note, /Stopped after 3 pages/)
  })

  test('workday uses the first-page total because later pages report 0', async () => {
    const posting = (i) => ({ title: `Engineer ${i}`, externalPath: `/job/Canada-Toronto/Engineer_R${i}`, locationsText: 'Toronto', postedOn: 'Posted Yesterday', bulletFields: [`R${i}`] })
    const fetchImpl = fakeFetch((url, init) => {
      const { offset } = JSON.parse(init.body)
      const count = Math.max(0, Math.min(20, 45 - offset))
      return { total: offset === 0 ? 45 : 0, jobPostings: Array.from({ length: count }, (_, i) => posting(offset + i)) }
    })
    const r = await discover({ platform: 'workday', host: 'globex.wd1.myworkdayjobs.com', tenant: 'globex', site: 'Ext', fetchImpl })
    assert.deepEqual(fetchImpl.calls.map((c) => JSON.parse(c.init.body).offset), [0, 20, 40])
    assert.equal(r.candidates.length, 45)
    assert.equal(r.diagnostics.totalReported, 45)
    assert.equal(r.diagnostics.truncated, false)
  })

  test('smartrecruiters pages by offset up to totalFound', async () => {
    const posting = (i) => ({ id: `7440${i}`, name: `Analyst ${i}`, company: { identifier: 'Tailspin', name: 'Tailspin' }, location: { fullLocation: 'Halifax' } })
    const fetchImpl = fakeFetch((url) => {
      const offset = Number(new URL(url).searchParams.get('offset'))
      const count = Math.min(100, 150 - offset)
      return { offset, limit: 100, totalFound: 150, content: Array.from({ length: count }, (_, i) => posting(offset + i)) }
    })
    const r = await discover({ platform: 'smartrecruiters', board: 'Tailspin', fetchImpl })
    assert.equal(fetchImpl.calls.length, 2)
    assert.equal(r.candidates.length, 150)
  })

  test('jobbank stops when a page repeats (page parameter ignored)', async () => {
    const fetchImpl = fakeFetch(() => fixture('jobbank-feed.xml'))
    const r = await discover({ platform: 'jobbank', keyword: 'chemist', fetchImpl })
    assert.equal(fetchImpl.calls.length, 2)
    assert.equal(r.candidates.length, 3, 'duplicates are dropped')
    assert.equal(r.diagnostics.complete, false)
    assert.match(r.diagnostics.warnings[0], /repeated postings/)
  })
})

describe('errors', () => {
  test('HTTP 404 is captured, not thrown', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 404, body: '{"status":404,"error":"Job not found"}' }))
    const r = await discover({ platform: 'greenhouse', board: 'nobody', fetchImpl })
    assert.equal(r.candidates.length, 0)
    assert.equal(r.diagnostics.errors.length, 1)
    assert.equal(r.diagnostics.errors[0].status, 404)
    assert.equal(r.diagnostics.errors[0].page, 0)
    assert.match(r.diagnostics.errors[0].message, /board name may be wrong/)
    assert.equal(r.diagnostics.complete, false)
    assert.match(r.diagnostics.note, /does not prove/)
  })

  test('network failure and bad JSON are captured', async () => {
    const down = await discover({ platform: 'ashby', board: 'acme', fetchImpl: fakeFetch(() => { throw new TypeError('fetch failed') }) })
    assert.match(down.diagnostics.errors[0].message, /Could not reach the job board: fetch failed/)
    const html = await discover({ platform: 'ashby', board: 'acme', fetchImpl: fakeFetch(() => '<html>maintenance</html>') })
    assert.match(html.diagnostics.errors[0].message, /not JSON/)
    const shape = await discover({ platform: 'ashby', board: 'acme', fetchImpl: fakeFetch(() => ({ jobs: 'nope' })) })
    assert.match(shape.diagnostics.errors[0].message, /unexpected format/)
    const feed = await discover({ platform: 'jobbank', keyword: 'x', fetchImpl: fakeFetch(() => '<html>blocked</html>') })
    assert.match(feed.diagnostics.errors[0].message, /did not send a job feed/)
  })

  test('timeouts abort the request and are captured', async () => {
    const fetchImpl = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
    const r = await discover({ platform: 'lever', board: 'acme', timeoutMs: 20, fetchImpl })
    assert.match(r.diagnostics.errors[0].message, /timed out/)
  })

  test('a failing later page keeps earlier results and reports partial', async () => {
    const fetchImpl = fakeFetch((url) => {
      const skip = Number(new URL(url).searchParams.get('skip'))
      if (skip > 0) return { status: 503, body: 'down' }
      return Array.from({ length: 100 }, (_, i) => ({ id: `j${i}`, text: 'Scientist', hostedUrl: `https://jobs.lever.co/acme/j${i}` }))
    })
    const r = await discover({ platform: 'lever', board: 'acme', fetchImpl })
    assert.equal(r.candidates.length, 100)
    assert.equal(r.diagnostics.errors.length, 1)
    assert.equal(r.diagnostics.errors[0].page, 1)
    assert.equal(r.diagnostics.errors[0].status, 503)
    assert.equal(r.diagnostics.complete, false)
  })

  test('invalid arguments throw clear errors', async () => {
    await assert.rejects(discover({ platform: 'monster', board: 'x' }), /Unknown job board "monster"/)
    await assert.rejects(discover({ platform: 'greenhouse' }), /needs a board name/)
    await assert.rejects(discover({ platform: 'greenhouse', board: '../etc' }), /needs a board name/)
    await assert.rejects(discover({ platform: 'workday', host: 'evil.example.com', tenant: 'a', site: 'b' }), /myworkdayjobs/)
    await assert.rejects(discover({ platform: 'workday', host: 'a.wd1.myworkdayjobs.com', tenant: 'a' }), /tenant and site/)
    await assert.rejects(discover({ platform: 'jobbank' }), /needs a keyword/)
    await assert.rejects(discover({ platform: 'lever', board: 'a', limit: 0 }), /limit/)
    await assert.rejects(discover({ platform: 'lever', board: 'a', limit: 2.5 }), /limit/)
  })
})

describe('discoverEmployer', () => {
  test('uses the careers link and defaults company to the employer name', async () => {
    const fetchImpl = fakeFetch(() => fixture('lever-postings.json'))
    const r = await discoverEmployer({ name: 'Contoso Robotics', careersUrl: 'https://jobs.lever.co/contosorobotics' }, { fetchImpl })
    assert.match(fetchImpl.calls[0].url, /\/postings\/contosorobotics\?/)
    assert.ok(r.candidates.every((c) => c.company === 'Contoso Robotics'))
  })

  test('saved board overrides the careers link (object, "platform:board", or plain slug with platform)', async () => {
    const fetchImpl = fakeFetch(() => fixture('ashby-board.json'))
    await discoverEmployer({ name: 'Fabrikam', careersUrl: 'https://fabrikam.example/careers', board: { platform: 'ashby', board: 'fabrikambio' } }, { fetchImpl })
    await discoverEmployer({ name: 'Fabrikam', board: 'ashby:fabrikambio' }, { fetchImpl })
    await discoverEmployer({ name: 'Fabrikam', platform: 'Ashby', board: 'fabrikambio' }, { fetchImpl })
    assert.equal(fetchImpl.calls.length, 3)
    assert.ok(fetchImpl.calls.every((c) => c.url.startsWith('https://api.ashbyhq.com/posting-api/job-board/fabrikambio?')))
  })

  test('options pass through and company can be overridden', async () => {
    const fetchImpl = fakeFetch(() => fixture('lever-postings.json'))
    const r = await discoverEmployer({ name: 'Contoso', careersUrl: 'https://jobs.lever.co/contosorobotics' }, { keyword: 'accounts', company: 'Contoso Ltd', fetchImpl })
    assert.deepEqual(r.candidates.map((c) => [c.company, c.title]), [['Contoso Ltd', 'Accounts Payable Specialist']])
  })

  test('unsupported careers sites throw a coded error', async () => {
    await assert.rejects(discoverEmployer({ name: 'Initech', careersUrl: 'https://initech.example/jobs' }), (e) => e.code === 'UNSUPPORTED_BOARD' && /Initech/.test(e.message))
    await assert.rejects(discoverEmployer(null), /employer record/)
  })
})

test('exports', () => {
  assert.deepEqual(PLATFORMS, ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'jobbank'])
  assert.equal(workdayPostedDate('Posted 2 Days Ago', new Date('2026-11-25T12:00:00Z')), '2026-11-23')
  assert.equal(workdayPostedDate('Posted Yesterday', new Date('2026-11-25T12:00:00Z')), '2026-11-24')
  assert.equal(workdayPostedDate('Posted 30+ Days Ago'), undefined)
})

describe('review regressions', () => {
  const wdHost = { platform: 'workday', host: 'globex.wd1.myworkdayjobs.com', tenant: 'globex', site: 'Ext' }
  const wdPosting = (i) => ({ title: `Engineer ${i}`, externalPath: `/job/Canada-Toronto/Engineer_R${i}`, locationsText: 'Toronto', postedOn: 'Posted Today', bulletFields: [`R${i}`] })

  test('ashby board names with spaces are encoded once', async () => {
    const fetchImpl = fakeFetch(() => ({ jobs: [] }))
    const r = await discover({ ...boardFromUrl('https://jobs.ashbyhq.com/Acme%20Labs'), fetchImpl })
    assert.equal(fetchImpl.calls[0].url, 'https://api.ashbyhq.com/posting-api/job-board/Acme%20Labs?includeCompensation=false')
    assert.equal(r.diagnostics.complete, true)
  })

  test('smartrecruiters advances by rows received when the server sends short pages', async () => {
    const posting = (i) => ({ id: `9${i}`, name: `Analyst ${i}`, company: { identifier: 'T', name: 'T' }, location: { fullLocation: 'X' } })
    const fetchImpl = fakeFetch((url) => {
      const offset = Number(new URL(url).searchParams.get('offset'))
      const count = Math.max(0, Math.min(25, 65 - offset))
      return { offset, limit: 25, totalFound: 65, content: Array.from({ length: count }, (_, i) => posting(offset + i)) }
    })
    const r = await discover({ platform: 'smartrecruiters', board: 'T', fetchImpl })
    assert.deepEqual(fetchImpl.calls.map((c) => Number(new URL(c.url).searchParams.get('offset'))), [0, 25, 50])
    assert.equal(r.candidates.length, 65)
    assert.equal(r.diagnostics.complete, true)
  })

  test('workday continues after a short page and flags a premature empty page', async () => {
    const short = fakeFetch((url, init) => {
      const { offset } = JSON.parse(init.body)
      const count = offset === 0 ? 2 : Math.max(0, Math.min(20, 5 - offset))
      return { total: offset === 0 ? 5 : 0, jobPostings: Array.from({ length: count }, (_, i) => wdPosting(offset + i)) }
    })
    const r1 = await discover({ ...wdHost, fetchImpl: short })
    assert.deepEqual(short.calls.map((c) => JSON.parse(c.init.body).offset), [0, 2])
    assert.equal(r1.candidates.length, 5)
    assert.equal(r1.diagnostics.complete, true)

    const early = fakeFetch((url, init) => {
      const { offset } = JSON.parse(init.body)
      return { total: offset === 0 ? 45 : 0, jobPostings: offset === 0 ? [wdPosting(0), wdPosting(1)] : [] }
    })
    const r2 = await discover({ ...wdHost, fetchImpl: early })
    assert.equal(r2.candidates.length, 2)
    assert.equal(r2.diagnostics.complete, false)
    assert.match(r2.diagnostics.warnings.join(' '), /said it had 45 postings but sent only 2/)
  })

  test('malformed rows are skipped without losing earlier pages', async () => {
    const fetchImpl = fakeFetch((url) => {
      const skip = Number(new URL(url).searchParams.get('skip'))
      if (skip === 0) return Array.from({ length: 100 }, (_, i) => ({ id: `j${i}`, text: 'Scientist', hostedUrl: `https://jobs.lever.co/acme/j${i}` }))
      return [null, 'oops', { id: 'k1', text: 'Chemist', hostedUrl: 'https://jobs.lever.co/acme/k1', categories: null }]
    })
    const r = await discover({ platform: 'lever', board: 'acme', fetchImpl })
    assert.equal(r.candidates.length, 101)
    assert.equal(r.diagnostics.complete, false)
    assert.match(r.diagnostics.warnings[0], /Page 2: skipped 2 posting/)
  })

  test('a cut-off Job Bank feed is an error, not an empty result', async () => {
    const cut = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Example</title>'
    const r = await discover({ platform: 'jobbank', keyword: 'x', fetchImpl: fakeFetch(() => cut) })
    assert.equal(r.candidates.length, 0)
    assert.match(r.diagnostics.errors[0].message, /cut off or damaged/)
    assert.equal(r.diagnostics.complete, false)
    const empty = await discover({ platform: 'jobbank', keyword: 'x', fetchImpl: fakeFetch(() => fixture('jobbank-empty.xml')) })
    assert.equal(empty.diagnostics.complete, true)
    assert.equal(empty.diagnostics.errors.length, 0)
  })

  test('Job Bank city-and-radius links pass mid and d to the feed; town names warn', async () => {
    const fetchImpl = fakeFetch(() => fixture('jobbank-empty.xml'))
    await discover({ ...boardFromUrl('https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=cook&mid=22437&d=50'), fetchImpl })
    const q = new URL(fetchImpl.calls[0].url).searchParams
    assert.equal(q.get('mid'), '22437')
    assert.equal(q.get('d'), '50')
    const town = await discover({
      platform: 'jobbank', keyword: 'cook', location: 'Sarnia',
      fetchImpl: fakeFetch((u, i, n) => (n === 0 ? fixture('jobbank-feed.xml') : fixture('jobbank-empty.xml'))),
    })
    assert.deepEqual(town.candidates.map((c) => c.location), ['Sarnia (ON)'])
    assert.match(town.diagnostics.warnings[0], /cannot search by town name/)
    await assert.rejects(discover({ platform: 'jobbank', keyword: 'x', jobBankArea: { mid: 'abc' } }), /jobBankArea/)
  })

  test('sourceUrl must be an absolute public page; bad links fall back to the platform page', async () => {
    const gh = fakeFetch(() => ({ jobs: [
      { id: 12, internal_job_id: 1, title: 'A', absolute_url: '/careers/12', location: { name: 'X' } },
      { id: 13, internal_job_id: 2, title: 'B', absolute_url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/13', location: { name: 'X' } },
    ] }))
    const r1 = await discover({ platform: 'greenhouse', board: 'acme', fetchImpl: gh })
    assert.deepEqual(r1.candidates.map((c) => c.sourceUrl), ['https://job-boards.greenhouse.io/acme/jobs/12', 'https://job-boards.greenhouse.io/acme/jobs/13'])

    const eu = fakeFetch(() => ({ jobs: [{ id: 14, internal_job_id: 3, title: 'C', location: { name: 'London' } }] }))
    const r2 = await discover({ ...boardFromUrl('https://job-boards.eu.greenhouse.io/acme'), fetchImpl: eu })
    assert.equal(r2.candidates[0].sourceUrl, 'https://job-boards.eu.greenhouse.io/acme/jobs/14')

    const lever = fakeFetch(() => [{ id: 'x1', text: 'D', hostedUrl: 'https://api.lever.co/v0/postings/acme/x1' }, { id: 'x2', text: 'E', hostedUrl: 'jobs.lever.co/acme/x2' }])
    const r3 = await discover({ platform: 'lever', board: 'acme', fetchImpl: lever })
    assert.deepEqual(r3.candidates.map((c) => c.sourceUrl), ['https://jobs.lever.co/acme/x1', 'https://jobs.lever.co/acme/x2'])

    const sr = fakeFetch(() => ({ totalFound: 1, content: [{ id: '55', name: 'F', postingUrl: 'https://jobs.smartrecruiters.com/Acme/55-f-role', company: { identifier: 'Acme' } }] }))
    const r4 = await discover({ platform: 'smartrecruiters', board: 'Acme', fetchImpl: sr })
    assert.equal(r4.candidates[0].sourceUrl, 'https://jobs.smartrecruiters.com/Acme/55-f-role')
    for (const c of [...r1.candidates, ...r2.candidates, ...r3.candidates, ...r4.candidates]) assertCandidateShape(c)
  })

  test('greenhouse prospect forms (internal_job_id: null) are not openings', async () => {
    const fetchImpl = fakeFetch(() => ({ jobs: [
      { id: 1, internal_job_id: null, title: 'General Interest', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1', location: { name: 'X' } },
      { id: 2, internal_job_id: 22, title: 'Scientist', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/2', location: { name: 'X' } },
    ], meta: { total: 2 } }))
    const r = await discover({ platform: 'greenhouse', board: 'acme', limit: 1, fetchImpl })
    assert.deepEqual(r.candidates.map((c) => c.title), ['Scientist'])
    assert.equal(r.diagnostics.truncated, false)
    assert.equal(r.diagnostics.complete, true)
  })

  test('lever "unspecified" workplace uses location evidence for remote', async () => {
    const fetchImpl = fakeFetch(() => [
      { id: 'u1', text: 'A', workplaceType: 'unspecified', categories: { location: 'Remote - Canada' }, hostedUrl: 'https://jobs.lever.co/acme/u1' },
      { id: 'u2', text: 'B', workplaceType: 'unspecified', categories: { location: 'Toronto' }, hostedUrl: 'https://jobs.lever.co/acme/u2' },
      { id: 'u3', text: 'C', workplaceType: 'onsite', categories: { location: 'Toronto' }, hostedUrl: 'https://jobs.lever.co/acme/u3' },
    ])
    const r = await discover({ platform: 'lever', board: 'acme', fetchImpl })
    assert.deepEqual(r.candidates.map((c) => c.remote), [true, undefined, false])
  })

  test('discoverEmployer ignores undefined options so saved search values survive', async () => {
    const fetchImpl = fakeFetch(() => fixture('jobbank-empty.xml'))
    const employer = { name: 'Job Bank search', careersUrl: 'https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=chemist&fprov=ON' }
    const r = await discoverEmployer(employer, { keyword: undefined, location: undefined, limit: undefined, fetchImpl })
    assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('searchstring'), 'chemist')
    assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('fprov'), 'ON')
    assert.equal(r.source.location, 'ON')
  })
})

describe('review round 2 regressions', () => {
  const srPosting = (i) => ({ id: `8${i}`, name: `Analyst ${i}`, company: { identifier: 'T', name: 'T' }, location: { fullLocation: 'X' } })
  const wdPosting = (i) => ({ title: `Engineer ${i}`, externalPath: `/job/Canada-Toronto/Engineer_R${i}`, locationsText: 'Toronto', postedOn: 'Posted Today', bulletFields: [`R${i}`] })
  const jbFeed = (entries) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`

  test('smartrecruiters without totalFound keeps paging while pages are full', async () => {
    const fetchImpl = fakeFetch((url) => {
      const offset = Number(new URL(url).searchParams.get('offset'))
      const count = offset === 0 ? 100 : offset === 100 ? 1 : 0
      return { content: Array.from({ length: count }, (_, i) => srPosting(offset + i)) }
    })
    const r = await discover({ platform: 'smartrecruiters', board: 'T', fetchImpl })
    assert.equal(fetchImpl.calls.length, 2)
    assert.equal(r.candidates.length, 101)
    assert.equal(r.diagnostics.totalReported, undefined)
  })

  test('partially overlapping pages are flagged against the reported total', async () => {
    const sr = fakeFetch((url) => {
      const offset = Number(new URL(url).searchParams.get('offset'))
      const ids = offset === 0 ? [0, 1] : offset === 2 ? [1, 2] : []
      return { totalFound: 4, content: ids.map(srPosting) }
    })
    const r1 = await discover({ platform: 'smartrecruiters', board: 'T', fetchImpl: sr })
    assert.equal(r1.candidates.length, 3)
    assert.equal(r1.diagnostics.complete, false)
    assert.match(r1.diagnostics.warnings.join(' '), /said it had 4 postings but sent only 3 different/)

    const wd = fakeFetch((url, init) => {
      const { offset } = JSON.parse(init.body)
      const ids = offset === 0 ? [0, 1] : offset === 2 ? [1, 2] : []
      return { total: offset === 0 ? 4 : 0, jobPostings: ids.map(wdPosting) }
    })
    const r2 = await discover({ platform: 'workday', host: 'g.wd1.myworkdayjobs.com', tenant: 'g', site: 'Ext', fetchImpl: wd })
    assert.equal(r2.candidates.length, 3)
    assert.equal(r2.diagnostics.complete, false)
  })

  test('object rows without a title or link are reported, not silently dropped', async () => {
    const r = await discover({ platform: 'lever', board: 'acme', fetchImpl: fakeFetch(() => [{}, { text: 'Chemist' }]) })
    assert.equal(r.candidates.length, 0)
    assert.equal(r.diagnostics.complete, false)
    assert.match(r.diagnostics.warnings[0], /skipped 2 posting\(s\) with no title or no usable posting link/)
  })

  test('Job Bank town plus province: province to the feed, town matched as text', async () => {
    const fetchImpl = fakeFetch((u, i, n) => (n === 0 ? fixture('jobbank-feed.xml') : fixture('jobbank-empty.xml')))
    const board = boardFromUrl('https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=chemist&fprov=ON&locationstring=Ottawa')
    assert.equal(board.location, 'Ottawa, ON')
    const ottawa = await discoverEmployer({ name: 'Job Bank', careersUrl: 'https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=chemist&fprov=ON&locationstring=Ottawa' }, { fetchImpl })
    assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('fprov'), 'ON')
    assert.equal(ottawa.candidates.length, 0, 'Sarnia (ON) is not Ottawa')
    const sarnia = await discover({ platform: 'jobbank', keyword: 'chemist', location: 'Sarnia, ON', fetchImpl: fakeFetch((u, i, n) => (n === 0 ? fixture('jobbank-feed.xml') : fixture('jobbank-empty.xml'))) })
    assert.deepEqual(sarnia.candidates.map((c) => c.location), ['Sarnia (ON)'])
  })

  test('an explicit location replaces a saved Job Bank city radius', async () => {
    const fetchImpl = fakeFetch(() => fixture('jobbank-empty.xml'))
    const employer = { name: 'JB', careersUrl: 'https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=cook&mid=22437&d=50' }
    await discoverEmployer(employer, { location: 'BC', fetchImpl })
    const q = new URL(fetchImpl.calls[0].url).searchParams
    assert.equal(q.get('fprov'), 'BC')
    assert.equal(q.has('mid'), false)
    assert.equal(q.has('d'), false)
  })

  test('Job Bank uses only real publication dates and the alternate (or rel-less) link', async () => {
    const entry = '<entry><title>chemist</title><link rel="self" href="https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=1"/>' +
      '<link href="https://www.jobbank.gc.ca/jobsearch/jobposting/77"/><published>2026-11-01T00:00:00Z</published>' +
      '<updated>2026-11-20T00:00:00Z</updated><summary>Job number: 77</summary></entry>'
    const r = await discover({ platform: 'jobbank', keyword: 'chemist', fetchImpl: fakeFetch((u, i, n) => (n === 0 ? jbFeed(entry) : jbFeed(''))) })
    assert.equal(r.candidates[0].sourceUrl, 'https://www.jobbank.gc.ca/jobsearch/jobposting/77')
    assert.equal(r.candidates[0].postedAt, '2026-11-01T00:00:00.000Z')
    assert.equal(r.candidates[0].updatedAt, '2026-11-20T00:00:00.000Z')
  })

  test('Job Bank feed with a mismatched root is damaged', async () => {
    const r = await discover({ platform: 'jobbank', keyword: 'x', fetchImpl: fakeFetch(() => '<feed><title>Jobs</title></rss>') })
    assert.match(r.diagnostics.errors[0].message, /cut off or damaged/)
    assert.equal(r.diagnostics.complete, false)
  })

  test('ashby: hybrid is not remote; structured addresses are searchable', async () => {
    const fetchImpl = fakeFetch(() => ({ jobs: [
      { id: 'h', title: 'Hybrid role', location: 'Houston, TX', isRemote: true, workplaceType: 'Hybrid', jobUrl: 'https://jobs.ashbyhq.com/acme/h',
        address: { postalAddress: { addressLocality: 'Houston', addressRegion: 'Texas', addressCountry: 'United States' } } },
      { id: 'r', title: 'Remote role', location: 'Anywhere', isRemote: true, workplaceType: 'Remote', jobUrl: 'https://jobs.ashbyhq.com/acme/r',
        secondaryLocations: [{ location: 'Toronto office', address: { postalAddress: { addressCountry: 'Canada' } } }] },
    ] }))
    const all = await discover({ platform: 'ashby', board: 'acme', fetchImpl })
    assert.deepEqual(all.candidates.map((c) => c.remote), [false, true])
    const remote = await discover({ platform: 'ashby', board: 'acme', location: 'remote', fetchImpl })
    assert.deepEqual(remote.candidates.map((c) => c.title), ['Remote role'])
    const texas = await discover({ platform: 'ashby', board: 'acme', location: 'texas', fetchImpl })
    assert.deepEqual(texas.candidates.map((c) => c.title), ['Hybrid role'])
    const canada = await discover({ platform: 'ashby', board: 'acme', location: 'canada', fetchImpl })
    assert.deepEqual(canada.candidates.map((c) => c.title), ['Remote role'])
  })

  test('lever documented "on-site" spelling is not remote', async () => {
    const fetchImpl = fakeFetch(() => [{ id: 'o', text: 'A', workplaceType: 'on-site', categories: { location: 'Toronto' }, hostedUrl: 'https://jobs.lever.co/acme/o' }])
    const r = await discover({ platform: 'lever', board: 'acme', fetchImpl })
    assert.equal(r.candidates[0].remote, false)
  })

  test('URL edge cases: Workday locale + site "Jobs", SmartRecruiters apply links, Greenhouse ?for= on non-embed links', () => {
    assert.deepEqual(boardFromUrl('https://acme.wd3.myworkdayjobs.com/fr/Jobs/job/Paris/Scientist_R1'), { platform: 'workday', host: 'acme.wd3.myworkdayjobs.com', tenant: 'acme', site: 'Jobs' })
    assert.deepEqual(boardFromUrl('https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeOps/publication/abc'), { platform: 'smartrecruiters', board: 'AcmeOps' })
    assert.equal(boardFromUrl('https://jobs.smartrecruiters.com/oneclick-ui/other'), null)
    assert.deepEqual(boardFromUrl('https://boards.greenhouse.io/acme/jobs/123?for=other'), { platform: 'greenhouse', board: 'acme' })
    assert.deepEqual(boardFromUrl('https://boards.greenhouse.io/embed/job_board?for=acme'), { platform: 'greenhouse', board: 'acme' })
  })
})
