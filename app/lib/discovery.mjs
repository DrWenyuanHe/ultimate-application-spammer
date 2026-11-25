// Job-board discovery: list open postings from public, no-login job-board feeds so they can go
// through screening preflight. This module only reads public listings; it never applies, signs in
// or contacts anyone. Zero dependencies: Node 24 built-ins and the global fetch only.

export const PLATFORMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'jobbank']

const USER_AGENT = 'ultimate-application-spammer (job search helper)'
const DEFAULT_MAX_PAGES = 25
const MAX_LIMIT = 2000
const EXCERPT_CHARS = 300
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
// Ashby board names are company names and may contain spaces (jobs.ashbyhq.com/Acme%20Labs).
const ASHBY_BOARD = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/
const PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'])
const API_HOSTS = new Set(['boards-api.greenhouse.io', 'api.lever.co', 'api.eu.lever.co', 'api.ashbyhq.com', 'api.smartrecruiters.com'])

export const DISCOVERY_NOTE =
  'An empty or partial list does not prove that no suitable jobs exist. Job boards can hide, delay or cap ' +
  'postings, some employers post on their own site or another board, filters only match the words given, ' +
  'and failed or capped pages are listed in errors/warnings/truncated. Check the employer careers page before ' +
  'concluding there is nothing to apply for.'

// ---------------------------------------------------------------------------------------------
// URL recognition

function parseUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try { return new URL(raw) } catch { /* try again with a scheme */ }
  try { return new URL(`https://${raw}`) } catch { return null }
}

function pathSegments(url) {
  return url.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s) } catch { return s } })
}

const slugOrNull = (s, pattern = SLUG) => (s && pattern.test(s) ? s : null)

/** Workday paths may start with a locale (en-US). A bare two-letter segment is a locale only when a site follows it. */
function skipWorkdayLocale(segs) {
  if (/^[a-z]{2}-[a-z]{2,4}$/i.test(segs[0] || '')) return segs.slice(1)
  // /US/job/... is a site named "US"; /fr/Jobs and /fr/Jobs/job/... are locale "fr" + site "Jobs".
  if (/^[a-z]{2}$/i.test(segs[0] || '') && segs[1] && !['job', 'details', 'login'].includes(segs[1].toLowerCase())) return segs.slice(1)
  return segs
}

/**
 * Recognise a careers/job-board link and return the parameters `discover` needs, or null when the
 * link is not one of the supported public boards.
 */
