/**
 * Per-era particle system configuration.
 *
 * Each era can define one or more particle layers that contribute to its
 * atmospheric mood. The config is consumed by the `Particles` R3F component
 * which animates instanced point sprites every frame.
 */
import type { EraId } from '@/config/years';

/** Describes a single particle layer for an era. */
export interface ParticleLayer {
  /** Stable id used as React key and PRNG seed. */
  readonly id: string;
  /** Number of particles in the layer. */
  readonly count: number;
  /** Particle colour (hex). */
  readonly color: string;
  /** Particle size in world units. */
  readonly size: number;
  /** Opacity at birth (0..1). */
  readonly opacity: number;
  /** Vertical speed (world units / second). Positive = upward. */
  readonly speedY: number;
  /** Horizontal drift amplitude (world units). */
  readonly driftX: number;
  /** Horizontal drift amplitude on Z axis. */
  readonly driftZ: number;
  /** Lifetime in seconds before the particle resets. */
  readonly lifetime: number;
  /** Spawn area centre X. */
  readonly spawnX: number;
  /** Spawn area centre Z. */
  readonly spawnZ: number;
  /** Spawn area radius around centre. */
  readonly spawnRadius: number;
  /** Base Y position for spawning. */
  readonly spawnY: number;
  /** Flicker intensity (0 = none, 1 = full random). Used for neon. */
  readonly flicker: number;
}

/**
 * Particle layers keyed by era.
 *
 * At least three eras have distinct atmospheric effects:
 * - postwar (1945): steam vents rising from building rooftops
 * - eighties (1985): neon flicker particles around signage
 * - present (2025): clean ambient holographic glow motes
 *
 * Additional eras get lighter atmospheric touches.
 */
export const PARTICLE_LAYERS: Record<EraId, readonly ParticleLayer[]> = {
  postwar: [
    {
      id: 'steam-vent',
      count: 120,
      color: '#ccccbb',
      size: 0.6,
      opacity: 0.45,
      speedY: 2.5,
      driftX: 0.8,
      driftZ: 0.6,
      lifetime: 3.0,
      spawnX: 0,
      spawnZ: 0,
      spawnRadius: 30,
      spawnY: 8,
      flicker: 0,
    },
    {
      id: 'exhaust-puff',
      count: 40,
      color: '#8a8a7a',
      size: 0.4,
      opacity: 0.3,
      speedY: 1.2,
      driftX: 1.5,
      driftZ: 0.3,
      lifetime: 2.0,
      spawnX: 0,
      spawnZ: 0,
      spawnRadius: 35,
      spawnY: 1,
      flicker: 0,
    },
  ],
  sixties: [
    {
      id: 'falling-leaves',
      count: 80,
      color: '#c8a040',
      size: 0.35,
      opacity: 0.6,
      speedY: -1.0,
      driftX: 2.0,
      driftZ: 1.5,
      lifetime: 5.0,
      spawnX: 0,
      spawnZ: 0,
      spawnRadius: 40,
      spawnY: 25,
      flicker: 0,
    },
  ],
  eighties: [
    {
      id: 'neon-flicker',
      count: 150,
      color: '#ff00ff',
      size: 0.5,
      opacity: 0.7,
      speedY: 0.3,
      driftX: 0.5,
      driftZ: 0.5,
      lifetime: 1.5,
      spawnX: 0,
      spawnZ: 0,
      spawnRadius: 30,
      spawnY: 3,
      flicker: 0.8,
    },
    {
      id: 'neon-cyan',
      count: 80,
      color: '#00ffff',
      size: 0.4,
      opacity: 0.55,
      speedY: 0.2,
      driftX: 0.4,
      driftZ: 0.3,
      lifetime: 2.0,
      spawnX: 0,
      spawnZ: 0,
      spawnRadius: 25,
      spawnY: 2.5,
      flicker: 0.6,
    },
  ],
  twothousands: [
    {
      id: 'light-rain',
      count: 200,
      color: '#8899aa',
      size: 0.15,
      opacity: 0.35,
      speedY: -8.0,
      driftX: 0.5,
      driftZ: 0.2,
      lifetime: 1.2,
      spawnX: 0,
      spawnZ: 0,
      spawnRadius: 45,
      spawnY: 30,
      flicker: 0,
    },
  ],
  present: [
    {
      id: 'holographic-motes',
      count: 100,
      color: '#00ccff',
      size: 0.3,
      opacity: 0.5,
      speedY: 0.5,
      driftX: 1.0,
      driftZ: 1.0,
      lifetime: 4.0,
      spawnX: 0,
      spawnZ: 0,
      spawnRadius: 35,
      spawnY: 5,
      flicker: 0.3,
    },
    {
      id: 'ambient-glow',
      count: 60,
      color: '#aa66ff',
      size: 0.25,
      opacity: 0.4,
      speedY: 0.3,
      driftX: 0.6,
      driftZ: 0.6,
      lifetime: 5.0,
      spawnX: 0,
      spawnZ: 0,
      spawnRadius: 40,
      spawnY: 8,
      flicker: 0.2,
    },
  ],
};

/**
 * Bloom intensity per era. Higher values make neon and emissive surfaces
 * glow more prominently.
 */
export const BLOOM_INTENSITY: Record<EraId, number> = {
  postwar: 0.3,
  sixties: 0.4,
  eighties: 0.8,
  twothousands: 0.5,
  present: 0.6,
};

/**
 * Look up particle layers for an era. Returns an empty array for unknown ids.
 */
export function getParticleLayers(era: EraId): readonly ParticleLayer[] {
  return PARTICLE_LAYERS[era] ?? [];
}

/**
 * Look up bloom intensity for an era. Falls back to 0.3.
 */
export function getBloomIntensity(era: EraId): number {
  return BLOOM_INTENSITY[era] ?? 0.3;
}
