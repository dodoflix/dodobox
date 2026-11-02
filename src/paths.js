import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Where Dodobox keeps its files. Separate from the torrent engine so light modules (and their tests) never start it.
// Without DATA_DIR the folder sits next to the app, so where the server is started from does not matter. Installs that were started from another folder
// kept their files in ./data there; that folder is still used while the app folder has none, so an upgrade does not look like lost profiles.
const beside = fileURLToPath(new URL('../data', import.meta.url))
const legacy = path.resolve('data')
export const DATA = path.resolve(process.env.DATA_DIR || (!fs.existsSync(beside) && fs.existsSync(legacy) ? legacy : beside))
