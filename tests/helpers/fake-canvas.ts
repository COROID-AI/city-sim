/**
 * Recording Canvas 2D test double.
 *
 * Render, HUD and minimap tests use this instead of duplicating canvas mocks:
 * it keeps a full call log (`calls`), a property-write log (`writes`) and the
 * paint state (`font`, `fillStyle`, ...) so tests can assert what was drawn.
 *
 * The factory works in both environments:
 * - with a DOM (jsdom/browser) it wraps a real `<canvas>` element whose
 *   `getContext('2d')` returns the recording context;
 * - in plain Node it returns a structural canvas stub, so `src/sim` suites can
 *   keep running without `jsdom`.
 */

export interface ContextCall {
  /** Method name, e.g. `fillRect`. */
  readonly method: string;
  /** Arguments the method was called with. */
  readonly args: unknown[];
}

export interface ContextWrite {
  /** Property name, e.g. `fillStyle`. */
  readonly property: string;
  /** Value assigned to the property. */
  readonly value: unknown;
}

export interface FakeCanvasOptions {
  width?: number;
  height?: number;
}

export interface FakeCanvasHandle {
  /** Recording 2D context. */
  readonly context: RecordingContext2D;
  /** Canvas the context belongs to (real element when a DOM exists). */
  readonly canvas: HTMLCanvasElement;
  /** Live call log (same array as `context.calls`). */
  readonly calls: ContextCall[];
  /** Live property-write log (same array as `context.writes`). */
  readonly writes: ContextWrite[];
  /** Number of recorded calls of `method`. */
  countOf(method: string): number;
  /** Recorded calls of `method`, in order. */
  callsFor(method: string): ContextCall[];
  /** Clears both logs. */
  reset(): void;
  /** Resizes the underlying canvas. */
  resize(width: number, height: number): void;
}

function createGradientStub(calls: ContextCall[]): CanvasGradient {
  return {
    addColorStop(offset: number, color: string): void {
      calls.push({ method: 'addColorStop', args: [offset, color] });
    },
  } as unknown as CanvasGradient;
}

/** A `CanvasRenderingContext2D` that records everything it is asked to draw. */
export class RecordingContext2D {
  readonly calls: ContextCall[] = [];
  readonly writes: ContextWrite[] = [];
  readonly canvas: HTMLCanvasElement | null;

  private fillStyleValue: string | CanvasGradient | CanvasPattern = '#000000';
  private strokeStyleValue: string | CanvasGradient | CanvasPattern = '#000000';
  private lineWidthValue = 1;
  private lineCapValue: CanvasLineCap = 'butt';
  private lineJoinValue: CanvasLineJoin = 'miter';
  private lineDashOffsetValue = 0;
  private fontValue = '10px sans-serif';
  private textAlignValue: CanvasTextAlign = 'start';
  private textBaselineValue: CanvasTextBaseline = 'alphabetic';
  private globalAlphaValue = 1;
  private globalCompositeOperationValue: GlobalCompositeOperation = 'source-over';
  private imageSmoothingEnabledValue = true;
  private shadowBlurValue = 0;
  private shadowColorValue = 'rgba(0, 0, 0, 0)';
  private lineDash: number[] = [];

  constructor(canvas: HTMLCanvasElement | null = null) {
    this.canvas = canvas;
  }

