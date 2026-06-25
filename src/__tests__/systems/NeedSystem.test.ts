/**
 * Unit tests for NeedSystem (spec §6.3).
 *
 * All tests use explicit simulation-millisecond values and assert exact
 * decay/replenish amounts. NeedSystem receives compressed sim-time, so
 * 60,000 sim-ms = 1 sim-minute.
 */
import {
  NeedSystem,
  DECAY_RATES,
  REPLENISH_RATES,
  NEED_THRESHOLD,
  NEED_MIN,
  NEED_MAX,
  type Needs,
} from '@/systems/NeedSystem';
import { MS_PER_MINUTE } from '@/systems/TimeSystem';

describe('NeedSystem', () => {
  let system: NeedSystem;

  beforeEach(() => {
    system = new NeedSystem();
  });

  describe('constants', () => {
    it('exposes spec-exact decay rates', () => {
      expect(DECAY_RATES.energy).toBe(0.15);
      expect(DECAY_RATES.hunger).toBe(0.2);
      expect(DECAY_RATES.fun).toBe(0.1);
      expect(DECAY_RATES.social).toBe(0.08);
    });

    it('exposes spec-exact replenish rates', () => {
      expect(REPLENISH_RATES.home.energy).toBe(2.0);
      expect(REPLENISH_RATES.restaurant.hunger).toBe(1.5);
      expect(REPLENISH_RATES.entertainment.fun).toBe(1.0);
      expect(REPLENISH_RATES.park.fun).toBe(1.0);
      expect(REPLENISH_RATES.social.social).toBe(0.5);
    });

    it('need threshold is 30', () => {
      expect(NEED_THRESHOLD).toBe(30);
    });

    it('need bounds are [0, 100]', () => {
      expect(NEED_MIN).toBe(0);
      expect(NEED_MAX).toBe(100);
    });
  });

  describe('createDefaultNeeds()', () => {
    it('creates needs all at max (100)', () => {
      const needs = NeedSystem.createDefaultNeeds();
      expect(needs.energy).toBe(100);
      expect(needs.hunger).toBe(100);
      expect(needs.fun).toBe(100);
      expect(needs.social).toBe(100);
    });
  });

  describe('decay()', () => {
    it('decays each need by the correct rate over 1 sim-minute', () => {
      const needs: Needs = { energy: 100, hunger: 100, fun: 100, social: 100 };
      system.decay(needs, MS_PER_MINUTE);
      expect(needs.energy).toBeCloseTo(100 - 0.15, 5);
      expect(needs.hunger).toBeCloseTo(100 - 0.2, 5);
      expect(needs.fun).toBeCloseTo(100 - 0.1, 5);
      expect(needs.social).toBeCloseTo(100 - 0.08, 5);
    });

    it('decays proportionally over multiple sim-minutes', () => {
      const needs: Needs = { energy: 100, hunger: 100, fun: 100, social: 100 };
      const tenMin = MS_PER_MINUTE * 10;
      system.decay(needs, tenMin);
      expect(needs.energy).toBeCloseTo(100 - 0.15 * 10, 5);
      expect(needs.hunger).toBeCloseTo(100 - 0.2 * 10, 5);
      expect(needs.fun).toBeCloseTo(100 - 0.1 * 10, 5);
      expect(needs.social).toBeCloseTo(100 - 0.08 * 10, 5);
    });

    it('energy reaches ~0 after 667 sim-minutes from 100', () => {
      // 100 / 0.15 = 666.67 minutes to deplete energy from 100
      const needs: Needs = { energy: 100, hunger: 100, fun: 100, social: 100 };
      const simMs = MS_PER_MINUTE * 667;
      system.decay(needs, simMs);
      expect(needs.energy).toBe(0); // clamped at min
    });

    it('clamps needs to 0 (no underflow)', () => {
      const needs: Needs = { energy: 5, hunger: 5, fun: 5, social: 5 };
      // 10 hours of decay far exceeds every remaining value (slowest decay
      // rate is social at 0.08/min -> 0.08*600 = 48 >> 5).
      system.decay(needs, MS_PER_MINUTE * 600);
      expect(needs.energy).toBe(0);
      expect(needs.hunger).toBe(0);
      expect(needs.fun).toBe(0);
      expect(needs.social).toBe(0);
    });
  });

  describe('replenish()', () => {
    it('replenishes energy +2.0/min at home', () => {
      const needs: Needs = { energy: 50, hunger: 50, fun: 50, social: 50 };
      system.replenish(needs, MS_PER_MINUTE, 'home');
      expect(needs.energy).toBeCloseTo(50 + 2.0, 5);
    });

    it('replenishes hunger +1.5/min at restaurant', () => {
      const needs: Needs = { energy: 50, hunger: 50, fun: 50, social: 50 };
      system.replenish(needs, MS_PER_MINUTE, 'restaurant');
      expect(needs.hunger).toBeCloseTo(50 + 1.5, 5);
    });

    it('replenishes hunger +1.5/min at home (eating at home)', () => {
      const needs: Needs = { energy: 50, hunger: 50, fun: 50, social: 50 };
      system.replenish(needs, MS_PER_MINUTE, 'home');
      expect(needs.hunger).toBeCloseTo(50 + 1.5, 5);
    });

    it('replenishes fun +1.0/min at entertainment', () => {
      const needs: Needs = { energy: 50, hunger: 50, fun: 50, social: 50 };
      system.replenish(needs, MS_PER_MINUTE, 'entertainment');
      expect(needs.fun).toBeCloseTo(50 + 1.0, 5);
    });

    it('replenishes fun +1.0/min at park', () => {
      const needs: Needs = { energy: 50, hunger: 50, fun: 50, social: 50 };
      system.replenish(needs, MS_PER_MINUTE, 'park');
      expect(needs.fun).toBeCloseTo(50 + 1.0, 5);
    });

    it('replenishes social +0.5/min when near others', () => {
      const needs: Needs = { energy: 50, hunger: 50, fun: 50, social: 50 };
      system.replenish(needs, MS_PER_MINUTE, 'none', true);
      expect(needs.social).toBeCloseTo(50 + 0.5, 5);
    });

    it('does not replenish social when not near others', () => {
      const needs: Needs = { energy: 50, hunger: 50, fun: 50, social: 50 };
      system.replenish(needs, MS_PER_MINUTE, 'none', false);
      expect(needs.social).toBe(50);
    });

    it('clamps needs to 100 (no overflow)', () => {
      const needs: Needs = { energy: 99, hunger: 99, fun: 99, social: 99 };
      system.replenish(needs, MS_PER_MINUTE * 60, 'home');
      expect(needs.energy).toBe(100);
      expect(needs.hunger).toBe(100);
    });
  });

  describe('update() (decay + replenish combined)', () => {
    it('applies decay then replenish for the given context', () => {
      const needs: Needs = { energy: 50, hunger: 50, fun: 50, social: 50 };
      system.update(needs, MS_PER_MINUTE, 'home');
      // energy: 50 - 0.15 + 2.0 = 51.85
      expect(needs.energy).toBeCloseTo(50 - 0.15 + 2.0, 5);
      // hunger: 50 - 0.2 + 1.5 = 51.3
      expect(needs.hunger).toBeCloseTo(50 - 0.2 + 1.5, 5);
      // fun/social only decay
      expect(needs.fun).toBeCloseTo(50 - 0.1, 5);
      expect(needs.social).toBeCloseTo(50 - 0.08, 5);
    });
  });

  describe('getDetourIntent()', () => {
    it('returns null when all needs are above threshold', () => {
      const needs: Needs = { energy: 80, hunger: 80, fun: 80, social: 80 };
      expect(system.getDetourIntent(needs)).toBeNull();
    });

    it('returns eating detour when hunger < 30', () => {
      const needs: Needs = { energy: 80, hunger: 25, fun: 80, social: 80 };
      const intent = system.getDetourIntent(needs);
      expect(intent).not.toBeNull();
      expect(intent!.need).toBe('hunger');
      expect(intent!.activity).toBe('eating');
      expect(intent!.destination).toBe('restaurant');
    });

    it('returns sleeping detour when energy < 30', () => {
      const needs: Needs = { energy: 20, hunger: 80, fun: 80, social: 80 };
      const intent = system.getDetourIntent(needs);
      expect(intent).not.toBeNull();
      expect(intent!.need).toBe('energy');
      expect(intent!.activity).toBe('sleeping');
      expect(intent!.destination).toBe('home');
    });

    it('returns entertaining detour when fun < 30', () => {
      const needs: Needs = { energy: 80, hunger: 80, fun: 15, social: 80 };
      const intent = system.getDetourIntent(needs);
      expect(intent).not.toBeNull();
      expect(intent!.need).toBe('fun');
      expect(intent!.activity).toBe('entertaining');
      expect(intent!.destination).toBe('entertainment');
    });

    it('returns wandering detour when social < 30', () => {
      const needs: Needs = { energy: 80, hunger: 80, fun: 80, social: 10 };
      const intent = system.getDetourIntent(needs);
      expect(intent).not.toBeNull();
      expect(intent!.need).toBe('social');
      expect(intent!.activity).toBe('wandering');
      expect(intent!.destination).toBe('park');
    });

    it('prioritises hunger over other needs', () => {
      const needs: Needs = { energy: 10, hunger: 10, fun: 10, social: 10 };
      const intent = system.getDetourIntent(needs);
      expect(intent!.need).toBe('hunger');
    });

    it('does not trigger at exactly the threshold (30)', () => {
      const needs: Needs = { energy: 30, hunger: 30, fun: 30, social: 30 };
      expect(system.getDetourIntent(needs)).toBeNull();
    });
  });
});
