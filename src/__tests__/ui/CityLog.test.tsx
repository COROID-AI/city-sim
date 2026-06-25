/**
 * Unit tests for CityLog (spec §6.4, §5.5).
 *
 * Uses a real EventBus to emit events and verifies colored dots, the 20-event
 * cap, auto-scroll, and the empty state. Fake timers drive the 2 Hz poll.
 */
import { render, screen, cleanup, act } from '@testing-library/react';
import { EventBus } from '@/systems/EventBus';
import CityLog, { MAX_EVENTS } from '@/ui/CityLog';
import type { CityEvent, CityTime } from '@/engine/types';

/** Build a CityTime at a given hour:minute for test events. */
function makeTime(hour: number, minute: number, totalMs: number): CityTime {
  return { day: 0, hour, minute, totalMs };
}

/** Build a citizen_arrived event. */
function arrived(totalMs: number): CityEvent {
  return {
    type: 'citizen_arrived',
    time: makeTime(8, 0, totalMs),
    data: { citizenId: 'c1', position: { x: 0, y: 0 }, activity: 'working' },
  };
}

/** Build a company_opened event. */
function companyOpened(totalMs: number): CityEvent {
  return {
    type: 'company_opened',
    time: makeTime(8, 0, totalMs),
    data: { buildingId: 'b1', buildingType: 'shop' },
  };
}

/** Build a traffic_jam event. */
function trafficJam(totalMs: number): CityEvent {
  return {
    type: 'traffic_jam',
    time: makeTime(9, 0, totalMs),
    data: { stoppedCount: 5, totalVehicles: 10, location: null },
  };
}

describe('CityLog', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    jest.useFakeTimers();
    eventBus = new EventBus();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  /** Advance the 2 Hz poll so the displayed event list syncs from the ref. */
  function flushPoll(): void {
    act(() => {
      jest.advanceTimersByTime(500);
    });
  }

  it('renders the spec §6.4 container classes', () => {
    render(<CityLog eventBus={eventBus} />);
    const container = screen.getByTestId('city-log');
    const cls = container.className;
    expect(cls).toContain('fixed');
    expect(cls).toContain('bottom-4');
    expect(cls).toContain('right-4');
    expect(cls).toContain('bg-slate-900/80');
    expect(cls).toContain('backdrop-blur');
  });

  it('shows the empty state before any events arrive', () => {
    render(<CityLog eventBus={eventBus} />);
    flushPoll();
    expect(screen.getByTestId('city-log-empty')).toBeInTheDocument();
  });

  it('shows events with correct colored dots after the 2 Hz poll', () => {
    render(<CityLog eventBus={eventBus} />);
    act(() => {
      eventBus.emit(arrived(1000));
      eventBus.emit(companyOpened(2000));
      eventBus.emit(trafficJam(3000));
    });
    flushPoll();

    const dots = screen.getAllByTestId('city-log-dot');
    expect(dots).toHaveLength(3);
    // green = arrival
    expect(dots[0].className).toContain('bg-green-500');
    expect(dots[0].getAttribute('data-event-type')).toBe('citizen_arrived');
    // blue = company
    expect(dots[1].className).toContain('bg-blue-500');
    expect(dots[1].getAttribute('data-event-type')).toBe('company_opened');
    // red = traffic
    expect(dots[2].className).toContain('bg-red-500');
    expect(dots[2].getAttribute('data-event-type')).toBe('traffic_jam');
  });

  it('caps the displayed events at MAX_EVENTS (20)', () => {
    render(<CityLog eventBus={eventBus} />);
    act(() => {
      for (let i = 0; i < MAX_EVENTS + 10; i++) {
        eventBus.emit(arrived(i * 1000 + 1));
      }
    });
    flushPoll();

    const entries = screen.getAllByTestId('city-log-entry');
    expect(entries).toHaveLength(MAX_EVENTS);
  });

  it('auto-scrolls to the newest event when new events arrive', () => {
    render(<CityLog eventBus={eventBus} />);
    const scrollEl = screen.getByTestId('city-log-scroll');
    // Stub scroll properties so we can assert the auto-scroll effect ran.
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 500, configurable: true });
    const setter = jest.fn();
    Object.defineProperty(scrollEl, 'scrollTop', {
      get: () => 0,
      set: setter,
      configurable: true,
    });

    act(() => {
      eventBus.emit(arrived(1000));
    });
    flushPoll();

    expect(setter).toHaveBeenCalledWith(500);
  });

  it('clears the polling interval on unmount', () => {
    const setSpy = jest.spyOn(window, 'setInterval');
    const clearSpy = jest.spyOn(window, 'clearInterval');
    const { unmount } = render(<CityLog eventBus={eventBus} />);
    // The first setInterval is the 2 Hz poll (the subscription uses on(), not setInterval).
    const id = setSpy.mock.results[0].value;
    unmount();
    expect(clearSpy).toHaveBeenCalledWith(id);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
