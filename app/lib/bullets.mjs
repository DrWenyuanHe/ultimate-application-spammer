import { cautions } from './match.mjs'

// Notes on resume bullets. These are hints for the agent to act on, never errors: they do not
// block a document and the person is not asked about them.
const MAX_WORDS = 42
const MAX_PER_ENTRY = 8
const WEAK = /^(responsible for|duties included|tasked with|in charge of|helped( to)?|assisted (with|in)|worked on|involved in|participated in|was part of|contributed to)\b/i
const OUTCOME = /\b(leading to|lead to|co-?authored|co-?authoring|first-authored|presented|negotiated|signed|still in use|now used|replac(ed|ing)|led to|result(ed|ing) in|adopted|published|publication|award(ed)?|funded|funding|secured|won|reduc(ed|ing)|increas(ed|ing)|grew|raised|cut|saved|improv(ed|ing)|used by|users?|reached|delivered|launched|closed|approved|accepted|enrol(l)?ed|completed)\b/i

export const plain = (v) => String(v ?? '').replace(/\*\*/g, '').replace(/(^|\s)\*(\S[^*]*)\*/g, '$1$2').trim()
export const bulletText = (b) => (b && typeof b === 'object' ? String(b.text ?? '') : String(b ?? ''))
const refId = (r) => (r && typeof r === 'object' ? r.id : r)
const ids = (b) => (b && typeof b === 'object' ? [b.evidence, b.evidenceRefs].flat().filter(Boolean).map(refId) : [])

/** The same content with plain-text bullets, ready to render. */
export function flattenBullets(content) {
  if (!Array.isArray(content?.sections)) return content
  return {
    ...content,
    sections: content.sections.map((s) => ({
      ...s, ...(s.bullets ? { bullets: s.bullets.map(bulletText) } : {}),
      ...(s.entries ? { entries: s.entries.map((e) => ({ ...e, ...(e.bullets ? { bullets: e.bullets.map(bulletText) } : {}) })) } : {}),
    })),
  }
}

function groups(content) {
  return (Array.isArray(content?.sections) ? content.sections : []).flatMap((s) => [
    ...(s.entries || []).map((e) => ({ label: [e.title, e.organization].filter(Boolean).join(', ') || s.heading, entryIds: [e.evidenceId, e.evidence].flat().filter(Boolean).map(refId), bullets: e.bullets || [], type: s.type })),
    ...(s.bullets?.length ? [{ label: s.heading, entryIds: [], bullets: s.bullets, type: s.type }] : []),
  ])
}

/** Every evidence id the content names, on entries or single bullets. */
export function citedEvidence(content) {
  const sections = (Array.isArray(content?.sections) ? content.sections : []).flatMap((s) => [s.evidence].flat().filter(Boolean).map(refId))
  return [...new Set([...sections, ...groups(content).flatMap((g) => [...g.entryIds, ...g.bullets.flatMap(ids)])])]
}

const WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50 }
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.]?'
const DATES = new RegExp(String.raw`\b${MONTH} \d{1,2}(?:\s*[–-]\s*(?:${MONTH} )?\d{1,2})?(?!\d)|\b\d{1,2} ${MONTH}`, 'g')
// Numbers as written (1,000 = 1000; three = 3). Days and years are left to the date rules.
const numbers = (v) => [
  ...(String(v).replace(DATES, ' ').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, '')).filter((n) => n && !/^(19|20)\d{2}$/.test(n)),
  ...(String(v).toLowerCase().match(/[a-z]+/g) || []).filter((w) => Object.hasOwn(WORDS, w)).map((w) => String(WORDS[w])),
]
const evidenceText = (e) => JSON.stringify([e.title, e.content, e.period, e.star, e.metrics, e.bullets, e.publication])

