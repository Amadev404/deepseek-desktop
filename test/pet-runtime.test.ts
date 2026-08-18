import { describe, expect, it } from 'vitest'
import {
  clampPetPosition,
  defaultPetFrameOffset,
  petFrameAt,
  petAtlasRows,
  petSpriteGeometry,
  petTimeline,
  primaryAnimationDuration,
  resolvePetDragDirection,
  resolvePetLookIndex,
  selectPetSessionSignal
} from '../packages/companion/src/pet-runtime.js'

describe('Codex-compatible pet activity', () => {
  it('prioritizes pending interaction, running, failure, and completed work', () => {
    expect(selectPetSessionSignal({
      current: 'current',
      byId: { current: { pendingInteraction: 'approval', running: true } }
    })).toMatchObject({ mode: 'waiting', label: '需要你批准' })

    expect(selectPetSessionSignal({
      current: 'current',
      byId: { current: { cwd: 'C:\\work\\demo', displayTitle: 'Demo', running: true } }
    }, true)).toMatchObject({
      context: 'C:\\work\\demo',
      label: '正在思考',
      mode: 'running',
      sessionId: 'current'
    })

    expect(selectPetSessionSignal({
      current: 'current',
      byId: { current: { running: false } }
    }, true)).toMatchObject({ mode: 'failed', sessionId: 'current' })

    expect(selectPetSessionSignal({
      current: 'current',
      ids: ['older', 'newer'],
      byId: {
        current: { running: false },
        older: { completed: true, displayTitle: 'Older', updatedAt: 1 },
        newer: { completed: true, displayTitle: 'Newer', updatedAt: 2 }
      }
    })).toMatchObject({ mode: 'review', label: 'Newer已完成', sessionId: 'newer' })
  })

  it('returns idle when no task needs attention', () => {
    expect(selectPetSessionSignal({ current: 'current', byId: { current: { running: false } } }))
      .toMatchObject({ mode: 'idle', label: '待机中' })
  })
})

describe('Codex animation metrics', () => {
  it('uses the calm Codex idle timing', () => {
    const timeline = petTimeline('idle')
    expect(timeline.steps.map((step) => step.column)).toEqual([0, 1, 2, 3, 4, 5])
    expect(timeline.steps.map((step) => step.duration)).toEqual([1680, 660, 660, 840, 840, 1920])
    expect(timeline.loopStart).toBe(0)
  })

  it('plays activity three times before settling into idle', () => {
    const timeline = petTimeline('running')
    expect(timeline.loopStart).toBe(18)
    expect(timeline.steps.slice(0, 18).every((step) => step.row === 7)).toBe(true)
    expect(timeline.steps.slice(18).map((step) => step.row)).toEqual([0, 0, 0, 0, 0, 0])
    expect(primaryAnimationDuration('running')).toBe(2_460)
  })

  it('loops directional running continuously while dragging', () => {
    const timeline = petTimeline('running-left', true)
    expect(timeline.loopStart).toBe(0)
    expect(timeline.steps).toHaveLength(8)
    expect(timeline.steps.every((step) => step.row === 2)).toBe(true)
  })

  it('advances from elapsed time instead of dropping frames after a delayed tick', () => {
    const timeline = petTimeline('running')
    expect(petFrameAt(timeline, 0).index).toBe(0)
    expect(petFrameAt(timeline, 119).index).toBe(0)
    expect(petFrameAt(timeline, 120).index).toBe(1)
    expect(petFrameAt(timeline, 2_460).index).toBe(18)
    expect(petFrameAt(timeline, 2_460 + 1_680).index).toBe(19)
  })

  it('raises only the built-in pet activity cadence to twelve frames per second', () => {
    const timeline = petTimeline('running-right', true, 'smooth')
    expect(timeline.steps.map((step) => step.duration)).toEqual([83, 83, 83, 83, 83, 83, 83, 125])
    expect(petFrameAt(timeline, 83).index).toBe(1)
  })
})

describe('pet geometry', () => {
  it('uses a padded V3 atlas for the built-in desktop pet', () => {
    expect(petSpriteGeometry(3)).toMatchObject({
      frameWidth: 256,
      frameHeight: 256,
      atlasWidth: 2048,
      atlasHeight: 2816,
      contentX: 32,
      contentY: 24
    })
  })

  it('supports both Codex atlas versions and v2 look directions', () => {
    expect(petAtlasRows(1)).toBe(9)
    expect(petAtlasRows(2)).toBe(11)
    expect(resolvePetLookIndex(0, -100)).toBe(0)
    expect(resolvePetLookIndex(100, 0)).toBe(4)
    expect(resolvePetLookIndex(0, 100)).toBe(8)
    expect(resolvePetLookIndex(-100, 0)).toBe(12)
    expect(resolvePetLookIndex(1, 1)).toBeUndefined()
  })

  it('keeps a dragged pet inside the viewport', () => {
    expect(clampPetPosition(
      { x: -100, y: 900 },
      { width: 192, height: 208 },
      { width: 1_000, height: 700 }
    )).toEqual({ x: 8, y: 484 })
  })

  it('matches the Codex four-pixel directional drag threshold', () => {
    expect(resolvePetDragDirection(3, 0)).toBeUndefined()
    expect(resolvePetDragDirection(0, 8)).toBeUndefined()
    expect(resolvePetDragDirection(4, 0)).toBe('running-right')
    expect(resolvePetDragDirection(-4, 0)).toBe('running-left')
  })

  it('uses one stable row offset so an animation loop cannot reset its position', () => {
    expect(defaultPetFrameOffset(6, 0)).toEqual({ x: -4, y: 0 })
    expect(defaultPetFrameOffset(6, 2)).toEqual({ x: -4, y: 0 })
    expect(defaultPetFrameOffset(1, 0)).toEqual({ x: -41.5, y: 0 })
    expect(defaultPetFrameOffset(1, 7)).toEqual({ x: -41.5, y: 0 })
    expect(defaultPetFrameOffset(2, 0)).toEqual({ x: 30.5, y: 0 })
    expect(defaultPetFrameOffset(2, 7)).toEqual({ x: 30.5, y: 0 })
    expect(defaultPetFrameOffset(9, 0)).toEqual({ x: 0, y: 0 })
  })
})
