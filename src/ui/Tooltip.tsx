/**
 * Tooltip overlay slot.
 *
 * Presentational placeholder. The data-testid="ui-tooltip" attribute is a
 * stable contract for unit tests and future overlay-population tasks.
 */
export function Tooltip() {
  return (
    <div
      data-testid="ui-tooltip"
      className="pointer-events-none absolute z-50 hidden rounded bg-slate-900/90 px-2 py-1 text-xs text-slate-100"
    />
  );
}
