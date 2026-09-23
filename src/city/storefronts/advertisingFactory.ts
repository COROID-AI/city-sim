/**
 * Chrono City — era advertising media around the block: blade signs, transom ad
 * strips and freestanding sidewalk billboards.
 *
 * Advertising is split out from the shopfront factory because it answers a
 * different question: not "what does this shop sell" but "what is the street
 * shouting at you this decade".
 *
 *   * **1945** — hand-painted hanging boards, a painted transom strip and a paper
 *     hoarding pasted with newsprint bills.
 *   * **1965** — neon blades, backlit transom boxes and a lamp-lit billboard.
 *   * **1985** — chasing-bulb blades, backlit lightboxes and a backlit billboard.
 *   * **2005** — corporate backlit blades, printed price strips and a
 *     video-screen billboard walking a baked reel.
 *   * **2025** — holographic blades, LED ticker strips, an LED billboard and
 *     holographic columns.
 *
 * Wall slots (blade + transom) live inside the `0–4 m` storefront band and are
 * tagged `signage`; freestanding kerb media stands on the sidewalk beyond the
 * building line and is tagged `billboard`, so the boundary audit can tell the two
 * apart (see `BAND_ROLES` / `SIDEWALK_ROLES`).
 *
 * Lifecycle:
 *   create    → `planAdvertising(plan, random)` returns slots per lot;
 *               `buildAdvertisement({ plan, ..., media })` builds one slot.
 *   consume   → `StorefrontsApi` plans, textures, ticks and disposes the media.
 *   integrate → wired into the app by the era-transition integration task.
 */

import * as THREE from 'three';

import type { EraId } from '../../core/eraContracts';
import type { RandomSource } from '../../core/sceneContext';
import { getEraDescriptor } from '../../era/eraDescriptors';
import type { DetailGeometrySet } from '../buildings/buildingFactory';
import {
  StorefrontBatcher,
  type ShopfrontPlan,
  type StorefrontMaterialSet,
} from './storefrontFactory';
import {
  type SignFaceSpec,
  type SignMaterialHandle,
  type SignMedia,
  type SignTextBlock,
} from './signTextures';

export const ADVERTISING_FACTORY_VERSION = 1;

/* ------------------------------------------------------------------------- *
 * Media classes
 * ------------------------------------------------------------------------- */

/** Coarse advertising technology buckets used for HUD copy and media audits. */
export type MediaClass =
  | 'painted'
  | 'paper'
  | 'neon'
  | 'backlit'
  | 'print'
  | 'video'
  | 'led'
  | 'hologram';

/** Every media class, in the order they are documented. */
export const MEDIA_CLASSES: readonly MediaClass[] = Object.freeze([
  'painted',
  'paper',
  'neon',
  'backlit',
  'print',
  'video',
  'led',
  'hologram',
]);

/** Which bucket a sign medium belongs to. */
export function mediaClass(media: SignMedia): MediaClass {
  switch (media) {
    case 'painted':
    case 'enamel':
      return 'painted';
    case 'paper':
      return 'paper';
    case 'neon':
    case 'bulbMarquee':
      return 'neon';
    case 'backlit':
      return 'backlit';
    case 'print':
      return 'print';
    case 'video':
      return 'video';
    case 'led':
      return 'led';
    default:
      return 'hologram';
  }
}

/** A zeroed class tally. */
export function createMediaProfile(): Record<MediaClass, number> {
  return { painted: 0, paper: 0, neon: 0, backlit: 0, print: 0, video: 0, led: 0, hologram: 0 };
}

/** `true` when a bucket emits its own light (used for "does it glow" audits). */
export function isEmissiveClass(mediaClass: MediaClass): boolean {
  return mediaClass === 'neon' || mediaClass === 'backlit' || mediaClass === 'led' || mediaClass === 'hologram';
}

/* ------------------------------------------------------------------------- *
 * Ad planning
 * ------------------------------------------------------------------------- */

/** Where an advertisement hangs. */
export type AdSlot = 'blade' | 'transom' | 'kerb';

/** The concrete advertising formats this factory can build. */
export type AdKind =
  | 'hangingSign'
  | 'neonBlade'
  | 'bulbBlade'
  | 'backlitBlade'
  | 'hologramBlade'
  | 'paperTransom'
  | 'lightboxTransom'
  | 'printTransom'
  | 'ledTicker'
  | 'paperHoard'
  | 'billboard'
  | 'backlitBillboard'
  | 'videoBillboard'
  | 'ledBillboard'
  | 'hologramColumn'
  | 'busShelterPoster';

