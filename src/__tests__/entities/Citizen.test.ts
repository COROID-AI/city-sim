/**
 * Unit tests for Citizen entity and Entity base (spec §6.3).
 *
 * The schedule logic (determineActivity) is a pure function of hour +
 * employment status, so these tests are fully deterministic.
 */
import { Citizen } from '@/entities/Citizen';
import { Entity } from '@/entities/Entity';
import { NEED_MAX } from '@/systems/NeedSystem';
import { FIRST_NAMES, LAST_NAMES } from '@/generation/NameGenerator';
import { mulberry32 } from '@/generation/BuildingPlacer';

describe('Entity (base class)', () => {
  it('assigns a unique auto-generated id', () => {
    const a = new (class extends Entity {
      update() {}
    })();
    const b = new (class extends Entity {
      update() {}
    })();
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it('accepts an explicit id and position', () => {
    const e = new (class extends Entity {
      update() {}
    })({ x: 5, y: 7 }, 'custom-id');
    expect(e.id).toBe('custom-id');
    expect(e.getPosition()).toEqual({ x: 5, y: 7 });
  });

  it('getPosition returns a defensive copy', () => {
    const e = new (class extends Entity {
      update() {}
    })({ x: 1, y: 2 });
    const pos = e.getPosition();
    pos.x = 999;
    expect(e.getPosition()).toEqual({ x: 1, y: 2 });
  });

  it('setPosition updates the position', () => {
    const e = new (class extends Entity {
      update() {}
    })({ x: 0, y: 0 });
    e.setPosition({ x: 3, y: 4 });
    expect(e.getPosition()).toEqual({ x: 3, y: 4 });
  });
});

describe('Citizen', () => {
  describe('construction', () => {
    it('generates a name from the name pools', () => {
      const c = new Citizen();
      const [first, last] = c.name.split(' ');
      expect(FIRST_NAMES).toContain(first);
      expect(LAST_NAMES).toContain(last);
    });

    it('defaults to employed with full needs and sleeping activity', () => {
      const c = new Citizen();
      expect(c.employed).toBe(true);
      expect(c.activity).toBe('sleeping');
      expect(c.needs.energy).toBe(NEED_MAX);
      expect(c.needs.hunger).toBe(NEED_MAX);
      expect(c.needs.fun).toBe(NEED_MAX);
      expect(c.needs.social).toBe(NEED_MAX);
    });

    it('accepts explicit options', () => {
      const needs = { energy: 50, hunger: 60, fun: 70, social: 80 };
      const c = new Citizen({ x: 1, y: 2 }, {
        id: 'cit-1',
        name: 'Test Person',
        employed: false,
        needs,
      });
      expect(c.id).toBe('cit-1');
      expect(c.name).toBe('Test Person');
      expect(c.employed).toBe(false);
      expect(c.needs).toEqual(needs);
      expect(c.getPosition()).toEqual({ x: 1, y: 2 });
    });
  });

  describe('determineActivity — employed schedule', () => {
    const citizen = new Citizen({ x: 0, y: 0 }, { employed: true });

    it('sleeping before wake hour (00:00–05:59)', () => {
      expect(citizen.determineActivity(0)).toBe('sleeping');
      expect(citizen.determineActivity(3)).toBe('sleeping');
      expect(citizen.determineActivity(5)).toBe('sleeping');
    });

    it('sleeping at hour 6 and 7 (still pre-commute)', () => {
      // 6 is wake hour but no activity scheduled yet -> sleeping
      expect(citizen.determineActivity(6)).toBe('sleeping');
      expect(citizen.determineActivity(7)).toBe('sleeping');
    });

    it('commuting at hour 8', () => {
      expect(citizen.determineActivity(8)).toBe('commuting');
    });

    it('working at hour 9', () => {
      expect(citizen.determineActivity(9)).toBe('working');
    });

    it('working from hour 9 through 11', () => {
      expect(citizen.determineActivity(10)).toBe('working');
      expect(citizen.determineActivity(11)).toBe('working');
    });

    it('eating at noon (hour 12)', () => {
      expect(citizen.determineActivity(12)).toBe('eating');
    });

    it('working from hour 13 through 16', () => {
      expect(citizen.determineActivity(13)).toBe('working');
      expect(citizen.determineActivity(16)).toBe('working');
    });

    it('commuting at hour 17 (end of work)', () => {
      expect(citizen.determineActivity(17)).toBe('commuting');
    });

    it('entertaining from hour 18 through 21', () => {
      expect(citizen.determineActivity(18)).toBe('entertaining');
      expect(citizen.determineActivity(20)).toBe('entertaining');
      expect(citizen.determineActivity(21)).toBe('entertaining');
    });

    it('sleeping at hour 22 and later', () => {
      expect(citizen.determineActivity(22)).toBe('sleeping');
      expect(citizen.determineActivity(23)).toBe('sleeping');
    });

    it('wraps hours outside [0,23] via modulo', () => {
      expect(citizen.determineActivity(24)).toBe('sleeping'); // -> 0
      expect(citizen.determineActivity(32)).toBe('commuting'); // -> 8
      expect(citizen.determineActivity(-1)).toBe('sleeping'); // -> 23
    });
  });

  describe('determineActivity — unemployed schedule', () => {
    const citizen = new Citizen({ x: 0, y: 0 }, { employed: false });

    it('sleeping at night', () => {
      expect(citizen.determineActivity(0)).toBe('sleeping');
      expect(citizen.determineActivity(5)).toBe('sleeping');
    });

    it('wandering during the day (not noon, not evening)', () => {
      expect(citizen.determineActivity(9)).toBe('wandering');
      expect(citizen.determineActivity(10)).toBe('wandering');
      expect(citizen.determineActivity(15)).toBe('wandering');
    });

    it('eating at noon', () => {
      expect(citizen.determineActivity(12)).toBe('eating');
    });

    it('entertaining in the evening (18–21)', () => {
      expect(citizen.determineActivity(18)).toBe('entertaining');
      expect(citizen.determineActivity(21)).toBe('entertaining');
    });

    it('sleeping at 22', () => {
      expect(citizen.determineActivity(22)).toBe('sleeping');
    });
  });

  describe('update()', () => {
    it('sets activity from the hour and applies need decay', () => {
      const c = new Citizen({ x: 0, y: 0 }, { employed: true });
      // 1 sim-minute of decay
      c.update(60_000, 10);
      expect(c.activity).toBe('working');
      // energy decays 0.15/min
      expect(c.needs.energy).toBeCloseTo(100 - 0.15, 5);
    });

    it('replenishes energy while sleeping at home', () => {
      const c = new Citizen({ x: 0, y: 0 });
      c.needs.energy = 50;
      c.update(60_000, 2); // hour 2 -> sleeping -> home
      // decay -0.15, replenish +2.0 => net +1.85
      expect(c.needs.energy).toBeCloseTo(50 - 0.15 + 2.0, 5);
    });
  });

  describe('schedule & spawning fields', () => {
    it('auto-generates a 24-entry schedule on construction', () => {
      const c = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(1) });
      expect(c.schedule).toHaveLength(24);
      for (let h = 0; h < 24; h++) {
        expect(c.schedule[h].hour).toBe(h);
        expect(c.schedule[h].jitterMinutes).toBeGreaterThanOrEqual(-30);
        expect(c.schedule[h].jitterMinutes).toBeLessThanOrEqual(30);
      }
    });

    it('defaults homeId/workplaceId to null and commuteMode to foot', () => {
      const c = new Citizen();
      expect(c.homeId).toBeNull();
      expect(c.workplaceId).toBeNull();
      expect(c.commuteMode).toBe('foot');
      expect(c.targetPosition).toBeNull();
    });

    it('accepts homeId and workplaceId via options', () => {
      const c = new Citizen({ x: 0, y: 0 }, {
        homeId: 'home-1',
        workplaceId: 'work-1',
        employed: true,
      });
      expect(c.homeId).toBe('home-1');
      expect(c.workplaceId).toBe('work-1');
    });

    it('getScheduleActivity reads from the generated schedule', () => {
      const c = new Citizen({ x: 0, y: 0 }, { employed: true, rng: mulberry32(1) });
      expect(c.getScheduleActivity(9)).toBe('working');
      expect(c.getScheduleActivity(12)).toBe('eating');
    });

    it('setTarget sets targetPosition and resets commuteMode to foot', () => {
      const c = new Citizen({ x: 0, y: 0 });
      c.commuteMode = 'vehicle';
      c.setTarget({ x: 5, y: 5 });
      expect(c.targetPosition).toEqual({ x: 5, y: 5 });
      expect(c.commuteMode).toBe('foot');
    });

    it('setTarget(null) clears the target', () => {
      const c = new Citizen({ x: 0, y: 0 });
      c.setTarget({ x: 5, y: 5 });
      c.setTarget(null);
      expect(c.targetPosition).toBeNull();
    });

    it('schedule is deterministic when constructed with a seeded rng', () => {
      const a = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(42) });
      const b = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(42) });
      expect(a.schedule).toEqual(b.schedule);
    });
  });
});
