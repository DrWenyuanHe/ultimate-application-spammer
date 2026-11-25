import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { isolate } from './helpers.mjs'

const home = isolate('docx')
const { buildResume, buildCoverLetter, docxText, leftoverPlaceholders, loadFormat, wordCount, pdfConverter, exportPdf } = await import('../lib/docx.mjs')
const { readZip, writeZip } = await import('../lib/zip.mjs')
const { FOLDERS } = await import('../lib/paths.mjs')

const readJson = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'))
const demo = readJson('../demo/demo.json')
const resumeFormat = readJson('../templates/resume-format.json')
const letterFormat = readJson('../templates/cover-letter-format.json')
const documentXml = (buf) => readZip(buf).get('word/document.xml').toString('utf8')

/** Text of the runs in the first paragraph containing `needle`, with each run's properties. */
function runsOf(xml, needle) {
  const para = xml.split('</w:p>').find((p) => p.includes(needle))
  assert.ok(para, `no paragraph contains ${needle}`)
  return [...para.matchAll(/<w:r><w:rPr>(.*?)<\/w:rPr><w:t[^>]*>(.*?)<\/w:t><\/w:r>/g)].map((m) => ({ props: m[1], text: m[2] }))
}

test('zip round trip keeps names (UTF-8) and bytes', () => {
  const binary = Buffer.from([0, 1, 2, 255, 254, 10, 13])
  const zip = writeZip([{ name: 'a.txt', data: 'hello' }, { name: 'dossier/Résumé.bin', data: binary }, { name: 'empty', data: '' }])
  const files = readZip(zip)
  assert.equal(files.get('a.txt').toString(), 'hello')
  assert.deepEqual(files.get('dossier/Résumé.bin'), binary)
  assert.equal(files.get('empty').length, 0)
  assert.deepEqual(writeZip([{ name: 'a', data: 'x' }]), writeZip([{ name: 'a', data: 'x' }]), 'output is deterministic')
  assert.throws(() => readZip(Buffer.from('definitely not a zip file at all')), /Not a zip/)
})

test('resume .docx is a readable package with the expected parts and text', () => {
  const buf = buildResume(demo.exampleResume, loadFormat('resume'))
  const parts = readZip(buf)
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml']) assert.ok(parts.has(name), name)
  const text = docxText(buf)
  assert.ok(text.includes(demo.exampleResume.name.toUpperCase()), 'name is upper-cased per the format file')
  for (const section of demo.exampleResume.sections) assert.ok(text.toUpperCase().includes(section.heading.toUpperCase()), section.heading)
  assert.ok(wordCount(text) > 100)
  assert.match(parts.get('docProps/core.xml').toString(), /<dc:title>Example resume \(fictional\)<\/dc:title>/)
})

test('resume fonts and sizes come from resume-format.json', () => {
  const xml = documentXml(buildResume(demo.exampleResume, loadFormat('resume')))
  assert.equal(resumeFormat.font, 'Times New Roman')
  const name = runsOf(xml, demo.exampleResume.name.toUpperCase())[0]
  assert.match(name.props, /w:ascii="Times New Roman"/)
  assert.match(name.props, new RegExp(`<w:sz w:val="${resumeFormat.name.sizePt * 2}"/>`))
  assert.match(name.props, /<w:sz w:val="36"\/>/, '18 pt name = w:sz 36')
  assert.match(name.props, /<w:b\/>/)
  const fonts = new Set([...xml.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]))
  assert.deepEqual([...fonts], ['Times New Roman'])
  assert.match(xml, /<w:pgSz w:w="12240" w:h="15840"\/>/, 'Letter page')
  assert.match(xml, new RegExp(`w:left="${Math.round(resumeFormat.page.marginsInches.left * 1440)}"`))
})

test('cover letter uses an Arial body and a Calibri title from cover-letter-format.json', () => {
  const letter = demo.exampleCoverLetter
  const xml = documentXml(buildCoverLetter(letter, loadFormat('cover-letter')))
  assert.equal(letterFormat.font, 'Arial')
  const title = runsOf(xml, letter.heading)[0]
  assert.match(title.props, /w:ascii="Calibri"/)
  assert.match(title.props, new RegExp(`<w:sz w:val="${letterFormat.name.sizePt * 2}"/>`))
  assert.match(title.props, /<w:b\/>/)
  const body = runsOf(xml, letter.salutation)[0]
  assert.match(body.props, /w:ascii="Arial"/)
  assert.match(body.props, new RegExp(`<w:sz w:val="${letterFormat.body.sizePt * 2}"/>`))
  const styles = readZip(buildCoverLetter(letter, loadFormat('cover-letter'))).get('word/styles.xml').toString()
  assert.match(styles, /w:ascii="Arial"/)
  const text = docxText(buildCoverLetter(letter, loadFormat('cover-letter')))
  for (const p of letter.paragraphs) assert.ok(text.includes(p.replace(/\*+/g, '').slice(0, 40)), p.slice(0, 40))
})

