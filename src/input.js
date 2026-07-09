/**
 * Arrow-key input handler.
 *
 * Maps (gameplay): ArrowUp → rotate, ArrowLeft → move left,
 * ArrowRight → move right, ArrowDown → soft-drop (held).
 *
 * Includes DAS (Delayed Auto-Shift) for held Left/Right (~150ms delay then
 * ~50ms repeat) and an initial soft-drop gravity boost while ArrowDown held.
 * preventDefault is called on all game keys to stop page scroll.
 *
 * Ignores all non-arrow keys for gameplay per the user constraint.
 */

import { DAS_DELAY, DAS_REPEAT } from './config.js';

// Keys that are consumed by the game (all arrows)
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Returns true if the key is one of the game-control arrow keys.
 */
export function isGameKey(key) {
  return GAME_KEYS.has(key);
}

/**
 * Creates the input controller.
 *
 * @param {object} game - Game instance (must expose tryMove, tryRotate, softDrop)
 * @param {object} [opts]
 * @param {() => boolean} [opts.isInputGuarded] - Returns true if a text field has focus (skip)
 */
export function createInput(game, opts) {
  const options = opts || {};
  const isInputGuarded = options.isInputGuarded || (() => false);

  // DAS state for horizontal movement
  let heldDir = 0; // -1 left, +1 right, 0 none
  let dasTimer = null; // node for the initial delay
  let repeatTimer = null; // node for the repeat interval

  // Soft-drop state
  let softDown = false;

  function clearHeld() {
    heldDir = 0;
    if (dasTimer !== null) {
      clearTimeout(dasTimer);
      dasTimer = null;
    }
    if (repeatTimer !== null) {
      clearInterval(repeatTimer);
      repeatTimer = null;
    }
  }

  function startDAS(dir) {
    clearHeld();
    heldDir = dir;
    // Immediate first move is handled by keydown; DAS kicks in after the delay
    dasTimer = setTimeout(() => {
      repeatTimer = setInterval(() => {
        game.tryMove(heldDir, 0);
      }, DAS_REPEAT);
    }, DAS_DELAY);
  }

  /**
   * Keydown handler. Attach to window.
   * @param {KeyboardEvent} e
   */
  function onKeyDown(e) {
    if (!isGameKey(e.key)) return;
    if (isInputGuarded()) return;

    // Always preventDefault on arrow keys so the page never scrolls
    e.preventDefault();

    if (e.repeat) {
      // The browser's own auto-repeat would double-fire with our DAS; ignore it
      // for left/right (we manage repeat ourselves) but allow rotate/soft-drop.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    }

    switch (e.key) {
      case 'ArrowUp':
        game.tryRotate(1);
        break;
      case 'ArrowLeft':
        if (heldDir !== -1) {
          game.tryMove(-1, 0);
          startDAS(-1);
        }
        break;
      case 'ArrowRight':
        if (heldDir !== 1) {
          game.tryMove(1, 0);
          startDAS(1);
        }
        break;
      case 'ArrowDown':
        if (!softDown) {
          softDown = true;
          game.state.softDropActive = true;
          game.softDrop();
        }
        break;
      default:
        break;
    }
  }

  /**
   * Keyup handler. Attach to window.
   * @param {KeyboardEvent} e
   */
  function onKeyUp(e) {
    if (!isGameKey(e.key)) return;
    if (isInputGuarded()) return;
    e.preventDefault();

    switch (e.key) {
      case 'ArrowLeft':
        if (heldDir === -1) clearHeld();
        break;
      case 'ArrowRight':
        if (heldDir === 1) clearHeld();
        break;
      case 'ArrowDown':
        softDown = false;
        game.state.softDropActive = false;
        break;
      default:
        break;
    }
  }

  /** Attach all listeners to window. */
  function attach() {
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });
  }

  /** Detach all listeners (cleanup). */
  function detach() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    clearHeld();
  }

  /** Returns whether soft-drop is currently active (ArrowDown held). */
  function isSoftDropping() {
    return softDown;
  }

  return { attach, detach, isSoftDropping, clearHeld };
}
