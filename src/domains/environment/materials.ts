/**
 * Era material sets for the café shell.
 *
 * A {@link MaterialSet} is the complete, named set of materials one era dresses
 * the shell in: floor, walls, wainscot and cap, ceiling and its secondary
 * structure, tile, counter shell/top/trim/metal, glass, window dressing,
 * awning, signage, doors, the dark back-room void, the street sliver and the
 * emissive lamp stock.
 *
 * Every material in a set is named `env:<year>:<slot>` and carries its era in
 * `userData.environment`, so diagnostics (and the tests) can prove that
 * `applyPeriod` really swapped the palette. Every texture is painted by
 * `./textures` — canvas when the DOM is available, a data texture otherwise —
 * so a set never triggers a network request.
 *
 * Lifecycle: `createMaterialSet` builds a fresh set for an era,
 * `disposeMaterialSet` releases it. The module builds the next set, re-points
 * the shell at it and only then disposes the previous one, so no frame ever
 * references a disposed material.
 */

import * as THREE from 'three';
import type { YearId } from '../../contracts/period';
import {
  ceilingDetailStyle,
  dressingStyle,
  signagePalette,
  surfaceStyle,
  type EnvironmentSpec,
  type SurfaceFinish,
} from './data/years';
import {
  createFinishTexture,
  createSignageTexture,
  type CanvasFactory,
  type TextureStyle,
} from './textures';

/** Every material slot an environment material set carries. */
export const MATERIAL_SLOTS = Object.freeze([
  'floor',
  'wall',
  'wainscot',
  'wainscotCap',
  'ceiling',
  'ceilingDetail',
  'tile',
  'counterBase',
  'counterTop',
  'counterTrim',
  'metal',
  'glass',
  'frame',
  'dressing',
  'awning',
  'signage',
  'blade',
  'door',
  'doorwayFrame',
  'shadow',
  'street',
  'road',
  'kerb',
  'streetFacade',
  'lamp',
  'trim',
] as const);

/** Name of a material slot. */
export type MaterialSlot = (typeof MATERIAL_SLOTS)[number];

/** A complete set of era materials. */
export interface MaterialSet {
  /** `env-material-set:<year>:<spec-material-set-id>`. */
  readonly id: string;
  readonly year: YearId;
  readonly paletteName: string;
  /** The spec's own material set identifier. */
  readonly specMaterialSetId: string;
  readonly slots: Readonly<Record<MaterialSlot, THREE.Material>>;
  /** Every procedural texture the set owns. */
  readonly textures: readonly THREE.Texture[];
  /** Backend used for the set's textures. */
  readonly textureSource: 'canvas' | 'data' | 'mixed';
}

export interface MaterialSetOptions {
  /** Canvas factory used for the procedural maps (defaults to the DOM). */
  readonly canvasFactory?: CanvasFactory;
  /** Texture resolution override. */
  readonly textureSize?: number;
}

/** True when `value` names a material slot. */
export function isMaterialSlot(value: unknown): value is MaterialSlot {
  return typeof value === 'string' && (MATERIAL_SLOTS as readonly string[]).includes(value);
}

/** Canonical name of one material in a set. */
export function materialName(year: YearId, slot: MaterialSlot): string {
  return `env:${year}:${slot}`;
}

/** Reads one slot out of a set. */
export function materialSlot(set: MaterialSet, slot: MaterialSlot): THREE.Material {
  return set.slots[slot];
}

/** Every material in a set, in slot order. */
export function materialSetMaterials(set: MaterialSet): readonly THREE.Material[] {
  return MATERIAL_SLOTS.map((slot) => set.slots[slot]);
}

/** Deterministic signature of a set: identical for identical era material sets. */
export function materialSetSignature(set: MaterialSet): string {
  const parts = MATERIAL_SLOTS.map((slot) => {
    const material = set.slots[slot];
    const map = (material as THREE.MeshStandardMaterial).map;
    return `${slot}=${material.name}${map ? `:${map.name}` : ''}`;
  });
  return [set.id, ...parts].join('|');
}

/* -------------------------------------------------------------------------- */
/* Construction helpers                                                       */
/* -------------------------------------------------------------------------- */

interface BuildState {
  readonly spec: EnvironmentSpec;
  readonly canvasFactory: CanvasFactory | undefined;
  readonly textureSize: number | undefined;
  readonly textures: THREE.Texture[];
  readonly sources: Set<'canvas' | 'data'>;
}

interface MaterialOverrides {
  readonly size?: number;
  readonly side?: THREE.Side;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly color?: THREE.ColorRepresentation;
  readonly emissive?: THREE.ColorRepresentation;
  readonly emissiveIntensity?: number;
  readonly emissiveMap?: boolean;
  readonly roughness?: number;
  readonly metalness?: number;
}

