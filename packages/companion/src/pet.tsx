import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode
} from 'react'
import defaultSpritesheet from '../assets/deepseek-pet.webp'

const PET_SETTINGS_COOKIE = 'deepseek_desktop_pet_settings'
const PET_COOKIE_MAX_AGE = 31_536_000
const DEFAULT_PET_ID = 'deepseek-whale-girl'
const MAX_SPRITESHEET_BYTES = 12 * 1024 * 1024

export type PetMode = 'idle' | 'running' | 'waiting'

interface PetSessionEntry {
  pendingInteraction?: unknown
  running?: boolean
}

export interface PetSessionSnapshot {
  current?: string
  byId: Record<string, PetSessionEntry | undefined>
}

export type PetUseSessions = <T>(selector: (state: PetSessionSnapshot) => T) => T

interface PetManifest {
  id: string
  displayName: string
  description?: string
  spriteVersionNumber: 2
  spritesheetPath?: string
}

export interface PetRecord {
  id: string
  displayName: string
  description: string
  spriteVersionNumber: 2
  spritesheetDataUrl: string
}

interface PetStoreApi {
  list(): Promise<PetRecord[]>
  save(record: PetRecord): Promise<void>
  remove(id: string): Promise<void>
}

interface PetSettings {
  enabled: boolean
  petId: string
  scale: number
  position: 'left' | 'right'
}

interface PetDraft {
  manifest?: PetManifest
  spritesheetDataUrl?: string
}

const DEFAULT_PET: PetRecord = {
  id: DEFAULT_PET_ID,
  displayName: '鲸鱼娘 · DeepSeek Pet',
  description: 'DeepSeek 默认宠物，支持状态动画和 16 方向追视。',
  spriteVersionNumber: 2,
  spritesheetDataUrl: defaultSpritesheet
}

const PET_CSS = `
.dsd-pet{--dsd-pet-scale:1.15;position:fixed;z-index:110;bottom:94px;width:calc(192px * var(--dsd-pet-scale));height:calc(208px * var(--dsd-pet-scale));padding:0;border:0;border-radius:18px;background:transparent;cursor:zoom-in;filter:drop-shadow(0 10px 16px rgb(0 0 0 / 28%));transition:width .18s ease,height .18s ease,filter .18s ease;outline:none}
.dsd-pet[data-position='left']{left:18px}.dsd-pet[data-position='right']{right:18px}
.dsd-pet[data-large='true']{--dsd-pet-scale:1.5;cursor:zoom-out;z-index:111}
.dsd-petSprite{display:block;width:192px;height:208px;background-repeat:no-repeat;background-size:1536px 2288px;background-position:0 var(--dsd-pet-y);transform:scale(var(--dsd-pet-scale));transform-origin:left top;animation:dsd-pet-six-frames 1.7s step-end infinite}
.dsd-pet[data-mode='running'] .dsd-petSprite{animation-duration:.9s}.dsd-pet[data-mode='waiting'] .dsd-petSprite{animation-duration:1.35s}
.dsd-pet[data-looking='true'] .dsd-petSprite{animation:none;background-position:var(--dsd-pet-look-x) var(--dsd-pet-look-y)}
.dsd-petStatus{position:absolute;right:8px;bottom:-28px;max-width:184px;overflow:hidden;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent);font:12px/1.2 system-ui,sans-serif;text-overflow:ellipsis;white-space:nowrap;opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease;pointer-events:none}
.dsd-pet:hover .dsd-petStatus,.dsd-pet:focus-visible .dsd-petStatus{opacity:1;transform:translateY(0)}.dsd-pet:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:4px}
@keyframes dsd-pet-six-frames{0%,16.66%{background-position:0 var(--dsd-pet-y)}16.67%,33.32%{background-position:-192px var(--dsd-pet-y)}33.33%,49.99%{background-position:-384px var(--dsd-pet-y)}50%,66.65%{background-position:-576px var(--dsd-pet-y)}66.66%,83.32%{background-position:-768px var(--dsd-pet-y)}83.33%,99.99%{background-position:-960px var(--dsd-pet-y)}100%{background-position:0 var(--dsd-pet-y)}}
.dsd-petSectionTitle{display:flex;align-items:center;justify-content:space-between;gap:8px}.dsd-petToggle{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}.dsd-petToggle input{accent-color:var(--dsw-alias-state-business-primary);margin:0}.dsd-petSelect{box-sizing:border-box;width:100%;height:34px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}.dsd-petSelect:focus-visible{border-color:var(--dsw-alias-border-l3);box-shadow:0 0 0 2px var(--dsw-alias-interactive-bg-hover)}
.dsd-petDescription{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsd-petControls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.dsd-petControl{display:flex;flex-direction:column;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:11px}.dsd-petControl input[type='range']{width:100%;accent-color:var(--dsw-alias-state-business-primary)}.dsd-petControl select{height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px}.dsd-petImport{display:flex;gap:6px;margin-top:9px}.dsd-petImport button,.dsd-petDelete{height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;padding:0 8px}.dsd-petImport button:hover,.dsd-petImport button:focus-visible,.dsd-petDelete:hover,.dsd-petDelete:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsd-petDelete{margin-top:7px}.dsd-petStatusText{margin-top:7px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsd-petFileInput{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
@media(prefers-reduced-motion:reduce){.dsd-pet,.dsd-petStatus{transition:none}.dsd-petSprite{animation:none}}
`

