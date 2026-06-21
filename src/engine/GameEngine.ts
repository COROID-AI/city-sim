/**
 * GameEngine — the single integration point that wires world generation,
 * camera, renderer, and the fixed-timestep game loop together.
 *
 * Lifecycle:
 *   const engine = new GameEngine(canvas); // generates city, creates camera/renderer/loop
 *   engine.start();                        // begins rAF loop
 *   engine.stop();                         // pauses loop (can restart)
 *   engine.dispose();                      // stops loop + detaches camera (final)
 *
 * The constructor does NOT auto-start the loop; the caller decides when to
 * begin rendering (mirrors the GameLoop.start() pattern).
 */

import { Camera } from './Camera';
import { GameLoop } from './GameLoop';
import { Renderer } from './Renderer';
import type { World } from './World';
import { generateCity, type GenerateCityOptions } from '@/generation/CityGenerator';

export type GameEngineOptions = {
  /** Options forwarded to generateCity (e.g. seed). */
  generation?: GenerateCityOptions;
  /** Renderer cell size in pixels. Defaults to 10. */
  cellSize?: number;
  /** GameLoop fixed update rate in Hz. Defaults to 20. */
  fixedDtHz?: number;
};

export class GameEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  public readonly world: World;
  public readonly camera: Camera;
  public readonly renderer: Renderer;
  public readonly loop: GameLoop;

  constructor(canvas: HTMLCanvasElement, options: GameEngineOptions = {}) {
    this.canvas = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D rendering context from canvas');
    }
    this.ctx = ctx;

    // 1. Generate the city world (uses default 80×80 grid unless overridden).
    this.world = generateCity(undefined, undefined, options.generation);

    // 2. Create camera sized to the canvas client dimensions.
    const viewportWidth = canvas.clientWidth > 0 ? canvas.clientWidth : canvas.width;
    const viewportHeight = canvas.clientHeight > 0 ? canvas.clientHeight : canvas.height;

    this.camera = new Camera({
      viewportWidth,
      viewportHeight,
      worldWidth: this.world.grid.width,
      worldHeight: this.world.grid.height,
    });

    // 3. Create renderer.
    this.renderer = new Renderer(this.ctx, options.cellSize ?? 10);

    // 4. Wire the game loop: update lerps the camera, render draws the world.
    this.loop = new GameLoop(
      () => {
        this.camera.update();
      },
      () => {
        this.renderer.render(this.world, this.camera.getTransform());
      },
      { fixedDtHz: options.fixedDtHz },
    );

    // 5. Attach camera input handlers (pan/zoom) to the canvas.
    this.camera.attach(canvas);
  }

  /** Start the rAF game loop. */
  start(): void {
    this.loop.start();
  }

  /** Stop (pause) the game loop. Can be restarted with start(). */
  stop(): void {
    this.loop.stop();
  }

  /**
   * Fully tear down: stop the loop and detach camera event listeners.
   *
   * After dispose() the engine should not be reused.
   */
  dispose(): void {
    this.loop.stop();
    this.camera.detach();
  }
}
