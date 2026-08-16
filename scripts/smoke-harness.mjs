import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, delimiter, isAbsolute, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = process.env.DEEPSEEK_DESKTOP_APP_ROOT
  ? resolve(process.env.DEEPSEEK_DESKTOP_APP_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodePath = join(root, 'node_modules', 'node', 'bin', 'node.exe')
const cliPath = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const patchPath = join(root, 'build', 'desktop.patch.yml')
const companionPath = join(root, 'node_modules', '@deepseek-desktop', 'companion', 'lib', 'client.js')
const tempRoot = await mkdtemp(join(tmpdir(), 'deepseek-desktop-smoke-'))
const dshHome = join(tempRoot, '.dsh')
const launchRoot = join(tempRoot, 'launch-root')
let child

try {
  await access(nodePath)
  await access(cliPath)
  await access(patchPath)
  await access(companionPath)
  if (process.env.DEEPSEEK_DESKTOP_APP_ROOT) await verifyRuntimePeers(root)
  await mkdir(launchRoot, { recursive: true })
  const companionLink = join(dshHome, 'profiles', 'node_modules', '@deepseek-desktop', 'companion')
  await mkdir(dirname(companionLink), { recursive: true })
  await symlink(join(root, 'node_modules', '@deepseek-desktop', 'companion'), companionLink, process.platform === 'win32' ? 'junction' : 'dir')

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()
    if (upper === 'INIT_CWD'
      || upper === 'DEEPSEEK_API_KEY'
      || upper === 'DEEPSEEK_BASE_URL'
      || key.toLowerCase().startsWith('npm_')) delete env[key]
  }
  env.DSH_HOME = dshHome
  env.NO_COLOR = '1'
  env.Path = `${dirname(nodePath)}${delimiter}${env.Path ?? env.PATH ?? ''}`

  child = spawn(
    nodePath,
    [cliPath, 'web', '--patch', patchPath, '--host', '127.0.0.1', '--port', '0'],
    { cwd: launchRoot, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
  )

  const stderr = []
  createInterface({ input: child.stderr }).on('line', (line) => stderr.push(line))
  const url = await waitForUrl(child, stderr)
  await delay(2_000)
  if (child.exitCode !== null) {
    throw new Error(`Harness exited after announcing readiness (exit code ${child.exitCode}).\n${stderr.slice(-80).join('\n')}`)
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`Harness returned HTTP ${response.status}.`)
  const html = await response.text()
  if (!html.includes('@deepseek-desktop/companion')) {
    throw new Error('Harness boot manifest does not contain the Desktop Companion client.')
  }

  const companionResponse = await fetch(new URL('/plugins/@deepseek-desktop/companion/client.js', url), {
    signal: AbortSignal.timeout(5_000)
  })
  if (!companionResponse.ok) throw new Error(`Desktop Companion bundle returned HTTP ${companionResponse.status}.`)

  const balanceResponse = await fetch(new URL('/deepseek-desktop/api/balance', url), {
    signal: AbortSignal.timeout(5_000)
  })
  if (!balanceResponse.ok) throw new Error(`Desktop balance route returned HTTP ${balanceResponse.status}.`)
  const balance = await balanceResponse.json()
  if (balance.status !== 'unconfigured') {
    throw new Error(`Expected an isolated unconfigured balance response, received ${JSON.stringify(balance)}.`)
  }

  for (const path of [
    join(dshHome, 'profiles', 'web', 'package.json'),
    join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  ]) {
    if (!existsSync(path)) throw new Error(`Harness did not initialize ${path}.`)
  }

  process.stdout.write(`Harness smoke test passed at ${url}\n`)
} finally {
  if (child) await stop(child)
  if (tempRoot.startsWith(resolve(tmpdir()))) await rm(tempRoot, { recursive: true, force: true })
}

function waitForUrl(process, stderr) {
  return new Promise((resolveUrl, reject) => {
    const output = createInterface({ input: process.stdout })
    const timeout = setTimeout(() => reject(new Error(`Harness startup timed out.\n${stderr.join('\n')}`)), 120_000)
    const finish = (action) => {
      clearTimeout(timeout)
      process.off('error', onError)
      process.off('exit', onExit)
      output.off('line', onLine)
      action()
    }
    const onLine = (line) => {
      const match = /(?:^|\s)dsh web: (http:\/\/127\.0\.0\.1:\d+)(?:\s|$)/.exec(line)
      if (match) finish(() => resolveUrl(match[1]))
    }
    const onError = (error) => finish(() => reject(error))
    const onExit = (code, signal) => {
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? -1}`
      finish(() => reject(new Error(`Harness exited during startup (${detail}).\n${stderr.join('\n')}`)))
    }
    output.on('line', onLine)
    process.once('error', onError)
    process.once('exit', onExit)
  })
}

async function stop(childProcess) {
  if (childProcess.exitCode !== null) return
  const exited = new Promise((resolveExit) => childProcess.once('exit', resolveExit))
  childProcess.kill('SIGTERM')
  if (await Promise.race([exited.then(() => true), delay(5_000, false)])) return

  if (process.platform === 'win32' && childProcess.pid) {
    await new Promise((resolveKill) => execFile(
      'taskkill.exe',
      ['/PID', String(childProcess.pid), '/T', '/F'],
      { windowsHide: true },
      resolveKill
    ))
  } else {
    childProcess.kill('SIGKILL')
  }
  await Promise.race([exited, delay(5_000)])
}

function delay(ms, value) {
  return new Promise((resolveDelay) => setTimeout(() => resolveDelay(value), ms))
}

async function verifyRuntimePeers(appRoot) {
  const nodeModulesRoot = join(appRoot, 'node_modules')
  const missing = new Set()

  async function visitPackage(packageDir) {
    const packageJson = join(packageDir, 'package.json')
    if (!existsSync(packageJson)) return

    const manifest = JSON.parse(await readFile(packageJson, 'utf8'))
    const requireFromPackage = createRequire(packageJson)
    for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[peer]?.optional) continue
      try {
        const resolved = requireFromPackage.resolve(peer)
        const local = relative(nodeModulesRoot, resolved)
        if (local.startsWith('..') || isAbsolute(local)) missing.add(peer)
      } catch {
        missing.add(peer)
      }
    }

    const nested = join(packageDir, 'node_modules')
    if (existsSync(nested)) await visitNodeModules(nested)
  }

  async function visitNodeModules(nodeModulesDir) {
    for (const entry of await readdir(nodeModulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const entryPath = join(nodeModulesDir, entry.name)
      if (entry.name.startsWith('@')) {
        for (const scoped of await readdir(entryPath, { withFileTypes: true })) {
          if (scoped.isDirectory()) await visitPackage(join(entryPath, scoped.name))
        }
      } else {
        await visitPackage(entryPath)
      }
    }
  }

  await visitNodeModules(nodeModulesRoot)
  if (missing.size) {
    throw new Error(`Packaged runtime is missing required peer dependencies:\n${[...missing].sort().join('\n')}`)
  }
}
