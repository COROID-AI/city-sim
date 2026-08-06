import { useMemo } from 'react';
import type { EraId } from '../../contracts/era';
import { BUILDINGS_CONFIG } from './eraConfig';
import type { BuildingSpec } from './eraConfig';
import { createEraMaterials } from './materials';
import type { EraMaterials } from './materials';
import { Building } from './Building';

/** Which side(s) of the street to populate. */
export type BuildingsSide = 'north' | 'south' | 'both';

export interface BuildingsProps {
  /** The era whose building composition to render. */
  era: EraId;
  /** Which side(s) of the street to populate (default: both). */
  sides?: BuildingsSide;
  /** Override the number of buildings per side (defaults to era config). */
  countPerSide?: number;
}

/** Deterministic PRNG (mulberry32) so the row layout is stable across renders. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a row of building specs along the street frontage, centred on the
 * block. `side` controls which side of the street the row faces.
 */
function buildRow(
  count: number,
  config: { building: { widthMin: number; widthMax: number; depthMin: number; depthMax: number; heightMin: number; heightMax: number } },
  side: 'north' | 'south',
  seed: number,
): BuildingSpec[] {
  const rand = mulberry32(seed);
  const b = config.building;
  const frontage = 9.0;

  const widths: number[] = [];
  let totalW = 0;
  for (let i = 0; i < count; i++) {
    const w = b.widthMin + rand() * (b.widthMax - b.widthMin);
    widths.push(w);
    totalW += w;
  }
  const gap = count > 1 ? (frontage - totalW) / (count - 1) : 0;

  const specs: BuildingSpec[] = [];
  let x = -frontage / 2;
  for (let i = 0; i < count; i++) {
    const width = widths[i];
    const depth = b.depthMin + rand() * (b.depthMax - b.depthMin);
    const height = b.heightMin + rand() * (b.heightMax - b.heightMin);
    const sign = side === 'north' ? 1 : -1;
    const z = sign * (5.2 + depth / 2);
    const rotationY = (rand() - 0.5) * 0.12;
    specs.push({
      id: i,
      x: x + width / 2,
      z,
      width,
      depth,
      height,
      rotationY,
      floors: Math.max(1, Math.round(height / 3)),
      seed: Math.floor(rand() * 1e9),
    });
    x += width + gap;
  }
  return specs;
}

/**
 * Self-contained buildings layer for the city block.
 *
 * Renders, for the given era, a row of procedurally-authored buildings on
 * each side of the street with era-appropriate massing, materials, window
 * patterns and facade features:
 *   - 1945 low-rise brick walk-ups, sash windows, fire escapes
 *   - 1965 mid-rise concrete with larger glass and flat roofs
 *   - 1985 reflective glass-and-steel curtain-wall mid/high-rises
 *   - 2005 mixed-use towers with cladding panels + storefront glazing
 *   - 2025 contemporary towers with greenery, LED media facades, smart glazing
 *
 * Windows are instanced and PBR materials are shared per era (single draw
 * call per facade). Designed to mount inside a `<Canvas>`; Phase 4 owns
 * wiring it into the shared scene.
 */
export function Buildings({
  era,
  sides = 'both',
  countPerSide,
}: BuildingsProps) {
  const config = BUILDINGS_CONFIG[era];
  const materials: EraMaterials = useMemo(
    () => createEraMaterials(config),
    [config],
  );
  const count = countPerSide ?? config.building.countPerSide;

  const north = useMemo(
    () => (sides === 'both' || sides === 'north' ? buildRow(count, config, 'north', era * 7 + 1) : []),
    [count, config, sides, era],
  );
  const south = useMemo(
    () => (sides === 'both' || sides === 'south' ? buildRow(count, config, 'south', era * 13 + 5) : []),
    [count, config, sides, era],
  );

  return (
    <group>
      {north.map((spec) => (
        <Building key={spec.id} spec={spec} config={config} materials={materials} />
      ))}
      {south.map((spec) => (
        <Building key={spec.id} spec={spec} config={config} materials={materials} />
      ))}
    </group>
  );
}
