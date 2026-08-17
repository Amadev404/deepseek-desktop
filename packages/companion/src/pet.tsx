import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import defaultSpritesheet from '../assets/deepseek-pet.webp'
import {
  clampPetPosition,
  petFrameAt,
  petAtlasRows,
  petTimeline,
  resolvePetDragDirection,
  resolvePetLookIndex,
  selectPetSessionSignal,
  PET_FRAME_HEIGHT,
  PET_FRAME_WIDTH,
  type PetFrameStep,
  type PetMode,
  type PetPoint,
  type PetSessionSnapshot,
  type PetSignal,
  type PetSpriteVersion
} from './pet-runtime.js'

const PET_SETTINGS_COOKIE = 'deepseek_desktop_pet_settings'
const PET_COOKIE_MAX_AGE = 31_536_000
const DEFAULT_PET_ID = 'deepseek-whale-girl'
const MAX_SPRITESHEET_BYTES = 12 * 1024 * 1024
const COMPLETION_NOTICE_MS = 8_000

export type PetUseSessions = <T>(selector: (state: PetSessionSnapshot) => T) => T

interface PetManifest {
  id: string
  displayName: string
  description?: string
  spriteVersionNumber: PetSpriteVersion
  spritesheetPath?: string
}

export interface PetRecord {
  id: string
  displayName: string
  description: string
  spriteVersionNumber: PetSpriteVersion
  spritesheetDataUrl: string
}

interface PetStoreApi {
  list(): Promise<PetRecord[]>
  save(record: PetRecord): Promise<void>
  remove(id: string): Promise<void>
}

interface PetSettingsState {
  animated: boolean
  enabled: boolean
  petId: string
  scale: number
  anchor: 'left' | 'right'
  x?: number
  y?: number
}

interface PetDraft {
  manifest?: PetManifest
  spritesheet?: {
    dataUrl: string
    version: PetSpriteVersion
  }
}

interface PetDrag {
  direction?: 'running-left' | 'running-right'
}

const DEFAULT_PET: PetRecord = {
  id: DEFAULT_PET_ID,
  displayName: '鲸鱼娘',
  description: 'DeepSeek 默认桌宠',
  spriteVersionNumber: 2,
  spritesheetDataUrl: defaultSpritesheet
}

