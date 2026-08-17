export type PetSpriteVersion = 1 | 2
export type PetMode =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export interface PetSessionEntry {
  completed?: boolean
  displayTitle?: string
  pendingInteraction?: 'approval' | 'plan-review' | 'question'
  running?: boolean
  updatedAt?: number
}

export interface PetSessionSnapshot {
  current?: string
  ids?: string[]
  byId: Record<string, PetSessionEntry | undefined>
}

export interface PetSignal {
  mode: 'idle' | 'failed' | 'waiting' | 'running' | 'review'
  key: string
  label: string
  sessionId?: string
}

export interface PetFrameStep {
  column: number
  duration: number
  row: number
}

export interface PetTimeline {
  loopStart: number
  steps: readonly PetFrameStep[]
}

export interface PetFrameSample {
  index: number
  step: PetFrameStep
}

export interface PetPoint {
  x: number
  y: number
}

export type PetAnimationCadence = 'codex' | 'smooth'

export const PET_FRAME_WIDTH = 192
export const PET_FRAME_HEIGHT = 208
export const PET_ATLAS_COLUMNS = 8

const IDLE_STEPS = [1680, 660, 660, 840, 840, 1920].map((duration, column) => ({
  column,
  duration,
  row: 0
}))

const ANIMATIONS: Record<Exclude<PetMode, 'idle'>, { row: number; frames: number; duration: number; finalDuration: number }> = {
  'running-right': { row: 1, frames: 8, duration: 120, finalDuration: 220 },
  'running-left': { row: 2, frames: 8, duration: 120, finalDuration: 220 },
  waving: { row: 3, frames: 4, duration: 140, finalDuration: 280 },
  jumping: { row: 4, frames: 5, duration: 140, finalDuration: 280 },
  failed: { row: 5, frames: 8, duration: 140, finalDuration: 240 },
  waiting: { row: 6, frames: 6, duration: 150, finalDuration: 260 },
  running: { row: 7, frames: 6, duration: 120, finalDuration: 220 },
  review: { row: 8, frames: 6, duration: 150, finalDuration: 280 }
}

const SMOOTH_ANIMATION_DURATION = 83
const SMOOTH_FINAL_FRAME_DURATION = 125
const DEFAULT_PET_FOOT_ANCHOR_X = 96
const DEFAULT_PET_FOOT_ANCHORS: Readonly<Record<number, readonly number[]>> = {
  1: [137, 150, 153, 146, 78, 149, 145, 143],
  2: [55, 78, 54, 61, 90, 84.5, 52, 50],
  3: [92, 87, 78, 80.5],
  4: [86, 101, 97, 82, 85],
  5: [98, 111, 120, 120, 123.5, 110, 90, 86],
  6: [98, 103, 106, 106, 95.5, 91],
  7: [96, 98, 92, 91.5, 86, 86],
  8: [90, 102, 89.5, 83, 79, 75]
}

const IDLE_TIMELINE: PetTimeline = { steps: IDLE_STEPS, loopStart: 0 }
const TRANSIENT_TIMELINES = buildTimelines(false)
const CONTINUOUS_TIMELINES = buildTimelines(true)
const SMOOTH_TRANSIENT_TIMELINES = buildTimelines(false, 'smooth')
const SMOOTH_CONTINUOUS_TIMELINES = buildTimelines(true, 'smooth')

export function selectPetSessionSignal(state: PetSessionSnapshot, hasCurrentError = false): PetSignal {
  const currentId = state.current
  const current = currentId === undefined ? undefined : state.byId[currentId]
  if (current?.pendingInteraction !== undefined) {
    const labels = {
      approval: '需要你批准',
      'plan-review': '需要你审阅计划',
      question: '需要你回答'
    } as const
    return {
      mode: 'waiting',
      key: `waiting:${currentId}:${current.pendingInteraction}`,
      label: labels[current.pendingInteraction],
      sessionId: currentId
    }
  }
  if (current?.running === true) {
    return { mode: 'running', key: `running:${currentId}`, label: '正在工作', sessionId: currentId }
  }
  if (hasCurrentError && currentId !== undefined) {
    return { mode: 'failed', key: `failed:${currentId}`, label: '任务遇到问题', sessionId: currentId }
  }

  const completed = (state.ids ?? Object.keys(state.byId))
    .filter((id) => state.byId[id]?.completed === true)
    .sort((left, right) => (state.byId[right]?.updatedAt ?? 0) - (state.byId[left]?.updatedAt ?? 0))[0]
  if (completed !== undefined) {
    const entry = state.byId[completed]
    return {
      mode: 'review',
      key: `review:${completed}:${entry?.updatedAt ?? 0}`,
      label: `${entry?.displayTitle?.trim() || '后台任务'}已完成`,
      sessionId: completed
    }
  }

  return { mode: 'idle', key: `idle:${currentId ?? ''}`, label: '待机中' }
}

