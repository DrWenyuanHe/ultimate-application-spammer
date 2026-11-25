// Read-only dashboard for the local job-application workspace. Plain ES module, no build step.
// The person never edits data here: their AI assistant makes every change through defined
// operations, and this page shows the result live. Wherever something could change, the page
// shows the sentence to say to the assistant.
// Data is only ever inserted with textContent and DOM properties, never parsed as HTML.

// ---------------------------------------------------------------- labels
const STAGE_INFO = {
  Review: 'Deciding whether to apply',
  Preparing: 'Getting documents ready',
  Ready: 'Ready to submit',
  Applied: 'Sent, waiting to hear back',
  Interview: 'Interviews in progress',
  Offer: 'Offer received',
  Rejected: 'Not moving forward',
  Withdrawn: 'You stepped back',
  Archived: 'Put away for reference',
}
const NEXT_STAGE = { Review: 'Preparing', Preparing: 'Ready', Ready: 'Applied', Applied: 'Interview', Interview: 'Offer' }
const CLOSED_STAGES = new Set(['Rejected', 'Withdrawn', 'Archived'])
const PRIORITY_LABELS = { 1: 'High', 2: 'Normal', 3: 'Lower', 4: 'Low', 5: 'Lowest' }
const EVIDENCE_KIND_SINGULAR = {
  experience: 'Job or role', project: 'Project', achievement: 'Achievement', education: 'Education',
  skill: 'Skill', publication: 'Publication', other: 'Other',
}
const REVIEW_STATUS = {
  provided: ['From you', 'muted'],
  'needs-review': ['From you', 'muted'],
  'candidate-confirmed': ['Confirmed by you', 'ok'],
  'source-verified': ['Checked against a document', 'ok'],
  disputed: ['Left out: your documents disagree', 'warn'],
  outdated: ['Replaced by a newer fact', 'muted'],
}
const TIERS = { A: ['A · Prioritize', 'ok'], B: ['B · Good option', 'ok'], C: ['C · Stretch', 'muted'], Hold: ['Check first', 'warn'] }
const QUALIFICATION_STATUS = { met: ['Covered', 'ok'], partial: ['Partly', 'muted'], gap: ['Gap', 'warn'] }
const MATERIAL_KINDS = {
  resume: 'Resume', cv: 'CV', 'cover-letter': 'Cover letter', essay: 'Essay', answer: 'Application answer',
  passage: 'Reusable passage', other: 'Other',
}
const MATERIAL_STATUS = { draft: ['Draft', 'muted'], approved: ['Approved by you', 'ok'] }
const RULE_GROUPS = [
  ['proposed', 'Suggested — waiting for your decision', 'Your assistant does not use these until you approve them.'],
  ['approved', 'Approved by you', 'Your assistant follows these when writing.'],
  ['starter', 'On by default', 'Sensible starting rules. You can retire any you disagree with.'],
  ['retired', 'Retired', 'No longer used. Kept for your records.'],
]
const MISSING_LABELS = {
  situation: 'needs the situation', task: 'needs your task or goal', action: 'needs what you did',
  result: 'needs a result', measuredResult: 'needs a number with a date', evidence: 'needs supporting evidence',
}
const STAR_PARTS = [['situation', 'Situation'], ['task', 'Task'], ['action', 'Action'], ['result', 'Result']]
const KIND_NAMES = {
  application: 'job', research_task: 'job search', screening_decision: 'posting', employer: 'employer',
  evidence: 'career library item', material: 'document', rule: 'writing rule', profile: 'profile',
  narrative: 'resume angle', submission: 'submission record', packet: 'application packet', screening_answers: 'application answers',
}
const EVENT_VERBS = {
  created: 'Added', updated: 'Updated', proposed: 'Suggested', approved: 'Approved', retired: 'Retired',
  claimed: 'Started', completed: 'Finished', screened: 'Screened', shortlisted: 'Shortlisted', submitted: 'Recorded a submission for',
  'research-finding': 'Found', 'research-refresh': 'Re-checked', seeded: 'Added starter', superseded: 'Replaced an earlier decision for',
  revised: 'Suggested new wording for', ranked: 'Rated', reopened: 'Reopened', failed: 'Put back', 'bullet-saved': 'Saved a bullet for',
}
const RECENT_MS = 2 * 60 * 1000

// ---------------------------------------------------------------- state
const state = {
  data: null,
  meta: null,
  revision: 0,
  view: 'overview',
  jobFilter: { q: '', stage: 'active', sort: 'stage' },
  employerQuery: '',
  expanded: new Set(),   // rows and items whose details are open
  versions: null,        // record versions from the previous snapshot, to highlight changes
  changed: new Map(),    // "kind:id" -> time it changed
  lastChecked: null,
  lastChanged: null,
  online: true,
  update: null,
  guide: null,
}
let current = null
let inflight = null
let refreshAgain = false

// ---------------------------------------------------------------- DOM helpers
const BOOL_PROPS = new Set(['checked', 'disabled', 'hidden', 'selected', 'open'])

/** Create an element. Children and text are added as text nodes, never parsed as HTML. */
function h(tag, props, ...children) {
  const el = document.createElement(tag)
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null) continue
    if (key === 'class') el.className = value
    else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value)
    else if (BOOL_PROPS.has(key)) el[key] = Boolean(value)
    else if (key === 'value') el.value = value
    else if (value === false) continue
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  return el
}

const isWebUrl = (value) => /^https?:\/\/[^\s]+$/i.test(String(value || '').trim())

/** A link that opens outside the dashboard; anything that is not a web address is shown as plain text. */
function extLink(url, label, focusKey) {
  if (!isWebUrl(url)) return label ? h('span', {}, label) : null
  return h('a', { href: String(url).trim(), target: '_blank', rel: 'noopener noreferrer', class: 'ext', dataset: focusKey ? { focusKey } : undefined },
    label || url, h('span', { class: 'sr-only' }, ' (opens in a new tab)'))
}

function badge(text, tone = 'muted') { return h('span', { class: `badge badge-${tone}` }, text) }

function card(title, body, { intro, actions, id } = {}) {
  const headingId = id ? `${id}-heading` : undefined
  return h('section', { class: 'card', id, 'aria-labelledby': headingId },
    h('div', { class: 'card-head' }, h('h2', { id: headingId, tabindex: '-1' }, title), actions || null),
    intro ? h('p', { class: 'muted card-intro' }, intro) : null,
    body)
}

function viewShell(title, intro) {
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('h1', { tabindex: '-1' }, title), intro ? h('p', { class: 'muted' }, intro) : null))
}

function empty(text) { return h('p', { class: 'empty' }, text) }

/** Continue each highlight's fade from when that record changed, instead of restarting it on every redraw. */
function applyRecent(root) {
  for (const el of root.querySelectorAll('[data-changed-at]')) {
    el.classList.add('recent')
    el.style.animationDelay = `-${Date.now() - Number(el.dataset.changedAt)}ms`
  }
}

function selectEl(options, value, props = {}) {
  const el = h('select', props, options.map(([v, label]) => h('option', { value: v }, label)))
  el.value = value ?? ''
  return el
}

/** Re-render a region without losing the keyboard position inside it. */
function rerender(container, ...nodes) {
  const active = document.activeElement
  const key = active && container.contains(active) ? active.dataset.focusKey : null
  container.replaceChildren(...nodes.flat(Infinity).filter(Boolean))
  applyRecent(container)
  if (key) {
    const again = [...container.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === key)
    if (again) again.focus({ preventScroll: true })
  }
}

/**
 * "Ask your assistant" hint: the exact sentence to say, with a copy button.
 * The dashboard itself never changes anything.
 */
function ask(sentence, lead = 'To change this, tell your assistant:') {
  const copy = h('button', {
    type: 'button', class: 'copy-btn', 'aria-label': `Copy the sentence: ${sentence}`, dataset: { focusKey: `copy-${sentence}` },
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(sentence)
        toast('Copied. Paste it into your chat with your assistant.')
      } catch {
        toast('Select the sentence and copy it yourself.')
      }
    },
  }, 'Copy')
  return h('p', { class: 'ask' },
    h('span', { class: 'ask-chip' }, 'Ask your assistant'), ' ',
    h('span', { class: 'ask-lead' }, lead), ' ',
    h('q', { class: 'ask-text' }, sentence), ' ', copy)
}

