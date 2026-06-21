import { render, screen } from '@testing-library/react';
import Home from '@/app/page';

/**
 * Page contract test (spec 9.1 per-module coverage).
 *
 * Asserts the Home page renders the simulation canvas with the stable DOM
 * contract attributes consumed by the Playwright E2E smoke test and the
 * downstream GameEngine boot sequence.
 */
describe('Home page', () => {
  it('renders a <canvas> with data-testid="city-canvas" and id="city-canvas"', () => {
    render(<Home />);

    const canvas = screen.getByTestId('city-canvas');

    // Present in the document.
    expect(canvas).toBeInTheDocument();

    // Is an HTMLCanvasElement (tagName === 'canvas').
    expect(canvas.tagName.toLowerCase()).toBe('canvas');

    // Carries the stable id contract.
    expect(canvas).toHaveAttribute('id', 'city-canvas');
  });
});
