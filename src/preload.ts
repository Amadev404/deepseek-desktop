import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('deepseekDesktop', Object.freeze({
  quit: (): void => ipcRenderer.send('deepseek-desktop:quit')
}))
