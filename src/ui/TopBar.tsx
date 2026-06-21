/**
 * Top Bar overlay slot.
 *
 * Presentational placeholder. The data-testid="ui-topbar" attribute is a
 * stable contract for unit tests and future overlay-population tasks.
 */
export function TopBar() {
  return (
    <div
      data-testid="ui-topbar"
      className="pointer-events-auto absolute left-0 right-0 top-0 flex h-12 items-center gap-4 bg-slate-800/80 px-4 text-slate-100"
    >
      <span className="font-bold">City Sim</span>
    </div>
  );
}
