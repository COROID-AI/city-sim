import type { EraId } from '../../contracts/era';

/** Era-variant lamp post silhouette. */
export type LampStyle = 'period' | 'midcentury' | 'modern' | 'led';

/** Era-variant traffic signal style. */
export type SignalStyle = 'early' | 'modern' | 'smart';

/** Road surface material + markings configuration for a single era. */
export interface RoadConfig {
  /** Base asphalt / cobblestone colour. */
  baseColor: string;
  /** Surface roughness 0..1. */
  roughness: number;
  /** Surface metalness 0..1. */
  metalness: number;
  /** Which procedural surface treatment to bake into the road texture. */
  surface: 'cobblestone' | 'asphalt' | 'smooth';
  /** Painted centre + lane markings (1985+). */
  paintedLines: boolean;
  /** Coloured bike-lane bands along the kerb (2005+). */
  bikeLanes: boolean;
  /** Embedded glowing smart-road markers (2025). */
  smartMarkers: boolean;
}

/** Procedural sky gradient configuration for a single era. */
export interface SkyConfig {
  /** Colour near the zenith. */
  topColor: string;
  /** Colour near the horizon. */
  horizonColor: string;
  /** Sun disc / glow colour. */
  sunColor: string;
  /** Atmospheric haze / smog, 0..1. */
  haze: number;
}

/** Sun (directional light) configuration for a single era. */
export interface SunConfig {
  /** World-space position of the sun; the light aims at the origin. */
  position: [number, number, number];
  /** Light intensity. */
  intensity: number;
  /** Light colour — drives the era-specific lighting mood. */
  color: string;
}

/** Ambient / fill lighting configuration for a single era. */
export interface LightingConfig {
  /** Ambient light intensity 0..1 (mirrors the foundation descriptor). */
  ambientIntensity: number;
  /** Ambient light colour. */
  ambientColor: string;
  /** Hemisphere sky (zenith) fill colour. */
  hemisphereSky: string;
  /** Hemisphere ground fill colour. */
  hemisphereGround: string;
}

/** Street furniture configuration for a single era. */
export interface FurnitureConfig {
  /** Which lamp post silhouette to place. */
  lampStyle: LampStyle;
  /** Lamp pole / housing colour. */
  lampColor: string;
  /** Lamp head emissive colour (the "bulb"). */
  lampEmissive: string;
  /** String telegraph wires across the road (1945). */
  telegraphWires: boolean;
  /** Overhead power lines across the road (1965+). */
  powerLines: boolean;
  /** Traffic signals present (1985+). */
  signalStyle: SignalStyle | null;
  /** Plain concrete street furniture (1985). */
  concreteFurniture: boolean;
  /** Street planters (2005+). */
  planters: boolean;
  /** Smart sensors / cameras mounted on poles (2025). */
  sensors: boolean;
  /** Hovering surveillance drone (2025). */
  drone: boolean;
}

/** Complete era configuration consumed by the StreetEnvironment module. */
export interface EraStreetConfig {
  road: RoadConfig;
  sky: SkyConfig;
  sun: SunConfig;
  lighting: LightingConfig;
  furniture: FurnitureConfig;
}

/**
 * Era-to-environment configuration.
 *
 * Lighting values intentionally mirror the foundation `ERA_REGISTRY`
 * mood hints (muted/somber 1945, bright pastel 1965, electric 1985,
 * sleek/cool 2005, clean/futuristic 2025) and its `lighting` block.
 */
