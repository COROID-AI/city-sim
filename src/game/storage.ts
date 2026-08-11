const KEY = 'tetris.high-score.v1';

export function loadHighScore(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(score: number): boolean {
  try {
    window.localStorage.setItem(KEY, String(Math.max(0, Math.floor(score))));
    return true;
  } catch {
    return false;
  }
}