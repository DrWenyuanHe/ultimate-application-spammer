// Builds resume and cover-letter .docx files from JSON content plus a format file.
// All visual settings come from app/templates/*-format.json (or a user copy in 4 Templates).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { readZip, writeZip } from './zip.mjs'
import { APP_DIR, dataDir, folder } from './paths.mjs'
import { uniquePath } from './archive.mjs'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PAGE = { Letter: [12240, 15840], A4: [11906, 16838] }

const twip = (inches) => Math.round(inches * 1440)
const pt20 = (pt) => Math.round((pt || 0) * 20)
const half = (pt) => Math.round(pt * 2)
const eighth = (pt) => Math.max(2, Math.round(pt * 8))
const line = (mult) => Math.round((mult || 1) * 240)
const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function loadFormat(kind) {
  const name = kind === 'cover-letter' ? 'cover-letter-format.json' : 'resume-format.json'
  const user = path.join(folder('templates'), name)
  const file = fs.existsSync(user) ? user : path.join(APP_DIR, 'templates', name)
  const fmt = { ...JSON.parse(fs.readFileSync(file, 'utf8')), source: file }
  validateFormat(fmt)
  return fmt
}

/** Catch typos in a hand-edited format file before they produce a document Word cannot open. */
function validateFormat(fmt) {
  const problems = []
  const walk = (obj, at) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const here = at ? `${at}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, here)
      else if (k === 'marginsInches') problems.push(`${here} must list top, right, bottom and left`)
      else if ((/(Pt|Inches|lineSpacing)$/.test(k) || /Inches$/.test(at)) && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 200)) problems.push(`${here} must be a number`)
      else if (k === 'color' && !/^[0-9A-Fa-f]{6}$/.test(String(v))) problems.push(`${here} must be a 6-digit hex colour like 1D1D1F`)
    }
  }
  walk(fmt, '')
  if (!fmt.font) problems.push('font is required')
  if (problems.length) throw new Error(`Format file ${fmt.source} has problems: ${problems.join('; ')}`)
}

/** Split "**bold** and *italic*" into styled pieces. */
function inline(textValue) {
  const parts = []
  for (const token of String(textValue ?? '').split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
    if (!token) continue
    if (token.startsWith('**') && token.endsWith('**')) parts.push({ text: token.slice(2, -2), bold: true })
    else if (token.startsWith('*') && token.endsWith('*') && token.length > 2) parts.push({ text: token.slice(1, -1), italic: true })
    else parts.push({ text: token })
  }
  return parts
}

function run(fmt, piece, base = {}) {
  const font = esc(base.font || fmt.font)
  const bold = piece.bold ?? base.bold
  const italic = piece.italic ?? base.italic
  const size = half(base.sizePt || 11)
  const props = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}<w:color w:val="${esc(fmt.color || '000000')}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`
  if (piece.tab) return `<w:r><w:rPr>${props}</w:rPr><w:tab/></w:r>`
  const value = base.uppercase ? piece.text.toUpperCase() : piece.text
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(value)}</w:t></w:r>`
}

function border(rule) {
  return rule ? `<w:pBdr><w:bottom w:val="single" w:sz="${eighth(rule.widthPt)}" w:space="${Math.round(rule.gapPt || 0)}" w:color="${esc(rule.color)}"/></w:pBdr>` : ''
}

function para(fmt, { style, numbered, rule, tabs, before, after, lineSpacing, align, ind, keepNext, pageBreakBefore, keepLines = true }, runs) {
  const pPr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    keepNext ? '<w:keepNext/>' : '',
    keepLines ? '<w:keepLines/>' : '',
    pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    numbered ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '',
    border(rule),
    tabs ? `<w:tabs>${tabs.map((t) => `<w:tab w:val="${t.val}" w:pos="${t.pos}"/>`).join('')}</w:tabs>` : '',
    `<w:spacing w:before="${pt20(before)}" w:after="${pt20(after)}" w:line="${line(lineSpacing || fmt.lineSpacing)}" w:lineRule="auto"/>`,
    ind ? `<w:ind w:left="${ind.left}" w:hanging="${ind.hanging}"/>` : '',
    align ? `<w:jc w:val="${align === 'center' ? 'center' : align === 'right' ? 'right' : 'left'}"/>` : '',
  ].join('')
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs.join('')}</w:p>`
}

