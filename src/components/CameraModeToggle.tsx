import { useCameraStore } from '../store/useCameraStore';

/**
 * Header toggle that switches the camera between orbit and first-person fly
 * modes. Keyboard-accessible button reflecting the active mode.
 */
export function CameraModeToggle() {
  const mode = useCameraStore((s) => s.mode);
  const toggleMode = useCameraStore((s) => s.toggleMode);
  const isFly = mode === 'fly';

  return (
    <button
      type="button"
      className={`camera-mode-toggle${isFly ? ' fly' : ''}`}
      onClick={toggleMode}
      aria-pressed={isFly}
      aria-label={`Camera mode: ${isFly ? 'fly' : 'orbit'}`}
      title="Toggle between orbit and fly camera"
    >
      <span className="camera-mode-label">Camera</span>
      <span className="camera-mode-value">{isFly ? 'Fly' : 'Orbit'}</span>
    </button>
  );
}
