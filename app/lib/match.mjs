// Helps an agent read a large career library for one posting: which facts use the posting's words,
// what each record warns against, and a short form of long records. Hints only.

const STOP = new Set('a an the and or of to in on for with by from at as is are was were be been being this that these those it its their our your his her they we you i will would can may must should not no than then into over under across within about per via etc who which what when where how all any each other such both more most least minimum required preferred asset experience experienced work working role position including include includes strong excellent ability skills skill knowledge relevant related team candidate successful one two three four five six seven eight nine ten week month year range number new'.split(' '))

const stem = (w) => w.replace(/(?:ations?|ments?|ings?|ers?|ies|es|ed|s)$/, '')
const terms = (v) => (String(v || '').toLowerCase().normalize('NFKD').match(/[a-z][a-z0-9+#-]{2,}/g) || []).filter((w) => !STOP.has(w))
const body = (e) => [e.title, e.title, e.content, e.organization, ...(e.skills || []), ...Object.values(e.star || {}), ...(e.bullets || []).map((b) => b.text)].join(' ')

// Terms of employment say nothing about fit.
const BOILERPLATE = /^\W*(?:union|number of vacancies|new or replacement|site|department|reports to|salary|hours|shifts?|status|closing date|compensation|benefits|location)\b[^\n]{0,160}$/gim

/** Evidence that shares the posting's distinctive words, best first. A starting point, not a verdict. */
export function rankEvidence(posting, evidence, limit = 25) {
  const wanted = new Map()
  for (const w of terms(String(posting || '').replace(BOILERPLATE, ' '))) if (stem(w).length > 2) wanted.set(stem(w), w)
  if (!wanted.size) return []
  const docs = evidence.map((e) => {
    const counts = new Map()
    for (const w of terms(body(e))) counts.set(stem(w), (counts.get(stem(w)) || 0) + 1)
    return { e, counts, size: [...counts.values()].reduce((a, b) => a + b, 0) }
  })
  const average = docs.reduce((a, d) => a + d.size, 0) / Math.max(1, docs.length) || 1
  const df = new Map([...wanted.keys()].map((t) => [t, docs.filter((d) => d.counts.has(t)).length]))
  return docs.map(({ e, counts, size }) => {
    const hits = [...wanted.keys()].filter((t) => counts.has(t)).map((t) => ({ t, s: Math.log(1 + docs.length / df.get(t)) * (counts.get(t) * 2.2) / (counts.get(t) + 1.2 * (0.25 + 0.75 * size / average)) }))
    return { id: e.id, title: e.title, kind: e.kind, score: Number(hits.reduce((a, h) => a + h.s, 0).toFixed(1)), words: hits.sort((a, b) => b.s - a.s).slice(0, 6).map((h) => wanted.get(h.t)) }
  }).filter((x) => x.score > 0 && x.words.length > 1).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}

const CAUTION = /\b(do(?:es)? not|don't|should not|not (?:been )?(?:established|supplied|confirmed|specified|verified|known|stated|documented|reconfirmed|published|accepted)|unconfirmed|unverified|requir\w* review|needs? review|supersed\w*|remains? (?:unknown|open|pending)|omitted|exclud\w+|never|rather than|no exact|was not|were not|is not|are not)\b/i

/** Sentences in a record that limit what may be claimed, plus its noted gaps. */
export function cautions(e, limit = 8) {
  const found = String(e.content || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 12 && CAUTION.test(s)).map((s) => s.slice(0, 320))
  const doubted = (e.metrics || []).filter((m) => m.doubt).map((m) => `${[m.value, m.unit].filter(Boolean).join(' ')} is unconfirmed: ${m.doubt}`)
  return [...new Set([...doubted, ...(e.gapsNoted || []), ...found])].slice(0, limit)
}

/** Ready wording the record itself suggests ("REUSABLE WORDING" and similar headings). */
export function wording(e) {
  const m = /(?:^|\n)\s*(?:REUSABLE|SUGGESTED|PREFERRED|RÉSUMÉ|RESUME)(?: [A-Z]+)? (?:WORDING|BULLETS?)\b[^\n]*\n+([\s\S]*?)(?:\n\s*\n|$)/i.exec(String(e.content || ''))
  return m ? m[1].trim().slice(0, 600) : undefined
}

/** A record without provenance detail. Long text is cut; `more` says evidence.get has the rest. */
export function compactFact(e, max, maxCautions = 8) {
  const content = String(e.content || '')
  const long = content.length > max
  const out = {
    id: e.id, version: e.version, kind: e.kind, title: e.title, organization: e.organization, period: e.period, reviewStatus: e.reviewStatus,
    content: long ? `${content.slice(0, max).replace(/\s+\S*$/, '')} …` : content || undefined, more: long || undefined,
    star: e.star, metrics: e.metrics, bullets: e.bullets, publication: e.publication, skills: e.skills, gapsNoted: e.gapsNoted,
    cautions: cautions(e, maxCautions), wording: wording(e), sources: e.sources?.map((s) => String(s.label || '').slice(0, 80)).filter(Boolean).slice(0, 2),
  }
  for (const k of Object.keys(out)) if (out[k] === undefined || (Array.isArray(out[k]) && !out[k].length)) delete out[k]
  return out
}
