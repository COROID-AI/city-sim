/**
 * Hotspot registry — the close-up viewing layer's data surface.
 *
 * The café is explored by orbiting and walking, and then by *looking at things*:
 * any domain module publishes annotated points of interest and the navigation
 * controller frames them up close, while the inspect overlay shows the label,
 * the era caption and a return control.
 *
 * Design contract
 * ---------------
 * - **Registry, not content.** This module owns no era content: no furniture,
 *   machines, menus, posters, tableware, signage, counter technology, patrons or
 *   music props. A module publishes a hotspot with a label, a description, a
 *   focus point, a framing distance and *optional* per-era notes; the registry
 *   never decides what a year contains.
 * - **Contract typed.** A published {@link HotspotRecord} *is* a
 *   {@link Hotspot} from `src/contracts/period.ts`, extended with the framing
 *   data (`framingDistance`, `approach`) and the per-era captions the close-up
 *   layer needs. The navigation controller consumes the record directly
 *   (`Focusable`), so a hotspot can be framed without any translation step.
 * - **Synchronous and pure.** Publishing, lookup, bulk removal, era-note
 *   resolution and iteration are synchronous and allocation-light, so the
 *   module runs in the node test suite, in the browser bundle and in tooling
 *   with no GPU, no DOM and no frame loop.
 * - **Era agnostic.** Era notes are optional per {@link YearId}. A hotspot with
 *   no note for the selected year falls back to its neutral description, so a
 *   domain module may publish an anchor long before its full era content exists
 *   and the overlay never renders empty text.
 * - **Data driven anchors.** {@link createDefaultAnchors} derives the six
 *   required viewing subjects — service counter, machine bay, menu board,
 *   seating, entrance, music source — from the environment module's exported
 *   {@link RoomBounds}. No world coordinate is hardcoded, so the anchor set
 *   stays valid when the shell's dimensions change.
 * - **Disposable.** {@link HotspotRegistry.dispose} empties the registry and
 *   rejects further mutation, so app-composition can tear the scene down and
 *   rebuild it without leaking hotspots.
 *
 * Typical composition:
 *
 * ```ts
 * const registry = createHotspotRegistry();
 * registerDefaultAnchors(registry, environment.bounds);
 * registry.publish('furniture', { id: 'furniture-booth', label: 'Booth', focus: { x: 1, y: 0.9, z: 2 } });
 * registry.frame(navigation, 'furniture-booth');   // close-up framing
 * registry.resolveEraNote('furniture-booth', '1985');
 * ```
 */

import * as THREE from 'three';
import {
  DEFAULT_ROOM_BOUNDS,
  YEAR_IDS,
  isYearId,
  type Hotspot,
  type HotspotKind,
  type RoomBounds,
  type RoomPoint,
  type YearId,
} from '../contracts/period';
import type { FocusOptions } from './navigation';

/* -------------------------------------------------------------------------- */
/* Public constants                                                           */
/* -------------------------------------------------------------------------- */

/** Removes a previously registered listener. Safe to call more than once. */
export type Unsubscribe = () => void;

/** Publisher id used by {@link registerDefaultAnchors} when none is supplied. */
export const DEFAULT_ANCHOR_PUBLISHER_ID = 'default-anchors';

/** Tag carried by every hotspot produced by {@link createDefaultAnchors}. */
export const DEFAULT_ANCHOR_TAG = 'default-anchor';

/** Hit / framing radius used when a publisher declares none, in metres. */
export const DEFAULT_HOTSPOT_RADIUS = 0.6;

/** Framing distance used when a publisher declares none, in metres. */
export const DEFAULT_FRAMING_DISTANCE = 1.8;

/**
 * Caption used only when a hotspot has neither an era note for the selected year
 * nor a description. The overlay therefore never renders empty text.
 */
export const NEUTRAL_CAPTION_FALLBACK =
  'No description recorded for this viewing point yet.';

