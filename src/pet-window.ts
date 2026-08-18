import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type Rectangle,
  type WebContents
} from 'electron'
import {
  PET_ACTIVATE_CHANNEL,
  PET_DRAG_END_CHANNEL,
  PET_DRAG_MOVE_CHANNEL,
  PET_DRAG_START_CHANNEL,
  PET_OPEN_SESSION_CHANNEL,
  PET_READY_CHANNEL,
  PET_RESET_CHANNEL,
  PET_STATE_CHANNEL,
  PET_STATUS_PLACEMENT_CHANNEL,
  PET_SYNC_CHANNEL,
  type DesktopPetSnapshot,
  type PetStatusPlacement
} from './pet-window-contract.js'
import {
  clampPetWindowPosition,
  defaultPetWindowPosition,
  petWindowShape,
  PET_SPRITE_TOP,
  PET_WINDOW_HEIGHT,
  PET_WINDOW_WIDTH,
  type Point
} from './pet-window-runtime.js'

const DEFAULT_SCALE = 1.15
const MAX_SPRITESHEET_DATA_URL_LENGTH = 20 * 1024 * 1024
const PET_POSITION_LAYOUT_VERSION = 3
const LEGACY_PET_SPRITE_TOP = 26

let petWindow: BrowserWindow | undefined
let latestSnapshot: DesktopPetSnapshot | undefined
let savedPosition: Point | undefined
let drag: { offsetX: number; offsetY: number } | undefined
let getOwner: (() => WebContents | undefined) | undefined
let writePosition = Promise.resolve()
let statusPlacement: PetStatusPlacement = 'hidden'

export function registerPetWindowIpc(owner: () => WebContents | undefined): void {
  getOwner = owner

  ipcMain.on(PET_SYNC_CHANNEL, (event, value: unknown) => {
    assertOwner(event)
    latestSnapshot = validateSnapshot(value)
    syncWindow()
  })
  ipcMain.on(PET_RESET_CHANNEL, (event) => {
    assertOwner(event)
    savedPosition = undefined
    writePosition = writePosition.then(() => rm(positionPath(), { force: true })).catch(() => undefined)
    positionWindow(true)
  })
  ipcMain.on(PET_READY_CHANNEL, (event) => {
    assertPetWindow(event)
    syncWindow()
  })
  ipcMain.on(PET_STATUS_PLACEMENT_CHANNEL, (event, value: unknown) => {
    assertPetWindow(event)
    if (value !== 'above' && value !== 'below' && value !== 'hidden') {
      throw new Error('Invalid DeepSeek pet status placement.')
    }
    if (value === statusPlacement) return
    statusPlacement = value
    updateWindowShape()
  })
  ipcMain.on(PET_DRAG_START_CHANNEL, (event, value: unknown) => {
    assertPetWindow(event)
    if (!petWindow) return
    const cursor = screenPoint(value) ?? screen.getCursorScreenPoint()
    const bounds = petWindow.getBounds()
    drag = { offsetX: cursor.x - bounds.x, offsetY: cursor.y - bounds.y }
  })
  ipcMain.on(PET_DRAG_MOVE_CHANNEL, (event, value: unknown) => {
    assertPetWindow(event)
    if (!petWindow || !drag) return
    const cursor = screenPoint(value) ?? screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const point = clampPetWindowPosition({
      x: cursor.x - drag.offsetX,
      y: cursor.y - drag.offsetY
    }, display.workArea, latestSnapshot?.scale ?? DEFAULT_SCALE, latestSnapshot?.pet.spriteVersionNumber ?? 2)
    petWindow.setPosition(point.x, point.y)
    updateWindowShape()
    savedPosition = point
  })
  ipcMain.on(PET_DRAG_END_CHANNEL, (event) => {
    assertPetWindow(event)
    drag = undefined
    if (savedPosition) persistPosition(savedPosition)
  })
  ipcMain.on(PET_ACTIVATE_CHANNEL, (event, sessionId: unknown) => {
    assertPetWindow(event)
    const owner = getOwner?.()
    const ownerWindow = owner ? BrowserWindow.fromWebContents(owner) : undefined
    if (ownerWindow) {
      if (ownerWindow.isMinimized()) ownerWindow.restore()
      ownerWindow.show()
      ownerWindow.focus()
    }
    if (typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 256) {
      owner?.send(PET_OPEN_SESSION_CHANNEL, sessionId)
    }
  })
}

export async function openPetWindow(preloadPath: string, htmlPath: string): Promise<void> {
  savedPosition = await readPosition()
  const window = new BrowserWindow({
    title: 'DeepSeek Desktop Pet',
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: true,
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: 'deepseek-desktop-pet',
      preload: preloadPath
    }
  })
  petWindow = window
  window.setAlwaysOnTop(true, 'floating')
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.on('closed', () => {
    if (petWindow === window) {
      petWindow = undefined
      statusPlacement = 'hidden'
    }
  })

  await window.loadFile(htmlPath)
  positionWindow(savedPosition === undefined)
  syncWindow()

  screen.on('display-metrics-changed', repositionForDisplays)
  screen.on('display-removed', repositionForDisplays)
}

function syncWindow(): void {
  if (!petWindow || petWindow.isDestroyed() || !latestSnapshot) return
  petWindow.webContents.send(PET_STATE_CHANNEL, latestSnapshot)
  if (!latestSnapshot.enabled) statusPlacement = 'hidden'
  if (latestSnapshot.enabled) {
    positionWindow(false)
    petWindow.showInactive()
  } else {
    updateWindowShape()
    petWindow.hide()
  }
}

