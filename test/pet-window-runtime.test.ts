import { describe, expect, it } from 'vitest'
import {
  choosePetStatusPlacement,
  clampPetWindowPosition,
  defaultPetWindowPosition,
  petEnvelope,
  petWindowShape,
  PET_WINDOW_HEIGHT,
  PET_WINDOW_WIDTH
} from '../src/pet-window-runtime.js'

describe('desktop pet window geometry', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }

  it('leaves safe transparent space on both sides at maximum scale', () => {
    const envelope = petEnvelope(1.5)
    expect(envelope.x).toBeGreaterThan(0)
    expect(envelope.x + envelope.width).toBeLessThan(PET_WINDOW_WIDTH)
    expect(envelope.y).toBeGreaterThan(0)
    expect(envelope.y + envelope.height).toBeLessThan(PET_WINDOW_HEIGHT)
  })

  it('keeps the padded V3 action envelope inside the native region', () => {
    const envelope = petEnvelope(1.5, 3)
    const [sprite] = petWindowShape(1.5, 'hidden', 3)
    expect(sprite.x).toBeLessThanOrEqual(envelope.x)
    expect(sprite.y).toBeLessThanOrEqual(envelope.y)
    expect(sprite.x + sprite.width).toBeGreaterThanOrEqual(envelope.x + envelope.width)
    expect(sprite.y + sprite.height).toBeGreaterThanOrEqual(envelope.y + envelope.height)
  })

  it('places the visible character near the lower-right work-area edge', () => {
    const point = defaultPetWindowPosition(workArea, 1.15)
    const envelope = petEnvelope(1.15)
    expect(point.x + envelope.x + envelope.width).toBeCloseTo(1920 - 24, 0)
    expect(point.y + envelope.y + envelope.height).toBeCloseTo(1040 - 18, 0)
  })

  it('clamps the visible character rather than the transparent window gutter', () => {
    const point = clampPetWindowPosition({ x: -10_000, y: 10_000 }, workArea, 1.5)
    const envelope = petEnvelope(1.5)
    expect(point.x + envelope.x).toBe(10)
    expect(point.y + envelope.y + envelope.height).toBe(1040 - 10)
  })

  it('supports monitors with negative desktop coordinates', () => {
    const leftDisplay = { x: -1600, y: -100, width: 1600, height: 900 }
    const point = clampPetWindowPosition({ x: -5000, y: -5000 }, leftDisplay, 1)
    const envelope = petEnvelope(1)
    expect(point.x + envelope.x).toBe(leftDisplay.x + 10)
    expect(point.y + envelope.y).toBe(leftDisplay.y + 10)
  })

  it('keeps the full action envelope inside the native hit-test shape', () => {
    const envelope = petEnvelope(1.5)
    const [sprite] = petWindowShape(1.5)
    expect(sprite.x).toBeLessThanOrEqual(envelope.x)
    expect(sprite.y).toBeLessThanOrEqual(envelope.y)
    expect(sprite.x + sprite.width).toBeGreaterThanOrEqual(envelope.x + envelope.width)
    expect(sprite.y + sprite.height).toBeGreaterThanOrEqual(envelope.y + envelope.height)
    expect(sprite.x).toBeLessThanOrEqual(envelope.x - 17)
    expect(sprite.y).toBeLessThanOrEqual(envelope.y - 17)
  })

  it('adds a bounded native region only while the status label is visible', () => {
    expect(petWindowShape(1.15, 'hidden')).toHaveLength(1)
    for (const placement of ['above', 'below'] as const) {
      const [, status] = petWindowShape(1.5, placement)
      expect(status.x).toBeGreaterThanOrEqual(0)
      expect(status.y).toBeGreaterThanOrEqual(0)
      expect(status.x + status.width).toBeLessThanOrEqual(PET_WINDOW_WIDTH)
      expect(status.y + status.height).toBeLessThanOrEqual(PET_WINDOW_HEIGHT)
    }
  })

  it('moves the status label above the pet at the bottom work-area edge', () => {
    const bottom = clampPetWindowPosition({ x: 0, y: 10_000 }, workArea, 1.15)
    const top = clampPetWindowPosition({ x: 0, y: -10_000 }, workArea, 1.15)
    expect(choosePetStatusPlacement(bottom.y, workArea, 1.15)).toBe('above')
    expect(choosePetStatusPlacement(top.y, workArea, 1.15)).toBe('below')
  })
})
