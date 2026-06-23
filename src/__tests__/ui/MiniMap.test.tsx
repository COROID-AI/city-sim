/**
 * Unit tests for MiniMap (spec §6.4, §5.5).
 *
 * jsdom does not implement the canvas 2D context, so getContext is mocked to
 * return a capture-all stub. The component guards against a null context.
 */
import { render, screen, cleanup, act } from '@testing-library/react';
import { Camera } from '@/engine/Camera';
import { World } from '@/engine/World';
import MiniMap, { MINI_SIZE } from '@/ui/MiniMap';

/** A capture-all canvas 2D context mock. */
function makeCtxMock() {
  return {
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  };
}

describe('MiniMap', () => {
  let world: World;
  let camera: Camera;
  let ctxMock: ReturnType<typeof makeCtxMock>;
  let getContextSpy: jest.SpyInstance | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    world = new World(80, 80);
    camera = new Camera(80 * 16, 80 * 16, { viewportWidth: 800, viewportHeight: 600 });
    ctxMock = makeCtxMock();
    getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctxMock as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    getContextSpy?.mockRestore();
  });

  it('renders the spec §6.4 container classes (fixed bottom-left, hidden md:block)', () => {
    render(<MiniMap camera={camera} world={world} />);
    const container = screen.getByTestId('minimap');
    const cls = container.className;
    expect(cls).toContain('fixed');
    expect(cls).toContain('bottom-4');
    expect(cls).toContain('left-4');
    expect(cls).toContain('hidden');
    expect(cls).toContain('md:block');
  });

  it('renders a canvas with the correct 40x40 dimensions', () => {
    render(<MiniMap camera={camera} world={world} />);
    const canvas = screen.getByTestId('minimap-canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(MINI_SIZE);
    expect(canvas.height).toBe(MINI_SIZE);
  });

  it('draws the dark background and a viewport rectangle on mount', () => {
    render(<MiniMap camera={camera} world={world} />);
    // fillRect is called for the background clear.
    expect(ctxMock.fillRect).toHaveBeenCalled();
    // strokeRect is called for the white viewport rectangle.
    expect(ctxMock.strokeRect).toHaveBeenCalled();
  });

  it('redraws at 2 Hz', () => {
    render(<MiniMap camera={camera} world={world} />);
    const before = ctxMock.strokeRect.mock.calls.length;
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(ctxMock.strokeRect.mock.calls.length).toBeGreaterThan(before);
  });

  it('clears the polling interval on unmount', () => {
    const setSpy = jest.spyOn(window, 'setInterval');
    const clearSpy = jest.spyOn(window, 'clearInterval');
    const { unmount } = render(<MiniMap camera={camera} world={world} />);
    const id = setSpy.mock.results[0].value;
    unmount();
    expect(clearSpy).toHaveBeenCalledWith(id);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
