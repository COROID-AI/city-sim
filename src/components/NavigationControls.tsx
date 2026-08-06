import { useEffect, useRef, useState } from 'react';
import { useNavStore } from '../store/useNavStore';

/**
 * On-canvas navigation UI: a camera mode toggle (orbit / fly) and a help
 * overlay that explains the controls. Both are fully keyboard accessible
 * (focusable buttons with visible focus rings; the dialog closes on Escape).
 */
export function NavigationControls() {
  const mode = useNavStore((s) => s.mode);
  const setMode = useNavStore((s) => s.setMode);
  const [helpOpen, setHelpOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus the close button when the help dialog opens.
  useEffect(() => {
    if (helpOpen) {
      closeRef.current?.focus();
    }
  }, [helpOpen]);

  // Close the help dialog on Escape.
  useEffect(() => {
    if (!helpOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helpOpen]);

  return (
    <div className="nav-controls" aria-label="Navigation controls">
      <div className="nav-mode-toggle" role="group" aria-label="Camera mode">
        <button
          type="button"
          className={`nav-mode-btn${mode === 'orbit' ? ' is-active' : ''}`}
          aria-pressed={mode === 'orbit'}
          onClick={() => setMode('orbit')}
        >
          Orbit
        </button>
        <button
          type="button"
          className={`nav-mode-btn${mode === 'fly' ? ' is-active' : ''}`}
          aria-pressed={mode === 'fly'}
          onClick={() => setMode('fly')}
        >
          Fly
        </button>
      </div>

      <button
        type="button"
        className="nav-help-btn"
        aria-haspopup="dialog"
        aria-expanded={helpOpen}
        onClick={() => setHelpOpen(true)}
      >
        Help
      </button>

      {helpOpen && (
        <div
          className="help-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Controls help"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setHelpOpen(false);
            }
          }}
        >
          <div className="help-panel">
            <h2 className="help-title">Controls</h2>
            <ul className="help-list">
              <li>
                <strong>Orbit:</strong> drag to rotate, right-drag or two-finger
                drag to pan, scroll / pinch to zoom.
              </li>
              <li>
                <strong>Fly:</strong> WASD or arrow keys to move, drag to look,
                Q/E to descend / ascend, scroll to change speed.
              </li>
              <li>
                <strong>Timeline:</strong> pick a year at the top, or Tab to the
                slider and use arrow keys to step through the years.
              </li>
              <li>
                <strong>Audio:</strong> use the volume and mute controls in the
                top bar.
              </li>
            </ul>
            <button
              ref={closeRef}
              type="button"
              className="help-close"
              onClick={() => setHelpOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
