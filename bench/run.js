// Benchmark entry: node bench/run.js <command> [--flag value]. Commands are in bench/cmd; see bench/README.md.
import fs from 'node:fs'

const dir = new URL('./cmd/', import.meta.url)
const commands = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort()
const [name, ...rest] = process.argv.slice(2)
if (!commands.includes(name)) {
  console.error(`usage: node bench/run.js <command> [--flag value]\ncommands: ${commands.join(', ')}`)
  process.exit(name ? 1 : 0)
}
const args = {}
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true
await (await import(new URL(`${name}.js`, dir))).default(args)