const PET_CSS = `
 .dsd-pet{--dsd-pet-scale:1.15;position:fixed;z-index:110;bottom:94px;width:calc(192px * var(--dsd-pet-scale));height:calc(208px * var(--dsd-pet-scale));padding:0;border:0;background:transparent;cursor:grab;filter:drop-shadow(0 10px 16px rgb(0 0 0 / 28%));outline:none;touch-action:none;user-select:none;will-change:left,top;contain:layout paint}
.dsd-pet[data-anchor='left']{left:18px}.dsd-pet[data-anchor='right']{right:clamp(18px,34vw,460px)}.dsd-pet[data-dragging='true']{cursor:grabbing;z-index:111}
 .dsd-petSprite{position:absolute;inset:0 auto auto 0;display:block;width:var(--dsd-pet-frame-width);height:var(--dsd-pet-frame-height);background-repeat:no-repeat;background-size:var(--dsd-pet-atlas-width) var(--dsd-pet-atlas-height);background-position:var(--dsd-pet-x) var(--dsd-pet-y);image-rendering:auto;will-change:background-position}
.dsd-petStatus{position:absolute;right:4px;bottom:-27px;max-width:210px;overflow:hidden;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-bg-base) 91%,transparent);box-shadow:var(--dsw-shadow-lv1);font:12px/1.2 system-ui,sans-serif;text-overflow:ellipsis;white-space:nowrap;opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease;pointer-events:none}
.dsd-pet:hover .dsd-petStatus,.dsd-pet:focus-visible .dsd-petStatus,.dsd-pet[data-attention='true'] .dsd-petStatus{opacity:1;transform:none}.dsd-pet:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:4px}
.dsd-petSectionTitle{justify-content:space-between}.dsd-petToggle{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:400;cursor:pointer}.dsd-petToggle input{margin:0;accent-color:var(--dsw-alias-state-business-primary)}
.dsd-petSummary{box-sizing:border-box;width:100%;height:50px;padding:4px 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;gap:9px;text-align:left;font:inherit;outline:none}.dsd-petSummary:hover,.dsd-petSummary:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dsd-petThumb{width:38px;height:42px;flex:none;background-repeat:no-repeat;background-position:0 0;background-size:304px var(--dsd-pet-thumb-height);image-rendering:auto}.dsd-petSummaryCopy{display:flex;min-width:0;flex:1;flex-direction:column}.dsd-petSummaryName{font-size:13px;font-weight:500;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsd-petSummaryMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsd-petSummaryArrow{color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:1}
.dsd-petDialogLayer{position:fixed;inset:0;z-index:180;display:grid;place-items:center;padding:20px;background:rgb(0 0 0 / 28%)}.dsd-petDialog{box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 32px));overflow:auto;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3)}
.dsd-petDialogHeader{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:12px;padding:14px 14px 10px;background:var(--dsw-specific-menu)}.dsd-petDialogTitle{min-width:0;flex:1;font-size:15px;font-weight:600}.dsd-petDialogClose{width:30px;height:30px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:22px/1 system-ui}.dsd-petDialogClose:hover,.dsd-petDialogClose:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsd-petList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:4px 14px 12px}.dsd-petChoice{position:relative;min-width:0;height:72px;padding:5px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;gap:8px;text-align:left;font:inherit;outline:none}.dsd-petChoice:hover,.dsd-petChoice:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}.dsd-petChoice[aria-pressed='true']{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}.dsd-petChoiceCopy{display:flex;min-width:0;flex:1;flex-direction:column}.dsd-petChoiceName{font-size:12px;font-weight:600;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsd-petChoiceMeta{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}
.dsd-petManage{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 14px 14px}.dsd-petManageRow{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:34px;color:var(--dsw-alias-label-secondary);font-size:12px}.dsd-petManageRow input[type='range']{width:190px;max-width:55%;accent-color:var(--dsw-alias-state-business-primary)}.dsd-petManageActions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.dsd-petManageButton{height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px}.dsd-petManageButton:hover,.dsd-petManageButton:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsd-petManageButtonDanger{color:var(--dsw-alias-state-error-primary)}.dsd-petStatusText{margin-top:8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsd-petFileInput{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
@media(max-width:1179px){.dsd-pet[data-anchor='right']{right:18px;bottom:18px}}
@media(max-width:560px){.dsd-petList{grid-template-columns:1fr}.dsd-petDialogLayer{padding:8px}}
@media(prefers-reduced-motion:reduce){.dsd-petStatus{transition:none}}
`

installPetStyles()

