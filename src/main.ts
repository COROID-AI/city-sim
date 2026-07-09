/**
 * Application entry point.
 *
 * The full game loop, renderer, input handling, and state reducer are added in
 * later phases. For now this wires up the canvas so the page boots cleanly and
 * downstream tasks have a known anchor (`tetris-canvas`) to render into.
 */

const CANVAS_ID = 'tetris-canvas';

function getCanvas(): HTMLCanvasElement | null {
  return document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
}

function bootstrap(): void {
  const canvas = getCanvas();
  if (!canvas) {
    // The canvas is required for the game; fail loudly during development.
    throw new Error(`Could not find canvas element with id "${CANVAS_ID}".`);
  }

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas context is unavailable in this browser.');
  }

  // Placeholder render: a solid background so the canvas is visibly alive.
  context.fillStyle = '#0b0f19';
  context.fillRect(0, 0, canvas.width, canvas.height);
}

bootstrap();
