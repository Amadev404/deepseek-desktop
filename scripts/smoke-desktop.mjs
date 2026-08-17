import { execFile, spawn } from 'node:child_process'
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executablePath = process.env.DEEPSEEK_DESKTOP_EXECUTABLE || join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const appArguments = process.env.DEEPSEEK_DESKTOP_EXECUTABLE ? [] : [root]
const realHome = process.env.DEEPSEEK_DESKTOP_SMOKE_REAL_HOME === '1'
const tempRoot = await mkdtemp(join(tmpdir(), 'deepseek-desktop-ui-smoke-'))
const dshHome = realHome ? process.env.DSH_HOME?.trim() || join(homedir(), '.dsh') : join(tempRoot, '.dsh')
const electronUserData = join(tempRoot, 'electron-data')
const petManifestPath = join(tempRoot, 'smoke-custom-pet.json')
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
    await writeFile(petManifestPath, JSON.stringify({
      id: 'smoke-custom-pet',
      displayName: 'Smoke Custom Pet',
      description: 'Smoke test custom pet',
      spriteVersionNumber: 2,
      spritesheetPath: 'spritesheet.webp'
    }), 'utf8')
  }
  const env = { ...process.env, DSH_HOME: dshHome }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(executablePath, [
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${electronUserData}`,
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
    await waitForEvaluation(cdp, `(() => {
      const portrait = document.querySelector('.dsd-character')
      const avatar = document.querySelector('.dsd-avatarImage')
      const pet = document.querySelector('.dsd-pet')
      const sprite = document.querySelector('.dsd-petSprite')
      return !document.body.dataset.dsdTheme
        && portrait instanceof HTMLImageElement && portrait.complete && portrait.naturalWidth > 0
        && avatar instanceof HTMLImageElement && avatar.complete && avatar.naturalWidth > 0
        && pet && sprite && getComputedStyle(sprite).backgroundImage.includes('data:image/webp')
    })()`, 10_000)

    const visual = await cdp.evaluate(`(() => {
      const portrait = document.querySelector('.dsd-character')
      const style = portrait ? getComputedStyle(portrait) : null
      const rect = portrait?.getBoundingClientRect()
      return {
        phase: document.querySelector('[data-phase]')?.getAttribute('data-phase'),
        portraitDisplay: style?.display,
        portraitVisibility: style?.visibility,
        portraitPointerEvents: style?.pointerEvents,
        portraitRight: rect?.right,
        viewportWidth: innerWidth,
        petDisplay: getComputedStyle(document.querySelector('.dsd-pet')).display,
        petPointerEvents: getComputedStyle(document.querySelector('.dsd-pet')).pointerEvents
      }
    })()`)
    assert(visual.portraitPointerEvents === 'none', 'portrait accepts pointer input')
    assert(visual.petDisplay === 'block' && visual.petPointerEvents === 'auto', `DeepSeek pet is not interactive: ${JSON.stringify(visual)}`)
    if (!realHome) {
      assert(visual.phase === 'hero', `isolated Harness did not open on the hero view: ${JSON.stringify(visual)}`)
      assert(visual.portraitDisplay === 'block' && visual.portraitVisibility === 'visible', `portrait is not visible on the wide hero view: ${JSON.stringify(visual)}`)
      assert(visual.portraitRight <= visual.viewportWidth, 'portrait extends beyond the right viewport edge')
      await captureVariants(cdp, process.env.DEEPSEEK_DESKTOP_SMOKE_SCREENSHOT)
    }

    const initialPetRect = await cdp.evaluate(`(() => { const rect = document.querySelector('.dsd-pet')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null })()`)
    assert(initialPetRect, 'DeepSeek pet does not have a layout box')
    const petCenter = { x: initialPetRect.x + initialPetRect.width / 2, y: initialPetRect.y + initialPetRect.height / 2 }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...petCenter })
    await waitForEvaluation(cdp, `document.querySelector('.dsd-pet')?.getAttribute('data-mode') === 'jumping'`, 5_000)
    assert(await cdp.evaluate(`document.querySelector('.dsd-pet')?.getAttribute('data-looking') === 'false'`), 'built-in DeepSeek pet unexpectedly tracks the global pointer')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
    await waitForEvaluation(cdp, `document.querySelector('.dsd-pet')?.getAttribute('data-mode') === 'idle'`, 5_000)
    assert(await cdp.evaluate(`document.querySelector('.dsd-pet')?.getAttribute('data-row') === '6'`), 'built-in DeepSeek pet did not use the calm idle row')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...petCenter, button: 'left', buttons: 1, clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...petCenter, button: 'left', buttons: 0, clickCount: 1 })
    assert(await cdp.evaluate(`document.querySelector('.dsd-pet')?.getAttribute('data-mode') === 'idle'`), 'click leaked a transient pet action')

    const dragTarget = { x: petCenter.x - 90, y: petCenter.y - 24 }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...petCenter, button: 'left', buttons: 1, clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...dragTarget, button: 'left', buttons: 1 })
    await waitForEvaluation(cdp, `document.querySelector('.dsd-pet')?.getAttribute('data-mode') === 'running-left' && document.querySelector('.dsd-pet')?.getAttribute('data-dragging') === 'true'`, 5_000)
    const draggingSprite = await cdp.evaluate(`(() => {
      const sprite = document.querySelector('.dsd-petSprite')
      const style = sprite ? getComputedStyle(sprite) : null
      return { transform: style?.transform, willChange: style?.willChange }
    })()`)
    assert(draggingSprite.transform && draggingSprite.transform !== 'none' && draggingSprite.willChange?.includes('transform'), `built-in pet frame registration is inactive: ${JSON.stringify(draggingSprite)}`)
    if (!realHome && process.env.DEEPSEEK_DESKTOP_SMOKE_SCREENSHOT) {
      await captureScreenshot(cdp, variantPath(process.env.DEEPSEEK_DESKTOP_SMOKE_SCREENSHOT, 'pet-dragging'))
    }
    const draggedPetRect = await cdp.evaluate(`(() => { const rect = document.querySelector('.dsd-pet')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight } : null })()`)
    assert(draggedPetRect && draggedPetRect.x >= 0 && draggedPetRect.y >= 0 && draggedPetRect.right <= draggedPetRect.width && draggedPetRect.bottom <= draggedPetRect.height, `dragged pet left the viewport: ${JSON.stringify(draggedPetRect)}`)
    assert(Math.abs(draggedPetRect.x - initialPetRect.x) > 40, 'dragging did not move the DeepSeek pet')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...dragTarget, button: 'left', buttons: 0, clickCount: 1 })
    await waitForEvaluation(cdp, `document.querySelector('.dsd-pet')?.getAttribute('data-dragging') === 'false' && document.cookie.includes('deepseek_desktop_pet_settings')`, 5_000)
    assert(await cdp.evaluate(`!['running-left', 'running-right'].includes(document.querySelector('.dsd-pet')?.getAttribute('data-mode'))`), 'directional running leaked past drag release')
    await cdp.send('Page.reload')
    await waitForDom(cdp, '.dsd-pet', 30_000)
    const persistedPetRect = await cdp.evaluate(`(() => { const rect = document.querySelector('.dsd-pet')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y } : null })()`)
    assert(persistedPetRect && Math.abs(persistedPetRect.x - draggedPetRect.x) < 3 && Math.abs(persistedPetRect.y - draggedPetRect.y) < 3, `dragged pet position did not persist: ${JSON.stringify({ draggedPetRect, persistedPetRect })}`)

    const triggerCenter = await cdp.evaluate(`(() => { const rect = document.querySelector('.dsd-trigger')?.getBoundingClientRect(); return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null })()`)
    assert(triggerCenter, 'Desktop account trigger is missing')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...triggerCenter, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...triggerCenter, button: 'left', clickCount: 1 })
    await waitForDom(cdp, '.dsd-petSummary', 5_000)
    assert(await cdp.evaluate(`!document.querySelector('.dsd-popover .dsd-petManage')`), 'account popover exposes advanced pet controls')
    await cdp.evaluate(`document.querySelector('.dsd-petToggle input')?.click()`)
    await waitForEvaluation(cdp, `!document.querySelector('.dsd-pet')`, 5_000)
    await cdp.evaluate(`document.querySelector('.dsd-petToggle input')?.click()`)
    await waitForDom(cdp, '.dsd-pet', 5_000)
    await cdp.evaluate(`document.querySelector('.dsd-petSummary')?.click()`)
    await waitForDom(cdp, '.dsd-petDialog', 5_000)
    assert(await cdp.evaluate(`Boolean(document.querySelector('.dsd-petDialog input[type="range"]') && document.querySelector('.dsd-petChoice[data-pet-id="deepseek-whale-girl"]'))`), 'pet management dialog is incomplete')
    if (!realHome && process.env.DEEPSEEK_DESKTOP_SMOKE_SCREENSHOT) {
      await captureScreenshot(cdp, variantPath(process.env.DEEPSEEK_DESKTOP_SMOKE_SCREENSHOT, 'pet-dialog'))
    }
    await waitForEvaluation(cdp, `(() => {
      const section = document.querySelector('[aria-labelledby="dsd-balance-title"]')
      const text = section?.textContent ?? ''
      return Boolean(section?.querySelector('.dsd-money,.dsd-error')
        || text.includes('尚未配置')
        || text.includes('不支持查询官方余额'))
    })()`, 12_000)

    if (!realHome) {
      await setFileInputFiles(cdp, 'input[type="file"][accept*="json"]', petManifestPath)
      await setFileInputFiles(cdp, 'input[type="file"][accept*="webp"]', resolve(root, 'packages', 'companion', 'assets', 'deepseek-pet.webp'))
      await waitForEvaluation(cdp, `document.querySelector('.dsd-petStatusText')?.textContent?.includes('已添加')`, 15_000)
      await cdp.send('Page.reload')
      await waitForDom(cdp, '.dsd-trigger', 30_000)
      await cdp.evaluate(`document.querySelector('.dsd-trigger')?.click()`)
      await cdp.evaluate(`document.querySelector('.dsd-petSummary')?.click()`)
      await waitForDom(cdp, '.dsd-petChoice[data-pet-id="smoke-custom-pet"]', 10_000)
      await cdp.evaluate(`document.querySelector('.dsd-petChoice[data-pet-id="smoke-custom-pet"]')?.click()`)
      await waitForEvaluation(cdp, `document.querySelector('.dsd-pet')?.getAttribute('data-pet-id') === 'smoke-custom-pet'`, 5_000)
      await cdp.send('Page.reload')
      await waitForDom(cdp, '.dsd-trigger', 30_000)
      await cdp.evaluate(`document.querySelector('.dsd-trigger')?.click()`)
      await cdp.evaluate(`document.querySelector('.dsd-petSummary')?.click()`)
      await waitForEvaluation(cdp, `document.querySelector('.dsd-petChoice[data-pet-id="smoke-custom-pet"]')?.getAttribute('aria-pressed') === 'true'`, 10_000)
      await cdp.evaluate(`window.deepseekDesktop.petStore.remove('smoke-custom-pet')`)
    }
    await cdp.evaluate(`document.querySelector('.dsd-petDialogClose')?.click()`)
    await waitForEvaluation(cdp, `!document.querySelector('.dsd-petDialog')`, 5_000)

    const state = await cdp.evaluate(`(async () => ({
      origin: location.origin,
      trigger: Boolean(document.querySelector('.dsd-trigger')),
      expanded: document.querySelector('.dsd-trigger')?.getAttribute('aria-expanded'),
      triggerCount: document.querySelectorAll('.dsd-trigger').length,
      popover: Boolean(document.querySelector('.dsd-popover')),
      avatarReady: [...document.querySelectorAll('.dsd-avatarImage')].every((node) => node.complete && node.naturalWidth > 0),
      pet: Boolean(document.querySelector('.dsd-pet')),
      petSpriteData: getComputedStyle(document.querySelector('.dsd-petSprite')).backgroundImage.includes('data:image/webp'),
      petDraggable: getComputedStyle(document.querySelector('.dsd-pet')).touchAction === 'none',
      petMode: document.querySelector('.dsd-pet')?.getAttribute('data-mode'),
      petSummary: Boolean(document.querySelector('.dsd-petSummary')),
      petStoreCount: window.deepseekDesktop?.petStore ? (await window.deepseekDesktop.petStore.list()).length : -1,
      codexPetNodes: document.querySelectorAll('.codex-pet,[data-codex-pet]').length,
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
    assert(state.avatarReady, 'whale-girl avatar did not decode')
    assert(state.pet && state.petSpriteData, 'DeepSeek pet sprite did not decode')
    assert(state.petDraggable && state.petMode, 'DeepSeek pet drag runtime is unavailable')
    assert(state.petSummary, 'compact DeepSeek pet setting is missing')
    assert(state.petStoreCount >= 0, 'DeepSeek pet store bridge did not respond')
    assert(state.codexPetNodes === 0, 'DeepSeek renderer claimed a Codex pet node')
    if (realHome) {
      assert(state.balanceStatus !== 'unknown', 'real account balance state did not settle')
      assert(state.sessionTreeItems > 0, 'existing Harness sessions are not visible')
    } else {
      assert(state.balanceStatus === 'unsupported', 'isolated balance state was not rendered')
    }
    assert(state.slider, 'reasoning effort slider is missing')
    assert(state.actions.some((text) => text?.includes('设置')), 'settings action is missing')
    assert(state.actions.some((text) => text?.includes('退出')), 'quit action is missing')
    assert(JSON.stringify(state.bridgeKeys) === JSON.stringify(['quit', 'petStore']), `unexpected preload bridge ${JSON.stringify(state.bridgeKeys)}`)
    assert(state.requireType === 'undefined' && state.processType === 'undefined', 'renderer exposes Node.js globals')
    assert(state.webviews === 0, 'renderer contains a WebView')
    if (!realHome && process.env.DEEPSEEK_DESKTOP_SMOKE_SCREENSHOT) {
      await captureScreenshot(cdp, variantPath(process.env.DEEPSEEK_DESKTOP_SMOKE_SCREENSHOT, 'menu'))
    }

    await cdp.evaluate(`[...document.querySelectorAll('.dsd-action')].find((node) => node.textContent?.includes('设置'))?.click()`)
    await delay(500)
    const settingsOpen = await cdp.evaluate(`Boolean([...document.querySelectorAll('[role="dialog"]')].find((node) => node.textContent?.includes('设置')))`)
    assert(settingsOpen, 'Desktop settings action did not open the Harness settings dialog')

    if (realHome) {
      secondChild = spawn(executablePath, [`--user-data-dir=${electronUserData}`], { cwd: root, env, stdio: 'ignore', windowsHide: true })
      await waitForExit(secondChild, 10_000)
      assert(child.exitCode === null, 'the first instance exited when a second instance was launched')
    }

    const tree = await processTree(child.pid)
    await cdp.evaluate(`window.deepseekDesktop.quit()`)
    await waitForExit(child, 20_000)
    const lingering = await waitForTreeExit(tree, 8_000)
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
  await removeTempRoot(tempRoot)
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
    try {
      if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return
    } catch {}
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${selector}.`)
}

async function waitForEvaluation(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(expression)) return
    } catch {}
    await delay(100)
  }
  throw new Error('Timed out waiting for renderer state.')
}

async function captureVariants(cdp, screenshotPath) {
  const originalDark = await cdp.evaluate(`document.body.hasAttribute('data-ds-dark-theme')`)
  await cdp.evaluate(`document.body.removeAttribute('data-ds-dark-theme')`)
  await delay(250)
  const lightBackground = await cdp.evaluate(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim()`)
  if (screenshotPath) await captureScreenshot(cdp, resolve(screenshotPath))

  await cdp.evaluate(`document.body.setAttribute('data-ds-dark-theme', '')`)
  await delay(250)
  const darkBackground = await cdp.evaluate(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim()`)
  assert(lightBackground !== darkBackground, 'Harness light and dark palettes are identical')
  if (screenshotPath) await captureScreenshot(cdp, variantPath(screenshotPath, 'dark'))
  if (!originalDark) await cdp.evaluate(`document.body.removeAttribute('data-ds-dark-theme')`)

  const phase = await cdp.evaluate(`document.querySelector('[data-phase]')?.getAttribute('data-phase')`)
  await cdp.evaluate(`document.querySelector('[data-phase]')?.setAttribute('data-phase', 'active')`)
  await waitForEvaluation(cdp, `(() => { const style = getComputedStyle(document.querySelector('.dsd-character')); return style.visibility === 'visible' && Number(style.opacity) > 0 })()`, 5_000)
  if (screenshotPath) await captureScreenshot(cdp, variantPath(screenshotPath, 'active'))
  await cdp.evaluate(`document.querySelector('[data-phase]')?.setAttribute('data-phase', 'hero')`)
  assert(phase === 'hero', `expected the isolated session phase to be hero, received ${phase}`)

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 1, mobile: false })
  await waitForEvaluation(cdp, `innerWidth === 1024`, 5_000)
  const narrow = await cdp.evaluate(`(() => ({
    width: innerWidth,
    portraitDisplay: getComputedStyle(document.querySelector('.dsd-character')).display,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth
  }))()`)
  assert(narrow.portraitDisplay === 'none', `portrait is visible in the narrow viewport: ${JSON.stringify(narrow)}`)
  assert(!narrow.horizontalOverflow, `narrow viewport has horizontal overflow: ${JSON.stringify(narrow)}`)
  if (screenshotPath) await captureScreenshot(cdp, variantPath(screenshotPath, 'narrow'))
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  await waitForEvaluation(cdp, `innerWidth > 1179`, 5_000)
}

async function captureScreenshot(cdp, path) {
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path, Buffer.from(capture.data, 'base64'))
}

async function setFileInputFiles(cdp, selector, path) {
  const document = await cdp.send('DOM.getDocument', { depth: 0 })
  const node = await cdp.send('DOM.querySelector', { nodeId: document.root.nodeId, selector })
  assert(node.nodeId, `file input is missing: ${selector}`)
  await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path] })
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new Event('change', { bubbles: true }))`)
}

function variantPath(path, variant) {
  const absolute = resolve(path)
  const extension = extname(absolute) || '.png'
  return `${absolute.slice(0, -extension.length)}-${variant}${extension}`
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
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
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

async function waitForTreeExit(tree, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lingering = tree.filter(isRunning)
  while (lingering.length && Date.now() < deadline) {
    await delay(250)
    lingering = tree.filter(isRunning)
  }
  return lingering
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

async function removeTempRoot(path) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error
      await delay(250)
    }
  }
  await rm(path, { recursive: true, force: true })
}

function exec(file, args) {
  return new Promise((resolveExec, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolveExec(stdout.trim())
    })
  })
}
