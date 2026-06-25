/**
 * Unit tests for TimeControls (spec §6.4, §5.5).
 *
 * Uses a real TimeSystem instance to verify the component dispatches via the
 * engine public API (setSpeed/pause) and that the active-speed highlight
 * tracks engine state. Fake timers drive the 2 Hz polling interval.
 */
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from '@testing-library/react';
import { TimeSystem } from '@/systems/TimeSystem';
import TimeControls from '@/ui/TimeControls';

describe('TimeControls', () => {
  let timeSystem: TimeSystem;

  beforeEach(() => {
    jest.useFakeTimers();
    timeSystem = new TimeSystem();
    timeSystem.setSpeed(1);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  /** Advance the 2 Hz poll so displaySpeed re-syncs with engine state.
   *  Wrapped in act() so React flushes the setState scheduled inside the
   *  interval callback before assertions run. */
  function flushPoll(): void {
    act(() => {
      jest.advanceTimersByTime(500);
    });
  }

  it('renders pause/play and 1x/2x/5x buttons with test ids and aria-labels', () => {
    render(<TimeControls timeSystem={timeSystem} />);

    expect(screen.getByTestId('pause-play-button')).toBeInTheDocument();
    expect(screen.getByTestId('speed-1x-button')).toBeInTheDocument();
    expect(screen.getByTestId('speed-2x-button')).toBeInTheDocument();
    expect(screen.getByTestId('speed-5x-button')).toBeInTheDocument();

    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    expect(screen.getByLabelText('Set speed 1x')).toBeInTheDocument();
    expect(screen.getByLabelText('Set speed 2x')).toBeInTheDocument();
    expect(screen.getByLabelText('Set speed 5x')).toBeInTheDocument();
  });

  it('highlights the active speed button with bg-blue-600', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    const one = screen.getByTestId('speed-1x-button');
    const two = screen.getByTestId('speed-2x-button');
    expect(one.className).toContain('bg-blue-600');
    expect(two.className).not.toContain('bg-blue-600');
  });

  it('uses bg-slate-700/50 for inactive speed buttons', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    const two = screen.getByTestId('speed-2x-button');
    expect(two.className).toContain('bg-slate-700/50');
  });

  it('clicking a speed button calls timeSystem.setSpeed and updates engine', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    fireEvent.click(screen.getByTestId('speed-5x-button'));
    expect(timeSystem.getSpeed()).toBe(5);

    fireEvent.click(screen.getByTestId('speed-2x-button'));
    expect(timeSystem.getSpeed()).toBe(2);
  });

  it('updates the active highlight after clicking a speed button', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    fireEvent.click(screen.getByTestId('speed-5x-button'));
    const five = screen.getByTestId('speed-5x-button');
    const one = screen.getByTestId('speed-1x-button');
    expect(five.className).toContain('bg-blue-600');
    expect(one.className).toContain('bg-slate-700/50');
  });

  it('clicking pause sets engine speed to 0', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    fireEvent.click(screen.getByTestId('pause-play-button'));
    expect(timeSystem.getSpeed()).toBe(0);
    expect(timeSystem.isPaused()).toBe(true);
  });

  it('clicking play restores the last non-zero speed (not always 1x)', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    // Choose 5x, then pause, then play → should restore 5x.
    fireEvent.click(screen.getByTestId('speed-5x-button'));
    expect(timeSystem.getSpeed()).toBe(5);

    fireEvent.click(screen.getByTestId('pause-play-button'));
    expect(timeSystem.getSpeed()).toBe(0);

    fireEvent.click(screen.getByTestId('pause-play-button'));
    expect(timeSystem.getSpeed()).toBe(5);
  });

  it('play before any speed click restores default 1x', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    fireEvent.click(screen.getByTestId('pause-play-button'));
    expect(timeSystem.getSpeed()).toBe(0);
    fireEvent.click(screen.getByTestId('pause-play-button'));
    expect(timeSystem.getSpeed()).toBe(1);
  });

  it('toggles the pause/play aria-label between Pause and Play', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pause-play-button'));
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('2 Hz poll re-syncs highlight when engine speed changes externally', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    // Engine state changes outside React (e.g. from another caller).
    timeSystem.setSpeed(2);
    // Before the poll fires, the 1x button is still highlighted.
    expect(screen.getByTestId('speed-1x-button').className).toContain('bg-blue-600');
    flushPoll();
    // After the 500ms poll, the 2x button is highlighted.
    expect(screen.getByTestId('speed-2x-button').className).toContain('bg-blue-600');
    expect(screen.getByTestId('speed-1x-button').className).toContain('bg-slate-700/50');
  });

  it('clears the polling interval on unmount', () => {
    const setSpy = jest.spyOn(window, 'setInterval');
    const clearSpy = jest.spyOn(window, 'clearInterval');
    const { unmount } = render(<TimeControls timeSystem={timeSystem} />);
    const id = setSpy.mock.results[0].value;
    unmount();
    expect(clearSpy).toHaveBeenCalledWith(id);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('uses the spec §6.4 container classes', () => {
    render(<TimeControls timeSystem={timeSystem} />);
    const container = screen.getByTestId('time-controls');
    const cls = container.className;
    expect(cls).toContain('fixed');
    expect(cls).toContain('bottom-4');
    expect(cls).toContain('left-1/2');
    expect(cls).toContain('-translate-x-1/2');
    expect(cls).toContain('bg-slate-900/70');
    expect(cls).toContain('backdrop-blur');
    expect(cls).toContain('rounded-full');
  });
});
