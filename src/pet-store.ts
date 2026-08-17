import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

export const PET_LIST_CHANNEL = 'deepseek-desktop:pet-list'
export const PET_SAVE_CHANNEL = 'deepseek-desktop:pet-save'
export const PET_REMOVE_CHANNEL = 'deepseek-desktop:pet-remove'

const PET_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const DEFAULT_PET_ID = 'deepseek-whale-girl'
const MAX_RECORD_BYTES = 20 * 1024 * 1024

export interface StoredPetRecord {
  id: string
  displayName: string
  description: string
  spriteVersionNumber: 1 | 2
  spritesheetDataUrl: string
}

export function registerPetStoreIpc(getOwner: () => WebContents | undefined): void {
  ipcMain.handle(PET_LIST_CHANNEL, async (event) => {
    assertOwner(event, getOwner)
    return listPetRecords()
  })
  ipcMain.handle(PET_SAVE_CHANNEL, async (event, record: unknown) => {
    assertOwner(event, getOwner)
    const value = validatePetRecord(record)
    const root = await petStoreRoot()
    await writeFile(join(root, `${value.id}.json`), JSON.stringify(value), 'utf8')
  })
  ipcMain.handle(PET_REMOVE_CHANNEL, async (event, id: unknown) => {
    assertOwner(event, getOwner)
    if (typeof id !== 'string' || !PET_ID.test(id) || id === DEFAULT_PET_ID) throw new Error('Invalid pet id.')
    await rm(join(await petStoreRoot(), `${id}.json`), { force: true })
  })
}

function assertOwner(event: IpcMainInvokeEvent, getOwner: () => WebContents | undefined): void {
  if (event.sender !== getOwner()) throw new Error('Untrusted pet store sender.')
}

async function listPetRecords(): Promise<StoredPetRecord[]> {
  const root = await petStoreRoot()
  const files = await readdir(root, { withFileTypes: true })
  const records: StoredPetRecord[] = []
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json')) continue
    try {
      const raw = await readFile(join(root, file.name), 'utf8')
      if (Buffer.byteLength(raw, 'utf8') > MAX_RECORD_BYTES) continue
      const parsed: unknown = JSON.parse(raw)
      if (isStoredPetRecord(parsed)) records.push(parsed)
    } catch {
      // Ignore one broken custom pet and keep the remaining library usable.
    }
  }
  return records
}

async function petStoreRoot(): Promise<string> {
  const root = join(app.getPath('userData'), 'pets')
  await mkdir(root, { recursive: true })
  return root
}

function validatePetRecord(value: unknown): StoredPetRecord {
  if (!isStoredPetRecord(value)) throw new Error('Invalid custom pet record.')
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) throw new Error('Custom pet is too large.')
  return value
}

function isStoredPetRecord(value: unknown): value is StoredPetRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredPetRecord>
  return typeof record.id === 'string'
    && PET_ID.test(record.id)
    && record.id !== DEFAULT_PET_ID
    && typeof record.displayName === 'string'
    && record.displayName.length > 0
    && record.displayName.length <= 80
    && typeof record.description === 'string'
    && record.description.length <= 160
    && (record.spriteVersionNumber === 1 || record.spriteVersionNumber === 2)
    && typeof record.spritesheetDataUrl === 'string'
    && /^data:image\/(?:webp|png);base64,[A-Za-z0-9+/=]+$/.test(record.spritesheetDataUrl)
}
