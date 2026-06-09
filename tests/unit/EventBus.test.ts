/**
 * EventBus unit tests.
 *
 * Verifies on/off/emit, unsubscribe, error isolation, and ordering.
 */
import { EventBus, type CityEventMap } from '@/systems/EventBus';

describe('EventBus', () => {
  it('invokes listeners on emit, in registration order', () => {
    const bus = new EventBus<CityEventMap>();
    const order: number[] = [];
    bus.on('new_day', () => order.push(1));
    bus.on('new_day', () => order.push(2));
    bus.on('new_day', () => order.push(3));
    bus.emit('new_day', { day: 1, totalMinutes: 24 * 60 });
    expect(order).toEqual([1, 2, 3]);
  });

  it('does not invoke listeners for other events', () => {
    const bus = new EventBus<CityEventMap>();
    const fn = jest.fn();
    bus.on('new_day', fn);
    bus.emit('traffic_jam', { tileKey: '1,1', vehicleCount: 3, durationMs: 1500 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function that detaches the listener', () => {
    const bus = new EventBus<CityEventMap>();
    const fn = jest.fn();
    const off = bus.on('new_day', fn);
    off();
    bus.emit('new_day', { day: 1, totalMinutes: 24 * 60 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('off(eventName) removes all listeners for that event', () => {
    const bus = new EventBus<CityEventMap>();
    const a = jest.fn();
    const b = jest.fn();
    bus.on('new_day', a);
    bus.on('new_day', b);
    bus.off('new_day');
    bus.emit('new_day', { day: 1, totalMinutes: 24 * 60 });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('off() with no args clears every listener', () => {
    const bus = new EventBus<CityEventMap>();
    const a = jest.fn();
    const b = jest.fn();
    bus.on('new_day', a);
    bus.on('traffic_jam', b);
    bus.off();
    bus.emit('new_day', { day: 1, totalMinutes: 0 });
    bus.emit('traffic_jam', { tileKey: '0,0', vehicleCount: 1, durationMs: 0 });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('isolates throwing listeners: one throw does not stop the rest', () => {
    const errors: unknown[] = [];
    const bus = new EventBus<CityEventMap>({ onError: (_n, e) => errors.push(e) });
    const a = jest.fn(() => {
      throw new Error('boom');
    });
    const b = jest.fn();
    bus.on('new_day', a);
    bus.on('new_day', b);
    bus.emit('new_day', { day: 1, totalMinutes: 24 * 60 });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(errors.length).toBe(1);
  });

  it('once() auto-unsubscribes after the first invocation', () => {
    const bus = new EventBus<CityEventMap>();
    const fn = jest.fn();
    bus.once('new_day', fn);
    bus.emit('new_day', { day: 1, totalMinutes: 24 * 60 });
    bus.emit('new_day', { day: 2, totalMinutes: 48 * 60 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('listenerCount returns the number of registered listeners', () => {
    const bus = new EventBus<CityEventMap>();
    expect(bus.listenerCount('new_day')).toBe(0);
    bus.on('new_day', () => undefined);
    bus.on('new_day', () => undefined);
    expect(bus.listenerCount('new_day')).toBe(2);
  });

  it('eventNames returns every event with at least one listener', () => {
    const bus = new EventBus<CityEventMap>();
    bus.on('new_day', () => undefined);
    bus.on('traffic_jam', () => undefined);
    expect(new Set(bus.eventNames())).toEqual(new Set(['new_day', 'traffic_jam']));
  });
});
