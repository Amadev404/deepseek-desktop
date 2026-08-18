export type PetSpriteVersion = 1 | 2 | 3

export interface PetSpriteGeometry {
  frameWidth: number
  frameHeight: number
  atlasWidth: number
  atlasHeight: number
  atlasRows: 9 | 11
  contentX: number
  contentY: number
  contentWidth: number
  contentHeight: number
}

export const PET_ATLAS_COLUMNS = 8
export const PET_STAGE_PADDING = 24

const LEGACY_FRAME_WIDTH = 192
const LEGACY_FRAME_HEIGHT = 208

const LEGACY_V1_GEOMETRY: PetSpriteGeometry = {
  frameWidth: LEGACY_FRAME_WIDTH,
  frameHeight: LEGACY_FRAME_HEIGHT,
  atlasWidth: LEGACY_FRAME_WIDTH * PET_ATLAS_COLUMNS,
  atlasHeight: LEGACY_FRAME_HEIGHT * 9,
  atlasRows: 9,
  contentX: 0,
  contentY: 0,
  contentWidth: LEGACY_FRAME_WIDTH,
  contentHeight: LEGACY_FRAME_HEIGHT
}

const LEGACY_V2_GEOMETRY: PetSpriteGeometry = {
  ...LEGACY_V1_GEOMETRY,
  atlasHeight: LEGACY_FRAME_HEIGHT * 11,
  atlasRows: 11
}

// V3 keeps the original art at native size but gives every cell a 32px x 24px inset.
const PADDED_V3_GEOMETRY: PetSpriteGeometry = {
  frameWidth: 256,
  frameHeight: 256,
  atlasWidth: 256 * PET_ATLAS_COLUMNS,
  atlasHeight: 256 * 11,
  atlasRows: 11,
  contentX: 32,
  contentY: 24,
  contentWidth: LEGACY_FRAME_WIDTH,
  contentHeight: LEGACY_FRAME_HEIGHT
}

export function petSpriteGeometry(version: PetSpriteVersion): PetSpriteGeometry {
  if (version === 3) return PADDED_V3_GEOMETRY
  return version === 1 ? LEGACY_V1_GEOMETRY : LEGACY_V2_GEOMETRY
}

export function petStageSize(version: PetSpriteVersion, scale: number): { width: number; height: number } {
  const geometry = petSpriteGeometry(version)
  return {
    width: (geometry.frameWidth + PET_STAGE_PADDING * 2) * scale,
    height: (geometry.frameHeight + PET_STAGE_PADDING * 2) * scale
  }
}
