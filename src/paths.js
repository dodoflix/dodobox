import path from 'node:path'
// Where Dodobox keeps its files. Separate from the torrent engine so light modules (and their tests) never start it.
export const DATA = path.resolve(process.env.DATA_DIR || 'data')
