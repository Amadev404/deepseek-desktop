import { execFile, spawn } from 'node:child_process'
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executablePath = process.env.DEEPSEEK_DESKTOP_EXECUTABLE || join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const appArguments = process.env.DEEPSEEK_DESKTOP_EXECUTABLE ? [] : [root]
const realHome = process.env.DEEPSEEK_DESKTOP_SMOKE_REAL_HOME === '1'
const tempRoot = await mkdtemp(join(tmpdir(), 'deepseek-desktop-ui-smoke-'))
const dshHome = realHome ? process.env.DSH_HOME?.trim() || join(homedir(), '.dsh') : join(tempRoot, '.dsh')
const debugPort = await freePort()
const output = []
const startedAt = Date.now()
let child
let secondChild
let rendererReadyMs = 0
let acceptedBalanceStatus = 'not-checked'

try {
  if (!realHome) {
    await mkdir(dshHome, { recursive: true })
    await writeFile(join(dshHome, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\nllm-deepseek:\n  baseURL: https://gateway.example.com\n', 'utf8')
    await writeFile(join(dshHome, '.credentials.yaml'), 'DEEPSEEK_API_KEY: desktop-smoke-placeholder\n', 'utf8')
  }
  const env = { ...process.env, DSH_HOME: dshHome }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(executablePath, [
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    ...appArguments
  ], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  child.stdout.on('data', (chunk) => output.push(chunk.toString()))
  child.stderr.on('data', (chunk) => output.push(chunk.toString()))

  const page = await waitForPage(child, debugPort)
  rendererReadyMs = Date.now() - startedAt
  const cdp = await connectCdp(page.webSocketDebuggerUrl)
  try {
    await waitForDom(cdp, '.dsd-trigger', 30_000)
    const triggerCenter = await cdp.evaluate(`(() => { const rect = document.querySelector('.dsd-trigger')?.getBoundingClientRect(); return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null })()`)
    assert(triggerCenter, 'Desktop account trigger is missing')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...triggerCenter, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...triggerCenter, button: 'left', clickCount: 1 })
    await waitForEvaluation(cdp, `(() => {
      const section = document.querySelector('[aria-labelledby="dsd-balance-title"]')
      const text = section?.textContent ?? ''
      return Boolean(section?.querySelector('.dsd-money,.dsd-error')
        || text.includes('尚未配置')
        || text.includes('不支持查询官方余额'))
    })()`, 12_000)

    const state = await cdp.evaluate(`(() => ({
      origin: location.origin,
      trigger: Boolean(document.querySelector('.dsd-trigger')),
      expanded: document.querySelector('.dsd-trigger')?.getAttribute('aria-expanded'),
      triggerCount: document.querySelectorAll('.dsd-trigger').length,
      popover: Boolean(document.querySelector('.dsd-popover')),
      balanceStatus: (() => {
        const section = document.querySelector('[aria-labelledby="dsd-balance-title"]')
        const text = section?.textContent ?? ''
        if (section?.querySelector('.dsd-money')) return 'ready'
        if (text.includes('尚未配置')) return 'unconfigured'
        if (text.includes('不支持查询官方余额')) return 'unsupported'
        if (section?.querySelector('.dsd-error')) return 'error'
        return 'unknown'
      })(),
      slider: Boolean(document.querySelector('.dsd-slider')),
      sessionTreeItems: document.querySelectorAll('[role="treeitem"]').length,
      actions: [...document.querySelectorAll('.dsd-action')].map((node) => node.textContent?.trim()),
      bridgeKeys: Object.keys(window.deepseekDesktop ?? {}),
      requireType: typeof require,
      processType: typeof process,
      webviews: document.querySelectorAll('webview').length
    }))()`)
    acceptedBalanceStatus = state.balanceStatus

    assert(state.origin.startsWith('http://127.0.0.1:'), `unexpected renderer origin ${state.origin}`)
    assert(state.trigger, `Desktop account trigger is missing: ${JSON.stringify(state)}`)
    assert(state.popover, `Desktop account popover did not open: ${JSON.stringify(state)}`)
    if (realHome) {
      assert(state.balanceStatus !== 'unknown', 'real account balance state did not settle')
      assert(state.sessionTreeItems > 0, 'existing Harness sessions are not visible')
    } else {
      assert(state.balanceStatus === 'unsupported', 'isolated balance state was not rendered')
    }
    assert(state.slider, 'reasoning effort slider is missing')
    assert(state.actions.some((text) => text?.includes('设置')), 'settings action is missing')
    assert(state.actions.some((text) => text?.includes('退出')), 'quit action is missing')
    assert(JSON.stringify(state.bridgeKeys) === JSON.stringify(['quit']), `unexpected preload bridge ${JSON.stringify(state.bridgeKeys)}`)
    assert(state.requireType === 'undefined' && state.processType === 'undefined', 'renderer exposes Node.js globals')
    assert(state.webviews === 0, 'renderer contains a WebView')

    if (process.env.DEEPSEEK_DESKTOP_SMOKE_SCREENSHOT) {
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png' })
      await writeFile(resolve(process.env.DEEPSEEK_DESKTOP_SMOKE_SCREENSHOT), Buffer.from(capture.data, 'base64'))
    }

    await cdp.evaluate(`[...document.querySelectorAll('.dsd-action')].find((node) => node.textContent?.includes('设置'))?.click()`)
    await delay(500)
    const settingsOpen = await cdp.evaluate(`Boolean([...document.querySelectorAll('[role="dialog"]')].find((node) => node.textContent?.includes('设置')))`)
    assert(settingsOpen, 'Desktop settings action did not open the Harness settings dialog')

    if (realHome) {
      secondChild = spawn(executablePath, [], { cwd: root, env, stdio: 'ignore', windowsHide: true })
      await waitForExit(secondChild, 10_000)
      assert(child.exitCode === null, 'the first instance exited when a second instance was launched')
    }

    const tree = await processTree(child.pid)
    await cdp.evaluate(`window.deepseekDesktop.quit()`)
    await waitForExit(child, 20_000)
    await delay(1_500)
    const lingering = tree.filter(isRunning)
    assert(lingering.length === 0, `Desktop process tree is still running: ${lingering.join(', ')}`)
  } finally {
    cdp.close()
  }

  const mode = realHome ? 'installed real-home' : process.env.DEEPSEEK_DESKTOP_EXECUTABLE ? 'executable' : 'source-mode'
  process.stdout.write(`Desktop ${mode} smoke test passed; renderer ready in ${(rendererReadyMs / 1_000).toFixed(1)}s; balance status ${acceptedBalanceStatus}.\n`)
} catch (error) {
  const log = output.join('').trim()
  if (log) process.stderr.write(`${log}\n`)
  throw error
} finally {
  if (child?.exitCode === null) await killTree(child.pid)
  if (secondChild?.exitCode === null) await killTree(secondChild.pid)
  await rm(tempRoot, { recursive: true, force: true })
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function waitForDom(cdp, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${selector}.`)
}

async function waitForEvaluation(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return
    await delay(100)
  }
  throw new Error('Timed out waiting for renderer state.')
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Expected a TCP port.'))
      server.close((error) => error ? reject(error) : resolvePort(address.port))
    })
  })
}

async function waitForPage(process, port) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Electron exited before its page became ready (${process.exitCode}).`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) })
      const pages = await response.json()
      const page = pages.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:'))
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await delay(250)
  }
  throw new Error('Electron DevTools page did not become ready.')
}

