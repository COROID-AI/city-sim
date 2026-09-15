/**
 * Period-correct frames, mounting hardware and wall wear for the posters.
 *
 * Every poster in the café is fixed to the wall the way its era would have done
 * it, and this module owns that vocabulary:
 *
 *  - {@link PosterMount} — `framed`, `pinned`, `taped` or `unframed`. All four
 *    appear in every era; which one a poster uses is era data.
 *  - {@link FRAME_STYLES} — the frame finishes of the five eras: painted
 *    softwood and civic oak (1945), chrome tube and printed formica board
 *    (1965), gloss black lacquer and a neon tube frame (1985), an aluminium clip
 *    frame and a backlit lightbox (2005), magnetic oak and recycled card (2025).
 *    Each style carries its own rail profile, depth, grain, glass, mat board and
 *    emissive neon tube, so a frame is period-correct by construction.
 *  - {@link mountHardware} / {@link wallWearFor} — where the pins, brass nails,
 *    hanging wire, aged tape strips, bulldog clips and putty dabs sit, and which
 *    ghost rectangle, pin holes, tape residue, scuff or damp patch the wall keeps
 *    behind each sheet.
 *  - {@link PosterMaterialLibrary} — the shared material/texture pool of one
 *    poster build (frames, glass, backing, mat, tubes, hardware, decals), so
 *    eight posters on the wall do not allocate eight copies of the same brass.
 *  - {@link buildPosterAssembly} — the actual mesh assembly of one poster in
 *    local space (paper centred on the origin, facing `+Z`), including the frame
 *    rails, glass, backing, mounting hardware and wall-wear decals behind it.
 *
 * Every texture the library uses comes from `./textures` (procedural canvas /
 * data textures); nothing here fetches an image or a font.
 */

import * as THREE from 'three';
import { createSeededRandom } from '../../core/kernel';
import {
  PosterResources,
  createFrameGrainTexture,
  createHardwareTexture,
  createWallWearTexture,
  hashString,
  parseColor,
  shadeRgb,
  type CanvasFactory,
  type FrameGrainKind,
  type FrameGrainPalette,
  type HardwareTextureKind,
  type PosterTexture,
  type WallWearTextureKind,
} from './textures';
import type { YearId } from '../../contracts/period';

/* -------------------------------------------------------------------------- */
/* Mounting styles                                                            */
/* -------------------------------------------------------------------------- */

/** How a sheet is fixed to the wall. */
export type PosterMount = 'framed' | 'pinned' | 'taped' | 'unframed';

/** Every mount style, in the order the era tables list them. */
export const POSTER_MOUNTS: readonly PosterMount[] = Object.freeze([
  'framed',
  'pinned',
  'taped',
  'unframed',
]);

/** Which mounted parts a style adds. */
export type FrameCorner = 'mitred' | 'butt' | 'bracket';

/** One frame finish: profile, grain, glazing and (for neon/lightbox) emission. */
export interface FrameStyle {
  readonly id: FrameStyleId;
  readonly label: string;
  readonly description: string;
  /** Rail width in metres. */
  readonly rail: number;
  /** How far the frame stands off the wall, in metres. */
  readonly depth: number;
  /** Procedural grain painted onto the rails; `null` for the bare-sheet styles. */
  readonly grain: FrameGrainKind | null;
  readonly palette: FrameGrainPalette;
  readonly roughness: number;
  readonly metalness: number;
  /** A sheet of glass in front of the print. */
  readonly glazed: boolean;
  readonly glassOpacity: number;
  /** A backing board behind the print. */
  readonly backing: boolean;
  /** Mount board visible between the rail and the print. */
  readonly matBoard: { readonly inset: number; readonly color: string } | null;
  readonly corner: FrameCorner;
  /** Neon tube or lightbox emission. */
  readonly emissive: { readonly color: string; readonly intensity: number } | null;
  /** Radius of the neon tube ring, in metres; `0` when the style has no tube. */
  readonly tube: number;
  /** Mount styles this finish may serve. */
  readonly mounts: readonly PosterMount[];
}

/** Frame finishes available across the five eras. */
export type FrameStyleId =
  | 'none'
  | 'painted-softwood'
  | 'civic-oak'
  | 'chrome-tube'
  | 'formica-print'
  | 'gloss-black'
  | 'neon-tube'
  | 'aluminium-clip'
  | 'lightbox'
  | 'oak-magnet'
  | 'recycled-card';