export function usePetController() {
  const [settings, setSettings] = useState<PetSettingsState>(() => readPetSettings())
  const [customPets, setCustomPets] = useState<PetRecord[]>([])
  const [draft, setDraft] = useState<PetDraft>({})
  const [status, setStatus] = useState('')

  useEffect(() => {
    let active = true
    const store = getPetStore()
    if (!store) return
    void store.list().then((records) => {
      if (active) setCustomPets(records.filter(isPetRecord))
    }).catch(() => {
      if (active) setStatus('自定义宠物读取失败')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!draft.manifest || !draft.spritesheet) return
    if (draft.manifest.spriteVersionNumber !== draft.spritesheet.version) {
      setStatus('pet.json 与精灵图版本不匹配')
      setDraft({ manifest: draft.manifest })
      return
    }
    let active = true
    const record: PetRecord = {
      id: draft.manifest.id,
      displayName: draft.manifest.displayName,
      description: draft.manifest.description ?? '自定义 DeepSeek 宠物',
      spriteVersionNumber: draft.manifest.spriteVersionNumber,
      spritesheetDataUrl: draft.spritesheet.dataUrl
    }
    const store = getPetStore()
    if (!store) {
      setStatus('当前环境不支持保存自定义宠物')
      setDraft({})
      return
    }
    setStatus('正在保存自定义宠物…')
    void store.save(record).then(() => {
      if (!active) return
      setCustomPets((pets) => [...pets.filter((pet) => pet.id !== record.id), record])
      updateSettings(setSettings, { petId: record.id })
      setStatus(`已添加 ${record.displayName}`)
      setDraft({})
    }).catch(() => {
      if (!active) return
      setStatus('自定义宠物保存失败')
      setDraft({})
    })
    return () => { active = false }
  }, [draft])

  const pets = useMemo(() => [DEFAULT_PET, ...customPets], [customPets])
  const selectedPet = pets.find((pet) => pet.id === settings.petId) ?? DEFAULT_PET
  const setPetId = useCallback((petId: string) => updateSettings(setSettings, { petId }), [])
  const setEnabled = useCallback((enabled: boolean) => updateSettings(setSettings, { enabled }), [])
  const setAnimated = useCallback((animated: boolean) => updateSettings(setSettings, { animated }), [])
  const setScale = useCallback((scale: number) => updateSettings(setSettings, { scale: clamp(scale, .7, 1.5) }), [])
  const setPosition = useCallback((point?: PetPoint) => updateSettings(setSettings, point === undefined
    ? { anchor: 'right', x: undefined, y: undefined }
    : { x: Math.round(point.x), y: Math.round(point.y) }), [])
  const deletePet = useCallback(async (petId: string) => {
    if (petId === DEFAULT_PET_ID) return
    try {
      await getPetStore()?.remove(petId)
      setCustomPets((pets) => pets.filter((pet) => pet.id !== petId))
      if (settings.petId === petId) updateSettings(setSettings, { petId: DEFAULT_PET_ID })
      setStatus('自定义宠物已删除')
    } catch {
      setStatus('自定义宠物删除失败')
    }
  }, [settings.petId])

  const readManifest = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      const manifest = parseManifest(await file.text())
      setDraft((value) => ({ ...value, manifest }))
      setStatus('配置已读取，请选择精灵图')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'pet.json 无法读取')
    }
  }, [])

  const readSpritesheet = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      if (file.size > MAX_SPRITESHEET_BYTES) throw new Error('精灵图不能超过 12 MB')
      const dataUrl = await readFileAsDataUrl(file)
      const version = await validateSpritesheet(dataUrl)
      setDraft((value) => ({ ...value, spritesheet: { dataUrl, version } }))
      setStatus('精灵图已读取，正在保存…')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '精灵图无法读取')
    }
  }, [])

  return {
    deletePet,
    pets,
    readManifest,
    readSpritesheet,
    selectedPet,
    setAnimated,
    setEnabled,
    setPetId,
    setPosition,
    setScale,
    settings,
    status
  }
}

export type PetController = ReturnType<typeof usePetController>

