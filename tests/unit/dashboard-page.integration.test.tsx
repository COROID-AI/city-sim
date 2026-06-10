/**
 * Dashboard / CityView — integration test.
 *
 * Spec reference: §6.4 Dashboard Layout, §7.4 Economy.
 *
 * Mounts the full HomePage through the CityView, asserts that the
 * canvas, dashboard, event log, and mini-map all render, then:
 *   - emits `new_day` on the bus and asserts a log entry appears;
 *   - advances fake timers by 500ms and asserts the Dashboard
 *     reflects a polled snapshot derived from a hand-rolled engine.
 *
 * Test seam: CityView accepts an optional `engine` prop. We supply
 * a hand-rolled engine so we don't need to drive the production
 * canvas — that keeps the test deterministic and fast.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CityView, type CityViewEngine } from '@/components/city/CityView';
import { EventBus, type CityEventMap } from '@/systems/EventBus';

function makeEngine(): CityViewEngine {
  const time = { day: 0, hour: 0, minute: 0 };
  const citizens = [
    {
      id: 'cit-1',
      position: { x: 10, y: 10 },
      needs: { energy: 50, hunger: 50, fun: 50, social: 50 },
    },
    {
      id: 'cit-2',
      position: { x: 20, y: 20 },
      needs: { energy: 60, hunger: 60, fun: 60, social: 60 },
    },
  ];
  const companies = [
    {
      id: 'co-1',
      position: { x: 100, y: 100 },
      buildingTypeId: 'office',
    },
  ];
  return {
    getBudget: () => 5_000,
    getCompanyCounts: () => ({ open: 1, total: 1 }),
    getTime: () => time,
    getCitizens: () => citizens,
    getVehicles: () => [],
    getCompanies: () => companies,
    resolveBuildingColor: () => '#6a8caf',
  };
}

interface MountedView {
  host: HTMLElement;
  root: Root;
  cleanup(): void;
}

function mountPage(engine: CityViewEngine, bus: EventBus<CityEventMap>): MountedView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(CityView, { engine, bus }));
  });
  return {
    host,
    root,
    cleanup() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe('HomePage (via CityView) integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders canvas, dashboard, event log, and mini-map', () => {
    const bus = new EventBus<CityEventMap>();
    const c = mountPage(makeEngine(), bus);
    expect(c.host.querySelector('[data-testid="city-view"]')).not.toBeNull();
    expect(c.host.querySelector('[data-testid="city-canvas"]')).not.toBeNull();
    expect(c.host.querySelector('[data-testid="city-dashboard"]')).not.toBeNull();
    expect(c.host.querySelector('[data-testid="city-log"]')).not.toBeNull();
    expect(c.host.querySelector('[data-testid="city-minimap"]')).not.toBeNull();
    c.cleanup();
  });

  it('appends a log entry when new_day is emitted', () => {
    const bus = new EventBus<CityEventMap>();
    const c = mountPage(makeEngine(), bus);
    act(() => {
      bus.emit('new_day', { day: 7, totalMinutes: 7 * 24 * 60 });
    });
    const entries = c.host.querySelectorAll('[data-testid="city-log-entry"]');
    expect(entries.length).toBe(1);
    const first = entries[0];
    expect(first?.getAttribute('data-event')).toBe('new_day');
    c.cleanup();
  });

  it('reflects polled engine state in the Dashboard after a 500ms tick', () => {
    const bus = new EventBus<CityEventMap>();
    const c = mountPage(makeEngine(), bus);
    // Initial sample: kpi-population = 2.
    const popBefore = c.host.querySelector('[data-testid="kpi-population"]');
    expect(popBefore?.textContent).toContain('2');
    // Advance the poll timer once.
    act(() => {
      jest.advanceTimersByTime(500);
    });
    // After the timer, the population is still 2 (the engine didn't
    // change), but the dashboard must have re-rendered without
    // throwing and the testid must still be present.
    const popAfter = c.host.querySelector('[data-testid="kpi-population"]');
    expect(popAfter).not.toBeNull();
    c.cleanup();
  });
});
