/**
 * Tetris entry point.
 *
 * Wires the canvas, keyboard input, and game loop together. The actual game
 * logic lives in the `game` module (added by subsequent tasks); this scaffold
 * keeps a minimal running loop so the page is interactive immediately.
 */

const CANVAS_ID = "board";

function getCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById(CANVAS_ID);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(
      `Expected an <canvas id="${CANVAS_ID}"> element in the document.`
    );
  }
  return canvas;
}

function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Unable to acquire a 2D rendering context.");
  }
  return ctx;
}

/**
 * Renders a placeholder frame. Real block rendering arrives with the renderer
 * task; for now we just clear the board so the canvas is visibly alive.
 */
function render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.fillStyle = "#0f0f1e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function main(): void {
  const canvas = getCanvas();
  const ctx = getContext(canvas);

  // Arrow-key handling. Rotating (Up) and moving (Left/Right/Down) is driven by
  // subsequent tasks; the scaffold simply logs direction so input is provably
  // wired up.
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        event.preventDefault();
        break;
      default:
        break;
    }
  });

  const loop = (): void => {
    render(ctx, canvas);
    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

main();