const NONE_FRAME: FrameStyle = Object.freeze({
  id: 'none',
  label: 'No frame',
  description: 'The sheet itself is on the wall: pinned, taped or pasted.',
  rail: 0,
  depth: 0.004,
  grain: null,
  palette: { base: '#d8cdb4', accent: '#a99a7c', highlight: '#f4ecda' },
  roughness: 0.94,
  metalness: 0,
  glazed: false,
  glassOpacity: 0,
  backing: false,
  matBoard: null,
  corner: 'butt',
  emissive: null,
  tube: 0,
  mounts: Object.freeze(['pinned', 'taped', 'unframed'] as const),
});

/** The five eras' frame finishes, keyed by id. */
export const FRAME_STYLES: Readonly<Record<FrameStyleId, FrameStyle>> = Object.freeze({
  none: NONE_FRAME,
  'painted-softwood': Object.freeze({
    id: 'painted-softwood',
    label: 'Painted softwood batten',
    description: 'Narrow batten frame, utility cream paint chipped back to the wood.',
    rail: 0.03,
    depth: 0.034,
    grain: 'chipped-paint',
    palette: { base: '#cec19c', accent: '#7d6d4b', highlight: '#f2e9d2' },
    roughness: 0.86,
    metalness: 0,
    glazed: false,
    glassOpacity: 0,
    backing: true,
    matBoard: null,
    corner: 'butt',
    emissive: null,
    tube: 0,
    mounts: Object.freeze(['framed'] as const),
  }),
  'civic-oak': Object.freeze({
    id: 'civic-oak',
    label: 'Civic oak frame with a cream mount',
    description: 'Mitred oak frame and mount board, hung on brass nails.',
    rail: 0.044,
    depth: 0.04,
    grain: 'oak-veneer',
    palette: { base: '#8b6a3f', accent: '#5b4326', highlight: '#c8a170' },
    roughness: 0.68,
    metalness: 0.04,
    glazed: false,
    glassOpacity: 0,
    backing: true,
    matBoard: Object.freeze({ inset: 0.022, color: '#efe6d2' }),
    corner: 'mitred',
    emissive: null,
    tube: 0,
    mounts: Object.freeze(['framed'] as const),
  }),
  'chrome-tube': Object.freeze({
    id: 'chrome-tube',
    label: 'Chrome tube frame',
    description: 'Slender chrome tube on mitred corners with a sheet of glass.',
    rail: 0.024,
    depth: 0.032,
    grain: 'chrome-streak',
    palette: { base: '#c6cad0', accent: '#7d858e', highlight: '#fbfdff' },
    roughness: 0.24,
    metalness: 0.86,
    glazed: true,
    glassOpacity: 0.07,
    backing: true,
    matBoard: null,
    corner: 'mitred',
    emissive: null,
    tube: 0,
    mounts: Object.freeze(['framed'] as const),
  }),
  'formica-print': Object.freeze({
    id: 'formica-print',
    label: 'Printed formica board',
    description: 'Formica-faced board frame, printed in the era colourways.',
    rail: 0.038,
    depth: 0.03,
    grain: 'printed-board',
    palette: { base: '#1f6f8b', accent: '#e2452f', highlight: '#f6c544' },
    roughness: 0.44,
    metalness: 0.06,
    glazed: false,
    glassOpacity: 0,
    backing: true,
    matBoard: null,
    corner: 'butt',
    emissive: null,
    tube: 0,
    mounts: Object.freeze(['framed'] as const),
  }),
  'gloss-black': Object.freeze({
    id: 'gloss-black',
    label: 'Gloss black lacquer frame',
    description: 'Deep lacquered frame with reflective glass, mid-80s style.',
    rail: 0.05,
    depth: 0.046,
    grain: 'lacquer',
    palette: { base: '#17161b', accent: '#2f2a38', highlight: '#9a94ac' },
    roughness: 0.18,
    metalness: 0.22,
    glazed: true,
    glassOpacity: 0.06,
    backing: true,
    matBoard: null,
    corner: 'mitred',
    emissive: null,
    tube: 0,
    mounts: Object.freeze(['framed'] as const),
  }),
  'neon-tube': Object.freeze({
    id: 'neon-tube',
    label: 'Neon tube frame',
    description: 'Black board with a lit neon tube running around the rail.',
    rail: 0.05,
    depth: 0.052,
    grain: 'lacquer',
    palette: { base: '#0f0e14', accent: '#ff2d95', highlight: '#27e0d0' },
    roughness: 0.2,
    metalness: 0.24,
    glazed: true,
    glassOpacity: 0.05,
    backing: true,
    matBoard: null,
    corner: 'mitred',
    emissive: Object.freeze({ color: '#ff2d95', intensity: 2.6 }),
    tube: 0.014,
    mounts: Object.freeze(['framed'] as const),
  }),
  'aluminium-clip': Object.freeze({
    id: 'aluminium-clip',
    label: 'Brushed aluminium clip frame',
    description: 'Thin brushed aluminium section that clips the print in place.',
    rail: 0.017,
    depth: 0.03,
    grain: 'brushed-steel',
    palette: { base: '#b7babf', accent: '#7f8388', highlight: '#f4f6f8' },
    roughness: 0.34,
    metalness: 0.72,
    glazed: true,
    glassOpacity: 0.04,
    backing: true,
    matBoard: null,
    corner: 'butt',
    emissive: null,
    tube: 0,
    mounts: Object.freeze(['framed'] as const),
  }),
  lightbox: Object.freeze({
    id: 'lightbox',
    label: 'Backlit lightbox frame',
    description: 'Shallow lightbox: the print is lit from behind the acrylic face.',
    rail: 0.03,
    depth: 0.058,
    grain: 'brushed-steel',
    palette: { base: '#1c2026', accent: '#2b7fd4', highlight: '#e8eef4' },
    roughness: 0.3,
    metalness: 0.48,
    glazed: false,
    glassOpacity: 0,
    backing: true,
    matBoard: null,
    corner: 'butt',
    emissive: Object.freeze({ color: '#e8f2ff', intensity: 1.4 }),
    tube: 0,
    mounts: Object.freeze(['framed'] as const),
  }),
  'oak-magnet': Object.freeze({
    id: 'oak-magnet',
    label: 'Magnetic oak frame',
    description: 'Slim oak magnetic frame over an off-white mount board.',
    rail: 0.021,
    depth: 0.03,
    grain: 'oak-veneer',
    palette: { base: '#c8a878', accent: '#8b6a3f', highlight: '#e7d3ad' },
    roughness: 0.6,
    metalness: 0.02,
    glazed: false,
    glassOpacity: 0,
    backing: true,
    matBoard: Object.freeze({ inset: 0.018, color: '#f4efe6' }),
    corner: 'mitred',
    emissive: null,
    tube: 0,
    mounts: Object.freeze(['framed'] as const),
  }),
  'recycled-card': Object.freeze({
    id: 'recycled-card',
    label: 'Recycled card frame',
    description: 'Recycled card frame, unglazed, printed on the reverse of the sheet.',
    rail: 0.026,
    depth: 0.02,
    grain: 'card-stock',
    palette: { base: '#b9a98e', accent: '#8c7a5e', highlight: '#ded2b8' },
    roughness: 0.92,
    metalness: 0,
    glazed: false,
    glassOpacity: 0,
    backing: true,
    matBoard: null,
    corner: 'butt',
    emissive: null,
    tube: 0,
    mounts: Object.freeze(['framed'] as const),
  }),
});