function tagMaterial(
  material: THREE.MeshStandardMaterial,
  state: BuildState,
  slot: MaterialSlot,
  texture: THREE.Texture | null,
  source: 'canvas' | 'data' | null,
): THREE.MeshStandardMaterial {
  material.name = materialName(state.spec.year, slot);
  material.userData = {
    environment: {
      slot,
      year: state.spec.year,
      materialSetId: state.spec.materialSetId,
      paletteName: state.spec.paletteName,
      textureKey: texture?.name ?? null,
      textureSource: source,
      procedural: true,
    },
  };
  return material;
}

function styledMaterial(
  state: BuildState,
  slot: MaterialSlot,
  style: TextureStyle,
  overrides: MaterialOverrides = {},
): THREE.MeshStandardMaterial {
  const finishTexture = createFinishTexture(
    { ...style, size: overrides.size ?? style.size ?? state.textureSize },
    {
      key: `${state.spec.year}:${slot}`,
      canvasFactory: state.canvasFactory,
    },
  );
  state.textures.push(finishTexture.texture);
  state.sources.add(finishTexture.source);
  const material = new THREE.MeshStandardMaterial({
    name: materialName(state.spec.year, slot),
    map: finishTexture.texture,
    color: overrides.color ?? 0xffffff,
    roughness: overrides.roughness ?? 0.7,
    metalness: overrides.metalness ?? 0,
    side: overrides.side ?? THREE.FrontSide,
    transparent: overrides.transparent ?? false,
    opacity: overrides.opacity ?? 1,
    emissive: overrides.emissive ?? 0x000000,
    emissiveIntensity: overrides.emissiveIntensity ?? 1,
    emissiveMap: overrides.emissiveMap ? finishTexture.texture : null,
  });
  return tagMaterial(material, state, slot, finishTexture.texture, finishTexture.source);
}

function finishMaterial(
  state: BuildState,
  slot: MaterialSlot,
  finish: SurfaceFinish,
  overrides: MaterialOverrides = {},
): THREE.MeshStandardMaterial {
  return styledMaterial(state, slot, surfaceStyle(finish, overrides.size), {
    roughness: finish.roughness,
    metalness: finish.metalness,
    ...overrides,
  });
}

function plainMaterial(
  state: BuildState,
  slot: MaterialSlot,
  overrides: MaterialOverrides = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name: materialName(state.spec.year, slot),
    color: overrides.color ?? 0xffffff,
    roughness: overrides.roughness ?? 0.7,
    metalness: overrides.metalness ?? 0,
    side: overrides.side ?? THREE.FrontSide,
    transparent: overrides.transparent ?? false,
    opacity: overrides.opacity ?? 1,
    emissive: overrides.emissive ?? 0x000000,
    emissiveIntensity: overrides.emissiveIntensity ?? 1,
  });
  return tagMaterial(material, state, slot, null, null);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** Builds the era's complete material set (procedural textures, no network). */
