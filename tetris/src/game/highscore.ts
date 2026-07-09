/**
 * localStorage-backed high score persistence.
 *
 * Every access is wrapped in try/catch so the feature degrades gracefully in
 * private-mode or sandboxed contexts where storage is unavailable.
 */

const STORAGE_KEY = "tetris.highscore";

/** Read the persisted high score, or 0 if unavailable/none. */
export function loadHighScore(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 0;
    const val = parseInt(raw, 10);
    return Number.isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

/** Persist the high score if it is higher than the stored value. */
export function saveHighScore(score: number): void {
  try {
    const current = loadHighScore();
    if (score > current) {
      localStorage.setItem(STORAGE_KEY, String(score));
    }
  } catch {
    // No-op: storage unavailable.
  }
}