/** A disclosure button whose open state survives live refreshes. */
function toggleButton(key, label, controls) {
  const open = state.expanded.has(key)
  return h('button', {
    type: 'button', class: 'toggle', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': open ? controls : undefined,
    dataset: { focusKey: `toggle-${key}` },
    onclick: () => {
      if (state.expanded.has(key)) state.expanded.delete(key)
      else state.expanded.add(key)
      redraw()
    },
  }, h('span', { class: 'toggle-icon', 'aria-hidden': 'true' }, open ? '▾' : '▸'), ' ', label)
}

function factList(rows) {
  const list = rows.filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== '')
  return list.length ? h('dl', { class: 'facts' }, list.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null
}

function longText(label, value) {
  if (!value) return null
  return h('div', { class: 'long' }, h('h4', {}, label), h('p', { class: 'prewrap' }, String(value)))
}

// ---------------------------------------------------------------- dates
function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
function startOfToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function daysUntil(day) { return Math.round((day - startOfToday()) / 86400000) }
function formatDay(value) {
  const month = /^(\d{4})-(\d{2})$/.exec(String(value || ''))
  if (month) return new Date(Number(month[1]), Number(month[2]) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const d = parseDay(value)
  if (!d) return value ? String(value) : ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}
function relativeDay(n) {
  if (n < -1) return `${-n} days overdue`
  if (n === -1) return '1 day overdue'
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  return `In ${n} days`
}
function formatWhen(iso) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 172800) return 'yesterday'
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatDateTime(iso) {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? String(iso || '') : new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
function formatBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let x = v / 1024
  let i = 0
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++ }
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)} ${units[i]}`
}

/** A job's dated items (interview, follow-up, deadline), soonest first. */
function jobDates(app) {
  const out = []
  for (const [field, label] of [['interviewAt', 'Interview'], ['followUpOn', 'Follow up'], ['deadline', 'Deadline']]) {
    if (!app[field]) continue
    const day = parseDay(app[field])
    out.push({ label, day, days: day ? daysUntil(day) : null, raw: app[field] })
  }
  return out.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity))
}

function dateChip(item) {
  if (item.days === null) return h('span', { class: 'date-chip' }, `${item.label}: ${item.raw}`)
  const tone = item.days < 0 ? 'overdue' : item.days <= 3 ? 'soon' : ''
  return h('span', { class: `date-chip ${tone}`.trim() },
    h('span', {}, `${item.label}: ${formatDay(item.raw)}`),
    h('span', { class: 'date-rel' }, ` · ${relativeDay(item.days)}`))
}

// ---------------------------------------------------------------- data access
const apps = () => state.data?.applications || []
const stages = () => state.data?.stages || Object.keys(STAGE_INFO)
const findApp = (id) => apps().find((a) => a.id === id)
const findEvidence = (id) => (state.data?.evidence || []).find((e) => e.id === id)
const jobName = (a) => `${a.company || 'Unknown employer'} — ${a.title || 'Untitled role'}`
const strength = () => state.data?.experienceStrength || { average: 0, complete: 0, total: 0, items: [] }
const answersInfo = () => state.data?.screeningAnswers || { questions: [], custom: [], missingRequired: [], complete: true, version: 0 }
const submissionsFor = (id) => (state.data?.submissions || []).filter((s) => s.applicationId === id)
  .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))
const whoDid = (actor) => (actor === 'user' || actor === 'person' ? 'You' : actor === 'demo' ? 'Demo setup' : actor === 'setup' ? 'Setup' : 'Your assistant')

function slug(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function isRecent(kind, id) {
  const t = state.changed.get(`${kind}:${id}`)
  return Boolean(t && Date.now() - t < RECENT_MS)
}
const appRecent = (a) => isRecent('application', a.id) || submissionsFor(a.id).some((s) => isRecent('submission', s.id))
/** The change time to fade a job's highlight from (its own or its newest submission's). */
const appChangedAt = (a) => Math.max(state.changed.get(`application:${a.id}`) || 0, ...submissionsFor(a.id).map((s) => state.changed.get(`submission:${s.id}`) || 0))
/** Attributes for an element that may be highlighted as recently changed. */
const recentAttrs = (at) => (at && Date.now() - at < RECENT_MS ? { 'data-changed-at': String(at) } : {})
const recentMark = () => h('span', { class: 'recent-badge' }, 'Just changed')

/** Remember record versions so rows the assistant just changed can be highlighted. */
function trackChanges(d) {
  const now = Date.now()
  const next = new Map()
  const lists = [['application', d.applications], ['evidence', d.evidence], ['employer', d.employers], ['rule', d.rules], ['submission', d.submissions], ['material', d.materials]]
  for (const [kind, list] of lists) for (const r of list || []) next.set(`${kind}:${r.id}`, r.version)
  if (state.versions) {
    for (const [key, version] of next) {
      if (state.versions.get(key) !== version) state.changed.set(key, now)
    }
  }
  state.versions = next
  for (const [key, t] of state.changed) if (now - t > RECENT_MS) state.changed.delete(key)
}

// ---------------------------------------------------------------- API (read-only)
async function api(path) {
  let res
  try {
    res = await fetch(`/api${path}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
  } catch {
    const err = new Error("Couldn't reach the dashboard.")
    err.offline = true
    throw err
  }
  let data
  try { data = await res.json() } catch { data = undefined }
  if (!res.ok || data === undefined) {
    const err = new Error(data?.error || `Something went wrong (error ${res.status}).`)
    err.status = res.status
    throw err
  }
  return data
}

// ---------------------------------------------------------------- refresh
/** Fetch the latest snapshot. Calls during a request share it; a forced call queues one follow-up. */
async function refresh({ force = false } = {}) {
  if (inflight) {
    if (force) refreshAgain = true
    return inflight
  }
  inflight = (async () => {
    let full = force
    do {
      refreshAgain = false
      await fetchState(full)
      full = true
    } while (refreshAgain)
  })().finally(() => { inflight = null })
  return inflight
}

let lastRenderAt = 0
let lastRenderDay = ''
async function fetchState(full) {
  try {
    const since = !full && state.data ? `?since=${state.revision}` : ''
    const res = await api(`/state${since}`)
    setOnline(true)
    if (state.stale) announce('Connected again. Showing the latest information.')
    state.stale = false
    state.lastChecked = new Date()
    const sameRevision = state.data && !res.unchanged && Number(res.revision) === state.revision && !full
    if (!res.unchanged && !sameRevision) {
      // Requests never overlap, so a full snapshot is always the newest one (even after a restore).
      if (state.data) { state.lastChanged = new Date(); announce('Updated with new changes from your assistant.') }
      trackChanges(res)
      state.data = res
      state.revision = Number(res.revision) || 0
      if (res.meta) state.meta = res.meta
      applyMeta()
      redraw()
    } else if (current && (Date.now() - lastRenderAt > 60000 || startOfToday().toDateString() !== lastRenderDay)) {
      redraw() // keep "Today", "overdue" and "just changed" labels current when nothing new arrives
    }
  } catch (err) {
    if (!state.stale) announce(err.offline ? 'Lost connection to the dashboard. Showing the last information received.' : 'Could not refresh. Showing the last information received.')
    state.stale = true
    if (err.offline) setOnline(false)
  }
  showSyncStatus()
}

/** Tell screen-reader users about meaningful changes only (not every clock tick). */
function announce(message) {
  const el = document.getElementById('announcer')
  if (!el) return
  el.textContent = ''
  setTimeout(() => { el.textContent = message }, 50)
}

function redraw() {
  lastRenderAt = Date.now()
  lastRenderDay = startOfToday().toDateString()
  if (!current) render()
  else current.update()
  applyRecent(document)
}

function setOnline(ok) {
  state.online = ok
  document.getElementById('offline-banner').hidden = ok
}

function showSyncStatus() {
  const el = document.getElementById('sync-status')
  const set = (text, mode) => { if (el.textContent !== text) el.textContent = text; if (mode) el.dataset.state = mode }
  if (!state.online) return set('Not connected', 'offline')
  if (!state.lastChecked) return set('Loading…')
  if (state.stale) return set('Couldn’t refresh — showing earlier information', 'offline')
  const fresh = state.lastChanged && Date.now() - state.lastChanged < 20000
  set(fresh ? 'Updated just now' : `Live · checked ${state.lastChecked.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`, fresh ? 'fresh' : 'idle')
}

