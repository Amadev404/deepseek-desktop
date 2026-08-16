import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { startHarness, stopHarness, type RunningHarness } from './harness.js'
import { chooseHarnessPort, isTrustedHarnessUrl } from './runtime.js'

const PRODUCT_NAME = 'DeepSeek Desktop'

let mainWindow: BrowserWindow | undefined
let harness: RunningHarness | undefined
let stopping = false

app.setName(PRODUCT_NAME)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(startDesktop).catch((error: unknown) => {
    dialog.showErrorBox('DeepSeek Desktop failed to start', errorMessage(error))
    app.quit()
  })
}

async function startDesktop(): Promise<void> {
  Menu.setApplicationMenu(null)

  const appPath = app.getAppPath()
  const nodePath = join(appPath, 'node_modules', 'node', 'bin', 'node.exe')
  const cliPath = join(appPath, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(nodePath)) throw new Error(`Bundled Node.js runtime is missing:\n${nodePath}`)
  if (!existsSync(cliPath)) throw new Error(`Bundled DeepSeek Harness entry is missing:\n${cliPath}`)

  const cwd = join(app.getPath('userData'), 'launch-root')
  await mkdir(cwd, { recursive: true })

  harness = await startHarness({
    nodePath,
    cliPath,
    cwd,
    dshHome: process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'),
    port: await chooseHarnessPort()
  })

  const running = harness
  running.child.once('exit', (code, signal) => {
    if (stopping || harness !== running) return
    harness = undefined
    const detail = signal ? `signal ${signal}` : `exit code ${code ?? -1}`
    const output = running.stderrLines.length ? `\n\n${running.stderrLines.join('\n')}` : ''
    dialog.showErrorBox('DeepSeek Harness stopped', `The local Harness process stopped unexpectedly (${detail}).${output}`)
    app.quit()
  })

  mainWindow = createWindow(running.url)
  await mainWindow.loadURL(running.url)
  mainWindow.show()
}

function createWindow(harnessUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    backgroundColor: '#f7f8fa',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
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
    if (mainWindow === window) mainWindow = undefined
  })

  return window
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error)
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
