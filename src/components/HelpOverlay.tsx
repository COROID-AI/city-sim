import { useEffect } from 'react';

interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Controls help panel listing all navigation and interaction shortcuts.
 * Accessible via the "?" button and dismissible via close, backdrop, or
 * Escape.
 */
export function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="overlay help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="overlay-card">
        <button
          type="button"
          className="overlay-close"
          onClick={onClose}
          aria-label="Close controls help"
        >
          ×
        </button>
        <h2 id="help-title">Controls</h2>

        <h3>Camera</h3>
        <table className="help-table">
          <tbody>
            <tr>
              <td>Orbit / look</td>
              <td>Drag (mouse or touch)</td>
            </tr>
            <tr>
              <td>Zoom</td>
              <td>Scroll wheel / pinch</td>
            </tr>
            <tr>
              <td>Fly mode</td>
              <td>Toggle button in header</td>
            </tr>
            <tr>
              <td>Fly — move</td>
              <td>W A S D (or arrow keys)</td>
            </tr>
            <tr>
              <td>Fly — ascend / descend</td>
              <td>E / Space · Q / Ctrl</td>
            </tr>
            <tr>
              <td>Fly — boost</td>
              <td>Hold Shift</td>
            </tr>
          </tbody>
        </table>

        <h3>Timeline</h3>
        <table className="help-table">
          <tbody>
            <tr>
              <td>Change era</td>
              <td>Click a year</td>
            </tr>
            <tr>
              <td>Keyboard</td>
              <td>← → ↑ ↓ · Home · End</td>
            </tr>
          </tbody>
        </table>

        <h3>Quality &amp; audio</h3>
        <table className="help-table">
          <tbody>
            <tr>
              <td>Effects quality</td>
              <td>Quality toggle (High / Low)</td>
            </tr>
            <tr>
              <td>Ambience</td>
              <td>Speaker mute / volume</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