function connectCdp(url) {
  return new Promise((resolveConnection, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    socket.addEventListener('error', () => reject(new Error('Failed to connect to Electron DevTools.')), { once: true })
    socket.addEventListener('open', () => resolveConnection({
      send(method, params = {}) {
        return new Promise((resolveResult, rejectResult) => {
          const id = nextId++
          pending.set(id, { resolve: resolveResult, reject: rejectResult })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      async evaluate(expression) {
        const response = await this.send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true
        })
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
        return response.result.value
      },
      close() {
        socket.close()
      }
    }), { once: true })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) return
      const operation = pending.get(message.id)
      if (!operation) return
      pending.delete(message.id)
      if (message.error) operation.reject(new Error(message.error.message))
      else operation.resolve(message.result)
    })
  })
}

async function processTree(rootPid) {
  const script = `$rows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $todo=@(${rootPid}); $ids=@(); while($todo.Count){$parent=$todo[0]; if($todo.Count -eq 1){$todo=@()}else{$todo=$todo[1..($todo.Count-1)]}; $children=@($rows | Where-Object ParentProcessId -eq $parent | ForEach-Object ProcessId); $ids += $children; $todo += $children}; @(${rootPid})+$ids | ConvertTo-Json -Compress`
  const json = await exec('pwsh', ['-NoProfile', '-Command', script])
  const value = JSON.parse(json || '[]')
  return Array.isArray(value) ? value : [value]
}

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForExit(process, timeoutMs) {
  if (process.exitCode !== null) return Promise.resolve()
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => reject(new Error('Electron did not exit after the quit action.')), timeoutMs)
    process.once('exit', () => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}

async function killTree(pid) {
  if (!pid) return
  await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F']).catch(() => '')
}

function exec(file, args) {
  return new Promise((resolveExec, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolveExec(stdout.trim())
    })
  })
}