export function createMaterialSet(
  spec: EnvironmentSpec,
  options: MaterialSetOptions = {},
): MaterialSet {
  const state: BuildState = {
    spec,
    canvasFactory: options.canvasFactory,
    textureSize: options.textureSize,
    textures: [],
    sources: new Set(),
  };

  const slots = {} as Record<MaterialSlot, THREE.Material>;
  const doubleSide = THREE.DoubleSide;

  /* -- shell surfaces ------------------------------------------------------- */

  slots.floor = finishMaterial(state, 'floor', spec.floor, { side: doubleSide });
  slots.wall = finishMaterial(state, 'wall', spec.wall, { side: doubleSide });
  slots.wainscot = finishMaterial(state, 'wainscot', spec.wainscot.finish, { side: doubleSide });
  slots.wainscotCap = plainMaterial(state, 'wainscotCap', {
    color: spec.wainscot.capColor,
    roughness: 0.42,
    metalness: spec.wainscot.capMetalness,
    side: doubleSide,
  });
  slots.ceiling = finishMaterial(state, 'ceiling', spec.ceiling.finish, { side: doubleSide });
  slots.ceilingDetail = styledMaterial(state, 'ceilingDetail', ceilingDetailStyle(spec.ceiling), {
    roughness: 0.82,
    metalness: spec.ceiling.detailMetalness,
    side: doubleSide,
  });
  slots.trim = plainMaterial(state, 'trim', {
    color: spec.paint.trimBase,
    roughness: 0.5,
    metalness: 0.08,
    side: doubleSide,
  });

  /* -- tiled surfaces ------------------------------------------------------- */

  slots.tile = styledMaterial(
    state,
    'tile',
    {
      kind: 'grid',
      palette: {
        base: spec.tile.base,
        accent: spec.tile.accent,
        detail: spec.tile.grout,
      },
      scale: 6,
      variant: 'tiles',
      repeat: [6, 2],
      contrast: 0.14,
    },
    { roughness: 0.18, metalness: 0.05, side: doubleSide, size: 128 },
  );

  /* -- counter -------------------------------------------------------------- */

  slots.counterBase = finishMaterial(state, 'counterBase', spec.counter.frontPanel);
  slots.counterTop = finishMaterial(state, 'counterTop', spec.counter.top);
  slots.counterTrim = plainMaterial(state, 'counterTrim', {
    color: spec.counter.trimColor,
    roughness: 0.35,
    metalness: spec.counter.trimMetalness,
  });
  slots.metal = plainMaterial(state, 'metal', {
    color: spec.counter.metalColor,
    roughness: spec.counter.metalRoughness,
    metalness: 0.88,
  });

  /* -- storefront ----------------------------------------------------------- */

  slots.glass = plainMaterial(state, 'glass', {
    color: spec.glazing.tint,
    roughness: spec.glazing.glassRoughness,
    metalness: 0.05,
    transparent: true,
    opacity: Math.min(Math.max(spec.glazing.tintOpacity, 0.04), 0.9),
    side: doubleSide,
  });
  slots.frame = plainMaterial(state, 'frame', {
    color: spec.glazing.frameColor,
    roughness: spec.glazing.frameRoughness,
    metalness: spec.glazing.frameMetalness,
    side: doubleSide,
  });
  slots.dressing = styledMaterial(state, 'dressing', dressingStyle(spec.windowDressing), {
    roughness: spec.windowDressing.roughness,
    metalness: 0,
    transparent: true,
    opacity: Math.min(Math.max(spec.windowDressing.opacity, 0.05), 1),
    side: doubleSide,
  });
  slots.awning = styledMaterial(
    state,
    'awning',
    {
      kind: 'stripes',
      palette: {
        base: spec.windowDressing.palette.base,
        accent: spec.windowDressing.palette.accent,
        detail: spec.windowDressing.palette.detail,
        highlight: spec.windowDressing.palette.highlight,
      },
      scale: 6,
      repeat: [6, 1],
      contrast: 0.12,
    },
    { roughness: 0.75, metalness: 0, side: doubleSide },
  );

  /* -- signage -------------------------------------------------------------- */

  const signage = createSignageTexture(spec.signage.lettering, signagePalette(spec), {
    key: `${spec.year}:signage`,
    canvasFactory: options.canvasFactory,
    borderColor: spec.signage.rimColor,
  });
  state.textures.push(signage.texture);
  state.sources.add(signage.source);
  slots.signage = tagMaterial(
    new THREE.MeshStandardMaterial({
      name: materialName(spec.year, 'signage'),
      map: signage.texture,
      roughness: 0.42,
      metalness: 0.12,
      side: doubleSide,
      emissive: spec.signage.lampColor,
      emissiveIntensity: spec.signage.illuminated ? spec.signage.lampIntensity : 0.05,
      emissiveMap: signage.texture,
    }),
    state,
    'signage',
    signage.texture,
    signage.source,
  );
  slots.blade = plainMaterial(state, 'blade', {
    color: spec.signage.bladeColor,
    roughness: 0.5,
    metalness: 0.1,
    side: doubleSide,
  });

  /* -- doors and openings --------------------------------------------------- */

  slots.door = plainMaterial(state, 'door', {
    color: spec.doorway.doorColor,
    roughness: 0.52,
    metalness: 0.05,
    side: doubleSide,
  });
  slots.doorwayFrame = plainMaterial(state, 'doorwayFrame', {
    color: spec.doorway.frameColor,
    roughness: 0.6,
    metalness: 0.12,
  });
  slots.shadow = plainMaterial(state, 'shadow', {
    color: '#0b0a09',
    roughness: 1,
    metalness: 0,
    side: doubleSide,
  });

  /* -- street sliver -------------------------------------------------------- */

  slots.street = finishMaterial(state, 'street', spec.street.pavement, { side: doubleSide });
  slots.road = finishMaterial(state, 'road', spec.street.road, { side: doubleSide });
  slots.kerb = plainMaterial(state, 'kerb', {
    color: spec.street.kerbColor,
    roughness: 0.8,
    metalness: 0.03,
    side: doubleSide,
  });
  slots.streetFacade = finishMaterial(state, 'streetFacade', spec.street.facade, {
    side: doubleSide,
  });

  /* -- emissive stock ------------------------------------------------------- */

  slots.lamp = plainMaterial(state, 'lamp', {
    color: spec.signage.lampColor,
    emissive: spec.signage.lampColor,
    emissiveIntensity: Math.max(spec.signage.lampIntensity, 0.9),
    roughness: 0.35,
    metalness: 0.15,
  });

  const sources = state.sources;
  const textureSource: MaterialSet['textureSource'] =
    sources.size === 0 ? 'data' : sources.size === 1 ? [...sources][0] ?? 'data' : 'mixed';

  return Object.freeze({
    id: `env-material-set:${spec.year}:${spec.materialSetId}`,
    year: spec.year,
    paletteName: spec.paletteName,
    specMaterialSetId: spec.materialSetId,
    slots: Object.freeze(slots),
    textures: Object.freeze([...state.textures]),
    textureSource,
  });
}

/** Releases every texture and material the set owns. Safe to call twice. */
export function disposeMaterialSet(set: MaterialSet | undefined): void {
  if (!set) return;
  for (const texture of set.textures) texture.dispose();
  for (const material of materialSetMaterials(set)) material.dispose();
}
