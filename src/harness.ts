import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from 'node:child_process'
import { dirname, delimiter } from 'node:path'
import { createInterface } from 'node:readline'
import { parseHarnessUrl } from './runtime.js'

export interface HarnessOptions {
  nodePath: string
  cliPath: string
  cwd: string
  dshHome: string
  port: number
  startupTimeoutMs?: number
}

export interface RunningHarness {
  child: ChildProcessWithoutNullStreams
  url: string
  stderrLines: string[]
}

function spawnOptions(options: HarnessOptions): SpawnOptionsWithoutStdio {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  const parentPath = env[pathKey] ?? env.PATH ?? ''
  env[pathKey] = `${dirname(options.nodePath)}${delimiter}${parentPath}`
  env.DSH_HOME = options.dshHome
  env.NO_COLOR = '1'

  return {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  }
}

function keepLast(lines: string[], line: string, limit = 40): void {
  lines.push(line)
  if (lines.length > limit) lines.splice(0, lines.length - limit)
}

export async function startHarness(options: HarnessOptions): Promise<RunningHarness> {
  const child = spawn(
    options.nodePath,
    [
      options.cliPath,
      'web',
      '--host',
      '127.0.0.1',
      '--port',
      String(options.port)
    ],
    spawnOptions(options)
  )

  const stdout = createInterface({ input: child.stdout })
  const stderr = createInterface({ input: child.stderr })
  const stderrLines: string[] = []
  stderr.on('line', (line) => keepLast(stderrLines, line))

  const url = await new Promise<string>((resolve, reject) => {
    let timeout: NodeJS.Timeout
    const finish = (action: () => void): void => {
      clearTimeout(timeout)
      child.off('error', onError)
      child.off('exit', onExit)
      stdout.off('line', onLine)
      action()
    }
    timeout = setTimeout(() => {
      const output = stderrLines.length ? `\n\n${stderrLines.join('\n')}` : ''
      finish(() => reject(new Error(`DeepSeek Harness did not become ready within ${options.startupTimeoutMs ?? 120_000} ms.${output}`)))
    }, options.startupTimeoutMs ?? 120_000)
    const onLine = (line: string): void => {
      const parsed = parseHarnessUrl(line)
      if (parsed) finish(() => resolve(parsed))
    }
    const onError = (error: Error): void => finish(() => reject(error))
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? -1}`
      const output = stderrLines.length ? `\n\n${stderrLines.join('\n')}` : ''
      finish(() => reject(new Error(`DeepSeek Harness exited before startup (${detail}).${output}`)))
    }

    stdout.on('line', onLine)
    child.once('error', onError)
    child.once('exit', onExit)
  }).catch((error: unknown) => {
    stdout.close()
    stderr.close()
    if (child.exitCode === null) child.kill('SIGTERM')
    throw error
  })

  return { child, url, stderrLines }
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true)

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = (): void => {
      clearTimeout(timeout)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function killWindowsTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true },
      () => resolve()
    )
  })
}

export async function stopHarness(running: RunningHarness): Promise<void> {
  const { child } = running
  if (child.exitCode !== null) return

  child.kill('SIGTERM')
  if (await waitForExit(child, 5_000)) return

  if (process.platform === 'win32' && child.pid) await killWindowsTree(child.pid)
  else child.kill('SIGKILL')
  await waitForExit(child, 5_000)
}