/** Geometry + hardware recipe for one advertising format. */
export interface AdKindSpec {
  readonly kind: AdKind;
  readonly slot: AdSlot;
  readonly media: SignMedia;
  /** Face width in metres. */
  readonly faceWidth: number;
  /** Face height in metres. */
  readonly faceHeight: number;
  /** Bottom edge of the face, in metres (lot-local). */
  readonly baseY: number;
  /** Depth of the sign body / structure. */
  readonly depth: number;
  /** Lot-local `z` of the face. */
  readonly z: number;
  /** Vertical support posts. */
  readonly posts: number;
  readonly structure: 'wall' | 'posts' | 'case' | 'column' | 'cantilever';
  readonly animation: boolean;
  readonly lit: boolean;
}

/** Authored advertising formats. */
export const AD_KIND_SPECS: Readonly<Record<AdKind, AdKindSpec>> = Object.freeze({
  hangingSign: {
    kind: 'hangingSign',
    slot: 'blade',
    media: 'painted',
    faceWidth: 1.05,
    faceHeight: 0.72,
    baseY: 3.02,
    depth: 0.13,
    z: 0.42,
    posts: 0,
    structure: 'cantilever',
    animation: false,
    lit: false,
  },
  neonBlade: {
    kind: 'neonBlade',
    slot: 'blade',
    media: 'neon',
    faceWidth: 1.15,
    faceHeight: 0.8,
    baseY: 3.0,
    depth: 0.14,
    z: 0.44,
    posts: 0,
    structure: 'cantilever',
    animation: true,
    lit: true,
  },
  bulbBlade: {
    kind: 'bulbBlade',
    slot: 'blade',
    media: 'bulbMarquee',
    faceWidth: 1.2,
    faceHeight: 0.82,
    baseY: 2.98,
    depth: 0.16,
    z: 0.46,
    posts: 0,
    structure: 'cantilever',
    animation: true,
    lit: true,
  },
  backlitBlade: {
    kind: 'backlitBlade',
    slot: 'blade',
    media: 'backlit',
    faceWidth: 1.1,
    faceHeight: 0.74,
    baseY: 3.0,
    depth: 0.12,
    z: 0.44,
    posts: 0,
    structure: 'cantilever',
    animation: true,
    lit: true,
  },
  hologramBlade: {
    kind: 'hologramBlade',
    slot: 'blade',
    media: 'hologram',
    faceWidth: 1.15,
    faceHeight: 0.78,
    baseY: 3.02,
    depth: 0.06,
    z: 0.5,
    posts: 0,
    structure: 'cantilever',
    animation: true,
    lit: true,
  },
  paperTransom: {
    kind: 'paperTransom',
    slot: 'transom',
    media: 'paper',
    faceWidth: 5.4,
    faceHeight: 0.4,
    baseY: 2.64,
    depth: 0.05,
    z: 0.42,
    posts: 0,
    structure: 'wall',
    animation: false,
    lit: false,
  },
  lightboxTransom: {
    kind: 'lightboxTransom',
    slot: 'transom',
    media: 'backlit',
    faceWidth: 5.6,
    faceHeight: 0.4,
    baseY: 2.64,
    depth: 0.14,
    z: 0.44,
    posts: 0,
    structure: 'wall',
    animation: true,
    lit: true,
  },
  printTransom: {
    kind: 'printTransom',
    slot: 'transom',
    media: 'print',
    faceWidth: 5.4,
    faceHeight: 0.42,
    baseY: 2.63,
    depth: 0.06,
    z: 0.42,
    posts: 0,
    structure: 'wall',
    animation: false,
    lit: false,
  },
  ledTicker: {
    kind: 'ledTicker',
    slot: 'transom',
    media: 'led',
    faceWidth: 5.8,
    faceHeight: 0.36,
    baseY: 2.66,
    depth: 0.08,
    z: 0.46,
    posts: 0,
    structure: 'wall',
    animation: true,
    lit: true,
  },
  paperHoard: {
    kind: 'paperHoard',
    slot: 'kerb',
    media: 'paper',
    faceWidth: 3.2,
    faceHeight: 1.15,
    baseY: 0.62,
    depth: 0.09,
    z: 2.24,
    posts: 2,
    structure: 'posts',
    animation: false,
    lit: false,
  },
  billboard: {
    kind: 'billboard',
    slot: 'kerb',
    media: 'backlit',
    faceWidth: 3.6,
    faceHeight: 1.45,
    baseY: 2.05,
    depth: 0.16,
    z: 2.3,
    posts: 2,
    structure: 'posts',
    animation: true,
    lit: true,
  },
  backlitBillboard: {
    kind: 'backlitBillboard',
    slot: 'kerb',
    media: 'backlit',
    faceWidth: 3.6,
    faceHeight: 1.5,
    baseY: 2.15,
    depth: 0.24,
    z: 2.32,
    posts: 2,
    structure: 'posts',
    animation: true,
    lit: true,
  },
  videoBillboard: {
    kind: 'videoBillboard',
    slot: 'kerb',
    media: 'video',
    faceWidth: 3.4,
    faceHeight: 1.55,
    baseY: 2.2,
    depth: 0.3,
    z: 2.34,
    posts: 2,
    structure: 'posts',
    animation: true,
    lit: true,
  },
  ledBillboard: {
    kind: 'ledBillboard',
    slot: 'kerb',
    media: 'led',
    faceWidth: 3.5,
    faceHeight: 1.9,
    baseY: 2.35,
    depth: 0.22,
    z: 2.34,
    posts: 2,
    structure: 'posts',
    animation: true,
    lit: true,
  },
  hologramColumn: {
    kind: 'hologramColumn',
    slot: 'kerb',
    media: 'hologram',
    faceWidth: 1.15,
    faceHeight: 1.7,
    baseY: 1.15,
    depth: 0.1,
    z: 2.5,
    posts: 0,
    structure: 'column',
    animation: true,
    lit: true,
  },
  busShelterPoster: {
    kind: 'busShelterPoster',
    slot: 'kerb',
    media: 'print',
    faceWidth: 1.2,
    faceHeight: 1.8,
    baseY: 0.6,
    depth: 0.14,
    z: 2.2,
    posts: 0,
    structure: 'case',
    animation: false,
    lit: false,
  },
});

