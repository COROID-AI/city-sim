import { describe, expect, it } from 'vitest';

import { MINUTES_PER_DAY } from '../../src/sim/clock';
import { createRng } from '../../src/sim/rng';
import { RecordingContext2D, createFakeCanvas } from './fake-canvas';
import {
  computeEconomySnapshot,
  createEconomySystem,
  createSimFixture,
  createTestCitizen,
  createTestHudStats,
  createTestWorldMap,
} from './sim-fixtures';

describe('fake canvas', () => {
  it('builds a canvas plus recording context without a DOM', () => {
    const handle = createFakeCanvas({ width: 320, height: 200 });

    expect(handle.canvas.width).toBe(320);
    expect(handle.canvas.height).toBe(200);
    expect(handle.context).toBeInstanceOf(RecordingContext2D);
    expect(handle.context.canvas).toBe(handle.canvas);
    expect(handle.canvas.getContext('webgl')).toBeNull();
    expect(handle.canvas.getContext('2d')).toBe(handle.context.toContext2D());

    handle.resize(640, 480);
    expect(handle.canvas.width).toBe(640);
    expect(handle.canvas.height).toBe(480);
  });

  it('records drawing calls with their arguments', () => {
    const handle = createFakeCanvas();
    const context = handle.context;

    context.beginPath();
    context.fillRect(1, 2, 3, 4);
    context.fillRect(5, 6, 7, 8);
    context.fillText('Day 1, 06:00', 16, 16);
    context.arc(10, 20, 5, 0, Math.PI * 2);

    expect(handle.countOf('fillRect')).toBe(2);
    expect(handle.callsFor('fillRect').map((call) => call.args)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect(handle.callsFor('fillText')[0].args).toEqual(['Day 1, 06:00', 16, 16]);
    expect(handle.callsFor('arc')[0].args).toEqual([10, 20, 5, 0, Math.PI * 2, false]);
    expect(context.lastCall('fillRect')?.args).toEqual([5, 6, 7, 8]);
    expect(context.lastCall('stroke')).toBeUndefined();
    expect(handle.calls).toBe(context.calls);
  });

  it('records property writes and keeps the paint state readable', () => {
    const handle = createFakeCanvas();
    const context = handle.context;

    context.fillStyle = '#ff0000';
    context.font = '600 18px ui-monospace, monospace';
    context.globalAlpha = 0.5;

    expect(context.fillStyle).toBe('#ff0000');
    expect(context.fontSizePx()).toBe(18);
    expect(context.globalAlpha).toBe(0.5);
    expect(handle.writes).toBe(context.writes);
    expect(context.writesFor('fillStyle')[0]).toEqual({ property: 'fillStyle', value: '#ff0000' });
    expect(context.writesFor('globalAlpha')[0].value).toBe(0.5);
  });

  it('stubs gradients, dash patterns and text metrics', () => {
    const handle = createFakeCanvas();
    const context = handle.context;

    const sky = context.createLinearGradient(0, 0, 0, 100);
    sky.addColorStop(0, '#000');
    sky.addColorStop(1, '#fff');
    context.fillStyle = sky;
    expect(handle.callsFor('addColorStop').map((call) => call.args)).toEqual([
      [0, '#000'],
      [1, '#fff'],
    ]);

    context.setLineDash([4, 2]);
    const dashes = context.getLineDash();
    expect(dashes).toEqual([4, 2]);
    dashes.push(99);
    expect(context.getLineDash()).toEqual([4, 2]);
    expect(context.createRadialGradient(0, 0, 1, 0, 0, 2)).toBeTruthy();
    expect(context.createPattern()).toBeNull();

    handle.context.font = '10px monospace';
    expect(context.measureText('hello').width).toBeCloseTo(27.5, 10);
  });

  it('resets both logs', () => {
    const handle = createFakeCanvas();
    handle.context.fillRect(0, 0, 1, 1);
    handle.context.fillStyle = '#123456';
    expect(handle.calls.length).toBeGreaterThan(0);
    expect(handle.writes.length).toBeGreaterThan(0);

    handle.reset();

    expect(handle.calls).toHaveLength(0);
    expect(handle.writes).toHaveLength(0);
    expect(handle.countOf('fillRect')).toBe(0);
    expect(handle.context.callsFor('fillRect')).toHaveLength(0);
  });
});

describe('simulation fixtures', () => {
  it('builds a fully populated, self-consistent test world', () => {
    const world = createTestWorldMap();

    expect(world.tiles).toHaveLength(world.widthInTiles * world.heightInTiles);
    expect(world.tiles.filter((tile) => tile.terrain === 'road')).toHaveLength(15);
    expect(world.buildings).toHaveLength(3);
    expect(world.nodes).toHaveLength(3);
    expect(world.segments).toHaveLength(2);
    expect(world.citizens).toHaveLength(1);
    expect(world.companies[0].employeeCount).toBe(world.companies[0].employees.length);
    expect(world.spawnNodeId).toBe('node-1');
    expect(world.nodes[0].neighborIds).toContain('node-2');
  });

  it('builds deterministic citizens with schedules, needs, household and occupation', () => {
    const citizen = createTestCitizen();
    expect(citizen).toEqual(createTestCitizen());
    expect(citizen.schedule.map((slot) => slot.activity)).toEqual([
      'home',
      'work',
      'entertainment',
      'home',
    ]);
    expect(citizen.schedule.reduce((hours, slot) => hours + (slot.endHour - slot.startHour), 0)).toBe(24);
    expect(citizen.needs).toHaveLength(5);
    expect(citizen.household.memberIds).toContain(citizen.id);
    expect(citizen.occupation.companyId).toBe('company-1');
    expect(citizen.income).toBeGreaterThan(0);
    expect(citizen.mood).toBeGreaterThan(0);
  });

  it('computes a stable economy snapshot and HUD stats', () => {
    const world = createTestWorldMap();
    const fixture = createSimFixture({ startHour: 8 });
    const snapshot = computeEconomySnapshot(world, fixture.clock, { taxRate: 0.2, cityBudget: 500 });

    expect(snapshot).toMatchObject({
      day: 0,
      hour: 8,
      minute: 0,
      totalMinutes: 8 * 60,
      population: 1,
      employmentRate: 1,
      averageWage: 14,
      totalRevenue: 640,
      netProfit: 230,
      taxRate: 0.2,
    });
    expect(snapshot.cityBudget).toBeCloseTo(628, 10);
    expect(Object.keys(snapshot.sectorRevenue)).toHaveLength(6);

    expect(createTestHudStats()).toEqual(createTestHudStats());
    expect(createTestHudStats().phase).toBe('morning');
  });

  it('produces identical clock, engine and economy logs for the same seed', () => {
    const run = () => {
      const fixture = createSimFixture({ seed: 'metro-1', startHour: 0, minutesPerTick: 5 });
      const economy = createEconomySystem('economy', fixture.world);
      fixture.engine.attach(economy);
      fixture.advanceMinutes(MINUTES_PER_DAY);
      const result = {
        orderLength: fixture.order.length,
        minuteLog: [...fixture.minuteLog],
        hourStarts: [...fixture.systems[0].hourStarts],
        snapshots: economy.snapshots,
      };
      fixture.dispose();
      return result;
    };

    const first = run();
    const second = run();

    expect(second).toEqual(first);
    // 288 ticks x 2 systems updates, plus 24 boundaries x 2 channels x 2 systems.
    expect(first.orderLength).toBe((MINUTES_PER_DAY / 5) * 2 + 24 * 4);
    expect(first.minuteLog).toHaveLength(MINUTES_PER_DAY / 5);
    expect(first.hourStarts).toHaveLength(24);
    expect(first.snapshots).toHaveLength(24);
  });

  it('rejects minute advances that do not line up with the tick size', () => {
    const fixture = createSimFixture({ minutesPerTick: 7 });
    expect(() => fixture.advanceMinutes(10)).toThrow(RangeError);
    expect(fixture.advanceMinutes(14)).toBe(2);
    fixture.dispose();
  });

  it('exposes a seeded rng identical to a standalone generator', () => {
    const fixture = createSimFixture({ seed: 'metro-1' });
    const reference = createRng('metro-1');
    expect(Array.from({ length: 5 }, () => fixture.rng.next())).toEqual(
      Array.from({ length: 5 }, () => reference.next()),
    );
    fixture.dispose();
  });
});