installPetStyles()

export function selectPetMode(state: PetSessionSnapshot): PetMode {
  const current = state.current === undefined ? undefined : state.byId[state.current]
  if (current?.pendingInteraction !== undefined) return 'waiting'
  if (current?.running === true) return 'running'
  return 'idle'
}

export function usePetController() {
  const [settings, setSettings] = useState<PetSettings>(() => readPetSettings())
  const [customPets, setCustomPets] = useState<PetRecord[]>([])
  const [draft, setDraft] = useState<PetDraft>({})
  const [status, setStatus] = useState('')
  useEffect(() => {
    let active = true
    const store = getPetStore()
    if (!store) {
      return
    }
    void store.list().then((records) => {
      if (!active) return
      setCustomPets(records.filter(isPetRecord))
    }).catch(() => {
      if (active) {
        setStatus('自定义宠物读取失败')
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!draft.manifest || !draft.spritesheetDataUrl) return
    let active = true
    const record: PetRecord = {
      id: draft.manifest.id,
      displayName: draft.manifest.displayName,
      description: draft.manifest.description ?? '自定义 DeepSeek 宠物。',
      spriteVersionNumber: 2,
      spritesheetDataUrl: draft.spritesheetDataUrl
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
  const setScale = useCallback((scale: number) => updateSettings(setSettings, { scale: clamp(scale, .8, 1.5) }), [])
  const setPosition = useCallback((position: 'left' | 'right') => updateSettings(setSettings, { position }), [])
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
      setStatus('配置已读取，请继续选择精灵图')
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
      await validateSpritesheet(dataUrl)
      setDraft((value) => ({ ...value, spritesheetDataUrl: dataUrl }))
      setStatus('精灵图已读取，正在保存…')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '精灵图无法读取')
    }
  }, [])

  return {
    customPets,
    deletePet,
    pets,
    readManifest,
    readSpritesheet,
    selectedPet,
    setEnabled,
    setPetId,
    setPosition,
    setScale,
    settings,
    status
  }
}

export type PetController = ReturnType<typeof usePetController>

export function PetOverlay({ controller, useSessions }: { controller: PetController; useSessions: PetUseSessions }): ReactNode {
  const mode = useSessions(selectPetMode)
  const [large, setLarge] = useState(false)
  const [lookIndex, setLookIndex] = useState<number | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (mode !== 'idle') {
      setLookIndex(null)
      return undefined
    }
    let idleTimer: number | undefined
    const handlePointerMove = (event: PointerEvent): void => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const dx = event.clientX - (rect.left + rect.width / 2)
      const dy = event.clientY - (rect.top + rect.height / 2)
      const clockwiseFromUp = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
      setLookIndex(Math.round(clockwiseFromUp / 22.5) % 16)
      if (idleTimer !== undefined) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => setLookIndex(null), 1_100)
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      if (idleTimer !== undefined) window.clearTimeout(idleTimer)
    }
  }, [mode])

  useEffect(() => setLarge(false), [controller.selectedPet.id])
  if (!controller.settings.enabled) return null

  const lookRow = lookIndex === null ? 0 : lookIndex < 8 ? 9 : 10
  const lookColumn = lookIndex === null ? 0 : lookIndex % 8
  const scale = controller.settings.scale * (large ? 1.25 : 1)
  const label = mode === 'running' ? `${controller.selectedPet.displayName}正在工作` : mode === 'waiting' ? `${controller.selectedPet.displayName}正在等待你` : `${controller.selectedPet.displayName}正在待机`
  const positionStyle = controller.settings.position === 'left' ? { left: '18px' } : { right: '18px' }
  const style = {
    ...positionStyle,
    '--dsd-pet-scale': String(scale)
  } as unknown as CSSProperties
  const spriteStyle = {
    backgroundImage: `url(${controller.selectedPet.spritesheetDataUrl})`,
    '--dsd-pet-y': `${-(lookRow * 208)}px`,
    '--dsd-pet-look-x': `${-(lookColumn * 192)}px`,
    '--dsd-pet-look-y': `${-(lookRow * 208)}px`
  } as CSSProperties

  return createPortal(
    <button
      ref={buttonRef}
      type="button"
      className="dsd-pet"
      data-dsd-pet-layer="deepseek"
      data-large={String(large)}
      data-looking={String(lookIndex !== null)}
      data-mode={mode}
      data-pet-id={controller.selectedPet.id}
      data-position={controller.settings.position}
      aria-label={`${label}，点击切换大小`}
      title={`${label}，点击切换大小`}
      style={style}
      onClick={() => setLarge((value) => !value)}
    >
      <span className="dsd-petSprite" aria-hidden="true" style={spriteStyle} />
      <span className="dsd-petStatus">{label}</span>
    </button>,
    document.body
  )
}

