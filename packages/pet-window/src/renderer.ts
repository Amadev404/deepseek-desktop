import {
  defaultPetRowOffset,
  petAtlasRows,
  petFrameAt,
  petTimeline,
  resolvePetDragDirection,
  resolvePetLookIndex,
  PET_FRAME_HEIGHT,
  PET_FRAME_WIDTH,
  type PetMode,
  type PetSignal
} from '../../companion/src/pet-runtime.js'
import type {
  DesktopPetSnapshot,
  PetStatusPlacement,
  PetWindowBridge
} from '../../../src/pet-window-contract.js'
import {
  choosePetStatusPlacement,
  PET_SPRITE_TOP
} from '../../../src/pet-window-runtime.js'

declare global {
  interface Window {
    deepseekDesktopPet: PetWindowBridge
  }
}

const DEFAULT_PET_ID = 'deepseek-whale-girl'
const COMPLETION_NOTICE_MS = 8_000
const bridge = window.deepseekDesktopPet
const pet = requiredElement<HTMLButtonElement>('pet')
const sprite = requiredElement<HTMLSpanElement>('sprite')
const status = requiredElement<HTMLSpanElement>('status')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

let snapshot: DesktopPetSnapshot | undefined
let displayedSignal: PetSignal = { mode: 'idle', key: 'initial', label: '待机中' }
let previousRawSignal: PetSignal = displayedSignal
let hovered = false
let dragging = false
let dragMoved = false
let dragDirection: 'running-left' | 'running-right' | undefined
let lastDragPoint: { x: number; y: number } | undefined
let pendingDragPoint: { x: number; y: number } | undefined
let dragFrame = 0
let animationFrame = 0
let animationStartedAt = performance.now()
let animationKey = ''
let lastFrameKey = ''
let noticeTimer = 0
let lookTimer = 0
let lookIndex: number | undefined
let lastStatusPlacement: PetStatusPlacement = 'hidden'

installStyles()

bridge.onSnapshot((value) => {
  const rawSignal = value.signal
  const rawChanged = rawSignal.key !== previousRawSignal.key || rawSignal.mode !== previousRawSignal.mode
  snapshot = value
  if (rawChanged) {
    window.clearTimeout(noticeTimer)
    if (previousRawSignal.mode === 'running' && rawSignal.mode === 'idle') {
      displayedSignal = {
        mode: 'review',
        key: `review:${previousRawSignal.sessionId ?? ''}:${Date.now()}`,
        label: '任务已完成',
        sessionId: previousRawSignal.sessionId
      }
      noticeTimer = window.setTimeout(dismissNotice, COMPLETION_NOTICE_MS)
    } else {
      displayedSignal = rawSignal
      if (rawSignal.mode === 'review') noticeTimer = window.setTimeout(dismissNotice, COMPLETION_NOTICE_MS)
    }
    previousRawSignal = rawSignal
  }
  // Session projections may emit equivalent snapshots while streaming; keep the active timeline running.
  render(false)
  if (value.enabled && value.animated && !reducedMotion.matches) startAnimation()
  else stopAnimation()
})

pet.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !snapshot?.enabled) return
  hovered = false
  dragging = true
  dragMoved = false
  dragDirection = undefined
  lastDragPoint = { x: event.screenX, y: event.screenY }
  bridge.dragStart(event.screenX, event.screenY)
  pet.setPointerCapture(event.pointerId)
  render(true)
})

pet.addEventListener('pointermove', (event) => {
  updateLook(event)
  if (!dragging || !lastDragPoint) return
  const dx = event.screenX - lastDragPoint.x
  const dy = event.screenY - lastDragPoint.y
  if (!dragMoved && Math.hypot(dx, dy) >= 4) dragMoved = true
  if (!dragMoved) return
  const direction = resolvePetDragDirection(dx, dy)
  if (direction && direction !== dragDirection) {
    dragDirection = direction
    render(true)
  }
  if (Math.max(Math.abs(dx), Math.abs(dy)) >= 2) lastDragPoint = { x: event.screenX, y: event.screenY }
  pendingDragPoint = { x: event.screenX, y: event.screenY }
  if (dragFrame === 0) {
    dragFrame = window.requestAnimationFrame(() => {
      dragFrame = 0
      if (pendingDragPoint) {
        bridge.dragMove(pendingDragPoint.x, pendingDragPoint.y)
        syncStatusPlacement()
      }
      pendingDragPoint = undefined
    })
  }
})