export function PetOverlay({
  controller,
  hasCurrentError,
  openSession,
  useSessions
}: {
  controller: PetController
  hasCurrentError: boolean
  openSession(id: string): void
  useSessions: PetUseSessions
}): ReactNode {
  const signal = useSessions((state) => selectPetSessionSignal(state, hasCurrentError))
  const [completion, setCompletion] = useState<PetSignal>()
  const [hovered, setHovered] = useState(false)
  const [drag, setDrag] = useState<PetDrag>()
  const [lookIndex, setLookIndex] = useState<number>()
  const [dismissedReviewKey, setDismissedReviewKey] = useState<string>()
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const buttonRef = useRef<HTMLButtonElement>(null)
  const previousSignal = useRef(signal)
  const completionTimer = useRef<number>()
  const reviewTimer = useRef<number>()
  const dragFrame = useRef<number>()
  const dragRef = useRef<{
    offsetX: number
    offsetY: number
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
    direction?: 'running-left' | 'running-right'
    origin: PetPoint
    point?: PetPoint
  }>()
  const suppressClick = useRef(false)

  useEffect(() => {
    const previous = previousSignal.current
    previousSignal.current = signal
    if (previous.mode === 'running' && signal.mode === 'idle') {
      const review = {
        mode: 'review',
        key: `review:${previous.sessionId ?? ''}:${Date.now()}`,
        label: '任务已完成',
        sessionId: previous.sessionId
      } satisfies PetSignal
      setCompletion(review)
      if (completionTimer.current !== undefined) window.clearTimeout(completionTimer.current)
      completionTimer.current = window.setTimeout(() => {
        completionTimer.current = undefined
        setCompletion(undefined)
      }, COMPLETION_NOTICE_MS)
    } else if (signal.mode !== 'idle') {
      if (completionTimer.current !== undefined) window.clearTimeout(completionTimer.current)
      completionTimer.current = undefined
      if (signal.mode !== 'review' && reviewTimer.current !== undefined) window.clearTimeout(reviewTimer.current)
      if (signal.mode !== 'review') {
        reviewTimer.current = undefined
        setDismissedReviewKey(undefined)
      }
      setCompletion(undefined)
      setHovered(false)
    }
  }, [signal.key, signal.mode, signal.sessionId])

  useEffect(() => {
    if (signal.mode !== 'review' || dismissedReviewKey === signal.key) return
    if (reviewTimer.current !== undefined) window.clearTimeout(reviewTimer.current)
    reviewTimer.current = window.setTimeout(() => {
      reviewTimer.current = undefined
      setDismissedReviewKey(signal.key)
    }, COMPLETION_NOTICE_MS)
  }, [dismissedReviewKey, signal.key, signal.mode])

  useEffect(() => () => {
    if (completionTimer.current !== undefined) window.clearTimeout(completionTimer.current)
    if (reviewTimer.current !== undefined) window.clearTimeout(reviewTimer.current)
    if (dragFrame.current !== undefined) window.cancelAnimationFrame(dragFrame.current)
  }, [])

  useEffect(() => {
    const onResize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const effectiveSignal = signal.mode === 'review' && dismissedReviewKey === signal.key
    ? { mode: 'idle', key: `idle:dismissed:${signal.key}`, label: '待机中' } satisfies PetSignal
    : signal
  const baseSignal = effectiveSignal.mode === 'idle' && completion !== undefined ? completion : effectiveSignal
  const pointerLookEnabled = controller.selectedPet.id !== DEFAULT_PET_ID
    && controller.selectedPet.spriteVersionNumber === 2

  useEffect(() => {
    if (!pointerLookEnabled || !controller.settings.animated || baseSignal.mode !== 'idle' || hovered || drag !== undefined) {
      setLookIndex(undefined)
      return undefined
    }
    let idleTimer: number | undefined
    const onPointerMove = (event: PointerEvent): void => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      setLookIndex(resolvePetLookIndex(
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height / 2)
      ))
      if (idleTimer !== undefined) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => setLookIndex(undefined), 1_100)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      if (idleTimer !== undefined) window.clearTimeout(idleTimer)
    }
  }, [baseSignal.mode, controller.settings.animated, drag, hovered, pointerLookEnabled])

  const scale = controller.settings.scale
  const petSize = { width: PET_FRAME_WIDTH * scale, height: PET_FRAME_HEIGHT * scale }
  const savedPosition = controller.settings.x === undefined || controller.settings.y === undefined
    ? undefined
    : clampPetPosition({ x: controller.settings.x, y: controller.settings.y }, petSize, viewport)
  const hoverMode: PetMode = hovered && baseSignal.mode === 'idle' ? 'jumping' : baseSignal.mode
  const mode: PetMode = drag?.direction ?? hoverMode
  const frame = usePetFrame(mode, drag?.direction !== undefined, `${controller.selectedPet.id}:${baseSignal.key}:${hovered}:${drag?.direction ?? ''}`, controller.settings.animated)
  const looking = lookIndex !== undefined && mode === 'idle' && pointerLookEnabled
  const calmFrameRow = controller.selectedPet.id === DEFAULT_PET_ID && frame.row === 0 ? 6 : frame.row
  const row = looking ? 9 + Math.floor(lookIndex / 8) : calmFrameRow
  const column = looking ? lookIndex % 8 : frame.column
  const attention = baseSignal.mode === 'failed' || baseSignal.mode === 'review' || baseSignal.mode === 'waiting'
  const label = drag !== undefined
    ? '正在移动'
    : hovered && baseSignal.mode === 'idle'
      ? '开心跳跃'
      : baseSignal.label
  const style = {
    '--dsd-pet-scale': String(scale),
    ...(savedPosition === undefined
      ? {}
      : { left: `${savedPosition.x}px`, top: `${savedPosition.y}px`, right: 'auto', bottom: 'auto' })
  } as unknown as CSSProperties
  const spriteStyle = {
    backgroundImage: `url(${controller.selectedPet.spritesheetDataUrl})`,
    '--dsd-pet-frame-width': `${PET_FRAME_WIDTH * scale}px`,
    '--dsd-pet-frame-height': `${PET_FRAME_HEIGHT * scale}px`,
    '--dsd-pet-atlas-width': `${1536 * scale}px`,
    '--dsd-pet-atlas-height': `${petAtlasRows(controller.selectedPet.spriteVersionNumber) * PET_FRAME_HEIGHT * scale}px`,
    '--dsd-pet-x': `${-(column * PET_FRAME_WIDTH * scale)}px`,
    '--dsd-pet-y': `${-(row * PET_FRAME_HEIGHT * scale)}px`
  } as CSSProperties

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    setHovered(false)
    const rect = event.currentTarget.getBoundingClientRect()
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      origin: { x: rect.left, y: rect.top }
    }
    setDrag({})
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const state = dragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const moved = state.moved || Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >= 4
    state.moved = moved
    if (!moved) return
    const deltaX = event.clientX - state.lastX
    const deltaY = event.clientY - state.lastY
    const direction = resolvePetDragDirection(deltaX, deltaY)
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 4) {
      state.lastX = event.clientX
      state.lastY = event.clientY
      if (direction !== undefined) state.direction = direction
    }
    const point = clampPetPosition({ x: event.clientX - state.offsetX, y: event.clientY - state.offsetY }, petSize, viewport)
    state.point = point
    if (dragFrame.current === undefined) {
      dragFrame.current = window.requestAnimationFrame(() => {
        dragFrame.current = undefined
        const next = dragRef.current
        if (!next?.moved || next.point === undefined) return
        applyPetPosition(buttonRef.current, next.point)
        setDrag((current) => current?.direction === next.direction ? current : { direction: next.direction })
      })
    }
  }

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>, persist: boolean): void => {
    const state = dragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    suppressClick.current = state.moved
    const moved = state.moved
    const point = state.point
    dragRef.current = undefined
    if (dragFrame.current !== undefined) {
      window.cancelAnimationFrame(dragFrame.current)
      dragFrame.current = undefined
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (persist && moved && point !== undefined) {
      applyPetPosition(event.currentTarget, point)
      controller.setPosition(point)
    } else if (!persist && moved) {
      applyPetPosition(event.currentTarget, state.origin)
    }
    setDrag(undefined)
  }

  if (!controller.settings.enabled) return null
  return createPortal(
    <button
      ref={buttonRef}
      type="button"
      className="dsd-pet"
      data-dsd-pet-layer="deepseek"
      data-anchor={controller.settings.anchor}
      data-attention={String(attention)}
      data-dragging={String(drag !== undefined)}
      data-frame={column}
      data-looking={String(looking)}
      data-mode={mode}
      data-pet-id={controller.selectedPet.id}
      data-row={row}
      aria-label={`${controller.selectedPet.displayName}${label}，可拖动`}
      title={`${controller.selectedPet.displayName} · ${label}`}
      style={style}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        if (baseSignal.mode === 'review' && baseSignal.sessionId !== undefined) {
          openSession(baseSignal.sessionId)
          setDismissedReviewKey(baseSignal.key)
          setCompletion(undefined)
          return
        }
      }}
      onPointerCancel={(event) => finishDrag(event, false)}
      onPointerDown={onPointerDown}
      onPointerEnter={() => { if (dragRef.current === undefined) setHovered(true) }}
      onPointerLeave={() => setHovered(false)}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event, true)}
    >
      <span className="dsd-petSprite" aria-hidden="true" style={spriteStyle} />
      <span className="dsd-petStatus" role="status">{label}</span>
    </button>,
    document.body
  )
}

