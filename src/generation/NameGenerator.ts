import type { ZoneId } from './types';

/**
 * Deterministic, seeded name generator.
 *
 * Given the same seed and zone, it always returns the same pool of
 * candidate names. Names are composed of a {prefix}{suffix} pattern
 * filtered to feel like a real city business directory.
 *
 * This module is pure: no Date, no Math.random, no side effects.
 */

const PREFIXES_BY_ZONE: Readonly<Record<ZoneId, readonly string[]>> = {
  residential: [
    'Hearth',
    'Willow',
    'Maple',
    'Cedar',
    'Linden',
    'Aurora',
    'Briar',
    'Foxglen',
    'Holly',
    'Sage',
    'Quail',
    'Heron',
  ],
  commercial: [
    'North',
    'Market',
    'Crescent',
    'Harbor',
    'Atlas',
    'Beacon',
    'Empire',
    'Pioneer',
    'Granite',
    'Lumen',
    'Apex',
    'Quartz',
  ],
  industrial: [
    'Iron',
    'Forge',
    'Anvil',
    'Foundry',
    'Mercer',
    'Slate',
    'Bellows',
    'Crane',
    'Tidewater',
    'Bedrock',
    'Pyrite',
    'Smelter',
  ],
  civic: [
    'Civic',
    'Unity',
    'Liberty',
    'Justice',
    'Summit',
    'Capitol',
    'Heritage',
    'Founders',
    'Civic',
    'Compass',
    'Centennial',
    'Bridge',
  ],
  park: [
    'Greenway',
    'Riverbend',
    'Meadow',
    'Pine',
    'Cypress',
    'Lakeside',
    'Sunrise',
    'Magnolia',
    'Sequoia',
    'Hillside',
    'Willow',
    'Vista',
  ],
};

const SUFFIXES: readonly string[] = [
  'Co.',
  '& Sons',
  'Holdings',
  'Group',
  'Works',
  'Studio',
  'Partners',
  'Logistics',
  'Industries',
  'Labs',
  'Bureau',
  'Trust',
];

/**
 * Tiny deterministic hash-based PRNG (mulberry32). Pure, fast, no
 * dependencies. Returns a function that yields values in [0, 1).
 */
function makeRng(seed: number): () => number {
  let a = (seed | 0) >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  // Caller guarantees list is non-empty; assert to satisfy strict types.
  if (list.length === 0) {
    throw new Error('NameGenerator.pick called with empty list');
  }
  const idx = Math.floor(rng() * list.length);
  // Clamp for paranoia (rng could theoretically land exactly on 1.0 after division).
  const safe = idx >= list.length ? list.length - 1 : idx;
  const value = list[safe];
  if (value === undefined) {
    // Unreachable due to clamp above.
    throw new Error('NameGenerator.pick: index out of bounds');
  }
  return value;
}

/**
 * NameGenerator produces deterministic, unique company names for a city.
 *
 * Usage:
 *   const gen = new NameGenerator(seed);
 *   const name = gen.next('commercial'); // always the same for the same seed
 */
export class NameGenerator {
  private readonly rng: () => number;
  private readonly used: Set<string> = new Set();

  constructor(seed: number) {
    this.rng = makeRng(seed ^ 0x5a17e1d3);
  }

  /**
   * Generate a unique company name for the given zone. The returned name
   * will not be returned twice by this generator instance.
   */
  next(zone: ZoneId): string {
    const prefixList = PREFIXES_BY_ZONE[zone];
    const suffixList = SUFFIXES;
    // Bound the attempts to avoid pathological loops in degenerate seeds.
    const maxAttempts = 256;
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = `${pick(this.rng, prefixList)} ${pick(this.rng, suffixList)}`;
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        return candidate;
      }
    }
    // Fallback: disambiguate with a numeric suffix. This is deterministic
    // given the rng state and ensures we always make progress.
    const fallback = `Company ${this.used.size + 1}`;
    this.used.add(fallback);
    return fallback;
  }

  /**
   * Generate exactly `count` unique names for `zone`. Helper for the
   * CityGenerator to keep call sites readable.
   */
  nextMany(zone: ZoneId, count: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(this.next(zone));
    }
    return out;
  }
}
