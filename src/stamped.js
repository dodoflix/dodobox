import fs from 'node:fs'

export const APP_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

// Saved caches are read only by the app version that wrote them: a release may change what an entry holds or how it is
// worked out, and a copy from before would be served as if it were current. Returns null for another version's file.
export function readStamped (file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j.app === APP_VERSION ? j.data : null } catch { return null }
}
// A cache of facts about the user's own files (which title a file is) stays right across releases: only what a release may change
// is stamped, so this reads the data whatever version wrote it. Null when there is no readable file.
export function readAnyVersion (file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j.app ? j.data : null } catch { return null }
}
export const stamp = data => JSON.stringify({ app: APP_VERSION, data })
