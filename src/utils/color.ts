/**
 * Colour utilities for cross-era interpolation.
 *
 * Used by the sky/background and any material that needs to blend between two
 * year palettes during a timeline transition.
 */

/** Parse a `#rrggbb` string into an [r, g, b] tuple (0..255). */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const value = parseInt(
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean,
    16,
  );
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Format an [r, g, b] tuple (0..255) as a `#rrggbb` string. */
function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const toHex = (n: number) =>
    Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Linearly interpolate between two hex colours. `t` is clamped to [0, 1]. */
export function lerpColor(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const k = clamp(t, 0, 1);
  return rgbToHex([
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ]);
}

/** Clamp a number into an inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
