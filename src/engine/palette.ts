/**
 * Color palette — semantic keys mapped to Tailwind v4 @theme tokens
 * (see spec 6.1).
 *
 * The renderer reads from CSS variables at runtime when a DOM is present
 * (Tailwind compiles them to e.g. `--color-ground: #...`), falling back to
 * deterministic hex values when no DOM is available (e.g. in node tests).
 * The fallback values match the dark-theme defaults in the design tokens.
 *
 * Logical keys (per spec 6.1):
 *   - surface: app background
 *   - ground:  base cell tint
 *   - road:    main/secondary road tint
 *   - building: building fill
 *   - citizen: citizen sprite tint (unused in this phase; reserved)
 *   - accent:  highlights / focus / selection
 *   - warning: alerts / negative feedback
 */

export type PaletteKey =
  | 'surface'
  | 'ground'
  | 'road'
  | 'building'
  | 'citizen'
  | 'accent'
  | 'warning';

/**
 * Deterministic fallback colors. These match the dark-theme defaults used
 * by the Tailwind v4 @theme tokens. Order MUST stay stable so depth-sort
 * tests are reproducible.
 */
export const PALETTE_FALLBACK: Readonly<Record<PaletteKey, string>> = Object.freeze({
  surface: '#0b1220',
  ground: '#1f2937',
  road: '#374151',
  building: '#9ca3af',
  citizen: '#fde68a',
  accent: '#38bdf8',
  warning: '#f97316',
});

/**
 * Tailwind v4 exposes theme colors as CSS variables of the form
 * `--color-<name>`. We map our logical keys to those variable names.
 */
export const PALETTE_CSS_VARS: Readonly<Record<PaletteKey, string>> = Object.freeze({
  surface: '--color-surface',
  ground: '--color-ground',
  road: '--color-road',
  building: '--color-building',
  citizen: '--color-citizen',
  accent: '--color-accent',
  warning: '--color-warning',
});

/**
 * Resolve a palette key to a concrete CSS color string.
 *
 * Resolution order:
 *   1. If an explicit override is provided, return it.
 *   2. If a DOM is available and the CSS variable is defined, return it.
 *   3. Otherwise, return the deterministic fallback.
 *
 * The function is intentionally pure and side-effect free so tests can
 * call it with explicit overrides to assert fallback behavior.
 */
export function resolvePaletteColor(
  key: PaletteKey,
  options: {
    /** Explicit override (bypasses DOM lookup). */
    override?: string;
    /** Injected document (defaults to globalThis.document). */
    documentLike?: DocumentLike | null;
  } = {},
): string {
  if (options.override !== undefined) {
    return options.override;
  }
  const doc = options.documentLike ?? getDocumentLike();
  if (doc !== null) {
    const varName = PALETTE_CSS_VARS[key];
    const value = readCssVar(doc, varName);
    if (value !== null) {
      return value;
    }
  }
  return PALETTE_FALLBACK[key];
}

/** Minimal document shape we need for CSS-variable lookup. */
export interface DocumentLike {
  readonly documentElement: ElementLike;
}

export interface ElementLike {
  readonly ownerDocument: DocumentLike | null;
  // In jsdom and real browsers, Element exposes getComputedStyle on the
  // owner document. We model it as a function on the document to keep the
  // dependency injection simple and easy to mock in tests.
}

/**
 * Read a CSS custom property from `:root` (or the given document's
 * documentElement). Returns null when unavailable.
 */
function readCssVar(doc: DocumentLike, varName: string): string | null {
  // We model getComputedStyle on the documentElement to avoid pulling the
  // real CSSStyleDeclaration type into the engine module. Callers that
  // pass a real document will get the real value; tests pass a mock.
  const el = doc.documentElement as unknown as {
    ownerDocument?: unknown;
  };
  const ownerRaw = el.ownerDocument !== undefined ? el.ownerDocument : doc;
  const owner = ownerRaw as {
    defaultView?: {
      getComputedStyle?: (e: unknown, pseudo?: string | null) => {
        getPropertyValue: (n: string) => string;
      } | null;
    } | null;
  } | null;
  if (!owner) return null;
  const getComputedStyleFn = owner.defaultView?.getComputedStyle;
  if (typeof getComputedStyleFn !== 'function') return null;
  const style = getComputedStyleFn(el, null);
  if (!style) return null;
  const raw = style.getPropertyValue(varName).trim();
  if (raw === '') return null;
  return raw;
}

function getDocumentLike(): DocumentLike | null {
  const g = globalThis as { document?: DocumentLike };
  return g.document ?? null;
}
