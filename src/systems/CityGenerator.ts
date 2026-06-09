/**
 * CityGenerator.
 *
 * Spec reference: §5.2 World Generation, §5.3 Entities.
 *
 * Produces the initial set of buildings and citizens. Pure function on
 * the building list (so it's testable and deterministic when given a
 * seeded RNG), and emits 50-100 citizens with 24h schedules. Around 70%
 * of citizens are assigned a workplace.
 */
import {
  type Citizen,
  createCitizen,
  DEFAULT_NEEDS,
} from '@/entities';
import type {
  ActivityId,
  BuildingId,
  CitizenId,
  Vector2,
} from '@/types/common';

const FIRST_NAMES: readonly string[] = [
  'Alex', 'Bea', 'Cory', 'Dani', 'Erin', 'Finn', 'Gabi', 'Hugo',
  'Ines', 'Jude', 'Kira', 'Lior', 'Maya', 'Noor', 'Omar', 'Pia',
  'Quinn', 'Ravi', 'Saoirse', 'Theo', 'Uma', 'Vera', 'Wren', 'Xio',
  'Yara', 'Zane',
] as const;

/** Building shape produced by the map generator (subset we depend on). */
export interface WorkplaceBuilding {
  id: BuildingId;
  position: Vector2;
  /** Capacity is the maximum number of assigned employees. */
  capacity: number;
}

export interface CityGeneratorOptions {
  /** Total citizen count. Clamped to [50, 100]. */
  citizenCount?: number;
  /** Fraction of citizens that should have a workplace. Clamped to [0, 1]. */
  employmentRate?: number;
  /** Seed for deterministic tests. */
  seed?: number;
}

export interface GeneratedCity {
  citizens: Citizen[];
  /** workplaceId -> assigned citizen ids (for the renderer/pathfinder). */
  assignments: ReadonlyMap<BuildingId, readonly CitizenId[]>;
}

/**
 * Generate the initial citizen population.
 *
 * @param buildings  All known workplace buildings. We round-robin citizens
 *                   across them so assignments are deterministic and each
 *                   employed citizen lands on a real building.
 * @param options    Optional overrides for tests.
 */
export function generateCity(
  buildings: readonly WorkplaceBuilding[],
  options: CityGeneratorOptions = {},
): GeneratedCity {
  const rng = createRng(options.seed);
  const total = clampCount(options.citizenCount ?? 75);
  const rate = clampRate(options.employmentRate ?? 0.7);

  const workplaces = buildings.filter((b) => b.capacity > 0);
  const canEmploy = workplaces.length > 0;

  // Plan: first N employed, rest unemployed. We round-robin across workplaces
  // so each is filled in turn up to its capacity. This keeps tests stable.
  const employedTarget = canEmploy ? Math.floor(total * rate) : 0;

  const citizens: Citizen[] = [];
  const assignments = new Map<BuildingId, CitizenId[]>();
  for (const w of workplaces) assignments.set(w.id, []);

  let workplaceCursor = 0;
  for (let i = 0; i < total; i += 1) {
    const isEmployed = i < employedTarget;
    let workplaceId: BuildingId | null = null;
    let workplacePosition: Vector2 = { x: 0, y: 0 };

    if (isEmployed) {
      // Find the next workplace with remaining capacity.
      for (let attempt = 0; attempt < workplaces.length; attempt += 1) {
        const candidate = workplaces[(workplaceCursor + attempt) % workplaces.length];
        if (!candidate) break;
        const list = assignments.get(candidate.id);
        if (list && list.length < candidate.capacity) {
          workplaceId = candidate.id;
          workplacePosition = candidate.position;
          list.push(citizenIdFor(i));
          workplaceCursor = (workplaces.indexOf(candidate) + 1) % workplaces.length;
          break;
        }
      }
    }

    const homeId: BuildingId = `bldg-home-${i}` as BuildingId;
    const schedule = buildSchedule(isEmployed, rng);
    const homePos = homePositionFor(i);

    const citizen = createCitizen({
      id: citizenIdFor(i),
      position: isEmployed && workplaceId !== null ? workplacePosition : homePos,
      name: pickName(rng),
      homeId,
      workplaceId,
      schedule,
      needs: { ...DEFAULT_NEEDS },
    });
    citizens.push(citizen);
  }

  // Freeze the assignment map's inner arrays so downstream code can't mutate.
  const frozen = new Map<BuildingId, readonly CitizenId[]>();
  for (const [k, v] of assignments) {
    frozen.set(k, Object.freeze([...v]));
  }

  return { citizens, assignments: frozen };
}

