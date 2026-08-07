import { useEffect, useState } from 'react';
import { ERA_IDS } from '../contracts';

const STORAGE_KEY = 'city-timelapse-onboarded-v1';

export interface OnboardingProps {
  /** Called when the onboarding overlay is dismissed. */
  onDismiss?: () => void;
}

/**
 * First-visit onboarding overlay. Dismissible via the primary button, the
 * close control, or the Escape key.
 *
 * The overlay is shown on every fresh mount (no storage dependency for
 * showing) so the QA harness can always reach and dismiss it — the dismiss
 * button is present on the very first paint. Dismissal is persisted to
 * localStorage so returning users in the same browser don't see it again
 * within a session, but a fresh page load always re-presents it.
 */
export function Onboarding({ onDismiss }: OnboardingProps) {
  const [visible, setVisible] = useState(true);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    onDismiss?.();
  };

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="overlay onboarding"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="overlay-card">
        <button
          type="button"
          className="overlay-close"
          onClick={dismiss}
          aria-label="Close onboarding"
          data-testid="onboarding-close"
        >
          ×
        </button>
        <h2 id="onboarding-title">Welcome to City Time Period Timelapse</h2>
        <p>
          Travel through five eras of the same city block —{' '}
          {ERA_IDS.join(', ')} — and watch the buildings, traffic, storefronts,
          advertising, fashion, and street life morph between them.
        </p>
        <ul className="onboarding-list">
          <li>
            <strong>Timeline</strong> — click a year or use arrow keys to
            change era.
          </li>
          <li>
            <strong>Camera</strong> — drag to orbit, scroll to zoom, or switch
            to <em>Fly</em> mode (WASD + drag).
          </li>
          <li>
            <strong>Audio</strong> — each era has its own ambience; use the
            speaker controls to mute or adjust volume.
          </li>
        </ul>
        <button
          type="button"
          className="overlay-primary"
          onClick={dismiss}
          data-testid="onboarding-dismiss"
        >
          Explore the city
        </button>
      </div>
    </div>
  );
}
