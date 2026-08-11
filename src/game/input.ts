import { ARR_MS, DAS_MS, SOFT_DROP_REPEAT_MS } from './constants';
import type { ActionName } from './types';

/** Move directions fed through DAS/ARR auto-repeat. */
export type MoveDir = 'left' | 'right';

export interface KeyboardMap {
  moveLeft?: string[];
  moveRight?: string[];
  softDrop?: string[];
  hardDrop?: string[];
  rotateCW?: string[];
  rotateCCW?: string[];
  hold?: string[];
  pauseToggle?: string[];
  start?: string[];
}

export const DEFAULT_KEY_MAP: KeyboardMap = {
  moveLeft: ['ArrowLeft', 'KeyA'],
  moveRight: ['ArrowRight', 'KeyD'],
  softDrop: ['ArrowDown', 'KeyS'],
  hardDrop: ['Space'],
  rotateCW: ['ArrowUp', 'KeyX'],
  rotateCCW: ['KeyZ', 'KeyControl'],
  hold: ['KeyC', 'ShiftLeft', 'ShiftRight'],
  pauseToggle: ['KeyP', 'Escape'],
  start: ['Enter', 'NumpadEnter'],
};

export interface ControllerOptions {
  map?: KeyboardMap;
  /** Discrete actions (rotate, hold, hard drop, start, pause). */
  onAction(action: ActionName): void;
  /** Lateral movement driven by DAS/ARR. */
  onMove(dir: MoveDir): void;
  /** Soft drop driven by its own repeat timer. */
  onSoftDrop(): void;
}

/**
 * Delayed-auto-shift / auto-repeat state machine (DOM-free, unit-testable).
 * `poll` reports `initial` once after the DAS delay and `repeat` at every
 * ARR interval afterwards.
 */
export class AutoRepeater {
  private active = false;
  private startedAt = 0;
  private lastEmitIndex = -1;

  constructor(private dasMs: number = DAS_MS, private arrMs: number = ARR_MS) {}

  press(nowMs: number): void {
    this.active = true;
    this.startedAt = nowMs;
    this.lastEmitIndex = -1;
  }

  release(): void {
    this.active = false;
  }

  poll(nowMs: number): 'initial' | 'repeat' | null {
    if (!this.active) return null;
    const elapsed = nowMs - this.startedAt;
    if (elapsed < this.dasMs) return null;
    const index = Math.floor((elapsed - this.dasMs) / this.arrMs);
    if (index > this.lastEmitIndex) {
      this.lastEmitIndex = index;
      return index === 0 ? 'initial' : 'repeat';
    }
    return null;
  }
}

/** Global keyboard wiring; discrete keys fire once, held keys repeat. */
export class KeyboardController {
  private leftAR = new AutoRepeater();
  private rightAR = new AutoRepeater();
  private downAR = new AutoRepeater(20, SOFT_DROP_REPEAT_MS);
  private map: KeyboardMap;
  private cleanup: (() => void) | null = null;

  constructor(private opts: ControllerOptions) {
    this.map = opts.map ?? DEFAULT_KEY_MAP;
  }

  bind(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code) this.handleKeyDown(e);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code) this.handleKeyUp(e);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this.cleanup = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }

  unbind(): void {
    this.cleanup?.();
    this.cleanup = null;
  }

  /** Feed ARR state into the engine from the rAF loop. */
  poll(nowMs: number): void {
    if (this.leftAR.poll(nowMs)) this.opts.onMove('left');
    if (this.rightAR.poll(nowMs)) this.opts.onMove('right');
    if (this.downAR.poll(nowMs)) this.opts.onSoftDrop();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.repeat) return;

    if (this.codeIn(e.code, 'moveLeft')) {
      this.leftAR.press(performance.now());
      this.opts.onMove('left');
    } else if (this.codeIn(e.code, 'moveRight')) {
      this.rightAR.press(performance.now());
      this.opts.onMove('right');
    } else if (this.codeIn(e.code, 'softDrop')) {
      this.downAR.press(performance.now());
      this.opts.onSoftDrop();
    } else if (this.codeIn(e.code, 'hardDrop')) {
      this.opts.onAction('hardDrop');
    } else if (this.codeIn(e.code, 'rotateCW')) {
      this.opts.onAction('rotateCW');
    } else if (this.codeIn(e.code, 'rotateCCW')) {
      this.opts.onAction('rotateCCW');
    } else if (this.codeIn(e.code, 'hold')) {
      this.opts.onAction('hold');
    } else if (this.codeIn(e.code, 'pauseToggle')) {
      this.opts.onAction('pauseToggle');
    } else if (this.codeIn(e.code, 'start')) {
      this.opts.onAction('start');
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (this.codeIn(e.code, 'moveLeft')) this.leftAR.release();
    if (this.codeIn(e.code, 'moveRight')) this.rightAR.release();
    if (this.codeIn(e.code, 'softDrop')) this.downAR.release();
  }

  private codeIn(code: string, name: keyof KeyboardMap): boolean {
    return this.map[name]?.includes(code) ?? false;
  }
}