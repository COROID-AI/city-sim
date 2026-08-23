/* Adaptive graphics budget.
 *
 * Addresses the handoff finding that bloom + large particle counts tank frame
 * rate on integrated/mobile GPUs:
 *  - three tiers; LOW disables post entirely and slashes particle spawns
 *  - AUTO mode watches a rolling FPS average and downgrades after sustained
 *    poor frames (with hysteresis + cooldown so it never oscillates)
 *  - manual override via HUD button / Q key cycles tiers and suspends AUTO
 */

import { QUALITY_TIERS } from './config.js';

const DOWNGRADE_FPS = 45;
const UPGRADE_FPS = 58;
const EVAL_INTERVAL = 2.5;

export class QualityManager {
  constructor({ isCoarsePointer, onApply, onAutoChange }) {
    this.tiers = QUALITY_TIERS;
    this.onApply = onApply;           // (tier) => void
    this.onAutoChange = onAutoChange; // (tier, auto) => void
    this.autoMode = true;
    // coarse-pointer devices start one notch down to avoid an early slump
    this.index = isCoarsePointer ? Math.min(1, this.tiers.length - 1) : 0;
    this.initialIndex = this.index;
    this.frames = 0;
    this.elapsed = 0;
    this.lowStreak = 0;
    this.highStreak = 0;
    this.cooldown = 0;
    this.current = null;
  }

  get tier() { return this.tiers[this.index]; }

  applyInitial() {
    this.current = this.tier;
    this.onApply(this.current);
    this.onAutoChange(this.current, false);
  }

  setIndex(i, manual) {
    i = Math.max(0, Math.min(this.tiers.length - 1, i));
    if (i === this.index && this.current) return;
    this.index = i;
    this.current = this.tier;
    this.cooldown = 6;
    if (manual) {
      this.lowStreak = 0;
      this.highStreak = 0;
    }
    this.onApply(this.current);
    this.onAutoChange(this.current, !manual && this.autoMode);
  }

  cycle() {
    this.autoMode = false;
    const next = (this.index + 1) % this.tiers.length;
    this.setIndex(next, true);
    return this.current.label;
  }

  backToAuto() {
    this.autoMode = true;
    this.lowStreak = 0;
    this.highStreak = 0;
  }

  /* feed every rendered frame */
  sample(dt) {
    this.frames++;
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.elapsed < EVAL_INTERVAL) return;

    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;

    if (!this.autoMode || this.cooldown > 0) return;

    if (fps < DOWNGRADE_FPS) {
      this.lowStreak++;
      this.highStreak = 0;
      if (this.lowStreak >= 2 && this.index < this.tiers.length - 1) {
        this.setIndex(this.index + 1, false);
        this.lowStreak = 0;
      }
    } else {
      this.lowStreak = 0;
      if (fps > UPGRADE_FPS && this.index > this.initialIndex) {
        this.highStreak++;
        if (this.highStreak >= 3) {
          this.setIndex(this.index - 1, false);
          this.highStreak = 0;
        }
      } else {
        this.highStreak = 0;
      }
    }
  }

  label() {
    return this.autoMode ? `Q·AUTO (${this.current.label})` : `Q·${this.current.label}`;
  }
}