export function boardFromUrl(careersUrl) {
  const url = parseUrl(careersUrl)
  if (!url || !/^https?:$/.test(url.protocol)) return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const segs = pathSegments(url)

  // Greenhouse: boards.greenhouse.io/acme, job-boards.greenhouse.io/acme, job-boards.eu.greenhouse.io/acme,
  // .../embed/job_board?for=acme. EU boards are served by the same public API.
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (host === 'boards-api.greenhouse.io') {
      return segs[0] === 'v1' && segs[1] === 'boards' && slugOrNull(segs[2]) ? { platform: 'greenhouse', board: segs[2] } : null
    }
    if (!/^(job-)?boards\.(eu\.)?greenhouse\.io$/.test(host)) return null
    // `?for=` names the board only on embed routes; on ordinary links the path is authoritative.
    const board = segs[0] === 'embed' ? url.searchParams.get('for') : segs[0]
    const region = host.includes('.eu.') ? { region: 'eu' } : {}
    return slugOrNull(board) ? { platform: 'greenhouse', board, ...region } : null
  }

  // Lever: jobs.lever.co/acme (EU accounts: jobs.eu.lever.co/acme)
  if (/(^|\.)lever\.co$/.test(host)) {
    const region = /(^|\.)eu\.lever\.co$/.test(host) ? { region: 'eu' } : {}
    if (/^api\./.test(host)) {
      return segs[0] === 'v0' && segs[1] === 'postings' && slugOrNull(segs[2]) ? { platform: 'lever', board: segs[2], ...region } : null
    }
    if (!/^jobs\./.test(host)) return null
    return slugOrNull(segs[0]) ? { platform: 'lever', board: segs[0], ...region } : null
  }

  // Ashby: jobs.ashbyhq.com/acme
  if (host === 'jobs.ashbyhq.com') return slugOrNull(segs[0], ASHBY_BOARD) ? { platform: 'ashby', board: segs[0] } : null
  if (host === 'api.ashbyhq.com') {
    return segs[0] === 'posting-api' && segs[1] === 'job-board' && slugOrNull(segs[2], ASHBY_BOARD) ? { platform: 'ashby', board: segs[2] } : null
  }

  // SmartRecruiters: careers.smartrecruiters.com/Acme, jobs.smartrecruiters.com/Acme/123-title
  if (host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') {
    // Application links look like /oneclick-ui/company/Acme/publication/...
    if (segs[0] === 'oneclick-ui') {
      return segs[1] === 'company' && slugOrNull(segs[2]) ? { platform: 'smartrecruiters', board: segs[2] } : null
    }
    if (['app', 'api', 'sr-jobs', 'oneclick'].includes(lower(segs[0]))) return null
    return slugOrNull(segs[0]) ? { platform: 'smartrecruiters', board: segs[0] } : null
  }
  if (host === 'api.smartrecruiters.com') {
    return segs[0] === 'v1' && segs[1] === 'companies' && slugOrNull(segs[2]) ? { platform: 'smartrecruiters', board: segs[2] } : null
  }

  // Workday: acme.wd3.myworkdayjobs.com/en-US/External, or wd1.myworkdaysite.com/recruiting/acme/External
  if (host.endsWith('.myworkdayjobs.com')) {
    if (segs[0] === 'wday' && segs[1] === 'cxs') {
      return slugOrNull(segs[2]) && slugOrNull(segs[3]) ? { platform: 'workday', host, tenant: segs[2], site: segs[3] } : null
    }
    const rest = skipWorkdayLocale(segs)
    const tenant = host.split('.')[0]
    return slugOrNull(rest[0]) && slugOrNull(tenant) ? { platform: 'workday', host, tenant, site: rest[0] } : null
  }
  if (host.endsWith('.myworkdaysite.com')) {
    const rest = skipWorkdayLocale(segs)
    const i = rest.indexOf('recruiting')
    if (i >= 0 && slugOrNull(rest[i + 1]) && slugOrNull(rest[i + 2])) return { platform: 'workday', host, tenant: rest[i + 1], site: rest[i + 2] }
    if (rest[0] === 'wday' && rest[1] === 'cxs' && slugOrNull(rest[2]) && slugOrNull(rest[3])) return { platform: 'workday', host, tenant: rest[2], site: rest[3] }
    return null
  }

  // Job Bank (Canada): a keyword search link such as jobbank.gc.ca/jobsearch/jobsearch?searchstring=chemist&fprov=ON.
  // The feed honours province (fprov) and city-and-radius (mid + d) but ignores free-text locationstring.
  if (host === 'jobbank.gc.ca' || host.endsWith('.jobbank.gc.ca')) {
    const q = url.searchParams
    const keyword = q.get('searchstring')?.trim()
    const mid = q.get('mid')?.trim()
    const d = q.get('d')?.trim()
    const area = /^\d+$/.test(mid || '') ? { mid, ...(/^\d+$/.test(d || '') ? { d } : {}) } : null
    // Location is "Town, PR", "PR" or "Town"; a city-and-radius area replaces the town name.
    const province = q.get('fprov')?.trim().toUpperCase()
    const town = area ? '' : q.get('locationstring')?.trim()
    const location = [town, PROVINCES.has(province) ? province : ''].filter(Boolean).join(', ')
    return {
      platform: 'jobbank', ...(keyword ? { keyword } : {}), ...(location ? { location } : {}), ...(area ? { jobBankArea: area } : {}),
    }
  }

  return null
}

// ---------------------------------------------------------------------------------------------
// Small text helpers

const str = (v) => (v === undefined || v === null ? '' : String(v).trim())
const lower = (v) => str(v).toLowerCase()
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&(lt|gt|quot|apos|nbsp|amp);/g, (_, n) => ({ lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&' })[n])
}

function safeCodePoint(n) {
  try { return String.fromCodePoint(n) } catch { return '' }
}

const stripTags = (html) => decodeEntities(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' '))

