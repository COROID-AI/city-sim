/**
 * Unit tests for Dashboard (spec §6.4, §5.5).
 *
 * Uses real World + TimeSystem instances to verify the component reads engine
 * state and displays population / employment / budget / time fields. Fake
 * timers drive the 2 Hz polling interval.
 */
import { render, screen, cleanup, act } from '@testing-library/react';
import { World } from '@/engine/World';
import { TimeSystem } from '@/systems/TimeSystem';
import { Citizen } from '@/entities/Citizen';
import Dashboard, { STARTING_BUDGET } from '@/ui/Dashboard';

describe('Dashboard', () => {
  let world: World;
  let timeSystem: TimeSystem;

  beforeEach(() => {
    jest.useFakeTimers();
    world = new World(80, 80);
    timeSystem = new TimeSystem();
    timeSystem.setSpeed(1);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  /** Advance the 2 Hz poll so displayed stats re-sync with engine state. */
  function flushPoll(): void {
    act(() => {
      jest.advanceTimersByTime(500);
    });
  }

  it('renders the spec §6.4 container classes', () => {
    render(<Dashboard world={world} timeSystem={timeSystem} />);
    const container = screen.getByTestId('dashboard');
    const cls = container.className;
    expect(cls).toContain('fixed');
    expect(cls).toContain('top-0');
    expect(cls).toContain('h-14');
    expect(cls).toContain('bg-slate-900/80');
    expect(cls).toContain('backdrop-blur');
    expect(cls).toContain('text-white');
  });

  it('renders the city name and Built by Coroid badge', () => {
    render(<Dashboard world={world} timeSystem={timeSystem} />);
    expect(screen.getByTestId('dashboard-city-name').textContent).toBe('Coroid City');
    expect(screen.getByTestId('dashboard-badge').textContent).toBe('Built by Coroid');
  });

  it('renders population 0 and employment 0% with no citizens', () => {
    render(<Dashboard world={world} timeSystem={timeSystem} />);
    expect(screen.getByTestId('dashboard-population').textContent).toContain('0');
    expect(screen.getByTestId('dashboard-employment').textContent).toContain('0%');
  });

  it('renders correct population and employment rate with citizens', () => {
    world.addCitizen(new Citizen({ x: 0, y: 0 }, { name: 'A', employed: true }));
    world.addCitizen(new Citizen({ x: 0, y: 0 }, { name: 'B', employed: true }));
    world.addCitizen(new Citizen({ x: 0, y: 0 }, { name: 'C', employed: false }));

    render(<Dashboard world={world} timeSystem={timeSystem} />);

    // Population = 3.
    expect(screen.getByTestId('dashboard-population').textContent).toContain('3');
    // Employment rate = round(2/3 * 100) = 67%.
    expect(screen.getByTestId('dashboard-employment').textContent).toContain('67%');
  });

  it('renders the starting budget at sim time 0', () => {
    render(<Dashboard world={world} timeSystem={timeSystem} />);
    const budgetText = screen.getByTestId('dashboard-budget').textContent ?? '';
    expect(budgetText).toContain(STARTING_BUDGET.toLocaleString());
  });

  it('renders the initial clock as 00:00 and Day 1', () => {
    render(<Dashboard world={world} timeSystem={timeSystem} />);
    expect(screen.getByTestId('dashboard-time').textContent).toBe('00:00');
    expect(screen.getByTestId('dashboard-day').textContent).toBe('Day 1');
  });

  it('updates displayed time after the 2 Hz poll when engine advances', () => {
    render(<Dashboard world={world} timeSystem={timeSystem} />);
    // Advance the engine clock by one update step (50ms real → sim delta).
    act(() => {
      timeSystem.update(50000);
    });
    flushPoll();
    // After 50s real at 1x: simMs = 50000 * 288 = 14,400,000 = 4 hours → 04:00.
    expect(screen.getByTestId('dashboard-time').textContent).toBe('04:00');
  });

  it('updates displayed budget after the 2 Hz poll when engine advances', () => {
    render(<Dashboard world={world} timeSystem={timeSystem} />);
    act(() => {
      timeSystem.update(50000);
    });
    flushPoll();
    // Budget should be less than the starting budget after sim time advances.
    const budgetText = screen.getByTestId('dashboard-budget').textContent ?? '';
    // Strip non-digit characters and parse.
    const value = parseInt(budgetText.replace(/\D/g, ''), 10);
    expect(value).toBeLessThan(STARTING_BUDGET);
  });

  it('clears the polling interval on unmount', () => {
    const setSpy = jest.spyOn(window, 'setInterval');
    const clearSpy = jest.spyOn(window, 'clearInterval');
    const { unmount } = render(<Dashboard world={world} timeSystem={timeSystem} />);
    const id = setSpy.mock.results[0].value;
    unmount();
    expect(clearSpy).toHaveBeenCalledWith(id);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
