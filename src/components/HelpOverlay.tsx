import { useEffect } from 'react';

interface HelpOverlayProps {
  onClose: () => void;
}

/**
 * Modal controls/help overlay. Lists mouse, touch, and keyboard bindings for
 * orbit and fly modes plus the timeline. Closes on Escape, the close button,
 * or clicking the backdrop.
 */
export function HelpOverlay({ onClose }: HelpOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Controls help"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="help-panel">
        <div className="help-header">
          <h2 className="help-title">Controls</h2>
          <button
            type="button"
            className="help-close"
            onClick={onClose}
            aria-label="Close help"
          >
            ×
          </button>
        </div>
        <div className="help-body">
          <section className="help-section">
            <h3>Orbit mode</h3>
            <ul>
              <li>
                <kbd>Drag</kbd> — orbit / look around
              </li>
              <li>
                <kbd>Right-click drag</kbd> — pan
              </li>
              <li>
                <kbd>Scroll / pinch</kbd> — zoom
              </li>
            </ul>
          </section>
          <section className="help-section">
            <h3>Fly mode</h3>
            <ul>
              <li>
                <kbd>W A S D</kbd> / <kbd>↑ ← ↓ →</kbd> — move
              </li>
              <li>
                <kbd>Drag</kbd> — look around
              </li>
              <li>
                <kbd>Space</kbd> — ascend
              </li>
              <li>
                <kbd>Shift</kbd> — descend
              </li>
            </ul>
          </section>
          <section className="help-section">
            <h3>Timeline</h3>
            <ul>
              <li>
                <kbd>← →</kbd> arrow keys — step between years
              </li>
            </ul>
          </section>
        </div>
        <button type="button" className="onboarding-btn primary help-done" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