function excerpt(text) {
  const t = str(text).replace(/\s+/g, ' ')
  if (!t) return undefined
  return t.length > EXCERPT_CHARS ? `${t.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : t
}

function isoOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value))
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

const remoteFrom = (...texts) => (texts.some((t) => /\bremote\b/i.test(str(t))) ? true : undefined)

function clean(candidate) {
  return Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined && v !== null && v !== ''))
}

/** Keep a posting link only if it is an absolute web page link (not an API endpoint); otherwise use the fallback. */
function publicUrl(value, fallback = '') {
  for (const candidate of [value, fallback]) {
    const text = str(candidate)
    if (!/^https?:\/\//i.test(text)) continue
    try {
      const u = new URL(text)
      if (API_HOSTS.has(u.hostname.toLowerCase()) || u.pathname.includes('/wday/cxs/') || /jobsearchrssfeed/i.test(u.pathname)) continue
      return u.toString()
    } catch { /* try the fallback */ }
  }
  return ''
}

/** Normalise each row, skipping (and counting) rows that are not objects or that fail to normalise. */
function mapRows(rows, page, ctx, fn) {
  const out = []
  let skipped = 0
  for (const row of rows) {
    if (!isRecord(row)) { skipped++; continue }
    try {
      const item = fn(row)
      if (item) out.push(item)
    } catch { skipped++ }
  }
  if (skipped) ctx.warn(`Page ${page + 1}: skipped ${skipped} posting(s) the job board sent in an unexpected format.`, { incomplete: true })
  return out
}

// ---------------------------------------------------------------------------------------------
// HTTP

async function request(url, { method = 'GET', body, accept = 'application/json' }, ctx, page) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs)
  const headers = { 'User-Agent': USER_AGENT, Accept: accept }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    const res = await ctx.fetchImpl(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: 'follow',
    })
    const text = await res.text()
    if (!res.ok) {
      ctx.errors.push({ page, url, status: res.status, message: httpMessage(res.status) })
      return null
    }
    return text
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError'
    ctx.errors.push({
      page, url,
      message: timedOut ? `No answer within ${Math.round(ctx.timeoutMs / 1000)} seconds (timed out).` : `Could not reach the job board: ${error?.message || error}`,
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}

function httpMessage(status) {
  if (status === 404) return 'HTTP 404: board not found. The board name may be wrong, or the employer no longer uses this job board.'
  if (status === 429) return 'HTTP 429: the job board asked us to slow down or is blocking automated requests. Try again later, or check the careers page by hand.'
  if (status >= 500) return `HTTP ${status}: the job board had a server problem. Try again later.`
  return `HTTP ${status}: the job board refused the request.`
}

async function getJson(url, options, ctx, page, check) {
  const text = await request(url, options, ctx, page)
  if (text === null) return null
  let data
  try { data = JSON.parse(text) } catch {
    ctx.errors.push({ page, url, message: 'The job board sent something that is not JSON (its format may have changed).' })
    return null
  }
  if (check && !check(data)) {
    ctx.errors.push({ page, url, message: 'The job board answered in an unexpected format (its API may have changed).' })
    return null
  }
  return data
}

// ---------------------------------------------------------------------------------------------
// Platform adapters. Each `fetchPage` returns { items, raw, total?, hasMore } with items already
// normalised to candidate objects (plus private `_keywordText` / `_locationText` for filtering),
// or null after recording an error. `raw` is the number of postings the board sent on that page.

const ADAPTERS = {
  greenhouse: {
    keywordMode: 'client',
    source: (p) => ({ platform: 'greenhouse', board: p.board, ...(p.region === 'eu' ? { region: 'eu' } : {}) }),
    async fetchPage(p, page, ctx) {
      // One request returns every job; `content=false` omits descriptions and departments,
      // so keyword matching uses the title only.
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(p.board)}/jobs?content=false`
      const data = await getJson(url, {}, ctx, page, (d) => Array.isArray(d?.jobs))
      if (!data) return null
      const host = p.region === 'eu' ? 'job-boards.eu.greenhouse.io' : 'job-boards.greenhouse.io'
      const items = mapRows(data.jobs, page, ctx, (job) => {
        // Greenhouse marks general-interest "prospect" forms with internal_job_id: null; they are not openings.
        if ('internal_job_id' in job && job.internal_job_id === null) return null
        const location = str(job.location?.name)
        const departments = Array.isArray(job.departments) ? job.departments.map((d) => str(d?.name)).filter(Boolean).join(', ') : ''
        return {
          company: str(p.company) || str(job.company_name) || p.board,
          title: str(job.title),
          location,
          sourceUrl: publicUrl(job.absolute_url, job.id ? `https://${host}/${encodeURIComponent(p.board)}/jobs/${encodeURIComponent(job.id)}` : ''),
          requisition: str(job.requisition_id) || str(job.id),
          postedAt: isoOrUndefined(job.first_published),
          updatedAt: isoOrUndefined(job.updated_at),
          platform: 'greenhouse',
          department: departments || undefined,
          remote: remoteFrom(location),
          _keywordText: `${job.title} ${departments}`,
          _locationText: location,
        }
      })
      return { items, raw: data.jobs.length, total: Number(data.meta?.total) || undefined, hasMore: false }
    },
  },

  lever: {
    keywordMode: 'client',
    pageSize: 100,
    source: (p) => ({ platform: 'lever', board: p.board, ...(p.region === 'eu' ? { region: 'eu' } : {}) }),
    async fetchPage(p, page, ctx, state) {
      state.offset ||= 0
      const base = p.region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co'
      const url = `${base}/v0/postings/${encodeURIComponent(p.board)}?mode=json&limit=${this.pageSize}&skip=${state.offset}`
      const data = await getJson(url, {}, ctx, page, Array.isArray)
      if (!data) return null
      state.offset += data.length
      const publicHost = p.region === 'eu' ? 'jobs.eu.lever.co' : 'jobs.lever.co'
      const items = mapRows(data, page, ctx, (job) => {
        const c = isRecord(job.categories) ? job.categories : {}
        const all = Array.isArray(c.allLocations) ? c.allLocations.map(str) : []
        const location = str(c.location) || all.join('; ')
        const workplace = lower(job.workplaceType)
        return {
          company: str(p.company) || p.board,
          title: str(job.text),
          location,
          sourceUrl: publicUrl(job.hostedUrl, job.id ? `https://${publicHost}/${encodeURIComponent(p.board)}/${encodeURIComponent(job.id)}` : ''),
          requisition: str(job.id),
          postedAt: isoOrUndefined(job.createdAt),
          platform: 'lever',
          employmentType: str(c.commitment) || undefined,
          department: [str(c.department), str(c.team)].filter(Boolean).join(' / ') || undefined,
          // Lever's workplaceType is on-site | hybrid | remote | unspecified (older data says onsite).
          remote: workplace === 'remote' ? true : ['on-site', 'onsite', 'hybrid'].includes(workplace) ? false : remoteFrom(location, ...all),
          excerpt: excerpt(job.descriptionPlain || job.openingPlain),
          _keywordText: `${job.text} ${c.department || ''} ${c.team || ''}`,
          _locationText: `${location} ${all.join(' ')} ${workplace}`,
        }
      })
      return { items, raw: data.length, hasMore: data.length >= this.pageSize }
    },
  },

  ashby: {
    keywordMode: 'client',
    source: (p) => ({ platform: 'ashby', board: p.board }),
    async fetchPage(p, page, ctx) {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(p.board)}?includeCompensation=false`
      const data = await getJson(url, {}, ctx, page, (d) => Array.isArray(d?.jobs))
      if (!data) return null
      const items = mapRows(data.jobs, page, ctx, (job) => {
        if (job.isListed === false) return null
        const secondaryList = Array.isArray(job.secondaryLocations) ? job.secondaryLocations.filter(isRecord) : []
        const secondary = secondaryList.map((l) => str(l.location)).filter(Boolean)
        const location = str(job.location)
        const address = (a) => {
          const pa = a?.postalAddress
          return isRecord(pa) ? [pa.addressLocality, pa.addressRegion, pa.addressCountry].map(str).filter(Boolean).join(' ') : ''
        }
        const addresses = [address(job.address), ...secondaryList.map((l) => address(l.address))].filter(Boolean).join(' ')
        // Ashby sets isRemote for hybrid jobs too, so prefer workplaceType (OnSite | Hybrid | Remote) when present.
        const workplace = lower(job.workplaceType).replace(/[\s_-]/g, '')
        const remote = workplace === 'remote' ? true : workplace === 'hybrid' || workplace === 'onsite' ? false
          : typeof job.isRemote === 'boolean' ? job.isRemote : remoteFrom(location)
        return {
          company: str(p.company) || p.board,
          title: str(job.title),
          location: secondary.length ? `${location}; ${secondary.join('; ')}` : location,
          sourceUrl: publicUrl(job.jobUrl, job.id ? `https://jobs.ashbyhq.com/${encodeURIComponent(p.board)}/${encodeURIComponent(job.id)}` : ''),
          requisition: str(job.id),
          postedAt: isoOrUndefined(job.publishedAt),
          platform: 'ashby',
          employmentType: ashbyEmployment(job.employmentType),
          department: [str(job.department), str(job.team)].filter(Boolean).join(' / ') || undefined,
          remote,
          excerpt: excerpt(job.descriptionPlain),
          _keywordText: `${job.title} ${job.department || ''} ${job.team || ''}`,
          _locationText: `${location} ${secondary.join(' ')} ${addresses} ${str(job.workplaceType)} ${remote ? 'remote' : ''}`,
        }
      })
      return { items, raw: data.jobs.length, hasMore: false }
    },
  },

  smartrecruiters: {
    // The server `q` search's scope is not clearly documented (it can miss department-only matches),
    // so it is not used: keywords are matched here and the page cap reports truncation honestly.
    keywordMode: 'client',
    pageSize: 100,
    source: (p) => ({ platform: 'smartrecruiters', board: p.board }),
    async fetchPage(p, page, ctx, state) {
      state.offset ||= 0
      const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(p.board)}/postings?limit=${this.pageSize}&offset=${state.offset}`
      const data = await getJson(url, {}, ctx, page, (d) => Array.isArray(d?.content))
      if (!data) return null
      if (page === 0) {
        const total = Number(data.totalFound)
        state.total = data.totalFound !== null && data.totalFound !== '' && Number.isFinite(total) && total >= 0 ? total : undefined
      }
      // Advance by what was actually sent: the server may return fewer rows than asked for.
      state.offset += data.content.length
      const items = mapRows(data.content, page, ctx, (job) => {
        const loc = isRecord(job.location) ? job.location : {}
        const location = str(loc.fullLocation) || [loc.city, loc.region, loc.country].map(str).filter(Boolean).join(', ')
        const identifier = str(job.company?.identifier) || p.board
        const workplace = loc.remote ? 'Remote' : loc.hybrid ? 'Hybrid' : ''
        return {
          company: str(p.company) || str(job.company?.name) || p.board,
          title: str(job.name),
          location: workplace && !location.toLowerCase().includes(workplace.toLowerCase()) ? `${location}${location ? ' ' : ''}(${workplace})` : location,
          sourceUrl: publicUrl(job.postingUrl, job.id ? `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${encodeURIComponent(job.id)}` : ''),
          requisition: str(job.refNumber) || str(job.id),
          postedAt: isoOrUndefined(job.releasedDate),
          platform: 'smartrecruiters',
          employmentType: str(job.typeOfEmployment?.label) || undefined,
          department: str(job.department?.label) || str(job.function?.label) || undefined,
          remote: typeof loc.remote === 'boolean' ? loc.remote : undefined,
          _keywordText: `${job.name} ${job.department?.label || ''} ${job.function?.label || ''}`,
          _locationText: `${location} ${workplace}`,
        }
      })
      const rows = data.content.length
      // Without a usable totalFound, keep paging while pages come back full (the page cap still applies).
      const hasMore = rows > 0 && (state.total !== undefined ? state.offset < state.total : rows >= this.pageSize)
      return { items, raw: rows, total: state.total, hasMore }
    },
  },

  workday: {
    keywordMode: 'server', // Workday's own searchText
    pageSize: 20, // Workday rejects larger pages
    source: (p) => ({ platform: 'workday', host: p.host, tenant: p.tenant, site: p.site }),
    async fetchPage(p, page, ctx, state) {
      state.offset ||= 0
      const url = `https://${p.host}/wday/cxs/${encodeURIComponent(p.tenant)}/${encodeURIComponent(p.site)}/jobs`
      const body = { appliedFacets: {}, limit: this.pageSize, offset: state.offset, searchText: p.keyword || '' }
      const data = await getJson(url, { method: 'POST', body }, ctx, page, (d) => Array.isArray(d?.jobPostings))
      if (!data) return null
      // Workday reports the real total on the first page only; later pages say 0.
      if (page === 0) state.total = Number(data.total) || 0
      state.offset += data.jobPostings.length
      const postingBase = p.host.endsWith('.myworkdaysite.com')
        ? `https://${p.host}/recruiting/${encodeURIComponent(p.tenant)}/${encodeURIComponent(p.site)}`
        : `https://${p.host}/${encodeURIComponent(p.site)}`
      const items = mapRows(data.jobPostings, page, ctx, (job) => {
        const path = str(job.externalPath)
        const location = str(job.locationsText)
        // For "3 Locations" the first location is only visible in the path: /job/City-Region-Site/Title_REQ
        const pathLocation = (path.match(/^\/job\/([^/]+)\//)?.[1] || '').replace(/-/g, ' ')
        const reqFromPath = path.match(/_([^_/]+)$/)?.[1]
        const bullets = Array.isArray(job.bulletFields) ? job.bulletFields.map(str).filter(Boolean) : []
        return {
          company: str(p.company) || p.tenant,
          title: str(job.title),
          location: /^\d+ locations?$/i.test(location) && pathLocation ? `${location} (including ${pathLocation})` : location,
          sourceUrl: path.startsWith('/') ? publicUrl(`${postingBase}${path}`) : '',
          requisition: bullets[0] || reqFromPath,
          postedAt: workdayPostedDate(job.postedOn, ctx.now),
          postedText: str(job.postedOn) || undefined,
          platform: 'workday',
          remote: remoteFrom(location, job.remoteType),
          _keywordText: `${job.title}`,
          _locationText: `${location} ${pathLocation} ${job.remoteType || ''}`,
        }
      })
      const rows = data.jobPostings.length
      const hasMore = rows > 0 && (state.total ? state.offset < state.total : rows >= this.pageSize)
      return { items, raw: rows, total: state.total || undefined, hasMore }
    },
  },

  jobbank: {
    keywordMode: 'server', // Job Bank's own keyword search
    source: (p) => ({ platform: 'jobbank', keyword: p.keyword, ...(p.jobBankArea ? { jobBankArea: p.jobBankArea } : {}) }),
    async fetchPage(p, page, ctx) {
      const params = new URLSearchParams({ searchstring: p.keyword })
      const province = jobBankProvince(p.location)
      if (province) params.set('fprov', province)
      if (p.jobBankArea) {
        params.set('mid', p.jobBankArea.mid)
        if (p.jobBankArea.d) params.set('d', p.jobBankArea.d)
      }
      if (page > 0) params.set('page', String(page + 1))
      const url = `https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed?${params}`
      const text = await request(url, { accept: 'application/atom+xml, application/xml, text/xml' }, ctx, page)
      if (text === null) return null
      const body = text.trim()
      const root = body.match(/<(feed|rss)[\s>]/)?.[1]
      if (!root) {
        ctx.errors.push({ page, url, message: 'Job Bank did not send a job feed (its format may have changed).' })
        return null
      }
      const opened = (body.match(/<(entry|item)[\s>]/g) || []).length
      const closed = (body.match(/<\/(entry|item)>/g) || []).length
      const entries = parseJobBankFeed(body, { keepInvalid: true })
      if (!new RegExp(`</${root}>$`).test(body) || opened !== closed || opened !== entries.length) {
        ctx.errors.push({ page, url, message: 'The Job Bank feed was cut off or damaged; try again later.' })
        return null
      }
      // Entries without a title or posting link are counted as rejected by the main loop.
      const items = entries.map((e) => ({
        company: e.employer || str(p.company),
        title: e.title,
        location: e.location,
        sourceUrl: publicUrl(e.sourceUrl),
        requisition: e.jobNumber,
        // Only a real publication date counts as postedAt; the feed's <updated> may be an edit time.
        postedAt: isoOrUndefined(e.published),
        updatedAt: isoOrUndefined(e.updated),
        platform: 'jobbank',
        salary: e.salary || undefined,
        remote: remoteFrom(e.location),
        _keywordText: e.title,
        _locationText: e.location,
      }))
      // The feed has no total; keep paging until an empty page (repeats are caught by the main loop).
      return { items, raw: entries.length, hasMore: entries.length > 0 }
    },
  },
}

