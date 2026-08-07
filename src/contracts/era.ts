/**
 * Era contracts — the shared vocabulary every downstream module plugs into.
 *
 * An era is one of the five selectable time periods on the timeline.
 */

/** The five selectable time periods. */
export type EraId = 1945 | 1965 | 1985 | 2005 | 2025;

/** Ordered list of every era, oldest first. Used to drive the timeline. */
export const ERA_IDS: readonly EraId[] = [1945, 1965, 1985, 2005, 2025];

/** Lighting hints used by the base scene (placeholder values for now). */
export interface EraLightingHints {
  /** Ambient light intensity (0..1). */
  ambientIntensity: number;
  /** Directional/sun light intensity. */
  sunIntensity: number;
  /** Sun color. */
  sunColor: string;
  /** Background / fog color. */
  fogColor: string;
  /** Fog density (0..1). */
  fogDensity: number;
}

/** A curated color palette hint for the era. */
export interface EraPalette {
  primary: string;
  secondary: string;
  accent: string;
}

/** Human/mood description of a single era. */
export interface EraDescriptor {
  id: EraId;
  /** Short label, e.g. "Post-War". */
  label: string;
  /** The numeric year. */
  year: number;
  /** One-line mood description. */
  mood: string;
  /** Lighting hints (placeholder for later modules). */
  lighting: EraLightingHints;
  /** Palette hints (placeholder for later modules). */
  palette: EraPalette;
}

/** Registry mapping every EraId to its descriptor. */
export const ERA_REGISTRY: Record<EraId, EraDescriptor> = {
  1945: {
    id: 1945,
    label: 'Post-War',
    year: 1945,
    mood: 'Somber, muted, wartime austerity.',
    lighting: {
      ambientIntensity: 0.35,
      sunIntensity: 0.9,
      sunColor: '#d8d3c8',
      fogColor: '#3a3a3a',
      fogDensity: 0.012,
    },
    palette: { primary: '#6f6a5e', secondary: '#8a8577', accent: '#b0a98f' },
  },
  1965: {
    id: 1965,
    label: 'Mid-Century',
    year: 1965,
    mood: 'Optimistic, bright, chrome and pastel.',
    lighting: {
      ambientIntensity: 0.45,
      sunIntensity: 1.2,
      sunColor: '#fff4e0',
      fogColor: '#cfe0e8',
      fogDensity: 0.006,
    },
    palette: { primary: '#3f7d8c', secondary: '#d9a441', accent: '#e8e3d8' },
  },
  1985: {
    id: 1985,
    label: 'Neon Eighties',
    year: 1985,
    mood: 'Electric, saturated, neon nights.',
    lighting: {
      ambientIntensity: 0.5,
      sunIntensity: 1.4,
      sunColor: '#ffe9a8',
      fogColor: '#1a1030',
      fogDensity: 0.008,
    },
    palette: { primary: '#ff2d95', secondary: '#00e5ff', accent: '#7a3bff' },
  },
  2005: {
    id: 2005,
    label: 'Early Digital',
    year: 2005,
    mood: 'Clean, glassy, early internet optimism.',
    lighting: {
      ambientIntensity: 0.6,
      sunIntensity: 1.6,
      sunColor: '#ffffff',
      fogColor: '#b8c4cc',
      fogDensity: 0.004,
    },
    palette: { primary: '#2f6f8f', secondary: '#8fb7c9', accent: '#e0e8ec' },
  },
  2025: {
    id: 2025,
    label: 'Modern',
    year: 2025,
    mood: 'Sleek, dense, smart-city vibrancy.',
    lighting: {
      ambientIntensity: 0.7,
      sunIntensity: 1.8,
      sunColor: '#f4f7ff',
      fogColor: '#d8dee6',
      fogDensity: 0.003,
    },
    palette: { primary: '#1f2a44', secondary: '#4f6d8a', accent: '#7fd1ff' },
  },
};

/** Look up a descriptor for an era. */
export function getEraDescriptor(id: EraId): EraDescriptor {
  return ERA_REGISTRY[id];
}