export function PetSettings({ controller }: { controller: PetController }): ReactNode {
  const manifestInput = useRef<HTMLInputElement>(null)
  const spriteInput = useRef<HTMLInputElement>(null)
  const selectedIsCustom = controller.selectedPet.id !== DEFAULT_PET_ID
  return <section className="dsd-section" aria-labelledby="dsd-pet-title">
    <div className="dsd-sectionTitle dsd-petSectionTitle" id="dsd-pet-title"><span>桌宠</span><label className="dsd-petToggle"><input type="checkbox" checked={controller.settings.enabled} onChange={(event) => controller.setEnabled(event.currentTarget.checked)} />显示</label></div>
    <select className="dsd-petSelect" value={controller.selectedPet.id} onChange={(event) => controller.setPetId(event.currentTarget.value)} aria-label="选择 DeepSeek 宠物">
      {controller.pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.displayName}</option>)}
    </select>
    <div className="dsd-petDescription">{controller.selectedPet.description}</div>
    <div className="dsd-petControls">
      <label className="dsd-petControl">大小 <input type="range" min="0.8" max="1.5" step="0.05" value={controller.settings.scale} onChange={(event) => controller.setScale(Number(event.currentTarget.value))} aria-label="宠物大小" /></label>
      <label className="dsd-petControl">位置 <select value={controller.settings.position} onChange={(event) => controller.setPosition(event.currentTarget.value as 'left' | 'right')} aria-label="宠物位置"><option value="right">右下</option><option value="left">左下</option></select></label>
    </div>
    <div className="dsd-petImport">
      <button type="button" onClick={() => manifestInput.current?.click()}>导入 pet.json</button>
      <button type="button" onClick={() => spriteInput.current?.click()}>导入精灵图</button>
      <input ref={manifestInput} className="dsd-petFileInput" type="file" accept=".json,application/json" onChange={controller.readManifest} />
      <input ref={spriteInput} className="dsd-petFileInput" type="file" accept=".webp,.png,image/webp,image/png" onChange={controller.readSpritesheet} />
    </div>
    {selectedIsCustom && <button type="button" className="dsd-petDelete" onClick={() => void controller.deletePet(controller.selectedPet.id)}>删除当前自定义宠物</button>}
    {controller.status && <div className="dsd-petStatusText" role="status">{controller.status}</div>}
  </section>
}

function getPetStore(): PetStoreApi | undefined {
  return (window as Window & { deepseekDesktop?: { petStore?: PetStoreApi } }).deepseekDesktop?.petStore
}

function readPetSettings(): PetSettings {
  const value = readCookie(PET_SETTINGS_COOKIE)
  if (!value) return { enabled: true, petId: DEFAULT_PET_ID, scale: 1.15, position: 'right' }
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<PetSettings>
    return {
      enabled: parsed.enabled !== false,
      petId: typeof parsed.petId === 'string' ? parsed.petId : DEFAULT_PET_ID,
      scale: clamp(typeof parsed.scale === 'number' ? parsed.scale : 1.15, .8, 1.5),
      position: parsed.position === 'left' ? 'left' : 'right'
    }
  } catch {
    return { enabled: true, petId: DEFAULT_PET_ID, scale: 1.15, position: 'right' }
  }
}

function updateSettings(setSettings: (value: (previous: PetSettings) => PetSettings) => void, patch: Partial<PetSettings>): void {
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
  const value = JSON.parse(text.replace(/^\uFEFF/, '')) as Partial<PetManifest>
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : ''
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id) || id === DEFAULT_PET_ID) throw new Error('pet.json 的 id 无效或与内置宠物冲突')
  if (!displayName || displayName.length > 80) throw new Error('pet.json 的 displayName 无效')
  if (value.spriteVersionNumber !== 2) throw new Error('只支持 Codex v2 宠物图集')
  return { id, displayName, description: typeof value.description === 'string' ? value.description.slice(0, 160) : undefined, spriteVersionNumber: 2, spritesheetPath: typeof value.spritesheetPath === 'string' ? value.spritesheetPath : undefined }
}

function isPetRecord(value: unknown): value is PetRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PetRecord>
  return typeof record.id === 'string' && record.id !== DEFAULT_PET_ID && typeof record.displayName === 'string' && record.displayName.length <= 80 && record.spriteVersionNumber === 2 && typeof record.spritesheetDataUrl === 'string' && record.spritesheetDataUrl.startsWith('data:image/')
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取精灵图')))
    reader.addEventListener('error', () => reject(new Error('无法读取精灵图')))
    reader.readAsDataURL(file)
  })
}

function validateSpritesheet(dataUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => image.naturalWidth === 1536 && image.naturalHeight === 2288 ? resolve() : reject(new Error('精灵图必须为 1536×2288 的 Codex v2 图集')))
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
