import type { EraId } from '../../contracts';

/**
 * Era-specific street & environment configuration.
 *
 * Every era is keyed off the foundation `EraId` registry and describes the
 * road surface, street furniture, sky, and lighting mood that the
 * `StreetEnvironment` module renders procedurally:
 *
 * - 1945  cobblestone / worn asphalt, period lamp posts, telegraph wires,
 *         sepia-warm sky, softer lighting
 * - 1965  smoother asphalt, mid-century lamps, overhead power lines,
 *         clearer blue sky, balanced daylight
 * - 1985  asphalt with painted lines, concrete street furniture, early
 *         signals, hazy / smoggy sky
 * - 2005  marked asphalt, modern signals, emerging bike lanes, planters,
 *         clearer-but-bright sky
 * - 2025  smooth smart-road surface, LED street lighting, sensors/cameras,
 *         greenery, clear modern sky
 */

/** The material language of the road surface. */
export type RoadSurface = 'cobblestone' | 'asphalt' | 'markedAsphalt' | 'smartRoad';

/** Street furniture lamp style per era. */
export type LampStyle = 'period' | 'midCentury' | 'concrete' | 'modern' | 'led';

/** Traffic signal style per era. */
export type SignalStyle = 'none' | 'early' | 'modern' | 'led';

/** Road surface + markings configuration. */
export interface EraRoadConfig {
  surface: RoadSurface;
  baseColor: string;
  roughness: number;
  /** Dashed center line + edge lines. */
  laneMarkings: boolean;
  /** Dedicated bike lane stripe. */
  bikeLane: boolean;
  /** Worn patches / cracks (1945). */
  wornPatches: boolean;
  /** Embedded LED lane markers (2025 smart road). */
  ledMarkers: boolean;
}

/** Street furniture + fixed infrastructure configuration. */
export interface EraFurnitureConfig {
  lampStyle: LampStyle;
  lampColor: string;
  lampEmissive: string;
  /** Emissive intensity of lamp heads in day vs night. */
  lampDayIntensity: number;
  lampNightIntensity: number;
  /** 1945 — sagging telegraph wires strung between posts. */
  telegraphWires: boolean;
  /** 1965 — overhead power lines strung between posts. */
  overheadPowerLines: boolean;
  signalStyle: SignalStyle;
  /** 1985 — concrete street furniture (benches / bollards). */
  concreteFurniture: boolean;
  /** 2005 / 2025 — roadside planters. */
  planters: boolean;
  /** 2025 — dense greenery / trees. */
  greenery: boolean;
  /** 2025 — smart sensors / cameras. */
  sensors: boolean;
  /** 2025 — traffic cameras. */
  cameras: boolean;
}

/** Era-correct sky + lighting mood. */
export interface EraSkyConfig {
  topColor: string;
  horizonColor: string;
  bottomColor: string;
  /** 0..1 smog/haze — washes colors toward the horizon. */
  haze: number;
  /** Sun direction (world space, not normalized). */
  sunDirection: [number, number, number];
  sunIntensity: number;
  sunColor: string;
  ambientIntensity: number;
  fogColor: string;
  fogDensity: number;
}

/** Complete street & environment config for one era. */
export interface EraStreetConfig {
  road: EraRoadConfig;
  furniture: EraFurnitureConfig;
  sky: EraSkyConfig;
}

