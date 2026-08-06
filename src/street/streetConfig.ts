import type { EraId } from '../contracts';

/**
 * Street & environment configuration.
 *
 * This module is keyed off the shared era registry (EraId) and holds every
 * era-variant visual decision for the street layer: the road surface, street
 * furniture, sky, and lighting mood. It is intentionally self-contained so it
 * can be dropped into any R3F canvas without depending on other modules.
 */

/** Lamp post styling per era. */
export type LampStyle = 'period' | 'midcentury' | 'concrete' | 'modern' | 'led';

/** Traffic signal styling per era. */
export type SignalStyle = 'none' | 'early' | 'modern';

/** Era-variant sky: gradient colors + sun placement/glow + atmospheric haze. */
export interface SkyConfig {
  /** Zenith (top) color. */
  topColor: string;
  /** Horizon color. */
  horizonColor: string;
  /** Sun disc / glow color. */
  sunColor: string;
  /** Normalized direction the sun sits at (drives the glow + directional light). */
  sunDirection: [number, number, number];
  /** Sun glow strength. */
  sunIntensity: number;
  /** 0..1 atmospheric haze / smog that washes the sky toward the horizon. */
  haze: number;
}

/** Era-variant lighting mood (ambient + directional sun). */
export interface LightingConfig {
  ambientIntensity: number;
  hemisphereSky: string;
  hemisphereGround: string;
  sunColor: string;
  sunPosition: [number, number, number];
  sunIntensity: number;
}

/** Era-variant road surface + markings. */
export interface RoadConfig {
  surfaceColor: string;
  roughness: number;
  /** 1945: worn cobblestone setts laid over the asphalt. */
  cobblestone: boolean;
  /** 1985+: painted dashed center line. */
  paintedCenterLine: boolean;
  /** 2005+: marked asphalt with crisp lane lines. */
  laneMarkings: boolean;
  /** 2005+: colored bike lanes at the road edges. */
  bikeLanes: boolean;
  /** 2025: smart road with embedded LED guide strips. */
  smartRoad: boolean;
  /** 2025: sensor / camera nodes embedded in the road. */
  sensors: boolean;
}

/** Era-variant street furniture. */
export interface FurnitureConfig {
  lampStyle: LampStyle;
  lampColor: string;
  lampIntensity: number;
  /** 1945: sagging telegraph wires strung between poles. */
  telegraphWires: boolean;
  /** 1965: overhead power lines on cross-arm poles. */
  overheadPowerLines: boolean;
  signalStyle: SignalStyle;
  /** 1985: concrete street furniture (benches + bollards). */
  concreteFurniture: boolean;
  /** 2005+: planters along the curb. */
  planters: boolean;
  /** 2025: surveillance cameras on poles. */
  cameras: boolean;
  /** 2025: autonomous patrol drone. */
  drone: boolean;
  /** 2025: street-side greenery / trees. */
  greenery: boolean;
}

/** Complete per-era street & environment configuration. */
export interface StreetEraConfig {
  era: EraId;
  sky: SkyConfig;
  lighting: LightingConfig;
  road: RoadConfig;
  furniture: FurnitureConfig;
}

/**
 * Registry of street/environment configuration keyed by EraId.
 * Every era is fully specified so the module renders for all 5 years.
 */