/** Which advertising formats each era uses, by slot. */
export const ERA_AD_KINDS: Readonly<
  Record<EraId, Readonly<{ blade: AdKind; transom: AdKind; kerb: AdKind }>>
> = Object.freeze({
  '1945': { blade: 'hangingSign', transom: 'paperTransom', kerb: 'paperHoard' },
  '1965': { blade: 'neonBlade', transom: 'lightboxTransom', kerb: 'billboard' },
  '1985': { blade: 'bulbBlade', transom: 'lightboxTransom', kerb: 'backlitBillboard' },
  '2005': { blade: 'backlitBlade', transom: 'printTransom', kerb: 'videoBillboard' },
  '2025': { blade: 'hologramBlade', transom: 'ledTicker', kerb: 'ledBillboard' },
});

/** Era-appropriate advertisers, used as the "seller" line on ad copy. */
export const ERA_ADVERTISERS: Readonly<Record<EraId, readonly string[]>> = Object.freeze({
  '1945': Object.freeze([
    'Ministry of Food',
    'Bryant & May',
    'Pearl Assurance',
    'National Savings',
    'Bovril',
    'Gas, Light & Coke Co.',
  ]),
  '1965': Object.freeze([
    'Coca-Cola',
    'Ford Motor Co.',
    'Pan American',
    'Hoover',
    'Evinrude Outboards',
    'Blue Circle Cement',
  ]),
  '1985': Object.freeze([
    'Sony Trinitron',
    'Blockbuster Video',
    'Atari Systems',
    'Reebok',
    'Maxell Tape',
    'Coca-Cola',
  ]),
  '2005': Object.freeze([
    'Nokia',
    'Vodafone Live',
    'Intel Inside',
    'Toyota Hybrid',
    'HSBC',
    'Amazon.co.uk',
  ]),
  '2025': Object.freeze([
    'Cloudline',
    'Nova Motors',
    'Streamly',
    'Aether Studio',
    'Kite Energy',
    'Northwind Foods',
  ]),
});

/** One advertisement's copy, resolved from the era's slogans + advertisers. */
export interface AdCopy {
  readonly headline: string;
  readonly subline: string;
  readonly seller: string;
}

