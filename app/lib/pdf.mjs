// Page count of a PDF, read from the file itself (no PDF library is installed).
import fs from 'node:fs'
import zlib from 'node:zlib'

export function pdfPageCount(file) {
  const raw = fs.readFileSync(file)
  const count = (text) => (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length
  const text = raw.toString('latin1')
  let pages = count(text)
  if (pages) return pages
  // Newer PDFs keep page objects inside compressed object streams.
  for (const m of text.matchAll(/\/Type\s*\/ObjStm[\s\S]{0,300}?stream\r?\n/g)) {
    const end = text.indexOf('endstream', m.index + m[0].length)
    try { pages += count(zlib.inflateSync(raw.subarray(m.index + m[0].length, end)).toString('latin1')) } catch { /* unreadable stream */ }
  }
  return pages || null
}
