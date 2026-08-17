import type { Rectangle } from 'electron'

export const PET_WINDOW_WIDTH = 448
export const PET_WINDOW_HEIGHT = 400
export const PET_SPRITE_TOP = 26
export const PET_FRAME_WIDTH = 192
export const PET_FRAME_HEIGHT = 208

const EDGE_MARGIN = 10
const MIN_ROW_OFFSET_X = -42
const MAX_ROW_OFFSET_X = 31

export interface Point {
  x: number
  y: number
}

export type PetEnvelope = Rectangle

export function petEnvelope(scale: number): PetEnvelope {
  const value = clamp(scale, .7, 1.5)
  const spriteWidth = PET_FRAME_WIDTH * value
  const spriteHeight = PET_FRAME_HEIGHT * value
  const centeredLeft = (PET_WINDOW_WIDTH - spriteWidth) / 2
  return {
    x: centeredLeft + MIN_ROW_OFFSET_X * value,
    y: PET_SPRITE_TOP,
    width: spriteWidth + (MAX_ROW_OFFSET_X - MIN_ROW_OFFSET_X) * value,
    height: spriteHeight
  }
}

export function clampPetWindowPosition(point: Point, workArea: Rectangle, scale: number): Point {
  const envelope = petEnvelope(scale)
  const minX = workArea.x + EDGE_MARGIN - envelope.x
  const maxX = workArea.x + workArea.width - EDGE_MARGIN - envelope.x - envelope.width
  const minY = workArea.y + EDGE_MARGIN - envelope.y
  const maxY = workArea.y + workArea.height - EDGE_MARGIN - envelope.y - envelope.height
  return {
    x: Math.round(clamp(point.x, Math.min(minX, maxX), Math.max(minX, maxX))),
    y: Math.round(clamp(point.y, Math.min(minY, maxY), Math.max(minY, maxY)))
  }
}

export function defaultPetWindowPosition(workArea: Rectangle, scale: number): Point {
  const envelope = petEnvelope(scale)
  return clampPetWindowPosition({
    x: workArea.x + workArea.width - 24 - envelope.x - envelope.width,
    y: workArea.y + workArea.height - 18 - envelope.y - envelope.height
  }, workArea, scale)
}

export function petWindowShape(scale: number): Rectangle[] {
  const envelope = petEnvelope(scale)
  return [
    {
      x: Math.max(0, Math.floor(envelope.x - 8)),
      y: Math.max(0, Math.floor(envelope.y - 8)),
      width: Math.min(PET_WINDOW_WIDTH, Math.ceil(envelope.width + 16)),
      height: Math.ceil(envelope.height + 16)
    },
    {
      x: 32,
      y: Math.min(PET_WINDOW_HEIGHT - 48, Math.floor(envelope.y + envelope.height)),
      width: PET_WINDOW_WIDTH - 64,
      height: 48
    }
  ]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