  /* ------------------------------------------------------ recorded state -- */

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.fillStyleValue;
  }

  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.fillStyleValue = value;
    this.writes.push({ property: 'fillStyle', value });
  }

  get strokeStyle(): string | CanvasGradient | CanvasPattern {
    return this.strokeStyleValue;
  }

  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    this.strokeStyleValue = value;
    this.writes.push({ property: 'strokeStyle', value });
  }

  get lineWidth(): number {
    return this.lineWidthValue;
  }

  set lineWidth(value: number) {
    this.lineWidthValue = value;
    this.writes.push({ property: 'lineWidth', value });
  }

  get lineCap(): CanvasLineCap {
    return this.lineCapValue;
  }

  set lineCap(value: CanvasLineCap) {
    this.lineCapValue = value;
    this.writes.push({ property: 'lineCap', value });
  }

  get lineJoin(): CanvasLineJoin {
    return this.lineJoinValue;
  }

  set lineJoin(value: CanvasLineJoin) {
    this.lineJoinValue = value;
    this.writes.push({ property: 'lineJoin', value });
  }

  get lineDashOffset(): number {
    return this.lineDashOffsetValue;
  }

  set lineDashOffset(value: number) {
    this.lineDashOffsetValue = value;
    this.writes.push({ property: 'lineDashOffset', value });
  }

  get font(): string {
    return this.fontValue;
  }

  set font(value: string) {
    this.fontValue = value;
    this.writes.push({ property: 'font', value });
  }

  get textAlign(): CanvasTextAlign {
    return this.textAlignValue;
  }

  set textAlign(value: CanvasTextAlign) {
    this.textAlignValue = value;
    this.writes.push({ property: 'textAlign', value });
  }

  get textBaseline(): CanvasTextBaseline {
    return this.textBaselineValue;
  }

  set textBaseline(value: CanvasTextBaseline) {
    this.textBaselineValue = value;
    this.writes.push({ property: 'textBaseline', value });
  }

  get globalAlpha(): number {
    return this.globalAlphaValue;
  }

  set globalAlpha(value: number) {
    this.globalAlphaValue = value;
    this.writes.push({ property: 'globalAlpha', value });
  }

  get globalCompositeOperation(): GlobalCompositeOperation {
    return this.globalCompositeOperationValue;
  }

  set globalCompositeOperation(value: GlobalCompositeOperation) {
    this.globalCompositeOperationValue = value;
    this.writes.push({ property: 'globalCompositeOperation', value });
  }

  get imageSmoothingEnabled(): boolean {
    return this.imageSmoothingEnabledValue;
  }

  set imageSmoothingEnabled(value: boolean) {
    this.imageSmoothingEnabledValue = value;
    this.writes.push({ property: 'imageSmoothingEnabled', value });
  }

  get shadowBlur(): number {
    return this.shadowBlurValue;
  }

  set shadowBlur(value: number) {
    this.shadowBlurValue = value;
    this.writes.push({ property: 'shadowBlur', value });
  }

  get shadowColor(): string {
    return this.shadowColorValue;
  }

  set shadowColor(value: string) {
    this.shadowColorValue = value;
    this.writes.push({ property: 'shadowColor', value });
  }

  /* ------------------------------------------------------------ drawing -- */

  save(): void {
    this.calls.push({ method: 'save', args: [] });
  }

  restore(): void {
    this.calls.push({ method: 'restore', args: [] });
  }

  translate(x: number, y: number): void {
    this.calls.push({ method: 'translate', args: [x, y] });
  }

  rotate(angle: number): void {
    this.calls.push({ method: 'rotate', args: [angle] });
  }

  scale(x: number, y: number): void {
    this.calls.push({ method: 'scale', args: [x, y] });
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.calls.push({ method: 'transform', args: [a, b, c, d, e, f] });
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.calls.push({ method: 'setTransform', args: [a, b, c, d, e, f] });
  }

  resetTransform(): void {
    this.calls.push({ method: 'resetTransform', args: [] });
  }

  beginPath(): void {
    this.calls.push({ method: 'beginPath', args: [] });
  }

  closePath(): void {
    this.calls.push({ method: 'closePath', args: [] });
  }

  moveTo(x: number, y: number): void {
    this.calls.push({ method: 'moveTo', args: [x, y] });
  }

  lineTo(x: number, y: number): void {
    this.calls.push({ method: 'lineTo', args: [x, y] });
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.calls.push({ method: 'arc', args: [x, y, radius, startAngle, endAngle, counterclockwise ?? false] });
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.calls.push({ method: 'arcTo', args: [x1, y1, x2, y2, radius] });
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void {
    this.calls.push({
      method: 'ellipse',
      args: [x, y, radiusX, radiusY, rotation, startAngle, endAngle],
    });
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.calls.push({ method: 'rect', args: [x, y, width, height] });
  }

  roundRect(x: number, y: number, width: number, height: number, radii?: number | number[]): void {
    this.calls.push({ method: 'roundRect', args: [x, y, width, height, radii ?? 0] });
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.calls.push({ method: 'quadraticCurveTo', args: [cpx, cpy, x, y] });
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.calls.push({ method: 'bezierCurveTo', args: [cp1x, cp1y, cp2x, cp2y, x, y] });
  }

  fill(): void {
    this.calls.push({ method: 'fill', args: [] });
  }

  stroke(): void {
    this.calls.push({ method: 'stroke', args: [] });
  }

  clip(): void {
    this.calls.push({ method: 'clip', args: [] });
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.calls.push({ method: 'fillRect', args: [x, y, width, height] });
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.calls.push({ method: 'strokeRect', args: [x, y, width, height] });
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.calls.push({ method: 'clearRect', args: [x, y, width, height] });
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.calls.push({ method: 'fillText', args: maxWidth === undefined ? [text, x, y] : [text, x, y, maxWidth] });
  }

  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    this.calls.push({
      method: 'strokeText',
      args: maxWidth === undefined ? [text, x, y] : [text, x, y, maxWidth],
    });
  }

  drawImage(image: unknown, dx: number, dy: number, dw?: number, dh?: number): void {
    this.calls.push({ method: 'drawImage', args: [image, dx, dy, dw ?? 0, dh ?? 0] });
  }

  setLineDash(segments: readonly number[]): void {
    this.lineDash = [...segments];
    this.calls.push({ method: 'setLineDash', args: [[...segments]] });
  }

  getLineDash(): number[] {
    this.calls.push({ method: 'getLineDash', args: [] });
    return [...this.lineDash];
  }

  createPattern(): CanvasPattern | null {
    this.calls.push({ method: 'createPattern', args: [] });
    return null;
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    this.calls.push({ method: 'createLinearGradient', args: [x0, y0, x1, y1] });
    return createGradientStub(this.calls);
  }

  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient {
    this.calls.push({ method: 'createRadialGradient', args: [x0, y0, r0, x1, y1, r1] });
    return createGradientStub(this.calls);
  }

  measureText(text: string): TextMetrics {
    this.calls.push({ method: 'measureText', args: [text] });
    const size = this.fontSizePx();
    return {
      width: text.length * size * 0.55,
      actualBoundingBoxAscent: size * 0.8,
      actualBoundingBoxDescent: size * 0.2,
    } as unknown as TextMetrics;
  }

  /* ------------------------------------------------------------ helpers -- */

  /** Pixel size parsed from the current `font` string. */
  fontSizePx(): number {
    const match = /(\d+(?:\.\d+)?)px/.exec(this.fontValue);
    return match ? Number(match[1]) : 10;
  }

  countOf(method: string): number {
    let total = 0;
    for (const call of this.calls) {
      if (call.method === method) {
        total += 1;
      }
    }
    return total;
  }

  callsFor(method: string): ContextCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  lastCall(method: string): ContextCall | undefined {
    for (let index = this.calls.length - 1; index >= 0; index -= 1) {
      if (this.calls[index].method === method) {
        return this.calls[index];
      }
    }
    return undefined;
  }

  writesFor(property: string): ContextWrite[] {
    return this.writes.filter((write) => write.property === property);
  }

  /** Clears both logs; the paint state is left as-is. */
  reset(): void {
    this.calls.length = 0;
    this.writes.length = 0;
  }

  /** The recording context typed as a real 2D context for production code. */
  toContext2D(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }
}

