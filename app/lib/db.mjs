// Local SQLite storage. Every change is a new row in `events` and a new row in `record_versions`;
// `records` holds the current version of each record. Nothing is ever deleted.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export class StoreError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        type TEXT NOT NULL,
        kind TEXT NOT NULL,
        record_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE TABLE IF NOT EXISTS record_versions (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        PRIMARY KEY (kind, id, version)
      );
      CREATE INDEX IF NOT EXISTS records_kind ON records(kind, updated_at);
      CREATE TRIGGER IF NOT EXISTS events_append_only_update BEFORE UPDATE ON events
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS events_append_only_delete BEFORE DELETE ON events
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS versions_append_only_update BEFORE UPDATE ON record_versions
        BEGIN SELECT RAISE(ABORT, 'record history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS versions_append_only_delete BEFORE DELETE ON record_versions
        BEGIN SELECT RAISE(ABORT, 'record history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_replace BEFORE INSERT ON events
        WHEN NEW.seq IS NOT NULL AND EXISTS (SELECT 1 FROM events WHERE seq = NEW.seq)
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS versions_no_replace BEFORE INSERT ON record_versions
        WHEN EXISTS (SELECT 1 FROM record_versions WHERE kind = NEW.kind AND id = NEW.id AND version = NEW.version)
        BEGIN SELECT RAISE(ABORT, 'record history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS records_no_delete BEFORE DELETE ON records
        BEGIN SELECT RAISE(ABORT, 'records are archived, never deleted'); END;
    `,
  },
]

export const SCHEMA_VERSION = MIGRATIONS.at(-1).version

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;')
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const current = Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value || 0)
  if (current > SCHEMA_VERSION) {
    throw new StoreError(500, `This database was created by a newer version (schema ${current}). Update the app before opening it.`)
  }
  for (const m of MIGRATIONS.filter((x) => x.version > current)) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(m.sql)
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(m.version))
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return db
}

/** Low-level versioned record access shared by every record kind. */
export class RecordTable {
  constructor(db) {
    this.db = db
    this.inTransaction = false
  }

  transaction(fn) {
    if (this.inTransaction) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.inTransaction = true
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.inTransaction = false
    }
  }

  /** Run several reads against one consistent snapshot of the database. */
  read(fn) {
    if (this.inTransaction) return fn()
    this.db.exec('BEGIN DEFERRED')
    this.inTransaction = true
    try { return fn() } finally {
      this.inTransaction = false
      this.db.exec('COMMIT')
    }
  }

  revision() {
    return Number(this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get().seq)
  }

  row(r) {
    if (!r) return null
    return { ...JSON.parse(r.data), id: r.id, version: Number(r.version), createdAt: r.created_at, updatedAt: r.updated_at }
  }

  get(kind, id) {
    return this.row(this.db.prepare('SELECT * FROM records WHERE kind = ? AND id = ?').get(kind, id))
  }

  list(kind) {
    return this.db.prepare('SELECT * FROM records WHERE kind = ? ORDER BY updated_at DESC, id').all(kind).map((r) => this.row(r))
  }

  versions(kind, id) {
    return this.db.prepare('SELECT * FROM record_versions WHERE kind = ? AND id = ? ORDER BY version').all(kind, id)
      .map((r) => ({ ...JSON.parse(r.data), id: r.id, version: Number(r.version), at: r.at, actor: r.actor }))
  }

  version(kind, id, version) {
    const r = this.db.prepare('SELECT * FROM record_versions WHERE kind = ? AND id = ? AND version = ?').get(kind, id, version)
    return r ? { ...JSON.parse(r.data), id: r.id, version: Number(r.version), at: r.at, actor: r.actor } : null
  }

  event(type, kind, id, version, payload, actor) {
    this.db.prepare('INSERT INTO events (at, actor, type, kind, record_id, version, payload) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), actor, type, kind, id, version, JSON.stringify(payload ?? {}))
  }

  create(kind, data, { id = randomUUID(), actor = 'user', type = 'created' } = {}) {
    return this.transaction(() => {
      if (this.get(kind, id)) throw new StoreError(409, `${kind} ${id} already exists`)
      const now = new Date().toISOString()
      const clean = strip(data)
      const json = JSON.stringify(clean)
      this.db.prepare('INSERT INTO records (kind, id, version, data, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)').run(kind, id, json, now, now)
      this.db.prepare('INSERT INTO record_versions (kind, id, version, data, at, actor) VALUES (?, ?, 1, ?, ?, ?)').run(kind, id, json, now, actor)
      this.event(type, kind, id, 1, clean, actor)
      return this.get(kind, id)
    })
  }

  /** Replace a record's data with a new version. `expectedVersion` guards against lost updates. */
  update(kind, id, mutate, { expectedVersion, actor = 'user', type = 'updated' } = {}) {
    return this.transaction(() => {
      const current = this.get(kind, id)
      if (!current) throw new StoreError(404, `${kind} ${id} was not found`)
      if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== current.version) {
        throw new StoreError(409, `${kind} ${id} changed since you loaded it (now version ${current.version}). Reload and try again.`, { current })
      }
      const base = strip(current)
      const next = strip(typeof mutate === 'function' ? mutate(structuredClone(base)) : { ...base, ...mutate })
      if (JSON.stringify(next) === JSON.stringify(base)) return current
      const version = current.version + 1
      const now = new Date().toISOString()
      const json = JSON.stringify(next)
      this.db.prepare('UPDATE records SET version = ?, data = ?, updated_at = ? WHERE kind = ? AND id = ?').run(version, json, now, kind, id)
      this.db.prepare('INSERT INTO record_versions (kind, id, version, data, at, actor) VALUES (?, ?, ?, ?, ?, ?)').run(kind, id, version, json, now, actor)
      this.event(type, kind, id, version, changes(base, next), actor)
      return this.get(kind, id)
    })
  }

  activity(limit = 30) {
    return this.db.prepare('SELECT seq, at, actor, type, kind, record_id, version FROM events ORDER BY seq DESC LIMIT ?').all(limit)
      .map((e) => ({ seq: Number(e.seq), at: e.at, actor: e.actor, type: e.type, kind: e.kind, id: e.record_id, version: Number(e.version) }))
  }
}

function strip(data) {
  const { id, version, createdAt, updatedAt, ...rest } = data || {}
  for (const key of Object.keys(rest)) if (rest[key] === undefined) delete rest[key]
  return rest
}

function changes(before, after) {
  const out = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = after[key] ?? null
  }
  return out
}
