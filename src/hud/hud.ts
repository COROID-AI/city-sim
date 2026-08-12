/**
 * DOM-based HUD overlay for the snake game.
 *
 * This module is intentionally separate from the canvas renderer: it manages
 * plain DOM elements inside a caller-provided overlay element and renders the
 * current score, the persistent high score, and the game-over state. It also
 * owns persistence of the high score through `localStorage` under a
 * namespaced key so it cannot collide with other apps on the same origin.
 */

/** Namespaced key used to persist the high score in `localStorage`. */
export const HIGH_SCORE_KEY = 'snake.highScore'

/**
 * Read the persisted high score from `localStorage`.
 *
 * Returns a non-negative integer, or 0 when nothing has been stored yet or
 * the stored value is not a usable number. Never throws: `localStorage` can
 * be unavailable (e.g. blocked storage) and is guarded accordingly.
 */
export function loadHighScore(): number {
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_KEY)
    if (raw === null) {
      return 0
    }
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  } catch {
    return 0
  }
}

/**
 * Persist `score` as the high score in `localStorage`.
 *
 * Only writes when `score` is a positive, finite number. Failures to write
 * (e.g. storage is full or blocked) are swallowed so the game keeps running.
 */
export function saveHighScore(score: number): void {
  if (!Number.isFinite(score) || score <= 0) {
    return
  }
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(Math.floor(score)))
  } catch {
    // Storage unavailable — ignore, the game can still run in-memory.
  }
}

/** The public surface returned by {@link createHud}. */
export interface Hud {
  /**
   * Refresh the displayed current score and high score. Call this on every
   * score change (and once on init) to keep the overlay in sync.
   */
  update: (score: number, highScore: number) => void
  /**
   * Show the game-over message with the final score and a restart prompt.
   */
  showGameOver: (score: number, highScore: number) => void
  /** Hide the game-over message, returning the overlay to the score display. */
  hideGameOver: () => void
}

/**
 * Build a HUD overlay inside `element`.
 *
 * The function creates its own DOM subtree (score line + game-over banner)
 * inside the provided `element`, so the caller only needs to supply a
 * positioned container. Returns an object with `update`, `showGameOver`, and
 * `hideGameOver` methods.
 */
export function createHud(element: HTMLElement): Hud {
  // Score line: current score on the left, high score on the right.
  const scoreLine = document.createElement('div')
  scoreLine.className = 'hud-score-line'

  const scoreLabel = document.createElement('span')
  scoreLabel.className = 'hud-score'
  scoreLabel.textContent = 'Score: 0'

  const highScoreLabel = document.createElement('span')
  highScoreLabel.className = 'hud-high-score'
  highScoreLabel.textContent = 'High Score: 0'

  scoreLine.append(scoreLabel, highScoreLabel)

  // Game-over banner: message + final score + restart prompt. Hidden by default.
  const gameOver = document.createElement('div')
  gameOver.className = 'hud-game-over'
  gameOver.hidden = true

  const gameOverTitle = document.createElement('h2')
  gameOverTitle.textContent = 'Game Over'

  const gameOverScore = document.createElement('p')
  gameOverScore.className = 'hud-game-over-score'

  const restartPrompt = document.createElement('p')
  restartPrompt.className = 'hud-restart-prompt'
  restartPrompt.textContent = 'Press Space / Enter / R to restart'

  gameOver.append(gameOverTitle, gameOverScore, restartPrompt)

  element.append(scoreLine, gameOver)

  return {
    update(score, highScore) {
      scoreLabel.textContent = `Score: ${score}`
      highScoreLabel.textContent = `High Score: ${highScore}`
    },
    showGameOver(score, highScore) {
      gameOverScore.textContent = `Final Score: ${score}  •  High Score: ${highScore}`
      gameOver.hidden = false
    },
    hideGameOver() {
      gameOver.hidden = true
    },
  }
}
