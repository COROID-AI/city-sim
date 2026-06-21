/**
 * Time Controls overlay slot.
 *
 * Presentational placeholder. The data-testid="ui-timecontrols" attribute is
 * a stable contract for unit tests and future overlay-population tasks.
 */
export function TimeControls() {
  return (
    <div
      data-testid="ui-timecontrols"
      className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded bg-slate-800/80 px-3 py-1 text-slate-100"
    />
  );
}
