/**
 * Per-era vehicle configuration.
 *
 * Keyed off the foundation era registry (`EraId`), this defines the traffic
 * mix, palette, two-tone accents, livery colours, speed range and density for
 * each of the five eras. `generateInstances` turns a config into a concrete,
 * deterministic fleet of `VehicleInstance`s (seeded per era) so the same era
 * always produces the same traffic on every visit.
 */
import type { EraId } from '../contracts';
import type { VehicleInstance, VehicleTypeId } from './vehicleTypes';

export interface EraVehicleConfig {
  /** Total number of vehicles in the fleet. */
  trafficCount: number;
  /** Weighted mix of vehicle body types. */
  mix: { type: VehicleTypeId; weight: number }[];
  /** Body colours for this era. */
  palette: string[];
  /** Two-tone accent colours, or null when the era is single-tone. */
  accents: string[] | null;
  /** Livery colours (ride-share / fleet), or null. */
  livery: string[] | null;
  /** [min, max] driving speed in world units / second. */
  speed: [number, number];
  /** Whether the era's fleet includes an autonomous robo-taxi nod. */
  roboTaxi?: boolean;
}

export const ERA_VEHICLE_CONFIG: Record<EraId, EraVehicleConfig> = {
  '1945': {
    trafficCount: 6,
    mix: [
      { type: 'sedan', weight: 0.7 },
      { type: 'pickup', weight: 0.3 },
    ],
    palette: ['#3d403a', '#4a3b30', '#2f3438', '#54463a', '#37423d'],
    accents: ['#d9d2c2', '#c9c0ae', '#e2dac8'],
    livery: null,
    speed: [1.8, 3.0],
  },
  '1965': {
    trafficCount: 9,
    mix: [
      { type: 'sedan', weight: 0.4 },
      { type: 'wagon', weight: 0.25 },
      { type: 'muscle', weight: 0.2 },
      { type: 'pickup', weight: 0.15 },
    ],
    palette: ['#2f6f8a', '#a8322a', '#3f6f4a', '#7a5a9e', '#c98a2e', '#1f5f8a'],
    accents: ['#e8e4da', '#f2eee4', '#ffffff', '#d8d2c4'],
    livery: null,
    speed: [2.0, 3.4],
  },
  '1985': {
    trafficCount: 11,
    mix: [
      { type: 'hatchback', weight: 0.45 },
      { type: 'sedan85', weight: 0.4 },
      { type: 'van', weight: 0.15 },
    ],
    palette: ['#b8bec4', '#a8322a', '#1f3a8a', '#2a2a2e', '#e0e0e0', '#8a1f2e', '#c9d0d6'],
    accents: ['#2a2a2e', '#e0e0e0', '#1f3a8a'],
    livery: null,
    speed: [2.2, 3.8],
  },
  '2005': {
    trafficCount: 14,
    mix: [
      { type: 'suv', weight: 0.35 },
      { type: 'crossover', weight: 0.3 },
      { type: 'minivan', weight: 0.2 },
      { type: 'sedan85', weight: 0.15 },
    ],
    palette: ['#9aa0a6', '#2e3a45', '#a83232', '#1f5f8a', '#e8e8e8', '#3a3a3a', '#6a6f75'],
    accents: ['#e8e8e8', '#2e3a45'],
    livery: null,
    speed: [2.4, 4.0],
  },
  '2025': {
    trafficCount: 17,
    mix: [
      { type: 'evSedan', weight: 0.3 },
      { type: 'evCrossover', weight: 0.3 },
      { type: 'evVan', weight: 0.15 },
      { type: 'rideShare', weight: 0.25 },
    ],
    palette: ['#d8d8d8', '#2a2c30', '#5a5f66', '#8a8f96', '#1f2a3a', '#e8e8e8', '#3a3f45'],
    accents: ['#2a2c30', '#e8e8e8'],
    livery: ['#00a0e0', '#e8e8e8', '#3a3a3a', '#2a2c30'],
    speed: [2.6, 4.4],
    roboTaxi: true,
  },
};

/** Small deterministic string hash used to seed each era's fleet. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const LOOP_COUNT = 2;

/**
 * Build a deterministic fleet for an era.
 * Optionally accepts an explicit seed for reproducible previews.
 */
export function generateInstances(
  config: EraVehicleConfig,
  era: EraId,
  seed?: number,
): VehicleInstance[] {
  let h = seed ?? hashString(`vehicles:${era}`);
  const rand = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };

  const totalWeight = config.mix.reduce((sum, m) => sum + m.weight, 0);
  const instances: VehicleInstance[] = [];

  for (let i = 0; i < config.trafficCount; i++) {
    let r = rand() * totalWeight;
    let type: VehicleTypeId = config.mix[config.mix.length - 1].type;
    for (const m of config.mix) {
      r -= m.weight;
      if (r <= 0) {
        type = m.type;
        break;
      }
    }

    const bodyColor = config.palette[Math.floor(rand() * config.palette.length)];
    const accentColor = config.accents
      ? config.accents[Math.floor(rand() * config.accents.length)]
      : null;
    const liveryColor = config.livery
      ? config.livery[Math.floor(rand() * config.livery.length)]
      : null;

    const loopIndex = i % LOOP_COUNT;
    const speed = config.speed[0] + rand() * (config.speed[1] - config.speed[0]);
    const phase = rand();
    const direction: 1 | -1 = loopIndex === 0 ? 1 : -1;

    instances.push({ id: i, type, bodyColor, accentColor, liveryColor, loopIndex, speed, phase, direction });
  }

  if (config.roboTaxi) {
    instances.push({
      id: instances.length,
      type: 'roboTaxi',
      bodyColor: '#e8e8e8',
      accentColor: '#00a0e0',
      liveryColor: '#00a0e0',
      loopIndex: instances.length % LOOP_COUNT,
      speed: config.speed[0] + rand() * (config.speed[1] - config.speed[0]),
      phase: rand(),
      direction: 1,
    });
  }

  return instances;
}