/** Per-era strapline used as the second line of ad copy. */
const ERA_STRAPLINES: Readonly<Record<EraId, readonly string[]>> = Object.freeze({
  '1945': Object.freeze([
    'Buy war bonds — build for peace',
    'Ration books accepted here',
    'Repair it, don’t replace it',
  ]),
  '1965': Object.freeze([
    'Ice cold, everywhere you go',
    'Powered by the space age',
    'Let the good times roll',
  ]),
  '1985': Object.freeze([
    'Now on VHS and cassette',
    'Grab life by the joystick',
    'You’ll never watch alone',
  ]),
  '2005': Object.freeze([
    'Unlimited evenings and weekends',
    'Order online, collect in store',
    'Broadband-fast downloads',
  ]),
  '2025': Object.freeze([
    'Stream it anywhere, instantly',
    'Carbon neutral by design',
    'Tap once, delivered tonight',
  ]),
});

/** Builds era-appropriate advertising copy for one creative slot. */
export function createAdCopy(era: EraId, slot: number): AdCopy {
  const descriptor = getEraDescriptor(era);
  const slogans = descriptor.signage.slogans;
  const advertisers = ERA_ADVERTISERS[descriptor.id] ?? ERA_ADVERTISERS['2025'];
  const straplines = ERA_STRAPLINES[descriptor.id] ?? ERA_STRAPLINES['2025'];
  const index = Math.abs(Math.round(slot));
  return Object.freeze({
    headline: slogans[index % slogans.length] as string,
    subline: straplines[index % straplines.length] as string,
    seller: advertisers[index % advertisers.length] as string,
  });
}

/** One planned advertisement on one lot. */
export interface AdvertisementPlan {
  readonly id: string;
  readonly lotId: string;
  readonly era: EraId;
  readonly slot: AdSlot;
  readonly kind: AdKind;
  readonly media: SignMedia;
  readonly copy: AdCopy;
  /** Face size in metres. */
  readonly width: number;
  readonly height: number;
  /** Face bottom edge, lot-local metres. */
  readonly baseY: number;
  /** Lot-local position of the face centre. */
  readonly centerX: number;
  readonly centerZ: number;
  /** Extra yaw so blades face the street and billboards angle slightly. */
  readonly yaw: number;
  readonly depth: number;
  readonly posts: number;
  readonly structure: AdKindSpec['structure'];
  readonly animated: boolean;
  readonly lit: boolean;
}

function adPlan(
  plan: ShopfrontPlan,
  kind: AdKind,
  slot: AdSlot,
  copyIndex: number,
): AdvertisementPlan {
  const spec = AD_KIND_SPECS[kind];
  const frontWidth = plan.frontWidth;
  const isKerb = spec.slot === 'kerb';
  const width = isKerb ? Math.min(spec.faceWidth, Math.max(2.2, frontWidth - 2.4)) : Math.min(
    spec.faceWidth,
    Math.max(2.6, frontWidth - 1.7),
  );
  // Blades hang beside the fascia and face along the street; the side flips with
  // the door so the sign never crowds the neighbouring shopfront.
  const bladeSide = plan.doorCenterX <= 0 ? 1 : -1;
  const centerX = isKerb ? 0 : slot === 'blade' ? (frontWidth / 2 - 0.62) * bladeSide : 0;
  const yaw = slot === 'blade' ? (bladeSide > 0 ? Math.PI / 2 : -Math.PI / 2) : 0;
  return Object.freeze({
    id: `${plan.lotId}:ad:${slot}:${plan.era}`,
    lotId: plan.lotId,
    era: plan.era,
    slot,
    kind,
    media: spec.media,
    copy: createAdCopy(plan.era, copyIndex),
    width,
    height: spec.faceHeight,
    baseY: spec.baseY,
    centerX,
    centerZ: spec.z,
    yaw,
    depth: spec.depth,
    posts: spec.posts,
    structure: spec.structure,
    animated: spec.animation,
    lit: spec.lit,
  });
}

/**
 * Plans the advertising a lot carries in one year: always a blade and a transom
 * strip, plus freestanding kerb media on landmark lots and every third lot.
 */
