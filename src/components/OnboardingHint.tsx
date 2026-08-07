interface OnboardingHintProps {
  /** Dismiss the hint (persisted so it only shows once). */
  onDismiss: () => void;
  /** Open the full controls help overlay. */
  onOpenHelp: () => void;
}

/**
 * One-time onboarding hint explaining the timeline slider and camera
 * navigation. Dismissed via "Got it" or by opening the full controls help.
 */
export function OnboardingHint({ onDismiss, onOpenHelp }: OnboardingHintProps) {
  return (
    <aside className="onboarding-hint" role="region" aria-label="Getting started">
      <p className="onboarding-title">Welcome 👋</p>
      <p className="onboarding-text">
        <strong>Drag</strong> to orbit around the block, <strong>scroll</strong> to zoom, and
        use the <strong>timeline slider</strong> at the top to travel between 1945 and 2025.
      </p>
      <p className="onboarding-text">
        Switch to <strong>Fly</strong> mode to walk around, then use{' '}
        <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrow keys to move.
      </p>
      <div className="onboarding-actions">
        <button type="button" className="onboarding-btn primary" onClick={onDismiss}>
          Got it
        </button>
        <button type="button" className="onboarding-btn" onClick={onOpenHelp}>
          Show controls
        </button>
      </div>
    </aside>
  );
}