// ---------- internal helpers ----------

function buildSchedule(
  isEmployed: boolean,
  rng: () => number,
): readonly ActivityId[] {
  const schedule: ActivityId[] = new Array(24);
  for (let h = 0; h < 24; h += 1) {
    schedule[h] = pickActivityForHour(h, isEmployed, rng);
  }
  return schedule;
}

/**
 * Decide the activity for a single hour.
 *
 * Schedule template (employed):
 *   00-06 sleep
 *   07-08 commute / eat
 *   09-12 work
 *   12-13 eat
 *   14-17 work
 *   18-19 commute / leisure
 *   20-22 leisure / socialize
 *   23 sleep
 *
 * Unemployed citizens redistribute the work hours to leisure / socialize /
 * errand based on the RNG.
 */
function pickActivityForHour(
  hour: number,
  isEmployed: boolean,
  rng: () => number,
): ActivityId {
  if (hour >= 0 && hour < 6) return 'sleep';
  if (hour === 6) return 'eat';
  if (hour === 7) return isEmployed ? 'commute' : 'leisure';
  if (hour >= 8 && hour < 12) {
    return isEmployed ? 'work' : roll(['leisure', 'errand', 'socialize'], rng);
  }
  if (hour === 12) return 'eat';
  if (hour === 13) {
    return isEmployed ? 'work' : roll(['leisure', 'socialize', 'errand'], rng);
  }
  if (hour >= 14 && hour < 17) {
    return isEmployed ? 'work' : roll(['leisure', 'socialize', 'errand'], rng);
  }
  if (hour === 17) return isEmployed ? 'commute' : 'leisure';
  if (hour === 18) return 'eat';
  if (hour >= 19 && hour < 23) {
    return roll(['leisure', 'socialize', 'errand'], rng);
  }
  return 'sleep';
}

function roll<T>(choices: readonly T[], rng: () => number): T {
  if (choices.length === 0) {
    throw new Error('roll() called with empty choices');
  }
  const idx = Math.floor(rng() * choices.length);
  const safe = Math.min(idx, choices.length - 1);
  const value = choices[safe];
  if (value === undefined) {
    // Defensive: should be unreachable because of the bounds check.
    const fallback = choices[0];
    if (fallback === undefined) {
      throw new Error('roll() choices has no element 0');
    }
    return fallback;
  }
  return value;
}

function pickName(rng: () => number): string {
  const idx = Math.floor(rng() * FIRST_NAMES.length);
  const safe = Math.min(idx, FIRST_NAMES.length - 1);
  return FIRST_NAMES[safe] ?? 'Alex';
}

function homePositionFor(index: number): Vector2 {
  // Spread homes across a small grid so they don't all stack on origin.
  const cols = 10;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: col * 4, y: row * 4 };
}

function citizenIdFor(index: number): CitizenId {
  // Deterministic ids when seed is set (tests), uuid-style when not.
  return `cit-${index.toString().padStart(4, '0')}` as CitizenId;
}

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 75;
  return Math.max(50, Math.min(100, Math.round(n)));
}

function clampRate(n: number): number {
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(1, n));
}

/**
 * Tiny seedable PRNG (mulberry32). Used only for deterministic schedule
 * generation in tests; production runs can pass `seed: undefined` and
 * get full randomness.
 */
function createRng(seed: number | undefined): () => number {
  if (seed === undefined) return Math.random;
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
