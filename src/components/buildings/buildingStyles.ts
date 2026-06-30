/**
 * Style-driven procedural building configuration.
 *
 * Each `BuildingStyle` maps to a set of visual parameters that drive the
 * `Building` component's facade color, window pattern, roof detail, and
 * signage. These are pure data descriptors — no React or Three.js here — so
 * they can be unit-tested and consumed by the layout/placer hooks.
 */
import type { BuildingStyle } from '@/config/years';

/**
 * Window grid pattern descriptor. `rows` and `columns` define the grid of
 * emissive window quads on each facade; `color` is the emissive tint.
 */
export interface WindowPattern {
  /** Number of horizontal window rows. */
  readonly rows: number;
  /** Number of window columns across the facade. */
  readonly columns: number;
  /** Emissive window color (hex string). */
  readonly color: string;
  /** Window emissive intensity. */
  readonly intensity: number;
}

/**
 * Roof detail descriptor. When `type` is `'none'` the building has a flat
 * roof and no extra mesh is rendered.
 */
export interface RoofDetail {
  readonly type: 'flat' | 'spire' | 'antenna' | 'setback' | 'dome' | 'none';
  /** Height of the roof detail mesh in world units. */
  readonly height: number;
  /** Color of the roof detail mesh (hex string). */
  readonly color: string;
}

/**
 * Signage descriptor for commercial-style buildings (neon signs, billboards).
 */
export interface SignageConfig {
  /** Whether signage is present. */
  readonly enabled: boolean;
  /** Sign text content. */
  readonly text: string;
  /** Sign color (hex string). */
  readonly color: string;
}

/**
 * Complete visual descriptor for a building style. Consumed by the
 * `Building` component to generate its meshes.
 */
export interface BuildingStyleConfig {
  /** Facade base color (hex string). */
  readonly facadeColor: string;
  /** Window grid pattern. */
  readonly windowPattern: WindowPattern;
  /** Optional roof detail. */
  readonly roof: RoofDetail;
  /** Commercial signage. */
  readonly signage: SignageConfig;
  /** Default footprint width (x) in world units. */
  readonly defaultWidth: number;
  /** Default footprint depth (z) in world units. */
  readonly defaultDepth: number;
}

/**
 * Lookup table mapping each `BuildingStyle` to its visual configuration.
 *
 * The five styles cover the full historical range:
 * - `artDeco`: postwar 1945 — ornate setbacks, warm stone facade
 * - `midcentury`: 1960s — clean lines, flat roofs, muted tones
 * - `brutalist`: 1980s — heavy concrete, small windows, antennas
 * - `glassTower`: 2000s — curtain-wall glass, dense window grid
 * - `modern`: 2025 — sleek composite, LED signage, spires
 */
export const BUILDING_STYLES: Record<BuildingStyle, BuildingStyleConfig> = {
  artDeco: {
    facadeColor: '#8a7a6a',
    windowPattern: {
      rows: 4,
      columns: 3,
      color: '#ffd9a0',
      intensity: 0.6,
    },
    roof: {
      type: 'setback',
      height: 2,
      color: '#6b5b4a',
    },
    signage: {
      enabled: false,
      text: '',
      color: '#000000',
    },
    defaultWidth: 5,
    defaultDepth: 5,
  },
  midcentury: {
    facadeColor: '#9a8f7d',
    windowPattern: {
      rows: 6,
      columns: 4,
      color: '#fff0c0',
      intensity: 0.5,
    },
    roof: {
      type: 'flat',
      height: 0.5,
      color: '#7a6f5d',
    },
    signage: {
      enabled: true,
      text: 'MOTEL',
      color: '#ff6b6b',
    },
    defaultWidth: 6,
    defaultDepth: 5,
  },
  brutalist: {
    facadeColor: '#6a6a6a',
    windowPattern: {
      rows: 8,
      columns: 3,
      color: '#a0c0ff',
      intensity: 0.4,
    },
    roof: {
      type: 'antenna',
      height: 4,
      color: '#4a4a4a',
    },
    signage: {
      enabled: false,
      text: '',
      color: '#000000',
    },
    defaultWidth: 7,
    defaultDepth: 6,
  },
  glassTower: {
    facadeColor: '#4a6a8a',
    windowPattern: {
      rows: 12,
      columns: 5,
      color: '#80c0ff',
      intensity: 0.8,
    },
    roof: {
      type: 'flat',
      height: 0.5,
      color: '#3a5a7b',
    },
    signage: {
      enabled: true,
      text: 'PLAZA',
      color: '#00d4ff',
    },
    defaultWidth: 6,
    defaultDepth: 6,
  },
  modern: {
    facadeColor: '#3a5a7b',
    windowPattern: {
      rows: 16,
      columns: 6,
      color: '#a0e0ff',
      intensity: 1.0,
    },
    roof: {
      type: 'spire',
      height: 6,
      color: '#2a4a6b',
    },
    signage: {
      enabled: true,
      text: 'TOWER',
      color: '#00ff88',
    },
    defaultWidth: 5,
    defaultDepth: 5,
  },
};

/**
 * Resolve a `BuildingStyleConfig` from a `BuildingStyle` key. Throws if the
 * style is unknown, which indicates a data-integrity bug.
 */
export function getBuildingStyleConfig(
  style: BuildingStyle,
): BuildingStyleConfig {
  const config = BUILDING_STYLES[style];
  if (!config) {
    throw new Error(`Unknown building style: ${style}`);
  }
  return config;
}
