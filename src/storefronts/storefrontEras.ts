/**
 * Per-era storefront & advertisement configuration and generation.
 *
 * Keyed off the foundation era registry (`EraId`), this defines the facade
 * palette, signage style, poster style, awning, neon and emissive behaviour
 * for each of the five eras. `generateStorefronts` / `generateBillboards`
 * turn a config into concrete, deterministic placements around the city block
 * so the same era always produces the same storefronts on every visit.
 */
import type { EraId } from '../contracts';
import type {
  BillboardSpec,
  EraStorefrontConfig,
  StorefrontSpec,
} from './storefrontTypes';

export const ERA_STOREFRONT_CONFIG: Record<EraId, EraStorefrontConfig> = {
  '1945': {
    facadePalette: ['#9a8b7a', '#8a7a68', '#7d7468', '#a08e78', '#8f8272'],
    windowTint: '#c9bfae',
    signStyle: 'handPainted',
    signColors: ['#3a2f22', '#4a3826', '#2f2a20', '#5a4630'],
    adStyle: 'sepia',
    awning: 'striped',
    awningColors: ['#8a2f22', '#d9d2c2'],
    neon: true,
    neonColors: ['#ff5a3c'],
    emissiveIntensity: 1.0,
    metalness: 0.05,
    trimColor: '#6a5c4a',
    signFontFamily: 'Georgia, "Times New Roman", serif',
    signFontWeight: '700',
    storeNames: [
      'GROCER & SONS',
      'BARBER SHOP',
      'CINEMA',
      'DRUG STORE',
      'CAFE',
      'TAILOR',
      'HARDWARE',
      'BAKERY',
      'SHOES',
    ],
    subtexts: ['EST. 1929', 'FINE GOODS', 'NOW SHOWING', 'SODA', 'HAND MADE'],
  },
  '1965': {
    facadePalette: ['#2f6f8a', '#a8322a', '#3f6f4a', '#7a5a9e', '#c98a2e', '#1f5f8a'],
    windowTint: '#cfe0e6',
    signStyle: 'midCentury',
    signColors: ['#ffffff', '#fff2cc', '#ffe9e0', '#e8f4ff'],
    adStyle: 'popArt',
    awning: 'solid',
    awningColors: ['#a8322a', '#e8e4da'],
    neon: true,
    neonColors: ['#ff5a3c', '#4ae3ff', '#ffe14a'],
    emissiveIntensity: 1.6,
    metalness: 0.35,
    trimColor: '#d8d2c4',
    signFontFamily: '"Arial Black", "Helvetica Neue", sans-serif',
    signFontWeight: '900',
    storeNames: [
      'AUTO MART',
      'DINER',
      'SUPER MARKET',
      'PHOTO',
      'RECORDS',
      'DEPARTMENT',
      'LAUNDROMAT',
      'TV SALES',
    ],
    subtexts: ['NEW!', 'SALE TODAY', 'OPEN', 'SPECIAL', 'SERVING YOU'],
  },
  '1985': {
    facadePalette: ['#b8bec4', '#a8322a', '#1f3a8a', '#2a2a2e', '#e0e0e0', '#8a1f2e', '#c9d0d6'],
    windowTint: '#a8b8c8',
    signStyle: 'backlit',
    signColors: ['#ffffff', '#ffe14a', '#4ae3ff', '#ff5a8a'],
    adStyle: 'eighties',
    awning: 'none',
    awningColors: ['#1f3a8a', '#e0e0e0'],
    neon: true,
    neonColors: ['#ff2a6d', '#05d9e8', '#f9f871', '#a64dff'],
    emissiveIntensity: 2.4,
    metalness: 0.4,
    trimColor: '#8a8f96',
    signFontFamily: 'Impact, "Arial Black", sans-serif',
    signFontWeight: '700',
    storeNames: [
      'VIDEO',
      'COMPUTER',
      'PIZZA',
      'ARCADE',
      'RENTALS',
      'MALL',
      'STEREO',
      'FAST FOOD',
    ],
    subtexts: ['NOW HIRING', 'SAVE 50%', 'LATE NIGHT', 'RENT ME', 'NEW RELEASES'],
  },
  '2005': {
    facadePalette: ['#9aa0a6', '#2e3a45', '#a83232', '#1f5f8a', '#e8e8e8', '#3a3a3a', '#6a6f75'],
    windowTint: '#c8d8e0',
    signStyle: 'lightBox',
    signColors: ['#1f3a8a', '#a8322a', '#2e3a45', '#0070a8'],
    adStyle: 'corporate',
    awning: 'none',
    awningColors: ['#1f5f8a', '#e8e8e8'],
    neon: false,
    neonColors: ['#ff5a3c'],
    emissiveIntensity: 1.8,
    metalness: 0.25,
    trimColor: '#5a5f66',
    signFontFamily: 'Arial, "Helvetica Neue", sans-serif',
    signFontWeight: '700',
    storeNames: [
      'COFFEE',
      'MOBILE',
      'BANK',
      'GYM',
      'PHARMACY',
      'ELECTRONICS',
      'SALON',
      'BISTRO',
    ],
    subtexts: ['FREE WIFI', 'LOW RATES', 'OPEN LATE', '24/7', 'BEST PRICES'],
  },
  '2025': {
    facadePalette: ['#d8d8d8', '#2a2c30', '#5a5f66', '#8a8f96', '#1f2a3a', '#e8e8e8', '#3a3f45'],
    windowTint: '#d8e6f2',
    signStyle: 'digital',
    signColors: ['#ffffff', '#4ae3ff', '#7affb0', '#ffd166'],
    adStyle: 'digitalLoop',
    awning: 'none',
    awningColors: ['#1f2a3a', '#e8e8e8'],
    neon: false,
    neonColors: ['#4ae3ff'],
    emissiveIntensity: 2.2,
    metalness: 0.3,
    trimColor: '#2a2c30',
    signFontFamily: '"Helvetica Neue", Arial, sans-serif',
    signFontWeight: '400',
    storeNames: [
      'NEXUS',
      'AURORA',
      'VOLT',
      'PULSE',
      'ORBIT',
      'NOVA',
      'KINETIC',
      'LUME',
    ],
    subtexts: ['NOW LIVE', 'STREAMING', 'MEMBERS', 'SMART', 'SECURE'],
  },
};

