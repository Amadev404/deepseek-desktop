import { contextBridge, ipcRenderer } from 'electron'
import {
  PET_ACTIVATE_CHANNEL,
  PET_DRAG_END_CHANNEL,
  PET_DRAG_MOVE_CHANNEL,
  PET_DRAG_START_CHANNEL,
  PET_READY_CHANNEL,
  PET_STATE_CHANNEL,
  type DesktopPetSnapshot,
  type PetWindowBridge
} from './pet-window-contract.js'

const bridge: PetWindowBridge = Object.freeze({
  activate: (sessionId?: string): void => ipcRenderer.send(PET_ACTIVATE_CHANNEL, sessionId),
  dragEnd: (): void => ipcRenderer.send(PET_DRAG_END_CHANNEL),
  dragMove: (screenX: number, screenY: number): void => ipcRenderer.send(PET_DRAG_MOVE_CHANNEL, { screenX, screenY }),
  dragStart: (screenX: number, screenY: number): void => ipcRenderer.send(PET_DRAG_START_CHANNEL, { screenX, screenY }),
  onSnapshot: (listener: (snapshot: DesktopPetSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DesktopPetSnapshot): void => listener(snapshot)
    ipcRenderer.on(PET_STATE_CHANNEL, handler)
    return () => ipcRenderer.removeListener(PET_STATE_CHANNEL, handler)
  },
  ready: (): void => ipcRenderer.send(PET_READY_CHANNEL)
})

contextBridge.exposeInMainWorld('deepseekDesktopPet', bridge)
