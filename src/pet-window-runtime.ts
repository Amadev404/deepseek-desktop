import type { Rectangle } from 'electron'
import type { PetStatusPlacement } from './pet-window-contract.js'
import { PET_STAGE_PADDING, petSpriteGeometry, type PetSpriteVersion } from './pet-sprite.js'

export const PET_WINDOW_WIDTH = 512
export const PET_WINDOW_HEIGHT = 660
export const PET_SPRITE_TOP = 130

const EDGE_MARGIN = 10
const MIN_ROW_OFFSET_X = -42
const MAX_ROW_OFFSET_X = 31
const SPRITE_SHAPE_PADDING = 32
const STATUS_SHAPE_MARGIN_X = 24
const STATUS_SHAPE_HEIGHT = 144
const STATUS_ABOVE_SHAPE_HEIGHT = 130
const STATUS_VISUAL_EXTENT = 124

export interface Point {
  x: number
  y: number
}

export type PetEnvelope = Rectangle

export function petEnvelope(scale: number, version: PetSpriteVersion = 2): PetEnvelope {
  const value = clamp(scale, .7, 1.5)
  const geometry = petSpriteGeometry(version)
  const stageWidth = (geometry.frameWidth + PET_STAGE_PADDING * 2) * value
  const centeredLeft = (PET_WINDOW_WIDTH - stageWidth) / 2
  return {
    x: centeredLeft + (PET_STAGE_PADDING + geometry.contentX + MIN_ROW_OFFSET_X) * value,
    y: PET_SPRITE_TOP + (PET_STAGE_PADDING + geometry.contentY) * value,
    width: geometry.contentWidth * value + (MAX_ROW_OFFSET_X - MIN_ROW_OFFSET_X) * value,
    height: geometry.contentHeight * value
  }
}

export function clampPetWindowPosition(point: Point, workArea: Rectangle, scale: number, version: PetSpriteVersion = 2): Point {
  const envelope = petEnvelope(scale, version)
  const minX = workArea.x + EDGE_MARGIN - envelope.x
  const maxX = workArea.x + workArea.width - EDGE_MARGIN - envelope.x - envelope.width
  const minY = workArea.y + EDGE_MARGIN - envelope.y
  const maxY = workArea.y + workArea.height - EDGE_MARGIN - envelope.y - envelope.height
  return {
    x: Math.round(clamp(point.x, Math.min(minX, maxX), Math.max(minX, maxX))),
    y: Math.round(clamp(point.y, Math.min(minY, maxY), Math.max(minY, maxY)))
  }
}

export function defaultPetWindowPosition(workArea: Rectangle, scale: number, version: PetSpriteVersion = 2): Point {
  const envelope = petEnvelope(scale, version)
  return clampPetWindowPosition({
    x: workArea.x + workArea.width - 24 - envelope.x - envelope.width,
    y: workArea.y + workArea.height - 18 - envelope.y - envelope.height
  }, workArea, scale, version)
}

export function choosePetStatusPlacement(
  windowY: number,
  workArea: Pick<Rectangle, 'y' | 'height'>,
  scale: number,
  version: PetSpriteVersion = 2
): Exclude<PetStatusPlacement, 'hidden'> {
  const envelope = petEnvelope(scale, version)
  const topEdge = workArea.y + EDGE_MARGIN
  const bottomEdge = workArea.y + workArea.height - EDGE_MARGIN
  const aboveTop = windowY + PET_SPRITE_TOP - STATUS_VISUAL_EXTENT
  const belowBottom = windowY + envelope.y + envelope.height + STATUS_VISUAL_EXTENT
  if (belowBottom <= bottomEdge) return 'below'
  if (aboveTop >= topEdge) return 'above'
  return topEdge - aboveTop < belowBottom - bottomEdge ? 'above' : 'below'
}

export function petWindowShape(
  scale: number,
  statusPlacement: PetStatusPlacement = 'hidden',
  version: PetSpriteVersion = 2
): Rectangle[] {
  const value = clamp(scale, .7, 1.5)
  const geometry = petSpriteGeometry(version)
  const envelope = petEnvelope(value, version)
  const stageWidth = (geometry.frameWidth + PET_STAGE_PADDING * 2) * value
  const stageHeight = (geometry.frameHeight + PET_STAGE_PADDING * 2) * value
  const stageLeft = (PET_WINDOW_WIDTH - stageWidth) / 2
  const spriteLeft = Math.max(0, Math.floor(stageLeft + MIN_ROW_OFFSET_X * value - SPRITE_SHAPE_PADDING))
  const spriteTop = Math.max(0, Math.floor(PET_SPRITE_TOP - SPRITE_SHAPE_PADDING))
  const spriteRight = Math.min(PET_WINDOW_WIDTH, Math.ceil(stageLeft + stageWidth + MAX_ROW_OFFSET_X * value + SPRITE_SHAPE_PADDING))
  const spriteBottom = Math.min(PET_WINDOW_HEIGHT, Math.ceil(PET_SPRITE_TOP + stageHeight + SPRITE_SHAPE_PADDING))
  const shape = [{
    x: spriteLeft,
    y: spriteTop,
    width: spriteRight - spriteLeft,
    height: spriteBottom - spriteTop
  }]
  if (statusPlacement === 'hidden') return shape

  const statusHeight = statusPlacement === 'above' ? STATUS_ABOVE_SHAPE_HEIGHT : STATUS_SHAPE_HEIGHT
  shape.push({
    x: STATUS_SHAPE_MARGIN_X,
    y: statusPlacement === 'above'
      ? 0
      : Math.min(PET_WINDOW_HEIGHT - statusHeight, Math.floor(envelope.y + envelope.height)),
    width: PET_WINDOW_WIDTH - STATUS_SHAPE_MARGIN_X * 2,
    height: statusHeight
  })
  return shape
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