/**
 * Stable ids of the default anchor set. A later domain task publishes its own
 * hotspots; these six guarantee the scene is explorable up close immediately.
 */
export const DEFAULT_ANCHOR_IDS = Object.freeze({
  serviceCounter: 'anchor-service-counter',
  machineBay: 'anchor-machine-bay',
  menuBoard: 'anchor-menu-board',
  seating: 'anchor-seating',
  entrance: 'anchor-entrance',
  musicSource: 'anchor-music-source',
} as const);

/** One id of the default anchor set. */
export type DefaultAnchorId = (typeof DEFAULT_ANCHOR_IDS)[keyof typeof DEFAULT_ANCHOR_IDS];

/**
 * The six viewing subjects the default anchor set must cover, in reading order.
 * Each anchor carries its subject as a tag, so coverage is machine checkable.
 */
export const DEFAULT_ANCHOR_SUBJECTS = Object.freeze([
  'service-counter',
  'machine-bay',
  'menu-board',
  'seating',
  'entrance',
  'music-source',
] as const);

/** One required default-anchor viewing subject. */
export type DefaultAnchorSubject = (typeof DEFAULT_ANCHOR_SUBJECTS)[number];

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** Where a resolved era caption came from. */
export type EraNoteSource = 'era-note' | 'description' | 'fallback';

/** One caption for one hotspot and one era, with its provenance. */
export interface EraNoteResolution {
  readonly hotspotId: string;
  readonly year: YearId;
  /** Text to show. Never empty. */
  readonly text: string;
  /** `'era-note'` when the publisher supplied this year, otherwise a fallback. */
  readonly source: EraNoteSource;
}

/**
 * What a domain module hands to {@link HotspotRegistry.publish}.
 *
 * Only `id`, `label` and `focus` are required. Everything else has a documented
 * default so an anchor can be published before its era content exists.
 */
export interface HotspotInput {
  /** Stable identifier, unique across the scene. */
  readonly id: string;
  /** Short human readable name shown by the overlay. */
  readonly label: string;
  /** Longer explanation; doubles as the neutral caption fallback. */
  readonly description?: string;
  /** Focus point the camera looks at, in metres, scene space. */
  readonly focus: RoomPoint;
  /** Camera distance used when framing, in metres. Defaults to {@link DEFAULT_FRAMING_DISTANCE}. */
  readonly framingDistance?: number;
  /** Hit / framing radius in metres. Defaults to {@link DEFAULT_HOTSPOT_RADIUS}. */
  readonly radius?: number;
  /**
   * Unit direction *from the focus point towards the camera* that framing should
   * use. Supplying it makes framing deterministic (and therefore idempotent)
   * instead of depending on where the visitor happens to stand.
   */
  readonly approach?: RoomPoint;
  /**
   * Era captions. Omitted or partial is normal: a missing year falls back to
   * {@link HotspotInput.description}.
   */
  readonly eraNotes?: Partial<Record<YearId, string>>;
  /** Era the hotspot belongs to; omit for subjects that exist in every era. */
  readonly year?: YearId;
  /** Presentation hint for the overlay; defaults to `'info'`. */
  readonly kind?: HotspotKind;
  /** Object the overlay should follow instead of the focus point. */
  readonly anchor?: THREE.Object3D;
  /** Free-form tags for QA, tooling and default-anchor coverage checks. */
  readonly tags?: readonly string[];
}

/**
 * A published hotspot: the frozen {@link Hotspot} contract plus framing data.
 *
 * `position` mirrors the contract field and always equals {@link HotspotRecord.focus}.
 */
