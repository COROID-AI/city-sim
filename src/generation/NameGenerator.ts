/**
 * NameGenerator — produces human-readable "FirstName LastName" strings for
 * spawned citizens (spec §6.3).
 *
 * The generator draws from fixed first/last name pools. Pools are exported so
 * tests can assert structural properties (name parts are drawn from the pools)
 * without depending on `Math.random` determinism.
 */

/** Pool of first names used by the generator. */
export const FIRST_NAMES: readonly string[] = [
  'Alice',
  'Bob',
  'Carol',
  'David',
  'Eve',
  'Frank',
  'Grace',
  'Henry',
  'Ivy',
  'Jack',
  'Karen',
  'Leo',
  'Mia',
  'Noah',
  'Olivia',
  'Paul',
  'Quinn',
  'Ruby',
  'Sam',
  'Tina',
  'Uma',
  'Victor',
  'Wendy',
  'Xander',
  'Yara',
  'Zane',
];

/** Pool of last names used by the generator. */
export const LAST_NAMES: readonly string[] = [
  'Anderson',
  'Brown',
  'Clark',
  'Davis',
  'Evans',
  'Foster',
  'Garcia',
  'Harris',
  'Iverson',
  'Johnson',
  'Kim',
  'Lopez',
  'Martin',
  'Nelson',
  'Owens',
  'Patel',
  'Quinn',
  'Robinson',
  'Smith',
  'Taylor',
  'Underwood',
  'Vargas',
  'Williams',
  'Xu',
  'Young',
  'Zhang',
];

/**
 * Pick a random element from a non-empty readonly array.
 * @throws if the pool is empty.
 */
function pickRandom<T>(pool: readonly T[]): T {
  if (pool.length === 0) {
    throw new Error('pickRandom: pool must not be empty');
  }
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] as T;
}

export class NameGenerator {
  /**
   * Generate a single "FirstName LastName" string.
   *
   * The first name is drawn from {@link FIRST_NAMES} and the last name from
   * {@link LAST_NAMES}. Non-deterministic by design.
   */
  static generate(): string {
    const first = pickRandom(FIRST_NAMES);
    const last = pickRandom(LAST_NAMES);
    return `${first} ${last}`;
  }

  /**
   * Generate `count` unique-ish names in a single call.
   * Duplicates are possible (pools are finite) but unlikely for small counts.
   *
   * @param count Number of names to generate (must be >= 0).
   */
  static generateMany(count: number): string[] {
    if (count < 0) {
      throw new Error(`NameGenerator.generateMany: count must be >= 0 (got ${count})`);
    }
    const names: string[] = [];
    for (let i = 0; i < count; i += 1) {
      names.push(NameGenerator.generate());
    }
    return names;
  }
}
