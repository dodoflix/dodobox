import { app, Menu, Tray, clipboard, dialog, nativeImage, shell } from 'electron'
import path from 'node:path'
import updater from 'electron-updater'
import { fileURLToPath } from 'node:url'

const build = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build')
const icon = path.join(build, 'icon.png')

app.setName('Dodobox')
app.setAppUserModelId('io.github.dodoflix.dodobox')

if (!app.requestSingleInstanceLock()) app.exit(0)

// Read by the server when it loads, so they must be set before the import below.
process.env.DATA_DIR ||= path.join(app.getPath('userData'), 'data')
// The Windows installer and the Linux AppImage replace themselves through electron-updater. The portable exe, the .deb and the macOS builds
// (not signed) cannot, so they only learn about a new version (src/update.js, which reads the releases page) and send the user to download it.
const selfUpdates = app.isPackaged && ((process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR) || (process.platform === 'linux' && !!process.env.APPIMAGE))
if (selfUpdates) process.env.DODOBOX_DESKTOP = '1' // electron-updater does the looking

let url = ''; let quitting = false; let tray; let updateCheck = () => {}
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
    { label: 'Check for updates', click: () => updateCheck(true) },
    { label: 'Show data folder', click: () => shell.openPath(process.env.DATA_DIR) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  // macOS wants a monochrome template image (the Template suffix and the @2x file are picked up by name).
  tray = new Tray(process.platform === 'darwin' ? path.join(build, 'trayTemplate.png') : nativeImage.createFromPath(icon).resize({ width: process.platform === 'win32' ? 32 : 24 }))
  tray.setToolTip(`Dodobox is running on port ${port}`)
  tray.setContextMenu(menu())
  tray.on('click', openUi)
  tray.on('right-click', () => tray.popUpContextMenu(menu()))

  const RELEASES = 'https://github.com/dodoflix/dodobox/releases/latest'
  const updates = await import('../src/update.js')
  const idle = () => tray.setToolTip(`Dodobox is running on port ${port}`)
  let asked = ''
  const upToDate = () => dialog.showMessageBox({ type: 'info', message: 'Dodobox is up to date', detail: `Version ${app.getVersion()}` })
  if (selfUpdates) {
    const { autoUpdater } = updater
    autoUpdater.autoDownload = false
    updates.useDriver({
      self: true,
      download: () => autoUpdater.downloadUpdate(),
      install: () => autoUpdater.quitAndInstall(),
      check: () => autoUpdater.checkForUpdates().catch(() => {})
    })
    autoUpdater.on('error', e => { console.error('[update]', e.message); updates.set({ phase: 'error', error: String(e.message).split('\n')[0].slice(0, 160) }) })
    autoUpdater.on('download-progress', p => { updates.set({ progress: Math.round(p.percent) }); tray.setToolTip(`Downloading the update... ${Math.round(p.percent)}%`) })
    autoUpdater.on('update-available', async info => {
      updates.set({ version: info.version, url: `https://github.com/dodoflix/dodobox/releases/tag/v${info.version}`, phase: 'available', error: null })
      if (asked === info.version) return
      asked = info.version
      const { response } = await dialog.showMessageBox({
        type: 'info', title: 'Dodobox update', message: `Dodobox ${info.version} is available`,
        detail: `You have ${app.getVersion()}. Update now? Dodobox restarts when the download is done. You can also do it from the Dodobox page.`,
        buttons: ['Update now', 'Later'], defaultId: 0, cancelId: 1
      })
      if (response !== 0) return
      updates.download().catch(e => dialog.showErrorBox('Update failed', e.message)).finally(idle)
    })
    autoUpdater.on('update-downloaded', async () => {
      updates.set({ phase: 'ready', progress: 100 })
      idle()
      const { response } = await dialog.showMessageBox({ type: 'info', title: 'Dodobox update', message: 'The update is ready', detail: 'Restart Dodobox to finish.', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1 })
      if (response === 0) autoUpdater.quitAndInstall()
    })
    const checkUpdates = () => { if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {}) }
    updateCheck = manual => {
      if (!app.isPackaged) return dialog.showMessageBox({ message: 'Updates are checked in the installed app.' })
      if (manual) { asked = ''; autoUpdater.once('update-not-available', upToDate) }
      checkUpdates()
    }
    setTimeout(checkUpdates, 20e3); setInterval(checkUpdates, 6 * 3600e3)
  } else {
    // The server's own check (every 12 hours) finds the release; here the user is asked once per version.
    updates.useDriver({ self: false, download: async () => {}, install: () => {}, check: () => {} })
    updates.onFound(async info => {
      if (asked === info.version) return
      asked = info.version
      const { response } = await dialog.showMessageBox({ type: 'info', title: 'Dodobox update', message: `Dodobox ${info.version} is available`, detail: `You have ${app.getVersion()}. Open the download page?`, buttons: ['Open download page', 'Later'], defaultId: 0, cancelId: 1 })
      if (response === 0) shell.openExternal(RELEASES)
    })
    updateCheck = async manual => {
      if (!app.isPackaged) return dialog.showMessageBox({ message: 'Updates are checked in the installed app.' })
      if (manual) asked = ''
      if (!(await updates.lookup(app.getVersion())) && manual) upToDate()
    }
  }

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
