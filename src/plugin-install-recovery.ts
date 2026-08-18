import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'] as const

interface RecoveryFile {
  name: typeof FILES[number]
  present: boolean
  mode?: number
}

export interface PluginInstallRecoveryState {
  version: 1
  phase: 'prepared' | 'awaiting-restart' | 'verifying' | 'rolled-back'
  receiptId: string
  packageName: string
  packageVersion: string
  files: RecoveryFile[]
}

export function pluginRecoveryRoot(userData: string): string {
  return join(userData, 'plugin-install-recovery')
}

export async function readPluginRecovery(userData: string): Promise<PluginInstallRecoveryState | undefined> {
  try {
    const value = JSON.parse(await readFile(join(pluginRecoveryRoot(userData), 'state.json'), 'utf8')) as unknown
    if (!validState(value)) throw new Error('Invalid plugin install recovery state.')
    return value
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
}

export async function markPluginRecoveryVerifying(userData: string, state: PluginInstallRecoveryState): Promise<void> {
  await writeState(userData, { ...state, phase: 'verifying' })
}

export async function restorePluginRecovery(userData: string, dshHome: string, state: PluginInstallRecoveryState): Promise<void> {
  const root = pluginRecoveryRoot(userData)
  const profileDir = join(dshHome, 'profiles', 'web')
  for (const file of state.files) {
    const target = join(profileDir, file.name)
    if (!file.present) {
      await rm(target, { force: true })
      continue
    }
    const data = await readFile(join(root, 'backup', file.name))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data, { mode: file.mode })
    if (file.mode !== undefined) await chmod(target, file.mode)
  }
  await writeState(userData, { ...state, phase: 'rolled-back' })
}

export async function clearPluginRecovery(userData: string): Promise<void> {
  await rm(pluginRecoveryRoot(userData), { recursive: true, force: true })
}

async function writeState(userData: string, state: PluginInstallRecoveryState): Promise<void> {
  const root = pluginRecoveryRoot(userData)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'state.json'), `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 })
}

function validState(value: unknown): value is PluginInstallRecoveryState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Partial<PluginInstallRecoveryState>
  return state.version === 1
    && ['prepared', 'awaiting-restart', 'verifying', 'rolled-back'].includes(state.phase ?? '')
    && typeof state.receiptId === 'string'
    && typeof state.packageName === 'string'
    && typeof state.packageVersion === 'string'
    && Array.isArray(state.files)
    && state.files.every((file) => typeof file === 'object' && file !== null
      && FILES.includes((file as RecoveryFile).name)
      && typeof (file as RecoveryFile).present === 'boolean')
}

function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
