// Read-only check that a posting link opens the right job. It never changes a saved record, sends
// no cookies and no personal data, and only contacts public HTTPS hosts.
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'

const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 12000
const MAX_REDIRECTS = 6
const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) blocked.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) blocked.addSubnet(address, prefix, 'ipv6')

class UnsafeUrl extends Error {}

function publicAddress(address) {
  const version = isIP(address)
  if (version === 4) return !blocked.check(address, 'ipv4')
  return version === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6')
}

async function publicUrl(value, lookup) {
  let url
  try { url = new URL(value) } catch { throw new UnsafeUrl('The posting link is not a valid web address.') }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || String(value).length > 8000) throw new UnsafeUrl('Only public https:// links are checked.')
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home|onion)$/.test(host)) throw new UnsafeUrl('The link does not point to a public website.')
  const addresses = await lookup(host, { all: true, verbatim: true })
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((a) => !publicAddress(a.address))) throw new UnsafeUrl('The link does not point to a public website.')
  return { url, addresses }
}

/** Connect only to the addresses that were just checked, so the name cannot resolve elsewhere. */
function fetchPublic(url, { signal, headers, addresses }) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'GET', signal, headers, agent: false,
      lookup(_host, options, done) {
        if (options.all) return done(null, addresses)
        const a = addresses.find((x) => !options.family || x.family === options.family) ?? addresses[0]
        done(null, a.address, a.family)
      },
    }, (res) => {
      const out = new Headers()
      for (const name of ['content-type', 'content-encoding', 'location']) if (res.headers[name]) out.set(name, String(res.headers[name]))
      const status = res.statusCode ?? 502
      if ([204, 205, 304].includes(status)) { res.resume(); resolve(new Response(null, { status, headers: out })) } else resolve(new Response(Readable.toWeb(res), { status, headers: out }))
    })
    req.once('error', reject)
    req.end()
  })
}

const entities = (v) => v.replace(/&#(x[\da-f]+|\d+);/gi, (_m, n) => {
  const point = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' '
}).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_m, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n.toLowerCase()])
const textOf = (v) => entities(v.replace(/<(?:script|style|template|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|noscript)>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
const norm = (v = '') => String(v).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const has = (text, wanted) => norm(wanted).length > 1 && ` ${norm(text)} `.includes(` ${norm(wanted)} `)

function jobPostings(html) {
  const found = []
  const visit = (v) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(visit); return }
    if ([v['@type']].flat().includes('JobPosting')) found.push(v)
    if (v['@graph']) visit(v['@graph'])
  }
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1])) } catch { /* malformed metadata is not evidence */ }
  }
  return found
}

function genericBoard(url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean)
  if (/\d{4,}|[a-f\d]{8}-[a-f\d-]{27}/i.test(url.slice(8))) return false
  return !parts.length || /^(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:careers?|jobs?|openings?|positions?|opportunities)(?:\/(?:all|search))?$/i.test(parts.join('/'))
}

/** Read one page: verified | unavailable | blocked | needs-browser-check. */
export function classifyPage(html, posting, finalUrl) {
  const visible = textOf(html)
  const title = textOf(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => textOf(m[1]))
  const leading = [title, ...headings, visible.slice(0, 1200)].join(' ')
  if (/\b(?:page (?:was )?not found|job (?:was |is )?not found|404(?: error)?|position (?:is )?no longer available|job (?:is )?no longer available|posting (?:has been |was )?removed|no longer accepting applications|this (?:job|position) (?:has been |is )?(?:closed|filled|expired))\b/i.test(leading)) return { outcome: 'unavailable', reason: 'The page says the posting is missing, removed or closed.' }
  if (/\b(?:access denied|just a moment|verify (?:that )?you are human|captcha|attention required|security check|checking your browser|enable cookies)\b/i.test(leading)) return { outcome: 'blocked', reason: 'The page shows a security check. Open it in a browser.' }
  const jobs = jobPostings(html).filter((j) => typeof j.title === 'string' && !/^(?:loading.*|please wait|job title|role title)?$/i.test(norm(j.title)))
  const match = jobs.find((j) => has(j.title, posting.title))
  if (jobs.length && !match) return { outcome: 'unavailable', reason: 'The page is for a different job title.' }
  const organization = match?.hiringOrganization?.name
  if (organization && posting.company && !has(organization, posting.company) && !has(posting.company, organization)) return { outcome: 'needs-browser-check', reason: 'The page names a different employer. Check the link.' }
  const titleSeen = Boolean(match) || [title, ...headings].some((v) => has(v, posting.title))
  const companySeen = has(visible, posting.company) || Boolean(organization)
  const canApply = /\bapply\b/i.test(visible) || /<form\b[^>]*apply/i.test(html)
  if (jobs.length > 1 || genericBoard(finalUrl)) return { outcome: 'needs-browser-check', reason: 'The page lists several jobs. Open the exact posting.' }
  if (titleSeen && companySeen && canApply) return { outcome: 'verified', reason: 'The page shows this job at this employer and how to apply.' }
  return { outcome: 'needs-browser-check', reason: 'The page could not be read without a browser. Open it and check.' }
}