export function petTimeline(mode: PetMode, continuous = false, cadence: PetAnimationCadence = 'codex'): PetTimeline {
  if (mode === 'idle') return IDLE_TIMELINE
  if (cadence === 'smooth') return continuous ? SMOOTH_CONTINUOUS_TIMELINES[mode] : SMOOTH_TRANSIENT_TIMELINES[mode]
  return continuous ? CONTINUOUS_TIMELINES[mode] : TRANSIENT_TIMELINES[mode]
}

export function petFrameAt(timeline: PetTimeline, elapsedMs: number): PetFrameSample {
  if (timeline.steps.length === 0) return { index: 0, step: { column: 0, duration: 1_000, row: 0 } }
  const firstLoopEnd = timeline.loopStart > 0
    ? timeline.steps.slice(0, timeline.loopStart).reduce((total, step) => total + step.duration, 0)
    : 0
  const loopSteps = timeline.steps.slice(timeline.loopStart)
  const loopDuration = loopSteps.reduce((total, step) => total + step.duration, 0)
  let remaining = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  if (loopDuration > 0 && remaining >= firstLoopEnd) remaining = firstLoopEnd + ((remaining - firstLoopEnd) % loopDuration)
  let index = 0
  while (index < timeline.steps.length - 1 && remaining >= timeline.steps[index].duration) {
    remaining -= timeline.steps[index].duration
    index += 1
  }
  return { index, step: timeline.steps[index] }
}

export function primaryAnimationDuration(mode: Exclude<PetMode, 'idle'>): number {
  const timeline = TRANSIENT_TIMELINES[mode]
  return timeline.steps.slice(0, timeline.loopStart).reduce((total, step) => total + step.duration, 0)
}

export function petAtlasRows(version: PetSpriteVersion): 9 | 11 {
  return version === 2 ? 11 : 9
}

export function resolvePetLookIndex(dx: number, dy: number, deadzone = 6): number | undefined {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) <= deadzone) return undefined
  const clockwiseFromUp = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
  return Math.round(clockwiseFromUp / 22.5) % 16
}

export function resolvePetDragDirection(dx: number, dy: number, threshold = 4): 'running-left' | 'running-right' | undefined {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return undefined
  if (dx >= threshold) return 'running-right'
  if (dx <= -threshold) return 'running-left'
  return undefined
}

export function defaultPetFrameOffset(row: number, column: number): PetPoint {
  void column
  return defaultPetRowOffset(row)
}

export function defaultPetRowOffset(row: number): PetPoint {
  const anchors = DEFAULT_PET_FOOT_ANCHORS[row]
  if (!anchors?.length) return { x: 0, y: 0 }
  const average = anchors.reduce((total, value) => total + value, 0) / anchors.length
  return { x: Math.round((DEFAULT_PET_FOOT_ANCHOR_X - average) * 2) / 2, y: 0 }
}

export function clampPetPosition(
  point: PetPoint,
  petSize: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8
): PetPoint {
  return {
    x: clamp(point.x, margin, Math.max(margin, viewport.width - petSize.width - margin)),
    y: clamp(point.y, margin, Math.max(margin, viewport.height - petSize.height - margin))
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function buildTimelines(continuous: boolean, cadence: PetAnimationCadence = 'codex'): Record<Exclude<PetMode, 'idle'>, PetTimeline> {
  const timelines = {} as Record<Exclude<PetMode, 'idle'>, PetTimeline>
  for (const mode of Object.keys(ANIMATIONS) as Array<Exclude<PetMode, 'idle'>>) {
    const animation = ANIMATIONS[mode]
    const primary = Array.from({ length: animation.frames }, (_, column) => ({
      column,
      duration: cadence === 'smooth'
        ? column === animation.frames - 1 ? SMOOTH_FINAL_FRAME_DURATION : SMOOTH_ANIMATION_DURATION
        : column === animation.frames - 1 ? animation.finalDuration : animation.duration,
      row: animation.row
    }))
    timelines[mode] = continuous
      ? { steps: primary, loopStart: 0 }
      : { steps: [...primary, ...primary, ...primary, ...IDLE_STEPS], loopStart: primary.length * 3 }
  }
  return timelines
}
