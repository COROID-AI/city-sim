import { ERA_IDS, type EraId } from '../contracts';

/**
 * Buildings & architecture configuration.
 *
 * This module is keyed off the shared era registry (EraId) and holds every
 * era-variant visual decision for the buildings layer: the material palette
 * (shared PBR materials per era), the procedural form/style of each building
 * (height, floors, window pattern, roof, facade features), and the silhouette
 * of the whole block. It is intentionally self-contained so it can be dropped
 * into any R3F canvas without depending on other modules.
 */

/** Window pattern style per era. */
export type WindowStyle = 'sash' | 'ribbon' | 'curtain' | 'panel' | 'smart';

/** Roof / crown style per era. */
export type RoofStyle = 'pitched' | 'parapet' | 'mechanical' | 'flat' | 'green';

/**
 * Shared PBR material palette for a single era. Every building in the era
 * reuses these exact THREE material values so the whole block reads as one
 * consistent material family (brick/stone, concrete, glass-and-steel, etc.).
 */
export interface MaterialPalette {
  /** Dominant facade color. */
  facade: string;
  facadeRoughness: number;
  facadeMetalness: number;
  /** Secondary facade color (cladding / accents). */
  facadeAlt: string;
  /** Trim / edge color. */
  trim: string;
  /** Window glass color. */
  glass: string;
  glassRoughness: number;
  glassMetalness: number;
  /** Optional emissive glow on the glass (smart glazing). */
  glassEmissive: string | null;
  glassEmissiveIntensity: number;
  /** Roof surface color. */
  roof: string;
  /** Metal / steel color (frames, fire escapes, mechanicals). */
  metal: string;
  /** Storefront glazing color. */
  storefront: string;
  storefrontEmissive: string | null;
  storefrontEmissiveIntensity: number;
  /** Building-mounted signage color (neon / LED / painted). */
  signColor: string;
  signEmissiveIntensity: number;
  /** LED media facade color (2025). */
  ledColor: string;
  ledIntensity: number;
  /** Greenery / terrace foliage color (2025). */
  green: string;
  /** Window mullion / sash frame color. */
  mullion: string;
}

/** Era-variant procedural building form / style. */
export interface BuildingStyle {
  windowStyle: WindowStyle;
  /** Glass pane width (along the facade). */
  windowWidth: number;
  /** Glass pane height. */
  windowHeight: number;
  /** Horizontal gap between panes (mullion spacing). */
  windowGapX: number;
  /** Vertical gap between window rows (floor band). */
  windowGapY: number;
  /** 1945: divided sash windows with a center mullion bar. */
  hasSashBar: boolean;
  /** 1945: external fire escape ladder on the street facade. */
  hasFireEscape: boolean;
  /** 2005+: ground-floor storefront glazing. */
  hasStorefront: boolean;
  /** 2005: vertical cladding panels between window columns. */
  hasCladdingPanels: boolean;
  /** 2025: green terraces / balcony planters on the facade. */
  hasGreenTerraces: boolean;
  /** 2025: horizontal LED media bands on the facade. */
  hasLedFacade: boolean;
  /** 2025: smart glazing (emissive tinted glass). */
  hasSmartGlazing: boolean;
  roofStyle: RoofStyle;
}

/** Complete per-era buildings configuration. */
export interface BuildingsEraConfig {
  era: EraId;
  /** Shared PBR material palette for the era. */
  palette: MaterialPalette;
  /** Procedural building form/style for the era. */
  style: BuildingStyle;
  /** Height range (world units) of generated buildings. */
  heightMin: number;
  heightMax: number;
  /** Total number of buildings in the block composition. */
  count: number;
  /** Floor count range. */
  floorsMin: number;
  floorsMax: number;
}

/** A single procedurally placed building in the block. */
export interface PlacedBuilding {
  /** Center x (negative = west side, positive = east side). */
  x: number;
  /** Center z along the street. */
  z: number;
  /** Building width along the street (Z). */
  width: number;
  /** Building depth away from the street (X). */
  depth: number;
  /** Building height. */
  height: number;
  /** Number of floors. */
  floors: number;
  /** 1945: has an external fire escape. */
  fireEscape: boolean;
  /** 2005+: has a storefront. */
  storefront: boolean;
  /** 2025: has green terraces. */
  greenTerraces: boolean;
  /** 2005: has cladding panels. */
  cladding: boolean;
  /** 2025: has an LED media facade. */
  led: boolean;
}

/**
 * Registry of buildings configuration keyed by EraId.
 * Every era is fully specified so the module renders for all 5 years.
 */