const styled = (fmt, value, base) => inline(value).map((p) => run(fmt, p, base))

function contactLine(contact, separator) {
  if (Array.isArray(contact)) return contact.filter(Boolean).join(separator || '  |  ')
  return String(contact || '')
}

/** Resume content → document.xml body paragraphs. */
function resumeBody(data, fmt) {
  const out = []
  out.push(para(fmt, { align: fmt.name.align, after: fmt.name.afterPt, keepNext: true }, styled(fmt, data.name, fmt.name)))
  if (data.contact) out.push(para(fmt, { align: fmt.contact.align, after: fmt.contact.afterPt, rule: fmt.contact.rule }, styled(fmt, contactLine(data.contact, fmt.contact.separator), fmt.contact)))
  if (data.summary || data.tagline) {
    const runs = []
    if (data.tagline) runs.push(...styled(fmt, data.tagline, { ...fmt.summary, italic: true }), ...(data.summary ? ['<w:r><w:br/></w:r>'] : []))
    if (data.summary) runs.push(...styled(fmt, data.summary, fmt.summary))
    out.push(para(fmt, { before: fmt.summary.beforePt, after: fmt.summary.afterPt, lineSpacing: fmt.summary.lineSpacing, rule: fmt.summary.rule }, runs))
  }
  const tab = [{ val: 'right', pos: twip(fmt.role.dateTabInches) }]
  const bulletInd = { left: twip(fmt.bullet.leftInches), hanging: twip(fmt.bullet.hangingInches) }
  for (const section of data.sections || []) {
    out.push(para(fmt, { before: fmt.heading.beforePt, after: fmt.heading.afterPt, rule: fmt.heading.rule, keepNext: true, pageBreakBefore: section.pageBreakBefore }, styled(fmt, section.heading, fmt.heading)))
    if (section.intro) out.push(para(fmt, { before: fmt.intro.beforePt, after: fmt.intro.afterPt, keepNext: true }, styled(fmt, section.intro, fmt.intro)))
    const education = section.type === 'education'
    for (const entry of section.entries || []) {
      const runs = [...styled(fmt, entry.title, { ...fmt.role, bold: fmt.role.titleBold })]
      if (entry.organization) runs.push(...styled(fmt, fmt.role.separator, fmt.role), ...styled(fmt, entry.organization, { ...fmt.role, italic: !education && fmt.role.organizationItalic }))
      if (entry.unit) runs.push(...styled(fmt, fmt.role.separator, fmt.role), ...styled(fmt, entry.unit, { ...fmt.role, italic: !education && fmt.role.organizationItalic }))
      if (entry.dates) runs.push(run(fmt, { tab: true }, fmt.role), ...styled(fmt, entry.dates, fmt.role))
      const bullets = entry.bullets || []
      out.push(para(fmt, { tabs: tab, before: fmt.role.beforePt, after: fmt.role.afterPt, keepNext: bullets.length > 0 || Boolean(entry.note) }, runs))
      if (entry.note) out.push(para(fmt, { before: fmt.intro.beforePt, after: fmt.intro.afterPt, keepNext: bullets.length > 0 }, styled(fmt, entry.note, { ...fmt.intro, italic: true })))
      bullets.forEach((b, i) => {
        const last = i === bullets.length - 1
        out.push(para(fmt, { style: 'ListBullet', numbered: true, ind: bulletInd, before: fmt.bullet.beforePt, after: last ? fmt.bullet.lastAfterPt : fmt.bullet.afterPt, rule: last && !education ? fmt.bullet.lastRule : null }, styled(fmt, b, fmt.bullet)))
      })
    }
    ;(section.bullets || []).forEach((b) => out.push(para(fmt, { style: 'ListBullet', numbered: true, ind: bulletInd, before: fmt.bullet.beforePt, after: fmt.bullet.afterPt }, styled(fmt, b, fmt.bullet))))
    ;(section.paragraphs || []).forEach((p) => out.push(para(fmt, { before: fmt.paragraph.beforePt, after: fmt.paragraph.afterPt }, styled(fmt, p, fmt.paragraph))))
  }
  return out
}

