/**
 * EventBus unit tests — emit/on/off/clear and wildcard subscription.
 */
import { EventBus, WILDCARD } from '@/systems/EventBus';
import type { CityEvent } from '@/engine/types';

const baseTime = { day: 0, hour: 8, minute: 0, totalMs: 0 };

function makeEvent(type: CityEvent['type']): CityEvent {
  switch (type) {
    case 'new_day':
      return { type: 'new_day', time: baseTime, data: { day: 1 } };
    case 'citizen_arrived':
      return {
        type: 'citizen_arrived',
        time: baseTime,
        data: { citizenId: 'c1', position: { x: 0, y: 0 }, activity: 'wandering' },
      };
    case 'company_opened':
      return {
        type: 'company_opened',
        time: baseTime,
        data: { buildingId: 'b1', buildingType: 'shop' },
      };
    case 'company_closed':
      return {
        type: 'company_closed',
        time: baseTime,
        data: { buildingId: 'b1', buildingType: 'shop' },
      };
    case 'traffic_jam':
      return {
        type: 'traffic_jam',
        time: baseTime,
        data: { stoppedCount: 5, totalVehicles: 10, location: null },
      };
  }
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('on / emit', () => {
    it('delivers a typed event to subscribers of that type', () => {
      const received: CityEvent[] = [];
      bus.on('new_day', (e) => received.push(e));

      bus.emit(makeEvent('new_day'));

      expect(received).toHaveLength(1);
      expect(received[0]!.type).toBe('new_day');
      expect(received[0]!.data).toEqual({ day: 1 });
    });

    it('does not deliver events to subscribers of a different type', () => {
      const received: CityEvent[] = [];
      bus.on('new_day', (e) => received.push(e));

      bus.emit(makeEvent('citizen_arrived'));

      expect(received).toHaveLength(0);
    });

    it('delivers to multiple subscribers of the same type', () => {
      let count = 0;
      bus.on('new_day', () => count++);
      bus.on('new_day', () => count++);

      bus.emit(makeEvent('new_day'));

      expect(count).toBe(2);
    });
  });

  describe('wildcard', () => {
    it('delivers every event to wildcard subscribers', () => {
      const received: CityEvent[] = [];
      bus.on(WILDCARD, (e) => received.push(e));

      bus.emit(makeEvent('new_day'));
      bus.emit(makeEvent('citizen_arrived'));
      bus.emit(makeEvent('company_opened'));

      expect(received).toHaveLength(3);
      expect(received.map((e) => e.type)).toEqual([
        'new_day',
        'citizen_arrived',
        'company_opened',
      ]);
    });

    it('delivers to both specific and wildcard subscribers', () => {
      let specificCount = 0;
      let wildcardCount = 0;
      bus.on('new_day', () => specificCount++);
      bus.on(WILDCARD, () => wildcardCount++);

      bus.emit(makeEvent('new_day'));

      expect(specificCount).toBe(1);
      expect(wildcardCount).toBe(1);
    });
  });

  describe('off', () => {
    it('removes a subscriber so it no longer receives events', () => {
      const received: CityEvent[] = [];
      const handler = (e: CityEvent) => received.push(e);
      bus.on('new_day', handler);

      bus.emit(makeEvent('new_day'));
      bus.off('new_day', handler);
      bus.emit(makeEvent('new_day'));

      expect(received).toHaveLength(1);
    });

    it('does nothing when removing a handler that was never subscribed', () => {
      const handler = () => {};
      expect(() => bus.off('new_day', handler)).not.toThrow();
    });
  });

  describe('unsubscribe function returned by on()', () => {
    it('unsubscribes the handler when called', () => {
      const received: CityEvent[] = [];
      const unsubscribe = bus.on('new_day', (e) => received.push(e));

      bus.emit(makeEvent('new_day'));
      unsubscribe();
      bus.emit(makeEvent('new_day'));

      expect(received).toHaveLength(1);
    });

    it('is idempotent (safe to call multiple times)', () => {
      const received: CityEvent[] = [];
      const unsubscribe = bus.on('new_day', (e) => received.push(e));

      unsubscribe();
      unsubscribe();
      bus.emit(makeEvent('new_day'));

      expect(received).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('removes all subscribers from all channels', () => {
      const received: CityEvent[] = [];
      bus.on('new_day', (e) => received.push(e));
      bus.on(WILDCARD, (e) => received.push(e));

      bus.clear();
      bus.emit(makeEvent('new_day'));

      expect(received).toHaveLength(0);
    });
  });

  describe('unsubscribe during dispatch', () => {
    it('allows a handler to unsubscribe itself without skipping siblings', () => {
      const calls: string[] = [];
      const unsubscribe = bus.on('new_day', () => {
        calls.push('first');
        unsubscribe();
      });
      bus.on('new_day', () => calls.push('second'));

      bus.emit(makeEvent('new_day'));

      expect(calls).toEqual(['first', 'second']);

      // Second emit: only 'second' should fire.
      calls.length = 0;
      bus.emit(makeEvent('new_day'));
      expect(calls).toEqual(['second']);
    });
  });

  describe('getAndResetEventCount', () => {
    it('returns cumulative count and resets to 0', () => {
      bus.emit(makeEvent('new_day'));
      bus.emit(makeEvent('citizen_arrived'));
      bus.emit(makeEvent('company_opened'));
      expect(bus.getAndResetEventCount()).toBe(3);
      // Counter reset — next call returns 0.
      expect(bus.getAndResetEventCount()).toBe(0);
    });

    it('counts events emitted after a reset', () => {
      bus.emit(makeEvent('new_day'));
      bus.getAndResetEventCount();
      bus.emit(makeEvent('new_day'));
      bus.emit(makeEvent('new_day'));
      expect(bus.getAndResetEventCount()).toBe(2);
    });

    it('clear() resets the event counter', () => {
      bus.emit(makeEvent('new_day'));
      bus.emit(makeEvent('new_day'));
      bus.clear();
      expect(bus.getAndResetEventCount()).toBe(0);
    });
  });
});
