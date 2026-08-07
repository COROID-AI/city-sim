import { useCameraStore } from '../store/useCameraStore';
import { setFlyKey } from '../store/flyInput';

interface CameraHudProps {
  onOpenHelp: () => void;
}

/** A small directional pad button that drives fly movement for touch users. */
function FlyButton({
  code,
  label,
  children,
}: {
  code: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="fly-btn"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault();
        setFlyKey(code, true);
      }}
      onPointerUp={() => setFlyKey(code, false)}
      onPointerLeave={() => setFlyKey(code, false)}
      onPointerCancel={() => setFlyKey(code, false)}
    >
      {children}
    </button>
  );
}

/**
 * Overlay HUD with camera mode toggle, reset view, and help, plus an
 * on-screen movement pad shown while in fly mode (for touch users).
 */
export function CameraHud({ onOpenHelp }: CameraHudProps) {
  const mode = useCameraStore((s) => s.mode);
  const toggleMode = useCameraStore((s) => s.toggleMode);
  const requestReset = useCameraStore((s) => s.requestReset);
  const fly = mode === 'fly';

  return (
    <div className="camera-hud" role="group" aria-label="Camera controls">
      <div className="camera-hud-buttons">
        <button
          type="button"
          className="hud-btn"
          onClick={requestReset}
          title="Reset view"
          aria-label="Reset camera view"
        >
          Reset
        </button>
        <button
          type="button"
          className={`hud-btn mode-toggle${fly ? ' fly' : ''}`}
          onClick={toggleMode}
          aria-pressed={fly}
          aria-label={`Camera mode: ${fly ? 'fly' : 'orbit'}`}
          title={fly ? 'Switch to orbit mode' : 'Switch to fly mode'}
        >
          {fly ? 'Fly' : 'Orbit'}
        </button>
        <button
          type="button"
          className="hud-btn"
          onClick={onOpenHelp}
          title="Show controls help"
          aria-label="Show controls help"
        >
          Help
        </button>
      </div>

      {fly && (
        <div className="fly-pad" role="group" aria-label="Fly movement buttons">
          <div className="fly-pad-row">
            <FlyButton code="Space" label="Move up">
              ⬆
            </FlyButton>
          </div>
          <div className="fly-pad-row">
            <FlyButton code="KeyA" label="Move left">
              ◀
            </FlyButton>
            <FlyButton code="KeyW" label="Move forward">
              ▲
            </FlyButton>
            <FlyButton code="KeyD" label="Move right">
              ▶
            </FlyButton>
          </div>
          <div className="fly-pad-row">
            <FlyButton code="KeyS" label="Move backward">
              ▼
            </FlyButton>
          </div>
          <div className="fly-pad-row">
            <FlyButton code="ShiftLeft" label="Move down">
              ⬇
            </FlyButton>
          </div>
        </div>
      )}
    </div>
  );
}