function coverBody(data, fmt) {
  const body = { sizePt: fmt.body.sizePt }
  const out = []
  out.push(para(fmt, { align: fmt.name.align, after: fmt.name.afterPt, keepNext: true }, styled(fmt, data.heading || data.name, fmt.name)))
  if (data.contact) out.push(para(fmt, { after: fmt.contact.afterPt }, styled(fmt, contactLine(data.contact, fmt.contact.separator), fmt.contact)))
  if (data.date) out.push(para(fmt, { after: fmt.date.afterPt }, styled(fmt, data.date, body)))
  if (data.recipient?.length) {
    const lines = Array.isArray(data.recipient) ? data.recipient : [data.recipient]
    const runs = lines.flatMap((l, i) => [...(i ? ['<w:r><w:br/></w:r>'] : []), ...styled(fmt, l, body)])
    out.push(para(fmt, { after: fmt.recipient.afterPt }, runs))
  }
  if (data.salutation) out.push(para(fmt, { after: fmt.salutation.afterPt }, styled(fmt, data.salutation, body)))
  for (const p of data.paragraphs || []) out.push(para(fmt, { after: fmt.body.afterPt, keepLines: false }, styled(fmt, p, body)))
  if (data.closing) out.push(para(fmt, { after: fmt.closing.afterPt, keepNext: true }, styled(fmt, data.closing, body)))
  if (data.signature) out.push(para(fmt, { after: fmt.signature.afterPt }, styled(fmt, data.signature, body)))
  return out
}

function packageDocx(paragraphs, fmt, { title = '', author = '' } = {}) {
  const [w, h] = PAGE[fmt.page?.size] || PAGE.Letter
  const m = fmt.page?.marginsInches || { top: 1, right: 1, bottom: 1, left: 1 }
  const font = esc(fmt.font)
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"/><w:pgMar w:top="${twip(m.top)}" w:right="${twip(m.right)}" w:bottom="${twip(m.bottom)}" w:left="${twip(m.left)}" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/></w:sectPr></w:body></w:document>`
  const size = half(fmt.body?.sizePt || fmt.paragraph?.sizePt || 11)
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line(fmt.lineSpacing)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="${esc(fmt.color || '000000')}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>`
  const b = fmt.bullet || { char: '•', leftInches: 0.4, hangingInches: 0.15 }
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${esc(b.char || '•')}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${twip(b.leftInches)}"/></w:tabs><w:ind w:left="${twip(b.leftInches)}" w:hanging="${twip(b.hangingInches)}"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`],
    ['word/document.xml', document],
    ['word/styles.xml', styles],
    ['word/numbering.xml', numbering],
    ['word/settings.xml', settings],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><cp:lastModifiedBy>${esc(author)}</cp:lastModifiedBy></cp:coreProperties>`],
    ['docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Ultimate Application Spammer</Application></Properties>`],
  ]
  return writeZip(files.map(([name, data]) => ({ name, data })))
}

export function buildResume(data, fmt = loadFormat('resume')) {
  if (!data?.name) throw new Error('Resume content needs a name')
  return packageDocx(resumeBody(data, fmt), fmt, { title: data.documentTitle || `${data.name} resume`, author: data.author || '' })
}