function applyPetPosition(element: HTMLElement | null, point: PetPoint): void {
  if (!element) return
  element.style.left = `${point.x}px`
  element.style.top = `${point.y}px`
  element.style.right = 'auto'
  element.style.bottom = 'auto'
}

export function PetSettings({ controller }: { controller: PetController }): ReactNode {
  const [open, setOpen] = useState(false)
  const manifestInput = useRef<HTMLInputElement>(null)
  const spriteInput = useRef<HTMLInputElement>(null)
  const selectedIsCustom = controller.selectedPet.id !== DEFAULT_PET_ID
  const summaryPreview = petPreviewStyle(controller.selectedPet, 38)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return <>
    <section className="dsd-section" aria-labelledby="dsd-pet-title">
      <div className="dsd-sectionTitle dsd-petSectionTitle" id="dsd-pet-title">
        <span>桌宠</span>
        <label className="dsd-petToggle"><input type="checkbox" checked={controller.settings.enabled} onChange={(event) => controller.setEnabled(event.currentTarget.checked)} />显示</label>
      </div>
      <button type="button" className="dsd-petSummary" onClick={() => setOpen(true)}>
        <span className="dsd-petThumb" aria-hidden="true" style={summaryPreview} />
        <span className="dsd-petSummaryCopy">
          <span className="dsd-petSummaryName">{controller.selectedPet.displayName}</span>
          <span className="dsd-petSummaryMeta">选择与管理</span>
        </span>
        <span className="dsd-petSummaryArrow" aria-hidden="true">›</span>
      </button>
    </section>
    {open && createPortal(<div
      className="dsd-petDialogLayer"
      data-dsd-pet-dialog="true"
      onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
    >
      <div className="dsd-petDialog" role="dialog" aria-modal="true" aria-labelledby="dsd-pet-dialog-title">
        <div className="dsd-petDialogHeader">
          <div className="dsd-petDialogTitle" id="dsd-pet-dialog-title">桌宠</div>
          <button type="button" className="dsd-petDialogClose" aria-label="关闭桌宠设置" onClick={() => setOpen(false)}>×</button>
        </div>
        <div className="dsd-petList">
          {controller.pets.map((pet) => <button
            key={pet.id}
            type="button"
            className="dsd-petChoice"
            data-pet-id={pet.id}
            aria-pressed={pet.id === controller.selectedPet.id}
            onClick={() => controller.setPetId(pet.id)}
          >
            <span className="dsd-petThumb" aria-hidden="true" style={petPreviewStyle(pet, 38)} />
            <span className="dsd-petChoiceCopy">
              <span className="dsd-petChoiceName">{pet.displayName}</span>
              <span className="dsd-petChoiceMeta">Codex V{pet.spriteVersionNumber}</span>
            </span>
          </button>)}
        </div>
        <div className="dsd-petManage">
          <label className="dsd-petManageRow"><span>动画</span><input type="checkbox" checked={controller.settings.animated} onChange={(event) => controller.setAnimated(event.currentTarget.checked)} /></label>
          <label className="dsd-petManageRow"><span>大小</span><input type="range" min="0.7" max="1.5" step="0.05" value={controller.settings.scale} onChange={(event) => controller.setScale(Number(event.currentTarget.value))} aria-label="宠物大小" /></label>
          <div className="dsd-petManageActions">
            <button type="button" className="dsd-petManageButton" onClick={() => controller.setPosition()}>重置位置</button>
            <button type="button" className="dsd-petManageButton" onClick={() => manifestInput.current?.click()}>导入 pet.json</button>
            <button type="button" className="dsd-petManageButton" onClick={() => spriteInput.current?.click()}>导入精灵图</button>
            {selectedIsCustom && <button type="button" className="dsd-petManageButton dsd-petManageButtonDanger" onClick={() => void controller.deletePet(controller.selectedPet.id)}>删除当前宠物</button>}
          </div>
          <input ref={manifestInput} className="dsd-petFileInput" type="file" accept=".json,application/json" onChange={controller.readManifest} />
          <input ref={spriteInput} className="dsd-petFileInput" type="file" accept=".webp,.png,image/webp,image/png" onChange={controller.readSpritesheet} />
          {controller.status && <div className="dsd-petStatusText" role="status">{controller.status}</div>}
        </div>
      </div>
    </div>, document.body)}
  </>
}

