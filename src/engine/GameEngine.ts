/**
 * GameEngine — minimal placeholder.
 *
 * This is a stub that satisfies the page.tsx import contract
 * (constructor takes an HTMLCanvasElement, dispose() tears down).
 *
 * The downstream task "Implement src/engine/GameLoop.ts with rAF + fixed
 * 20Hz timestep and FPS counter" will replace this with the real engine.
 * The interface here is intentionally stable so that swap is seamless.
 */
export class GameEngine {
  private readonly canvas: HTMLCanvasElement;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Tear down the engine and release all resources.
   *
   * Safe to call multiple times; subsequent calls are no-ops.
   */  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
  }
}
