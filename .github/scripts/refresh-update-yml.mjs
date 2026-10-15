// Signing changes the installer's bytes, so the size and checksum electron-builder wrote in latest.yml no longer match; the installed app
// compares the download with them and would refuse the update. Run after the signed files are back in the folder: node refresh-update-yml.mjs dist
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export function refresh (dir) {
  const file = path.join(dir, 'latest.yml')
  const sum = name => crypto.createHash('sha512').update(fs.readFileSync(path.join(dir, name))).digest('base64')
  const have = name => fs.existsSync(path.join(dir, name))
  let text = fs.readFileSync(file, 'utf8')
  text = text.replace(/(url: (\S+)\n\s+sha512: )\S+(\n\s+size: )\d+/g, (all, a, name, b) =>
    (have(name) ? `${a}${sum(name)}${b}${fs.statSync(path.join(dir, name)).size}` : all))
  text = text.replace(/(^path: (\S+)\nsha512: )\S+/m, (all, a, name) => (have(name) ? a + sum(name) : all))
  fs.writeFileSync(file, text)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) refresh(process.argv[2] || 'dist')