function applyMeta() {
  const meta = state.meta || {}
  const v = document.getElementById('app-version')
  v.hidden = !meta.version
  v.textContent = meta.version ? `Version ${String(meta.version).replace(/^v/i, '')}` : ''
  document.getElementById('demo-banner').hidden = !meta.demo
  setTitle()
}

async function checkUpdate() {
  try { state.update = await api('/update') } catch { state.update = null }
  const banner = document.getElementById('update-banner')
  const u = state.update
  if (u?.shouldPrompt && u.latest) {
    const version = String(u.latest).replace(/^v/i, '')
    rerender(banner, h('span', {}, `Version ${version} is available.`), ask('install the update', 'To install it, tell your assistant:'))
    banner.hidden = false
  } else {
    banner.hidden = true
  }
}

// ---------------------------------------------------------------- toasts
function toast(message, { kind = 'info' } = {}) {
  const box = document.getElementById('toasts')
  const el = h('div', { class: `toast toast-${kind}` },
    h('span', {}, message),
    h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss message', onclick: () => el.remove() }, '×'))
  box.append(el)
  while (box.children.length > 3) box.firstElementChild.remove()
  setTimeout(() => el.remove(), kind === 'error' ? 10000 : 4000)
}

// ---------------------------------------------------------------- shared pieces
function onboardingSteps() {
  const d = state.data || {}
  const sa = answersInfo()
  const st = strength()
  const missing = (sa.missingRequired || []).length
  return [
    { key: 'profile', title: 'Set up your profile', done: Boolean(d.profile?.name),
      text: 'Your name, contact details, the work you want, and whether your assistant may submit applications for you.',
      say: 'set up my profile' },
    { key: 'questions', title: 'Answer common application questions', done: Boolean(sa.complete),
      text: sa.complete ? 'All required questions are answered.' : `${missing} required question${missing === 1 ? '' : 's'} still need an answer. Your assistant uses these on application forms.`,
      say: 'go through the common application questions with me' },
    { key: 'documents', title: 'Add your documents', done: (d.evidence || []).length > 0 || (d.materials || []).length > 0,
      text: 'Put your resumes, CVs and cover letters in the “2 Career Library” folder of your workspace.',
      say: 'import my documents' },
    { key: 'interview', title: 'Do the experience interview', done: st.total > 0 && st.complete > 0,
      text: 'Your assistant asks about one story at a time and fills in the gaps shown under Experience strength.',
      say: 'interview me about my experience' },
  ]
}
const onboardingIncomplete = () => Boolean(state.data) && (!state.data.profile?.name || answersInfo().complete === false)

function stepsList(steps, { compact = false } = {}) {
  return h('ol', { class: compact ? 'mini-steps' : 'steps' }, steps.map((x, i) => h('li', { class: `step${x.done ? ' done' : ''}` },
    h('span', { class: 'step-mark', 'aria-hidden': 'true' }, x.done ? '✓' : String(i + 1)),
    h('div', { class: 'step-body' },
      h('h3', {}, x.title, h('span', { class: 'sr-only' }, x.done ? ' (done)' : ' (not done yet)')),
      compact ? null : h('p', {}, x.text),
      compact ? null : x.key === 'documents' && state.meta?.root ? h('p', { class: 'hint' }, 'Your workspace folder: ', h('span', { class: 'path' }, state.meta.root)) : null,
      x.done ? null : ask(x.say, 'Tell your assistant:')))))
}

function strengthSummary() {
  const st = strength()
  return h('div', { class: 'strength-summary' },
    h('span', { class: 'big-number' }, `${Number(st.average) || 0}%`),
    h('span', {}, h('span', { class: 'strong' }, 'Average strength'), h('br'),
      `${st.complete} of ${st.total} ${st.total === 1 ? 'story is' : 'stories are'} complete`))
}

function meter(score, label) {
  const value = Math.max(0, Math.min(100, Number(score) || 0))
  return h('div', { class: 'meter-row' },
    h('progress', { max: 100, value, 'aria-label': label }),
    h('span', { class: 'score', 'aria-hidden': 'true' }, `${value}%`))
}

function recordNames(d) {
  const map = new Map()
  for (const a of d.applications || []) map.set(`application:${a.id}`, jobName(a))
  for (const e of d.employers || []) map.set(`employer:${e.id}`, e.name)
  for (const e of d.evidence || []) map.set(`evidence:${e.id}`, e.title)
  for (const m of d.materials || []) map.set(`material:${m.id}`, m.title)
  for (const r of d.rules || []) map.set(`rule:${r.id}`, r.title)
  for (const t of d.researchTasks || []) map.set(`research_task:${t.id}`, t.title)
  for (const s of d.screening || []) map.set(`screening_decision:${s.id}`, `${s.company} — ${s.title}`)
  for (const s of d.submissions || []) map.set(`submission:${s.id}`, `${s.company} — ${s.title}`)
  map.set('profile:me', 'your profile')
  map.set('screening_answers:me', 'your answers')
  return map
}

function openJob(id) {
  state.expanded.add(`job-${id}`)
  state.jobFilter = { ...state.jobFilter, q: '', stage: findApp(id) && CLOSED_STAGES.has(findApp(id).stage) ? 'all' : 'active' }
  if (location.hash === '#jobs') { render(); scrollToJob(id) } else { location.hash = '#jobs'; setTimeout(() => scrollToJob(id), 0) }
}
function scrollToJob(id) {
  const btn = document.querySelector(`[data-focus-key="toggle-job-${CSS.escape(id)}"]`)
  if (btn) { btn.scrollIntoView({ block: 'center' }); btn.focus({ preventScroll: true }) }
}

function goToJobs(stage) {
  state.jobFilter = { ...state.jobFilter, q: '', stage }
  if (location.hash === '#jobs') render()
  else location.hash = '#jobs'
}

// ---------------------------------------------------------------- Overview
function overviewView() {
  const el = viewShell('Overview', 'Where every opportunity stands and what is coming up. Your assistant makes the changes; this page shows them as they happen.')
  const startBox = h('div')
  const stagesBox = h('div', { class: 'stage-grid' })
  const upcomingBox = h('div')
  const prioBox = h('div')
  const strengthBox = h('div')
  const activityBox = h('div')
  const startCard = card('Getting started', startBox, { id: 'overview-start' })
  startCard.classList.add('card-highlight')
  el.append(
    startCard,
    card('Pipeline', stagesBox, { intro: 'How many opportunities are at each stage. Choose one to see them.' }),
    h('div', { class: 'columns' },
      card('Coming up', upcomingBox, { intro: 'Interviews, follow-ups and deadlines for open opportunities, soonest first.' }),
      h('div', { class: 'stack' },
        card('High priority', prioBox),
        card('Experience strength', strengthBox))),
    card('Recent activity', activityBox, { intro: 'The latest changes, newest first.' }))

  function update() {
    const d = state.data
    startCard.hidden = !onboardingIncomplete()
    if (!startCard.hidden) {
      const steps = onboardingSteps()
      rerender(startBox, h('p', {}, `${steps.filter((x) => x.done).length} of ${steps.length} steps done.`), stepsList(steps))
    }

    const counts = d.counts || {}
    rerender(stagesBox, stages().map((s) => h('button', {
      type: 'button', class: `stage-card${CLOSED_STAGES.has(s) ? ' closed' : ''}`,
      dataset: { stage: s, focusKey: `stagecard-${s}` }, onclick: () => goToJobs(s),
    },
    h('span', { class: 'stage-count' }, String(counts[s] || 0)),
    h('span', { class: 'stage-name' }, s),
    h('span', { class: 'stage-desc' }, STAGE_INFO[s] || ''))))

    const open = apps().filter((a) => !CLOSED_STAGES.has(a.stage))
    const upcoming = open
      .filter((a) => a.stage === 'Interview' || a.followUpOn || a.deadline || a.interviewAt)
      .map((a) => ({ a, dates: jobDates(a) }))
      .sort((x, y) => (x.dates[0]?.days ?? Infinity) - (y.dates[0]?.days ?? Infinity) || (x.a.priority ?? 3) - (y.a.priority ?? 3))
    rerender(upcomingBox, upcoming.length
      ? h('ul', { class: 'action-list' }, upcoming.map(({ a, dates }) => {
        const overdue = dates.some((x) => x.days !== null && x.days < 0)
        return h('li', { class: overdue ? 'overdue' : '', ...recentAttrs(appChangedAt(a)) },
          h('button', { type: 'button', class: 'row-button', dataset: { focusKey: `up-${a.id}` }, onclick: () => openJob(a.id) },
            h('span', { class: 'action-text' }, overdue ? h('span', { class: 'sr-only' }, 'Overdue: ') : null, jobName(a)),
            h('span', { class: 'action-job' }, h('span', { class: 'stage-tag', dataset: { stage: a.stage } }, a.stage), a.nextAction ? ` · ${a.nextAction}` : ''),
            dates.length ? h('span', { class: 'chips' }, dates.map(dateChip)) : null))
      }))
      : empty('Nothing dated yet.'),
    ask('help me set follow-up dates for my applications', 'To add dates, tell your assistant:'))

    const high = open.filter((a) => a.priority === 1)
    rerender(prioBox, high.length
      ? h('ul', { class: 'plain-list' }, high.map((a) => h('li', { ...recentAttrs(appChangedAt(a)) },
        h('button', { type: 'button', class: 'row-button', dataset: { focusKey: `prio-${a.id}` }, onclick: () => openJob(a.id) },
          h('span', { class: 'action-text' }, h('span', { 'aria-hidden': 'true' }, '★ '), jobName(a)),
          h('span', { class: 'action-job' }, h('span', { class: 'stage-tag', dataset: { stage: a.stage } }, a.stage), a.nextAction ? ` · ${a.nextAction}` : '')))))
      : empty('No high-priority opportunities.'),
    ask('help me choose which opportunities are high priority', 'To change priorities, tell your assistant:'))

    const st = strength()
    rerender(strengthBox, st.total
      ? [strengthSummary(),
        h('ul', { class: 'plain-list' }, st.items.slice(0, 3).map((it) => h('li', {}, h('span', { class: 'strong' }, `${it.score}%`), ` ${it.title}`))),
        h('a', { href: '#experience', dataset: { focusKey: 'strength-link' } }, 'See every story')]
      : empty('Nothing to score yet.'),
    st.total && st.complete < st.total ? ask(`interview me about ${st.items[0]?.title}`, 'To strengthen the weakest story, tell your assistant:') : null)

    const names = recordNames(d)
    const events = (d.activity || []).slice(0, 15)
    rerender(activityBox, events.length
      ? h('ol', { class: 'activity' }, events.map((ev) => {
        const kind = KIND_NAMES[ev.kind] || ev.kind
        const verb = EVENT_VERBS[ev.type] || (ev.type ? ev.type[0].toUpperCase() + ev.type.slice(1) : 'Changed')
        const name = names.get(`${ev.kind}:${ev.id}`)
        const app = ev.kind === 'application' ? findApp(ev.id) : null
        const label = `${verb} ${kind}${name ? `: ${name}` : ''}`
        return h('li', {},
          h('span', { class: 'activity-what' }, app
            ? h('button', { type: 'button', class: 'link-button', dataset: { focusKey: `activity-${ev.seq}` }, onclick: () => openJob(app.id) }, label)
            : label),
          h('span', { class: 'activity-meta' }, `${whoDid(ev.actor)} · `, h('time', { datetime: ev.at, title: formatDateTime(ev.at) }, formatWhen(ev.at))))
      }))
      : empty('Nothing has happened yet.'))
  }
  return { el, update }
}

// ---------------------------------------------------------------- Opportunities and applications
function jobsView() {
  const el = viewShell('Opportunities and applications', 'Every job your assistant found or you are applying to, from first review to the final answer. Open a row for the details and, once submitted, exactly what was filed.')
  const search = h('input', {
    type: 'search', id: 'job-search', placeholder: 'Employer, role, location or notes', value: state.jobFilter.q,
    oninput: (e) => { state.jobFilter.q = e.currentTarget.value; renderTable() },
  })
  const stageFilter = selectEl([
    ['active', 'Open and closed (not archived)'], ['all', 'Everything, including archived'], ...stages().map((s) => [s, `Only “${s}”`]),
  ], state.jobFilter.stage, { id: 'job-stage-filter', onchange: (e) => { state.jobFilter.stage = e.currentTarget.value; renderTable() } })
  const sortSelect = selectEl([
    ['stage', 'Stage'], ['soonest', 'Soonest date'], ['recent', 'Recently changed'], ['priority', 'Priority'], ['company', 'Employer A–Z'],
  ], state.jobFilter.sort, { id: 'job-sort', onchange: (e) => { state.jobFilter.sort = e.currentTarget.value; renderTable() } })
  const countText = h('p', { class: 'muted result-count', role: 'status' })
  const tableBox = h('div', { class: 'table-wrap' })

  el.append(
    h('div', { class: 'toolbar' },
      h('div', { class: 'field grow' }, h('label', { for: 'job-search' }, 'Search'), search),
      h('div', { class: 'field' }, h('label', { for: 'job-stage-filter' }, 'Show'), stageFilter),
      h('div', { class: 'field' }, h('label', { for: 'job-sort' }, 'Sort by'), sortSelect)),
    ask('find more jobs like the ones I shortlisted', 'For more opportunities, tell your assistant something like:'),
    countText, tableBox)

  function visible() {
    const { q, stage, sort } = state.jobFilter
    const needle = q.trim().toLowerCase()
    const order = new Map(stages().map((s, i) => [s, i]))
    const rows = apps().filter((a) => {
      if (stage === 'active' && a.stage === 'Archived') return false
      if (stage !== 'active' && stage !== 'all' && a.stage !== stage) return false
      if (!needle) return true
      return [a.company, a.title, a.location, a.notes, a.discipline, a.nextAction, a.whyFit, a.gaps].some((v) => String(v || '').toLowerCase().includes(needle))
    })
    const soon = (a) => jobDates(a)[0]?.days ?? Infinity
    const sorters = {
      stage: (x, y) => (order.get(x.stage) ?? 99) - (order.get(y.stage) ?? 99) || (x.priority ?? 3) - (y.priority ?? 3),
      soonest: (x, y) => soon(x) - soon(y),
      recent: (x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)),
      priority: (x, y) => (x.priority ?? 3) - (y.priority ?? 3),
      company: (x, y) => String(x.company).localeCompare(String(y.company)) || String(x.title).localeCompare(String(y.title)),
    }
    return rows.sort(sorters[sort] || sorters.stage)
  }

  function renderTable() {
    if (stageFilter.value !== state.jobFilter.stage) stageFilter.value = state.jobFilter.stage
    if (sortSelect.value !== state.jobFilter.sort) sortSelect.value = state.jobFilter.sort
    if (document.activeElement !== search && search.value !== state.jobFilter.q) search.value = state.jobFilter.q
    const rows = visible()
    const total = apps().length
    const f = state.jobFilter
    const shown = f.stage === 'active' ? 'not archived' : f.stage === 'all' ? 'everything' : `only “${f.stage}”`
    countText.textContent = total ? `Showing ${rows.length} of ${total} · ${shown}${f.q.trim() ? ` · matching “${f.q.trim()}”` : ''}` : ''
    if (!rows.length) {
      rerender(tableBox, empty(total ? 'Nothing matches. Try a different search or “Everything”.' : 'No opportunities yet. Ask your assistant to look for jobs.'))
      return
    }
    rerender(tableBox, h('table', { class: 'jobs-table' },
      h('caption', { class: 'sr-only' }, 'Opportunities and applications'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Job'),
        h('th', { scope: 'col' }, 'Stage'),
        h('th', { scope: 'col' }, 'Why it fits'),
        h('th', { scope: 'col' }, 'Gaps'),
        h('th', { scope: 'col' }, 'Posting'),
        h('th', { scope: 'col' }, 'Dates'))),
      rows.map(jobRows)))
  }

  function jobRows(a) {
    const key = `job-${a.id}`
    const open = state.expanded.has(key)
    const detailsId = `details-${slug(a.id)}`
    const dates = jobDates(a)
    const overdue = !CLOSED_STAGES.has(a.stage) && dates.some((d) => d.days !== null && d.days < 0)
    const subs = submissionsFor(a.id)
    const main = h('tr', { class: `job-row${overdue ? ' overdue' : ''}${open ? ' open' : ''}`, ...recentAttrs(appChangedAt(a)) },
      h('td', { class: 'col-job' },
        toggleButton(key, h('span', { class: 'job-open' },
          h('span', { class: 'job-title' }, a.title || 'Untitled role'),
          h('span', { class: 'job-company' }, a.company || '')), detailsId),
        h('span', { class: 'job-meta' },
          a.priority === 1 ? h('span', { class: 'star' }, '★ High priority') : null,
          a.priority === 1 && a.location ? ' · ' : null, a.location || ''),
        TIERS[a.recommendation?.tier] ? h('span', { class: 'chips' }, badge(...TIERS[a.recommendation.tier])) : null,
        appRecent(a) ? recentMark() : null),
      h('td', { class: 'col-stage', 'data-label': 'Stage' },
        h('span', { class: 'stage-pill', dataset: { stage: a.stage } }, a.stage),
        subs.length ? h('span', { class: 'job-meta' }, `Submitted ${formatDay(subs.at(-1).submittedAt)}`) : null),
      h('td', { class: 'col-fit', 'data-label': 'Why it fits' }, a.whyFit ? h('span', { class: 'clamp' }, a.whyFit) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'col-gaps', 'data-label': 'Gaps' }, a.gaps ? h('span', { class: 'clamp' }, a.gaps) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'col-posting', 'data-label': 'Posting' },
        postingStatus(a),
        a.lastChecked ? h('span', { class: 'job-meta' }, `Checked ${formatWhen(a.lastChecked)}`) : null,
        isWebUrl(a.sourceUrl) ? extLink(a.sourceUrl, 'Open posting ↗', `post-${a.id}`) : null),
      h('td', { class: 'col-dates', 'data-label': 'Dates' },
        dates.length ? h('span', { class: 'chips stacked' }, dates.map(dateChip)) : h('span', { class: 'muted' }, '—')))
    if (!open) return h('tbody', {}, main)
    return h('tbody', { class: 'open' }, main,
      h('tr', { class: 'details-row' }, h('td', { colspan: 6, id: detailsId }, jobDetails(a, subs))))
  }

  return { el, update: renderTable }
}