export interface HotspotRecord extends Hotspot {
  /** Always present (empty string when the publisher supplied none). */
  readonly description: string;
  /** Presentation hint, normalised to a concrete value. */
  readonly kind: HotspotKind;
  /** Module that owns the hotspot (mirrors {@link HotspotRecord.publisherId}). */
  readonly moduleId: string;
  /** Focus point, in metres, scene space. */
  readonly position: THREE.Vector3;
  /** Focus point alias, for callers that talk in "focus" terms. */
  readonly focus: THREE.Vector3;
  /** Camera distance used when framing, in metres. */
  readonly framingDistance: number;
  /** Unit approach direction, or `null` to let navigation approach naturally. */
  readonly approach: THREE.Vector3 | null;
  /** Era captions as published (frozen copy). */
  readonly eraNotes: Readonly<Partial<Record<YearId, string>>>;
  /** Years that actually carry an era note, in timeline order. */
  readonly eraNoteYears: readonly YearId[];
  /** Publisher that registered the hotspot. */
  readonly publisherId: string;
  /** Tags as published (frozen copy). */
  readonly tags: readonly string[];
}

/** Mutation reported to {@link HotspotRegistry.onDidChange} subscribers. */
export interface HotspotRegistryChange {
  readonly type: 'publish' | 'remove' | 'remove-publisher' | 'clear';
  /** Publisher responsible, or `null` for {@link HotspotRegistry.clear}. */
  readonly publisherId: string | null;
  /** Ids added or removed, in insertion order. */
  readonly ids: readonly string[];
  /** Registry size after the change. */
  readonly size: number;
  /** Monotonic revision, incremented once per change. */
  readonly revision: number;
}

/**
 * The slice of the navigation controller the registry frames through. A real
 * `NavigationController` satisfies it structurally (no import cycle, and no
 * coupling to the controller's internals).
 */
export interface HotspotFramingTarget {
  /** Frames the hotspot up close and returns the camera distance actually used. */
  inspect(target: Hotspot, options?: FocusOptions): number;
  /** Leaves the close-up and restores the archived pose. */
  exitInspect(): boolean;
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                         */
/* -------------------------------------------------------------------------- */

function describeValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return String(value);
}

function requireText(value: unknown, field: string, subject: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Hotspot ${subject} must declare a non-empty string ${field} (received ${describeValue(value)}).`,
    );
  }
  return value;
}

function requirePositiveFinite(value: unknown, field: string, id: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Hotspot "${id}" must declare a positive finite ${field} (received ${describeValue(value)}).`,
    );
  }
  return value;
}

function requireFiniteNumber(value: unknown, field: string, id: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `Hotspot "${id}" must declare a finite focus.${field} (received ${describeValue(value)}).`,
    );
  }
  return value;
}

function requireFocus(value: unknown, id: string): THREE.Vector3 {
  if (typeof value !== 'object' || value === null) {
    throw new Error(
      `Hotspot "${id}" must declare a focus point with finite x, y and z (received ${describeValue(value)}).`,
    );
  }
  const point = value as Partial<RoomPoint>;
  return new THREE.Vector3(
    requireFiniteNumber(point.x, 'x', id),
    requireFiniteNumber(point.y, 'y', id),
    requireFiniteNumber(point.z, 'z', id),
  );
}

/** Normalises an approach direction to a unit vector, rejecting degenerate input. */
function requireDirection(value: unknown, id: string): THREE.Vector3 {
  const direction = requireFocus(value, id);
  if (direction.lengthSq() < 1e-12) {
    throw new Error(`Hotspot "${id}" must declare a non-zero approach direction.`);
  }
  return direction.normalize();
}

function requireEraNotes(value: unknown, id: string): Readonly<Partial<Record<YearId, string>>> {
  if (value === undefined) return Object.freeze({});
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `Hotspot "${id}" must declare eraNotes as an object keyed by era (received ${describeValue(value)}).`,
    );
  }
  const notes: Partial<Record<YearId, string>> = {};
  for (const [year, note] of Object.entries(value as Record<string, unknown>)) {
    if (!isYearId(year)) {
      throw new Error(
        `Hotspot "${id}" declares an era note for "${year}", which is not one of ${YEAR_IDS.join(', ')}.`,
      );
    }
    if (typeof note !== 'string' || note.trim().length === 0) {
      throw new Error(
        `Hotspot "${id}" must declare a non-empty era note for ${year} (received ${describeValue(note)}).`,
      );
    }
    notes[year] = note;
  }
  return Object.freeze(notes);
}