test('**bold** and *italic* become w:b / w:i runs without the asterisks', () => {
  const xml = documentXml(buildResume({ name: 'Jordan Example', summary: 'Led **three pilots** and a *small* study.' }, loadFormat('resume')))
  const runs = runsOf(xml, 'three pilots')
  const bold = runs.find((r) => r.text === 'three pilots')
  const italic = runs.find((r) => r.text === 'small')
  assert.ok(bold && /<w:b\/>/.test(bold.props) && !/<w:i\/>/.test(bold.props))
  assert.ok(italic && /<w:i\/>/.test(italic.props) && !/<w:b\/>/.test(italic.props))
  assert.ok(!runs.some((r) => r.text.includes('*')))
})

test('special characters are XML-escaped and survive the round trip', () => {
  const name = 'Jordan & "Sam" <Example>'
  const buf = buildResume({ name, documentTitle: 'R&D <resume>', summary: 'Cost < $5 & time > 2 "weeks"' }, { ...loadFormat('resume'), name: { ...resumeFormat.name, uppercase: false } })
  const xml = documentXml(buf)
  assert.ok(xml.includes('Jordan &amp; &quot;Sam&quot; &lt;Example&gt;'))
  assert.ok(!/<Example>/.test(xml))
  assert.ok(docxText(buf).includes(name))
  assert.ok(docxText(buf).includes('Cost < $5 & time > 2 "weeks"'))
  assert.match(readZip(buf).get('docProps/core.xml').toString(), /R&amp;D &lt;resume&gt;/)
})

test('masters still contain {{placeholders}}; the fictional examples contain none', () => {
  const resumeMaster = readJson('../templates/resume-master.json')
  const letterMaster = readJson('../templates/cover-letter-master.json')
  assert.ok(leftoverPlaceholders(buildResume(resumeMaster)).includes('{{YOUR NAME}}'))
  assert.ok(leftoverPlaceholders(buildCoverLetter(letterMaster)).length > 3)
  assert.deepEqual(leftoverPlaceholders(buildResume(demo.exampleResume)), [])
  assert.deepEqual(leftoverPlaceholders(buildCoverLetter(demo.exampleCoverLetter)), [])
})

test('content without a name is refused', () => {
  assert.throws(() => buildResume({ summary: 'x' }), /name/)
  assert.throws(() => buildCoverLetter({}), /name/)
})

test('a user copy of the format in the templates folder overrides the bundled one', () => {
  const custom = { ...resumeFormat, font: 'Georgia', name: { ...resumeFormat.name, sizePt: 20 } }
  const file = path.join(home, FOLDERS.templates, 'resume-format.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(custom))
  const fmt = loadFormat('resume')
  assert.equal(fmt.source, file)
  const xml = documentXml(buildResume({ name: 'Jordan Example' }, fmt))
  assert.match(xml, /w:ascii="Georgia"/)
  assert.match(xml, /<w:sz w:val="40"\/>/)
  assert.equal(loadFormat('cover-letter').font, 'Arial', 'cover letter still uses the bundled format')
})

test('PDF export (only when LibreOffice or Word is installed)', { timeout: 240000 }, (t) => {
  if (process.env.UAS_TEST_SKIP_PDF) return t.skip('UAS_TEST_SKIP_PDF is set')
  const converter = pdfConverter()
  if (!converter) return t.skip('no PDF converter installed')
  const docx = path.join(home, 'pdf', 'Example.docx')
  fs.mkdirSync(path.dirname(docx), { recursive: true })
  fs.writeFileSync(docx, buildResume(demo.exampleResume))
  const pdf = exportPdf(docx, converter)
  assert.equal(path.basename(pdf), 'Example.pdf')
  assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), '%PDF-')
  const second = exportPdf(docx, converter)
  assert.equal(path.basename(second), 'Example (2).pdf', 'an existing PDF is never replaced')
  assert.ok(fs.existsSync(path.join(home, 'app', 'data', 'render')), 'work files stay in the isolated data folder')
})

