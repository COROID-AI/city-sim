/**
 * Era vehicle definitions for the vehicles module.
 *
 * Each era exposes a traffic density (count), a speed range, and a weighted
 * list of body types. A body type encodes the *silhouette* (built in the rig)
 * plus per-part colour pools so each vehicle reads as a distinct,
 * era-appropriate machine. Colours are randomised per instance from
 * period-correct pools: muted wartime tones in 1945, bright two-tones and
 * chrome in 1965, metallic/clearcoat in 1985, clean modern hues in 2005, and
 * muted modern tones with ride-share liveries in 2025.
 */
import type { EraId } from '../../contracts';

/** Body part keys used by the shared rig. */
export type PartKey = 'wheels' | 'body' | 'cabin' | 'trim' | 'lights';

export interface VehicleType {
  /** Stable identifier, e.g. "1945-sedan". */
  id: string;
  /** Human label for debugging / future UI. */
  label: string;
  /** Weight used when assigning vehicles to the traffic mix. */
  weight: number;
  /** Per-part colour pools used to randomise each instance. */
  colorPools: Partial<Record<PartKey, string[]>>;
}

export interface EraVehicleConfig {
  /** Traffic density for the era (number of vehicles on the roads). */
  count: number;
  /** Speed range in world units / second (older eras drive slower). */
  speedRange: [number, number];
  types: VehicleType[];
}

const WHEELS = ['#14161a', '#1a1c20', '#101216'];
const DARK_GLASS = ['#1c2228', '#222a32', '#181e24'];
const CHROME = ['#c8ced4', '#dde2e6', '#b8c0c8'];
const AMBER = ['#d8c66a', '#c9b85e', '#e0cf7a'];
const WHITE_LIGHT = ['#f4f8ff', '#e8f0ff', '#ffffff'];
const LED_LIGHT = ['#e8f4ff', '#d0e8ff', '#cfe8ff'];

/** 1945 — muted, wartime austerity palette. */
const BODY_45 = [
  '#4a4a44',
  '#5a5348',
  '#3b4038',
  '#6e6a5e',
  '#37424e',
  '#2f3a33',
  '#56504a',
];
const TRIM_45 = ['#8a8a84', '#b0a98f', '#6f6a5e', '#9a948a'];

/** 1965 — bright, optimistic two-tone palette with chrome. */
const BODY_65 = [
  '#3f7d8c',
  '#d96a3a',
  '#8c3a4a',
  '#4a7a3a',
  '#b0b8c0',
  '#d9a441',
  '#3a5a8c',
  '#7a2f6a',
];

/** 1985 — metallic / clearcoat palette. */
const BODY_85 = [
  '#c04040',
  '#2a6ba8',
  '#e0a030',
  '#3a3a3a',
  '#7a2fa0',
  '#1a8a8a',
  '#d8d8d8',
  '#5a5a5a',
];

/** 2005 — clean, modern palette. */
const BODY_05 = [
  '#2f6f8f',
  '#5a5a5a',
  '#b0b8c0',
  '#7a2f2f',
  '#2f6f4f',
  '#8a8a8a',
  '#c8a030',
  '#3a4a8a',
];

/** 2025 — muted modern palette. */
const BODY_25 = [
  '#3a4654',
  '#6a6f78',
  '#4a545e',
  '#8a9098',
  '#2f3a44',
  '#5a646e',
  '#7a7f86',
];

/** 2025 — ride-share / fleet liveries (brighter, branded). */
const LIVERY = [
  '#1f6fa0',
  '#7a1f4a',
  '#1f8a5a',
  '#d8a020',
  '#5a3a8a',
  '#1f6a8a',
];

const ROBOTAXI = ['#e8eef2', '#cfe0ea', '#b8d0e0'];

/** 1945 — vintage sedans, coupes and a work truck, sparse traffic. */
const CONFIG_1945: EraVehicleConfig = {
  count: 8,
  speedRange: [1.1, 1.6],
  types: [
    {
      id: 'sedan45',
      label: 'Vintage sedan',
      weight: 6,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_45],
        cabin: [...DARK_GLASS],
        trim: [...TRIM_45],
        lights: [...AMBER],
      },
    },
    {
      id: 'coupe45',
      label: 'Vintage coupe',
      weight: 4,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_45],
        cabin: [...DARK_GLASS],
        trim: [...TRIM_45],
        lights: [...AMBER],
      },
    },
    {
      id: 'truck45',
      label: 'Work truck',
      weight: 3,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_45],
        cabin: [...DARK_GLASS],
        trim: [...TRIM_45],
        lights: [...AMBER],
      },
    },
  ],
};

