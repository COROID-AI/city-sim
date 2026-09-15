/**
 * Environment domain barrel.
 *
 * The café's physical architecture, its era data, the exported `RoomBounds` and
 * the structural placement anchor set other domains consume. Import from here —
 * or straight from `./EnvironmentModule` — but never rebuild a second shell:
 * this module is the only owner of the room.
 */

export {
  ENVIRONMENT_MODULE_ID,
  EnvironmentModule,
  createEnvironmentModule,
  ENVIRONMENT_SPECS,
  environmentSpec,
  CAFE_ROOM_BOUNDS,
  STRUCTURAL_LAYOUT,
} from './EnvironmentModule';
export type {
  EnvironmentModuleDescription,
  EnvironmentModuleOptions,
  WindowDressingState,
} from './EnvironmentModule';

export {
  ERA_DISCRIMINATOR_FIELDS,
  ENVIRONMENT_SPEC_YEARS,
  ceilingDetailStyle,
  describeEnvironmentSpec,
  dressingStyle,
  environmentSpecs,
  eraConflicts,
  signagePalette,
  surfaceStyle,
} from './data/years';
export type {
  CeilingDetailKind,
  CeilingSpec,
  CounterSpec,
  DoorwaySpec,
  DressingKind,
  EnvironmentSpec,
  EnvironmentSpecSummary,
  GlazingSpec,
  LightBounce,
  PaintPalette,
  SignageArmStyle,
  SignageSpec,
  StreetSpec,
  SurfaceFinish,
  TilePalette,
  WainscotSpec,
  WindowDressingSpec,
} from './data/years';

export {
  CAFE_ROOM_BOUNDS as ROOM_BOUNDS,
  COUNTER_BASE_HEIGHT,
  COUNTER_TOP_THICKNESS,
  ENVIRONMENT_GROUP_NAME,
  SHELL_INVENTORY_NODE_NAMES,
  SHELL_NODE_NAMES,
  SHELL_STRUCTURAL_NODE_NAMES,
  SIGNAGE_MOUNT_HEIGHT,
  STRUCTURAL_LAYOUT as CAFE_STRUCTURAL_LAYOUT,
  TABLE_SURFACE_HEIGHT,
  WALKABLE_FLOOR_HEIGHT,
  WALL_THICKNESS,
  counterPassSlot,
  counterRect,
  createStructuralLayout,
  createWalls,
  floorRect,
  measureShellEnvelope,
  pointInsideBounds,
  rectsOverlap,
  reservedZone,
  roomBoundsEqual,
  roomBoundsFinite,
  serviceLaneRect,
  shellFloorHeight,
  tableSlot,
  validateLayout,
  wallMountsOf,
  wallSurface,
} from './roomBounds';
export type {
  CounterPassKind,
  CounterPassSlot,
  CounterZone,
  FloorRect,
  ReservedZone,
  ReservedZoneKind,
  ServiceLane,
  ShellNodeKey,
  StructuralLayout,
  TableSlot,
  WallId,
  WallMountPurpose,
  WallMountSurface,
  WallSurface,
} from './roomBounds';

export {
  CEILING_DETAIL_NODE_NAME,
  applyShellEra,
  assignShellMaterials,
  buildShell,
  boxMaterialMesh,
  disposeShell,
  releaseGeometry,
  requireShellNode,
  shellEraSignature,
  shellFootprintFits,
  shellNodeInventory,
  wainscotRuns,
} from './architecture';
export type { ShellBuildOptions, ShellNodes, ShellParts } from './architecture';

export {
  buildStorefront,
  applyStorefrontEra,
  storefrontEraSignature,
  signageBladeWidth,
} from './storefront';
export type { StorefrontBuildOptions, StorefrontParts } from './storefront';

export {
  MATERIAL_SLOTS,
  materialName,
  materialSetMaterials,
  materialSetSignature,
  materialSlot,
  isMaterialSlot,
  createMaterialSet,
  disposeMaterialSet,
} from './materials';
export type { MaterialSet, MaterialSetOptions, MaterialSlot } from './materials';

export {
  DEFAULT_TEXTURE_SIZE,
  FINISH_TEXTURE_PREFIX,
  FONT_GLYPH_HEIGHT,
  FONT_GLYPH_WIDTH,
  PixelBuffer,
  SIGNAGE_TEXTURE_HEIGHT,
  SIGNAGE_TEXTURE_WIDTH,
  createFinishTexture,
  createSignageTexture,
  defaultCanvasFactory,
  drawText,
  hashString,
  isProceduralFinishTexture,
  measureText,
  mixRgb,
  paintSurface,
  parseColor,
  shade,
} from './textures';
export type {
  CanvasFactory,
  FinishTexture,
  FinishTextureOptions,
  GridVariant,
  Rgb,
  SignageTextureOptions,
  TextureKind,
  TexturePalette,
  TextureStyle,
} from './textures';
