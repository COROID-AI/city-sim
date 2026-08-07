import { useState } from 'react';

interface OnboardingHintProps {
  onDismiss: () => void;
}

const STORAGE_KEY = 'city-timelapse:onboarding-dismissed';

/**
 * A dismissible onboarding hint shown on first visit that explains the
 * timeline slider and camera navigation. The dismissal is remembered so
 * returning users aren't nagged again.
 */
export function OnboardingHint({ onDismiss }: OnboardingHintProps) {
  const [visible, setVisible] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* storage unavailable — just hide for this session */
    }
    onDismiss();
  };

  return (
    <aside className="onboarding-hint" role="note" aria-label="Getting started">
      <div className="onboarding-hint-body">
        <strong>Getting started</strong>
        <p>
          Drag to orbit the city and scroll to zoom. Use the <em>timeline</em> above to travel
          through time (1945&rarr;2025). Want a closer look? Switch to <em>Fly</em> mode and move
          with WASD or the arrow keys.
        </p>
      </div>
      <button
        type="button"
        className="onboarding-dismiss"
        aria-label="Dismiss getting started hint"
        onClick={dismiss}
      >
        Got it
      </button>
    </aside>
  );
}