function postingStatus(a) {
  const s = a.postingStatus
  const f = a.freshness
  if (s === 'open' && f?.status === 'expired') return badge('Deadline passed', 'muted')
  if (s === 'open' && f?.status === 'verify' && ['Review', 'Preparing', 'Ready'].includes(a.stage)) return badge('Recheck posting', 'warn')
  if (s === 'open') return badge('Posting open', 'ok')
  if (s === 'closed') return badge('Posting closed', 'muted')
  return badge(s && s !== 'unknown' ? s : 'Not checked yet', 'warn')
}

function jobDetails(a, subs) {
  const next = NEXT_STAGE[a.stage]
  const facts = factList([
    ['Next action', a.nextAction],
    ['Rating', a.recommendation ? `${TIERS[a.recommendation.tier]?.[0] || a.recommendation.tier}: ${a.recommendation.reason}` : ''],
    ['Priority', a.priority ? PRIORITY_LABELS[a.priority] || String(a.priority) : ''],
    ['Location', a.location],
    ['Work arrangement', a.workModel],
    ['Kind of work', a.discipline],
    ['Pay', a.salary],
    ['Job type', a.employmentType],
    ['How the work splits', a.dutySplit],
    ['Job number', a.requisition],
    ['Posted', a.postedAt ? formatDay(a.postedAt) : ''],
    ['Applied', a.appliedAt ? formatDay(a.appliedAt) : ''],
    ['Posting last checked', a.lastChecked ? formatDateTime(a.lastChecked) : ''],
    ['Posting note', a.postingCheckNote],
    ['Found by', a.source === 'research' || a.source === 'screening' ? 'Your assistant' : a.source],
    ['Last changed', `${formatWhen(a.updatedAt)} (version ${a.version})`],
  ])
  const submittedStage = ['Applied', 'Interview', 'Offer'].includes(a.stage)
  return h('div', { class: 'details' },
    h('div', { class: 'details-grid' },
      h('div', {}, facts),
      h('div', {}, longText('Why it fits', a.whyFit), longText('Gaps or questions', a.gaps), longText('Notes', a.notes))),
    a.qualificationMap?.length ? qualificationTable(a.qualificationMap) : null,
    subs.length
      ? h('section', { class: 'subs', 'aria-label': 'What was submitted' }, subs.map(submissionBlock))
      : submittedStage ? h('p', { class: 'notice notice-warn' }, 'There is no record yet of exactly what was submitted for this job.') : null,
    submittedStage && !subs.length ? ask(`record what I submitted to ${a.company} for ${a.title}`, 'To save it, tell your assistant:') : null,
    next ? ask(`move ${a.company} ${a.title} to ${next}`) : ask(`archive ${a.company} ${a.title}`, 'To put it away, tell your assistant:'))
}