/** Every frame finish, in inventory order. */
export const FRAME_STYLE_IDS: readonly FrameStyleId[] = Object.freeze(
  Object.keys(FRAME_STYLES) as FrameStyleId[],
);

/** Looks up one frame finish. */
export function frameStyle(id: FrameStyleId): FrameStyle {
  return FRAME_STYLES[id];
}

/** Overall size of a mounted poster, frame included. */
export function frameExtents(
  frame: FrameStyleId,
  size: readonly [number, number],
): { readonly width: number; readonly height: number; readonly depth: number } {
  const style = FRAME_STYLES[frame];
  const rail = style.rail;
  return {
    width: size[0] + rail * 2,
    height: size[1] + rail * 2,
    depth: style.depth,
  };
}

/* -------------------------------------------------------------------------- */
/* Mounting hardware                                                          */
/* -------------------------------------------------------------------------- */

/** A fitting a mount uses: a textured plane, or a drawn hanging wire. */
export type HardwareKind = HardwareTextureKind | 'wire';

/** One fitting, positioned in poster-local metres (paper centre is the origin). */
export interface HardwareSpec {
  readonly kind: HardwareKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  /** Rotation about Z (tape tilt, wire angle). */
  readonly rotation: number;
}

/** Half the thickness of the paper stock the hardware sits on. */
const PAPER_HALF_DEPTH = 0.004;

function wireSpec(fromX: number, fromY: number, toX: number, toY: number): HardwareSpec {
  const dx = toX - fromX;
  const dy = toY - fromY;
  return {
    kind: 'wire',
    x: (fromX + toX) / 2,
    y: (fromY + toY) / 2,
    z: -PAPER_HALF_DEPTH - 0.004,
    width: Math.hypot(dx, dy),
    height: 0.004,
    rotation: Math.atan2(dy, dx),
  };
}

/**
 * Fittings for one mount style: brass nails and picture wire for framed sheets,
 * steel pins for pinned notices, aged tape strips for taped handbills and putty
 * dabs for unframed prints. `random` adds the small hand-hung inaccuracy the
 * era would have had.
 */