const QUALIFIER = /\b(approximately|about|around|roughly|nearly|almost|up to|at least|estimated|analy[sz]able|baseline|eligible|screened|cumulative|self-reported)\b/i
const contentWords = (v) => new Set((String(v).toLowerCase().match(/[a-z]{5,}/g) || []).map((w) => w.replace(/(ships|ship|ings|ing|ers|ed|s)$/, '')))

/** Sentences anywhere in the library that limit a number this bullet uses. */
function numberWarnings(text, evidence) {
  const wanted = numbers(text)
  const words = contentWords(text)
  return evidence.flatMap((e) => cautions(e, 40).flatMap((c) => {
    const hit = numbers(c).find((x) => wanted.includes(x) && Number(x) > 12)
    if (!hit || !/unconfirmed|not (?:been )?(?:established|confirmed|verified|reconfirmed)|does not (?:establish|verify)|supersed|should not be (?:used|reused)|do not (?:use|reuse|restate)|omitted|requir\w* review|needs? review/i.test(c)) return []
    return [...contentWords(c)].some((w) => words.has(w)) ? [{ number: hit, title: e.title, caution: c }] : []
  }))
}

/** Qualifiers the record puts on a number that the bullet leaves off. */
function droppedQualifiers(text, pool) {
  const out = []
  const source = pool.map((e) => [e.title, e.content, ...Object.values(e.star || {}), ...(e.metrics || []).flatMap((m) => [`${m.value} ${m.unit || ''}`, m.note])].join(' ')).join(' ')
  for (const m of source.matchAll(/((?:[a-z-]+ ){0,2})(\d[\d,]*)((?:[ -][a-z-]+){0,3})/gi)) {
    const n = m[2].replace(/,/g, '')
    if (/^(19|20)\d{2}$/.test(n) || Number(n) < 3 || !numbers(text).includes(n)) continue
    const q = QUALIFIER.exec(`${m[1]} ${m[3]}`)
    if (q && !text.toLowerCase().includes(q[1].toLowerCase()) && !out.some((x) => x.n === n)) out.push({ n, q: q[1].toLowerCase(), phrase: m[0].trim() })
  }
  return out
}