/** What the posting asks for and the library items that answer it. */
function qualificationTable(rows) {
  return h('section', { 'aria-label': 'What the posting asks for' },
    h('h4', {}, 'What the posting asks for'),
    h('ul', {}, rows.map((q) => h('li', {},
      badge(...(QUALIFICATION_STATUS[q.status] || [q.status, 'muted'])), ' ', q.qualification, q.required ? ' (required)' : '',
      q.evidence?.length ? h('span', { class: 'muted' }, ` — ${q.evidence.map((id) => findEvidence(id)?.title).filter(Boolean).join(', ')}`) : null,
      q.note ? h('span', { class: 'job-meta' }, q.note) : null))))
}

/** Questions whose answers stay private on screen (voluntary self-identification and other sensitive topics). */
const PRIVATE_QUESTION = /gender|pronoun|indigenous|aboriginal|first nations|m[eé]tis|inuit|visible minority|racial|race|ethnic|disab|accommodat|2slgbtq|lgbt|sexual orientation|veteran|criminal|conviction|record suspension|pardon|religio|date of birth|birth ?date|marital|pregnan|medical|health condition|reference/i
function isPrivateAnswer(x) {
  if (x?.sensitive || x?.voluntary || x?.private) return true
  const text = String(x?.question || '').trim().toLowerCase()
  const bank = answersInfo().questions.find((q) => String(q.question || '').trim().toLowerCase() === text || (x?.questionId && q.id === x.questionId))
  if (bank && (bank.sensitive || bank.voluntary)) return true
  return PRIVATE_QUESTION.test(text)
}

function submissionBlock(s) {
  const precision = s.datePrecision && s.datePrecision !== 'day' ? ` (${s.datePrecision} only)` : ''
  const files = Array.isArray(s.files) ? s.files : []
  const answers = Array.isArray(s.answers) ? s.answers : []
  const pasted = Array.isArray(s.pastedText) ? s.pastedText : []
  const gaps = Array.isArray(s.gaps) ? s.gaps : []
  return h('article', { class: 'submission', ...recentAttrs(state.changed.get(`submission:${s.id}`)) },
    h('h4', {}, `What was submitted on ${formatDay(s.submittedAt)}${precision}`, s.historical ? h('span', { class: 'muted' }, ' — rebuilt from older records') : null),
    factList([
      ['Submitted by', s.submittedBy === 'agent' ? 'Your assistant' : 'You'],
      ['How', s.method && s.method !== 'unknown' ? s.method : ''],
      ['Mode', s.submissionMode === 'auto-submit' ? 'Submitted without asking' : s.submissionMode === 'review-first' ? 'You checked it first' : s.submissionMode],
      ['Application form', isWebUrl(s.formUrl) ? extLink(s.formUrl, 'Open form ↗', `form-${s.id}`) : s.formUrl],
      ['Saved in', s.folder ? `1 Applications/${s.folder}` : ''],
      ['Recorded', s.recordedAt ? formatDateTime(s.recordedAt) : ''],
    ]),
    h('h5', {}, 'Files sent'),
    files.length
      ? h('ul', { class: 'file-list' }, files.map((f) => h('li', {},
        h('span', { class: 'strong' }, f.name || 'Unnamed file'),
        h('span', { class: 'muted' }, ` · ${formatBytes(f.bytes)}${f.sha256 ? ` · fingerprint ${String(f.sha256).slice(0, 12)}` : ''}`))))
      : h('p', { class: 'muted' }, 'No files recorded.'),
    pasted.length ? [h('h5', {}, 'Text typed or pasted into the form'), pasted.map((p) => h('div', { class: 'long' },
      h('h6', {}, p.label || 'Text'), h('p', { class: 'prewrap' }, String(p.text ?? ''))))] : null,
    h('h5', {}, `Questions and answers (${answers.length})`),
    answers.length
      ? h('dl', { class: 'qa' }, answers.map((x) => [h('dt', {}, String(x.question ?? '')),
        isPrivateAnswer(x)
          ? h('dd', { class: 'muted' }, x.answer === undefined || x.answer === null || x.answer === '' ? 'Not answered' : 'Answered — private, not shown here')
          : h('dd', { class: 'prewrap' }, Array.isArray(x.answer) ? x.answer.join(', ') : String(x.answer ?? ''))]))
      : h('p', { class: 'muted' }, 'No questions recorded.'),
    s.receipt ? [h('h5', {}, 'Confirmation'), h('p', { class: 'prewrap' }, typeof s.receipt === 'string' ? s.receipt : JSON.stringify(s.receipt, null, 2))] : null,
    gaps.length ? [h('h5', {}, 'Not captured'), h('ul', {}, gaps.map((g) => h('li', {}, String(g))))] : null)
}

