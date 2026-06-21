import type { UpdateContext } from './types';

type UpdateCallback = (ctx: UpdateContext) => void;

type RenderCallback = (params: {
  alpha: number;
  fixedDtMs: number;
  elapsedMs: number;
}) => void;

export type GameLoopOptions = {
  fixedDtHz?: number;
  maxAccumulatedMs?: number;
  onError?: (error: unknown) => void;
};

export class GameLoop {
  private readonly update: UpdateCallback;
  private readonly render: RenderCallback;

  private readonly fixedDtMs: number;
  private readonly maxAccumulatedMs: number;
  private readonly onError: (error: unknown) => void;

  private running = false;
  private paused = false;

  private rafId: number | null = null;
  private lastTimeMs = 0;
  private accumulatedMs = 0;

  // FPS calculation (render cadence)
  private fpsSampleCount = 0;
  private fpsLastLogTimeMs = 0;

  constructor(update: UpdateCallback, render: RenderCallback, options: GameLoopOptions = {}) {
    if (typeof window === 'undefined') {
      throw new Error('GameLoop requires a browser environment with requestAnimationFrame');
    }
    if (typeof window.requestAnimationFrame !== 'function' || typeof window.cancelAnimationFrame !== 'function') {
      throw new Error('GameLoop requires requestAnimationFrame/cancelAnimationFrame');
    }

    this.update = update;
    this.render = render;

    const hz = options.fixedDtHz ?? 20;
    this.fixedDtMs = 1000 / hz;
    this.maxAccumulatedMs = options.maxAccumulatedMs ?? 250;
    this.onError = options.onError ?? ((error) => console.error(error));
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    this.paused = false;

    const initial = performance.now();
    this.lastTimeMs = initial;
    this.accumulatedMs = 0;

    this.fpsLastLogTimeMs = initial;
    this.fpsSampleCount = 0;

    // Important for tests: perform an initial render immediately so the first
    // scheduled rAF tick represents an actual elapsed frame.
    this.render({ alpha: 0, fixedDtMs: this.fixedDtMs, elapsedMs: 0 });

    this.schedule();
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;

    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;

    // Re-anchor time so we don't do a burst of catch-up updates.
    this.lastTimeMs = performance.now();
    this.schedule();
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    this.paused = false;

    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getFps(): number {
    if (this.fpsLastLogTimeMs === 0) return 0;
    const elapsedMs = performance.now() - this.fpsLastLogTimeMs;
    if (elapsedMs <= 0) return 0;
    const seconds = elapsedMs / 1000;
    return this.fpsSampleCount / seconds;
  }

  private schedule(): void {
    this.rafId = window.requestAnimationFrame((t) => this.tick(t));
  }

  private tick(timeMs: number): void {
    if (!this.running || this.paused) return;

    const nowMs = timeMs;
    let dtMs = nowMs - this.lastTimeMs;
    if (!Number.isFinite(dtMs) || dtMs < 0) dtMs = 0;
    this.lastTimeMs = nowMs;

    // Spiral-of-death guard.
    const clampedDtMs = Math.min(dtMs, this.maxAccumulatedMs);
    this.accumulatedMs += clampedDtMs;

    // Fixed-step simulation update.
    while (this.accumulatedMs >= this.fixedDtMs) {
      const ctx: UpdateContext = {
        fixedDtMs: this.fixedDtMs,
        elapsedMs: this.fixedDtMs,
      };

      try {
        this.update(ctx);
      } catch (error) {
        this.onError(error);
      }

      this.accumulatedMs -= this.fixedDtMs;
    }

    // Render at display refresh rate.
    const alpha = this.accumulatedMs / this.fixedDtMs;
    try {
      this.render({ alpha, fixedDtMs: this.fixedDtMs, elapsedMs: clampedDtMs });
    } catch (error) {
      this.onError(error);
    }

    this.updateFps(nowMs);

    this.rafId = window.requestAnimationFrame((t) => this.tick(t));
  }

  private updateFps(nowMs: number): void {
    // fpsSampleCount counts render calls between logs.
    this.fpsSampleCount += 1;

    const elapsedSinceLast = nowMs - this.fpsLastLogTimeMs;
    if (elapsedSinceLast < 1000) return;

    const seconds = elapsedSinceLast / 1000;
    const fps = Math.round((this.fpsSampleCount / seconds) * 10) / 10;

    // eslint-disable-next-line no-console
    console.info(`[GameLoop] FPS: ${fps}`);

    this.fpsSampleCount = 0;
    this.fpsLastLogTimeMs = nowMs;
  }
}
