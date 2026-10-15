import os from 'node:os'
import { spawn } from 'node:child_process'

export const lanAddresses = () => Object.values(os.networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))
  .map(i => i.address)

export function openBrowser (url) {
  if (!process.env.OPEN) return
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref() } catch {}
}