// ---------------------------------------------------------------- Experience strength
function experienceView() {
  const el = viewShell('Experience strength', 'How complete each of your stories is. Strong stories say where you were, what needed doing, what you did, what changed, with a dated number and something that backs it up.')
  const summaryBox = h('div')
  const itemsBox = h('div')
  const otherBox = h('div')
  const materialsBox = h('div')
  el.append(
    card('Your stories, weakest first', [summaryBox, itemsBox], { id: 'strength' }),
    card('Other career library items', otherBox, { intro: 'Education, skills, publications and other facts your assistant may use.' }),
    card('Documents', materialsBox, { intro: 'Resumes, cover letters and answers your assistant has saved. Each change is kept as a new version.' }))

  function update() {
    const st = strength()
    rerender(summaryBox, st.total ? strengthSummary() : null)
    rerender(itemsBox, st.total
      ? h('ul', { class: 'item-list' }, st.items.map((it) => storyItem(it, findEvidence(it.id))))
      : [empty('Nothing to score yet.'), ask('interview me about my experience', 'To start, tell your assistant:')])

    const scored = new Set(st.items.map((x) => x.id))
    const others = (state.data.evidence || []).filter((e) => !scored.has(e.id))
    rerender(otherBox, others.length
      ? h('ul', { class: 'item-list' }, others.map((e) => storyItem(null, e)))
      : empty('None yet.'), ask('import my documents', 'To add more, put files in “2 Career Library” and tell your assistant:'))

    const materials = state.data.materials || []
    rerender(materialsBox, materials.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'simple-table' },
        h('caption', { class: 'sr-only' }, 'Documents'),
        h('thead', {}, h('tr', {}, ['Title', 'Type', 'Version', 'Status', 'Last changed'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, materials.map((m) => {
          const [label, tone] = MATERIAL_STATUS[m.reviewStatus] || [m.reviewStatus || 'Draft', 'muted']
          const forJob = m.applicationId && findApp(m.applicationId)
          return h('tr', { ...recentAttrs(state.changed.get(`material:${m.id}`)) },
            h('td', { 'data-label': 'Title' }, h('span', { class: 'strong' }, m.title), isRecent('material', m.id) ? recentMark() : null, forJob ? h('span', { class: 'job-meta' }, `For ${jobName(forJob)}`) : null,
              m.file?.name ? h('span', { class: 'job-meta' }, `File: ${m.file.name}`) : null),
            h('td', { 'data-label': 'Type' }, MATERIAL_KINDS[m.kind] || m.kind),
            h('td', { 'data-label': 'Version' }, String(m.version)),
            h('td', { 'data-label': 'Status' }, badge(label, tone)),
            h('td', { 'data-label': 'Last changed' }, formatWhen(m.updatedAt)))
        }))))
      : empty('No documents yet.'))
  }
  return { el, update }
}

/** One story (scored) or library item (unscored), with read-only details on demand. */
function storyItem(it, e) {
  const id = it?.id || e?.id
  const title = it?.title || e?.title || 'Untitled'
  const key = `ev-${id}`
  const open = state.expanded.has(key)
  const panelId = `ev-panel-${slug(id)}`
  const score = it ? Number(it.score) || 0 : null
  const missing = Array.isArray(it?.missing) ? it.missing : []
  const review = REVIEW_STATUS[e?.reviewStatus || it?.reviewStatus]
  return h('li', { class: 'item', ...recentAttrs(state.changed.get(`evidence:${id}`)) },
    h('div', { class: 'item-head' },
      h('h3', { class: 'item-title' }, title),
      h('span', { class: 'chips' },
        score === 100 ? badge('Complete', 'ok') : null,
        review ? badge(review[0], review[1]) : null,
        isRecent('evidence', id) ? recentMark() : null)),
    h('p', { class: 'muted' }, [EVIDENCE_KIND_SINGULAR[it?.kind || e?.kind] || '', e?.organization || it?.organization, e?.period || it?.period].filter(Boolean).join(' · ')),
    it ? meter(score, `Strength of “${title}”`) : null,
    missing.length ? h('ul', { class: 'tags missing', 'aria-label': 'Still missing' }, missing.map((m) => h('li', {}, MISSING_LABELS[m] || m))) : null,
    e ? toggleButton(key, [open ? 'Hide details' : 'Show details', h('span', { class: 'sr-only' }, ` for ${title}`)], panelId) : null,
    open && e ? h('div', { class: 'details', id: panelId }, evidenceDetails(e)) : null,
    e?.reviewStatus === 'disputed' ? ask(`my documents disagree about “${title}”`, 'To clear it up, tell your assistant:')
      : it && score < 100 ? ask(`interview me about ${title}`, 'To strengthen it, tell your assistant:') : null)
}

function evidenceDetails(e) {
  const star = e.star || {}
  const metrics = Array.isArray(e.metrics) ? e.metrics : []
  const sources = Array.isArray(e.sources) ? e.sources : []
  return [
    longText('In your words', e.content),
    STAR_PARTS.some(([k]) => star[k])
      ? h('dl', { class: 'facts star-facts' }, STAR_PARTS.map(([k, label]) => [h('dt', {}, label), h('dd', { class: star[k] ? 'prewrap' : 'muted' }, star[k] || 'Not described yet')]))
      : h('p', { class: 'muted' }, 'The story has not been broken into situation, task, action and result yet.'),
    h('h4', {}, 'Numbers'),
    metrics.length
      ? h('ul', {}, metrics.map((m) => h('li', {}, [m.value, m.unit].filter(Boolean).join(' '), m.period ? ` (${m.period})` : h('span', { class: 'muted' }, ' (no date yet)'),
        m.baseline ? ` — compared with ${m.baseline}` : '', m.note ? ` — ${m.note}` : '')))
      : h('p', { class: 'muted' }, 'None yet.'),
    h('h4', {}, 'Where it can be checked'),
    sources.length || e.source
      ? h('ul', {}, [...sources.map((s) => h('li', {}, [s.label, s.locator].filter(Boolean).join(' — ') || 'Source')), e.source ? h('li', {}, e.source) : null])
      : h('p', { class: 'muted' }, 'Nothing yet.'),
    e.skills?.length ? h('ul', { class: 'tags', 'aria-label': 'Skills' }, e.skills.map((s) => h('li', {}, s))) : null,
    e.bullets?.length ? [h('h4', {}, 'Saved bullets'), h('ul', {}, e.bullets.map((b) => h('li', {}, b.text)))] : null,
    e.gapsNoted?.length ? [h('h4', {}, 'Gaps noted'), h('ul', {}, e.gapsNoted.map((g) => h('li', {}, String(g))))] : null,
    h('p', { class: 'item-meta' }, `Last changed ${formatWhen(e.updatedAt)} · version ${e.version}`),
  ]
}

