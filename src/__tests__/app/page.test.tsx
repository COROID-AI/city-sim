import { render, screen } from '@testing-library/react';
import Home from '@/app/page';

describe('Home page', () => {
  it('renders a canvas element in the DOM', () => {
    const { container } = render(<Home />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).toBeInTheDocument();
  });

  it('renders the UI overlay with visible placeholder text', () => {
    render(<Home />);
    expect(
      screen.getByText('City Simulation'),
    ).toBeInTheDocument();
    expect(screen.getByText('Loading the city…')).toBeInTheDocument();
  });

  it('renders without errors', () => {
    const { container } = render(<Home />);
    expect(container).toBeDefined();
  });
});