function requireTags(value: unknown, id: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new Error(
      `Hotspot "${id}" must declare tags as an array of strings (received ${describeValue(value)}).`,
    );
  }
  const tags: string[] = [];
  for (const tag of value as readonly unknown[]) {
    if (typeof tag !== 'string' || tag.trim().length === 0) {
      throw new Error(
        `Hotspot "${id}" must declare tags as non-empty strings (received ${describeValue(tag)}).`,
      );
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  return Object.freeze(tags);
}

function requireYear(value: unknown, id: string): YearId | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isYearId(value)) {
    throw new Error(
      `Hotspot "${id}" declares year ${describeValue(value)}, which is not one of ${YEAR_IDS.join(', ')}.`,
    );
  }
  return value;
}

/** Orders the years that carry a note chronologically, not by object key order. */
function eraNoteYearsOf(notes: Readonly<Partial<Record<YearId, string>>>): readonly YearId[] {
  return Object.freeze(YEAR_IDS.filter((year) => typeof notes[year] === 'string'));
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The scene-wide hotspot registry. One instance per composed scene; every
 * domain module publishes into it and the navigation controller frames out of
 * it. All methods are synchronous.
 */
export class HotspotRegistry {
  private readonly records = new Map<string, HotspotRecord>();
  private readonly publishers = new Map<string, Set<string>>();
  private readonly listeners = new Set<(change: HotspotRegistryChange) => void>();
  private changes = 0;
  private isDisposed = false;

  /* -- state ------------------------------------------------------------- */

  /** Number of registered hotspots. */
  get size(): number {
    return this.records.size;
  }

  /** Number of state changes observed so far; useful for cache invalidation. */
  get revision(): number {
    return this.changes;
  }

  /** True once {@link dispose} has run. */
  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Registered ids in insertion order. */
  get ids(): readonly string[] {
    return [...this.records.keys()];
  }

  /** Publishers that still own at least one hotspot, in registration order. */
  get publisherIds(): readonly string[] {
    return [...this.publishers.keys()];
  }

  /* -- lookup ------------------------------------------------------------ */

  /** True when `id` is registered. */
  has(id: string): boolean {
    return this.records.has(id);
  }

  /** The hotspot registered under `id`, or `undefined`. */
  get(id: string): HotspotRecord | undefined {
    return this.records.get(id);
  }

  /** The hotspot registered under `id`; throws when unknown. */
  require(id: string): HotspotRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(
        `Unknown hotspot "${id}". Registered ids: ${this.records.size === 0 ? '(none)' : this.ids.join(', ')}.`,
      );
    }
    return record;
  }

  /** Every registered hotspot, in insertion order. Empty-safe: `[]` when empty. */
  list(): readonly HotspotRecord[] {
    return [...this.records.values()];
  }

  /** Hotspots owned by one publisher. Empty-safe: `[]` for an unknown publisher. */
  byPublisher(publisherId: string): readonly HotspotRecord[] {
    const ids = this.publishers.get(publisherId);
    if (!ids) return [];
    const records: HotspotRecord[] = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record) records.push(record);
    }
    return records;
  }

  /** Visits every hotspot; the empty registry simply visits nothing. */
  forEach(visit: (record: HotspotRecord) => void): void {
    for (const record of this.records.values()) visit(record);
  }

  /** Iterates hotspots, so `[...registry]` is the empty-safe listing API. */
  [Symbol.iterator](): IterableIterator<HotspotRecord> {
    return this.records.values();
  }

  /* -- mutation ---------------------------------------------------------- */

  /**
   * Publishes one hotspot. Synchronous, and rejected when `input.id` is already
   * registered (ids are unique scene-wide, including across publishers).
   */
  publish(publisherId: string, input: HotspotInput): HotspotRecord {
    this.assertUsable();
    const publisher = requireText(publisherId, 'publisher id', `publisher ${describeValue(publisherId)}`);
    const record = this.normalize(publisher, input);
    if (this.records.has(record.id)) {
      throw new Error(
        `Hotspot "${record.id}" is already published by publisher "${this.records.get(record.id)?.publisherId ?? 'unknown'}"; hotspot ids must be unique.`,
      );
    }
    this.commit(publisher, [record]);
    this.notify({ type: 'publish', publisherId: publisher, ids: [record.id] });
    return record;
  }

  /**
   * Publishes several hotspots for one publisher. Atomic: the whole batch is
   * validated before anything is registered, so a bad entry publishes nothing.
   */
  publishMany(publisherId: string, inputs: readonly HotspotInput[]): readonly HotspotRecord[] {
    this.assertUsable();
    const publisher = requireText(publisherId, 'publisher id', `publisher ${describeValue(publisherId)}`);
    const records: HotspotRecord[] = [];
    const seen = new Set<string>();
    for (const input of inputs) {
      const record = this.normalize(publisher, input);
      if (this.records.has(record.id) || seen.has(record.id)) {
        throw new Error(
          `Hotspot "${record.id}" is already published; hotspot ids must be unique.`,
        );
      }
      seen.add(record.id);
      records.push(record);
    }
    if (records.length === 0) return Object.freeze([]);
    this.commit(publisher, records);
    this.notify({ type: 'publish', publisherId: publisher, ids: records.map((record) => record.id) });
    return Object.freeze(records);
  }

  /** Removes one hotspot. Returns whether it was registered. */
  remove(id: string): boolean {
    this.assertUsable();
    const record = this.records.get(id);
    if (!record) return false;
    this.records.delete(id);
    const owned = this.publishers.get(record.publisherId);
    owned?.delete(id);
    if (owned && owned.size === 0) this.publishers.delete(record.publisherId);
    this.notify({ type: 'remove', publisherId: record.publisherId, ids: [id] });
    return true;
  }

  /**
   * Removes exactly the hotspots owned by `publisherId`. Returns the removed
   * ids; an unknown publisher yields `[]` and never throws.
   */
  removePublisher(publisherId: string): readonly string[] {
    this.assertUsable();
    const owned = this.publishers.get(publisherId);
    if (!owned || owned.size === 0) return Object.freeze([]);
    const ids = [...owned];
    for (const id of ids) this.records.delete(id);
    this.publishers.delete(publisherId);
    this.notify({ type: 'remove-publisher', publisherId, ids });
    return Object.freeze(ids);
  }

  /** Removes every hotspot. Returns the removed ids. */
  clear(): readonly string[] {
    this.assertUsable();
    const ids = [...this.records.keys()];
    this.records.clear();
    this.publishers.clear();
    if (ids.length > 0) this.notify({ type: 'clear', publisherId: null, ids });
    return Object.freeze(ids);
  }

  /* -- era notes --------------------------------------------------------- */

  /**
   * The caption for `id` in `year`: the published era note when there is one,
   * otherwise the hotspot's neutral description, otherwise
   * {@link NEUTRAL_CAPTION_FALLBACK}. Never returns empty text.
   */
  resolveEraNote(id: string, year: YearId): string {
    return this.resolveEraCaption(id, year).text;
  }

  /** {@link resolveEraNote} plus the provenance of the resolved text. */
  resolveEraCaption(id: string, year: YearId): EraNoteResolution {
    const record = this.require(id);
    if (!isYearId(year)) {
      throw new Error(
        `Era note lookup for hotspot "${id}" needs one of ${YEAR_IDS.join(', ')} (received ${describeValue(year)}).`,
      );
    }
    const note = record.eraNotes[year];
    if (typeof note === 'string' && note.trim().length > 0) {
      return { hotspotId: record.id, year, text: note, source: 'era-note' };
    }
    if (record.description.trim().length > 0) {
      return { hotspotId: record.id, year, text: record.description, source: 'description' };
    }
    return { hotspotId: record.id, year, text: NEUTRAL_CAPTION_FALLBACK, source: 'fallback' };
  }

  /** True when the publisher supplied an era note for `year`. */
  hasEraNote(id: string, year: YearId): boolean {
    return typeof this.require(id).eraNotes[year] === 'string';
  }

  /* -- framing ----------------------------------------------------------- */

  /**
   * Asks `navigation` to frame the registered hotspot `id` at the framing
   * distance (and approach direction) the publisher declared. The navigation
   * controller owns the camera; this method only supplies the hotspot.
   *
   * Returns the camera distance actually used, which may be smaller than the
   * declared distance when the room shell leaves less space behind the camera.
   */
  frame(navigation: HotspotFramingTarget, id: string, options: FocusOptions = {}): number {
    const record = this.require(id);
    const distance = options.distance ?? record.framingDistance;
    const direction = options.direction ?? record.approach ?? undefined;
    return navigation.inspect(record, {
      ...options,
      distance,
      ...(direction ? { direction } : {}),
    });
  }

  /* -- lifecycle --------------------------------------------------------- */

  /** Subscribes to mutations. Returns an unsubscribe function. */
  onDidChange(listener: (change: HotspotRegistryChange) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Empties the registry, drops subscribers and rejects further mutation.
   * Idempotent, so a teardown path may call it unconditionally.
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.records.clear();
    this.publishers.clear();
    this.listeners.clear();
    this.isDisposed = true;
  }

  /* -- internals --------------------------------------------------------- */

  private assertUsable(): void {
    if (this.isDisposed) {
      throw new Error('The hotspot registry has been disposed and no longer accepts hotspots.');
    }
  }

  private normalize(publisherId: string, input: HotspotInput): HotspotRecord {
    if (typeof input !== 'object' || input === null) {
      throw new Error(`Publish expects a hotspot input object (received ${describeValue(input)}).`);
    }
    const id = requireText(input.id, 'id', `publisher entry ${describeValue(input.id)}`);
    const label = requireText(input.label, 'label', `"${id}"`);
    const description = input.description === undefined ? '' : requireText(input.description, 'description', `"${id}"`);
    const focus = requireFocus(input.focus, id);
    const framingDistance = requirePositiveFinite(
      input.framingDistance,
      'framingDistance',
      id,
      DEFAULT_FRAMING_DISTANCE,
    );
    const radius = requirePositiveFinite(input.radius, 'radius', id, DEFAULT_HOTSPOT_RADIUS);
    const approach = input.approach === undefined ? null : requireDirection(input.approach, id);
    const eraNotes = requireEraNotes(input.eraNotes, id);
    const tags = requireTags(input.tags, id);
    const year = requireYear(input.year, id);
    const kind = input.kind ?? 'info';

    // The record itself is frozen, while the vectors stay mutable for consumers
    // that read them into scratch maths.
    return Object.freeze({
      id,
      label,
      description,
      kind,
      moduleId: publisherId,
      position: focus,
      focus,
      framingDistance,
      radius,
      approach,
      eraNotes,
      eraNoteYears: eraNoteYearsOf(eraNotes),
      publisherId,
      tags,
      ...(year === undefined ? {} : { year }),
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
    });
  }

  private commit(publisherId: string, records: readonly HotspotRecord[]): void {
    let owned = this.publishers.get(publisherId);
    if (!owned) {
      owned = new Set<string>();
      this.publishers.set(publisherId, owned);
    }
    for (const record of records) {
      this.records.set(record.id, record);
      owned.add(record.id);
    }
  }

  private notify(change: Omit<HotspotRegistryChange, 'size' | 'revision'>): void {
    this.changes += 1;
    if (this.listeners.size === 0) return;
    const full: HotspotRegistryChange = {
      ...change,
      size: this.records.size,
      revision: this.changes,
    };
    for (const listener of [...this.listeners]) listener(full);
  }
}

