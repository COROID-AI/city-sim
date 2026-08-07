import { useEffect, useRef } from 'react';

interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Controls / help overlay describing every navigation mode and the timeline.
 *
 * Rendered as an ARIA dialog so screen readers treat it as a modal, traps
 * focus to the panel while open, and closes on Escape or the close button.
 */
export function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the close button and restore focus on close.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, [open]);

  // Close on Escape.
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
      className="help-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
      >
        <div className="help-panel-header">
          <h2 id="help-title" className="help-title">
            Controls &amp; Help
          </h2>
          <button type="button" className="help-close" aria-label="Close help" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="help-section">
          <h3 className="help-subtitle">Navigate the city</h3>
          <ul className="help-list">
            <li>
              <strong>Orbit</strong> (default): drag to orbit, right-drag to pan, scroll or pinch to
              zoom.
            </li>
            <li>
              <strong>Fly</strong>: WASD / arrow keys to move, drag to look, Space or E to rise,
              Shift or Q to descend.
            </li>
            <li>
              Switch modes with the <em>Orbit / Fly</em> toggle in the header.
            </li>
          </ul>
        </div>

        <div className="help-section">
          <h3 className="help-subtitle">Travel through time</h3>
          <ul className="help-list">
            <li>
              Pick a year on the timeline (1945 &rarr; 2025) to morph the whole block between eras.
            </li>
            <li>
              Keyboard: tab to the timeline, then use the arrow keys to step through the years.
            </li>
          </ul>
        </div>

        <div className="help-section">
          <h3 className="help-subtitle">Sound</h3>
          <ul className="help-list">
            <li>Use the speaker button and volume slider in the header.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