function usePetFrame(mode: PetMode, continuous: boolean, key: string, animated: boolean): PetFrameStep {
  const timeline = petTimeline(mode, continuous)
  const [sample, setSample] = useState(() => petFrameAt(timeline, 0))
  useEffect(() => {
    setSample(petFrameAt(timeline, 0))
    if (!animated || window.matchMedia('(prefers-reduced-motion: reduce)').matches || timeline.steps.length < 2) return
    let frame = 0
    const startedAt = performance.now()
    let lastIndex = -1
    const tick = (now: number): void => {
      const next = petFrameAt(timeline, now - startedAt)
      if (next.index !== lastIndex) {
        lastIndex = next.index
        setSample(next)
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [animated, key, timeline])
  return sample.step
}

function petPreviewStyle(pet: PetRecord, width: number): CSSProperties {
  const scale = width / PET_FRAME_WIDTH
  return {
    backgroundImage: `url(${pet.spritesheetDataUrl})`,
    backgroundPosition: pet.id === DEFAULT_PET_ID ? `0 ${-(6 * PET_FRAME_HEIGHT * scale)}px` : '0 0',
    backgroundSize: `${1536 * scale}px ${petAtlasRows(pet.spriteVersionNumber) * PET_FRAME_HEIGHT * scale}px`
  }
}

function getPetStore(): PetStoreApi | undefined {
  return (window as Window & { deepseekDesktop?: { petStore?: PetStoreApi } }).deepseekDesktop?.petStore
}

function readPetSettings(): PetSettingsState {
  const fallback: PetSettingsState = { animated: true, enabled: true, petId: DEFAULT_PET_ID, scale: 1.15, anchor: 'right' }
  const value = readCookie(PET_SETTINGS_COOKIE)
  if (!value) return fallback
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<PetSettingsState> & { position?: 'left' | 'right' }
    return {
      animated: parsed.animated !== false,
      enabled: parsed.enabled !== false,
      petId: typeof parsed.petId === 'string' ? parsed.petId : DEFAULT_PET_ID,
      scale: clamp(typeof parsed.scale === 'number' ? parsed.scale : 1.15, .7, 1.5),
      anchor: parsed.anchor === 'left' || parsed.position === 'left' ? 'left' : 'right',
      x: Number.isFinite(parsed.x) ? parsed.x : undefined,
      y: Number.isFinite(parsed.y) ? parsed.y : undefined
    }
  } catch {
    return fallback
  }
}

function updateSettings(setSettings: (value: (previous: PetSettingsState) => PetSettingsState) => void, patch: Partial<PetSettingsState>): void {
  setSettings((previous) => {
    const next = { ...previous, ...patch }
    document.cookie = `${PET_SETTINGS_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; Max-Age=${PET_COOKIE_MAX_AGE}; Path=/; SameSite=Strict`
    return next
  })
}

function readCookie(name: string): string | undefined {
  return document.cookie.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1)
}

function parseManifest(text: string): PetManifest {
  const value = JSON.parse(text.replace(/^\uFEFF/, '')) as Partial<PetManifest> & { spriteVersionNumber?: number }
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : ''
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id) || id === DEFAULT_PET_ID) throw new Error('pet.json 的 id 无效或与内置宠物冲突')
  if (!displayName || displayName.length > 80) throw new Error('pet.json 的 displayName 无效')
  if (value.spriteVersionNumber !== undefined && value.spriteVersionNumber !== 1 && value.spriteVersionNumber !== 2) throw new Error('只支持 Codex V1 或 V2 宠物图集')
  return {
    id,
    displayName,
    description: typeof value.description === 'string' ? value.description.slice(0, 160) : undefined,
    spriteVersionNumber: value.spriteVersionNumber === 2 ? 2 : 1,
    spritesheetPath: typeof value.spritesheetPath === 'string' ? value.spritesheetPath : undefined
  }
}

