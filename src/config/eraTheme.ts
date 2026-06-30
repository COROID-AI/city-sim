/**
 * Per-era visual theme.
 *
 * `YearConfig` (in years.ts) carries only the core scalar fields. This module
 * layers on the rich palette + asset descriptors that the procedural city
 * components need: building colours, storefront/advert styles, prop kinds,
 * pedestrian/vehicle models, and the sky/background gradient stops used for
 * cross-era interpolation.
 */
import type { EraId } from '@/config/years';

/** Sky gradient stops for a single era. */
export interface SkyPalette {
  /** Upper hemisphere colour. */
  readonly top: string;
  /** Lower hemisphere / horizon colour. */
  readonly bottom: string;
}

/** A storefront or billboard advertisement descriptor. */
export interface AdStyle {
  readonly background: string;
  readonly text: string;
}

/** Complete visual theme for one era. */
export interface EraTheme {
  readonly era: EraId;
  /** Building wall colours cycled deterministically. */
  readonly buildingColors: readonly string[];
  /** Roof colour. */
  readonly roofColor: string;
  /** Window emissive colour (night glow). */
  readonly windowColor: string;
  /** Storefront advert styles. */
  readonly ads: readonly AdStyle[];
  /** Prop kinds placed on sidewalks. */
  readonly props: readonly PropKind[];
  /** Pedestrian colour palette. */
  readonly pedestrianColors: readonly string[];
  /** Vehicle body colours. */
  readonly vehicleColors: readonly string[];
  /** Vehicle model style. */
  readonly vehicleStyle: 'boxy' | 'sedan' | 'suv' | 'pod';
  /** Sky gradient. */
  readonly sky: SkyPalette;
  /** Ground tint. */
  readonly groundColor: string;
}

/** Kind of sidewalk prop. */
export type PropKind = 'lamp' | 'bench' | 'tree' | 'hydrant' | 'sign' | 'hologram';

/**
 * Ordered era themes. Keys must match `EraId` from years.ts.
 */
export const ERA_THEMES: Record<EraId, EraTheme> = {
  postwar: {
    era: 'postwar',
    buildingColors: ['#8a7a5a', '#9a8a6a', '#7a6a4a'],
    roofColor: '#5a4a3a',
    windowColor: '#ffd27a',
    ads: [
      { background: '#c0392b', text: '#fff8e7' },
      { background: '#2c3e50', text: '#f1c40f' },
    ],
    props: ['lamp', 'bench', 'hydrant'],
    pedestrianColors: ['#3a3a3a', '#5a4a3a', '#4a4a5a'],
    vehicleColors: ['#2c2c2c', '#5a3a2a', '#3a3a3a'],
    vehicleStyle: 'boxy',
    sky: { top: '#6b5b4a', bottom: '#c9b89a' },
    groundColor: '#5a6a40',
  },
  sixties: {
    era: 'sixties',
    buildingColors: ['#b8a878', '#a89868', '#c8b888'],
    roofColor: '#6a5a4a',
    windowColor: '#ffe89a',
    ads: [
      { background: '#e67e22', text: '#ffffff' },
      { background: '#16a085', text: '#fef9e7' },
    ],
    props: ['lamp', 'bench', 'tree', 'sign'],
    pedestrianColors: ['#5a3a5a', '#3a5a7a', '#7a5a3a', '#5a5a5a'],
    vehicleColors: ['#c0392b', '#2980b9', '#27ae60', '#ecf0f1'],
    vehicleStyle: 'sedan',
    sky: { top: '#7a6f5d', bottom: '#d8cba8' },
    groundColor: '#4a6a3a',
  },
  eighties: {
    era: 'eighties',
    buildingColors: ['#6a7a8a', '#7a8a9a', '#5a6a7a', '#8a7a6a'],
    roofColor: '#3a4a5a',
    windowColor: '#7fd8ff',
    ads: [
      { background: '#ff00ff', text: '#00ffff' },
      { background: '#ff6600', text: '#ffff00' },
      { background: '#003366', text: '#ff3366' },
    ],
    props: ['lamp', 'bench', 'tree', 'sign', 'hydrant'],
    pedestrianColors: ['#2a2a4a', '#4a2a4a', '#2a4a2a', '#4a4a2a', '#1a1a3a'],
    vehicleColors: ['#1a1a1a', '#8a8a8a', '#c0c0c0', '#7a1a1a'],
    vehicleStyle: 'sedan',
    sky: { top: '#4a5a6b', bottom: '#c8d8e8' },
    groundColor: '#3a5a40',
  },
  twothousands: {
    era: 'twothousands',
    buildingColors: ['#4a6a8a', '#5a7a9a', '#3a5a7a', '#6a8aaa', '#aab8c8'],
    roofColor: '#2a3a4a',
    windowColor: '#a8e8ff',
    ads: [
      { background: '#0066cc', text: '#ffffff' },
      { background: '#ff9900', text: '#333333' },
      { background: '#336699', text: '#ccffff' },
    ],
    props: ['lamp', 'bench', 'tree', 'sign', 'hydrant'],
    pedestrianColors: ['#1a2a3a', '#3a2a1a', '#2a3a4a', '#4a3a2a', '#3a3a3a'],
    vehicleColors: ['#1a1a1a', '#c0c0c0', '#8a8a8a', '#3a5a8a', '#5a5a5a'],
    vehicleStyle: 'suv',
    sky: { top: '#3a5a7b', bottom: '#bcd4e6' },
    groundColor: '#3a5a40',
  },
  present: {
    era: 'present',
    buildingColors: ['#2a4a6b', '#3a5a7b', '#4a6a8b', '#1a3a5b', '#5a7a9b', '#6a8aab'],
    roofColor: '#1a2a3a',
    windowColor: '#c8f0ff',
    ads: [
      { background: '#00ccff', text: '#003344' },
      { background: '#ff3366', text: '#ffffff' },
      { background: '#00ff99', text: '#003322' },
      { background: '#aa66ff', text: '#ffffff' },
    ],
    props: ['lamp', 'bench', 'tree', 'sign', 'hologram'],
    pedestrianColors: ['#1a1a2a', '#2a2a3a', '#3a3a4a', '#1a2a3a', '#2a3a4a', '#4a4a5a'],
    vehicleColors: ['#1a1a1a', '#e0e0e0', '#2a4a6b', '#3a6a5a', '#5a3a6a', '#6a6a6a'],
    vehicleStyle: 'pod',
    sky: { top: '#2a4a6b', bottom: '#a8c8e8' },
    groundColor: '#2a4a30',
  },
};

/**
 * Look up the theme for an era. Falls back to the `present` theme for unknown
 * ids so rendering never crashes.
 */
export function getEraTheme(era: EraId): EraTheme {
  return ERA_THEMES[era] ?? ERA_THEMES.present;
}
