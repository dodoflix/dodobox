// Drops the binaries of other platforms and architectures, the source maps and the ffmpeg build (src/bin.js downloads it on first use)
// from the packaged app, and gives macOS builds an ad-hoc signature (Apple silicon refuses to run a binary with none).
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { Arch } = require('builder-util')

const rm = p => fs.rmSync(p, { recursive: true, force: true })
const dropMaps = dir => {
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, it.name)
    if (it.isDirectory()) dropMaps(p)
    else if (it.name.endsWith('.map')) rm(p)
  }
}
const keepOnly = (dir, keep) => {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) if (!keep.includes(name)) rm(path.join(dir, name))
}

exports.default = async function afterPack (ctx) {
  const os = { darwin: 'darwin', win32: 'win32', linux: 'linux' }[ctx.electronPlatformName]
  const arch = Arch[ctx.arch]
  const app = ctx.electronPlatformName === 'darwin'
    ? path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app')
    : path.join(ctx.appOutDir, 'resources', 'app')
  const mods = path.join(app, 'node_modules')

  if (fs.existsSync(mods)) dropMaps(mods)
  keepOnly(path.join(mods, 'ffmpeg-static'), ['index.js', 'package.json', 'LICENSE'])
  keepOnly(path.join(mods, 'utp-native', 'prebuilds'), [`${os}-${arch}`])
  keepOnly(path.join(mods, 'fs-native-extensions', 'prebuilds'), [`${os}-${arch}`])
  // Only the minified player library is served.
  keepOnly(path.join(mods, 'hls.js'), ['dist', 'package.json', 'LICENSE'])
  keepOnly(path.join(mods, 'hls.js', 'dist'), ['hls.min.js'])

  if (os === 'darwin') execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)], { stdio: 'inherit' })
}