test('PDF export works from a workspace with a long folder path (LibreOffice only)', { timeout: 240000 }, (t) => {
  if (process.env.UAS_TEST_SKIP_PDF) return t.skip('UAS_TEST_SKIP_PDF is set')
  const converter = pdfConverter()
  if (converter?.kind !== 'libreoffice') return t.skip('LibreOffice not installed')
  // LibreOffice's nested settings folder used to live under the data folder and pass Windows' 260-character limit.
  const deep = path.join(home, 'OneDrive - Example Organization', 'Documents', 'Job search 2026', 'Ultimate Application Spammer workspace', 'app', 'data')
  const docx = path.join(home, 'pdf-long', 'Example.docx')
  fs.mkdirSync(path.dirname(docx), { recursive: true })
  fs.writeFileSync(docx, buildResume(demo.exampleResume))
  const before = process.env.UAS_DATA
  process.env.UAS_DATA = deep
  try {
    const pdf = exportPdf(docx, converter)
    assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), '%PDF-')
  } finally {
    if (before === undefined) delete process.env.UAS_DATA
    else process.env.UAS_DATA = before
  }
})

test('characters XML forbids are dropped instead of producing a document Word cannot open', () => {
  const buf = buildResume({ name: 'Jordan\u0001 Example\u0008', summary: 'Tab\tand form\u000Cfeed \uFFFF end' }, { ...loadFormat('resume'), name: { ...resumeFormat.name, uppercase: false } })
  const xml = documentXml(buf)
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(xml))
  assert.ok(docxText(buf).includes('Jordan Example'))
})

test('hand-edited format files with bad numbers or colours are refused with a clear message', () => {
  const file = path.join(home, FOLDERS.templates, 'cover-letter-format.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const write = (fmt) => fs.writeFileSync(file, JSON.stringify(fmt))
  write({ ...letterFormat, body: { ...letterFormat.body, sizePt: 'eleven' } })
  assert.throws(() => loadFormat('cover-letter'), /body\.sizePt must be a number/)
  write({ ...letterFormat, color: 'black' })
  assert.throws(() => loadFormat('cover-letter'), /color must be a 6-digit hex colour/)
  write({ ...letterFormat, font: '' })
  assert.throws(() => loadFormat('cover-letter'), /font is required/)
  write(letterFormat)
  assert.equal(loadFormat('cover-letter').font, 'Arial')
})

test('page margins in a format file are validated too', () => {
  const file = path.join(home, FOLDERS.templates, 'cover-letter-format.json')
  fs.writeFileSync(file, JSON.stringify({ ...letterFormat, page: { ...letterFormat.page, marginsInches: { ...letterFormat.page.marginsInches, top: 'wide' } } }))
  try {
    assert.throws(() => loadFormat('cover-letter'), /marginsInches/)
  } finally {
    fs.writeFileSync(file, JSON.stringify(letterFormat))
  }
})

test('readZip rejects damaged entries (CRC/size) instead of returning garbage', () => {
  const zip = writeZip([{ name: 'word/document.xml', data: 'x'.repeat(5000) }])
  const damaged = Buffer.from(zip)
  const dataStart = 30 + damaged.readUInt16LE(26) + damaged.readUInt16LE(28)
  damaged[dataStart + 3] ^= 0xff // inside the compressed data of the first entry
  assert.throws(() => readZip(damaged))
  const truncated = Buffer.concat([zip.subarray(0, 20), zip.subarray(zip.length - 22)])
  assert.throws(() => readZip(truncated))
})

test('readZip checks the recorded CRC, size and compression method of each entry', () => {
  const zip = writeZip([{ name: 'word/document.xml', data: '<w:document>hello</w:document>' }])
  const central = zip.readUInt32LE(zip.length - 22 + 16)
  const tamper = (offset, value, bytes = 4) => {
    const copy = Buffer.from(zip)
    if (bytes === 4) copy.writeUInt32LE(value, central + offset)
    else copy.writeUInt16LE(value, central + offset)
    return copy
  }
  assert.throws(() => readZip(tamper(16, (zip.readUInt32LE(central + 16) ^ 1) >>> 0)), /Damaged zip entry word\/document\.xml/, 'wrong CRC')
  assert.throws(() => readZip(tamper(24, zip.readUInt32LE(central + 24) + 1)), /Damaged zip entry/, 'wrong uncompressed size')
  assert.throws(() => readZip(tamper(10, 99, 2)), /Unsupported compression/)
  assert.throws(() => readZip(tamper(20, 0xffff)), /Corrupt zip entry/, 'compressed size past the end')
  assert.equal(readZip(zip).get('word/document.xml').toString(), '<w:document>hello</w:document>')
})
