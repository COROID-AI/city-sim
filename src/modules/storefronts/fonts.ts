/**
 * Period font stacks used by the canvas signage generators.
 *
 * Kept to system fonts so signage renders without any network fetches.
 * Each era's signage picks a stack that evokes its period typography:
 * 1945 serif hand-lettering, 1965 heavy Pop sans, 1985 condensed neon,
 * 2005 clean corporate sans, and 2025 minimal light sans.
 */
export const FONTS = {
  /** Serif — 1940s hand-painted storefronts & posters. */
  serif: `Georgia, 'Times New Roman', serif`,
  /** Slab serif — 1940s/50s poster headlines. */
  slab: `Georgia, 'Times New Roman', serif`,
  /** Heavy condensed sans — 1960s Pop / mid-century. */
  boldSans: `Impact, 'Arial Black', sans-serif`,
  /** Condensed sans — 1980s neon signage. */
  condensed: `'Arial Narrow', Arial, sans-serif`,
  /** Clean sans — 2000s corporate signage. */
  cleanSans: `Arial, Helvetica, sans-serif`,
  /** Light sans — 2020s minimal signage. */
  lightSans: `'Segoe UI Light', 'Helvetica Neue Light', Arial, sans-serif`,
  /** Monospace — technical / digital accents. */
  mono: `'Courier New', monospace`,
} as const;

export type FontKey = keyof typeof FONTS;
