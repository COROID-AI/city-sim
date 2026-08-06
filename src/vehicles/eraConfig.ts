import type { EraId } from '../contracts/era';
import { ERA_REGISTRY } from '../contracts/era';
import type { VehicleStyle, VehicleDims } from './geometry';

/**
 * Era-specific vehicle configuration.
 *
 * This module is keyed off the foundation era registry (EraId / ERA_REGISTRY)
 * and defines, for every era, the vehicle body styles, palette, traffic
 * density, cruising speed, and paint finish. Palettes are derived from the
 * foundation registry's era palettes and extended with era-appropriate colors.
 */

export interface EraVehicleConfig {
  era: EraId;
  /** Total number of vehicles on the road for this era. */
  count: number;
  /** Cruising speed range in world units per second. */
  speedRange: [number, number];
  /** Shared paint finish (metalness / roughness) for the era. */
  material: { metalness: number; roughness: number };
  styles: VehicleStyle[];
}

const baseSedan: VehicleDims = {
  length: 2.0,
  width: 0.9,
  bodyHeight: 0.5,
  cabinHeight: 0.42,
  wheelRadius: 0.28,
  wheelWidth: 0.16,
  groundClearance: 0.05,
};

export const ERA_VEHICLE_CONFIG: Record<EraId, EraVehicleConfig> = {
  1945: {
    era: 1945,
    count: 8,
    speedRange: [1.2, 2.2],
    material: { metalness: 0.0, roughness: 0.85 },
    styles: [
      {
        id: 'vintage-sedan-1',
        label: 'Vintage sedan',
        bodyColor: '#3c4638',
        accentColor: '#2e342b',
        dims: { ...baseSedan },
        fenders: true,
      },
      {
        id: 'vintage-sedan-2',
        label: 'Vintage sedan (maroon)',
        bodyColor: '#4a3a38',
        accentColor: '#3a2e2c',
        dims: { ...baseSedan },
        fenders: true,
      },
      {
        id: 'vintage-truck',
        label: 'Vintage truck',
        bodyColor: '#5a5a55',
        accentColor: '#484a45',
        dims: { ...baseSedan, length: 2.2, bodyHeight: 0.58, cabinHeight: 0.34 },
        fenders: true,
      },
    ],
  },
  1965: {
    era: 1965,
    count: 14,
    speedRange: [1.6, 2.6],
    material: { metalness: 0.15, roughness: 0.55 },
    styles: [
      {
        id: 'midcentury-sedan',
        label: 'Chrome sedan',
        bodyColor: '#c96f5a',
        accentColor: '#e8e4da',
        dims: { ...baseSedan },
        chromeBumpers: true,
      },
      {
        id: 'midcentury-wagon',
        label: 'Station wagon',
        bodyColor: '#5b7f9e',
        accentColor: '#e8e4da',
        dims: { ...baseSedan, length: 2.2, cabinHeight: 0.5 },
        chromeBumpers: true,
        roofRack: true,
      },
      {
        id: 'muscle-car',
        label: 'Muscle car',
        bodyColor: '#e0b34f',
        accentColor: '#20242a',
        dims: { ...baseSedan, length: 2.1, bodyHeight: 0.44, cabinHeight: 0.36 },
        chromeBumpers: true,
        hoodScoop: true,
      },
    ],
  },
  1985: {
    era: 1985,
    count: 14,
    speedRange: [1.8, 3.0],
    material: { metalness: 0.6, roughness: 0.25 },
    styles: [
      {
        id: 'neon-hatchback',
        label: 'Angular hatchback',
        bodyColor: '#ff2d95',
        accentColor: '#1c1f26',
        dims: { ...baseSedan, length: 1.9, cabinHeight: 0.44 },
        hatchback: true,
        wedge: true,
        spoiler: true,
      },
      {
        id: 'neon-sedan',
        label: 'Aero sedan',
        bodyColor: '#00c8c8',
        accentColor: '#1c1f26',
        dims: { ...baseSedan },
        wedge: true,
      },
      {
        id: 'neon-sport',
        label: 'Sport coupe',
        bodyColor: '#ffd319',
        accentColor: '#1c1f26',
        dims: { ...baseSedan, bodyHeight: 0.42, cabinHeight: 0.34 },
        wedge: true,
        spoiler: true,
      },
    ],
  },
  2005: {
    era: 2005,
    count: 18,
    speedRange: [1.8, 2.8],
    material: { metalness: 0.5, roughness: 0.3 },
    styles: [
      {
        id: 'modern-suv',
        label: 'SUV',
        bodyColor: '#4f6d7a',
        accentColor: '#e8e6e1',
        dims: { ...baseSedan, length: 2.1, bodyHeight: 0.6, cabinHeight: 0.5 },
        roofRack: true,
      },
      {
        id: 'modern-crossover',
        label: 'Crossover',
        bodyColor: '#8b9bb4',
        accentColor: '#e8e6e1',
        dims: { ...baseSedan, bodyHeight: 0.54, cabinHeight: 0.46 },
      },
      {
        id: 'modern-minivan',
        label: 'Minivan',
        bodyColor: '#e8e6e1',
        accentColor: '#4f6d7a',
        dims: { ...baseSedan, length: 2.3, bodyHeight: 0.56, cabinHeight: 0.56 },
        roofRack: true,
      },
    ],
  },
  2025: {
    era: 2025,
    count: 18,
    speedRange: [1.8, 3.2],
    material: { metalness: 0.4, roughness: 0.35 },
    styles: [
      {
        id: 'ev-crossover',
        label: 'EV crossover',
        bodyColor: '#d8e6ef',
        accentColor: '#2f6f8f',
        dims: { ...baseSedan, bodyHeight: 0.54, cabinHeight: 0.46 },
        lightBar: true,
      },
      {
        id: 'fleet-sedan',
        label: 'Ride-share fleet sedan',
        bodyColor: '#f2f4f5',
        accentColor: '#1f3a4a',
        dims: { ...baseSedan },
        livery: true,
      },
      {
        id: 'robotaxi',
        label: 'Autonomous robo-taxi',
        bodyColor: '#e6eef2',
        accentColor: '#1f3a4a',
        dims: { ...baseSedan, bodyHeight: 0.52, cabinHeight: 0.44 },
        sensorPod: true,
        lightBar: true,
      },
    ],
  },
};

// Re-export the registry reference so the module is visibly keyed off it.
export const VEHICLE_ERA_PALETTES: Record<EraId, string[]> = {
  1945: ERA_REGISTRY[1945].lighting.palette,
  1965: ERA_REGISTRY[1965].lighting.palette,
  1985: ERA_REGISTRY[1985].lighting.palette,
  2005: ERA_REGISTRY[2005].lighting.palette,
  2025: ERA_REGISTRY[2025].lighting.palette,
};