// ---------------------------------------------------------------- Employers
function employersView() {
  const el = viewShell('Employers', 'Places you might like to work, grouped by sector, with links to their job pages.')
  const search = h('input', {
    type: 'search', id: 'employer-search', placeholder: 'Name, sector or notes', value: state.employerQuery,
    oninput: (e) => { state.employerQuery = e.currentTarget.value; renderList() },
  })
  const listBox = h('div')
  const countText = h('p', { class: 'muted result-count', role: 'status' })
  const guideBox = h('div')
  el.append(
    card('Your employers', [
      h('div', { class: 'toolbar' }, h('div', { class: 'field grow' }, h('label', { for: 'employer-search' }, 'Search'), search)),
      ask('help me add employers I would like to work for', 'To add more, tell your assistant:'),
      countText, listBox]),
    card('Starter lists', guideBox, { intro: 'Ready-made lists of employers by sector that your assistant can add for you.' }))

  async function loadGuide() {
    state.guide = { status: 'loading' }
    renderGuide()
    try {
      const guide = await api('/guides/employers')
      if (!Array.isArray(guide?.sectors)) throw new Error('unexpected format')
      state.guide = { status: 'ready', sectors: guide.sectors }
    } catch {
      state.guide = { status: 'error' }
    }
    renderGuide()
  }

  function renderGuide() {
    const g = state.guide
    if (!g) { loadGuide(); return }
    if (g.status === 'loading') { rerender(guideBox, h('p', { class: 'muted', role: 'status' }, 'Loading…')); return }
    if (g.status === 'error') { rerender(guideBox, h('p', { class: 'muted' }, 'The starter lists are not available in this version.')); return }
    const have = new Set((state.data?.employers || []).map((e) => e.id))
    rerender(guideBox, h('ul', { class: 'item-list' }, g.sectors.map((s) => {
      const list = Array.isArray(s.employers) ? s.employers : []
      const already = list.filter((e) => e?.name && have.has(slug(e.name))).length
      const name = s.sector || s.id || 'Sector'
      return h('li', { class: 'item' },
        h('div', { class: 'item-head' }, h('h3', { class: 'item-title' }, name),
          badge(already === list.length && list.length ? 'All added' : `${list.length - already} not added yet`, already === list.length && list.length ? 'ok' : 'muted')),
        s.description ? h('p', { class: 'muted' }, s.description) : null,
        already < list.length ? ask(`add the starter employers for ${name}`, 'To add them, tell your assistant:') : null)
    })))
  }

  function renderList() {
    const employers = state.data?.employers || []
    const needle = state.employerQuery.trim().toLowerCase()
    const rows = needle ? employers.filter((e) => `${e.name} ${e.sector || ''} ${e.notes || ''} ${e.locations || ''}`.toLowerCase().includes(needle)) : employers
    countText.textContent = employers.length ? `Showing ${rows.length} of ${employers.length}` : ''
    const jobsBy = new Map()
    for (const a of apps()) { const k = String(a.company || '').toLowerCase(); jobsBy.set(k, (jobsBy.get(k) || 0) + 1) }
    const sectors = [...new Set(rows.map((e) => e.sector || 'Other'))].sort((a, b) => a.localeCompare(b))
    rerender(listBox, rows.length
      ? sectors.map((sector) => {
        const group = rows.filter((e) => (e.sector || 'Other') === sector).sort((a, b) => String(a.name).localeCompare(String(b.name)))
        return h('div', { class: 'group' },
          h('h3', { class: 'group-title' }, sector, h('span', { class: 'group-count' }, ` (${group.length})`)),
          h('ul', { class: 'employer-grid' }, group.map((e) => {
            const jobs = jobsBy.get(String(e.name).toLowerCase()) || 0
            return h('li', { class: 'item', ...recentAttrs(state.changed.get(`employer:${e.id}`)) },
              h('div', { class: 'item-head' }, h('h4', {}, e.name), e.platform ? badge(e.platform, 'info') : null),
              e.locations ? h('p', { class: 'muted' }, e.locations) : null,
              e.notes ? h('p', { class: 'clamp' }, e.notes) : null,
              h('p', { class: 'item-meta link-row' },
                extLink(e.careersUrl, 'Job page ↗', `jobs-${e.id}`), extLink(e.website, 'Website ↗', `site-${e.id}`),
                jobs ? h('span', {}, `${jobs} opportunit${jobs === 1 ? 'y' : 'ies'}`) : null))
          })))
      })
      : empty(employers.length ? 'No employers match your search.' : 'No employers yet.'))
  }

  function update() { renderList(); renderGuide() }
  return { el, update }
}

// ---------------------------------------------------------------- Writing rules
function rulesView() {
  const el = viewShell('Writing rules', 'How your assistant writes your resumes, cover letters and answers. New suggestions are not used until you approve them.')
  const box = h('div')
  el.append(box)
  function ruleItem(r) {
    const recent = isRecent('rule', r.id)
    return h('li', { class: 'item', ...recentAttrs(state.changed.get(`rule:${r.id}`)) },
      h('div', { class: 'item-head' }, h('h3', { class: 'item-title' }, r.title), h('span', { class: 'chips' }, recent ? recentMark() : null, h('span', { class: 'item-meta' }, `Version ${r.version}`))),
      h('p', {}, r.rule),
      r.status === 'proposed' && r.active ? h('div', { class: 'callout' },
        h('p', { class: 'strong' }, 'This is new wording. Until you approve it, your assistant keeps using:'),
        h('p', {}, r.active.rule)) : null,
      r.whenRelevant ? h('p', { class: 'muted' }, h('span', { class: 'strong' }, 'When: '), r.whenRelevant) : null,
      r.example ? h('p', { class: 'muted' }, h('span', { class: 'strong' }, 'Example: '), r.example) : null,
      r.status === 'retired' && r.retiredReason ? h('p', { class: 'muted' }, h('span', { class: 'strong' }, 'Retired because: '), r.retiredReason) : null,
      r.status === 'proposed' ? ask(`approve the writing rule “${r.title}”`, 'To use it, tell your assistant:')
        : r.status === 'retired' ? null : ask(`retire the writing rule “${r.title}”`, 'To stop using it, tell your assistant (and say why):'))
  }
  function update() {
    const rules = state.data.rules || []
    rerender(box, rules.length
      ? RULE_GROUPS.map(([status, title, intro]) => {
        const rows = rules.filter((r) => r.status === status)
        if (!rows.length) return null
        const key = `rules-${status}`
        const collapsed = status === 'retired' && !state.expanded.has(key)
        return card(`${title} (${rows.length})`, [
          status === 'retired' ? toggleButton(key, collapsed ? 'Show retired rules' : 'Hide retired rules', `${key}-list`) : null,
          collapsed ? null : h('ul', { class: 'item-list', id: `${key}-list` }, rows.map(ruleItem))], { intro, id: key })
      })
      : empty('No writing rules yet.'))
  }
  return { el, update }
}

