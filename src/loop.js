/**
 * requestAnimationFrame-based game loop.
 *
 * Computes delta time, applies gravity based on the current level, applies a
 * soft-drop tick when ArrowDown is held, and triggers game.step(). Pauses
 * gravity accumulation when the document is hidden (visibilitychange) to
 * avoid huge dt jumps.
 *
 * Provides start/stop semantics.
 */

import { DT_CAP } from './config.js';

/**
 * Creates a game loop.
 *
 * @param {object} params
 * @param {() => number} params.getGravityInterval - ms per row at current level
 * @param {() => number} params.getSoftDropInterval - ms per row when soft-dropping
 * @param {() => boolean} params.isSoftDropping - true if ArrowDown is held
 * @param {() => boolean} params.isPaused - true if the game is paused/over
 * @param {() => void} params.onGravityTick - called when a normal gravity row-drop is due
 * @param {() => void} params.onSoftDropTick - called when a soft-drop row-drop is due
 */
export function createLoop({
  getGravityInterval,
  getSoftDropInterval,
  isSoftDropping,
  isPaused,
  onGravityTick,
  onSoftDropTick,
}) {
  let rafId = null;
  let lastTime = null;
  let gravityAccum = 0;
  let softDropAccum = 0;
  let running = false;

  function reset() {
    lastTime = null;
    gravityAccum = 0;
    softDropAccum = 0;
  }

  function frame(now) {
    if (!running) return;

    if (lastTime === null) {
      lastTime = now;
      rafId = requestAnimationFrame(frame);
      return;
    }

    // Cap dt so backgrounded tabs don't drop pieces through the floor
    let dt = now - lastTime;
    lastTime = now;
    if (dt > DT_CAP) dt = DT_CAP;

    if (!isPaused()) {
      if (isSoftDropping()) {
        softDropAccum += dt;
        const interval = getSoftDropInterval();
        while (softDropAccum >= interval) {
          softDropAccum -= interval;
          onSoftDropTick();
        }
        // While soft-dropping, normal gravity is paused (soft-drop replaces it)
        gravityAccum = 0;
      } else {
        gravityAccum += dt;
        const interval = getGravityInterval();
        while (gravityAccum >= interval) {
          gravityAccum -= interval;
          onGravityTick();
        }
        // Reset soft-drop accumulator so resuming doesn't immediately drop
        softDropAccum = 0;
      }
    }

    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    reset();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // Pause accumulation when the document is hidden to avoid huge dt jumps
  function onVisibilityChange() {
    if (document.hidden) {
      lastTime = null; // forces a dt reset on resume
    }
  }

  let visibilityAttached = false;
  function attachVisibility() {
    if (!visibilityAttached) {
      document.addEventListener('visibilitychange', onVisibilityChange);
      visibilityAttached = true;
    }
  }

  function detachVisibility() {
    if (visibilityAttached) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      visibilityAttached = false;
    }
  }

  return { start, stop, reset, attachVisibility, detachVisibility };
}
