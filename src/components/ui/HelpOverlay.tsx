'use client';

/**
 * HelpOverlay
 *
 * A collapsible panel that explains the camera navigation controls (rotate,
 * pan, zoom) and the timeline interaction. Toggled by a floating help button
 * in the bottom-right area. The panel is responsive — it collapses to a
 * compact card on small screens and never overlaps the top-centred timeline
 * slider.
 */
import { useCallback, useEffect, useState, type FC } from 'react';

/** A single control help entry. */
interface ControlEntry {
  readonly icon: string;
  readonly label: string;
  readonly detail: string;
}

const CAMERA_CONTROLS: readonly ControlEntry[] = [
  {
    icon: '🖱️↻',
    label: 'Rotate',
    detail: 'Left-click + drag to orbit the camera around the city.',
  },
  {
    icon: '🖱️✥',
    label: 'Pan',
    detail: 'Right-click + drag (or two-finger drag) to pan the view.',
  },
  {
    icon: '🔍',
    label: 'Zoom',
    detail: 'Scroll wheel or pinch to zoom in and out.',
  },
];

const TIMELINE_CONTROLS: readonly ControlEntry[] = [
  {
    icon: '⏱️',
    label: 'Timeline',
    detail: 'Drag the top slider or tap a year stop to travel through time.',
  },
  {
    icon: '💡',
    label: 'Hover',
    detail: 'Hover over buildings and props for era-specific info.',
  },
];

const HelpOverlay: FC = () => {
  const [open, setOpen] = useState(false);

  // Allow toggling with the "H" key for keyboard users.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  return (
    <div
      className="pointer-events-auto absolute right-6 top-24 z-20 flex flex-col items-end gap-2 sm:top-6"
      data-testid="help-overlay"
    >
      {/* Toggle button */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="help-panel"
        aria-label={open ? 'Close help panel' : 'Open help panel'}
        title={open ? 'Close help (H)' : 'Help (H)'}
        className={
          'flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors ' +
          (open
            ? 'border-cyan-400/30 bg-black/60 text-cyan-300'
            : 'border-white/10 bg-black/50 text-gray-300 hover:text-white')
        }
        data-testid="help-toggle"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      {/* Slide-in panel */}
      {open && (
        <div
          id="help-panel"
          className="w-[min(300px,80vw)] rounded-2xl border border-white/10 bg-black/60 p-5 shadow-2xl backdrop-blur-md"
          role="dialog"
          aria-label="Camera controls help"
          data-testid="help-panel"
        >
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-cyan-300">
            Camera Controls
          </h3>
          <ul className="mb-4 space-y-2">
            {CAMERA_CONTROLS.map((entry) => (
              <li key={entry.label} className="flex items-start gap-3">
                <span className="mt-0.5 text-base" aria-hidden="true">
                  {entry.icon}
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{entry.label}</p>
                  <p className="text-xs leading-relaxed text-gray-400">
                    {entry.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-cyan-300">
            Interaction
          </h3>
          <ul className="space-y-2">
            {TIMELINE_CONTROLS.map((entry) => (
              <li key={entry.label} className="flex items-start gap-3">
                <span className="mt-0.5 text-base" aria-hidden="true">
                  {entry.icon}
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{entry.label}</p>
                  <p className="text-xs leading-relaxed text-gray-400">
                    {entry.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-4 border-t border-white/5 pt-3 text-[10px] text-gray-500">
            Press <kbd className="rounded bg-white/10 px-1">H</kbd> to toggle,{' '}
            <kbd className="rounded bg-white/10 px-1">Esc</kbd> to close.
          </p>
        </div>
      )}
    </div>
  );
};

export default HelpOverlay;
