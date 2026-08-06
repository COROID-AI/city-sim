import type { EraId } from '../../contracts/era';

/** Era-variant window pattern used to lay out the instanced facade glass. */
export type WindowStyle = 'sash' | 'ribbon' | 'curtain' | 'curtainGrid' | 'smart';

/** Era-variant roof silhouette. */
export type RoofStyle = 'pitched' | 'flat' | 'parapet' | 'crown';

/** Era-variant building massing archetype. */
export type BuildingForm = 'walkup' | 'midrise' | 'highrise' | 'mixeduse' | 'contemporary';

/** Shared PBR material colours + PBR parameters for a single era. */
export interface BuildingMaterialSet {
  /** Primary facade colour (brick / concrete / steel / glass cladding). */
  wall: string;
  /** Secondary accent colour (cladding bands, storefront sign, parapet). */
  accent: string;
  /** Trim / cornice / quoins colour. */
  trim: string;
  /** Window glass colour. */
  glass: string;
  /** Window frame / mullion colour. */
  frame: string;
  /** Roof colour. */
  roof: string;
  /** Greenery / foliage colour (2025). */
  green: string;
  /** LED media facade emissive colour (2025). */
  led: string;
  /** PBR metalness for opaque facade materials. */
  metalness: number;
  /** PBR roughness for opaque facade materials. */
  roughness: number;
  /** PBR metalness for window glass. */
  glassMetalness: number;
  /** PBR roughness for window glass. */
  glassRoughness: number;
  /** Emissive tint applied to window glass (lit windows / smart glazing). */
  glassEmissive: string;
  /** Emissive intensity applied to window glass. */
  glassEmissiveIntensity: number;
}

/** Grid parameters describing where windows are placed on a facade. */
export interface WindowPattern {
  style: WindowStyle;
  /** Single window pane width. */
  width: number;
  /** Single window pane height. */
  height: number;
  /** Horizontal spacing between pane centres. */
  gapX: number;
  /** Vertical spacing between pane centres. */
  gapY: number;
  /** Horizontal inset from the facade edge. */
  inset: number;
  /** Height of the solid plinth / ground floor above the street. */
  sillInset: number;
}

/** Massing / form parameters for a single era. */
export interface BuildingSpecConfig {
  form: BuildingForm;
  roof: RoofStyle;
  /** Min/max building width along the street frontage. */
  widthMin: number;
  widthMax: number;
  /** Min/max building depth (away from the street). */
  depthMin: number;
  depthMax: number;
  /** Min/max building height. */
  heightMin: number;
  heightMax: number;
  /** Number of buildings placed along each side of the street. */
  countPerSide: number;
}

/** Per-era on/off switches for special facade features. */
export interface EraFeatures {
  /** 1945: cast-iron fire escapes on the street facade. */
  fireEscapes: boolean;
  /** 2005: ground-floor storefront glazing + sign band. */
  storefrontGlazing: boolean;
  /** 2005: horizontal cladding panels between floors. */
  claddingPanels: boolean;
  /** 2025: roof garden + balcony planters. */
  greenery: boolean;
  /** 2025: emissive LED media panel on a facade. */
  ledMedia: boolean;
  /** 2025: smart glazing (emissive glass, handled in materials). */
  smartGlazing: boolean;
}

/** Complete era configuration consumed by the Buildings module. */
export interface EraBuildingConfig {
  materials: BuildingMaterialSet;
  window: WindowPattern;
  building: BuildingSpecConfig;
  features: EraFeatures;
}

/** A resolved building placed in the row; consumed by the Building renderer. */
export interface BuildingSpec {
  id: number;
  /** World-space centre x (along the street). */
  x: number;
  /** World-space centre z (away from the street). */
  z: number;
  /** Width along the street frontage. */
  width: number;
  /** Depth away from the street. */
  depth: number;
  /** Height above the street. */
  height: number;
  /** Small yaw jitter so the row reads as organic. */
  rotationY: number;
  /** Approximate number of floors (drives fire-escape / cladding bands). */
  floors: number;
  /** Per-building PRNG seed for deterministic feature placement. */
  seed: number;
}

/**
 * Era-to-buildings configuration.
 *
 * Colours and moods intentionally mirror the foundation `ERA_REGISTRY`
 * palette hints (muted brick 1945, bright concrete 1965, reflective steel
 * 1985, cool cladding 2005, clean glassy 2025) and the sibling street
 * environment module.
 */
