/**
 * Event Log overlay slot (CityLog).
 *
 * Presentational placeholder. The data-testid="ui-citylog" attribute is a
 * stable contract for unit tests and future overlay-population tasks.
 */
export function CityLog() {
  return (
    <div
      data-testid="ui-citylog"
      className="pointer-events-auto absolute bottom-4 left-4 max-h-48 w-72 overflow-y-auto rounded bg-slate-800/80 p-2 text-xs text-slate-200"
    />
  );
}