function positionWindow(useDefault: boolean): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const current = savedPosition ?? { x: petWindow.getBounds().x, y: petWindow.getBounds().y }
  const display = useDefault || savedPosition === undefined
    ? ownerDisplay()
    : screen.getDisplayMatching({ x: current.x, y: current.y, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT })
  const point = useDefault || savedPosition === undefined
    ? defaultPetWindowPosition(display.workArea, latestSnapshot?.scale ?? DEFAULT_SCALE, latestSnapshot?.pet.spriteVersionNumber ?? 2)
    : clampPetWindowPosition(current, display.workArea, latestSnapshot?.scale ?? DEFAULT_SCALE, latestSnapshot?.pet.spriteVersionNumber ?? 2)
  savedPosition = point
  petWindow.setPosition(point.x, point.y)
  updateWindowShape()
}

function ownerDisplay(): Electron.Display {
  const owner = getOwner?.()
  const ownerWindow = owner ? BrowserWindow.fromWebContents(owner) : undefined
  return ownerWindow ? screen.getDisplayMatching(ownerWindow.getBounds()) : screen.getPrimaryDisplay()
}

function repositionForDisplays(): void {
  positionWindow(savedPosition === undefined)
}

function updateWindowShape(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  // Reapplying after a cross-display move lets Electron rebuild the native region at the new DPI.
  petWindow.setShape(petWindowShape(latestSnapshot?.scale ?? DEFAULT_SCALE, statusPlacement, latestSnapshot?.pet.spriteVersionNumber ?? 2))
}

function persistPosition(point: Point): void {
  writePosition = writePosition
    .then(() => writeFile(positionPath(), JSON.stringify({ ...point, layoutVersion: PET_POSITION_LAYOUT_VERSION }), 'utf8'))
    .catch(() => undefined)
}

async function readPosition(): Promise<Point | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(positionPath(), 'utf8'))
    if (!value || typeof value !== 'object') return undefined
    const point = value as Partial<Point> & { layoutVersion?: unknown }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined
    if (Math.abs(point.x!) > 100_000 || Math.abs(point.y!) > 100_000) return undefined
    if (point.layoutVersion !== undefined && point.layoutVersion !== PET_POSITION_LAYOUT_VERSION) return undefined
    return {
      x: Math.round(point.x!),
      y: Math.round(point.y! - (point.layoutVersion === undefined ? PET_SPRITE_TOP - LEGACY_PET_SPRITE_TOP : 0))
    }
  } catch {
    return undefined
  }
}

function positionPath(): string {
  return join(app.getPath('userData'), 'deepseek-pet-window.json')
}

function assertOwner(event: IpcMainEvent): void {
  if (event.sender !== getOwner?.()) throw new Error('Untrusted DeepSeek pet owner sender.')
}

function assertPetWindow(event: IpcMainEvent): void {
  if (event.sender !== petWindow?.webContents) throw new Error('Untrusted DeepSeek pet window sender.')
}

function validateSnapshot(value: unknown): DesktopPetSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid DeepSeek pet snapshot.')
  const snapshot = value as Partial<DesktopPetSnapshot>
  const pet = snapshot.pet
  const signal = snapshot.signal
  if (typeof snapshot.enabled !== 'boolean'
    || typeof snapshot.animated !== 'boolean'
    || typeof snapshot.scale !== 'number'
    || snapshot.scale < .7
    || snapshot.scale > 1.5
    || !pet
    || typeof pet.id !== 'string'
    || pet.id.length === 0
    || pet.id.length > 64
    || typeof pet.displayName !== 'string'
    || pet.displayName.length === 0
    || pet.displayName.length > 80
    || (pet.spriteVersionNumber !== 1 && pet.spriteVersionNumber !== 2 && pet.spriteVersionNumber !== 3)
    || typeof pet.spritesheetDataUrl !== 'string'
    || pet.spritesheetDataUrl.length > MAX_SPRITESHEET_DATA_URL_LENGTH
    || !/^data:image\/(?:webp|png);base64,[A-Za-z0-9+/=]+$/.test(pet.spritesheetDataUrl)
    || !signal
    || !['idle', 'failed', 'waiting', 'running', 'review'].includes(signal.mode ?? '')
    || typeof signal.key !== 'string'
    || signal.key.length > 512
    || typeof signal.label !== 'string'
    || signal.label.length > 160
    || (signal.context !== undefined && (typeof signal.context !== 'string' || signal.context.length > 1_024))
    || (signal.sessionId !== undefined && (typeof signal.sessionId !== 'string' || signal.sessionId.length > 256))) {
    throw new Error('Invalid DeepSeek pet snapshot.')
  }
  return snapshot as DesktopPetSnapshot
}

function screenPoint(value: unknown): Point | undefined {
  if (!value || typeof value !== 'object') return undefined
  const point = value as { screenX?: unknown; screenY?: unknown }
  if (typeof point.screenX !== 'number' || typeof point.screenY !== 'number') return undefined
  if (!Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) return undefined
  if (Math.abs(point.screenX) > 100_000 || Math.abs(point.screenY) > 100_000) return undefined
  return { x: Math.round(point.screenX), y: Math.round(point.screenY) }
}
