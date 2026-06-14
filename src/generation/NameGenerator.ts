/**
 * Deterministic name generator for buildings, streets, and zones.
 *
 * The name generator is content-only (no engine coupling) and relies on
 * the injected `Rng` to choose pieces. Given a fixed seed, the same
 * sequence of `generate()` calls produces the same names.
 */

import type { Rng } from './random';

const PREFIXES: readonly string[] = [
  'Old', 'New', 'North', 'South', 'East', 'West', 'Royal', 'Imperial',
  'Grand', 'Little', 'Upper', 'Lower', 'Saint', 'Fort', 'Port', 'Lake',
  'Riverside', 'Hill', 'Valley', 'Sunny', 'Shadow', 'Silver', 'Golden',
  'Iron', 'Copper', 'Maple', 'Oak', 'Pine', 'Cedar', 'Birch',
];

const ROOTS: readonly string[] = [
  'Market', 'Crossing', 'Bridge', 'Heights', 'Square', 'Junction',
  'Quarter', 'Yard', 'Lane', 'Gate', 'Row', 'Walk', 'Commons', 'Plaza',
  'Harbor', 'Wharf', 'Annex', 'District', 'Gardens', 'Mews', 'Bend',
];

const SUFFIXES: readonly string[] = [
  'Town', 'Village', 'City', 'Borough', 'Park', 'Heath', 'Field',
  'Hollow', 'Glen', 'Moor', 'Vale', 'Springs', 'Falls', 'Bay', 'Cove',
  'Reach', 'Haven', 'Landing', 'Station', 'Court',
];

const COMPANY_SUFFIXES: readonly string[] = [
  'Co.', 'Inc.', 'LLC', 'Group', 'Holdings', 'Partners', '& Sons',
];

/**
 * Result of a single name generation. The generator chooses a style based
 * on the `kind` argument, but every call returns a non-empty string.
 */
export class NameGenerator {
  constructor(private readonly rng: Rng) {}

  /** Generate a generic place name. */
  generate(): string {
    const useSuffix = this.rng.chance(0.4);
    const prefix = this.rng.pick(PREFIXES);
    const root = this.rng.pick(ROOTS);
    if (useSuffix) {
      return `${prefix} ${root} ${this.rng.pick(SUFFIXES)}`;
    }
    return `${prefix} ${root}`;
  }

  /** Generate a corporate-style name (used for commercial / industrial defs). */
  generateCompany(): string {
    const useSuffix = this.rng.chance(0.5);
    const root = this.rng.pick(PREFIXES);
    const tail = useSuffix ? this.rng.pick(COMPANY_SUFFIXES) : '';
    return `${root} Industries ${tail}`.trim();
  }

  /** Generate a residential development name. */
  generateResidential(): string {
    return `${this.rng.pick(PREFIXES)} ${this.rng.pick(ROOTS)}`;
  }

  /** Generate a name for a given building definition kind. */
  generateForKind(
    kind:
      | 'office'
      | 'shop'
      | 'factory'
      | 'farm'
      | 'warehouse'
      | 'tech'
      | 'restaurant'
      | 'hospital'
      | 'school'
      | 'park'
      | 'residential',
  ): string {
    if (kind === 'park') return `${this.rng.pick(PREFIXES)} Park`;
    if (
      kind === 'factory' ||
      kind === 'warehouse' ||
      kind === 'tech' ||
      kind === 'office'
    ) {
      return this.generateCompany();
    }
    if (kind === 'residential') return this.generateResidential();
    return this.generate();
  }
}