export const STREET_CONFIG: Record<EraId, EraStreetConfig> = {
  1945: {
    road: {
      baseColor: '#5b5449',
      roughness: 0.95,
      metalness: 0,
      surface: 'cobblestone',
      paintedLines: false,
      bikeLanes: false,
      smartMarkers: false,
    },
    sky: {
      topColor: '#c9a97e',
      horizonColor: '#b8b3a8',
      sunColor: '#ffd9a0',
      haze: 0.35,
    },
    sun: {
      position: [8, 6, 5],
      intensity: 0.9,
      color: '#ffd9b0',
    },
    lighting: {
      ambientIntensity: 0.35,
      ambientColor: '#d8c9b0',
      hemisphereSky: '#c9b59a',
      hemisphereGround: '#4a443e',
    },
    furniture: {
      lampStyle: 'period',
      lampColor: '#3a332b',
      lampEmissive: '#ff9a3c',
      telegraphWires: true,
      powerLines: false,
      signalStyle: null,
      concreteFurniture: false,
      planters: false,
      sensors: false,
      drone: false,
    },
  },
  1965: {
    road: {
      baseColor: '#3b3f45',
      roughness: 0.85,
      metalness: 0,
      surface: 'asphalt',
      paintedLines: false,
      bikeLanes: false,
      smartMarkers: false,
    },
    sky: {
      topColor: '#5b9bd5',
      horizonColor: '#a9c4de',
      sunColor: '#fff4d6',
      haze: 0.12,
    },
    sun: {
      position: [10, 12, 7],
      intensity: 1.1,
      color: '#fff2d0',
    },
    lighting: {
      ambientIntensity: 0.45,
      ambientColor: '#dce8f2',
      hemisphereSky: '#a9c4de',
      hemisphereGround: '#4a5a66',
    },
    furniture: {
      lampStyle: 'midcentury',
      lampColor: '#4a5560',
      lampEmissive: '#ffd27a',
      telegraphWires: false,
      powerLines: true,
      signalStyle: null,
      concreteFurniture: false,
      planters: false,
      sensors: false,
      drone: false,
    },
  },
  1985: {
    road: {
      baseColor: '#2e3138',
      roughness: 0.8,
      metalness: 0,
      surface: 'asphalt',
      paintedLines: true,
      bikeLanes: false,
      smartMarkers: false,
    },
    sky: {
      topColor: '#6b7a99',
      horizonColor: '#b3a896',
      sunColor: '#ffd9a0',
      haze: 0.65,
    },
    sun: {
      position: [10, 14, 6],
      intensity: 0.85,
      color: '#ffe0b0',
    },
    lighting: {
      ambientIntensity: 0.4,
      ambientColor: '#c9c4d8',
      hemisphereSky: '#8a93b8',
      hemisphereGround: '#2a2d3a',
    },
    furniture: {
      lampStyle: 'midcentury',
      lampColor: '#5a5f6a',
      lampEmissive: '#ffce6b',
      telegraphWires: false,
      powerLines: true,
      signalStyle: 'early',
      concreteFurniture: true,
      planters: false,
      sensors: false,
      drone: false,
    },
  },
  2005: {
    road: {
      baseColor: '#34383f',
      roughness: 0.78,
      metalness: 0,
      surface: 'asphalt',
      paintedLines: true,
      bikeLanes: true,
      smartMarkers: false,
    },
    sky: {
      topColor: '#4a90c9',
      horizonColor: '#9fc4d8',
      sunColor: '#fff6e0',
      haze: 0.18,
    },
    sun: {
      position: [12, 16, 8],
      intensity: 1.25,
      color: '#fff4d8',
    },
    lighting: {
      ambientIntensity: 0.5,
      ambientColor: '#e4eef6',
      hemisphereSky: '#9fc4d8',
      hemisphereGround: '#4a5560',
    },
    furniture: {
      lampStyle: 'modern',
      lampColor: '#6a7078',
      lampEmissive: '#f4f6f8',
      telegraphWires: false,
      powerLines: true,
      signalStyle: 'modern',
      concreteFurniture: false,
      planters: true,
      sensors: false,
      drone: false,
    },
  },
  2025: {
    road: {
      baseColor: '#26282e',
      roughness: 0.5,
      metalness: 0.1,
      surface: 'smooth',
      paintedLines: true,
      bikeLanes: true,
      smartMarkers: true,
    },
    sky: {
      topColor: '#3f7fc4',
      horizonColor: '#7fb6d9',
      sunColor: '#fff8ea',
      haze: 0.08,
    },
    sun: {
      position: [14, 18, 9],
      intensity: 1.4,
      color: '#fff6e2',
    },
    lighting: {
      ambientIntensity: 0.55,
      ambientColor: '#eaf2f8',
      hemisphereSky: '#7fb6d9',
      hemisphereGround: '#3a4a58',
    },
    furniture: {
      lampStyle: 'led',
      lampColor: '#d8dde2',
      lampEmissive: '#dff3ff',
      telegraphWires: false,
      powerLines: true,
      signalStyle: 'smart',
      concreteFurniture: false,
      planters: true,
      sensors: true,
      drone: true,
    },
  },
};