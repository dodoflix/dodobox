// Imported first by every module that reads the data folder, so the folder is up to date before anything loads from it.
import { DATA } from './paths.js'
import { migrate } from './migrate.js'

try {
  const { from, to, ran } = migrate(DATA)
  if (ran.length) console.log(`[data] updated the data folder from version ${from} to ${to}: ${ran.join(', ')}`)
} catch (e) {
  // The desktop app shows this in a dialog; a terminal gets the plain message.
  if (process.versions.electron) throw e
  console.error(`\n  ${e.message}\n`)
  process.exit(1)
}
