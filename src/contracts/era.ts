/**
 * Era contracts.
 *
 * The EraId union is the single source of truth for the five time periods
 * every downstream module (content, systems, audio, effects) plugs into.
 */

/** The five supported eras. Exact set — no more, no less. */
export type EraId = 1945 | 1965 | 1985 | 2005 | 2025;

/** Ordered list of every era id. Used to drive the timeline slider. */
export const ERA_IDS: readonly EraId[] = [1945, 1965, 1985, 2005, 2025];

/** Human-facing and mood/lighting metadata for a single era. */
export interface EraDescriptor {
  id: EraId;
  /** Short display label, e.g. "Post-War". */
  label: string;
  /** The calendar year. */
  year: number;
  /** Mood hint (placeholder for later content tasks). */
  mood: string;
  /** Lighting hint placeholder (later content tasks refine these). */
  lighting: {
    /** Ambient light intensity 0..1. */
    ambientIntensity: number;
    /** Sky / background tint. */
    skyColor: string;
    /** Dominant color palette for the era. */
    palette: string[];
  };
}

/** Maps every EraId to its descriptor. */
export const ERA_REGISTRY: Record<EraId, EraDescriptor> = {
  1945: {
    id: 1945,
    label: 'Post-War',
    year: 1945,
    mood: 'muted, somber, hopeful',
    lighting: {
      ambientIntensity: 0.35,
      skyColor: '#b8b3a8',
      palette: ['#6b625a', '#8a7f72', '#4a443e'],
    },
  },
  1965: {
    id: 1965,
    label: 'Mid-Century',
    year: 1965,
    mood: 'optimistic, bright, pastel',
    lighting: {
      ambientIntensity: 0.45,
      skyColor: '#a9c4de',
      palette: ['#c96f5a', '#e0b34f', '#5b7f9e'],
    },
  },
  1985: {
    id: 1985,
    label: 'Neon',
    year: 1985,
    mood: 'electric, vibrant, bold',
    lighting: {
      ambientIntensity: 0.4,
      skyColor: '#2b2b45',
      palette: ['#ff2d95', '#00e5ff', '#ffd319'],
    },
  },
  2005: {
    id: 2005,
    label: 'Digital',
    year: 2005,
    mood: 'sleek, metallic, cool',
    lighting: {
      ambientIntensity: 0.5,
      skyColor: '#9fc4d8',
      palette: ['#8b9bb4', '#4f6d7a', '#e8e6e1'],
    },
  },
  2025: {
    id: 2025,
    label: 'Modern',
    year: 2025,
    mood: 'clean, glassy, futuristic',
    lighting: {
      ambientIntensity: 0.55,
      skyColor: '#7fb6d9',
      palette: ['#2f6f8f', '#d8e6ef', '#1f3a4a'],
    },
  },
};
