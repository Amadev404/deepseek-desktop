export const PET_SYNC_CHANNEL = 'deepseek-desktop:pet-sync'
export const PET_RESET_CHANNEL = 'deepseek-desktop:pet-reset-position'
export const PET_STATE_CHANNEL = 'deepseek-desktop:pet-window-state'
export const PET_READY_CHANNEL = 'deepseek-desktop:pet-window-ready'
export const PET_DRAG_START_CHANNEL = 'deepseek-desktop:pet-drag-start'
export const PET_DRAG_MOVE_CHANNEL = 'deepseek-desktop:pet-drag-move'
export const PET_DRAG_END_CHANNEL = 'deepseek-desktop:pet-drag-end'
export const PET_ACTIVATE_CHANNEL = 'deepseek-desktop:pet-activate'
export const PET_OPEN_SESSION_CHANNEL = 'deepseek-desktop:pet-open-session'
export const PET_STATUS_PLACEMENT_CHANNEL = 'deepseek-desktop:pet-status-placement'

export type PetStatusPlacement = 'above' | 'below' | 'hidden'

export type DesktopPetMode =
  | 'idle'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export interface DesktopPetSignal {
  mode: DesktopPetMode
  key: string
  label: string
  sessionId?: string
}

export interface DesktopPetRecord {
  id: string
  displayName: string
  spriteVersionNumber: 1 | 2
  spritesheetDataUrl: string
}

export interface DesktopPetSnapshot {
  animated: boolean
  enabled: boolean
  pet: DesktopPetRecord
  scale: number
  signal: DesktopPetSignal
}

export interface PetWindowBridge {
  activate(sessionId?: string): void
  dragEnd(): void
  dragMove(screenX: number, screenY: number): void
  dragStart(screenX: number, screenY: number): void
  onSnapshot(listener: (snapshot: DesktopPetSnapshot) => void): () => void
  ready(): void
  setStatusPlacement(placement: PetStatusPlacement): void
}
