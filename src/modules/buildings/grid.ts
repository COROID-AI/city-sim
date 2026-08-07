/**
 * Facade window grid generator.
 *
 * Shared by the building parts so repeated units can be placed procedurally
 * without a component re-render. Kept in its own module so component files
 * stay fast-refresh friendly.
 */

export interface GridOpts {
  /** Horizontal facade extent the grid spans. */
  length: number;
  /** Vertical facade extent the grid spans. */
  height: number;
  windowW: number;
  windowH: number;
  spacingX: number;
  spacingY: number;
  baseY: number;
  inset: number;
}

/**
 * Compute a centred grid of [horizontal, vertical] positions for a facade.
 * Returns raw (h, v) pairs; callers map them onto a facade plane.
 */
export function makeGrid({
  length,
  height,
  windowW,
  windowH,
  spacingX,
  spacingY,
  baseY,
  inset,
}: GridOpts): Array<[number, number]> {
  const cols = Math.max(
    1,
    Math.floor((length - 2 * inset + spacingX) / (windowW + spacingX)),
  );
  const rows = Math.max(
    1,
    Math.floor((height - baseY - inset + spacingY) / (windowH + spacingY)),
  );
  const occupied = cols * windowW + (cols - 1) * spacingX;
  const start = -occupied / 2;
  const out: Array<[number, number]> = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      out.push([
        start + c * (windowW + spacingX),
        baseY + inset + r * (windowH + spacingY),
      ]);
    }
  }
  return out;
}