export const STREET_BY_ERA: Record<EraId, EraStreetConfig> = {
  1945: {
    road: {
      surface: 'cobblestone',
      baseColor: '#3a3630',
      roughness: 0.96,
      laneMarkings: false,
      bikeLane: false,
      wornPatches: true,
      ledMarkers: false,
    },
    furniture: {
      lampStyle: 'period',
      lampColor: '#2a2620',
      lampEmissive: '#ffc98a',
      lampDayIntensity: 0.35,
      lampNightIntensity: 2.4,
      telegraphWires: true,
      overheadPowerLines: false,
      signalStyle: 'none',
      concreteFurniture: false,
      planters: false,
      greenery: false,
      sensors: false,
      cameras: false,
    },
    sky: {
      topColor: '#8a7050',
      horizonColor: '#d8b892',
      bottomColor: '#c0a078',
      haze: 0.5,
      sunDirection: [6, 5, 8],
      sunIntensity: 0.9,
      sunColor: '#e8c8a0',
      ambientIntensity: 0.35,
      fogColor: '#3a3a3a',
      fogDensity: 0.012,
    },
  },

  1965: {
    road: {
      surface: 'asphalt',
      baseColor: '#4a4a48',
      roughness: 0.85,
      laneMarkings: false,
      bikeLane: false,
      wornPatches: false,
      ledMarkers: false,
    },
    furniture: {
      lampStyle: 'midCentury',
      lampColor: '#3a3f47',
      lampEmissive: '#ffe9b8',
      lampDayIntensity: 0.25,
      lampNightIntensity: 2.0,
      telegraphWires: false,
      overheadPowerLines: true,
      signalStyle: 'none',
      concreteFurniture: false,
      planters: false,
      greenery: false,
      sensors: false,
      cameras: false,
    },
    sky: {
      topColor: '#3f7dd0',
      horizonColor: '#a8c8e8',
      bottomColor: '#cfe0f0',
      haze: 0.15,
      sunDirection: [8, 9, 8],
      sunIntensity: 1.2,
      sunColor: '#fff4e0',
      ambientIntensity: 0.45,
      fogColor: '#cfe0e8',
      fogDensity: 0.006,
    },
  },

  1985: {
    road: {
      surface: 'markedAsphalt',
      baseColor: '#3f3f3c',
      roughness: 0.9,
      laneMarkings: true,
      bikeLane: false,
      wornPatches: true,
      ledMarkers: false,
    },
    furniture: {
      lampStyle: 'concrete',
      lampColor: '#6a6a68',
      lampEmissive: '#ffb347',
      lampDayIntensity: 0.3,
      lampNightIntensity: 2.6,
      telegraphWires: false,
      overheadPowerLines: false,
      signalStyle: 'early',
      concreteFurniture: true,
      planters: false,
      greenery: false,
      sensors: false,
      cameras: false,
    },
    sky: {
      topColor: '#7a8a9a',
      horizonColor: '#b8b8a8',
      bottomColor: '#a89888',
      haze: 0.7,
      sunDirection: [8, 7, 8],
      sunIntensity: 1.1,
      sunColor: '#ffe9a8',
      ambientIntensity: 0.5,
      fogColor: '#a89888',
      fogDensity: 0.02,
    },
  },

  2005: {
    road: {
      surface: 'markedAsphalt',
      baseColor: '#454545',
      roughness: 0.82,
      laneMarkings: true,
      bikeLane: true,
      wornPatches: false,
      ledMarkers: false,
    },
    furniture: {
      lampStyle: 'modern',
      lampColor: '#2f343b',
      lampEmissive: '#fff0c8',
      lampDayIntensity: 0.2,
      lampNightIntensity: 2.2,
      telegraphWires: false,
      overheadPowerLines: false,
      signalStyle: 'modern',
      concreteFurniture: false,
      planters: true,
      greenery: false,
      sensors: false,
      cameras: false,
    },
    sky: {
      topColor: '#4a90d0',
      horizonColor: '#c8dce8',
      bottomColor: '#e0ecf0',
      haze: 0.3,
      sunDirection: [8, 11, 8],
      sunIntensity: 1.5,
      sunColor: '#ffffff',
      ambientIntensity: 0.6,
      fogColor: '#c8dce8',
      fogDensity: 0.005,
    },
  },

  2025: {
    road: {
      surface: 'smartRoad',
      baseColor: '#2e2e30',
      roughness: 0.6,
      laneMarkings: true,
      bikeLane: true,
      wornPatches: false,
      ledMarkers: true,
    },
    furniture: {
      lampStyle: 'led',
      lampColor: '#1f2226',
      lampEmissive: '#cfe8ff',
      lampDayIntensity: 0.4,
      lampNightIntensity: 3.0,
      telegraphWires: false,
      overheadPowerLines: false,
      signalStyle: 'led',
      concreteFurniture: false,
      planters: true,
      greenery: true,
      sensors: true,
      cameras: true,
    },
    sky: {
      topColor: '#2f6fd0',
      horizonColor: '#cfe0f0',
      bottomColor: '#e8f0f8',
      haze: 0.1,
      sunDirection: [8, 13, 8],
      sunIntensity: 1.7,
      sunColor: '#f4f7ff',
      ambientIntensity: 0.7,
      fogColor: '#d8e6f0',
      fogDensity: 0.003,
    },
  },
};