function ashbyEmployment(value) {
  const map = { FullTime: 'Full-time', PartTime: 'Part-time', Intern: 'Internship', Contract: 'Contract', Temporary: 'Temporary' }
  return map[value] || str(value) || undefined
}

/** Workday only says "Posted Today", "Posted 3 Days Ago" or "Posted 30+ Days Ago"; return an approximate day. */
export function workdayPostedDate(text, now = new Date()) {
  const t = lower(text)
  let days
  if (/posted today/.test(t)) days = 0
  else if (/posted yesterday/.test(t)) days = 1
  else {
    const m = t.match(/posted (\d+) days? ago/)
    if (m) days = Number(m[1])
  }
  if (days === undefined) return undefined
  const d = new Date(now.getTime() - days * 86400000)
  return d.toISOString().slice(0, 10)
}

/** Split a Job Bank location ("ON", "Ottawa, ON", "Ottawa (ON)" or "Ottawa") into a province code and a town. */
function jobBankLocation(location) {
  const text = str(location)
  if (PROVINCES.has(text.toUpperCase())) return { province: text.toUpperCase(), town: '' }
  const m = text.match(/^(.*?)[\s,]+\(?([A-Za-z]{2})\)?$/)
  if (m && PROVINCES.has(m[2].toUpperCase())) return { province: m[2].toUpperCase(), town: m[1].trim() }
  return { province: null, town: text }
}