export function buildCoverLetter(data, fmt = loadFormat('cover-letter')) {
  if (!data?.name) throw new Error('Cover letter content needs a name')
  return packageDocx(coverBody(data, fmt), fmt, { title: data.documentTitle || `${data.name} cover letter`, author: data.author || '' })
}

/** Plain text of a .docx (paragraphs separated by newlines). */
export function docxText(buffer) {
  const xml = readZip(buffer).get('word/document.xml').toString('utf8')
  return xml.split(/<\/w:p>/).map((p) => p.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')).join('\n').trim()
}

export function wordCount(textValue) {
  return (String(textValue).match(/\b[\w'’-]+\b/g) || []).length
}

export function leftoverPlaceholders(buffer) {
  return [...new Set(docxText(buffer).match(/\{\{[^}]+\}\}/g) || [])]
}

/** Find a converter for PDF export: LibreOffice first, then Microsoft Word on Windows. */
export function pdfConverter() {
  const candidates = process.platform === 'win32'
    ? ['soffice.com', 'C:\\Program Files\\LibreOffice\\program\\soffice.com', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com']
    : ['soffice', 'libreoffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    if (r.status === 0) return { kind: 'libreoffice', command: c, version: r.stdout.trim() }
  }
  if (process.platform === 'win32') {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', "if (Test-Path 'HKLM:\\SOFTWARE\\Classes\\Word.Application') { 'yes' }"], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    if (r.stdout.trim() === 'yes') return { kind: 'word', command: 'powershell.exe' }
  }
  return null
}

/** Convert a .docx to PDF next to it (never replacing an existing PDF). Returns the PDF path. */
export function exportPdf(docxFile, converter = pdfConverter()) {
  if (!converter) throw new Error('No PDF converter found. Install LibreOffice (free) or Microsoft Word, or open the .docx and use Save as PDF.')
  const source = path.resolve(docxFile)
  const work = path.join(dataDir(), 'render', randomUUID())
  fs.mkdirSync(work, { recursive: true })
  const staged = path.join(work, 'document.docx')
  fs.copyFileSync(source, staged)
  const pdf = path.join(work, 'document.pdf')
  let result
  if (converter.kind === 'libreoffice') {
    // LibreOffice's settings folder is deeply nested; inside a long workspace path it passes the
    // Windows 260-character limit and LibreOffice exits silently. Keep it in a short temp folder,
    // shared between runs; if that one is busy or damaged, try once more with a fresh one.
    const convert = (profileDir) => spawnSync(converter.command, [`-env:UserInstallation=${pathToFileURL(profileDir).href}`, '--headless', '--convert-to', 'pdf', '--outdir', work, staged], { encoding: 'utf8', timeout: 180000, windowsHide: true })
    result = convert(path.join(os.tmpdir(), 'uas-libreoffice'))
    if (!fs.existsSync(pdf)) result = convert(path.join(os.tmpdir(), `uas-libreoffice-${randomUUID().slice(0, 8)}`))
  } else {
    const script = `$w = New-Object -ComObject Word.Application; $w.Visible = $false; try { $d = $w.Documents.Open('${staged.replace(/'/g, "''")}', $false, $true); $d.SaveAs2('${pdf.replace(/'/g, "''")}', 17); $d.Close($false) } finally { $w.Quit() }`
    result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 180000, windowsHide: true })
  }
  if (!fs.existsSync(pdf)) {
    const said = (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 400)
    throw new Error(`PDF export failed (${converter.kind}, exit code ${result.status ?? result.signal ?? 'unknown'})${said ? `: ${said}` : ''}. The .docx was saved; open it and use Save as PDF.`)
  }
  const target = uniquePath(path.dirname(source), `${path.basename(source, path.extname(source))}.pdf`)
  fs.copyFileSync(pdf, target, fs.constants.COPYFILE_EXCL)
  return target
}

