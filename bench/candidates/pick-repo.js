import { pickFile } from '../../src/sources.js'

// Baseline: the repo's current pickFile, adapted to the pick command's target shape.
export default { id: 'repo', pick: (files, t) => pickFile(files, { type: 'anime', episode: t.episode }) }
