/**
 * Seedable mulberry32 PRNG.
 *
 * Lives in `@/lib` so the renderer can use the same RNG the systems
 * layer uses, which keeps initial state visually consistent across
 * SSR + hydration.
 */

export type Rng = () => number;

export function createRng(seed: number | undefined): Rng {
  if (seed === undefined) return Math.random;
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
