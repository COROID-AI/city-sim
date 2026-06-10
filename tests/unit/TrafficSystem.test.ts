/**
 * TrafficSystem tests: phase cycle, open/closed intersection predicates.
 */
import { TrafficSystem } from '@/systems/TrafficSystem';

describe('TrafficSystem', () => {
  it('starts in NS_GREEN by default', () => {
    const ts = new TrafficSystem();
    expect(ts.getCurrentPhase()).toBe('NS_GREEN');
    expect(ts.isTileOnRed('0,0')).toBe(false);
  });

  it('cycles NS_GREEN -> ALL_RED -> EW_GREEN -> ALL_RED -> NS_GREEN', () => {
    const ts = new TrafficSystem({
      greenDurationMs: 100,
      allRedDurationMs: 25,
      intersectionKeys: ['0,0', '1,1'],
    });
    expect(ts.getCurrentPhase()).toBe('NS_GREEN');
    ts.tick(100); // NS_GREEN expires
    expect(ts.getCurrentPhase()).toBe('ALL_RED');
    expect(ts.isTileOnRed('0,0')).toBe(true);
    ts.tick(25); // ALL_RED expires
    expect(ts.getCurrentPhase()).toBe('EW_GREEN');
    expect(ts.isTileOnRed('0,0')).toBe(false);
    ts.tick(100); // EW_GREEN expires
    expect(ts.getCurrentPhase()).toBe('ALL_RED');
    ts.tick(25); // ALL_RED expires
    expect(ts.getCurrentPhase()).toBe('NS_GREEN');
  });

  it('isIntersectionOpen and isTileOnRed are consistent with the current phase', () => {
    const ts = new TrafficSystem({
      greenDurationMs: 50,
      allRedDurationMs: 10,
      intersectionKeys: ['a', 'b'],
    });
    expect(ts.getCurrentPhase()).toBe('NS_GREEN');
    expect(ts.isIntersectionOpen('a')).toBe(true);
    expect(ts.isTileOnRed('a')).toBe(false);
    ts.tick(50);
    expect(ts.getCurrentPhase()).toBe('ALL_RED');
    expect(ts.isIntersectionOpen('a')).toBe(false);
    expect(ts.isTileOnRed('a')).toBe(true);
    // Unknown tiles are always "open" (not tracked).
    expect(ts.isIntersectionOpen('zzz')).toBe(true);
  });

  it('honours the initialPhase option', () => {
    const ts = new TrafficSystem({ initialPhase: 'EW_GREEN' });
    expect(ts.getCurrentPhase()).toBe('EW_GREEN');
  });

  it('ignores invalid tick deltas', () => {
    const ts = new TrafficSystem({ greenDurationMs: 100 });
    ts.tick(Number.NaN);
    ts.tick(-1);
    expect(ts.getCurrentPhase()).toBe('NS_GREEN');
  });
});
