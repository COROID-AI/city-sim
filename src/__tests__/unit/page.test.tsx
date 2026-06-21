import { render, screen } from '@testing-library/react';
import Home from '@/app/page';

/**
 * Page contract test.
 *
 * Asserts the canvas mount point and the five overlay slots are present with
 * their stable data-testid attributes, and that the canvas is the only
 * <canvas> element in the rendered DOM.
 */
describe('Home page', () => {
  it('renders the city canvas with the stable contract attributes', () => {
    render(<Home />);
    const canvas = screen.getByTestId('city-canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
    expect(canvas).toHaveAttribute('id', 'city-canvas');
  });

  it('renders exactly one canvas element', () => {
    const { container } = render(<Home />);
    const canvases = container.querySelectorAll('canvas');
    expect(canvases).toHaveLength(1);
  });

  it.each([
    ['ui-topbar'],
    ['ui-citylog'],
    ['ui-timecontrols'],
    ['ui-minimap'],
    ['ui-tooltip'],
  ])('renders the %s overlay slot', (testId) => {
    render(<Home />);
    const slot = screen.getByTestId(testId);
    expect(slot).toBeInTheDocument();
  });
});
