/**
 * Shared era contracts for the city time-period timelapse.
 *
 * These are the single source of truth that downstream modules (buildings,
 * vehicles, storefronts, pedestrians, audio, post-processing) plug into.
 */

/** The five supported time periods, in chronological order. */
export const ERA_IDS = ['1945', '1965', '1985', '2005', '2025'] as const;

/** Union type of every supported era id. */
export type EraId = (typeof ERA_IDS)[number];

/** Lighting/mood hints consumed by the renderer. Placeholder values for now. */
export interface EraLightingHints {
  /** Ambient light intensity (0..1). */
  ambientIntensity: number;
  /** Directional (sun) light intensity. */
  sunIntensity: number;
  /** Sun color as a CSS hex string. */
  sunColor: string;
  /** Scene fog color as a CSS hex string. */
  fogColor: string;
  /** Fog near plane distance. */
  fogNear: number;
  /** Fog far plane distance. */
  fogFar: number;
}

/** Describes a single era in the registry. */
export interface EraDescriptor {
  /** Stable, unique id. */
  id: EraId;
  /** Short human label, e.g. "1945". */
  label: string;
  /** Numeric year used for any date math. */
  year: number;
  /** One-line mood description (placeholder for narrative tuning). */
  mood: string;
  /** Lighting/mood hints (placeholder values). */
  lightingHints: EraLightingHints;
}

/**
 * Registry mapping every {@link EraId} to its {@link EraDescriptor}.
 * Downstream modules read era-specific data through this map.
 */
export const ERA_REGISTRY: Record<EraId, EraDescriptor> = {
  '1945': {
    id: '1945',
    label: '1945',
    year: 1945,
    mood: 'Post-war, muted, sepia-toned',
    lightingHints: {
      ambientIntensity: 0.35,
      sunIntensity: 0.8,
      sunColor: '#e8d9b0',
      fogColor: '#d6cfc0',
      fogNear: 40,
      fogFar: 120,
    },
  },
  '1965': {
    id: '1965',
    label: '1965',
    year: 1965,
    mood: 'Mid-century optimism, warm pastels',
    lightingHints: {
      ambientIntensity: 0.45,
      sunIntensity: 1.0,
      sunColor: '#f5e6c8',
      fogColor: '#dcd8cf',
      fogNear: 45,
      fogFar: 130,
    },
  },
  '1985': {
    id: '1985',
    label: '1985',
    year: 1985,
    mood: 'Neon dusk, saturated and electric',
    lightingHints: {
      ambientIntensity: 0.4,
      sunIntensity: 0.9,
      sunColor: '#ffd9a0',
      fogColor: '#3a3f55',
      fogNear: 40,
      fogFar: 110,
    },
  },
  '2005': {
    id: '2005',
    label: '2005',
    year: 2005,
    mood: 'Digital daylight, crisp and cool',
    lightingHints: {
      ambientIntensity: 0.5,
      sunIntensity: 1.1,
      sunColor: '#fff2d8',
      fogColor: '#cfd8e0',
      fogNear: 50,
      fogFar: 140,
    },
  },
  '2025': {
    id: '2025',
    label: '2025',
    year: 2025,
    mood: 'Modern glass, bright and clean',
    lightingHints: {
      ambientIntensity: 0.55,
      sunIntensity: 1.2,
      sunColor: '#ffffff',
      fogColor: '#e6eef4',
      fogNear: 55,
      fogFar: 150,
    },
  },
};

/** Convenience helper: resolve the descriptor for an era id. */
export function getEraDescriptor(era: EraId): EraDescriptor {
  return ERA_REGISTRY[era];
}
