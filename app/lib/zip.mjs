// Minimal ZIP reader/writer (enough for .docx files) using only Node built-ins.
import zlib from 'node:zlib'

const DOS_TIME = (() => {
  const d = new Date(1980, 0, 1)
  return { time: 0, date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }
})()

/** entries: [{ name, data: Buffer|string }] → Buffer. Deterministic output (fixed timestamps). */
export function writeZip(entries) {
  const locals = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const compressed = zlib.deflateRawSync(raw, { level: 9 })
    const crc = zlib.crc32(raw) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(DOS_TIME.time, 10)
    local.writeUInt16LE(DOS_TIME.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, compressed)
    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(20, 6)
    head.writeUInt16LE(0x0800, 8)
    head.writeUInt16LE(8, 10)
    head.writeUInt16LE(DOS_TIME.time, 12)
    head.writeUInt16LE(DOS_TIME.date, 14)
    head.writeUInt32LE(crc, 16)
    head.writeUInt32LE(compressed.length, 20)
    head.writeUInt32LE(raw.length, 24)
    head.writeUInt16LE(name.length, 28)
    head.writeUInt32LE(offset, 42)
    central.push(head, name)
    offset += 30 + name.length + compressed.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

const MAX_ENTRY = 64 * 1024 * 1024
const MAX_TOTAL = 256 * 1024 * 1024

/** Buffer → Map(name → Buffer). Supports stored and deflated entries; checks sizes and CRCs. */
export function readZip(buffer, { only } = {}) {
  let total = 0
  let end = buffer.length - 22
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('Not a zip file')
  const count = buffer.readUInt16LE(end + 10)
  let ptr = buffer.readUInt32LE(end + 16)
  const files = new Map()
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Corrupt zip directory')
    const method = buffer.readUInt16LE(ptr + 10)
    const crc = buffer.readUInt32LE(ptr + 16)
    const size = buffer.readUInt32LE(ptr + 20)
    const fullSize = buffer.readUInt32LE(ptr + 24)
    const nameLen = buffer.readUInt16LE(ptr + 28)
    const extraLen = buffer.readUInt16LE(ptr + 30)
    const commentLen = buffer.readUInt16LE(ptr + 32)
    const localOffset = buffer.readUInt32LE(ptr + 42)
    const name = buffer.toString('utf8', ptr + 46, ptr + 46 + nameLen)
    const localNameLen = buffer.readUInt16LE(localOffset + 26)
    const localExtraLen = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLen + localExtraLen
    ptr += 46 + nameLen + extraLen + commentLen
    if (only && !only.includes(name)) continue
    if (method !== 0 && method !== 8) throw new Error(`Unsupported compression in ${name}`)
    if (fullSize > MAX_ENTRY || (total += fullSize) > MAX_TOTAL) throw new Error('Document is too large to inspect')
    if (start + size > buffer.length) throw new Error('Corrupt zip entry')
    const data = buffer.subarray(start, start + size)
    const out = method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY })
    if (out.length !== fullSize || (zlib.crc32(out) >>> 0) !== crc) throw new Error(`Damaged zip entry ${name}`)
    files.set(name, out)
  }
  return files
}
