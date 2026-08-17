import { contextBridge, ipcRenderer } from 'electron'
import type { StoredPetRecord } from './pet-store.js'

contextBridge.exposeInMainWorld('deepseekDesktop', Object.freeze({
  quit: (): void => ipcRenderer.send('deepseek-desktop:quit'),
  petStore: Object.freeze({
    list: (): Promise<StoredPetRecord[]> => ipcRenderer.invoke('deepseek-desktop:pet-list'),
    save: (record: StoredPetRecord): Promise<void> => ipcRenderer.invoke('deepseek-desktop:pet-save', record),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('deepseek-desktop:pet-remove', id)
  })
}))
