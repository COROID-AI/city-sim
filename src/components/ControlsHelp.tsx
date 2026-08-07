import { useCameraStore } from '../store/useCameraStore';

interface ControlsHelpProps {
  onClose: () => void;
}

/**
 * Controls help panel listing every camera / interaction binding.
 * Readable in both orbit and fly modes.
 */
export function ControlsHelp({ onClose }: ControlsHelpProps) {
  const mode = useCameraStore((s) => s.mode);

  return (
    <div className="help-backdrop" role="dialog" aria-modal="true" aria-label="Controls help">
      <div className="help-panel">
        <div className="help-header">
          <h2 className="help-title">Controls</h2>
          <button type="button" className="help-close" aria-label="Close help" onClick={onClose}>
            ✕
          </button>
        </div>

        <section className="help-section">
          <h3>Navigate the era timeline</h3>
          <ul className="help-list">
            <li>
              <kbd>Click</kbd> an era (1945 &ndash; 2025) or use <kbd>←</kbd> <kbd>→</kbd> arrows
              to morph the whole city.
            </li>
          </ul>
        </section>

        <section className="help-section">
          <h3>Camera &mdash; Orbit / Look <span className="help-mode">(current: {mode})</span></h3>
          <ul className="help-list">
            <li>
              <kbd>Drag</kbd> (mouse or touch) &mdash; orbit / look around the scene.
            </li>
            <li>
              <kbd>Scroll</kbd> or <kbd>pinch</kbd> &mdash; zoom in / out.
            </li>
            <li>
              <kbd>Right-drag</kbd> / <kbd>two-finger drag</kbd> &mdash; pan.
            </li>
          </ul>
        </section>

        <section className="help-section">
          <h3>Camera &mdash; Free Fly</h3>
          <ul className="help-list">
            <li>
              <kbd>F</kbd> or the header toggle &mdash; switch between orbit and fly.
            </li>
            <li>
              <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> / <kbd>↑</kbd> <kbd>↓</kbd>{' '}
              <kbd>←</kbd> <kbd>→</kbd> &mdash; move forward / strafe.
            </li>
            <li>
              <kbd>E</kbd> / <kbd>Space</kbd> up, <kbd>Q</kbd> down.
            </li>
            <li>
              <kbd>Shift</kbd> &mdash; boost speed.
            </li>
            <li>
              <kbd>Drag</kbd> (mouse or touch) &mdash; look around.
            </li>
          </ul>
        </section>

        <section className="help-section">
          <h3>Audio &amp; quality</h3>
          <ul className="help-list">
            <li>
              <kbd>Mute</kbd> / <kbd>volume</kbd> &mdash; control the ambience.
            </li>
            <li>
              <kbd>Effects: High/Low</kbd> &mdash; toggle post-processing (AO, bloom) for weaker
              devices.
            </li>
          </ul>
        </section>

        <button type="button" className="help-done" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