/** 1965 — boxy sedans, wagons and muscle cars, brighter two-tones. */
const CONFIG_1965: EraVehicleConfig = {
  count: 12,
  speedRange: [1.3, 1.9],
  types: [
    {
      id: 'sedan65',
      label: 'Full-size sedan',
      weight: 6,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_65],
        cabin: [...DARK_GLASS],
        trim: [...CHROME],
        lights: [...WHITE_LIGHT],
      },
    },
    {
      id: 'wagon65',
      label: 'Station wagon',
      weight: 4,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_65],
        cabin: [...DARK_GLASS],
        trim: [...CHROME],
        lights: [...WHITE_LIGHT],
      },
    },
    {
      id: 'muscle65',
      label: 'Muscle car',
      weight: 3,
      colorPools: {
        wheels: [...WHEELS],
        body: ['#7a1f1f', '#1f2f6a', '#2f6a1f', '#5a3a1f'],
        cabin: [...DARK_GLASS],
        trim: [...CHROME],
        lights: [...WHITE_LIGHT],
      },
    },
  ],
};

/** 1985 — angular hatchbacks, sedans and vans, metallic/clearcoat. */
const CONFIG_1985: EraVehicleConfig = {
  count: 14,
  speedRange: [1.5, 2.1],
  types: [
    {
      id: 'hatch85',
      label: 'Angular hatchback',
      weight: 6,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_85],
        cabin: [...DARK_GLASS],
        trim: ['#a0a8b0', '#c0c8d0', '#889098'],
        lights: [...WHITE_LIGHT],
      },
    },
    {
      id: 'sedan85',
      label: 'Aero sedan',
      weight: 5,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_85],
        cabin: [...DARK_GLASS],
        trim: ['#a0a8b0', '#c0c8d0', '#889098'],
        lights: [...WHITE_LIGHT],
      },
    },
    {
      id: 'van85',
      label: 'Boxy van',
      weight: 3,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_85],
        cabin: [...DARK_GLASS],
        trim: ['#a0a8b0', '#c0c8d0', '#889098'],
        lights: [...WHITE_LIGHT],
      },
    },
  ],
};

/** 2005 — rounded SUVs, crossovers and minivans, modern palette. */
const CONFIG_2005: EraVehicleConfig = {
  count: 18,
  speedRange: [1.7, 2.4],
  types: [
    {
      id: 'suv05',
      label: 'Rounded SUV',
      weight: 5,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_05],
        cabin: [...DARK_GLASS],
        trim: ['#c0c8cc', '#a0a8b0'],
        lights: [...WHITE_LIGHT],
      },
    },
    {
      id: 'crossover05',
      label: 'Crossover',
      weight: 5,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_05],
        cabin: [...DARK_GLASS],
        trim: ['#c0c8cc', '#a0a8b0'],
        lights: [...WHITE_LIGHT],
      },
    },
    {
      id: 'minivan05',
      label: 'Minivan',
      weight: 3,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_05],
        cabin: [...DARK_GLASS],
        trim: ['#c0c8cc', '#a0a8b0'],
        lights: [...WHITE_LIGHT],
      },
    },
  ],
};

/** 2025 — EVs, crossovers, fleet/ride-share and a robo-taxi. */
const CONFIG_2025: EraVehicleConfig = {
  count: 20,
  speedRange: [1.9, 2.7],
  types: [
    {
      id: 'ev25',
      label: 'Electric sedan',
      weight: 6,
      colorPools: {
        wheels: [...WHEELS],
        body: [...BODY_25],
        cabin: [...DARK_GLASS],
        trim: ['#a0a8b0', '#889098', '#c0c8cc'],
        lights: [...LED_LIGHT],
      },
    },
    {
      id: 'fleet25',
      label: 'Ride-share fleet',
      weight: 5,
      colorPools: {
        wheels: [...WHEELS],
        body: [...LIVERY],
        cabin: [...DARK_GLASS],
        trim: ['#a0a8b0', '#889098'],
        lights: [...LED_LIGHT],
      },
    },
    {
      id: 'robotaxi25',
      label: 'Robo-taxi',
      weight: 2,
      colorPools: {
        wheels: [...WHEELS],
        body: [...ROBOTAXI],
        cabin: [...DARK_GLASS],
        trim: ['#a0a8b0', '#c0c8cc'],
        lights: [...LED_LIGHT],
      },
    },
  ],
};

/** Registry mapping every era to its vehicle configuration. */
export const VEHICLE_CONFIG: Record<EraId, EraVehicleConfig> = {
  1945: CONFIG_1945,
  1965: CONFIG_1965,
  1985: CONFIG_1985,
  2005: CONFIG_2005,
  2025: CONFIG_2025,
};
