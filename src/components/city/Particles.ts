/**
 * Particles — tiny engine for the cosmetic particle effects in the city sim.
 *
 * Spec reference: §5.4 Rendering, §6.2 Day/Night cycle (polish).
 *
 * Two effects are supported:
 *   1. Dust behind moving vehicles (emitted when |velocity| > 0.5)
 *   2. "Zzz" glyphs above sleeping citizens (emitted when activity === 'sleep')
 *
 * Both effects use the same lightweight particle pool: a list of records
 * each carrying position, velocity, lifetime, max life, kind, and a small
 * amount of per-particle data (alpha, text). The renderer calls
 * `drawParticles(particles, camera)` once per frame; the particles system
 * is responsible for `update(dt)` and for emitting new ones via
 * `spawnDust` / `spawnZzz`.
 *
 * Layer rule: pure TS, no React, no DOM. The renderer is the only
 * consumer; this module never reads the canvas context itself.
 */

import type { Vector2 } from '@/types/common';

/** Particle kind. */
export type ParticleKind = 'dust' | 'zzz';

/** A single particle. */
export interface Particle {
  kind: ParticleKind;
  /** World position. */
  position: Vector2;
  /** World velocity (units per second). */
  velocity: Vector2;
  /** Seconds since spawn. */
  age: number;
  /** Maximum age in seconds; the particle dies when age >= maxAge. */
  maxAge: number;
  /** Initial alpha (1.0). Multiplied by the fade curve. */
  alpha: number;
  /** Per-particle size in world units (radius for dust, font-size for zzz). */
  size: number;
  /** Per-particle hue offset for dust (the renderer applies it to a base colour). */
  hue: number;
}

/** Minimum speed to emit dust behind a vehicle. */
export const DUST_MIN_SPEED = 0.5;

/** Default particle lifetimes, in seconds. */
export const DUST_MAX_AGE = 1.2;
export const ZZZ_MAX_AGE = 1.6;

/** Maximum particles. We cap the pool so a runaway emitter can't OOM the page. */
export const MAX_PARTICLES = 512;

/** Velocity threshold below which a dust particle is considered "still" (no further drift). */
export const DUST_DRIFT = 0.05;

/** Build an empty particle pool. */
export function createParticles(): Particle[] {
  return [];
}

/**
 * Spawn a dust particle behind a moving vehicle. The particle is
 * emitted slightly behind the vehicle (opposite its velocity) with a
 * random spread. No-op if the pool is full.
 */
export function spawnDust(
  pool: Particle[],
  vehiclePosition: Vector2,
  vehicleVelocity: Vector2,
  options: { random?: () => number } = {},
): void {
  if (pool.length >= MAX_PARTICLES) return;
  const random = options.random ?? Math.random;
  const speed = Math.hypot(vehicleVelocity.x, vehicleVelocity.y);
  if (speed < DUST_MIN_SPEED) return;

  // Normalise velocity, then place the particle slightly behind the vehicle.
  const dirX = vehicleVelocity.x / speed;
  const dirY = vehicleVelocity.y / speed;
  const offset = 1.0 + random() * 0.5;
  const spread = 0.6;

  const particle: Particle = {
    kind: 'dust',
    position: {
      x: vehiclePosition.x - dirX * offset + (random() - 0.5) * spread,
      y: vehiclePosition.y - dirY * offset + (random() - 0.5) * spread,
    },
    // Dust drifts slightly up and slows down quickly.
    velocity: {
      x: -dirX * 0.2 + (random() - 0.5) * 0.1,
      y: -dirY * 0.2 - 0.1 + (random() - 0.5) * 0.1,
    },
    age: 0,
    maxAge: DUST_MAX_AGE,
    alpha: 0.6 + random() * 0.2,
    size: 1.5 + random() * 1.0,
    hue: 30 + random() * 20, // warm dust (orange-tan)
  };
  pool.push(particle);
}

/**
 * Spawn a "Zzz" particle above a sleeping citizen. Three escalating
 * Z sizes ('z', 'Z', 'Z') are cycled to give a nice rising cadence.
 */
export function spawnZzz(
  pool: Particle[],
  citizenPosition: Vector2,
  options: { sizeIndex?: number; random?: () => number } = {},
): void {
  if (pool.length >= MAX_PARTICLES) return;
  const random = options.random ?? Math.random;
  const sizeIndex = options.sizeIndex ?? 0;
  const sizes = [0.8, 1.0, 1.2];
  const size = sizes[sizeIndex % sizes.length] ?? 1.0;

  const particle: Particle = {
    kind: 'zzz',
    position: {
      x: citizenPosition.x + (random() - 0.5) * 0.4,
      y: citizenPosition.y - 2.0 - random() * 0.4,
    },
    velocity: { x: 0.4 + random() * 0.2, y: -0.8 - random() * 0.2 },
    age: 0,
    maxAge: ZZZ_MAX_AGE,
    alpha: 0.9,
    size,
    hue: 200, // cool blue, matches the "sleep" palette
  };
  pool.push(particle);
}

/**
 * Advance every particle by `dt` seconds. Mutates the pool in place.
 * Particles past their `maxAge` are removed; dust particles below
 * `DUST_DRIFT` freeze in place (cheaper to draw).
 */
export function updateParticles(pool: Particle[], dtSeconds: number): void {
  if (dtSeconds <= 0) return;
  // Iterate from the end so we can splice in-place without index drift.
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const p = pool[i];
    if (p === undefined) {
      pool.splice(i, 1);
      continue;
    }
    p.age += dtSeconds;
    if (p.age >= p.maxAge) {
      pool.splice(i, 1);
      continue;
    }
    p.position.x += p.velocity.x * dtSeconds;
    p.position.y += p.velocity.y * dtSeconds;
    // Light damping so dust settles.
    if (p.kind === 'dust') {
      p.velocity.x *= 0.92;
      p.velocity.y *= 0.92;
    }
  }
}

/** Count of particles currently in the pool (test helper). */
export function particleCount(pool: readonly Particle[]): number {
  return pool.length;
}

/** Drop every particle (used on scene reset). */
export function clearParticles(pool: Particle[]): void {
  pool.length = 0;
}
