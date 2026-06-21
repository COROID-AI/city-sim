import { render, screen } from '@testing-library/react';
import Home from '@/app/page';

/**
 * Scaffold test.
 *
 * Verifies that Jest + ts-jest + jsdom + @testing-library/react +
 * @testing-library/jest-dom are all wired correctly by rendering the Home
 * component and asserting the canvas smoke-test target is present.
 */
describe('scaffold', () => {
  it('renders the city canvas element', () => {
    render(<Home />);
    const canvas = screen.getByTestId('city-canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
  });
});
