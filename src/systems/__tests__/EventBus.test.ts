/**
 * EventBus unit tests.
 *
 * Covers the plan's required behavior:
 *   - on / emit ordering (subscription order)
 *   - off() by handler
 *   - unsubscribe via the function returned from on()
 *   - throw isolation (a throwing handler does not stop subsequent
 *     handlers)
 *   - wildcard subscription via onAny()
 *   - clear() and removeAllListeners()
 */

import { EventBus } from '../EventBus';

describe('EventBus: subscription + emit ordering', () => {
  test('handlers are invoked in subscription order', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('x', () => order.push('a'));
    bus.on('x', () => order.push('b'));
    bus.on('x', () => order.push('c'));
    bus.emit('x', 1);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  test('off() removes a specific handler', () => {
    const bus = new EventBus();
    const calls: string[] = [];
    const h1 = (): void => {
      calls.push('h1');
    };
    const h2 = (): void => {
      calls.push('h2');
    };
    bus.on('x', h1);
    bus.on('x', h2);
    bus.off('x', h1);
    bus.emit('x', undefined);
    expect(calls).toEqual(['h2']);
  });

  test('the unsubscribe function returned from on() is idempotent', () => {
    const bus = new EventBus();
    const calls: number[] = [];
    const off = bus.on<number>('x', (n) => calls.push(n));
    bus.emit('x', 1);
    off();
    off();
    bus.emit('x', 2);
    expect(calls).toEqual([1]);
  });

  test('a handler that unsubscribes itself does not skip the next handler', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    let offMe: (() => void) | null = null;
    offMe = bus.on('x', (): void => {
      seen.push('a');
      if (offMe) offMe();
    });
    bus.on('x', (): void => {
      seen.push('b');
    });
    bus.emit('x', undefined);
    bus.emit('x', undefined);
    expect(seen).toEqual(['a', 'b', 'b']);
  });
});

describe('EventBus: throw isolation', () => {
  test('a throwing handler does not break subsequent handlers', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    bus.on('x', (): void => {
      seen.push('a');
    });
    bus.on('x', (): void => {
      throw new Error('boom');
    });
    bus.on('x', (): void => {
      seen.push('c');
    });
    bus.emit('x', undefined);
    expect(seen).toEqual(['a', 'c']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('a throwing wildcard handler does not break the typed pipeline', () => {
    const bus = new EventBus();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const typed: number[] = [];
    bus.on<number>('x', (n) => typed.push(n));
    bus.onAny((): void => {
      throw new Error('wild');
    });
    bus.onAny((e): void => {
      expect(e.type).toBe('x');
    });
    bus.emit('x', 7);
    expect(typed).toEqual([7]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('EventBus: wildcard', () => {
  test('onAny receives every event with envelope', () => {
    const bus = new EventBus();
    const events: Array<{ type: string; payload: unknown }> = [];
    bus.onAny((e) => {
      events.push({ type: e.type, payload: e.payload });
    });
    bus.emit('a', 1);
    bus.emit('b', 'two');
    bus.emit('c', { three: 3 });
    expect(events).toEqual([
      { type: 'a', payload: 1 },
      { type: 'b', payload: 'two' },
      { type: 'c', payload: { three: 3 } },
    ]);
  });

  test('wildcard runs after typed handlers for the same event', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('x', () => order.push('typed'));
    bus.onAny(() => order.push('wild'));
    bus.emit('x', undefined);
    expect(order).toEqual(['typed', 'wild']);
  });
});

describe('EventBus: bookkeeping + teardown', () => {
  test('listenerCount and totalListenerCount', () => {
    const bus = new EventBus();
    bus.on('a', () => undefined);
    bus.on('a', () => undefined);
    bus.on('b', () => undefined);
    expect(bus.listenerCount('a')).toBe(2);
    expect(bus.listenerCount('b')).toBe(1);
    expect(bus.totalListenerCount()).toBe(3);
  });

  test('removeAllListeners clears a single event', () => {
    const bus = new EventBus();
    bus.on('a', () => undefined);
    bus.on('b', () => undefined);
    bus.removeAllListeners('a');
    expect(bus.listenerCount('a')).toBe(0);
    expect(bus.listenerCount('b')).toBe(1);
  });

  test('clear() drops typed and wildcard subscribers', () => {
    const bus = new EventBus();
    bus.on('a', () => undefined);
    bus.onAny(() => undefined);
    bus.clear();
    expect(bus.totalListenerCount()).toBe(0);
    expect(bus.wildcardCount()).toBe(0);
  });

  test('on() with an empty name throws', () => {
    const bus = new EventBus();
    expect(() => bus.on('', () => undefined)).toThrow();
  });

  test('on() with a non-function handler throws', () => {
    const bus = new EventBus();
    // @ts-expect-error intentionally bad
    expect(() => bus.on('x', 123)).toThrow();
  });
});