export function planAdvertising(
  plan: ShopfrontPlan,
  random: RandomSource,
): readonly AdvertisementPlan[] {
  const kinds = ERA_AD_KINDS[plan.era] ?? ERA_AD_KINDS['2025'];
  const stream = random.fork(`${plan.lotId}:advertising:${plan.era}`);
  const plans: AdvertisementPlan[] = [
    adPlan(plan, kinds.blade, 'blade', plan.frontWidth + plan.lotId.length),
    adPlan(plan, kinds.transom, 'transom', plan.lotId.length),
  ];
  if (plan.kerbMedia !== null) {
    // Landmark corners get the biggest format (an LED billboard or a hologram
    // column); the eras that lined every pavement with poster frames alternate
    // between the big board and a glass bus-shelter case.
    const shelters = plan.era === '2005';
    const kerbKind: AdKind =
      plan.era === '2025' && (plan.lotId === 'south-4' || plan.lotId === 'north-0')
        ? 'hologramColumn'
        : shelters && (stream.next() < 0.45)
          ? 'busShelterPoster'
          : kinds.kerb;
    plans.push(adPlan(plan, kerbKind, 'kerb', stream.int(0, 5)));
  }
  return Object.freeze(plans);
}

/* ------------------------------------------------------------------------- *
 * Ad textures
 * ------------------------------------------------------------------------- */

/** Builds the sign-face spec for one advertisement (used by the API's cache). */
export function advertisementSignSpec(plan: AdvertisementPlan): SignFaceSpec {
  const descriptor = getEraDescriptor(plan.era);
  const board = `#${(descriptor.palette.buildingSecondary >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
  const ink = `#${(descriptor.palette.emissive >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
  const blocks: SignTextBlock[] = [
    Object.freeze({ text: plan.copy.headline, role: 'title' as const }),
    Object.freeze({ text: plan.copy.subline, role: 'tagline' as const, scale: 0.16 }),
    Object.freeze({ text: plan.copy.seller, role: 'subtitle' as const, scale: 0.13 }),
  ];
  // Animated media alternate their copy frame by frame, like a real reel.
  const alternates: Array<readonly SignTextBlock[]> = [];
  if (plan.animated) {
    const slogans = descriptor.signage.slogans;
    for (let frame = 1; frame < 4; frame += 1) {
      alternates.push(
        Object.freeze([
          Object.freeze({
            text: slogans[(plan.copy.headline.length + frame) % slogans.length] as string,
            role: 'title' as const,
          }),
          Object.freeze({ text: plan.copy.seller, role: 'subtitle' as const, scale: 0.14 }),
        ]),
      );
    }
  }
  return {
    era: plan.era,
    media: plan.media,
    palette: Object.freeze({
      board,
      ink,
      glow: ink,
      trim: `#${(descriptor.palette.buildingPrimary >>> 0).toString(16).padStart(6, '0').slice(-6)}`,
    }),
    blocks: Object.freeze(blocks),
    alternates: plan.animated ? Object.freeze(alternates) : undefined,
    widthMeters: plan.width,
    heightMeters: plan.height,
    // Blades are near-square and small; transoms and billboards are long, and
    // need every pixel they can get along the reading axis.
    longEdge: plan.slot === 'blade' ? 384 : 512,
    key: `${plan.era}:ad:${plan.kind}:${plan.copy.headline}`,
    border: plan.slot !== 'transom',
    note: `${plan.slot}:${plan.kind}`,
  };
}

/* ------------------------------------------------------------------------- *
 * Ad geometry
 * ------------------------------------------------------------------------- */

/** What one advertisement drew. */
export interface AdFeatureCounts {
  faces: number;
  frames: number;
  posts: number;
  braces: number;
  lightboxes: number;
  lamps: number;
  columns: number;
  kioskBodies: number;
  catwalks: number;
  glowStrips: number;
}

/** A zeroed advertisement feature count record. */
export function createAdFeatureCounts(): AdFeatureCounts {
  return {
    faces: 0,
    frames: 0,
    posts: 0,
    braces: 0,
    lightboxes: 0,
    lamps: 0,
    columns: 0,
    kioskBodies: 0,
    catwalks: 0,
    glowStrips: 0,
  };
}

/** Adds `source` into `target`. */
export function addAdFeatureCounts(target: AdFeatureCounts, source: AdFeatureCounts): AdFeatureCounts {
  target.faces += source.faces;
  target.frames += source.frames;
  target.posts += source.posts;
  target.braces += source.braces;
  target.lightboxes += source.lightboxes;
  target.lamps += source.lamps;
  target.columns += source.columns;
  target.kioskBodies += source.kioskBodies;
  target.catwalks += source.catwalks;
  target.glowStrips += source.glowStrips;
  return target;
}