export const STREET_ERA_CONFIG: Record<EraId, StreetEraConfig> = {
  '1945': {
    era: '1945',
    sky: {
      topColor: '#8a7a5e',
      horizonColor: '#cbb493',
      sunColor: '#ffd9a0',
      sunDirection: [0.25, 0.32, 0.5],
      sunIntensity: 0.85,
      haze: 0.18,
    },
    lighting: {
      ambientIntensity: 0.32,
      hemisphereSky: '#d8c6a4',
      hemisphereGround: '#6b5c48',
      sunColor: '#ffd9a0',
      sunPosition: [6, 7, 12],
      sunIntensity: 0.75,
    },
    road: {
      surfaceColor: '#3a3a3d',
      roughness: 0.95,
      cobblestone: true,
      paintedCenterLine: false,
      laneMarkings: false,
      bikeLanes: false,
      smartRoad: false,
      sensors: false,
    },
    furniture: {
      lampStyle: 'period',
      lampColor: '#ffc98a',
      lampIntensity: 1.4,
      telegraphWires: true,
      overheadPowerLines: false,
      signalStyle: 'none',
      concreteFurniture: false,
      planters: false,
      cameras: false,
      drone: false,
      greenery: false,
    },
  },
  '1965': {
    era: '1965',
    sky: {
      topColor: '#2f6fb0',
      horizonColor: '#a8c8e2',
      sunColor: '#fff4d6',
      sunDirection: [0.4, 0.55, 0.4],
      sunIntensity: 1.0,
      haze: 0.08,
    },
    lighting: {
      ambientIntensity: 0.42,
      hemisphereSky: '#cfe4f4',
      hemisphereGround: '#7d8894',
      sunColor: '#fff2d8',
      sunPosition: [10, 16, 10],
      sunIntensity: 1.0,
    },
    road: {
      surfaceColor: '#4a4a4d',
      roughness: 0.82,
      cobblestone: false,
      paintedCenterLine: false,
      laneMarkings: false,
      bikeLanes: false,
      smartRoad: false,
      sensors: false,
    },
    furniture: {
      lampStyle: 'midcentury',
      lampColor: '#ffe9c0',
      lampIntensity: 1.1,
      telegraphWires: false,
      overheadPowerLines: true,
      signalStyle: 'none',
      concreteFurniture: false,
      planters: false,
      cameras: false,
      drone: false,
      greenery: false,
    },
  },
  '1985': {
    era: '1985',
    sky: {
      topColor: '#6a7a88',
      horizonColor: '#b8c0c4',
      sunColor: '#ffe9c0',
      sunDirection: [0.35, 0.4, 0.45],
      sunIntensity: 0.9,
      haze: 0.5,
    },
    lighting: {
      ambientIntensity: 0.38,
      hemisphereSky: '#aebcc6',
      hemisphereGround: '#6c7478',
      sunColor: '#ffe9c0',
      sunPosition: [9, 12, 11],
      sunIntensity: 0.85,
    },
    road: {
      surfaceColor: '#3f3f42',
      roughness: 0.85,
      cobblestone: false,
      paintedCenterLine: true,
      laneMarkings: false,
      bikeLanes: false,
      smartRoad: false,
      sensors: false,
    },
    furniture: {
      lampStyle: 'concrete',
      lampColor: '#ffe6b0',
      lampIntensity: 1.2,
      telegraphWires: false,
      overheadPowerLines: false,
      signalStyle: 'early',
      concreteFurniture: true,
      planters: false,
      cameras: false,
      drone: false,
      greenery: false,
    },
  },
  '2005': {
    era: '2005',
    sky: {
      topColor: '#2b6bb0',
      horizonColor: '#bfd4e6',
      sunColor: '#fffbe0',
      sunDirection: [0.45, 0.6, 0.35],
      sunIntensity: 1.15,
      haze: 0.12,
    },
    lighting: {
      ambientIntensity: 0.46,
      hemisphereSky: '#d6e8f6',
      hemisphereGround: '#88939c',
      sunColor: '#fffbe0',
      sunPosition: [12, 18, 9],
      sunIntensity: 1.15,
    },
    road: {
      surfaceColor: '#3c3c3f',
      roughness: 0.7,
      cobblestone: false,
      paintedCenterLine: true,
      laneMarkings: true,
      bikeLanes: true,
      smartRoad: false,
      sensors: false,
    },
    furniture: {
      lampStyle: 'modern',
      lampColor: '#fff2cc',
      lampIntensity: 1.3,
      telegraphWires: false,
      overheadPowerLines: false,
      signalStyle: 'modern',
      concreteFurniture: false,
      planters: true,
      cameras: false,
      drone: false,
      greenery: false,
    },
  },
  '2025': {
    era: '2025',
    sky: {
      topColor: '#1f5fae',
      horizonColor: '#cfe4f2',
      sunColor: '#ffffff',
      sunDirection: [0.5, 0.65, 0.3],
      sunIntensity: 1.3,
      haze: 0.05,
    },
    lighting: {
      ambientIntensity: 0.5,
      hemisphereSky: '#e0f0fa',
      hemisphereGround: '#93a0a8',
      sunColor: '#ffffff',
      sunPosition: [14, 20, 8],
      sunIntensity: 1.3,
    },
    road: {
      surfaceColor: '#34343a',
      roughness: 0.55,
      cobblestone: false,
      paintedCenterLine: true,
      laneMarkings: true,
      bikeLanes: true,
      smartRoad: true,
      sensors: true,
    },
    furniture: {
      lampStyle: 'led',
      lampColor: '#dff2ff',
      lampIntensity: 1.8,
      telegraphWires: false,
      overheadPowerLines: false,
      signalStyle: 'modern',
      concreteFurniture: false,
      planters: true,
      cameras: true,
      drone: true,
      greenery: true,
    },
  },
};

/** Look up the street/environment config for a given era. */
export function getStreetConfig(era: EraId): StreetEraConfig {
  return STREET_ERA_CONFIG[era];
}
