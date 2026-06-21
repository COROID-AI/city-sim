/**
 * Mini-map overlay slot.
 *
 * Presentational placeholder. The data-testid="ui-minimap" attribute is a
 * stable contract for unit tests and future overlay-population tasks.
 */
export function MiniMap() {
  return (
    <div
      data-testid="ui-minimap"
      className="pointer-events-auto absolute right-4 top-16 h-40 w-40 rounded bg-slate-800/80"
    />
  );
}
