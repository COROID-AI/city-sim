/**
 * CityLog — unit tests.
 *
 * Spec reference: §6.4 Dashboard Layout, §7.4 Economy (events).
 *
 * The component subscribes to the full CityEventMap and renders a
 * bounded ring buffer. We pass a fresh EventBus to keep tests
 * isolated, mount the component with React's act, emit every
 * event in the map, and assert:
 *   - exactly one <li data-testid="city-log-entry"> per emit;
 *   - the ring buffer caps at 100 entries;
 *   - useEffect cleanup detaches the listener (no new entries
 *     appear after unmount).
 */
import { act, createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { CityLog, CITY_LOG_RING_CAPACITY } from '@/ui/CityLog';
import { EventBus, type CityEventMap } from '@/systems/EventBus';

interface Container {
  host: HTMLElement;
  root: Root;
  cleanup(): void;
}

function mount(initial?: ConstructorParameters<typeof CityLog>[0]): Container {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(CityLog, initial ?? {}));
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

describe('CityLog', () => {
  it('renders the empty state when no events have been emitted', () => {
    const bus = new EventBus<CityEventMap>();
    const c = mount({ bus });
    expect(c.host.querySelector('[data-testid="city-log-empty"]')).not.toBeNull();
    c.cleanup();
  });

  it('renders one <li> per event for every event in CityEventMap', () => {
    const bus = new EventBus<CityEventMap>();
    const c = mount({ bus });
    act(() => {
      bus.emit('new_day', { day: 1, totalMinutes: 24 * 60 });
      bus.emit('new_day', { day: 2, totalMinutes: 48 * 60 });
      bus.emit('company_opened', {
        companyId: 'co-1' as never,
        buildingTypeId: 'office',
        position: { x: 1, y: 1 },
      });
      bus.emit('company_closed', {
        companyId: 'co-1' as never,
        reason: 'shutdown',
      });
      bus.emit('commute_arrived', {
        citizenId: 'cit-1' as never,
        destination: { x: 2, y: 2 },
      });
      bus.emit('traffic_jam', {
        tileKey: '3,3',
        vehicleCount: 5,
        durationMs: 1500,
      });
      bus.emit('traffic_clear', { tileKey: '3,3' });
      bus.emit('building_placed', {
        buildingId: 'bldg-1' as never,
        position: { x: 4, y: 4 },
      });
      bus.emit('vehicle_despawned', { vehicleId: 'veh-1' as never });
    });
    const entries = c.host.querySelectorAll('[data-testid="city-log-entry"]');
    expect(entries.length).toBe(9);
    c.cleanup();
  });

  it('caps the ring buffer at CITY_LOG_RING_CAPACITY (100)', () => {
    const bus = new EventBus<CityEventMap>();
    const c = mount({ bus });
    act(() => {
      for (let i = 0; i < CITY_LOG_RING_CAPACITY + 25; i += 1) {
        bus.emit('new_day', { day: i, totalMinutes: i * 24 * 60 });
      }
    });
    const entries = c.host.querySelectorAll('[data-testid="city-log-entry"]');
    expect(entries.length).toBe(CITY_LOG_RING_CAPACITY);
    c.cleanup();
  });

  it('detaches listeners on unmount (cleanup)', () => {
    const bus = new EventBus<CityEventMap>();
    const c = mount({ bus });
    const baseline = bus.listenerCount('new_day');
    // The component subscribes once to every event; we don't assert
    // the exact total (it could be 1 or more depending on internal
    // sharing), only that *something* is listening.
    expect(baseline).toBeGreaterThan(0);
    c.cleanup();
    expect(bus.listenerCount('new_day')).toBe(0);
  });
});
