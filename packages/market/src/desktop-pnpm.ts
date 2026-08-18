import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import type {
  MarketDesktopPnpm,
  MarketDesktopPnpmHandle,
  MarketDesktopPnpmOutcome,
} from './install/service.js'

const FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'] as const

interface RecoveryState {
  version: 1
  phase: 'prepared' | 'awaiting-restart' | 'rolled-back'
  receiptId: string
  packageName: string
  packageVersion: string
  files: Array<{ name: typeof FILES[number]; present: boolean; mode?: number }>
}

export class DesktopMarketPnpm implements MarketDesktopPnpm {
  private active: ChildProcess | undefined

  constructor(
    private readonly nodePath: string,
    private readonly cliPath: string,
    private readonly dshHome: string,
    private readonly profileDir: string,
    private readonly recoveryRoot: string,
  ) {}

  runPlugin(args: readonly string[], invokingDir: string, signal?: AbortSignal): MarketDesktopPnpmHandle {
    return this.spawn(args, invokingDir, signal)
  }

  async runPluginInstall(
    args: readonly string[],
    invokingDir: string,
    recovery: { readonly packageName: string; readonly packageVersion: string; readonly receiptId: string },
    signal?: AbortSignal,
  ): Promise<MarketDesktopPnpmHandle> {
    if (args[0] !== 'add') throw new Error('Plugin install must use dsh plugin add.')
    await this.beginRecovery(recovery)
    let handle: MarketDesktopPnpmHandle
    try {
      handle = this.spawn(args, invokingDir, signal)
    } catch (error) {
      await this.restoreAndClear()
      throw error
    }
    const done = handle.done.then(async (outcome) => {
      if (outcome.exitCode === 0 && outcome.signal === null) {
        const state = await this.readRecovery()
        if (state) await this.writeRecovery({ ...state, phase: 'awaiting-restart' })
      } else {
        await this.restoreAndClear()
      }
      return outcome
    })
    return { ...handle, done }
  }

  async recoveredInstallReceiptIds(): Promise<readonly string[]> {
    const state = await this.readRecovery()
    return state?.phase === 'rolled-back' ? [state.receiptId] : []
  }

  async acknowledgeRecoveredInstall(receiptId: string): Promise<void> {
    const state = await this.readRecovery()
    if (state?.phase === 'rolled-back' && state.receiptId === receiptId) await this.clearRecovery()
  }

  async rollbackPluginInstall(receiptId: string): Promise<boolean> {
    const state = await this.readRecovery()
    if (!state || state.receiptId !== receiptId) return false
    await this.restoreAndClear()
    return true
  }

  private spawn(args: readonly string[], cwd: string, signal?: AbortSignal): MarketDesktopPnpmHandle {
    if (this.active) throw new Error('Another plugin operation is already running.')
    if (args.length === 0 || args.some((value) => value.includes('\0'))) throw new Error('Invalid plugin arguments.')
    const child = spawn(this.nodePath, [this.cliPath, 'plugin', '--profile', 'web', ...args], {
      cwd,
      env: { ...process.env, DSH_HOME: this.dshHome, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.active = child
    const done = new Promise<MarketDesktopPnpmOutcome>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (exitCode, childSignal) => resolve({ exitCode, signal: childSignal }))
    }).finally(() => {
      if (this.active === child) this.active = undefined
      signal?.removeEventListener('abort', cancel)
    })
    const cancel = (): void => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM') }
    signal?.addEventListener('abort', cancel, { once: true })
    return {
      stdout: child.stdout as Readable,
      stderr: child.stderr as Readable,
      done,
      cancel,
    }
  }

  private async beginRecovery(input: { packageName: string; packageVersion: string; receiptId: string }): Promise<void> {
    if (await this.readRecovery()) throw new Error('A previous plugin recovery transaction is still pending.')
    const backup = join(this.recoveryRoot, 'backup')
    await mkdir(backup, { recursive: true })
    const files: RecoveryState['files'] = []
    for (const name of FILES) {
      const source = join(this.profileDir, name)
      try {
        const info = await stat(source)
        if (!info.isFile()) throw new Error(`Plugin profile entry is not a file: ${name}`)
        await copyFile(source, join(backup, name))
        files.push({ name, present: true, mode: info.mode })
      } catch (error) {
        if (!missing(error)) throw error
        files.push({ name, present: false })
      }
    }
    await this.writeRecovery({ version: 1, phase: 'prepared', ...input, files })
  }

  private async restoreAndClear(): Promise<void> {
    const state = await this.readRecovery()
    if (!state) return
    for (const file of state.files) {
      const target = join(this.profileDir, file.name)
      if (!file.present) {
        await rm(target, { force: true })
        continue
      }
      await mkdir(dirname(target), { recursive: true })
      await copyFile(join(this.recoveryRoot, 'backup', file.name), target)
      if (file.mode !== undefined) await chmod(target, file.mode)
    }
    await this.clearRecovery()
  }

  private async readRecovery(): Promise<RecoveryState | undefined> {
    try {
      return JSON.parse(await readFile(join(this.recoveryRoot, 'state.json'), 'utf8')) as RecoveryState
    } catch (error) {
      if (missing(error)) return undefined
      throw error
    }
  }

  private async writeRecovery(state: RecoveryState): Promise<void> {
    await mkdir(this.recoveryRoot, { recursive: true })
    await writeFile(join(this.recoveryRoot, 'state.json'), `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 })
  }

  private async clearRecovery(): Promise<void> {
    await rm(this.recoveryRoot, { recursive: true, force: true })
  }
}

function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
