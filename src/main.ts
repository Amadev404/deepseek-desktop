import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { ensureCompanionLink } from './companion-link.js'
import { startHarness, stopHarness, type RunningHarness } from './harness.js'
import { registerPetStoreIpc } from './pet-store.js'
import { openPetWindow, registerPetWindowIpc } from './pet-window.js'
import { chooseHarnessPort, isTrustedHarnessUrl } from './runtime.js'

const PRODUCT_NAME = 'DeepSeek Desktop'
const isPrewarm = process.argv.includes('--prewarm')

let mainWindow: BrowserWindow | undefined
let harness: RunningHarness | undefined
let stopping = false

app.setName(PRODUCT_NAME)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerPetStoreIpc(() => mainWindow?.webContents)
  registerPetWindowIpc(() => mainWindow?.webContents)
  ipcMain.on('deepseek-desktop:quit', (event) => {
    if (event.sender === mainWindow?.webContents) app.quit()
  })

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(startDesktop).catch((error: unknown) => {
    if (isPrewarm) {
      app.quit()
      return
    }
    dialog.showErrorBox('DeepSeek Desktop failed to start', errorMessage(error))
    app.quit()
  })
}

async function startDesktop(): Promise<void> {
  Menu.setApplicationMenu(null)

  const appPath = app.getAppPath()
  const nodePath = join(appPath, 'node_modules', 'node', 'bin', 'node.exe')
  const cliPath = join(appPath, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const patchPath = join(appPath, 'build', 'desktop.patch.yml')
  const preloadPath = join(appPath, 'out', 'preload.cjs')
  const petPreloadPath = join(appPath, 'out', 'pet-preload.cjs')
  const petHtmlPath = join(appPath, 'out', 'pet.html')
  const companionDir = join(appPath, 'node_modules', '@deepseek-desktop', 'companion')
  if (!existsSync(nodePath)) throw new Error(`Bundled Node.js runtime is missing:\n${nodePath}`)
  if (!existsSync(cliPath)) throw new Error(`Bundled DeepSeek Harness entry is missing:\n${cliPath}`)
  if (!existsSync(patchPath)) throw new Error(`DeepSeek Desktop Harness overlay is missing:\n${patchPath}`)
  if (!existsSync(preloadPath)) throw new Error(`DeepSeek Desktop preload is missing:\n${preloadPath}`)
  if (!isPrewarm && !existsSync(petPreloadPath)) throw new Error(`DeepSeek Desktop pet preload is missing:\n${petPreloadPath}`)
  if (!isPrewarm && !existsSync(petHtmlPath)) throw new Error(`DeepSeek Desktop pet page is missing:\n${petHtmlPath}`)
  if (!existsSync(companionDir)) throw new Error(`DeepSeek Desktop Companion is missing:\n${companionDir}`)

  const cwd = join(app.getPath('userData'), 'launch-root')
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  await mkdir(cwd, { recursive: true })
  await ensureCompanionLink(dshHome, companionDir)

  harness = await startHarness({
    nodePath,
    cliPath,
    patchPath,
    cwd,
    dshHome,
    port: await chooseHarnessPort(),
    startupTimeoutMs: isPrewarm ? 180_000 : 120_000
  })

  const running = harness
  running.child.once('exit', (code, signal) => {
    if (stopping || harness !== running) return
    harness = undefined
    if (isPrewarm) {
      app.quit()
      return
    }
    const detail = signal ? `signal ${signal}` : `exit code ${code ?? -1}`
    const output = running.stderrLines.length ? `\n\n${running.stderrLines.join('\n')}` : ''
    dialog.showErrorBox('DeepSeek Harness stopped', `The local Harness process stopped unexpectedly (${detail}).${output}`)
    app.quit()
  })

  mainWindow = createWindow(running.url, preloadPath)
  await mainWindow.loadURL(running.url)
  if (isPrewarm) {
    await delay(2_000)
    app.quit()
    return
  }
  await openPetWindow(petPreloadPath, petHtmlPath)
  mainWindow.show()
}

function createWindow(harnessUrl: string, preloadPath: string): BrowserWindow {
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: join(app.getAppPath(), 'build', 'icon.ico'),
    backgroundColor: '#f7f8fa',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: preloadPath
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedHarnessUrl(url, harnessUrl)) return
    event.preventDefault()
    if (url.startsWith('https://')) void shell.openExternal(url)
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.on('closed', () => {
    if (mainWindow !== window) return
    mainWindow = undefined
    if (!stopping) app.quit()
  })

  return window
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

app.on('window-all-closed', () => app.quit())

app.on('before-quit', (event) => {
  if (!harness || stopping) return

  event.preventDefault()
  stopping = true
  const running = harness
  void stopHarness(running).finally(() => {
    if (harness === running) harness = undefined
    app.quit()
  })
})
