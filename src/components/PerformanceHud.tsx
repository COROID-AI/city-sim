import { useFps } from '../hooks/useFps';

/** Small always-on frame-rate readout shown in the app footer. */
export function PerformanceHud() {
  const fps = useFps();
  const tier = fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'poor';
  return (
    <span className="fps-hud" title="Live frame rate" aria-label={`Frame rate ${fps} fps`}>
      <span className={`fps-dot fps-dot--${tier}`} aria-hidden="true" />
      {fps} fps
    </span>
  );
}