/** Creates an empty registry. */
export function createHotspotRegistry(): HotspotRegistry {
  return new HotspotRegistry();
}

/* -------------------------------------------------------------------------- */
/* Default anchors                                                            */
/* -------------------------------------------------------------------------- */

/*
 * Room shares used to derive the anchor set. Every value is a fraction of the
 * supplied {@link RoomBounds}, never a world coordinate, so a wider, deeper or
 * taller shell moves the anchors with it. The fractions mirror the environment
 * shell's structural layout: the counter runs along the back wall, the table
 * grid fills the room in front of it, the storefront entrance is on the front
 * wall and the wall mounts hang at picture height on the side walls.
 */
const COUNTER_CENTRE_DEPTH_SHARE = 0.044; // counter top centre, from the back wall
const COUNTER_SURFACE_HEIGHT_SHARE = 0.3; // ≈1.08 m of a 3.6 m room
const MACHINE_BAY_X_SHARE = -0.256; // first counter-pass bay, left of centre
const MENU_BOARD_X_SHARE = 0.45; // inside the right wall, clear of the wall margin
const WALL_MOUNT_HEIGHT_SHARE = 0.45; // ≈1.62 m: picture height
const MENU_BOARD_DEPTH_SHARE = 0.391; // right wall, ≈39% of the depth from the back
const SEATING_X_SHARE = 0.29; // outer table column
const SEATING_DEPTH_SHARE = 0.412; // second table row
const TABLE_SURFACE_HEIGHT_SHARE = 0.2056; // ≈0.74 m: table top
const ENTRANCE_DEPTH_SHARE = 0.955; // just inside the storefront wall
const ENTRANCE_HEIGHT_SHARE = 0.35; // ≈1.26 m: handle height
const MUSIC_WALL_X_SHARE = -0.45; // inside the left wall, clear of the wall margin
const MUSIC_DEPTH_SHARE = 0.91; // left wall, near the storefront
const MUSIC_HEIGHT_SHARE = 0.36; // ≈1.3 m: shelf height