export function mountHardware(
  mount: PosterMount,
  size: readonly [number, number],
  frame: FrameStyleId,
  random: () => number,
): readonly HardwareSpec[] {
  const halfWidth = size[0] / 2;
  const halfHeight = size[1] / 2;
  const style = FRAME_STYLES[frame];
  const specs: HardwareSpec[] = [];

  switch (mount) {
    case 'framed': {
      const rail = style.rail;
      const nailY = halfHeight + rail + 0.055;
      specs.push({ kind: 'nail', x: 0, y: nailY, z: -0.01, width: 0.016, height: 0.016, rotation: 0 });
      specs.push(wireSpec(0, nailY - 0.004, -halfWidth * 0.55, halfHeight + rail * 0.4));
      specs.push(wireSpec(0, nailY - 0.004, halfWidth * 0.55, halfHeight + rail * 0.4));
      if (style.corner === 'bracket' || (style.matBoard && random() > 0.5)) {
        for (const side of [-1, 1]) {
          specs.push({
            kind: 'putty-dab',
            x: side * halfWidth * 0.86,
            y: -halfHeight * 0.86,
            z: -PAPER_HALF_DEPTH - 0.003,
            width: 0.016,
            height: 0.016,
            rotation: 0,
          });
        }
      }
      break;
    }
    case 'pinned': {
      const corners: readonly (readonly [number, number])[] = [
        [-halfWidth * 0.9, halfHeight * 0.88],
        [halfWidth * 0.9, halfHeight * 0.88],
        [halfWidth * 0.9, -halfHeight * 0.88],
      ];
      corners.forEach(([x, y], index) => {
        specs.push({
          kind: index % 2 === 0 ? 'steel-pin' : 'brass-pin',
          x: x + (random() - 0.5) * 0.006,
          y: y + (random() - 0.5) * 0.006,
          z: PAPER_HALF_DEPTH + 0.002,
          width: 0.011,
          height: 0.011,
          rotation: (random() - 0.5) * 0.35,
        });
      });
      break;
    }
    case 'taped': {
      const tilt = 0.6 + random() * 0.25;
      const positions: readonly (readonly [number, number, number])[] = [
        [-halfWidth * 0.88, halfHeight * 0.92, tilt],
        [halfWidth * 0.88, halfHeight * 0.92, -tilt],
        [-halfWidth * 0.88, -halfHeight * 0.92, -tilt],
        [halfWidth * 0.88, -halfHeight * 0.92, tilt],
      ];
      positions.forEach(([x, y, rotation]) => {
        specs.push({
          kind: 'tape-aged',
          x,
          y,
          z: PAPER_HALF_DEPTH + 0.003,
          width: 0.085,
          height: 0.032,
          rotation,
        });
      });
      break;
    }
    case 'unframed': {
      const corners: readonly (readonly [number, number])[] = [
        [-halfWidth * 0.82, halfHeight * 0.82],
        [halfWidth * 0.82, halfHeight * 0.82],
        [-halfWidth * 0.82, -halfHeight * 0.82],
        [halfWidth * 0.82, -halfHeight * 0.82],
      ];
      corners.forEach(([x, y]) => {
        specs.push({
          kind: 'putty-dab',
          x,
          y,
          z: PAPER_HALF_DEPTH + 0.002,
          width: 0.02,
          height: 0.02,
          rotation: (random() - 0.5) * 1.2,
        });
      });
      break;
    }
  }

  if (mount !== 'framed' && size[1] > 1.05) {
    specs.push({
      kind: 'bulldog-clip',
      x: 0,
      y: halfHeight + 0.012,
      z: PAPER_HALF_DEPTH + 0.002,
      width: 0.026,
      height: 0.032,
      rotation: 0,
    });
  }

  return specs;
}

/* -------------------------------------------------------------------------- */
/* Wall wear                                                                  */
/* -------------------------------------------------------------------------- */

/** One wear decal behind (or around) a mounted sheet. */
export interface WallWearSpec {
  readonly kind: WallWearTextureKind;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly opacity: number;
}

/** Extra wall damage each era's room has to live with. */
const ERA_WEAR: Readonly<Record<YearId, WallWearTextureKind>> = Object.freeze({
  '1945': 'damp-patch',
  '1965': 'scuff',
  '1985': 'tape-residue',
  '2005': 'scuff',
  '2025': 'pin-holes',
});

/**
 * Decals the wall keeps where a sheet has hung: a sun-bleached ghost rectangle,
 * the pin holes, the tape residue, a blot of damp or a scuff. Heavier wear and
 * older eras add their own damage.
 */
