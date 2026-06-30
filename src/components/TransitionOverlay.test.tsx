/**
 * Unit tests for the TransitionOverlay component.
 *
 * Verifies the overlay is hidden at rest, appears during a transition, shows
 * the target year label, and reflects progress via the progress bar width.
 */
import { render, screen, cleanup } from '@testing-library/react';
import { useYearStore } from '@/store/yearStore';
import TransitionOverlay from './TransitionOverlay';

function resetStore() {
  useYearStore.setState({
    selectedYear: 'present',
    targetYear: 'present',
    transitionProgress: 1,
  });
}

describe('TransitionOverlay', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('is not rendered while at rest (progress = 1)', () => {
    render(<TransitionOverlay />);
    expect(screen.queryByTestId('transition-overlay')).not.toBeInTheDocument();
  });

  it('renders when a transition is in flight (progress < 1)', () => {
    useYearStore.setState({
      targetYear: 'postwar',
      transitionProgress: 0,
    });
    render(<TransitionOverlay />);
    expect(screen.getByTestId('transition-overlay')).toBeInTheDocument();
  });

  it('displays the target year label', () => {
    useYearStore.setState({
      targetYear: 'postwar',
      transitionProgress: 0.3,
    });
    render(<TransitionOverlay />);
    expect(screen.getByText('1945')).toBeInTheDocument();
  });

  it('shows the progress bar with width matching transition progress', () => {
    useYearStore.setState({
      targetYear: 'sixties',
      transitionProgress: 0.5,
    });
    render(<TransitionOverlay />);
    const bar = screen.getByTestId('transition-progress-bar');
    // 0.5 * 100 = 50%
    expect(bar).toHaveStyle({ width: '50%' });
  });

  it('shows 0% width at the start of a transition', () => {
    useYearStore.setState({
      targetYear: 'eighties',
      transitionProgress: 0,
    });
    render(<TransitionOverlay />);
    const bar = screen.getByTestId('transition-progress-bar');
    expect(bar).toHaveStyle({ width: '0%' });
  });

  it('shows the help tooltip text', () => {
    useYearStore.setState({
      targetYear: 'postwar',
      transitionProgress: 0.1,
    });
    render(<TransitionOverlay />);
    expect(
      screen.getByText('Morphing the city across eras…'),
    ).toBeInTheDocument();
  });

  it('has role=status and aria-live=polite for accessibility', () => {
    useYearStore.setState({
      targetYear: 'postwar',
      transitionProgress: 0.2,
    });
    render(<TransitionOverlay />);
    const overlay = screen.getByTestId('transition-overlay');
    expect(overlay).toHaveAttribute('role', 'status');
    expect(overlay).toHaveAttribute('aria-live', 'polite');
  });
});
