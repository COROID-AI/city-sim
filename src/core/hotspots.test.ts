/**
 * Hotspot registry suite (headless, node).
 *
 * The registry is the data surface of the close-up viewing layer, so it must be
 * provable without a GPU, a DOM or a frame loop: publishing, lookup, era-note
 * resolution for all five eras, duplicate rejection, bulk removal by publisher,
 * empty-safe iteration, framing delegation, the RoomBounds-derived default
 * anchors and full disposal are all exercised here.
 *
 * Deliberately absent: any era content. The anchors asserted below carry neutral
 * descriptions only, which is what makes the registry era agnostic.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ROOM_BOUNDS,
  YEAR_IDS,
  type Hotspot,
  type RoomBounds,
  type YearId,
} from '../contracts/period';
import type { FocusOptions } from './navigation';
import {
  DEFAULT_ANCHOR_IDS,
  DEFAULT_ANCHOR_PUBLISHER_ID,
  DEFAULT_ANCHOR_SUBJECTS,
  DEFAULT_ANCHOR_TAG,
  DEFAULT_FRAMING_DISTANCE,
  DEFAULT_HOTSPOT_RADIUS,
  NEUTRAL_CAPTION_FALLBACK,
  HotspotRegistry,
  createDefaultAnchors,
  createHotspotRegistry,
  defaultAnchorSubjects,
  registerDefaultAnchors,
  type HotspotFramingTarget,
  type HotspotInput,
  type HotspotRecord,
} from './hotspots';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const openRegistries: HotspotRegistry[] = [];

afterEach(() => {
  for (const registry of openRegistries.splice(0)) {
    if (!registry.disposed) registry.dispose();
  }
});

function registryFixture(): HotspotRegistry {
  const registry = createHotspotRegistry();
  openRegistries.push(registry);
  return registry;
}

/** A complete publish payload; individual tests drop or override fields. */
function hotspotInput(overrides: Partial<HotspotInput> = {}): HotspotInput {
  return {
    id: 'counter-brewer',
    label: 'Counter brewer',
    description: 'The brewing position on the counter top.',
    focus: { x: 1.5, y: 1.08, z: -4.8 },
    framingDistance: 1.6,
    radius: 0.4,
    eraNotes: { '1945': 'A vacuum pot on a hotplate.' },
    tags: ['counter'],
    ...overrides,
  };
}

/** Records every framing request so delegation can be asserted without a camera. */
interface FramingSpy extends HotspotFramingTarget {
  readonly calls: { target: Hotspot; options: FocusOptions | undefined }[];
  exitCalls: number;
}

function createFramingSpy(distance = 1): FramingSpy {
  const spy: FramingSpy = {
    calls: [],
    exitCalls: 0,
    inspect(target: Hotspot, options?: FocusOptions): number {
      spy.calls.push({ target, options });
      return options?.distance ?? distance;
    },
    exitInspect(): boolean {
      spy.exitCalls += 1;
      return true;
    },
  };
  return spy;
}

/* -------------------------------------------------------------------------- */
/* Publishing and lookup                                                      */
/* -------------------------------------------------------------------------- */

