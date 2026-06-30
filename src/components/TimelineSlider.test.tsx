/**
 * Unit tests for the TimelineSlider component.
 *
 * Uses the global Jest API (no @jest/globals import) so @testing-library/jest-dom
 * matchers augment the global expect. The year store is reset between tests to
 * avoid cross-test state leakage.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useYearStore } from '@/store/yearStore';
import TimelineSlider from './TimelineSlider';
import { YEAR_CONFIGS } from '@/config/years';

function resetStore() {
  useYearStore.setState({
    selectedYear: 'present',
    targetYear: 'present',
    transitionProgress: 1,
  });
}

describe('TimelineSlider', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all five year stop labels', () => {
    render(<TimelineSlider />);
    for (const config of YEAR_CONFIGS) {
      expect(
        screen.getByTestId(`timeline-stop-${config.label}`),
      ).toBeInTheDocument();
    }
  });

  it('displays the active year label', () => {
    render(<TimelineSlider />);
    expect(screen.getByTestId('timeline-current-year')).toHaveTextContent(
      '2025',
    );
  });

  it('marks the selected stop as active', () => {
    render(<TimelineSlider />);
    const activeStop = screen.getByTestId('timeline-stop-2025');
    expect(activeStop).toHaveAttribute('data-active', 'true');
    expect(activeStop).toHaveAttribute('aria-pressed', 'true');
  });

  it('dispatches store.setYear when a stop button is clicked', () => {
    render(<TimelineSlider />);
    fireEvent.click(screen.getByTestId('timeline-stop-1945'));
    // setYear updates targetYear (the era being transitioned towards);
    // selectedYear only catches up once completeTransition() runs.
    expect(useYearStore.getState().targetYear).toBe('postwar');
  });

  it('dispatches store.setYear when the range input changes', () => {
    render(<TimelineSlider />);
    const input = screen.getByTestId(
      'timeline-range-input',
    ) as HTMLInputElement;
    // Index 2 corresponds to 1985 (eighties).
    fireEvent.change(input, { target: { value: '2' } });
    expect(useYearStore.getState().targetYear).toBe('eighties');
  });

  it('updates the active year display after selecting a stop', () => {
    render(<TimelineSlider />);
    fireEvent.click(screen.getByTestId('timeline-stop-1965'));
    expect(screen.getByTestId('timeline-current-year')).toHaveTextContent(
      '1965',
    );
  });

  it('exposes an accessible aria-label on the range input', () => {
    render(<TimelineSlider />);
    expect(
      screen.getByLabelText('Timeline year selector'),
    ).toBeInTheDocument();
  });
});