export const BUILDINGS_ERA_CONFIG: Record<EraId, BuildingsEraConfig> = {
  '1945': {
    era: '1945',
    palette: {
      facade: '#8a4a38',
      facadeRoughness: 0.95,
      facadeMetalness: 0.02,
      facadeAlt: '#b08968',
      trim: '#7a6a5a',
      glass: '#4a4a4a',
      glassRoughness: 0.6,
      glassMetalness: 0.1,
      glassEmissive: null,
      glassEmissiveIntensity: 0,
      roof: '#3a3a3a',
      metal: '#2b2b2b',
      storefront: '#6a5a4a',
      storefrontEmissive: null,
      storefrontEmissiveIntensity: 0,
      signColor: '#e8dcc0',
      signEmissiveIntensity: 0,
      ledColor: '#000000',
      ledIntensity: 0,
      green: '#3f8f45',
      mullion: '#5a4a3a',
    },
    style: {
      windowStyle: 'sash',
      windowWidth: 1.1,
      windowHeight: 1.4,
      windowGapX: 0.5,
      windowGapY: 0.8,
      hasSashBar: true,
      hasFireEscape: true,
      hasStorefront: false,
      hasCladdingPanels: false,
      hasGreenTerraces: false,
      hasLedFacade: false,
      hasSmartGlazing: false,
      roofStyle: 'pitched',
    },
    heightMin: 7,
    heightMax: 12,
    count: 8,
    floorsMin: 2,
    floorsMax: 4,
  },
  '1965': {
    era: '1965',
    palette: {
      facade: '#b8b0a4',
      facadeRoughness: 0.85,
      facadeMetalness: 0.05,
      facadeAlt: '#9a9a92',
      trim: '#cfc7bb',
      glass: '#7fb3c8',
      glassRoughness: 0.3,
      glassMetalness: 0.3,
      glassEmissive: null,
      glassEmissiveIntensity: 0,
      roof: '#8a8a8a',
      metal: '#9aa0a6',
      storefront: '#a8c0cc',
      storefrontEmissive: null,
      storefrontEmissiveIntensity: 0,
      signColor: '#cfc7bb',
      signEmissiveIntensity: 0,
      ledColor: '#000000',
      ledIntensity: 0,
      green: '#3f8f45',
      mullion: '#8a9098',
    },
    style: {
      windowStyle: 'ribbon',
      windowWidth: 2.2,
      windowHeight: 1.3,
      windowGapX: 0.4,
      windowGapY: 0.7,
      hasSashBar: false,
      hasFireEscape: false,
      hasStorefront: false,
      hasCladdingPanels: false,
      hasGreenTerraces: false,
      hasLedFacade: false,
      hasSmartGlazing: false,
      roofStyle: 'parapet',
    },
    heightMin: 14,
    heightMax: 24,
    count: 8,
    floorsMin: 4,
    floorsMax: 8,
  },
  '1985': {
    era: '1985',
    palette: {
      facade: '#3a5068',
      facadeRoughness: 0.4,
      facadeMetalness: 0.5,
      facadeAlt: '#2a3a4a',
      trim: '#6a7a8a',
      glass: '#9fc3e8',
      glassRoughness: 0.15,
      glassMetalness: 0.85,
      glassEmissive: null,
      glassEmissiveIntensity: 0,
      roof: '#5a6a7a',
      metal: '#b8c4d0',
      storefront: '#8fb0cc',
      storefrontEmissive: null,
      storefrontEmissiveIntensity: 0,
      signColor: '#ff5a7a',
      signEmissiveIntensity: 2.2,
      ledColor: '#000000',
      ledIntensity: 0,
      green: '#3f8f45',
      mullion: '#8fa6bd',
    },
    style: {
      windowStyle: 'curtain',
      windowWidth: 1.6,
      windowHeight: 1.9,
      windowGapX: 0.2,
      windowGapY: 0.35,
      hasSashBar: false,
      hasFireEscape: false,
      hasStorefront: false,
      hasCladdingPanels: false,
      hasGreenTerraces: false,
      hasLedFacade: false,
      hasSmartGlazing: false,
      roofStyle: 'mechanical',
    },
    heightMin: 24,
    heightMax: 42,
    count: 8,
    floorsMin: 8,
    floorsMax: 14,
  },
  '2005': {
    era: '2005',
    palette: {
      facade: '#c9c9cf',
      facadeRoughness: 0.7,
      facadeMetalness: 0.1,
      facadeAlt: '#3f7fb0',
      trim: '#dfe6ec',
      glass: '#a8cfe0',
      glassRoughness: 0.25,
      glassMetalness: 0.4,
      glassEmissive: null,
      glassEmissiveIntensity: 0,
      roof: '#9a9aa0',
      metal: '#d0d6dc',
      storefront: '#cfe4ee',
      storefrontEmissive: '#bfe0f0',
      storefrontEmissiveIntensity: 0.6,
      signColor: '#4fc3f7',
      signEmissiveIntensity: 1.4,
      ledColor: '#000000',
      ledIntensity: 0,
      green: '#3f8f45',
      mullion: '#b8c4cc',
    },
    style: {
      windowStyle: 'panel',
      windowWidth: 1.8,
      windowHeight: 2.0,
      windowGapX: 0.4,
      windowGapY: 0.5,
      hasSashBar: false,
      hasFireEscape: false,
      hasStorefront: true,
      hasCladdingPanels: true,
      hasGreenTerraces: false,
      hasLedFacade: false,
      hasSmartGlazing: false,
      roofStyle: 'flat',
    },
    heightMin: 30,
    heightMax: 52,
    count: 8,
    floorsMin: 10,
    floorsMax: 17,
  },
  '2025': {
    era: '2025',
    palette: {
      facade: '#2a3a44',
      facadeRoughness: 0.5,
      facadeMetalness: 0.3,
      facadeAlt: '#3f7f6b',
      trim: '#dfe6ec',
      glass: '#7fd4ff',
      glassRoughness: 0.12,
      glassMetalness: 0.5,
      glassEmissive: '#4fc3f7',
      glassEmissiveIntensity: 0.8,
      roof: '#3a4a52',
      metal: '#dfe6ec',
      storefront: '#9fdcff',
      storefrontEmissive: '#7fd4ff',
      storefrontEmissiveIntensity: 1.0,
      signColor: '#4fc3f7',
      signEmissiveIntensity: 2.6,
      ledColor: '#4fc3f7',
      ledIntensity: 2.2,
      green: '#3f8f45',
      mullion: '#b8c8d4',
    },
    style: {
      windowStyle: 'smart',
      windowWidth: 2.2,
      windowHeight: 2.4,
      windowGapX: 0.3,
      windowGapY: 0.4,
      hasSashBar: false,
      hasFireEscape: false,
      hasStorefront: true,
      hasCladdingPanels: false,
      hasGreenTerraces: true,
      hasLedFacade: true,
      hasSmartGlazing: true,
      roofStyle: 'green',
    },
    heightMin: 40,
    heightMax: 68,
    count: 8,
    floorsMin: 13,
    floorsMax: 22,
  },
};

