/**
 * Engine utilities shared across pure-TS modules.
 */

/** Clamp a number to the inclusive range [0, 1]. */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}