export const BUILDINGS_CONFIG: Record<EraId, EraBuildingConfig> = {
  1945: {
    materials: {
      wall: '#7d4a36',
      accent: '#8a5a3c',
      trim: '#d8cfc0',
      glass: '#a8bfc9',
      frame: '#3a2f26',
      roof: '#4a4038',
      green: '#3f8f4a',
      led: '#ffd27a',
      metalness: 0.05,
      roughness: 0.9,
      glassMetalness: 0.1,
      glassRoughness: 0.35,
      glassEmissive: '#ffb36b',
      glassEmissiveIntensity: 0.25,
    },
    window: {
      style: 'sash',
      width: 0.55,
      height: 0.8,
      gapX: 0.95,
      gapY: 1.15,
      inset: 0.6,
      sillInset: 1.1,
    },
    building: {
      form: 'walkup',
      roof: 'pitched',
      widthMin: 2.2,
      widthMax: 3.4,
      depthMin: 3.2,
      depthMax: 4.2,
      heightMin: 3.5,
      heightMax: 6,
      countPerSide: 6,
    },
    features: {
      fireEscapes: true,
      storefrontGlazing: false,
      claddingPanels: false,
      greenery: false,
      ledMedia: false,
      smartGlazing: false,
    },
  },
  1965: {
    materials: {
      wall: '#b9b2a6',
      accent: '#9aa0a8',
      trim: '#e6e2d8',
      glass: '#9fc6e0',
      frame: '#6a7078',
      roof: '#7d7a72',
      green: '#3f8f4a',
      led: '#dff1ff',
      metalness: 0.1,
      roughness: 0.7,
      glassMetalness: 0.2,
      glassRoughness: 0.25,
      glassEmissive: '#dff1ff',
      glassEmissiveIntensity: 0.15,
    },
    window: {
      style: 'ribbon',
      width: 1.3,
      height: 0.95,
      gapX: 1.6,
      gapY: 1.35,
      inset: 0.5,
      sillInset: 1.0,
    },
    building: {
      form: 'midrise',
      roof: 'flat',
      widthMin: 3,
      widthMax: 4.5,
      depthMin: 4.5,
      depthMax: 6,
      heightMin: 8,
      heightMax: 14,
      countPerSide: 4,
    },
    features: {
      fireEscapes: false,
      storefrontGlazing: false,
      claddingPanels: false,
      greenery: false,
      ledMedia: false,
      smartGlazing: false,
    },
  },
  1985: {
    materials: {
      wall: '#3a4a5a',
      accent: '#7a8696',
      trim: '#2a2f38',
      glass: '#9fd8e8',
      frame: '#1f232b',
      roof: '#2a2f38',
      green: '#3f8f4a',
      led: '#00e5ff',
      metalness: 0.6,
      roughness: 0.35,
      glassMetalness: 0.8,
      glassRoughness: 0.15,
      glassEmissive: '#bdeeff',
      glassEmissiveIntensity: 0.2,
    },
    window: {
      style: 'curtain',
      width: 1.5,
      height: 1.25,
      gapX: 1.7,
      gapY: 1.5,
      inset: 0.4,
      sillInset: 0.6,
    },
    building: {
      form: 'highrise',
      roof: 'parapet',
      widthMin: 3.2,
      widthMax: 5,
      depthMin: 4.5,
      depthMax: 6,
      heightMin: 12,
      heightMax: 20,
      countPerSide: 4,
    },
    features: {
      fireEscapes: false,
      storefrontGlazing: false,
      claddingPanels: false,
      greenery: false,
      ledMedia: false,
      smartGlazing: false,
    },
  },
  2005: {
    materials: {
      wall: '#8b9bb4',
      accent: '#4f6d7a',
      trim: '#e8e6e1',
      glass: '#a8c8d8',
      frame: '#5a6672',
      roof: '#6a7280',
      green: '#3f8f4a',
      led: '#9be8ff',
      metalness: 0.4,
      roughness: 0.5,
      glassMetalness: 0.6,
      glassRoughness: 0.2,
      glassEmissive: '#e8f4ff',
      glassEmissiveIntensity: 0.12,
    },
    window: {
      style: 'curtainGrid',
      width: 1.4,
      height: 1.1,
      gapX: 1.6,
      gapY: 1.35,
      inset: 0.4,
      sillInset: 1.4,
    },
    building: {
      form: 'mixeduse',
      roof: 'flat',
      widthMin: 3.4,
      widthMax: 5.2,
      depthMin: 5,
      depthMax: 6.5,
      heightMin: 14,
      heightMax: 22,
      countPerSide: 4,
    },
    features: {
      fireEscapes: false,
      storefrontGlazing: true,
      claddingPanels: true,
      greenery: false,
      ledMedia: false,
      smartGlazing: false,
    },
  },
  2025: {
    materials: {
      wall: '#2f6f8f',
      accent: '#1f3a4a',
      trim: '#d8e6ef',
      glass: '#b8e4f2',
      frame: '#1a2a34',
      roof: '#2a3a44',
      green: '#3fae6a',
      led: '#9be8ff',
      metalness: 0.5,
      roughness: 0.4,
      glassMetalness: 0.7,
      glassRoughness: 0.1,
      glassEmissive: '#9be8ff',
      glassEmissiveIntensity: 0.35,
    },
    window: {
      style: 'smart',
      width: 1.7,
      height: 1.4,
      gapX: 1.9,
      gapY: 1.6,
      inset: 0.4,
      sillInset: 1.0,
    },
    building: {
      form: 'contemporary',
      roof: 'crown',
      widthMin: 3.6,
      widthMax: 5.5,
      depthMin: 5,
      depthMax: 6.5,
      heightMin: 16,
      heightMax: 26,
      countPerSide: 4,
    },
    features: {
      fireEscapes: false,
      storefrontGlazing: false,
      claddingPanels: false,
      greenery: true,
      ledMedia: true,
      smartGlazing: true,
    },
  },
};
