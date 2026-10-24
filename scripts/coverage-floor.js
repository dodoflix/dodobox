// Fails when any file in an lcov report has less line coverage than the floor: a new file cannot hide behind a healthy average.
// usage: node scripts/coverage-floor.js <report.lcov> <percent> [only-these-files...]
import fs from 'node:fs'

const [file, floor, ...only] = process.argv.slice(2)
const under = []
let all = 0; let hit = 0
for (const rec of fs.readFileSync(file, 'utf8').split('end_of_record')) {
  const name = rec.match(/^SF:(.+)$/m)?.[1]
  if (only.length && !only.includes(name)) continue
  const found = +rec.match(/^LF:(\d+)$/m)?.[1]
  const covered = +rec.match(/^LH:(\d+)$/m)?.[1]
  if (!name || !found) continue
  all += found; hit += covered
  if (covered / found * 100 < +floor) under.push(`${name}: ${(covered / found * 100).toFixed(1)}%`)
}
console.log(`${file}: ${(hit / all * 100).toFixed(1)}% of lines overall, ${under.length} file(s) under ${floor}%`)
if (under.length) { console.error(`Under the ${floor}% line coverage floor:\n  ${under.join('\n  ')}`); process.exit(1) }
