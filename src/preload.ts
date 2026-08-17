import { contextBridge, ipcRenderer } from 'electron'
import type { StoredPetRecord } from './pet-store.js'
import {
  PET_OPEN_SESSION_CHANNEL,
  PET_RESET_CHANNEL,
  PET_SYNC_CHANNEL,
  type DesktopPetSnapshot
} from './pet-window-contract.js'

contextBridge.exposeInMainWorld('deepseekDesktop', Object.freeze({
  quit: (): void => ipcRenderer.send('deepseek-desktop:quit'),
  petStore: Object.freeze({
    list: (): Promise<StoredPetRecord[]> => ipcRenderer.invoke('deepseek-desktop:pet-list'),
    save: (record: StoredPetRecord): Promise<void> => ipcRenderer.invoke('deepseek-desktop:pet-save', record),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('deepseek-desktop:pet-remove', id)
  }),
  petOverlay: Object.freeze({
    sync: (snapshot: DesktopPetSnapshot): void => ipcRenderer.send(PET_SYNC_CHANNEL, snapshot),
    resetPosition: (): void => ipcRenderer.send(PET_RESET_CHANNEL),
    onOpenSession: (listener: (sessionId: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: string): void => listener(sessionId)
      ipcRenderer.on(PET_OPEN_SESSION_CHANNEL, handler)
      return () => ipcRenderer.removeListener(PET_OPEN_SESSION_CHANNEL, handler)
    }
  })
}))
