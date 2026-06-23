import { render, screen } from '@testing-library/react';
import Home from '@/app/page';

/**
 * jsdom does not implement HTMLCanvasElement.prototype.getContext (it requires
 * the optional `canvas` npm package). We stub it to return a no-op 2D context
 * so the page's useEffect can instantiate the Renderer + GameLoop under test.
 */
function mockCanvasContext(): void {
  const noop = () => {};
  const ctx = {
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    fillRect: noop,
    clearRect: noop,
    set fillStyle(_v: string) {},
    get fillStyle(): string {
      return '';
    },
    set strokeStyle(_v: string) {},
    get strokeStyle(): string {
      return '';
    },
  };
  HTMLCanvasElement.prototype.getContext = jest
    .fn()
    .mockReturnValue(ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

describe('Home page', () => {
  beforeEach(() => {
    mockCanvasContext();
  });

  it('renders a canvas element in the DOM', () => {
    const { container } = render(<Home />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).toBeInTheDocument();
  });

  it('renders the UI overlay with the title and no loading placeholder', () => {
    render(<Home />);
    expect(
      screen.getByText('City Simulation'),
    ).toBeInTheDocument();
    // The "Loading the city…" placeholder is removed once the engine is wired.
    expect(screen.queryByText('Loading the city…')).toBeNull();
  });

  it('renders without errors', () => {
    const { container } = render(<Home />);
    expect(container).toBeDefined();
  });
});
