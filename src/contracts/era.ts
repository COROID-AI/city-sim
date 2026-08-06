/**
 * Shared era contracts.
 *
 * These types and the era registry are the single source of truth that
 * downstream modules (buildings, lighting, audio, effects) plug into.
 */

/** The five supported time periods in the timelapse. */
export const ERA_IDS = ['1945', '1965', '1985', '2005', '2025'] as const;

/** Union type of every supported era id. */
export type EraId = (typeof ERA_IDS)[number];

/** Ordered list of eras (oldest -> newest). */
export const ERA_ORDER: readonly EraId[] = ERA_IDS;

/** Lighting/mood hints used to drive the 3D scene per era. */
export interface EraLightingHints {
  /** Ambient light intensity (0..1). */
  ambientIntensity: number;
  /** Directional/sun light intensity. */
  sunIntensity: number;
  /** Background / sky color. */
  backgroundColor: string;
  /** Fog color. */
  fogColor: string;
  /** Overall color temperature mood. */
  tone: 'warm' | 'cool' | 'neutral';
}

/** Human-facing description of a single era. */
export interface EraDescriptor {
  id: EraId;
  /** Short label, e.g. "1945". */
  label: string;
  /** The calendar year. */
  year: number;
  /** Short mood description (placeholder authoring hook). */
  mood: string;
  /** Lighting/mood hints (placeholder values for the scaffold). */
  lightingHints: EraLightingHints;
}

/**
 * Registry mapping every EraId to its descriptor.
 * Downstream modules look up per-era configuration through this map.
 */
export const ERA_REGISTRY: Record<EraId, EraDescriptor> = {
  '1945': {
    id: '1945',
    label: '1945',
    year: 1945,
    mood: 'Post-war, monochrome, subdued',
    lightingHints: {
      ambientIntensity: 0.25,
      sunIntensity: 0.6,
      backgroundColor: '#3a3f45',
      fogColor: '#2c3035',
      tone: 'neutral',
    },
  },
  '1965': {
    id: '1965',
    label: '1965',
    year: 1965,
    mood: 'Mid-century optimism, soft pastels',
    lightingHints: {
      ambientIntensity: 0.35,
      sunIntensity: 0.9,
      backgroundColor: '#87a7c4',
      fogColor: '#b8c6d4',
      tone: 'cool',
    },
  },
  '1985': {
    id: '1985',
    label: '1985',
    year: 1985,
    mood: 'Neon nights, vibrant and electric',
    lightingHints: {
      ambientIntensity: 0.2,
      sunIntensity: 0.8,
      backgroundColor: '#141a2e',
      fogColor: '#1a2038',
      tone: 'cool',
    },
  },
  '2005': {
    id: '2005',
    label: '2005',
    year: 2005,
    mood: 'Digital dawn, crisp and clean',
    lightingHints: {
      ambientIntensity: 0.4,
      sunIntensity: 1.1,
      backgroundColor: '#7fb3d8',
      fogColor: '#c8dce8',
      tone: 'neutral',
    },
  },
  '2025': {
    id: '2025',
    label: '2025',
    year: 2025,
    mood: 'Modern metropolis, bright and dense',
    lightingHints: {
      ambientIntensity: 0.45,
      sunIntensity: 1.2,
      backgroundColor: '#a8c8e8',
      fogColor: '#d8e6f2',
      tone: 'warm',
    },
  },
};

/** Type guard for runtime validation of era ids. */
export function isEraId(value: string | undefined | null): value is EraId {
  return typeof value === 'string' && (ERA_IDS as readonly string[]).includes(value);
}

/** Look up a descriptor by id (throws if unknown). */
export function getEra(id: EraId): EraDescriptor {
  return ERA_REGISTRY[id];
}