export interface AdvertisementBuildOptions {
  readonly plan: AdvertisementPlan;
  readonly materials: StorefrontMaterialSet;
  readonly geometries: DetailGeometrySet;
  /** Group of the lot this advertisement belongs to. */
  readonly parent: THREE.Group;
  readonly random: RandomSource;
  /** Lit, animating media face; `null` for diagnostics-only builds. */
  readonly media: SignMaterialHandle | null;
}

export interface AdvertisementBuildResult {
  readonly counts: AdFeatureCounts;
  readonly instances: number;
  readonly meshes: readonly THREE.Mesh[];
  readonly signFaces: readonly SignMaterialHandle[];
  /** Role the media is tagged with (`signage` in band, `billboard` at the kerb). */
  readonly role: 'signage' | 'billboard';
}

/**
 * Builds one advertisement: the media face itself plus the period structure that
 * carries it (cantilever arms, posts, lightbox shell, catwalk or column).
 */
export function buildAdvertisement(options: AdvertisementBuildOptions): AdvertisementBuildResult {
  const { plan, materials, geometries, parent, random, media } = options;
  const counts = createAdFeatureCounts();
  const inBand = plan.slot !== 'kerb';
  const role = inBand ? ('signage' as const) : ('billboard' as const);
  const batcher = new StorefrontBatcher(parent, geometries, role);
  const stream = random.fork(`${plan.id}:structure`);
  const faceY = plan.baseY + plan.height / 2;
  const faceMaterial = media?.material ?? materials.get('paper');
  const frameMaterial = plan.era === '1945' ? materials.get('goods') : materials.get('metal');

  switch (plan.structure) {
    case 'cantilever': {
      // Blade sign: the media plate stands perpendicular to the wall while the
      // yaw turns its face along the street, so the plate occupies exactly the
      // projection it claims — from the wall face outwards.
      const wallZ = 0.16;
      const plateZ = wallZ + plan.width / 2;
      batcher.box(faceMaterial, plan.centerX, faceY, plateZ, plan.width, plan.height, plan.depth, {
        yaw: plan.yaw,
      });
      counts.faces += 1;
      // Wall bracket and two horizontal carrier rods along the plate edges.
      batcher.box(
        frameMaterial,
        plan.centerX,
        faceY,
        wallZ - 0.03,
        0.18,
        plan.height + 0.1,
        0.1,
      );
      counts.frames += 1;
      for (const offset of [-0.36, 0.36]) {
        batcher.box(
          frameMaterial,
          plan.centerX,
          faceY + offset * plan.height,
          wallZ + plan.width * 0.34,
          0.06,
          0.06,
          plan.width * 0.62,
        );
        counts.braces += 1;
      }
      break;
    }
    case 'wall': {
      // Transom strip across the shopfront's letterboard.
      batcher.box(faceMaterial, plan.centerX, faceY, plan.centerZ, plan.width, plan.height, plan.depth);
      counts.faces += 1;
      batcher.box(
        frameMaterial,
        plan.centerX,
        faceY + plan.height / 2 + 0.04,
        plan.centerZ - 0.02,
        plan.width + 0.2,
        0.06,
        plan.depth + 0.08,
      );
      batcher.box(
        frameMaterial,
        plan.centerX,
        faceY - plan.height / 2 - 0.04,
        plan.centerZ - 0.02,
        plan.width + 0.2,
        0.06,
        plan.depth + 0.08,
      );
      counts.frames += 2;
      if (plan.lit) {
        batcher.box(
          materials.get('emissive'),
          plan.centerX,
          faceY - 0.02,
          plan.centerZ + plan.depth / 2 + 0.03,
          plan.width * 0.98,
          0.03,
          0.03,
        );
        counts.glowStrips += 1;
      }
      break;
    }
    case 'posts': {
      // Freestanding kerb billboard: two posts, a braced panel and a catwalk.
      batcher.box(faceMaterial, plan.centerX, faceY, plan.centerZ, plan.width, plan.height, plan.depth, {
        yaw: plan.yaw,
      });
      counts.faces += 1;
      for (const edge of [-1, 1]) {
        const x = plan.centerX + (plan.width / 2 - 0.28) * edge;
        batcher.box(frameMaterial, x, plan.baseY / 2 + 0.15, plan.centerZ - 0.12, 0.16, plan.baseY + 0.3, 0.2);
        batcher.box(
          materials.get('plinth'),
          x,
          0.05,
          plan.centerZ - 0.12,
          0.34,
          0.12,
          0.34,
        );
        counts.posts += 1;
      }
      batcher.box(
        frameMaterial,
        plan.centerX,
        faceY + plan.height / 2 + 0.06,
        plan.centerZ - 0.04,
        plan.width + 0.16,
        0.08,
        plan.depth + 0.14,
      );
      batcher.box(
        frameMaterial,
        plan.centerX,
        faceY - plan.height / 2 - 0.06,
        plan.centerZ - 0.04,
        plan.width + 0.16,
        0.08,
        plan.depth + 0.14,
      );
      for (const edge of [-1, 1]) {
        batcher.box(
          frameMaterial,
          plan.centerX + (plan.width / 2 + 0.04) * edge,
          faceY,
          plan.centerZ - 0.04,
          0.08,
          plan.height + 0.12,
          plan.depth + 0.14,
        );
      }
      counts.frames += 4;
      batcher.box(
        frameMaterial,
        plan.centerX,
        faceY + plan.height / 2 + 0.12,
        plan.centerZ + plan.depth / 2,
        plan.width,
        0.05,
        0.4,
      );
      counts.catwalks += 1;
      for (let index = 0; index < 3; index += 1) {
        batcher.box(
          plan.lit ? materials.get('emissive') : materials.get('metal'),
          plan.centerX - plan.width / 2 + (plan.width * (index + 0.5)) / 3,
          faceY + plan.height / 2 + 0.2,
          plan.centerZ + plan.depth / 2 + 0.16,
          0.16,
          0.06,
          0.22,
        );
        counts.lamps += 1;
      }
      if (plan.depth > 0.2) {
        batcher.box(
          materials.get('metal'),
          plan.centerX,
          faceY,
          plan.centerZ - plan.depth / 2 - 0.06,
          plan.width * 0.9,
          0.12,
          0.08,
        );
        counts.lightboxes += 1;
      }
      break;
    }
    case 'case': {
      // Poster case: a plinth, a steel case body, the printed sheet and the
      // glazing in front of it — the pavement furniture of the poster decades.
      batcher.box(
        materials.get('plinth'),
        plan.centerX,
        0.14,
        plan.centerZ,
        plan.width + 0.34,
        0.28,
        plan.depth + 0.24,
      );
      batcher.box(
        frameMaterial,
        plan.centerX,
        faceY,
        plan.centerZ,
        plan.width + 0.18,
        plan.height + 0.18,
        plan.depth,
      );
      batcher.box(
        faceMaterial,
        plan.centerX,
        faceY,
        plan.centerZ + plan.depth / 2 - 0.01,
        plan.width,
        plan.height,
        0.04,
      );
      batcher.box(
        materials.get('glass'),
        plan.centerX,
        faceY,
        plan.centerZ + plan.depth / 2 + 0.02,
        plan.width + 0.05,
        plan.height + 0.05,
        0.02,
      );
      counts.faces += 1;
      counts.frames += 2;
      counts.kioskBodies += 1;
      break;
    }
    default: {
      // Holographic column: plinth, projector ring, floating media panel.
      batcher.cylinder(materials.get('trim'), plan.centerX, 0.32, plan.centerZ, 0.9, 0.64);
      batcher.cylinder(
        plan.lit ? materials.get('emissive') : materials.get('metal'),
        plan.centerX,
        0.66,
        plan.centerZ,
        0.82,
        0.05,
      );
      counts.columns += 1;
      batcher.box(faceMaterial, plan.centerX, faceY + 0.3, plan.centerZ, plan.width, plan.height, plan.depth, {
        yaw: stream.float(-0.3, 0.3),
      });
      counts.faces += 1;
      for (let index = 0; index < 2; index += 1) {
        batcher.cylinder(
          plan.lit ? materials.get('emissive') : materials.get('metal'),
          plan.centerX,
          1.05 + index * 0.55,
          plan.centerZ,
          plan.width * 0.8 - index * 0.16,
          0.03,
        );
        counts.glowStrips += 1;
      }
      counts.kioskBodies += 1;
      break;
    }
  }

  const signs: SignMaterialHandle[] = [];
  if (media) signs.push(media);
  const instances = batcher.flush();
  return Object.freeze({
    counts,
    instances,
    meshes: Object.freeze([...batcher.flushedMeshes]),
    signFaces: Object.freeze(signs),
    role,
  });
}
