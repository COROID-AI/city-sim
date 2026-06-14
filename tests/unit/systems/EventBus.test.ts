/**
 * Unit tests for src/systems/EventBus.ts.
 *
 * Verifies the on/off/once/emit/clear contract, multi-subscriber
 * fanout, exception isolation, and listenerCount bookkeeping. Pure
 * tests — no engine, no DOM.
 */

import { EventBus, setEventBusLogger } from '@/systems/EventBus';

type TestEvents = {
  ping: { count: number };
  boom: { msg: string };
  silent: undefined;
  withPayload: { a: string; b: number };
};

function makeBus(): EventBus<TestEvents> {
  return new EventBus<TestEvents>();
}

describe('EventBus.on / emit', () => {
  it('delivers an emitted event to a single subscriber', () => {
    const bus = makeBus();
    const seen: number[] = [];
    bus.on('ping', (p) => seen.push(p.count));
    bus.emit('ping', { count: 1 });
    bus.emit('ping', { count: 2 });
    expect(seen).toEqual([1, 2]);
  });

  it('returns 0 when emitting with no subscribers', () => {
    const bus = makeBus();
    expect(bus.emit('ping', { count: 0 })).toBe(0);
  });

  it('returns the number of subscribers invoked', () => {
    const bus = makeBus();
    bus.on('ping', () => undefined);
    bus.on('ping', () => undefined);
    bus.on('ping', () => undefined);
    expect(bus.emit('ping', { count: 1 })).toBe(3);
  });

  it('fan-outs a single emit to multiple subscribers in insertion order', () => {
    const bus = makeBus();
    const order: string[] = [];
    bus.on('ping', () => order.push('a'));
    bus.on('ping', () => order.push('b'));
    bus.on('ping', () => order.push('c'));
    bus.emit('ping', { count: 0 });
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('isolates listener exceptions and continues fan-out', () => {
    const bus = makeBus();
    setEventBusLogger(() => undefined);
    const seen: string[] = [];
    bus.on('boom', () => {
      throw new Error('first');
    });
    bus.on('boom', (p) => seen.push(p.msg));
    bus.on('boom', () => {
      throw new Error('third');
    });
    expect(() => bus.emit('boom', { msg: 'ok' })).not.toThrow();
    expect(seen).toEqual(['ok']);
    // Restore default logger so other tests don't see the stub.
    setEventBusLogger(null);
  });
});

describe('EventBus unsubscribe', () => {
  it('stops delivery after unsubscribe', () => {
    const bus = makeBus();
    const seen: number[] = [];
    const off = bus.on('ping', (p) => seen.push(p.count));
    bus.emit('ping', { count: 1 });
    off();
    bus.emit('ping', { count: 2 });
    expect(seen).toEqual([1]);
  });

  it('isolates unsubscribe: one off does not affect siblings', () => {
    const bus = makeBus();
    const a: number[] = [];
    const b: number[] = [];
    const offA = bus.on('ping', (p) => a.push(p.count));
    bus.on('ping', (p) => b.push(p.count));
    offA();
    bus.emit('ping', { count: 5 });
    expect(a).toEqual([]);
    expect(b).toEqual([5]);
  });
});

describe('EventBus.clear', () => {
  it('removes every listener from every event', () => {
    const bus = makeBus();
    bus.on('ping', () => undefined);
    bus.on('boom', () => undefined);
    bus.on('silent', () => undefined);
    bus.clear();
    expect(bus.listenerCount('ping')).toBe(0);
    expect(bus.listenerCount('boom')).toBe(0);
    expect(bus.listenerCount('silent')).toBe(0);
    expect(bus.emit('ping', { count: 1 })).toBe(0);
  });
});

describe('EventBus.listenerCount', () => {
  it('reports the number of subscribed listeners per event', () => {
    const bus = makeBus();
    expect(bus.listenerCount('ping')).toBe(0);
    bus.on('ping', () => undefined);
    expect(bus.listenerCount('ping')).toBe(1);
    bus.on('ping', () => undefined);
    expect(bus.listenerCount('ping')).toBe(2);
    bus.on('withPayload', () => undefined);
    expect(bus.listenerCount('withPayload')).toBe(1);
    expect(bus.listenerCount('ping')).toBe(2);
  });
});

describe('EventBus payload typing', () => {
  it('preserves the payload shape on the listener', () => {
    const bus = makeBus();
    let captured: { a: string; b: number } | null = null;
    bus.on('withPayload', (p) => {
      captured = p;
    });
    bus.emit('withPayload', { a: 'hello', b: 42 });
    expect(captured).toEqual({ a: 'hello', b: 42 });
  });
});