function isPetRecord(value: unknown): value is PetRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PetRecord>
  return typeof record.id === 'string'
    && record.id !== DEFAULT_PET_ID
    && typeof record.displayName === 'string'
    && record.displayName.length <= 80
    && (record.spriteVersionNumber === 1 || record.spriteVersionNumber === 2)
    && typeof record.spritesheetDataUrl === 'string'
    && record.spritesheetDataUrl.startsWith('data:image/')
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取精灵图')))
    reader.addEventListener('error', () => reject(new Error('无法读取精灵图')))
    reader.readAsDataURL(file)
  })
}

function validateSpritesheet(dataUrl: string): Promise<PetSpriteVersion> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => {
      if (image.naturalWidth !== 1536) return reject(new Error('精灵图宽度必须为 1536 像素'))
      if (image.naturalHeight === 1872) return resolve(1)
      if (image.naturalHeight === 2288) return resolve(2)
      reject(new Error('精灵图必须为 Codex V1 1536×1872 或 V2 1536×2288'))
    })
    image.addEventListener('error', () => reject(new Error('精灵图格式无法识别')))
    image.src = dataUrl
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function installPetStyles(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css="deepseek-desktop-pet"]')) return
  const style = document.createElement('style')
  style.dataset.plugin = '@deepseek-desktop/companion'
  style.dataset.pluginCss = 'deepseek-desktop-pet'
  style.textContent = PET_CSS
  document.head.appendChild(style)
}
