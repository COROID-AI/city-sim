import { useState } from 'react';
import { markOnboardingSeen } from './onboarding';

interface OnboardingOverlayProps {
  onDismiss: () => void;
}

/**
 * First-run onboarding overlay. Introduces the experience and gives a one-line
 * controls primer before dismissing into the live scene.
 */
export function OnboardingOverlay({ onDismiss }: OnboardingOverlayProps) {
  const [leaving, setLeaving] = useState(false);

  const dismiss = () => {
    markOnboardingSeen();
    setLeaving(true);
    window.setTimeout(onDismiss, 240);
  };

  return (
    <div className={`onboarding${leaving ? ' is-leaving' : ''}`} role="dialog" aria-modal="true">
      <div className="onboarding-card">
        <h1 className="onboarding-title">City Time Period Timelapse</h1>
        <p className="onboarding-intro">
          Step through eighty years of a single city block &mdash; 1945 to 2025. Every era morphs
          the buildings, vehicles, storefronts, advertisements, pedestrian outfits and the street
          itself in front of your eyes, with ambience and SFX crossfading to match.
        </p>
        <ul className="onboarding-primer">
          <li>
            <kbd>Click</kbd> an era above to morph the city.
          </li>
          <li>
            <kbd>Drag</kbd> to orbit &middot; <kbd>scroll</kbd> to zoom.
          </li>
          <li>
            Press <kbd>F</kbd> for free-fly camera.
          </li>
        </ul>
        <button type="button" className="onboarding-start" onClick={dismiss}>
          Enter the city
        </button>
      </div>
    </div>
  );
}
