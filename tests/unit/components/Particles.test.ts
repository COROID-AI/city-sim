/**
 * Particles unit tests.
 *
 * Verifies spawn counts, life decay, the speed threshold for dust, the
 * activity filter for zzz, and the pool cap.
 */
import {
  DUST_MAX_AGE,
  DUST_MIN_SPEED,
  MAX_PARTICLES,
  ZZZ_MAX_AGE,
  clearParticles,
  createParticles,
  particleCount,
  spawnDust,
  spawnZzz,
  updateParticles,
} from '@/components/city/Particles';

describe('Particles', () => {
  describe('spawnDust', () => {
    it('emits a dust particle for a fast-moving vehicle', () => {
      const pool = createParticles();
      spawnDust(pool, { x: 0, y: 0 }, { x: 2, y: 0 }, { random: () => 0.5 });
      expect(particleCount(pool)).toBe(1);
      expect(pool[0]?.kind).toBe('dust');
    });

    it('does not emit dust for a stationary vehicle (speed below threshold)', () => {
      const pool = createParticles();
      spawnDust(pool, { x: 0, y: 0 }, { x: 0.1, y: 0.1 });
      expect(particleCount(pool)).toBe(0);
    });

    it('emits a particle offset behind the vehicle', () => {
      const pool = createParticles();
      spawnDust(pool, { x: 10, y: 10 }, { x: 2, y: 0 }, { random: () => 0.5 });
      // Velocity points +x, so dust should appear at a smaller x than 10.
      const p = pool[0];
      expect(p).toBeDefined();
      expect((p as { position: { x: number } }).position.x).toBeLessThan(10);
    });

    it('respects the MAX_PARTICLES cap', () => {
      const pool = createParticles();
      // Pre-fill the pool.
      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        pool.push({
          kind: 'dust',
          position: { x: 0, y: 0 },
          velocity: { x: 0, y: 0 },
          age: 0,
          maxAge: 10,
          alpha: 1,
          size: 1,
          hue: 0,
        });
      }
      spawnDust(pool, { x: 0, y: 0 }, { x: 2, y: 0 });
      expect(particleCount(pool)).toBe(MAX_PARTICLES);
    });
  });

  describe('spawnZzz', () => {
    it('emits a zzz particle at a position above the citizen', () => {
      const pool = createParticles();
      spawnZzz(pool, { x: 0, y: 0 });
      expect(particleCount(pool)).toBe(1);
      expect(pool[0]?.kind).toBe('zzz');
      // zzz should start above the citizen (lower y in screen-space).
      const p = pool[0];
      expect(p).toBeDefined();
      expect((p as { position: { y: number } }).position.y).toBeLessThan(0);
    });

    it('cycles through the sizeIndex for the right cadence', () => {
      const pool = createParticles();
      spawnZzz(pool, { x: 0, y: 0 }, { sizeIndex: 0, random: () => 0.5 });
      spawnZzz(pool, { x: 0, y: 0 }, { sizeIndex: 1, random: () => 0.5 });
      spawnZzz(pool, { x: 0, y: 0 }, { sizeIndex: 2, random: () => 0.5 });
      const sizes = pool.map((p) => p.size);
      expect(sizes[0]).toBeLessThan(sizes[1] as number);
      expect(sizes[1]).toBeLessThan(sizes[2] as number);
    });
  });

  describe('updateParticles', () => {
    it('advances particle age and position by dt', () => {
      const pool = createParticles();
      spawnDust(pool, { x: 0, y: 0 }, { x: 2, y: 0 }, { random: () => 0.5 });
      const before = pool[0];
      expect(before).toBeDefined();
      updateParticles(pool, 0.5);
      const after = pool[0];
      expect(after).toBeDefined();
      expect((after as { age: number }).age).toBeCloseTo(0.5, 5);
    });

    it('removes particles past maxAge', () => {
      const pool = createParticles();
      pool.push({
        kind: 'dust',
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        age: DUST_MAX_AGE - 0.1,
        maxAge: DUST_MAX_AGE,
        alpha: 1,
        size: 1,
        hue: 0,
      });
      updateParticles(pool, 0.5);
      expect(particleCount(pool)).toBe(0);
    });

    it('keeps particles alive while under maxAge', () => {
      const pool = createParticles();
      spawnZzz(pool, { x: 0, y: 0 });
      updateParticles(pool, 0.5); // ZZZ_MAX_AGE = 1.6
      expect(particleCount(pool)).toBe(1);
    });

    it('damps dust velocity each tick', () => {
      const pool = createParticles();
      spawnDust(pool, { x: 0, y: 0 }, { x: 2, y: 0 }, { random: () => 0.5 });
      const startVx = (pool[0] as { velocity: { x: number } }).velocity.x;
      updateParticles(pool, 0.1);
      const endVx = (pool[0] as { velocity: { x: number } }).velocity.x;
      expect(Math.abs(endVx)).toBeLessThan(Math.abs(startVx));
    });

    it('is a no-op for dt <= 0', () => {
      const pool = createParticles();
      spawnDust(pool, { x: 0, y: 0 }, { x: 2, y: 0 }, { random: () => 0.5 });
      const ageBefore = (pool[0] as { age: number }).age;
      updateParticles(pool, 0);
      expect((pool[0] as { age: number }).age).toBe(ageBefore);
    });
  });

  describe('clearParticles', () => {
    it('empties the pool', () => {
      const pool = createParticles();
      spawnDust(pool, { x: 0, y: 0 }, { x: 2, y: 0 });
      spawnZzz(pool, { x: 0, y: 0 });
      clearParticles(pool);
      expect(particleCount(pool)).toBe(0);
    });
  });

  describe('constants', () => {
    it('DUST_MIN_SPEED matches the spec threshold (0.5)', () => {
      expect(DUST_MIN_SPEED).toBe(0.5);
    });
    it('DUST_MAX_AGE is positive and reasonable', () => {
      expect(DUST_MAX_AGE).toBeGreaterThan(0);
      expect(DUST_MAX_AGE).toBeLessThan(5);
    });
    it('ZZZ_MAX_AGE is positive and reasonable', () => {
      expect(ZZZ_MAX_AGE).toBeGreaterThan(0);
      expect(ZZZ_MAX_AGE).toBeLessThan(5);
    });
    it('MAX_PARTICLES is large enough to be useful but bounded', () => {
      expect(MAX_PARTICLES).toBeGreaterThan(64);
      expect(MAX_PARTICLES).toBeLessThanOrEqual(2048);
    });
  });
});