/** Look up the buildings config for a given era. */
export function getBuildingsConfig(era: EraId): BuildingsEraConfig {
  return BUILDINGS_ERA_CONFIG[era];
}

/** Deterministic PRNG (mulberry32) so the block composition is stable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate the era-correct block composition.
 *
 * Buildings are laid out deterministically on both sides of the street. The
 * per-era config drives height, floors, and facade features, so the same seed
 * yields a distinct, era-appropriate silhouette for each of the five years.
 */
export function generateBuildings(era: EraId): PlacedBuilding[] {
  const cfg = getBuildingsConfig(era);
  const eraIndex = ERA_IDS.indexOf(era);
  const rand = mulberry32(0x51a7 + eraIndex * 131);
  const out: PlacedBuilding[] = [];
  const perSide = Math.ceil(cfg.count / 2);

  for (const side of [-1, 1] as const) {
    let z = -19;
    for (let i = 0; i < perSide && z < 19; i++) {
      const width = 5 + Math.floor(rand() * 4); // 5..8
      const depth = 3.5 + rand() * 1.5; // 3.5..5
      const height = cfg.heightMin + rand() * (cfg.heightMax - cfg.heightMin);
      const floors = Math.max(
        cfg.floorsMin,
        Math.min(cfg.floorsMax, Math.round(height / 3)),
      );
      out.push({
        x: side * (6.1 + depth / 2),
        z: z + width / 2,
        width,
        depth,
        height,
        floors,
        fireEscape: cfg.style.hasFireEscape && rand() < 0.75,
        storefront: cfg.style.hasStorefront && rand() < 0.85,
        greenTerraces: cfg.style.hasGreenTerraces && rand() < 0.65,
        cladding: cfg.style.hasCladdingPanels && rand() < 0.8,
        led: cfg.style.hasLedFacade && rand() < 0.7,
      });
      z += width + 1 + rand() * 1.8;
    }
  }

  return out;
}
