/**
 * CityCanvas - top-level canvas host.
 *
 * Visual implementation will be added by the downstream
 * "Render citizens and add hover tooltip" task. For now we expose a
 * minimal placeholder so the static export builds and the systems
 * layer can be exercised end-to-end.
 */
export function CityCanvas() {
  return (
    <div
      className="bg-ground border border-border rounded-md p-4 text-sm text-muted"
      data-testid="city-canvas-placeholder"
    >
      City canvas placeholder. Citizen rendering lands in the next task.
    </div>
  );
}