const jobBankProvince = (location) => jobBankLocation(location).province

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!m) return ''
  const inner = m[1].trim()
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  return cdata ? cdata[1] : decodeEntities(inner)
}

/** Parse a Job Bank Atom feed (or an RSS 2.0 feed) with plain string matching. */
export function parseJobBankFeed(xml, { keepInvalid = false } = {}) {
  const blocks = [...String(xml).matchAll(/<(entry|item)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2])
  const entries = blocks.map((block) => {
    // Atom: the posting page is rel="alternate", which is also the meaning of a link with no rel.
    const links = block.match(/<link\b[^>]*>/gi) || []
    const link = links.find((l) => /\bhref=/i.test(l) && (/\brel=["']alternate["']/i.test(l) || !/\brel=/i.test(l)))
    let href = link ? decodeEntities(link.match(/\bhref=["']([^"']+)["']/i)?.[1] || '') : tagText(block, 'link')
    if (href) { try { href = new URL(href, 'https://www.jobbank.gc.ca').toString() } catch { href = '' } }
    const summary = stripTags(tagText(block, 'summary') || tagText(block, 'description'))
    const field = (label) => summary.match(new RegExp(`${label}:\\s*([^\\n]*)`, 'i'))?.[1].replace(/\s+/g, ' ').trim() || ''
    return {
      title: stripTags(tagText(block, 'title')).replace(/\s+/g, ' ').trim(),
      sourceUrl: href,
      published: tagText(block, 'published') || tagText(block, 'pubDate'),
      updated: tagText(block, 'updated'),
      jobNumber: field('Job number'),
      location: field('Location'),
      employer: field('Employer'),
      salary: field('Salary'),
    }
  })
  return keepInvalid ? entries : entries.filter((e) => e.sourceUrl && e.title)
}

// ---------------------------------------------------------------------------------------------
// Public API

function boardPattern(platform) {
  return platform === 'ashby' ? ASHBY_BOARD : SLUG
}

function validate(options) {
  const { platform } = options
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Unknown job board "${platform}". Supported boards: ${PLATFORMS.join(', ')}.`)
  }
  if (['greenhouse', 'lever', 'ashby', 'smartrecruiters'].includes(platform) && !boardPattern(platform).test(str(options.board))) {
    throw new Error(`${platform} needs a board name (the part after the domain in the careers link, for example "acme").`)
  }
  if (platform === 'workday') {
    const host = lower(options.host)
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(myworkdayjobs|myworkdaysite)\.com$/.test(host)) {
      throw new Error('workday needs host like "acme.wd3.myworkdayjobs.com".')
    }
    if (!SLUG.test(str(options.tenant)) || !SLUG.test(str(options.site))) {
      throw new Error('workday needs tenant and site, for example from acme.wd3.myworkdayjobs.com/en-US/External (tenant "acme", site "External").')
    }
  }
  if (platform === 'jobbank') {
    if (!str(options.keyword)) throw new Error('jobbank needs a keyword to search for (for example "research scientist").')
    const area = options.jobBankArea
    if (area !== undefined && !(isRecord(area) && /^\d+$/.test(str(area.mid)) && (area.d === undefined || /^\d+$/.test(str(area.d))))) {
      throw new Error('jobBankArea must look like { mid: "22437", d: "50" } (numbers from a Job Bank search link).')
    }
  }
  const limit = options.limit ?? 200
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`limit must be a whole number from 1 to ${MAX_LIMIT}.`)
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) throw new Error('maxPages must be a whole number from 1 to 200.')
  // Ashby always includes full descriptions, so its single response can take 20+ seconds for large boards.
  const timeoutMs = options.timeoutMs ?? (platform === 'ashby' ? 60000 : 20000)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive number.')
  if (typeof (options.fetchImpl ?? globalThis.fetch) !== 'function') throw new Error('No fetch function is available (Node 24 or newer is required).')
  return { limit, maxPages, timeoutMs }
}

/**
 * List open postings from one public job board.
 * Returns { source, fetchedAt, candidates, diagnostics }; network and HTTP problems are recorded in
 * diagnostics.errors instead of being thrown. Only invalid arguments throw.
 */
export async function discover(options = {}) {
  const { limit, maxPages, timeoutMs } = validate(options)
  const platform = options.platform
  const adapter = ADAPTERS[platform]
  const p = {
    board: str(options.board), host: lower(options.host), tenant: str(options.tenant), site: str(options.site),
    region: options.region === 'eu' ? 'eu' : undefined, keyword: str(options.keyword), location: str(options.location),
    company: str(options.company),
    jobBankArea: options.jobBankArea ? { mid: str(options.jobBankArea.mid), ...(options.jobBankArea.d !== undefined ? { d: str(options.jobBankArea.d) } : {}) } : undefined,
  }
  const now = new Date()
  const warnings = []
  let incomplete = false
  const ctx = {
    fetchImpl: options.fetchImpl ?? globalThis.fetch, timeoutMs, errors: [], now,
    warn(message, { incomplete: partial = false } = {}) { warnings.push(message); if (partial) incomplete = true },
  }
  const state = {}
  const keywordNeedle = p.keyword.toLowerCase()
  const clientKeyword = adapter.keywordMode === 'client' && keywordNeedle
  // Every needle must appear in the location text. Job Bank: the province goes to the feed and must show as "(ON)".
  let locationNeedles = p.location ? [p.location.toLowerCase()] : []
  if (platform === 'jobbank' && p.location) {
    const { province, town } = jobBankLocation(p.location)
    locationNeedles = [town.toLowerCase(), province ? `(${province.toLowerCase()})` : ''].filter(Boolean)
    if (town) {
      ctx.warn('Job Bank\'s feed cannot search by town name, so the town was matched as text within the capped feed. ' +
        'Use a province code (for example ON) or a Job Bank search link with a city and distance for better coverage.')
    }
  }

  const candidates = []
  const seenUrls = new Set()
  let pagesFetched = 0, totalSeen = 0, otherRows = 0, totalReported, truncated = false, truncatedBy

  for (let page = 0; ; page++) {
    if (page >= maxPages) { truncated = true; truncatedBy = 'page-cap'; break }
    const result = await adapter.fetchPage(p, page, ctx, state)
    if (!result) break
    pagesFetched++
    totalSeen += result.raw
    // Rows the adapter dropped on purpose (unlisted, prospect forms, malformed) still count as distinct postings seen.
    otherRows += Math.max(0, result.raw - result.items.length)
    if (result.total !== undefined) totalReported = result.total
    let fresh = 0, rejected = 0
    let overflow = false
    for (const item of result.items) {
      if (!item.sourceUrl || !item.title) { rejected++; continue }
      if (seenUrls.has(item.sourceUrl)) continue
      seenUrls.add(item.sourceUrl)
      fresh++
      if (clientKeyword && !lower(item._keywordText).includes(keywordNeedle)) continue
      const where = lower(`${item.location} ${item._locationText}`)
      if (locationNeedles.some((needle) => !where.includes(needle))) continue
      if (candidates.length >= limit) { overflow = true; break }
      const { _keywordText, _locationText, ...rest } = item
      candidates.push(clean(rest))
    }
    if (rejected) {
      otherRows += rejected
      ctx.warn(`Page ${page + 1}: skipped ${rejected} posting(s) with no title or no usable posting link.`, { incomplete: true })
    }
    if (overflow) { truncated = true; truncatedBy = 'limit'; break }
    if (page > 0 && result.items.length > 0 && fresh === 0) {
      ctx.warn(`Page ${page + 1} repeated postings already seen, so the job board may be ignoring paging. Later postings were not read.`, { incomplete: true })
      break
    }
    if (!result.hasMore) {
      const distinct = seenUrls.size + otherRows
      if (totalReported && distinct < totalReported) {
        ctx.warn(`The job board said it had ${totalReported} postings but sent only ${distinct} different ones.`, { incomplete: true })
      }
      break
    }
    if (candidates.length >= limit) { truncated = true; truncatedBy = 'limit'; break }
  }

  const diagnostics = {
    pagesFetched,
    totalSeen,
    ...(totalReported !== undefined ? { totalReported } : {}),
    matched: candidates.length,
    truncated,
    ...(truncatedBy ? { truncatedBy } : {}),
    complete: !truncated && !incomplete && ctx.errors.length === 0,
    keywordMatching: !p.keyword ? 'none' : adapter.keywordMode === 'server'
      ? `${platform} search for "${p.keyword}"`
      : `"${p.keyword}" in the job title${platform === 'greenhouse' ? '' : ' or team/department'}`,
    errors: ctx.errors,
    warnings,
    note: DISCOVERY_NOTE,
  }
  if (truncatedBy === 'page-cap') diagnostics.note += ` Stopped after ${maxPages} pages; more postings may exist.`
  if (truncatedBy === 'limit') diagnostics.note += ` Stopped at the limit of ${limit} postings; more postings may exist.`
  if (platform === 'jobbank') diagnostics.note += ' The Job Bank feed shows a capped, recent subset of its search results.'

  const source = adapter.source(p)
  if (p.keyword) source.keyword = p.keyword
  if (p.location) source.location = p.location
  return { source, fetchedAt: now.toISOString(), candidates, diagnostics }
}

function normalisePlatformName(value) {
  const v = lower(value).replace(/[\s_-]+/g, '')
  return PLATFORMS.find((p) => p === v) || null
}

/** Work out board parameters from an employer's saved `board` (object, "platform:board" text or a link). */
function boardFromEmployer(employer) {
  const board = employer.board
  if (isRecord(board) && normalisePlatformName(board.platform)) {
    return { ...board, platform: normalisePlatformName(board.platform) }
  }
  if (typeof board === 'string' && board.trim()) {
    const fromLink = boardFromUrl(board)
    if (/[./]/.test(board) && fromLink) return fromLink
    const m = board.match(/^\s*([a-z ]+)\s*:\s*(\S(?:.*\S)?)\s*$/i)
    if (m && normalisePlatformName(m[1])) return { platform: normalisePlatformName(m[1]), board: m[2] }
    const platform = normalisePlatformName(employer.platform)
    if (platform && boardPattern(platform).test(board.trim())) return { platform, board: board.trim() }
  }
  return employer.careersUrl ? boardFromUrl(employer.careersUrl) : null
}

/** Discover postings for a saved employer record ({ name, careersUrl, board? }). */
export async function discoverEmployer(employer, options = {}) {
  if (!isRecord(employer)) throw new Error('discoverEmployer needs an employer record.')
  const params = boardFromEmployer(employer)
  if (!params) {
    const error = new Error(
      `Could not tell which public job board ${employer.name || 'this employer'} uses from its careers link ` +
      `(${employer.careersUrl || 'none saved'}). Supported boards: ${PLATFORMS.join(', ')}. Check the careers page by hand.`,
    )
    error.code = 'UNSUPPORTED_BOARD'
    throw error
  }
  // Options left undefined (for example CLI flags that were not given) must not erase values from the saved board.
  const given = Object.fromEntries(Object.entries(options || {}).filter(([, v]) => v !== undefined))
  const merged = { ...params, ...given, company: given.company || employer.name || params.company }
  // A new location replaces the saved Job Bank city-and-radius unless a new area is given too.
  if (given.location !== undefined && given.jobBankArea === undefined) delete merged.jobBankArea
  return discover(merged)
}
