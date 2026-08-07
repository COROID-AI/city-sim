const ONBOARDING_KEY = 'city-timelapse:onboarded';

/** Whether onboarding has been seen on this device (persisted). */
export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return false;
  }
}

/** Mark onboarding as seen so it does not reappear on reload. */
export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* ignore storage errors (private mode) */
  }
}