pet.addEventListener('pointerup', (event) => finishDrag(event, true))
pet.addEventListener('pointercancel', (event) => finishDrag(event, false))
pet.addEventListener('pointerenter', () => {
  hovered = true
  render(true)
})
pet.addEventListener('pointerleave', () => {
  if (dragging) return
  hovered = false
  render(true)
})
pet.addEventListener('click', () => {
  if (dragMoved) {
    dragMoved = false
    return
  }
  if (displayedSignal.mode === 'review') {
    bridge.activate(displayedSignal.sessionId)
    dismissNotice()
  }
})

reducedMotion.addEventListener('change', () => {
  render(true)
  if (reducedMotion.matches) stopAnimation()
  else if (snapshot?.enabled && snapshot.animated) startAnimation()
})
bridge.ready()

function finishDrag(event: PointerEvent, persist: boolean): void {
  if (!dragging) return
  if (dragFrame !== 0) {
    window.cancelAnimationFrame(dragFrame)
    dragFrame = 0
  }
  if (persist && pendingDragPoint) bridge.dragMove(pendingDragPoint.x, pendingDragPoint.y)
  pendingDragPoint = undefined
  bridge.dragEnd()
  dragging = false
  dragDirection = undefined
  lastDragPoint = undefined
  if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId)
  render(true)
}

function startAnimation(): void {
  if (animationFrame !== 0 || !snapshot?.enabled || !snapshot.animated || reducedMotion.matches) return
  const tick = (now: number): void => {
    animationFrame = 0
    if (!snapshot?.enabled || !snapshot.animated || reducedMotion.matches) return
    renderFrame(now)
    animationFrame = window.requestAnimationFrame(tick)
  }
  animationFrame = window.requestAnimationFrame(tick)
}

function stopAnimation(): void {
  if (animationFrame === 0) return
  window.cancelAnimationFrame(animationFrame)
  animationFrame = 0
}

function render(resetAnimation: boolean): void {
  if (!snapshot) return
  const nextKey = `${snapshot.pet.id}:${displayedSignal.key}:${hovered}:${dragDirection ?? ''}:${snapshot.animated}:${reducedMotion.matches}`
  if (resetAnimation || animationKey !== nextKey) {
    animationKey = nextKey
    animationStartedAt = performance.now()
    lastFrameKey = ''
  }
  pet.hidden = !snapshot.enabled
  pet.dataset.dragging = String(dragging)
  pet.dataset.mode = currentMode()
  pet.dataset.petId = snapshot.pet.id
  pet.dataset.attention = String(['failed', 'waiting', 'review'].includes(displayedSignal.mode))
  pet.dataset.statusVisible = String(dragging || hovered || pet.dataset.attention === 'true')
  pet.style.setProperty('--pet-scale', String(snapshot.scale))
  pet.setAttribute('aria-label', `${snapshot.pet.displayName}${currentLabel()}，可拖动`)
  pet.title = `${snapshot.pet.displayName} · ${currentLabel()}`
  status.textContent = currentLabel()
  renderFrame(performance.now())
}

function renderFrame(now: number): void {
  if (!snapshot) return
  syncStatusPlacement()
  const mode = currentMode()
  const animated = snapshot.animated && !reducedMotion.matches
  const timeline = petTimeline(mode, dragDirection !== undefined, snapshot.pet.id === DEFAULT_PET_ID ? 'smooth' : 'codex')
  const frame = petFrameAt(timeline, animated ? now - animationStartedAt : 0).step
  const canLook = snapshot.pet.id !== DEFAULT_PET_ID
    && snapshot.pet.spriteVersionNumber === 2
    && mode === 'idle'
    && lookIndex !== undefined
  const calmRow = snapshot.pet.id === DEFAULT_PET_ID && frame.row === 0 ? 6 : frame.row
  const row = canLook ? 9 + Math.floor(lookIndex! / 8) : calmRow
  const column = canLook ? lookIndex! % 8 : frame.column
  const frameKey = `${snapshot.pet.id}:${snapshot.scale}:${row}:${column}`
  if (frameKey === lastFrameKey) return
  lastFrameKey = frameKey
  const scale = snapshot.scale
  const rowOffset = snapshot.pet.id === DEFAULT_PET_ID && !canLook ? defaultPetRowOffset(row).x * scale : 0
  pet.dataset.frame = String(column)
  pet.dataset.row = String(row)
  pet.dataset.looking = String(canLook)
  pet.style.setProperty('--pet-offset-x', `${rowOffset}px`)
  pet.style.setProperty('--pet-width', `${PET_FRAME_WIDTH * scale}px`)
  pet.style.setProperty('--pet-height', `${PET_FRAME_HEIGHT * scale}px`)
  sprite.style.width = `${PET_FRAME_WIDTH * scale}px`
  sprite.style.height = `${PET_FRAME_HEIGHT * scale}px`
  sprite.style.backgroundImage = `url(${snapshot.pet.spritesheetDataUrl})`
  sprite.style.backgroundSize = `${1536 * scale}px ${petAtlasRows(snapshot.pet.spriteVersionNumber) * PET_FRAME_HEIGHT * scale}px`
  sprite.style.backgroundPosition = `${-(column * PET_FRAME_WIDTH * scale)}px ${-(row * PET_FRAME_HEIGHT * scale)}px`
}