async function readBounded(response) {
  const chunks = []
  let size = 0
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength
    if (size > MAX_BYTES) throw new Error('The page is too large to check.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function inspect(posting, check, { fetchRequest, lookup, signal }) {
  let next = posting.sourceUrl
  const visited = new Set()
  for (;;) {
    const { url, addresses } = await publicUrl(next, lookup)
    if (visited.has(url.href)) return { outcome: 'unavailable', reason: 'The link redirects in a loop.' }
    visited.add(url.href)
    check.finalUrl = url.href
    const res = await fetchRequest(url.href, { method: 'GET', redirect: 'manual', credentials: 'omit', signal, addresses, headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'identity', 'User-Agent': 'JobPostingLinkCheck/1.0' } })
    check.httpStatus = res.status
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel()
      const to = res.headers.get('location')
      if (!to || visited.size > MAX_REDIRECTS) return { outcome: 'unavailable', reason: 'The link does not lead to a page.' }
      next = new URL(to, url).href
      continue
    }
    if ([404, 410].includes(res.status)) { await res.body?.cancel(); return { outcome: 'unavailable', reason: `The link returns ${res.status}. That alone does not prove the employer closed the job.` } }
    if (res.status < 200 || res.status >= 300) { await res.body?.cancel(); return { outcome: 'blocked', reason: `The site answered ${res.status}. Open the link in a browser.` } }
    if (visited.size > 1 && genericBoard(url.href)) { await res.body?.cancel(); return { outcome: 'unavailable', reason: 'The link now leads to a general careers page.' } }
    if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(res.headers.get('content-type') ?? '')) { await res.body?.cancel(); return { outcome: 'needs-browser-check', reason: 'The link is not a web page (for example a PDF). Open it and check.' } }
    return classifyPage(await readBounded(res), posting, url.href)
  }
}

/** Check several postings ({ company, title, sourceUrl }), four at a time. */
export async function checkPostings(postings, { fetchRequest = fetchPublic, lookup = dnsLookup, now = () => new Date(), timeoutMs = TIMEOUT_MS } = {}) {
  const results = new Array(postings.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < postings.length) {
      const index = cursor++
      const p = postings[index] || {}
      const check = { id: p.id, company: p.company, title: p.title, sourceUrl: p.sourceUrl, finalUrl: p.sourceUrl, httpStatus: null, checkedAt: now().toISOString() }
      const controller = new AbortController()
      let timer
      try {
        Object.assign(check, await Promise.race([
          inspect(p, check, { fetchRequest, lookup, signal: controller.signal }),
          new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs) }),
        ]))
      } catch (error) {
        Object.assign(check, error instanceof UnsafeUrl ? { outcome: 'unsafe', reason: error.message } : { outcome: 'blocked', reason: 'The page could not be read. Open it in a browser.' })
      } finally { clearTimeout(timer); controller.abort() }
      results[index] = check
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, postings.length) }, worker))
  return { counts: results.reduce((o, r) => ({ ...o, [r.outcome]: (o[r.outcome] || 0) + 1 }), {}), results }
}
