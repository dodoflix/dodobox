// The data folder carries a version (schema.json): the number of migrations (src/migrations) it has been through. At startup the ones it has
// not seen are run in order, once, before any module reads its files.
import fs from 'node:fs'
import path from 'node:path'
import { MIGRATIONS } from './migrations/index.js'

export { MIGRATIONS }
export const CURRENT = MIGRATIONS.length
const KEEP_BACKUPS = 3
const FILE = 'schema.json'

function writeAtomic (file, text) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14)

// JSON files in the folder (caches excluded: they rebuild) are copied aside before any step runs.
function backup (dir, version) {
  const to = path.join(dir, 'backups', `v${version}-${stamp()}`)
  fs.mkdirSync(to, { recursive: true })
  for (const f of fs.readdirSync(dir)) if (/\.json$/.test(f) && !/cache\.json$/.test(f) && f !== FILE) fs.copyFileSync(path.join(dir, f), path.join(to, f))
  const all = fs.readdirSync(path.join(dir, 'backups')).sort()
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(dir, 'backups', old), { recursive: true, force: true })
  return to
}

function restore (dir, from) {
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(dir, f))
}

const toolsFor = dir => ({
  dir,
  read: name => { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) } catch { return undefined } },
  write: (name, value) => writeAtomic(path.join(dir, name), JSON.stringify(value)),
  drop: name => fs.rmSync(path.join(dir, name), { recursive: true, force: true })
})

// Brings `dir` up to date. An empty folder is stamped current; one with files but no version file is version 0 (before versions existed).
// Returns { from, to, ran }. Throws when the folder is from a newer Dodobox, or when a step fails (the files are put back first).
export function migrate (dir, migrations = MIGRATIONS) {
  const current = migrations.length
  fs.mkdirSync(dir, { recursive: true })
  let version = 0
  const fresh = fs.readdirSync(dir).length === 0
  try { version = +JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')).version || 0 } catch { if (fresh) version = current }
  if (version > current) {
    throw Object.assign(new Error(`This data folder (${dir}) was made by a newer Dodobox: it is at data version ${version}, this Dodobox understands up to ${current}. Update Dodobox, or restore an older copy of the folder.`), { code: 'NEWER_DATA' })
  }
  const from = version
  const ran = []
  if (version < current) {
    const saved = backup(dir, version)
    const tools = toolsFor(dir)
    for (const step of migrations.slice(version)) {
      try { step.up(tools) } catch (e) {
        restore(dir, saved)
        writeAtomic(path.join(dir, FILE), JSON.stringify({ version: from })) // every step is undone, so the version goes back too
        throw Object.assign(new Error(`Updating the data folder failed at "${step.name}": ${e.message}. Your files were put back as they were (a copy is in ${saved}).`), { code: 'MIGRATION_FAILED', cause: e })
      }
      version++
      ran.push(step.name)
      writeAtomic(path.join(dir, FILE), JSON.stringify({ version }))
    }
  } else if (!fs.existsSync(path.join(dir, FILE))) writeAtomic(path.join(dir, FILE), JSON.stringify({ version }))
  return { from, to: version, ran }
}