/** Small deterministic string hash used to seed each era's placements. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) for reproducible placement. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The block perimeter the storefronts line up along. Each side is a row
 * facing the road; `axis` is the direction the row runs along.
 */
const SIDES: { origin: [number, number]; rotation: number; axis: 'x' | 'z' }[] = [
  { origin: [0, 5.5], rotation: Math.PI, axis: 'z' }, // north, facing -z
  { origin: [0, -5.5], rotation: 0, axis: 'z' }, // south, facing +z
  { origin: [5.5, 0], rotation: Math.PI / 2, axis: 'x' }, // east, facing -x
  { origin: [-5.5, 0], rotation: -Math.PI / 2, axis: 'x' }, // west, facing +x
];

const PER_SIDE = 3;
const UNIT_WIDTH = 3.2;
const UNIT_HEIGHT = 4.6;

/**
 * Build a deterministic set of storefront units around the block perimeter
 * for an era. Four sides, three units per side = twelve storefronts.
 */
export function generateStorefronts(era: EraId, seed?: number): StorefrontSpec[] {
  const config = ERA_STOREFRONT_CONFIG[era];
  const h = seed ?? hashString(`storefronts:${era}`);
  const rand = mulberry32(h);

  const specs: StorefrontSpec[] = [];
  let id = 0;

  for (const side of SIDES) {
    for (let i = 0; i < PER_SIDE; i++) {
      const offset = ((i - (PER_SIDE - 1) / 2) * UNIT_WIDTH).toFixed(4);
      const isXAxis = side.axis === 'x';
      const x = isXAxis ? side.origin[0] : Number(offset);
      const z = isXAxis ? Number(offset) : side.origin[1];

      const nameIndex = Math.floor(rand() * config.storeNames.length);
      const name = config.storeNames[nameIndex];
      const subtext =
        config.subtexts[Math.floor(rand() * config.subtexts.length)];

      specs.push({
        id: id++,
        x,
        z,
        rotationY: side.rotation,
        width: UNIT_WIDTH,
        height: UNIT_HEIGHT,
        name,
        subtext,
        facadeColor: config.facadePalette[Math.floor(rand() * config.facadePalette.length)],
        signColor: config.signColors[Math.floor(rand() * config.signColors.length)],
        neonColor: config.neonColors[Math.floor(rand() * config.neonColors.length)],
        awningColors: [config.awningColors[0], config.awningColors[1]],
        posterVariant: i,
        seed: (h ^ (id * 2654435761)) >>> 0,
      });
    }
  }

  return specs;
}

/**
 * Build a set of standalone advertisement billboards at the block corners,
 * each facing the road intersection. One per corner.
 */
export function generateBillboards(era: EraId, seed?: number): BillboardSpec[] {
  const config = ERA_STOREFRONT_CONFIG[era];
  const corners: [number, number][] = [
    [6.4, 6.4],
    [6.4, -6.4],
    [-6.4, 6.4],
    [-6.4, -6.4],
  ];
  const h = seed ?? hashString(`billboards:${era}`);
  const rand = mulberry32(h);

  return corners.map(([x, z], i) => ({
    id: i,
    x,
    z,
    rotationY: Math.atan2(-z, -x),
    facadeColor: config.facadePalette[Math.floor(rand() * config.facadePalette.length)],
    signColor: config.signColors[Math.floor(rand() * config.signColors.length)],
    neonColor: config.neonColors[Math.floor(rand() * config.neonColors.length)],
    name: config.storeNames[Math.floor(rand() * config.storeNames.length)],
    subtext: config.subtexts[Math.floor(rand() * config.subtexts.length)],
    posterVariant: i,
    seed: (h ^ (i * 2654435761)) >>> 0,
  }));
}

/**
 * Look up the storefront/ads config for a given era.
 */
export function getStorefrontConfig(era: EraId): EraStorefrontConfig {
  return ERA_STOREFRONT_CONFIG[era];
}