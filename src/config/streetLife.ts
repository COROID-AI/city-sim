/**
 * Era-specific street-life configuration.
 *
 * Describes the visual identity of pedestrians and vehicles for each time
 * period. Consumed by the {@link Pedestrians} and {@link Vehicles} components
 * to pick period-appropriate outfit palettes, body silhouettes, and vehicle
 * models.
 */
import type { EraId } from './years';

/** A single pedestrian outfit definition. */
export interface PedestrianOutfit {
  /** Shirt / torso colour as a hex string. */
  readonly shirt: string;
  /** Trousers / skirt colour as a hex string. */
  readonly pants: string;
  /** Skin-tone colour for the head. */
  readonly skin: string;
  /** Hair / hat colour. */
  readonly hair: string;
  /** Relative body height multiplier (0.8 = short, 1.2 = tall). */
  readonly heightScale: number;
}

/** Supported vehicle silhouette archetypes. */
export type VehicleSilhouette =
  | 'classic'
  | 'sedan'
  | 'ev'
  | 'truck';

/** Visual definition for a vehicle archetype. */
export interface VehicleStyle {
  /** Silhouette archetype key. */
  readonly silhouette: VehicleSilhouette;
  /** Body paint colour. */
  readonly body: string;
  /** Roof / cabin colour (may equal body). */
  readonly roof: string;
  /** Wheel colour. */
  readonly wheel: string;
  /** Overall length multiplier. */
  readonly length: number;
  /** Overall height multiplier. */
  readonly height: number;
}

/**
 * Full street-life palette for a single era.
 */
export interface StreetLifeConfig {
  /** Era this config belongs to. */
  readonly era: EraId;
  /** Pool of pedestrian outfits; agents pick one at random. */
  readonly outfits: readonly PedestrianOutfit[];
  /** Pool of vehicle styles; traffic picks one at random. */
  readonly vehicles: readonly VehicleStyle[];
  /** Number of pedestrians to spawn for this era. */
  readonly pedestrianCount: number;
  /** Number of vehicles to spawn for this era. */
  readonly vehicleCount: number;
}

/* -------------------------------------------------------------------------- */
/* Per-era definitions                                                         */
/* -------------------------------------------------------------------------- */

const POSTWAR: StreetLifeConfig = {
  era: 'postwar',
  outfits: [
    { shirt: '#5b6b4a', pants: '#3a3a2a', skin: '#d4a373', hair: '#3b2a1a', heightScale: 0.95 },
    { shirt: '#6b4a3a', pants: '#2a2a2a', skin: '#c4956a', hair: '#2a1a0a', heightScale: 1.0 },
    { shirt: '#4a4a5b', pants: '#3a3530', skin: '#e0b88a', hair: '#4a3520', heightScale: 0.9 },
    { shirt: '#7a5a3a', pants: '#4a4030', skin: '#d4a373', hair: '#3b2a1a', heightScale: 1.05 },
  ],
  vehicles: [
    { silhouette: 'classic', body: '#5a2a2a', roof: '#3a1a1a', wheel: '#1a1a1a', length: 1.1, height: 0.9 },
    { silhouette: 'classic', body: '#2a3a5a', roof: '#1a2a3a', wheel: '#1a1a1a', length: 1.0, height: 0.85 },
    { silhouette: 'classic', body: '#3a3a2a', roof: '#2a2a1a', wheel: '#1a1a1a', length: 1.05, height: 0.9 },
  ],
  pedestrianCount: 12,
  vehicleCount: 4,
};

const SIXTIES: StreetLifeConfig = {
  era: 'sixties',
  outfits: [
    { shirt: '#c94f7a', pants: '#2a2a4a', skin: '#e0b88a', hair: '#2a1a0a', heightScale: 1.0 },
    { shirt: '#4f8ac9', pants: '#3a3a3a', skin: '#d4a373', hair: '#3a2a1a', heightScale: 1.05 },
    { shirt: '#c9a54f', pants: '#4a2a2a', skin: '#c4956a', hair: '#1a1a1a', heightScale: 0.95 },
    { shirt: '#7ac94f', pants: '#2a3a2a', skin: '#e0b88a', hair: '#4a3520', heightScale: 1.0 },
  ],
  vehicles: [
    { silhouette: 'classic', body: '#c94f4f', roof: '#8a2a2a', wheel: '#1a1a1a', length: 1.1, height: 0.85 },
    { silhouette: 'sedan', body: '#4f7ac9', roof: '#3a5a8a', wheel: '#1a1a1a', length: 1.0, height: 0.8 },
    { silhouette: 'sedan', body: '#c9c9c9', roof: '#aaaaaa', wheel: '#1a1a1a', length: 1.05, height: 0.85 },
  ],
  pedestrianCount: 14,
  vehicleCount: 5,
};

