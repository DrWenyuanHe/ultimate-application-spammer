// Academic CV helper: publications by status, and what each citation still needs.
export const PUBLICATION_STATUSES = ['published', 'accepted', 'preprint', 'submitted', 'in-preparation']
export const PUBLICATION_HEADINGS = {
  published: 'Peer-reviewed publications', accepted: 'Accepted / in press', preprint: 'Preprints',
  submitted: 'Submitted manuscripts', 'in-preparation': 'Work in preparation',
}

export function publicationReport(evidence = []) {
  const groups = Object.fromEntries(PUBLICATION_STATUSES.map((s) => [s, []]))
  const gaps = []
  for (const e of evidence.filter((x) => x.kind === 'publication' && !['disputed', 'outdated'].includes(x.reviewStatus))) {
    const p = e.publication || {}
    const missing = []
    if (!p.authors?.length) missing.push('authors')
    if (!p.status) missing.push('status')
    if (!['submitted', 'in-preparation'].includes(p.status)) for (const f of ['venue', 'year']) if (!p[f]) missing.push(f)
    if (missing.length) gaps.push({ id: e.id, title: e.title, missing })
    if (p.status) groups[p.status].push({ id: e.id, title: e.title, ...p })
  }
  for (const list of Object.values(groups)) list.sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || a.title.localeCompare(b.title))
  return { counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), headings: PUBLICATION_HEADINGS, groups, gaps }
}