export function wallWearFor(
  mount: PosterMount,
  size: readonly [number, number],
  frame: FrameStyleId,
  wear: number,
  year: YearId,
): readonly WallWearSpec[] {
  const extents = frameExtents(frame, size);
  const margin = 0.05;
  const specs: WallWearSpec[] = [];

  const ghost: WallWearSpec = {
    kind: 'ghost',
    width: extents.width + margin,
    height: extents.height + margin,
    x: 0,
    y: 0,
    z: -PAPER_HALF_DEPTH - 0.006,
    opacity: 0.42 + wear * 0.28,
  };
  specs.push(ghost);

  switch (mount) {
    case 'framed':
      break;
    case 'pinned':
      specs.push({
        kind: 'pin-holes',
        width: size[0] + 0.04,
        height: size[1] + 0.04,
        x: 0,
        y: 0,
        z: -PAPER_HALF_DEPTH - 0.005,
        opacity: 0.5 + wear * 0.3,
      });
      break;
    case 'taped':
      specs.push({
        kind: 'tape-residue',
        width: Math.max(size[0] + 0.16, 0.3),
        height: size[1] + 0.08,
        x: 0,
        y: 0,
        z: -PAPER_HALF_DEPTH - 0.005,
        opacity: 0.48 + wear * 0.3,
      });
      break;
    case 'unframed':
      specs.push({
        kind: 'sheet-shadow',
        width: size[0] + 0.05,
        height: size[1] + 0.05,
        x: -0.012,
        y: -0.012,
        z: -PAPER_HALF_DEPTH - 0.005,
        opacity: 0.6,
      });
      break;
  }

  const eraDamage = ERA_WEAR[year];
  if (wear > 0.45 && !specs.some((spec) => spec.kind === eraDamage)) {
    specs.push({
      kind: eraDamage,
      width: Math.min(size[0] * 1.4, 0.55),
      height: Math.min(size[1] * 1.1, 0.5),
      x: size[0] * 0.24,
      y: -size[1] * 0.3,
      z: -PAPER_HALF_DEPTH - 0.007,
      opacity: 0.28 + wear * 0.24,
    });
  }

  return specs;
}

/* -------------------------------------------------------------------------- */
/* Material pool                                                              */
/* -------------------------------------------------------------------------- */

export interface PosterMaterialLibraryOptions {
  readonly resources: PosterResources;
  readonly canvasFactory?: CanvasFactory;
  readonly anisotropy?: number;
}

/**
 * Shared materials and textures of one poster build. Frames of the same finish,
 * glass, backing, hardware fittings and decals are allocated once per build and
 * released together by the build's {@link PosterResources}.
 */
export class PosterMaterialLibrary {
  private readonly options: PosterMaterialLibraryOptions;
  private readonly frameMaterials = new Map<FrameStyleId, THREE.MeshStandardMaterial>();
  private readonly glassMaterials = new Map<FrameStyleId, THREE.MeshStandardMaterial>();
  private readonly backingMaterials = new Map<FrameStyleId, THREE.MeshStandardMaterial>();
  private readonly matMaterials = new Map<FrameStyleId, THREE.MeshStandardMaterial>();
  private readonly tubeMaterials = new Map<FrameStyleId, THREE.MeshStandardMaterial>();
  private readonly hardwareMaterials = new Map<HardwareKind, THREE.MeshStandardMaterial>();
  private readonly wearMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private textureCount = 0;

  constructor(options: PosterMaterialLibraryOptions) {
    this.options = options;
  }

  private get resources(): PosterResources {
    return this.options.resources;
  }

  private grainTexture(style: FrameStyle, key: string): THREE.Texture {
    const painted = createFrameGrainTexture(style.grain ?? 'card-stock', style.palette, {
      canvasFactory: this.options.canvasFactory,
      key: `${key}:${style.id}`,
      repeat: [2, 1],
    });
    this.resources.ownTexture(painted.texture);
    this.textureCount += 1;
    return painted.texture;
  }

  /** Rail material of a frame finish. */
  frame(id: FrameStyleId): THREE.MeshStandardMaterial | null {
    const style = FRAME_STYLES[id];
    if (id === 'none') return null;
    const existing = this.frameMaterials.get(id);
    if (existing) return existing;
    const map = this.grainTexture(style, 'frame-grain');
    const material = this.resources.ownMaterial(
      new THREE.MeshStandardMaterial({
        name: `poster-frame:${id}`,
        map,
        color: 0xffffff,
        roughness: style.roughness,
        metalness: style.metalness,
      }),
    );
    this.frameMaterials.set(id, material);
    return material;
  }