/** Notes on every bullet: [{ where, bullet?, code, note }]. */
export function checkBullets(content, evidence = []) {
  const byId = new Map(evidence.map((e) => [e.id, e]))
  const children = (id) => evidence.filter((e) => e.parentId === id)
  const notes = []
  const firstWords = new Map()
  const add = (where, bullet, code, note) => notes.push({ where, bullet, code, note })
  for (const g of groups(content)) {
    if (g.type === 'education') continue
    const opened = new Map()
    let outcome = false
    for (const raw of g.bullets) {
      const text = plain(bulletText(raw))
      if (!text) { add(g.label, text, 'empty', 'This bullet is empty.'); continue }
      const words = text.split(/\s+/)
      if (words.length > MAX_WORDS) add(g.label, text, 'long', `${words.length} words. Split it or cut to the main point (about 20 to 35 words).`)
      if (WEAK.test(text)) add(g.label, text, 'weak-start', 'Starts with a duty. Start with what the person did.')
      if (/(^|[\s(])(I|I'm|I've|my|we|our|us)(?=[\s,.;])/.test(text)) add(g.label, text, 'first-person', 'Resume bullets leave out I, my, we and our.')
      if (text.includes(';')) add(g.label, text, 'semicolon', 'Two ideas joined with a semicolon. Use two bullets or one sentence.')
      const opener = words[0].toLowerCase().replace(/[^a-z]/g, '')
      opened.set(opener, (opened.get(opener) || 0) + 1)
      firstWords.set(opener, (firstWords.get(opener) || 0) + 1)
      if (numbers(text).length || OUTCOME.test(text)) outcome = true

      const cited = ids(raw).length ? ids(raw) : g.entryIds
      const known = cited.map((id) => byId.get(id)).filter(Boolean)
      for (const id of cited) if (!byId.has(id)) add(g.label, text, 'unknown-evidence', `No career-library record ${id}.`)
      for (const e of known) if (['disputed', 'outdated'].includes(e.reviewStatus)) add(g.label, text, 'set-aside', `Cites "${e.title}", which is marked ${e.reviewStatus}.`)
      if (!known.length) {
        if (evidence.length && !cited.length) add(g.label, text, 'no-evidence', 'No career-library record is named for this bullet.')
        continue
      }
      const pool = known.flatMap((e) => [e, ...children(e.id), ...(byId.get(e.parentId) ? [byId.get(e.parentId)] : [])])
      const have = new Set(numbers(pool.map(evidenceText).join(' ')))
      const missing = numbers(text).filter((x) => !have.has(x))
      if (missing.length) add(g.label, text, 'number-not-in-evidence', `${missing.join(', ')} is not in the named evidence. Check it against the source or cite the right record.`)
      for (const w of numberWarnings(text, evidence).slice(0, 2)) add(g.label, text, 'number-in-doubt', `${w.number}: "${w.title}" says "${w.caution.slice(0, 200)}" Leave the number out unless that is about something else.`)
      for (const d of droppedQualifiers(text, known).slice(0, 2)) add(g.label, text, 'qualifier', `The record says "${d.phrase}". Keep "${d.q}".`)
      const dated = pool.flatMap((e) => e.metrics || []).find((m) => m.period && numbers(m.value).some((x) => numbers(text).includes(x)))
      if (dated && !/\b(19|20)\d{2}\b/.test(text)) add(g.label, text, 'date-the-number', `The record dates this number: ${dated.period}.`)
    }
    for (const [word, count] of opened) if (word && count > 2) add(g.label, undefined, 'repeated-start', `${count} bullets start with "${word}". Vary them.`)
    if (g.bullets.length > MAX_PER_ENTRY) add(g.label, undefined, 'many-bullets', `${g.bullets.length} bullets. Keep the ones that answer this posting.`)
    if (g.bullets.length && !outcome) {
      const pool = [...g.entryIds, ...g.bullets.flatMap(ids)].flatMap((id) => [byId.get(id), ...children(id)]).filter(Boolean)
      const unused = pool.find((e) => e.star?.result || e.metrics?.length)
      add(g.label, undefined, 'no-outcome', unused ? `No bullet says what came of the work. "${unused.title}" records a result you could use.` : 'No bullet says what came of the work. Use a result from the record if there is one.')
    }
  }
  for (const [word, count] of firstWords) if (word && count > 3 && !notes.some((x) => x.code === 'repeated-start' && x.note.includes(`"${word}"`))) add('Whole resume', undefined, 'repeated-start', `${count} bullets start with "${word}". Vary them.`)
  // Numbers in the summary, intros and paragraphs must also be somewhere in the library.
  if (evidence.length) {
    const all = new Set(numbers(evidence.filter((e) => !['disputed', 'outdated'].includes(e.reviewStatus)).map(evidenceText).join(' ')))
    const loose = [['Summary', content?.summary], ['Tagline', content?.tagline], ...(Array.isArray(content?.sections) ? content.sections : []).flatMap((s) => [[s.heading, s.intro], ...(s.paragraphs || []).map((p) => [s.heading, p]), ...(s.entries || []).map((e) => [e.title, e.note])])]
    for (const [where, value] of loose) {
      const missing = numbers(plain(value)).filter((x) => !all.has(x))
      if (missing.length) add(where, plain(value), 'number-not-in-evidence', `${missing.join(', ')} is not in the career library.`)
    }
  }
  const total = groups(content).filter((g) => g.type !== 'education').reduce((sum, g) => sum + g.bullets.length, 0)
  if (total > 24) add('Whole resume', undefined, 'many-bullets', `${total} bullets in all. Two pages hold about 18 to 24 that a reader will take in. Cut or merge the ones that answer the posting least.`)
  return notes
}
