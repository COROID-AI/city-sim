import type { EraId } from '../../contracts';

/**
 * Era-specific buildings configuration.
 *
 * Every era is keyed off the foundation `EraId` registry and describes the
 * architectural language of the block: building heights (one per lot in the
 * block), shared PBR wall/window materials, window size & spacing, roof
 * style, and the era-specific facade features that the `Buildings` module
 * renders procedurally.
 *
 * The module authors a fixed set of building lots (see `Buildings.tsx`) and
 * only the per-era heights / materials / features change, so switching eras
 * reads as a genuine architectural morph rather than a rebuild.
 */

/** Wall / facade PBR material for an era. */
export interface EraWallMaterial {
  color: string;
  roughness: number;
  metalness: number;
  /** Optional emissive tint (e.g. LED facade backing). */
  emissive?: string;
  emissiveIntensity?: number;
}

/** Window / glazing PBR material for an era. */
export interface EraWindowMaterial {
  color: string;
  /** Emissive color used when windows are lit. */
  emissive: string;
  /** Emissive intensity in daylight. */
  dayIntensity: number;
  /** Emissive intensity at night. */
  nightIntensity: number;
  roughness: number;
  metalness: number;
}

/** Roof treatment used by an era. */
export type RoofStyle = 'flat' | 'parapet' | 'curtain';

/** Era-specific facade features toggled on the building shells. */
export interface EraBuildingFeatures {
  /** 1945 — wrought-iron fire escapes on the street facade. */
  fireEscapes?: boolean;
  /** 1985 — continuous reflective glass curtain wall + steel mullions. */
  curtainWall?: boolean;
  /** 2005 — horizontal cladding panels wrapping the facade. */
  claddingPanels?: boolean;
  /** 2005 — large glazed storefront panels at the base. */
  storefrontGlazing?: boolean;
  /** 2025 — greenery / planted balconies on the facade. */
  greenery?: boolean;
  /** 2025 — animated LED media facade panel. */
  ledFacade?: boolean;
}

/** Building-mounted signage material for an era. */
export interface EraSignage {
  color: string;
  emissive: string;
  dayIntensity: number;
  nightIntensity: number;
  /** Short label drawn on a roof / facade sign. */
  label: string;
}

/** Complete buildings config for one era. */
export interface EraBuildingsConfig {
  /** Building heights, one per lot in the block (length === LOT count). */
  heights: number[];
  wall: EraWallMaterial;
  window: EraWindowMaterial;
  /** Window pane width & height. */
  windowSize: [number, number];
  /** Horizontal & vertical spacing between window centres. */
  windowSpacing: [number, number];
  /** Inset of the window grid from the facade edges. */
  windowInset: number;
  /** Vertical height of the first window row above the ground. */
  windowBaseY: number;
  roof: RoofStyle;
  features: EraBuildingFeatures;
  signage: EraSignage;
}

export const BUILDINGS_BY_ERA: Record<EraId, EraBuildingsConfig> = {
  1945: {
    // Low-rise brick/stone walk-ups — 3-4 storeys.
    heights: [9, 11, 8, 10],
    wall: {
      color: '#8c4a3a', // warm brick
      roughness: 0.95,
      metalness: 0.05,
    },
    window: {
      color: '#2e3540',
      emissive: '#ffd9a0', // warm incandescent sash windows
      dayIntensity: 0.15,
      nightIntensity: 1.7,
      roughness: 0.4,
      metalness: 0.1,
    },
    windowSize: [0.55, 0.95], // tall narrow sash windows
    windowSpacing: [1.1, 1.5],
    windowInset: 0.5,
    windowBaseY: 1.7,
    roof: 'parapet',
    features: { fireEscapes: true },
    signage: {
      color: '#d8cdb4',
      emissive: '#ffd9a0',
      dayIntensity: 0.2,
      nightIntensity: 1.4,
      label: '1945',
    },
  },
  1965: {
    // Mid-rise concrete/masonry with larger glass and flat roofs.
    heights: [16, 20, 14, 18],
    wall: {
      color: '#c9c4b8', // poured concrete
      roughness: 0.9,
      metalness: 0.05,
    },
    window: {
      color: '#3a4a52',
      emissive: '#fff1c8',
      dayIntensity: 0.15,
      nightIntensity: 1.5,
      roughness: 0.25,
      metalness: 0.15,
    },
    windowSize: [0.9, 1.1], // larger glass
    windowSpacing: [1.5, 1.7],
    windowInset: 0.5,
    windowBaseY: 2.0,
    roof: 'flat',
    features: {},
    signage: {
      color: '#d9a441',
      emissive: '#ffd98a',
      dayIntensity: 0.25,
      nightIntensity: 1.5,
      label: '1965',
    },
  },
  1985: {
    // Reflective glass-and-steel mid/high-rise curtain walls.
    heights: [24, 34, 20, 30],
    wall: {
      color: '#8fb3c7', // reflective glass
      roughness: 0.12,
      metalness: 0.85,
    },
    window: {
      color: '#1c2430',
      emissive: '#bfe0ff', // cool reflective glazing
      dayIntensity: 0.25,
      nightIntensity: 1.4,
      roughness: 0.1,
      metalness: 0.6,
    },
    windowSize: [0.7, 0.9], // dense curtain-wall grid
    windowSpacing: [0.95, 1.2],
    windowInset: 0.4,
    windowBaseY: 1.6,
    roof: 'curtain',
    features: { curtainWall: true },
    signage: {
      color: '#00e5ff',
      emissive: '#00e5ff',
      dayIntensity: 0.4,
      nightIntensity: 1.8,
      label: '1985',
    },
  },
  2005: {
    // Mixed-use towers with cladding panels and storefront glazing.
    heights: [30, 42, 26, 38],
    wall: {
      color: '#cfd6dd', // light cladding
      roughness: 0.5,
      metalness: 0.3,
    },
    window: {
      color: '#22303a',
      emissive: '#d8ecff',
      dayIntensity: 0.2,
      nightIntensity: 1.5,
      roughness: 0.2,
      metalness: 0.3,
    },
    windowSize: [0.9, 1.2],
    windowSpacing: [1.4, 1.8],
    windowInset: 0.6,
    windowBaseY: 2.4,
    roof: 'flat',
    features: { claddingPanels: true, storefrontGlazing: true },
    signage: {
      color: '#2f6f8f',
      emissive: '#9fd8ff',
      dayIntensity: 0.3,
      nightIntensity: 1.6,
      label: '2005',
    },
  },
  2025: {
    // Contemporary towers with greenery, LED media facades, smart glazing.
    heights: [36, 52, 30, 46],
    wall: {
      color: '#9fc4d8', // smart glazing
      roughness: 0.2,
      metalness: 0.7,
    },
    window: {
      color: '#2a3a44',
      emissive: '#7fe0ff',
      dayIntensity: 0.25,
      nightIntensity: 1.6,
      roughness: 0.12,
      metalness: 0.5,
    },
    windowSize: [1.0, 1.3],
    windowSpacing: [1.5, 1.9],
    windowInset: 0.6,
    windowBaseY: 2.4,
    roof: 'flat',
    features: { greenery: true, ledFacade: true },
    signage: {
      color: '#7fd1ff',
      emissive: '#7fd1ff',
      dayIntensity: 0.5,
      nightIntensity: 2.0,
      label: '2025',
    },
  },
};