function syncStatusPlacement(): void {
  const desktopScreen = window.screen as Screen & { availTop: number }
  const placement: PetStatusPlacement = !snapshot?.enabled || pet.dataset.statusVisible !== 'true'
      ? 'hidden'
      : choosePetStatusPlacement(window.screenY, {
          y: desktopScreen.availTop,
          height: desktopScreen.availHeight
        }, snapshot.scale)
  if (placement === lastStatusPlacement) return
  lastStatusPlacement = placement
  pet.dataset.statusPlacement = placement
  bridge.setStatusPlacement(placement)
}

function currentMode(): PetMode {
  if (dragDirection) return dragDirection
  if (hovered && displayedSignal.mode === 'idle') return 'jumping'
  return displayedSignal.mode
}

function currentLabel(): string {
  if (dragging) return '正在移动'
  if (hovered && displayedSignal.mode === 'idle') return '开心跳跃'
  return displayedSignal.label
}

function updateLook(event: PointerEvent): void {
  if (!snapshot || snapshot.pet.id === DEFAULT_PET_ID || snapshot.pet.spriteVersionNumber !== 2 || dragging) return
  const rect = pet.getBoundingClientRect()
  lookIndex = resolvePetLookIndex(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2))
  window.clearTimeout(lookTimer)
  lookTimer = window.setTimeout(() => {
    lookIndex = undefined
    render(true)
  }, 1_100)
}

function dismissNotice(): void {
  window.clearTimeout(noticeTimer)
  displayedSignal = { mode: 'idle', key: `idle:dismissed:${displayedSignal.key}`, label: '待机中' }
  render(true)
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing pet element: ${id}`)
  return element as T
}

function installStyles(): void {
  const style = document.createElement('style')
  style.textContent = `
    :root{color-scheme:light dark}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent!important}body{font-family:"Segoe UI",system-ui,sans-serif;user-select:none;pointer-events:none}
    #pet{--pet-scale:1.15;--pet-offset-x:0px;--pet-width:220.8px;--pet-height:239.2px;position:absolute;top:${PET_SPRITE_TOP}px;left:50%;width:var(--pet-width);height:var(--pet-height);padding:0;border:0;outline:0;background:transparent;transform:translateX(calc(-50% + var(--pet-offset-x)));cursor:grab;pointer-events:auto;touch-action:none;will-change:transform}
    #pet[hidden]{display:none}#pet[data-dragging="true"]{cursor:grabbing}#sprite{position:absolute;inset:0;display:block;background-repeat:no-repeat;image-rendering:auto;filter:drop-shadow(0 8px 12px rgb(0 0 0 / 22%));will-change:background-position}
    #status{position:absolute;left:50%;top:calc(100% + 5px);max-width:230px;overflow:hidden;padding:5px 10px;border:1px solid rgb(127 127 127 / 28%);border-radius:999px;background:rgb(250 250 250 / 91%);color:#4b5563;box-shadow:0 4px 14px rgb(0 0 0 / 13%);font:12px/1.2 "Segoe UI",system-ui,sans-serif;text-overflow:ellipsis;white-space:nowrap;opacity:0;transform:translate(-50%,4px);transition:opacity .15s ease,transform .15s ease;pointer-events:none}
    #pet[data-status-placement="above"] #status{top:auto;bottom:calc(100% + 5px);transform:translate(-50%,-4px)}
    #pet[data-status-visible="true"] #status{opacity:1;transform:translate(-50%,0)}
    @media(prefers-color-scheme:dark){#status{border-color:rgb(255 255 255 / 18%);background:rgb(32 35 40 / 91%);color:#d1d5db}}
    @media(prefers-reduced-motion:reduce){#status{transition:none}}
  `
  document.head.appendChild(style)
}
