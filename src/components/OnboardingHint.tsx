/**
 * Brief onboarding hint shown once the scene has loaded. Explains how to
 * navigate the city and use the timeline slider, then can be dismissed.
 */
export function OnboardingHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="onboarding-hint" role="status" aria-live="polite">
      <p className="onboarding-text">
        Drag to look around and scroll to zoom. Switch to{' '}
        <strong>Fly</strong> mode (WASD / arrow keys) to walk closer to the
        city. Pick a year on the timeline to travel through time.
      </p>
      <button type="button" className="onboarding-dismiss" onClick={onDismiss}>
        Got it
      </button>
    </div>
  );
}
