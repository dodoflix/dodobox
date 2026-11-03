import { app, Menu, Tray, clipboard, dialog, nativeImage, shell } from 'electron'
import path from 'node:path'
import updater from 'electron-updater'
import { fileURLToPath } from 'node:url'

const build = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build')
const icon = path.join(build, 'icon.png')

app.setName('Dodobox')
app.setAppUserModelId('io.github.dodoflix.dodobox')

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
  let server; let start; let stop
  try { ({ start, stop } = await import('../server.js')) } catch (e) {
    // The data folder is from a newer version, or could not be brought up to date.
    dialog.showErrorBox('Dodobox cannot start', e.message)
    app.exit(1)
    return
  }
  const { lanAddresses } = await import('../src/net.js')
  const { LOG_FILE, log } = await import('../src/log.js')
  app.on('child-process-gone', (_e, d) => log.error('desktop', 'child process gone', { type: d.type, reason: d.reason, code: d.exitCode }))

  try {
    server = await start()
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e
    server = await start(0)
  }
  const port = server.address().port
  url = `http://localhost:${port}`
  const lan = () => lanAddresses().map(a => `http://${a}:${port}`)
  // The portable exe unpacks to a temporary folder, so its own path (not process.execPath) is what has to be registered.
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE
  const canAutoStart = process.platform === 'win32' || process.platform === 'darwin'
  // Windows compares the stored entry with these arguments, so reading and writing must use the same ones.
  const loginArgs = { args: ['--hidden'], ...(portableExe ? { path: portableExe } : {}) }
  const startsAtLogin = () => app.getLoginItemSettings(loginArgs).openAtLogin

  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Dodobox', click: openUi },
    { type: 'separator' },
    { label: 'For phones and TVs', enabled: false },
    ...(lan().length ? lan().map(a => ({ label: `Copy ${a}`, click: () => clipboard.writeText(a) })) : [{ label: 'No network address found', enabled: false }]),
    { type: 'separator' },
    ...(canAutoStart ? [{ label: 'Start when I sign in', type: 'checkbox', checked: startsAtLogin(), click: item => app.setLoginItemSettings({ ...loginArgs, openAtLogin: item.checked }) }] : []),
    { label: 'Check for updates', click: () => updateCheck(true) },
    { label: 'Show data folder', click: () => shell.openPath(process.env.DATA_DIR) },
    { label: 'Show log file', click: () => shell.showItemInFolder(LOG_FILE) },
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
  // "Later" puts the question off for a day: while the update waits it is asked again once a day, not once per run.
  let asked = {}
  const due = v => { if (asked.v === v && Date.now() - asked.at < 24 * 3600e3) return false; asked = { v, at: Date.now() }; return true }
  const upToDate = () => dialog.showMessageBox({ type: 'info', message: 'Dodobox is up to date', detail: `Version ${app.getVersion()}` })
  const checkFailed = () => dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates', detail: 'Dodobox could not reach the releases page. Check your connection and try again.' })
  let manualWait = false // a check the user asked for is waiting for electron-updater to answer
  if (selfUpdates) {
    const { autoUpdater } = updater
    autoUpdater.autoDownload = false
    autoUpdater.logger = { info: m => log.info('updater', String(m)), warn: m => log.warn('updater', String(m)), error: m => log.error('updater', String(m)), debug: m => log.debug('updater', String(m)) }
    updates.useDriver({
      self: true,
      download: () => autoUpdater.downloadUpdate(),
      install: () => autoUpdater.quitAndInstall(),
      check: () => autoUpdater.checkForUpdates().catch(() => {})
    })
    // The page shows what the last check found (Settings' "Check for updates").
    const checked = what => updates.set({ checked: what, checkedAt: Date.now() })
    autoUpdater.on('update-not-available', () => { checked('current'); if (manualWait) { manualWait = false; upToDate() } })
    autoUpdater.on('error', e => {
      if (manualWait) { manualWait = false; checkFailed() }
      log.error('updater', 'error', { err: e })
      if (updates.view(app.getVersion(), false).phase !== 'downloading') checked('failed')
      updates.set({ phase: 'error', error: String(e.message).split('\n')[0].slice(0, 160) })
    })
    autoUpdater.on('download-progress', p => { updates.set({ progress: Math.round(p.percent) }); tray.setToolTip(`Downloading the update... ${Math.round(p.percent)}%`) })
    autoUpdater.on('update-available', async info => {
      manualWait = false; checked('newer')
      log.info('updater', 'update available', { version: info.version, current: app.getVersion() })
      updates.set({ version: info.version, url: `https://github.com/dodoflix/dodobox/releases/tag/v${info.version}`, phase: 'available', error: null })
      if (!due(info.version)) return
      const { response } = await dialog.showMessageBox({
        type: 'info', title: 'Dodobox update', message: `Dodobox ${info.version} is available`,
        detail: `You have ${app.getVersion()}. Update now? Dodobox restarts when the download is done. You can also do it from the Dodobox page.`,
        buttons: ['Update now', 'Later'], defaultId: 0, cancelId: 1
      })
      if (response !== 0) return
      updates.download().catch(e => dialog.showErrorBox('Update failed', e.message)).finally(idle)
    })
    autoUpdater.on('update-downloaded', async () => {
      log.info('updater', 'update downloaded')
      updates.set({ phase: 'ready', progress: 100 })
      idle()
      const { response } = await dialog.showMessageBox({ type: 'info', title: 'Dodobox update', message: 'The update is ready', detail: 'Restart Dodobox to finish.', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1 })
      if (response === 0) autoUpdater.quitAndInstall()
    })
    const checkUpdates = () => { if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {}) }
    updateCheck = manual => {
      if (!app.isPackaged) return dialog.showMessageBox({ message: 'Updates are checked in the installed app.' })
      if (manual) { asked = {}; manualWait = true }
      checkUpdates()
    }
    setTimeout(checkUpdates, 20e3); setInterval(checkUpdates, 3600e3)
  } else {
    // The server's own check (every hour) finds the release; here the user is asked when it is new, then again once a day while it waits.
    updates.useDriver({ self: false, download: async () => {}, install: () => {}, check: () => {} })
    const offer = async info => {
      if (!due(info.version)) return
      const { response } = await dialog.showMessageBox({ type: 'info', title: 'Dodobox update', message: `Dodobox ${info.version} is available`, detail: `You have ${app.getVersion()}. Open the download page?`, buttons: ['Open download page', 'Later'], defaultId: 0, cancelId: 1 })
      if (response === 0) shell.openExternal(RELEASES)
    }
    updates.onFound(offer)
    setInterval(() => { const i = updates.info(); if (i) offer(i) }, 3600e3)
    updateCheck = async manual => {
      if (!app.isPackaged) return dialog.showMessageBox({ message: 'Updates are checked in the installed app.' })
      if (manual) asked = {}
      const found = await updates.lookup(app.getVersion())
      if (!manual) return
      if (found === 'newer') await offer(updates.info()) // already asked for this version by onFound when it was new
      else if (found === 'current') upToDate()
      else checkFailed()
    }
  }

  // Quitting stops the torrent client and saves state first, but never waits longer than a few seconds.
  app.on('before-quit', e => {
    if (quitting) return
    quitting = true
    log.info('desktop', 'quitting')
    e.preventDefault()
    Promise.race([stop(), new Promise(resolve => setTimeout(resolve, 5000))]).finally(() => app.exit(0))
  })

  log.info('desktop', 'ready', { url, version: app.getVersion(), packaged: app.isPackaged, selfUpdates, portable: !!process.env.PORTABLE_EXECUTABLE_DIR, hidden: hidden(process.argv), autoStart: canAutoStart ? startsAtLogin() : undefined, data: process.env.DATA_DIR })
  if (!hidden(process.argv) && !app.getLoginItemSettings().wasOpenedAtLogin) openUi()
}

// A second copy must not reach boot(): it would start a server on the running copy's data folder.
;(app.requestSingleInstanceLock() ? boot() : Promise.resolve(app.quit())).catch(e => { console.error('[desktop]', e?.stack || e); dialog.showErrorBox('Dodobox could not start', String(e?.message || e)); app.exit(1) })