type CanvasStub = {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  readonly style: Record<string, string>;
  getContext(type: string): unknown;
  getBoundingClientRect(): {
    x: number;
    y: number;
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  addEventListener(): void;
  removeEventListener(): void;
  appendChild(): void;
  setAttribute(): void;
};

function createCanvasStub(width: number, height: number): CanvasStub {
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    getContext() {
      return null;
    },
    getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
      };
    },
    addEventListener() {
      /* no-op */
    },
    removeEventListener() {
      /* no-op */
    },
    appendChild() {
      /* no-op */
    },
    setAttribute() {
      /* no-op */
    },
  };
}

function attachRecordingContext(canvas: HTMLCanvasElement, context: RecordingContext2D): void {
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    writable: true,
    value: (type: string) => (type === '2d' ? context.toContext2D() : null),
  });
}

/**
 * Creates a canvas plus recording 2D context.
 * Uses a real `<canvas>` when a DOM is available, a structural stub otherwise.
 */
export function createFakeCanvas(options: FakeCanvasOptions = {}): FakeCanvasHandle {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const hasDom = typeof document !== 'undefined' && typeof document.createElement === 'function';
  const canvas = hasDom
    ? document.createElement('canvas')
    : (createCanvasStub(width, height) as unknown as HTMLCanvasElement);

  canvas.width = width;
  canvas.height = height;
  const context = new RecordingContext2D(canvas);
  attachRecordingContext(canvas, context);
  if (!hasDom) {
    // Keep the stub's layout metrics in sync with resize() through the DOM API.
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => canvas.width });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => canvas.height });
  }

  return {
    context,
    canvas,
    calls: context.calls,
    writes: context.writes,
    countOf: (method: string) => context.countOf(method),
    callsFor: (method: string) => context.callsFor(method),
    reset: () => context.reset(),
    resize: (nextWidth: number, nextHeight: number) => {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    },
  };
}

/** Convenience factory when only the recording context is needed. */
export function createRecordingContext(canvas?: HTMLCanvasElement | null): RecordingContext2D {
  return new RecordingContext2D(canvas ?? null);
}