// ---------------------------------------------------------------- Profile and settings
function profileView() {
  const el = viewShell('Profile and settings', 'What your assistant knows about you and how it works for you. To change anything, tell your assistant.')
  const profileBox = h('div')
  const modeBox = h('div')
  const questionsBox = h('div')
  const stepsBox = h('div')
  const storageBox = h('div')
  const backupsBox = h('div')
  el.append(
    card('Your profile', profileBox),
    card('Submitting applications', modeBox),
    card('Common application questions', questionsBox, { intro: 'Questions that appear on most application forms. Private answers are never shown here.' }),
    card('Getting started', stepsBox),
    card('Storage and backups', [
      h('p', { class: 'muted card-intro' }, 'What this workspace keeps on your computer. The app never deletes anything.'),
      h('div', { class: 'callout' }, h('p', {}, 'Your assistant can move clearable items into ', h('span', { class: 'strong' }, 'Archive/Clearable'), '; you delete that folder yourself.')),
      storageBox,
      h('h3', { class: 'group-title' }, 'Backups'),
      backupsBox,
      ask('back up my data now', 'To make a backup now, tell your assistant:'),
      h('p', {}, h('button', { type: 'button', class: 'btn btn-small', onclick: () => loadStorage() }, 'Check sizes again'))], { id: 'storage' }))

  let storageSeq = 0
  let storageAt = 0
  async function loadStorage() {
    const seq = ++storageSeq
    storageAt = Date.now()
    if (!storageBox.childNodes.length) rerender(storageBox, h('p', { class: 'muted' }, 'Checking…'))
    try {
      const [st, backups] = await Promise.all([api('/storage'), api('/backups')])
      if (seq !== storageSeq) return
      renderStorage(st)
      renderBackups(backups)
    } catch (err) {
      if (seq === storageSeq) rerender(storageBox, h('p', { class: 'muted' }, `Couldn’t check storage: ${err.message}`))
    }
  }

  function renderStorage(st) {
    if (st?.demo) { rerender(storageBox, empty('The demo workspace keeps no files of its own. Open your real dashboard to see your storage.')); return }
    const items = Array.isArray(st?.items) ? st.items : []
    if (!items.length) { rerender(storageBox, empty('Nothing stored yet.')); return }
    rerender(storageBox, h('div', { class: 'table-wrap' }, h('table', { class: 'simple-table storage-table' },
      h('caption', { class: 'sr-only' }, 'Storage use'),
      h('thead', {}, h('tr', {}, ['What', 'Size', 'Files', 'Can it be cleared?', 'Where'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, items.map((i) => {
        const status = String(i.status || '')
        const clearable = /clearable|safe to delete/i.test(status) && !/^essential/i.test(status)
        return h('tr', {},
          h('td', { 'data-label': 'What' }, h('span', { class: 'strong' }, i.label)),
          h('td', { 'data-label': 'Size' }, i.size || formatBytes(i.bytes)),
          h('td', { 'data-label': 'Files' }, String(i.files ?? '')),
          h('td', { 'data-label': 'Can it be cleared?' }, badge(clearable ? 'Can be cleared' : 'Keep', clearable ? 'warn' : 'ok'), ' ', h('span', { class: 'muted' }, status)),
          h('td', { 'data-label': 'Where', class: 'path' }, i.path || ''))
      })))),
    st.total ? h('p', { class: 'muted' }, `Total: ${st.total}`) : null,
    items.some((i) => /clearable/i.test(String(i.status || '')) && Number(i.bytes) > 0) ? ask('move clearable files to the archive', 'To tidy up, tell your assistant:') : null)
  }

  function renderBackups(backups) {
    const list = Array.isArray(backups) ? backups : []
    rerender(backupsBox, list.length
      ? h('ul', { class: 'plain-list backups' }, list.slice(0, 20).map((b) => h('li', {},
        h('span', { class: 'strong' }, formatDateTime(b.createdAt)), h('span', { class: 'muted' }, ` · ${formatBytes(b.bytes)} · ${b.name}`))))
      : empty(state.meta?.demo ? 'Backups are not made for the demo workspace.' : 'No backups yet. One is made automatically each day.'),
    list.length > 20 ? h('p', { class: 'muted' }, `And ${list.length - 20} older backups.`) : null)
  }

  function update() {
    const p = state.data.profile || {}
    const list = (v) => (Array.isArray(v) ? v.join(', ') : v)
    const profileFacts = factList([
        ['Name', p.name], ['Called', p.preferredName], ['Email', p.email], ['Phone', p.phone], ['City', p.city],
        ['Summary', p.headline], ['Kinds of work', list(p.disciplines)], ['Places', list(p.locations)],
        ['Work arrangements', list(p.workModels)], ['Job type preferences', p.employmentPreferences], ['Search notes', p.searchNotes],
        ['Links', Array.isArray(p.links) ? h('span', { class: 'link-row' }, p.links.map((l, i) => extLink(typeof l === 'string' ? l : l?.url, typeof l === 'string' ? l : l?.label || l?.url, `plink-${i}`))) : list(p.links)],
      ])
    const hasProfile = Boolean(profileFacts)
    rerender(profileBox, profileFacts || empty('Your profile is empty.'),
    ask(hasProfile ? 'update my profile' : 'set up my profile', hasProfile ? 'To change it, tell your assistant:' : 'To fill it in, tell your assistant:'))

    const mode = p.submissionMode || 'review-first'
    rerender(modeBox,
      h('p', { class: 'mode' }, h('span', { class: 'strong' }, mode === 'auto-submit' ? 'Submit for me without asking.' : 'Stop and show me before submitting.'),
        p.submissionMode ? null : h('span', { class: 'muted' }, ' (the default)')),
      h('p', {}, mode === 'auto-submit'
        ? 'Your assistant submits when everything is ready and tells you afterwards.'
        : 'Your assistant fills in each application, then waits for you to check it and say “submit”.'),
      h('p', { class: 'muted' }, 'Either way, your assistant always stops and asks you when a form has a question you have not answered yet.'),
      ask(mode === 'auto-submit' ? 'stop and show me applications before submitting' : 'submit applications for me without asking'))

    const sa = answersInfo()
    const questions = Array.isArray(sa.questions) ? sa.questions : []
    const groups = []
    for (const q of questions) {
      let g = groups.find((x) => x.category === (q.category || 'Other'))
      if (!g) groups.push(g = { category: q.category || 'Other', items: [] })
      g.items.push(q)
    }
    const answered = (q) => q.answer !== undefined && q.answer !== null && q.answer !== '' && !(Array.isArray(q.answer) && !q.answer.length)
    const missing = new Set(sa.missingRequired || [])
    rerender(questionsBox,
      questions.length ? h('p', { class: missing.size ? 'notice notice-warn' : 'notice notice-info' },
        `${questions.filter((q) => (q.required ? !missing.has(q.id) : answered(q))).length} of ${questions.length} answered.`,
        missing.size ? ` ${missing.size} required question${missing.size === 1 ? '' : 's'} still need an answer.` : ' All required questions are answered.') : empty('The question list is not available in this version.'),
      groups.map((g) => {
        const key = `qgroup-${slug(g.category)}`
        const open = state.expanded.has(key)
        const done = g.items.filter((q) => (q.required ? !missing.has(q.id) : answered(q))).length
        return h('div', { class: 'group' },
          toggleButton(key, `${g.category} — ${done} of ${g.items.length} answered`, `${key}-list`),
          open ? h('ul', { class: 'q-list', id: `${key}-list` }, g.items.map((q) => {
            const private_ = q.sensitive || q.voluntary
            const has = q.required ? !missing.has(q.id) : answered(q)
            return h('li', { class: missing.has(q.id) ? 'missing' : '' },
              h('span', { class: 'q-text' }, q.question, q.required ? h('span', { class: 'req' }, ' (required)') : null),
              h('span', { class: 'q-answer' },
                has ? badge('Answered', 'ok') : badge(q.required ? 'Needs an answer' : 'Not answered', q.required ? 'warn' : 'muted'),
                has && !private_ ? h('span', { class: 'answer-text' }, Array.isArray(q.answer) ? q.answer.join(', ') : String(q.answer)) : null,
                has && private_ ? h('span', { class: 'muted' }, ' Private — not shown here.') : null))
          })) : null)
      }),
      Array.isArray(sa.custom) && sa.custom.length
        ? h('p', { class: 'muted' }, `Your assistant has also saved ${sa.custom.length} answer${sa.custom.length === 1 ? '' : 's'} to questions from real forms (not shown here).`) : null,
      ask(missing.size ? 'go through the common application questions with me' : 'help me review my application answers', missing.size ? 'To finish them, tell your assistant:' : 'To change an answer, tell your assistant:'))

    rerender(stepsBox, stepsList(onboardingSteps()))
    if (Date.now() - storageAt > 60000) loadStorage()
  }
  return { el, update, onShow: () => { storageAt = 0 } }
}

// ---------------------------------------------------------------- router
const VIEWS = { overview: overviewView, jobs: jobsView, experience: experienceView, employers: employersView, rules: rulesView, profile: profileView }
const VIEW_TITLES = { overview: 'Overview', jobs: 'Opportunities', experience: 'Experience strength', employers: 'Employers', rules: 'Writing rules', profile: 'Profile and settings' }
const viewCache = new Map()

function viewFromHash() {
  const name = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return Object.hasOwn(VIEWS, name) ? name : 'overview'
}

function render({ focus = false } = {}) {
  state.view = viewFromHash()
  for (const a of document.querySelectorAll('.sidenav a')) {
    if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
  const main = document.getElementById('main')
  if (!state.data) {
    current = null
    main.replaceChildren(h('p', { class: 'empty', role: 'status' }, state.online ? 'Loading your workspace…' : 'Waiting for the dashboard to respond…'))
    return
  }
  if (!viewCache.has(state.view)) viewCache.set(state.view, VIEWS[state.view]())
  current = viewCache.get(state.view)
  if (main.firstElementChild !== current.el) main.replaceChildren(current.el)
  current.onShow?.()
  redraw()
  if (focus) current.el.querySelector('h1')?.focus()
}

function setTitle() {
  const base = state.meta?.demo ? 'Demo — Ultimate Application Spammer' : 'Ultimate Application Spammer'
  document.title = `${VIEW_TITLES[viewFromHash()]} · ${base}`
}

document.querySelector('.skip-link').addEventListener('click', (e) => {
  e.preventDefault()
  document.getElementById('main').focus()
})
window.addEventListener('hashchange', () => {
  render({ focus: true })
  setTitle()
  window.scrollTo(0, 0)
})

// ---------------------------------------------------------------- start
render()
setTitle()
refresh({ force: true }).then(checkUpdate)
setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 15000)
setInterval(showSyncStatus, 5000)
setInterval(checkUpdate, 6 * 60 * 60 * 1000)
window.addEventListener('focus', () => refresh())
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
