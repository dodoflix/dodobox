// A temp folder that is removed when the test process exits, so runs leave nothing in the system temp folder.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const made = []
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })
export function tmpdir (name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `dodobox-${name}-`))
  made.push(d)
  return d
}