describe('publish and lookup', () => {
  it('round-trips a published hotspot through lookup', () => {
    const registry = registryFixture();
    const published = registry.publish('brewing', hotspotInput());

    expect(registry.size).toBe(1);
    expect(registry.has('counter-brewer')).toBe(true);
    expect(registry.ids).toEqual(['counter-brewer']);

    const found = registry.require('counter-brewer');
    expect(found).toBe(published);
    expect(found.id).toBe('counter-brewer');
    expect(found.label).toBe('Counter brewer');
    expect(found.description).toBe('The brewing position on the counter top.');
    expect(found.publisherId).toBe('brewing');
    expect(found.moduleId).toBe('brewing');
    expect(found.kind).toBe('info');
    expect(found.radius).toBe(0.4);
    expect(found.framingDistance).toBe(1.6);
    expect(found.tags).toEqual(['counter']);
    expect(found.focus).toBeInstanceOf(Object);
    expect(found.focus.x).toBeCloseTo(1.5, 9);
    expect(found.focus.y).toBeCloseTo(1.08, 9);
    expect(found.focus.z).toBeCloseTo(-4.8, 9);
    // The contract's `position` and the registry's `focus` are the same point.
    expect(found.position).toBe(found.focus);
    expect(found.eraNoteYears).toEqual(['1945']);
    expect(registry.byPublisher('brewing')).toHaveLength(1);
    expect(registry.publisherIds).toEqual(['brewing']);
  });

  it('defaults the fields a publisher may omit', () => {
    const registry = registryFixture();
    const record = registry.publish('environment', {
      id: 'plain',
      label: 'Plain anchor',
      focus: { x: 0, y: 1.2, z: 0 },
    });

    expect(record.description).toBe('');
    expect(record.framingDistance).toBe(DEFAULT_FRAMING_DISTANCE);
    expect(record.radius).toBe(DEFAULT_HOTSPOT_RADIUS);
    expect(record.kind).toBe('info');
    expect(record.approach).toBeNull();
    expect(record.eraNotes).toEqual({});
    expect(record.eraNoteYears).toEqual([]);
    expect(record.tags).toEqual([]);
    expect(record.year).toBeUndefined();
    expect(record.anchor).toBeUndefined();
  });

  it('normalises an approach direction to a unit vector', () => {
    const registry = registryFixture();
    const record = registry.publish(
      'environment',
      hotspotInput({ approach: { x: 0, y: 0, z: 4 } }),
    );
    expect(record.approach).not.toBeNull();
    expect(record.approach?.x).toBeCloseTo(0, 9);
    expect(record.approach?.y).toBeCloseTo(0, 9);
    expect(record.approach?.z).toBeCloseTo(1, 9);
    expect(record.approach?.length()).toBeCloseTo(1, 9);
  });

  it('rejects malformed hotspots without registering anything', () => {
    const registry = registryFixture();
    const bad: readonly Partial<HotspotInput>[] = [
      { id: '' },
      { label: '   ' },
      { description: '' },
      { focus: { x: Number.NaN, y: 1, z: 0 } },
      { framingDistance: 0 },
      { framingDistance: Number.POSITIVE_INFINITY },
      { radius: -1 },
      { approach: { x: 0, y: 0, z: 0 } },
      { eraNotes: { '1975': 'not an era' } as unknown as HotspotInput['eraNotes'] },
      { eraNotes: { '1945': '' } },
      { year: '1975' as unknown as YearId },
    ];

    for (const overrides of bad) {
      expect(() => registry.publish('brewing', hotspotInput(overrides as Partial<HotspotInput>))).toThrow();
    }
    expect(registry.size).toBe(0);

    expect(() => registry.publish('', hotspotInput())).toThrow(/publisher id/);
    expect(() => registry.publish('brewing', undefined as unknown as HotspotInput)).toThrow(
      /hotspot input object/,
    );
    expect(registry.size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Duplicate ids                                                              */
/* -------------------------------------------------------------------------- */

describe('duplicate id rejection', () => {
  it('rejects a second publication of the same id, even from another publisher', () => {
    const registry = registryFixture();
    registry.publish('brewing', hotspotInput());

    expect(() => registry.publish('brewing', hotspotInput())).toThrow(/already published/);
    expect(() => registry.publish('furniture', hotspotInput())).toThrow(/unique/);
    expect(registry.size).toBe(1);
    expect(registry.require('counter-brewer').publisherId).toBe('brewing');
  });

  it('rejects a batch that contains a duplicate, atomically', () => {
    const registry = registryFixture();
    registry.publish('brewing', hotspotInput());

    expect(() =>
      registry.publishMany('furniture', [
        hotspotInput({ id: 'stool', focus: { x: 0, y: 0.5, z: 2 } }),
        hotspotInput({ id: 'counter-brewer' }),
      ]),
    ).toThrow(/already published/);
    expect(registry.size).toBe(1);
    expect(registry.has('stool')).toBe(false);

    expect(() =>
      registry.publishMany('furniture', [
        hotspotInput({ id: 'stool' }),
        hotspotInput({ id: 'stool' }),
      ]),
    ).toThrow(/already published/);
    expect(registry.has('stool')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Era notes                                                                  */
/* -------------------------------------------------------------------------- */

describe('era note resolution', () => {
  it('resolves a different note for each of the five eras', () => {
    const registry = registryFixture();
    const notes: Record<YearId, string> = {
      '1945': 'A vacuum pot on a hotplate.',
      '1965': 'A lever machine with a glass bowl.',
      '1985': 'A dual-group machine with steam wands.',
      '2005': 'A heat-exchanger machine with a volumetric panel.',
      '2025': 'A super-automatic with a touch display.',
    };
    registry.publish('brewing', hotspotInput({ eraNotes: notes }));

    const resolved = YEAR_IDS.map((year) => registry.resolveEraCaption('counter-brewer', year));
    expect(resolved.map((entry) => entry.text)).toEqual(YEAR_IDS.map((year) => notes[year]));
    expect(new Set(resolved.map((entry) => entry.text)).size).toBe(YEAR_IDS.length);
    expect(resolved.every((entry) => entry.source === 'era-note')).toBe(true);
    expect(resolved.map((entry) => entry.year)).toEqual([...YEAR_IDS]);
    expect(resolved.every((entry) => entry.hotspotId === 'counter-brewer')).toBe(true);
    for (const year of YEAR_IDS) {
      expect(registry.hasEraNote('counter-brewer', year)).toBe(true);
      expect(registry.resolveEraNote('counter-brewer', year)).toBe(notes[year]);
    }
    expect(registry.require('counter-brewer').eraNoteYears).toEqual(YEAR_IDS);
  });

  it('falls back to the neutral description for a year without a note', () => {
    const registry = registryFixture();
    registry.publish('brewing', hotspotInput({ eraNotes: { '1945': 'Only the war years are written.' } }));

    const older = registry.resolveEraCaption('counter-brewer', '1945');
    expect(older.source).toBe('era-note');
    expect(older.text).toBe('Only the war years are written.');

    for (const year of YEAR_IDS.filter((entry) => entry !== '1945')) {
      const caption = registry.resolveEraCaption('counter-brewer', year);
      expect(caption.source).toBe('description');
      expect(caption.text).toBe('The brewing position on the counter top.');
      expect(registry.hasEraNote('counter-brewer', year)).toBe(false);
    }
  });

  it('never resolves empty text, even without a description', () => {
    const registry = registryFixture();
    registry.publish('environment', {
      id: 'bare',
      label: 'Bare anchor',
      focus: { x: 0, y: 1, z: 0 },
    });

    for (const year of YEAR_IDS) {
      const caption = registry.resolveEraCaption('bare', year);
      expect(caption.source).toBe('fallback');
      expect(caption.text).toBe(NEUTRAL_CAPTION_FALLBACK);
      expect(caption.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('rejects era lookups for unknown hotspots and unknown eras', () => {
    const registry = registryFixture();
    registry.publish('brewing', hotspotInput());
    expect(() => registry.resolveEraNote('missing', '1985')).toThrow(/Unknown hotspot/);
    expect(() => registry.resolveEraNote('counter-brewer', '1975' as unknown as YearId)).toThrow(
      /1975/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Removal                                                                    */
/* -------------------------------------------------------------------------- */

describe('removal', () => {
  it('drops exactly the hotspots of one publisher', () => {
    const registry = registryFixture();
    registry.publishMany('brewing', [
      hotspotInput({ id: 'brewer' }),
      hotspotInput({ id: 'grinder' }),
    ]);
    registry.publish('furniture', hotspotInput({ id: 'stool' }));
    expect(registry.size).toBe(3);

    const removed = registry.removePublisher('brewing');
    expect([...removed].sort()).toEqual(['brewer', 'grinder']);
    expect(registry.size).toBe(1);
    expect(registry.has('stool')).toBe(true);
    expect(registry.byPublisher('brewing')).toEqual([]);
    expect(registry.publisherIds).toEqual(['furniture']);
    expect(registry.require('stool').publisherId).toBe('furniture');
  });

  it('is empty-safe for unknown publishers and single removals', () => {
    const registry = registryFixture();
    expect(registry.removePublisher('nobody')).toEqual([]);
    expect(registry.remove('missing')).toBe(false);

    registry.publish('furniture', hotspotInput({ id: 'stool' }));
    expect(registry.remove('stool')).toBe(true);
    expect(registry.remove('stool')).toBe(false);
    expect(registry.size).toBe(0);
    expect(registry.publisherIds).toEqual([]);
  });

  it('clears every hotspot and reports the removed ids', () => {
    const registry = registryFixture();
    registry.publish('a', hotspotInput({ id: 'one' }));
    registry.publish('b', hotspotInput({ id: 'two' }));

    expect([...registry.clear()].sort()).toEqual(['one', 'two']);
    expect(registry.size).toBe(0);
    expect(registry.clear()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Empty-safe iteration                                                       */
/* -------------------------------------------------------------------------- */

describe('iteration', () => {
  it('is empty-safe on an empty registry', () => {
    const registry = registryFixture();
    const visited: string[] = [];

    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
    expect([...registry]).toEqual([]);
    expect(registry.ids).toEqual([]);
    expect(registry.publisherIds).toEqual([]);
    expect(registry.byPublisher('anything')).toEqual([]);
    expect(registry.get('anything')).toBeUndefined();
    expect(registry.has('anything')).toBe(false);
    registry.forEach((record) => visited.push(record.id));
    expect(visited).toEqual([]);
    expect(() => registry.require('anything')).toThrow(/Unknown hotspot "anything"/);
  });

  it('lists, iterates and visits every hotspot in insertion order', () => {
    const registry = registryFixture();
    registry.publish('a', hotspotInput({ id: 'one' }));
    registry.publish('b', hotspotInput({ id: 'two' }));

    const order = registry.list().map((record) => record.id);
    expect(order).toEqual(['one', 'two']);
    expect([...registry].map((record) => record.id)).toEqual(['one', 'two']);
    const visited: string[] = [];
    registry.forEach((record) => visited.push(record.id));
    expect(visited).toEqual(['one', 'two']);
  });
});

/* -------------------------------------------------------------------------- */
/* Change notifications                                                       */
/* -------------------------------------------------------------------------- */

describe('change notifications', () => {
  it('reports publishes, removals and clears with a monotonic revision', () => {
    const registry = registryFixture();
    const listener = vi.fn();
    const unsubscribe = registry.onDidChange(listener);

    registry.publish('a', hotspotInput({ id: 'one' }));
    registry.publishMany('b', [hotspotInput({ id: 'two' }), hotspotInput({ id: 'three' })]);
    registry.remove('two');
    registry.removePublisher('b');
    registry.clear();

    expect(listener).toHaveBeenCalledTimes(5);
    expect(listener.mock.calls.map((call) => call[0].type)).toEqual([
      'publish',
      'publish',
      'remove',
      'remove-publisher',
      'clear',
    ]);
    expect(listener.mock.calls[1]?.[0].ids).toEqual(['two', 'three']);
    expect(listener.mock.calls[4]?.[0]).toMatchObject({ publisherId: null, size: 0, revision: 5 });

    unsubscribe();
    registry.publish('a', hotspotInput({ id: 'four' }));
    expect(listener).toHaveBeenCalledTimes(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Framing delegation                                                         */
/* -------------------------------------------------------------------------- */

describe('framing', () => {
  it('delegates framing to the navigation controller with the declared distance', () => {
    const registry = registryFixture();
    const record = registry.publish(
      'environment',
      hotspotInput({ id: 'menu', framingDistance: 2.4, approach: { x: -1, y: 0, z: 0 } }),
    );
    const navigation = createFramingSpy(9);

    const distance = registry.frame(navigation, 'menu');

    expect(distance).toBe(2.4);
    expect(navigation.calls).toHaveLength(1);
    const call = navigation.calls[0];
    expect(call?.target).toBe(record);
    expect(call?.options?.distance).toBe(2.4);
    expect(call?.options?.direction?.x).toBeCloseTo(-1, 9);
    expect(call?.options?.direction?.z).toBeCloseTo(0, 9);
  });

  it('lets a caller override distance and direction, and rejects unknown ids', () => {
    const registry = registryFixture();
    registry.publish('environment', hotspotInput({ id: 'menu' }));
    const navigation = createFramingSpy();

    registry.frame(navigation, 'menu', { distance: 0.9, direction: { x: 0, y: 0, z: 1 } });

    expect(navigation.calls[0]?.options?.distance).toBe(0.9);
    expect(navigation.calls[0]?.options?.direction?.z).toBeCloseTo(1, 9);

    expect(() => registry.frame(navigation, 'unknown')).toThrow(/Unknown hotspot/);
  });
});

/* -------------------------------------------------------------------------- */
/* Default anchors                                                            */
/* -------------------------------------------------------------------------- */

describe('default anchors', () => {
  it('covers the six required viewing subjects from the room bounds', () => {
    const registry = registryFixture();
    const records = registerDefaultAnchors(registry, DEFAULT_ROOM_BOUNDS);

    expect(records).toHaveLength(DEFAULT_ANCHOR_SUBJECTS.length);
    expect(new Set(records.map((record) => record.id)).size).toBe(DEFAULT_ANCHOR_SUBJECTS.length);
    expect(records.map((record) => record.publisherId)).toEqual(
      DEFAULT_ANCHOR_SUBJECTS.map(() => DEFAULT_ANCHOR_PUBLISHER_ID),
    );

    const subjects = records.flatMap((record) => [...defaultAnchorSubjects(record)]);
    expect([...subjects].sort()).toEqual([...DEFAULT_ANCHOR_SUBJECTS].sort());
    for (const subject of DEFAULT_ANCHOR_SUBJECTS) {
      expect(records.filter((record) => record.tags.includes(subject))).toHaveLength(1);
    }
    for (const record of records) {
      expect(record.tags).toContain(DEFAULT_ANCHOR_TAG);
      expect(record.framingDistance).toBeGreaterThan(0);
      expect(record.radius).toBeGreaterThan(0);
      expect(record.approach?.length() ?? 0).toBeCloseTo(1, 9);
      expect(record.description.trim().length).toBeGreaterThan(0);
    }
    for (const id of Object.values(DEFAULT_ANCHOR_IDS)) {
      expect(registry.has(id)).toBe(true);
    }
  });

  it('is era agnostic: anchors ship without era notes', () => {
    const registry = registryFixture();
    registerDefaultAnchors(registry, DEFAULT_ROOM_BOUNDS);

    for (const record of registry.list()) {
      expect(record.eraNotes).toEqual({});
      expect(record.eraNoteYears).toEqual([]);
      for (const year of YEAR_IDS) {
        const caption = registry.resolveEraCaption(record.id, year);
        expect(caption.source).toBe('description');
        expect(caption.text).toBe(record.description);
      }
    }
  });

  it('derives every anchor from the supplied bounds, not from fixed coordinates', () => {
    const room = DEFAULT_ROOM_BOUNDS;
    const doubled: RoomBounds = {
      width: room.width * 2,
      depth: room.depth * 2,
      height: room.height * 2,
    };
    const small = createDefaultAnchors(room);
    const big = createDefaultAnchors(doubled);
    expect(small).toHaveLength(DEFAULT_ANCHOR_SUBJECTS.length);
    expect(big).toHaveLength(small.length);

    for (const subject of DEFAULT_ANCHOR_SUBJECTS) {
      const smallAnchor = small.find((anchor) => anchor.tags?.includes(subject));
      const bigAnchor = big.find((anchor) => anchor.tags?.includes(subject));
      if (!smallAnchor || !bigAnchor) throw new Error(`anchor ${subject} is missing`);
      expect(bigAnchor.focus.x).toBeCloseTo(smallAnchor.focus.x * 2, 6);
      expect(bigAnchor.focus.y).toBeCloseTo(smallAnchor.focus.y * 2, 6);
      expect(bigAnchor.focus.z).toBeCloseTo(smallAnchor.focus.z * 2, 6);
    }

    for (const anchor of small) {
      expect(Math.abs(anchor.focus.x)).toBeLessThanOrEqual(room.width / 2);
      expect(Math.abs(anchor.focus.z)).toBeLessThanOrEqual(room.depth / 2);
      expect(anchor.focus.y).toBeGreaterThan(0);
      expect(anchor.focus.y).toBeLessThan(room.height);
    }
  });

  it('keeps a distinct focus point and approach for each subject', () => {
    const anchors = createDefaultAnchors(DEFAULT_ROOM_BOUNDS);
    const points = anchors.map(
      (anchor) => `${anchor.focus.x.toFixed(3)}/${anchor.focus.y.toFixed(3)}/${anchor.focus.z.toFixed(3)}`,
    );
    expect(new Set(points).size).toBe(anchors.length);
    expect(anchors.every((anchor) => anchor.approach !== undefined)).toBe(true);
  });

  it('rejects nonsensical bounds and duplicate registration', () => {
    const registry = registryFixture();
    expect(() =>
      createDefaultAnchors({ width: 0, depth: 11, height: 3.6 }),
    ).toThrow(/positive finite room bounds/);

    registerDefaultAnchors(registry, DEFAULT_ROOM_BOUNDS);
    expect(() => registerDefaultAnchors(registry, DEFAULT_ROOM_BOUNDS)).toThrow(/already published/);
    expect(registry.size).toBe(DEFAULT_ANCHOR_SUBJECTS.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Disposal                                                                   */
/* -------------------------------------------------------------------------- */

describe('disposal', () => {
  it('empties the registry and rejects further mutation', () => {
    const registry = registryFixture();
    registerDefaultAnchors(registry, DEFAULT_ROOM_BOUNDS);
    registry.publish('brewing', hotspotInput({ id: 'brewer' }));
    expect(registry.size).toBe(DEFAULT_ANCHOR_SUBJECTS.length + 1);

    registry.dispose();

    expect(registry.disposed).toBe(true);
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
    expect([...registry]).toEqual([]);
    expect(registry.ids).toEqual([]);
    expect(registry.publisherIds).toEqual([]);
    expect(registry.get('brewer')).toBeUndefined();
    expect(() => registry.publish('brewing', hotspotInput({ id: 'other' }))).toThrow(/disposed/);
    expect(() => registry.publishMany('brewing', [])).toThrow(/disposed/);
    expect(() => registry.remove('brewer')).toThrow(/disposed/);
    expect(() => registry.removePublisher('brewing')).toThrow(/disposed/);
    expect(() => registry.clear()).toThrow(/disposed/);

    // Idempotent: app-composition can tear down unconditionally.
    expect(() => registry.dispose()).not.toThrow();
  });

  it('accepts a fresh registry after disposal, so the scene can be rebuilt', () => {
    const first = registryFixture();
    registerDefaultAnchors(first, DEFAULT_ROOM_BOUNDS);
    first.dispose();

    const second = registryFixture();
    registerDefaultAnchors(second, DEFAULT_ROOM_BOUNDS);
    expect(second.size).toBe(DEFAULT_ANCHOR_SUBJECTS.length);
    expect(second.list().every((record: HotspotRecord) => record.publisherId === DEFAULT_ANCHOR_PUBLISHER_ID)).toBe(true);
  });
});