  /** Glazing in front of the print. */
  glass(id: FrameStyleId): THREE.MeshStandardMaterial | null {
    const style = FRAME_STYLES[id];
    if (!style.glazed) return null;
    const existing = this.glassMaterials.get(id);
    if (existing) return existing;
    const material = this.resources.ownMaterial(
      new THREE.MeshStandardMaterial({
        name: `poster-glass:${id}`,
        color: 0xdfe7ee,
        transparent: true,
        opacity: style.glassOpacity,
        roughness: 0.06,
        metalness: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.glassMaterials.set(id, material);
    return material;
  }

  /** Backing board behind the print. */
  backing(id: FrameStyleId): THREE.MeshStandardMaterial | null {
    const style = FRAME_STYLES[id];
    if (!style.backing) return null;
    const existing = this.backingMaterials.get(id);
    if (existing) return existing;
    const base = parseColor(style.palette.base);
    const material = this.resources.ownMaterial(
      new THREE.MeshStandardMaterial({
        name: `poster-backing:${id}`,
        color: new THREE.Color(shadeRgb(base, 0.7).r / 255, shadeRgb(base, 0.7).g / 255, shadeRgb(base, 0.7).b / 255),
        roughness: 0.95,
        metalness: 0,
      }),
    );
    this.backingMaterials.set(id, material);
    return material;
  }

  /** Mount board visible between rail and print. */
  mat(id: FrameStyleId): THREE.MeshStandardMaterial | null {
    const style = FRAME_STYLES[id];
    if (!style.matBoard) return null;
    const existing = this.matMaterials.get(id);
    if (existing) return existing;
    const colour = parseColor(style.matBoard.color);
    const material = this.resources.ownMaterial(
      new THREE.MeshStandardMaterial({
        name: `poster-mat:${id}`,
        color: new THREE.Color(colour.r / 255, colour.g / 255, colour.b / 255),
        roughness: 0.88,
        metalness: 0,
      }),
    );
    this.matMaterials.set(id, material);
    return material;
  }

  /** Neon tube / lightbox emission. */
  tube(id: FrameStyleId): THREE.MeshStandardMaterial | null {
    const style = FRAME_STYLES[id];
    if (!style.emissive) return null;
    const existing = this.tubeMaterials.get(id);
    if (existing) return existing;
    const colour = parseColor(style.emissive.color);
    const material = this.resources.ownMaterial(
      new THREE.MeshStandardMaterial({
        name: `poster-tube:${id}`,
        color: new THREE.Color(colour.r / 255, colour.g / 255, colour.b / 255),
        emissive: new THREE.Color(colour.r / 255, colour.g / 255, colour.b / 255),
        emissiveIntensity: style.emissive.intensity,
        roughness: 0.3,
        metalness: 0.1,
      }),
    );
    this.tubeMaterials.set(id, material);
    return material;
  }

  /** Metal or plastic fitting material (also used for the drawn hanging wire). */
  hardware(kind: HardwareKind): THREE.MeshStandardMaterial {
    const existing = this.hardwareMaterials.get(kind);
    if (existing) return existing;
    const plain = kind === 'wire';
    const painted = plain
      ? null
      : createHardwareTexture(kind, {
          canvasFactory: this.options.canvasFactory,
          key: `hardware:${kind}`,
        });
    if (painted) {
      this.resources.ownTexture(painted.texture);
      this.textureCount += 1;
    }
    const metalness = plain || kind.includes('pin') || kind === 'nail' || kind === 'bulldog-clip' ? 0.7 : 0.2;
    const material = this.resources.ownMaterial(
      new THREE.MeshStandardMaterial({
        name: `poster-hardware:${kind}`,
        color: plain ? 0x8d9296 : 0xffffff,
        map: painted?.texture ?? null,
        transparent: !plain,
        alphaTest: plain ? 0 : 0.05,
        roughness: plain ? 0.55 : 0.4,
        metalness,
        side: plain ? THREE.FrontSide : THREE.DoubleSide,
      }),
    );
    this.hardwareMaterials.set(kind, material);
    return material;
  }

  /** Wall wear decal material (alpha decal, lifted slightly off the wall). */
  wallWear(kind: WallWearTextureKind, paper: string, opacity: number): THREE.MeshStandardMaterial {
    const rounded = Math.round(opacity * 20) / 20;
    const key = `${kind}|${paper}|${rounded.toFixed(2)}`;
    const existing = this.wearMaterials.get(key);
    if (existing) return existing;
    const painted = createWallWearTexture(kind, {
      canvasFactory: this.options.canvasFactory,
      key: `wear:${kind}:${paper}`,
      paper,
    });
    this.resources.ownTexture(painted.texture);
    this.textureCount += 1;
    const material = this.resources.ownMaterial(
      new THREE.MeshStandardMaterial({
        name: `poster-wear:${key}`,
        map: painted.texture,
        transparent: true,
        opacity: rounded,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.wearMaterials.set(key, material);
    return material;
  }

  /** Materials and textures the pool has created so far. */
  get counts(): { readonly materials: number; readonly textures: number } {
    return {
      materials:
        this.frameMaterials.size +
        this.glassMaterials.size +
        this.backingMaterials.size +
        this.matMaterials.size +
        this.tubeMaterials.size +
        this.hardwareMaterials.size +
        this.wearMaterials.size,
      textures: this.textureCount,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Poster assembly                                                            */
/* -------------------------------------------------------------------------- */

export interface PosterAssemblyOptions {
  /** Painted poster face (procedural canvas or data texture). */
  readonly face: PosterTexture;
  /** Physical paper size in metres. */
  readonly size: readonly [number, number];
  readonly mount: PosterMount;
  readonly frame: FrameStyleId;
  /** Wall wear of this sheet, 0..1. */
  readonly wear: number;
  readonly year: YearId;
  /** Wall colour the decals are tinted against. */
  readonly wallColour: string;
  /** Deterministic seed for the hand-hung jitter. */
  readonly seed: number;
  readonly materials: PosterMaterialLibrary;
  readonly resources: PosterResources;
  /** Node name of the assembly group (`poster-<id>`). */
  readonly name: string;
}

/** One assembled poster: the group plus what went into it. */
export interface PosterAssembly {
  /** Local space: paper centred on the origin, artwork facing `+Z`. */
  readonly group: THREE.Group;
  readonly face: THREE.Mesh;
  readonly frameParts: number;
  readonly hardwareParts: number;
  readonly wearParts: number;
  readonly mount: PosterMount;
  readonly frame: FrameStyleId;
  readonly materials: readonly THREE.Material[];
  /** Materials whose emission {@link PosterModule.update} animates. */
  readonly litMaterials: readonly THREE.MeshStandardMaterial[];
}

function addBox(
  resources: PosterResources,
  parent: THREE.Object3D,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const geometry = resources.ownGeometry(new THREE.BoxGeometry(size[0], size[1], size[2]));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function addPlane(
  resources: PosterResources,
  parent: THREE.Object3D,
  width: number,
  height: number,
  position: readonly [number, number, number],
  material: THREE.Material,
  name: string,
  rotation = 0,
): THREE.Mesh {
  const geometry = resources.ownGeometry(new THREE.PlaneGeometry(width, height));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.z = rotation;
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

/**
 * Builds one mounted poster in local space: the paper face, its era frame (rails,
 * glass, mount board, backing and neon tube where the finish has one), the
 * mounting hardware and the wall-wear decals the sheet leaves behind.
 */
export function buildPosterAssembly(options: PosterAssemblyOptions): PosterAssembly {
  const { resources, materials } = options;
  const [width, height] = options.size;
  const style = FRAME_STYLES[options.frame];
  const random = createSeededRandom(hashString(`${options.name}:${options.seed}`));
  const group = new THREE.Group();
  group.name = options.name;

  const faceMaterial = resources.ownMaterial(
    new THREE.MeshStandardMaterial({
      name: `poster-face:${options.face.key}`,
      map: options.face.texture,
      roughness: 0.9,
      metalness: 0,
      emissiveMap: style.emissive && !style.glazed ? options.face.texture : null,
      emissive: style.emissive && !style.glazed ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
      emissiveIntensity: style.emissive && !style.glazed ? 0.22 : 0,
    }),
  );
  const face = addPlane(resources, group, width, height, [0, 0, 0], faceMaterial, 'poster-face');

  const owned: THREE.Material[] = [faceMaterial];
  const litMaterials: THREE.MeshStandardMaterial[] = [];
  let frameParts = 0;

  const frameMaterial = materials.frame(options.frame);
  if (frameMaterial && style.rail > 0) {
    owned.push(frameMaterial);
    const rail = style.rail;
    const depth = style.depth;
    const totalWidth = width + rail * 2;
    const totalHeight = height + rail * 2;
    const z = depth / 2;

    addBox(resources, group, [totalWidth, rail, depth], [0, height / 2 + rail / 2, z], frameMaterial, 'frame-rail-top');
    addBox(resources, group, [totalWidth, rail, depth], [0, -height / 2 - rail / 2, z], frameMaterial, 'frame-rail-bottom');
    addBox(resources, group, [rail, height, depth], [-width / 2 - rail / 2, 0, z], frameMaterial, 'frame-rail-left');
    addBox(resources, group, [rail, height, depth], [width / 2 + rail / 2, 0, z], frameMaterial, 'frame-rail-right');
    frameParts += 4;

    if (style.corner === 'bracket') {
      const bracket = materials.hardware('nail');
      owned.push(bracket);
      for (const sideX of [-1, 1]) {
        for (const sideY of [-1, 1]) {
          addBox(
            resources,
            group,
            [rail * 0.9, rail * 0.9, depth * 0.4],
            [sideX * (width / 2 + rail / 2), sideY * (height / 2 + rail / 2), depth + 0.002],
            bracket,
            'frame-corner-bracket',
          );
          frameParts += 1;
        }
      }
    }

    const matMaterial = materials.mat(options.frame);
    if (matMaterial && style.matBoard) {
      owned.push(matMaterial);
      const inset = style.matBoard.inset;
      const matDepth = 0.003;
      const zMat = -matDepth;
      addBox(resources, group, [width, inset, matDepth], [0, height / 2 - inset / 2, zMat], matMaterial, 'frame-mat-top');
      addBox(resources, group, [width, inset, matDepth], [0, -height / 2 + inset / 2, zMat], matMaterial, 'frame-mat-bottom');
      addBox(resources, group, [inset, height, matDepth], [-width / 2 + inset / 2, 0, zMat], matMaterial, 'frame-mat-left');
      addBox(resources, group, [inset, height, matDepth], [width / 2 - inset / 2, 0, zMat], matMaterial, 'frame-mat-right');
      frameParts += 4;
    }

    const backingMaterial = materials.backing(options.frame);
    if (backingMaterial) {
      owned.push(backingMaterial);
      addBox(
        resources,
        group,
        [totalWidth - 0.004, totalHeight - 0.004, 0.006],
        [0, 0, -0.007],
        backingMaterial,
        'frame-backing-board',
      );
      frameParts += 1;
    }

    const glassMaterial = materials.glass(options.frame);
    if (glassMaterial) {
      owned.push(glassMaterial);
      addPlane(resources, group, width, height, [0, 0, 0.014], glassMaterial, 'frame-glass');
      frameParts += 1;
    }

    const tubeMaterial = materials.tube(options.frame);
    if (tubeMaterial && style.tube > 0) {
      owned.push(tubeMaterial);
      litMaterials.push(tubeMaterial);
      const tubeLength = totalWidth + style.tube * 2;
      const sideLength = totalHeight + style.tube * 2;
      const tubeZ = style.depth + style.tube * 0.6;
      for (const sideY of [-1, 1]) {
        const geometry = resources.ownGeometry(
          new THREE.CylinderGeometry(style.tube, style.tube, tubeLength, 8, 1),
        );
        const mesh = new THREE.Mesh(geometry, tubeMaterial);
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(0, sideY * (height / 2 + style.rail / 2), tubeZ);
        mesh.name = 'frame-neon-tube-horizontal';
        group.add(mesh);
        frameParts += 1;
      }
      for (const sideX of [-1, 1]) {
        const geometry = resources.ownGeometry(
          new THREE.CylinderGeometry(style.tube, style.tube, sideLength, 8, 1),
        );
        const mesh = new THREE.Mesh(geometry, tubeMaterial);
        mesh.position.set(sideX * (width / 2 + style.rail / 2), 0, tubeZ);
        mesh.name = 'frame-neon-tube-vertical';
        group.add(mesh);
        frameParts += 1;
      }
    }
  }

  const hardwareGroup = new THREE.Group();
  hardwareGroup.name = 'poster-hardware';
  const hardware = mountHardware(options.mount, options.size, options.frame, random);
  for (const spec of hardware) {
    const material = materials.hardware(spec.kind);
    if (!owned.includes(material)) owned.push(material);
    if (spec.kind === 'wire') {
      addBox(
        resources,
        hardwareGroup,
        [spec.width, 0.0035, 0.0035],
        [spec.x, spec.y, spec.z],
        material,
        'hardware-wire',
      ).rotation.z = spec.rotation;
      continue;
    }
    addPlane(
      resources,
      hardwareGroup,
      spec.width,
      spec.height,
      [spec.x, spec.y, spec.z],
      material,
      `hardware-${spec.kind}`,
      spec.rotation,
    );
  }
  group.add(hardwareGroup);

  const wearGroup = new THREE.Group();
  wearGroup.name = 'poster-wear';
  const wear = wallWearFor(options.mount, options.size, options.frame, options.wear, options.year);
  for (const spec of wear) {
    const material = materials.wallWear(spec.kind, options.wallColour, spec.opacity);
    if (!owned.includes(material)) owned.push(material);
    addPlane(
      resources,
      wearGroup,
      spec.width,
      spec.height,
      [spec.x, spec.y, spec.z],
      material,
      `wall-wear-${spec.kind}`,
    );
  }
  group.add(wearGroup);

  return {
    group,
    face,
    frameParts,
    hardwareParts: hardware.length,
    wearParts: wear.length,
    mount: options.mount,
    frame: options.frame,
    materials: owned,
    litMaterials,
  };
}

/** Detaches an assembly group from its parent (used when the era changes). */
export function detachPosterAssembly(assembly: PosterAssembly): void {
  assembly.group.removeFromParent();
  assembly.group.clear();
}