const EIGHTIES: StreetLifeConfig = {
  era: 'eighties',
  outfits: [
    { shirt: '#ff6f3f', pants: '#2a2a4a', skin: '#e0b88a', hair: '#2a1a0a', heightScale: 1.0 },
    { shirt: '#3f6fff', pants: '#1a1a3a', skin: '#d4a373', hair: '#1a1a1a', heightScale: 1.1 },
    { shirt: '#ff3f8a', pants: '#3a1a3a', skin: '#c4956a', hair: '#4a2a1a', heightScale: 0.95 },
    { shirt: '#3aff8a', pants: '#1a3a2a', skin: '#e0b88a', hair: '#2a2a2a', heightScale: 1.05 },
    { shirt: '#ffff3f', pants: '#3a3a1a', skin: '#d4a373', hair: '#3a2a1a', heightScale: 1.0 },
  ],
  vehicles: [
    { silhouette: 'sedan', body: '#8a8a8a', roof: '#6a6a6a', wheel: '#1a1a1a', length: 1.0, height: 0.8 },
    { silhouette: 'sedan', body: '#3a5a8a', roof: '#2a3a5a', wheel: '#1a1a1a', length: 1.05, height: 0.85 },
    { silhouette: 'truck', body: '#6a3a2a', roof: '#4a2a1a', wheel: '#1a1a1a', length: 1.3, height: 1.1 },
    { silhouette: 'sedan', body: '#aa3a3a', roof: '#8a2a2a', wheel: '#1a1a1a', length: 1.0, height: 0.8 },
  ],
  pedestrianCount: 16,
  vehicleCount: 6,
};

const TWOTHOUSANDS: StreetLifeConfig = {
  era: 'twothousands',
  outfits: [
    { shirt: '#4a4a4a', pants: '#2a2a2a', skin: '#e0b88a', hair: '#2a1a0a', heightScale: 1.0 },
    { shirt: '#6a6a8a', pants: '#3a3a3a', skin: '#d4a373', hair: '#1a1a1a', heightScale: 1.05 },
    { shirt: '#8a4a6a', pants: '#1a1a1a', skin: '#c4956a', hair: '#3a2a1a', heightScale: 0.95 },
    { shirt: '#4a8a6a', pants: '#2a3a2a', skin: '#e0b88a', hair: '#2a2a2a', heightScale: 1.0 },
  ],
  vehicles: [
    { silhouette: 'sedan', body: '#c9c9c9', roof: '#aaaaaa', wheel: '#1a1a1a', length: 1.1, height: 0.85 },
    { silhouette: 'sedan', body: '#3a3a3a', roof: '#2a2a2a', wheel: '#1a1a1a', length: 1.05, height: 0.8 },
    { silhouette: 'truck', body: '#4a4a5a', roof: '#3a3a4a', wheel: '#1a1a1a', length: 1.35, height: 1.15 },
    { silhouette: 'ev', body: '#d4d4d4', roof: '#c4c4c4', wheel: '#2a2a2a', length: 1.0, height: 0.75 },
  ],
  pedestrianCount: 18,
  vehicleCount: 7,
};

const PRESENT: StreetLifeConfig = {
  era: 'present',
  outfits: [
    { shirt: '#2a8acf', pants: '#1a1a2a', skin: '#e0b88a', hair: '#2a1a0a', heightScale: 1.0 },
    { shirt: '#cf2a8a', pants: '#2a1a2a', skin: '#d4a373', hair: '#1a1a1a', heightScale: 1.05 },
    { shirt: '#8acf2a', pants: '#1a2a1a', skin: '#c4956a', hair: '#3a2a1a', heightScale: 0.95 },
    { shirt: '#cf8a2a', pants: '#2a2a1a', skin: '#e0b88a', hair: '#2a2a2a', heightScale: 1.0 },
    { shirt: '#5a5a5a', pants: '#1a1a1a', skin: '#d4a373', hair: '#4a2a1a', heightScale: 1.1 },
  ],
  vehicles: [
    { silhouette: 'ev', body: '#f5f5f5', roof: '#e0e0e0', wheel: '#1a1a1a', length: 1.0, height: 0.7 },
    { silhouette: 'ev', body: '#2a4a6a', roof: '#1a3a5a', wheel: '#1a1a1a', length: 1.05, height: 0.72 },
    { silhouette: 'sedan', body: '#3a3a3a', roof: '#2a2a2a', wheel: '#1a1a1a', length: 1.1, height: 0.8 },
    { silhouette: 'truck', body: '#5a5a6a', roof: '#4a4a5a', wheel: '#1a1a1a', length: 1.4, height: 1.2 },
  ],
  pedestrianCount: 20,
  vehicleCount: 8,
};

/**
 * Lookup table mapping each era to its street-life configuration.
 */
export const STREET_LIFE_CONFIGS: Record<EraId, StreetLifeConfig> = {
  postwar: POSTWAR,
  sixties: SIXTIES,
  eighties: EIGHTIES,
  twothousands: TWOTHOUSANDS,
  present: PRESENT,
};

/**
 * Retrieve the street-life configuration for a given era.
 * Falls back to the present-day config for unknown eras.
 */
export function getStreetLifeConfig(era: EraId): StreetLifeConfig {
  return STREET_LIFE_CONFIGS[era] ?? PRESENT;
}

/**
 * Hard cap on total agents (pedestrians + vehicles) to preserve ≥60 fps.
 * Acceptance criterion: overall agent count stays ≤ 50.
 */
export const MAX_AGENTS = 50;
