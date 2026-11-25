import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Repository root (the folder that contains `app/`). Tests may override it with UAS_HOME. */
export function rootDir() {
  return process.env.UAS_HOME ? path.resolve(process.env.UAS_HOME) : path.resolve(here, '..', '..')
}

/** Folder holding the bundled code and defaults; never overridden. */
export const APP_DIR = path.resolve(here, '..')

/** The Git checkout that holds the code (used for versions and updates). */
export const CODE_ROOT = path.resolve(APP_DIR, '..')

export const FOLDERS = {
  applications: '1 Applications',
  library: '2 Career Library',
  templates: '3 Templates',
  guides: '4 Guides',
  archive: 'Archive',
}

export function folder(name) {
  if (!FOLDERS[name]) throw new Error(`Unknown folder ${name}`)
  return path.join(rootDir(), FOLDERS[name])
}

export function dataDir() {
  return process.env.UAS_DATA ? path.resolve(process.env.UAS_DATA) : path.join(rootDir(), 'app', 'data')
}

export function dbPath({ demo = false } = {}) {
  if (process.env.UAS_DB && !demo) return path.resolve(process.env.UAS_DB)
  return path.join(dataDir(), demo ? 'demo.sqlite' : 'workspace.sqlite')
}