function requireBounds(bounds: RoomBounds): RoomBounds {
  const values = [bounds.width, bounds.depth, bounds.height];
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    throw new Error(
      `Default anchors need positive finite room bounds (received width=${describeValue(bounds.width)}, depth=${describeValue(bounds.depth)}, height=${describeValue(bounds.height)}).`,
    );
  }
  return bounds;
}

/**
 * Builds the default anchor set from the room shell's dimensions.
 *
 * Covers the six required viewing subjects. The anchors are deliberately
 * era-agnostic — they carry a neutral description and **no** era notes — so this
 * module never authors era content and every caption resolves through the
 * description fallback until a domain module publishes its own hotspot.
 */
export function createDefaultAnchors(bounds: RoomBounds = DEFAULT_ROOM_BOUNDS): readonly HotspotInput[] {
  const room = requireBounds(bounds);
  const halfDepth = room.depth / 2;
  const counterZ = -halfDepth + room.depth * COUNTER_CENTRE_DEPTH_SHARE;
  const counterY = room.height * COUNTER_SURFACE_HEIGHT_SHARE;
  const wallMountY = room.height * WALL_MOUNT_HEIGHT_SHARE;

  const anchors: HotspotInput[] = [
    {
      id: DEFAULT_ANCHOR_IDS.serviceCounter,
      label: 'Service counter',
      description: 'Where orders are taken and drinks are handed across the counter.',
      focus: { x: 0, y: counterY, z: counterZ },
      framingDistance: 1.9,
      radius: 0.9,
      approach: { x: 0, y: 0.16, z: 1 },
      tags: [DEFAULT_ANCHOR_TAG, 'service-counter'],
    },
    {
      id: DEFAULT_ANCHOR_IDS.machineBay,
      label: 'Machine bay',
      description: 'The counter bay reserved for the room’s brewing equipment.',
      focus: { x: room.width * MACHINE_BAY_X_SHARE, y: counterY, z: counterZ },
      framingDistance: 1.45,
      radius: 0.45,
      approach: { x: 0, y: 0.12, z: 1 },
      tags: [DEFAULT_ANCHOR_TAG, 'machine-bay'],
    },
    {
      id: DEFAULT_ANCHOR_IDS.menuBoard,
      label: 'Menu board',
      description: 'The wall-mounted board that lists what the café serves.',
      focus: {
        x: room.width * MENU_BOARD_X_SHARE,
        y: wallMountY,
        z: -halfDepth + room.depth * MENU_BOARD_DEPTH_SHARE,
      },
      framingDistance: 1.4,
      radius: 0.55,
      approach: { x: -1, y: 0.08, z: 0 },
      tags: [DEFAULT_ANCHOR_TAG, 'menu-board'],
    },
    {
      id: DEFAULT_ANCHOR_IDS.seating,
      label: 'Seating',
      description: 'The table and chair grid filling the room in front of the counter.',
      focus: {
        x: room.width * SEATING_X_SHARE,
        y: room.height * TABLE_SURFACE_HEIGHT_SHARE,
        z: -halfDepth + room.depth * SEATING_DEPTH_SHARE,
      },
      framingDistance: 2.2,
      radius: 1.1,
      approach: { x: -0.18, y: 0.24, z: 1 },
      tags: [DEFAULT_ANCHOR_TAG, 'seating'],
    },
    {
      id: DEFAULT_ANCHOR_IDS.entrance,
      label: 'Entrance',
      description: 'The storefront door visitors arrive through, at the front of the room.',
      focus: {
        x: 0,
        y: room.height * ENTRANCE_HEIGHT_SHARE,
        z: -halfDepth + room.depth * ENTRANCE_DEPTH_SHARE,
      },
      framingDistance: 1.7,
      radius: 0.9,
      approach: { x: 0, y: 0.12, z: -1 },
      tags: [DEFAULT_ANCHOR_TAG, 'entrance'],
    },
    {
      id: DEFAULT_ANCHOR_IDS.musicSource,
      label: 'Music source',
      description: 'The wall shelf the room’s music plays from.',
      focus: {
        x: room.width * MUSIC_WALL_X_SHARE,
        y: room.height * MUSIC_HEIGHT_SHARE,
        z: -halfDepth + room.depth * MUSIC_DEPTH_SHARE,
      },
      framingDistance: 1.6,
      radius: 0.5,
      approach: { x: 1, y: 0.1, z: 0.15 },
      tags: [DEFAULT_ANCHOR_TAG, 'music-source'],
    },
  ];

  return Object.freeze(anchors);
}

/**
 * Publishes {@link createDefaultAnchors} into `registry`. Throws (through
 * {@link HotspotRegistry.publishMany}) when the anchors are already registered,
 * because hotspot ids are unique scene-wide.
 */
export function registerDefaultAnchors(
  registry: HotspotRegistry,
  bounds: RoomBounds = DEFAULT_ROOM_BOUNDS,
  publisherId: string = DEFAULT_ANCHOR_PUBLISHER_ID,
): readonly HotspotRecord[] {
  return registry.publishMany(publisherId, createDefaultAnchors(bounds));
}

/** The viewing subjects covered by a record's tags, in tag order. */
export function defaultAnchorSubjects(record: HotspotRecord): readonly DefaultAnchorSubject[] {
  return Object.freeze(
    DEFAULT_ANCHOR_SUBJECTS.filter((subject) => record.tags.includes(subject)),
  );
}
