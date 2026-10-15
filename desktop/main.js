import { app, Menu, Tray, clipboard, dialog, nativeImage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const icon = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build', 'icon.png')

app.setName('Dodobox')
app.setAppUserModelId('io.github.dodoflix.dodobox')

if (!app.requestSingleInstanceLock()) app.exit(0)

// Read by the server when it loads, so it must be set before the import below.
process.env.DATA_DIR ||= path.join(app.getPath('userData'), 'data')

let url = ''; let quitting = false; let tray
const hidden = argv => argv.includes('--hidden')
const openUi = () => { if (url) shell.openExternal(url) }

// Launching the app again opens the page; `--quit` is the way out where the desktop has no tray.
app.on('second-instance', (_e, argv) => (argv.includes('--quit') ? app.quit() : openUi()))
app.on('activate', openUi)
// No windows: the tray is the whole interface.
app.on('window-all-closed', () => {})
if (process.platform === 'darwin') app.dock?.hide()

// Electron emits 'ready' only after this module has finished evaluating, so nothing here may await it at the top level.
async function boot () {
  await app.whenReady()
  const { start, stop } = await import('../server.js')
  const { lanAddresses } = await import('../src/net.js')

  let server
  try {
    server = await start()
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e
    server = await start(0)
  }
  const port = server.address().port
  url = `http://localhost:${port}`
  const lan = () => lanAddresses().map(a => `http://${a}:${port}`)
  const canAutoStart = process.platform === 'win32' || process.platform === 'darwin'

  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Dodobox', click: openUi },
    { type: 'separator' },
    { label: 'For phones and TVs', enabled: false },
    ...(lan().length ? lan().map(a => ({ label: `Copy ${a}`, click: () => clipboard.writeText(a) })) : [{ label: 'No network address found', enabled: false }]),
    { type: 'separator' },
    ...(canAutoStart ? [{ label: 'Start when I sign in', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }) }] : []),
    { label: 'Show data folder', click: () => shell.openPath(process.env.DATA_DIR) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: process.platform === 'darwin' ? 18 : 22 }))
  tray.setToolTip(`Dodobox is running on port ${port}`)
  tray.setContextMenu(menu())
  tray.on('click', openUi)
  tray.on('right-click', () => tray.popUpContextMenu(menu()))

  // Quitting stops the torrent client and saves state first, but never waits longer than a few seconds.
  app.on('before-quit', e => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    Promise.race([stop(), new Promise(resolve => setTimeout(resolve, 5000))]).finally(() => app.exit(0))
  })

  console.log(`Dodobox desktop: ${url} (data in ${process.env.DATA_DIR})`)
  if (!hidden(process.argv) && !app.getLoginItemSettings().wasOpenedAtLogin) openUi()
}

boot().catch(e => { dialog.showErrorBox('Dodobox could not start', String(e?.message || e)); app.exit(1) })
