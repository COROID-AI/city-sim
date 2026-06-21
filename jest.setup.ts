import '@testing-library/jest-dom';

/**
 * Jest setup file.
 *
 * Imported via `setupFilesAfterEnv` in jest.config.cjs. Adds the
 * @testing-library/jest-dom matchers (toBeInTheDocument, toHaveAttribute, …)
 * to the global expect.
 *
 * CANVAS MOCK: jsdom does not implement the CanvasRenderingContext2D
 * rendering pipeline, so HTMLCanvasElement.prototype.getContext returns null.
 * The GameEngine constructor calls canvas.getContext('2d') and throws if it
 * is null. We install a no-op 2D context stub so component tests that render
 * <Home /> (which boots GameEngine on mount) work without a real canvas.
 * Unit tests that need to assert draw calls supply their own mock context.
 */

const noop = (): void => {};

const ctxStub = {
  canvas: {} as HTMLCanvasElement,
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  imageSmoothingEnabled: true,
  setTransform: noop,
  translate: noop,
  scale: noop,
  rotate: noop,
  save: noop,
  restore: noop,
  clearRect: noop,
  fillRect: noop,
  strokeRect: noop,
  beginPath: noop,
  closePath: noop,
  moveTo: noop,
  lineTo: noop,
  arc: noop,
  rect: noop,
  fill: noop,
  stroke: noop,
  fillText: noop,
  strokeText: noop,
  measureText: () => ({ width: 0 }) as TextMetrics,
  drawImage: noop,
  createImageData: () => ({} as ImageData),
  getImageData: () => ({} as ImageData),
  putImageData: noop,
  createLinearGradient: () => ({ addColorStop: noop }) as CanvasGradient,
  createRadialGradient: () => ({ addColorStop: noop }) as CanvasGradient,
  createPattern: () => ({} as CanvasPattern),
  clip: noop,
  isPointInPath: () => false,
  quadraticCurveTo: noop,
  bezierCurveTo: noop,
  setLineDash: noop,
  getLineDash: () => [],
  arcTo: noop,
  ellipse: noop,
  resetTransform: noop,
} as unknown as CanvasRenderingContext2D;

HTMLCanvasElement.prototype.getContext = jest.fn(
  () => ctxStub,
) as unknown as typeof HTMLCanvasElement.prototype.getContext;
