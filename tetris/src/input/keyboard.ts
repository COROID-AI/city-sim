/**
 * Keyboard adapter — arrow-key-only control surface.
 *
 * Per the user's constraint, only the four arrow keys have any effect:
 *  - ArrowLeft  → onMove(-1)
 *  - ArrowRight → onMove(+1)
 *  - ArrowUp    → onRotate()
 *  - ArrowDown  → onSoftDrop(true) on keydown, onSoftDrop(false) on keyup
 *
 * OS auto-repeat is suppressed within a 130ms window after the first keydown
 * so that holding an arrow key does not cause double/triple-firing of move and
 * rotate actions. Soft-drop is a state flag (down = accelerate, up = release),
 * so repeat events for ArrowDown are simply ignored.
 */

export interface KeyboardCallbacks {
  /** Horizontal movement: -1 = left, +1 = right. */
  onMove: (dir: number) => void;
  /** Rotate the active piece 90° clockwise. */
  onRotate: () => void;
  /** Toggle the soft-drop acceleration flag. */
  onSoftDrop: (on: boolean) => void;
}

export interface KeyboardController {
  /** Attach event listeners to the given element. */
  attach: (el: HTMLElement | Window) => void;
  /** Remove event listeners. */
  detach: () => void;
}

/** Suppress OS auto-repeat within this window after the initial keydown. */
const REPEAT_SUPPRESS_MS = 130;

export function createKeyboardController(
  callbacks: KeyboardCallbacks,
): KeyboardController {
  let target: HTMLElement | Window | null = null;

  // Track last-fire time per action-key to suppress OS auto-repeat.
  const lastFired: Record<string, number> = {};

  function shouldFire(key: string): boolean {
    const now = performance.now();
    const last = lastFired[key] ?? 0;
    if (now - last < REPEAT_SUPPRESS_MS) return false;
    lastFired[key] = now;
    return true;
  }

  function clearFire(key: string): void {
    delete lastFired[key];
  }

  function handleKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        if (shouldFire("ArrowLeft")) callbacks.onMove(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (shouldFire("ArrowRight")) callbacks.onMove(+1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (shouldFire("ArrowUp")) callbacks.onRotate();
        break;
      case "ArrowDown":
        e.preventDefault();
        // Soft-drop is a held state; only fire once on the initial press.
        if (shouldFire("ArrowDown")) callbacks.onSoftDrop(true);
        break;
      default:
        // No other keys have any effect.
        break;
    }
  }

  function handleKeyUp(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowLeft":
        clearFire("ArrowLeft");
        break;
      case "ArrowRight":
        clearFire("ArrowRight");
        break;
      case "ArrowUp":
        clearFire("ArrowUp");
        break;
      case "ArrowDown":
        clearFire("ArrowDown");
        callbacks.onSoftDrop(false);
        break;
      default:
        break;
    }
  }

  return {
    attach(el: HTMLElement | Window) {
      // If already attached, detach first to avoid duplicate listeners.
      if (target) this.detach();
      target = el;
      el.addEventListener("keydown", handleKeyDown as EventListener);
      el.addEventListener("keyup", handleKeyUp as EventListener);
    },
    detach() {
      if (!target) return;
      target.removeEventListener("keydown", handleKeyDown as EventListener);
      target.removeEventListener("keyup", handleKeyUp as EventListener);
      target = null;
    },
  };
}
