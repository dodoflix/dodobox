// File choice inside real multi-file torrents (offline, snapshots/packs).
// A task asks for episode N of a pack; pickFile answers with a file index, or -1 when the pack lacks the episode.
//   --show n   print n tasks with the chosen file names
import { readSnapshot } from '../lib/store.js'
import { pickFile } from '../../src/release.js'

const base = n => n.split(/[\\/]/).pop()

export default async function pick (args) {
  const packs = readSnapshot('packs')
  let tasks = 0; let none = 0; const shown = []
  for (const p of packs) for (const [e, ep] of Object.entries(p.eps)) {
    const i = pickFile(p.files, { type: 'anime', episode: +e, tvdbSeason: ep.tvdbSeason, tvdbEpisode: ep.tvdbEpisode, abs: ep.abs })
    tasks++
    if (i < 0) none++
    shown.push({ pack: p.release.slice(0, 44), episode: e, abs: ep.abs, file: i >= 0 ? base(p.files[i].name).slice(0, 60) : '-' })
  }
  console.log(`${packs.length} packs, ${tasks} tasks: a file for ${tasks - none} (${Math.round(100 * (tasks - none) / tasks)}%), none for ${none}`)
  const n = +args.show || 0
  if (n) console.table(shown.sort(() => Math.random() - 0.5).slice(0, n))
}
