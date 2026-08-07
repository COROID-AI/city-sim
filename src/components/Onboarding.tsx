import { useEffect, useState } from 'react';
import { ERA_IDS } from '../contracts';

const STORAGE_KEY = 'city-timelapse-onboarded-v1';

/**
 * First-visit onboarding overlay. Shown once (persisted in localStorage) to
 * orient the user to the timeline, camera controls, and audio. Dismissible
 * via the button, the close control, or the Escape key.
 */
export function Onboarding() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
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
        <button type="button" className="overlay-primary" onClick={dismiss}>
          Explore the city
        </button>
      </div>
    </div>
  );
}
