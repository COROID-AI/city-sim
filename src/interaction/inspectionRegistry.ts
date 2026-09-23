/**
 * Chrono City — inspection registry.
 *
 * The single place where content tasks register "things you can look at". A
 * record pairs an object in the scene graph with **era-keyed copy**
 * (`InspectableCopy`) and the hover highlight style the picking controller
 * applies, so content never has to know how pointer input, highlighting or the
 * info card work.
 *
 * Resolution is a *pure function of `(objectId, EraId)`*: the registry never
 * reads the clock, the live timeline or any global state. That is what lets the
 * era-transition integration task re-render an open info card as the year
 * slider moves — it simply calls `resolve()` again with the new `EraId`.
 *
 * When an object has no copy for the requested year the registry degrades
 * gracefully, in this order:
 *   1. the exact era's copy                     → `source: 'era'`
 *   2. the authored `fallbackCopy`               → `source: 'fallback'`
 *   3. the nearest authored era (ties prefer the older year, so new copy only
 *      appears from the year it was written)     → `source: 'nearest-era'`
 *   4. the plain object label, with no blurb     → `source: 'label'`
 *
 * Lifecycle:
 *   create    → `createInspectionRegistry()` / `new InspectionRegistry()`.
 *   consume   → content tasks call `register()` / `deregister()`; the picking
 *               controller calls `pickTargets()`, `findByObject()` and
 *               `resolve()`; HUD tasks can `subscribe()` to changes.
 *   integrate → the interaction layer owns one registry and hands the same
 *               instance to every content task that contributes inspectables.
 */

import * as THREE from 'three';

import { ERA_IDS, eraIndex, isEraId, type EraId } from '../core/eraContracts';

export const INSPECTION_REGISTRY_VERSION = 1;

/** Emissive colour a hovered object glows with when content does not override it. */
export const DEFAULT_HIGHLIGHT_EMISSIVE = 0x6fd3ff;
/** Strength of the default emissive hover tint. */
export const DEFAULT_HIGHLIGHT_EMISSIVE_INTENSITY = 0.9;
/** Colour of the default hover edge outline. */
export const DEFAULT_HIGHLIGHT_OUTLINE_COLOR = 0xcdeeff;

/* ------------------------------------------------------------------------- *
 * Copy and highlight style
 * ------------------------------------------------------------------------- */

/** The text one inspectable object shows in one era. */
export interface InspectableCopy {
  /** Short display name, e.g. `Municipal Offices`. */
  readonly name: string;
  /** One- or two-sentence description of the object in that era. */
  readonly blurb: string;
}

/**
 * Era-keyed copy. Every key is optional: content may omit the years it has no
 * copy for and let the registry fall back (see the module doc).
 */
export type InspectableCopyByEra = Partial<Record<EraId, InspectableCopy>>;

/** Which authored source actually supplied a resolved label. */
export type CopySource = 'era' | 'fallback' | 'nearest-era' | 'label';

/** Hover presentation override for one inspectable object. */
export interface InspectableHighlightStyle {
  /** Emissive tint applied to the hovered object's materials. */
  readonly emissive?: THREE.ColorRepresentation;
  /** Emissive intensity applied while hovered (`0`–`2` looks best). */
  readonly emissiveIntensity?: number;
  /** Draw an edge outline around the hovered geometry. Defaults to `true`. */
  readonly outline?: boolean;
  /** Outline colour. */
  readonly outlineColor?: THREE.ColorRepresentation;
}

/** A highlight style with every optional field resolved to a concrete value. */
export interface ResolvedHighlightStyle {
  /** Normalised emissive tint as a hex number. */
  readonly emissive: number;
  readonly emissiveIntensity: number;
  readonly outline: boolean;
  readonly outlineColor: number;
}

/** Hover look used by content that does not specify its own. */
export const DEFAULT_HIGHLIGHT_STYLE: ResolvedHighlightStyle = Object.freeze({
  emissive: DEFAULT_HIGHLIGHT_EMISSIVE,
  emissiveIntensity: DEFAULT_HIGHLIGHT_EMISSIVE_INTENSITY,
  outline: true,
  outlineColor: DEFAULT_HIGHLIGHT_OUTLINE_COLOR,
});

/* ------------------------------------------------------------------------- *
 * Registration
 * ------------------------------------------------------------------------- */

/** Everything a content task supplies when it registers an inspectable. */
export interface InspectableDefinition {
  /** Stable unique id, also used as the info card's `objectId`. */
  readonly id: string;
  /** Root of the pickable subtree; children are pick targets too. */
  readonly object: THREE.Object3D;
  /**
   * Per-year copy. Optional: an object registered without any copy resolves to
   * its `label` (with an empty blurb) for every era.
   */
  readonly copy?: InspectableCopyByEra;
  /** Copy used for any year the era map does not cover. */
  readonly fallbackCopy?: InspectableCopy;
  /** Plain name used when no copy resolves at all. Defaults to `id`. */
  readonly label?: string;
  /** Hover look override. */
  readonly highlight?: InspectableHighlightStyle;
  /** Free-form payload for content tasks and HUD systems. */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** A registered inspectable, frozen so consumers cannot mutate the registry. */
export interface InspectableRecord {
  readonly id: string;
  readonly object: THREE.Object3D;
  readonly copy: Readonly<InspectableCopyByEra>;
  readonly fallbackCopy: InspectableCopy | null;
  readonly label: string;
  readonly highlight: ResolvedHighlightStyle;
  readonly data: Readonly<Record<string, unknown>>;
  /** Registration order, so iteration is deterministic. */
  readonly sequence: number;
}

/** The copy an inspectable resolves to for one era. */
export interface ResolvedInspectableCopy {
  readonly objectId: string;
  /** Era the caller asked for. */
  readonly era: EraId;
  /** Era whose copy was used, or `null` for the label-only fallback. */
  readonly sourceEra: EraId | null;
  readonly name: string;
  readonly blurb: string;
  readonly source: CopySource;
  /** `true` only when the requested era had authored copy of its own. */
  readonly hasEraCopy: boolean;
}

/** Change notifications, so HUD/picking systems can react to content churn. */
export type RegistryChangeEvent =
  | { readonly action: 'register'; readonly record: InspectableRecord }
  | { readonly action: 'deregister'; readonly record: InspectableRecord }
  | { readonly action: 'clear'; readonly records: readonly InspectableRecord[] };

export type RegistryListener = (event: RegistryChangeEvent) => void;

/* ------------------------------------------------------------------------- *
 * Validation helpers
 * ------------------------------------------------------------------------- */

function assertNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(message);
  }
  return value.trim();
}

function normalizeCopy(copy: InspectableCopy | undefined, id: string, era: string): InspectableCopy {
  if (!copy || typeof copy !== 'object') {
    throw new TypeError(`Inspectable "${id}" needs { name, blurb } strings for era ${era}.`);
  }
  return Object.freeze({
    name: assertNonEmptyString(
      copy.name,
      `Inspectable "${id}" has an empty name for era ${era}.`,
    ),
    blurb: assertNonEmptyString(
      copy.blurb,
      `Inspectable "${id}" has an empty blurb for era ${era}.`,
    ),
  });
}

function normalizeCopyByEra(copy: InspectableCopyByEra | undefined, id: string): Readonly<InspectableCopyByEra> {
  const normalized: InspectableCopyByEra = {};
  if (!copy) return Object.freeze(normalized);

  for (const [key, value] of Object.entries(copy)) {
    if (!isEraId(key)) {
      throw new TypeError(
        `Inspectable "${id}" has copy for unknown era "${key}"; expected one of ${ERA_IDS.join(', ')}.`,
      );
    }
    normalized[key] = normalizeCopy(value, id, key);
  }
  return Object.freeze(normalized);
}

function normalizeColor(
  value: THREE.ColorRepresentation | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  return new THREE.Color(value).getHex();
}

function resolveHighlightStyle(
  style: InspectableHighlightStyle | undefined,
): ResolvedHighlightStyle {
  if (!style) return DEFAULT_HIGHLIGHT_STYLE;
  return Object.freeze({
    emissive: normalizeColor(style.emissive, DEFAULT_HIGHLIGHT_STYLE.emissive),
    emissiveIntensity:
      typeof style.emissiveIntensity === 'number' && Number.isFinite(style.emissiveIntensity)
        ? style.emissiveIntensity
        : DEFAULT_HIGHLIGHT_STYLE.emissiveIntensity,
    outline: style.outline ?? DEFAULT_HIGHLIGHT_STYLE.outline,
    outlineColor: normalizeColor(style.outlineColor, DEFAULT_HIGHLIGHT_STYLE.outlineColor),
  });
}

function isObject3D(value: unknown): value is THREE.Object3D {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<THREE.Object3D>).isObject3D === true
  );
}

/**
 * Nearest authored era for `era`, preferring the older year on a tie so copy
 * only appears from the year it was written. Returns `null` when the map is
 * empty.
 */
function nearestAuthoredEra(copy: Readonly<InspectableCopyByEra>, era: EraId): EraId | null {
  const target = eraIndex(era);
  if (target < 0) return null;

  let best: EraId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIndex = Number.POSITIVE_INFINITY;

  for (const candidate of ERA_IDS) {
    if (candidate === era || !copy[candidate]) continue;
    const index = eraIndex(candidate);
    const distance = Math.abs(index - target);
    if (distance < bestDistance || (distance === bestDistance && index < bestIndex)) {
      best = candidate;
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return best;
}

/**
 * Pure label resolution for one record. Exported so tests and HUD systems can
 * resolve a record they already hold without going back through the registry.
 */
export function resolveRecordCopy(
  record: InspectableRecord,
  era: EraId,
): ResolvedInspectableCopy {
  const exact = record.copy[era];
  if (exact) {
    return {
      objectId: record.id,
      era,
      sourceEra: era,
      name: exact.name,
      blurb: exact.blurb,
      source: 'era',
      hasEraCopy: true,
    };
  }

  if (record.fallbackCopy) {
    return {
      objectId: record.id,
      era,
      sourceEra: null,
      name: record.fallbackCopy.name,
      blurb: record.fallbackCopy.blurb,
      source: 'fallback',
      hasEraCopy: false,
    };
  }

  const sourceEra = nearestAuthoredEra(record.copy, era);
  const nearest = sourceEra ? record.copy[sourceEra] : undefined;
  if (sourceEra && nearest) {
    return {
      objectId: record.id,
      era,
      sourceEra,
      name: nearest.name,
      blurb: nearest.blurb,
      source: 'nearest-era',
      hasEraCopy: false,
    };
  }

  return {
    objectId: record.id,
    era,
    sourceEra: null,
    name: record.label,
    blurb: '',
    source: 'label',
    hasEraCopy: false,
  };
}

/* ------------------------------------------------------------------------- *
 * Registry
 * ------------------------------------------------------------------------- */

/**
 * Index of every inspectable object in the city, keyed by id and reachable from
 * the scene graph. Content tasks write, picking and HUD systems read.
 */
export class InspectionRegistry {
  readonly version = INSPECTION_REGISTRY_VERSION;

  private readonly records = new Map<string, InspectableRecord>();
  private readonly byObjectUuid = new Map<string, InspectableRecord>();
  private readonly listeners = new Set<RegistryListener>();
  private sequence = 0;
  private revisionState = 0;
  private targetsCache: readonly THREE.Object3D[] | null = null;

  /** Number of registered inspectables. */
  get size(): number {
    return this.records.size;
  }

  /** Bumped on every mutation; handy for cheap change detection. */
  get revision(): number {
    return this.revisionState;
  }

  /**
   * Registers one inspectable. Throws on a duplicate id (deregister first) and
   * on malformed metadata, so content mistakes surface at boot instead of at
   * the first hover.
   */
  register(definition: InspectableDefinition): InspectableRecord {
    const id = assertNonEmptyString(definition?.id, 'register() requires a non-empty inspectable id.');
    if (this.records.has(id)) {
      throw new Error(`Inspectable "${id}" is already registered; deregister it first.`);
    }
    if (!isObject3D(definition.object)) {
      throw new TypeError(`Inspectable "${id}" needs a THREE.Object3D to pick against.`);
    }

    const copy = normalizeCopyByEra(definition.copy, id);
    const fallbackCopy = definition.fallbackCopy
      ? normalizeCopy(definition.fallbackCopy, id, 'fallbackCopy')
      : null;

    const record: InspectableRecord = Object.freeze({
      id,
      object: definition.object,
      copy,
      fallbackCopy,
      label: definition.label?.trim() || id,
      highlight: resolveHighlightStyle(definition.highlight),
      data: Object.freeze({ ...(definition.data ?? {}) }),
      sequence: this.sequence,
    });

    this.sequence += 1;
    this.records.set(id, record);
    this.byObjectUuid.set(record.object.uuid, record);
    this.invalidate();
    this.emit({ action: 'register', record });
    return record;
  }

  /** Registers several inspectables in one call. */
  registerMany(definitions: readonly InspectableDefinition[]): readonly InspectableRecord[] {
    return definitions.map((definition) => this.register(definition));
  }

  /** Removes an inspectable. Returns `false` when the id was unknown. */
  deregister(objectId: string): boolean {
    const record = this.records.get(objectId);
    if (!record) return false;
    this.records.delete(objectId);
    this.byObjectUuid.delete(record.object.uuid);
    this.invalidate();
    this.emit({ action: 'deregister', record });
    return true;
  }

  has(objectId: string): boolean {
    return this.records.has(objectId);
  }

  get(objectId: string): InspectableRecord | undefined {
    return this.records.get(objectId);
  }

  /** Like `get()`, but throws instead of returning `undefined`. */
  require(objectId: string): InspectableRecord {
    const record = this.records.get(objectId);
    if (!record) {
      throw new RangeError(`No inspectable registered for id "${objectId}".`);
    }
    return record;
  }

  /** Registered ids in registration order. */
  ids(): readonly string[] {
    return Object.freeze([...this.records.keys()]);
  }

  /** Registered records in registration order. */
  list(): readonly InspectableRecord[] {
    return Object.freeze([...this.records.values()]);
  }

  /** Roots the picking controller raycasts against (children are included). */
  pickTargets(): readonly THREE.Object3D[] {
    if (this.targetsCache === null) {
      this.targetsCache = Object.freeze(
        [...this.records.values()].map((record) => record.object),
      );
    }
    return this.targetsCache;
  }

  /**
   * Walks up from an intersected object to the inspectable that owns it, so a
   * hit on a child mesh resolves to the registered root.
   */
  findByObject(object: THREE.Object3D | null | undefined): InspectableRecord | null {
    let current: THREE.Object3D | null | undefined = object;
    while (current) {
      const record = this.byObjectUuid.get(current.uuid);
      if (record) return record;
      current = current.parent;
    }
    return null;
  }

  /**
   * Resolves era-keyed copy for one object. Pure in `(objectId, era)`: the same
   * arguments always produce the same result, regardless of app state.
   * Returns `null` for ids that are not registered.
   */
  resolve(objectId: string, era: EraId): ResolvedInspectableCopy | null {
    const record = this.records.get(objectId);
    return record ? resolveRecordCopy(record, era) : null;
  }

  /** Resolves copy for a scene-graph object (helper for pointer-driven HUDs). */
  resolveObject(
    object: THREE.Object3D | null | undefined,
    era: EraId,
  ): ResolvedInspectableCopy | null {
    const record = this.findByObject(object);
    return record ? resolveRecordCopy(record, era) : null;
  }

  /** Subscribes to register/deregister/clear events. Returns an unsubscribe fn. */
  subscribe(listener: RegistryListener): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribe() requires a listener function.');
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Removes every inspectable, notifying subscribers once. */
  clear(): void {
    if (this.records.size === 0) return;
    const records = [...this.records.values()];
    this.records.clear();
    this.byObjectUuid.clear();
    this.invalidate();
    this.emit({ action: 'clear', records: Object.freeze(records) });
  }

  private invalidate(): void {
    this.targetsCache = null;
    this.revisionState += 1;
  }

  private emit(event: RegistryChangeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('[chrono-city] inspection registry listener failed', error);
      }
    }
  }
}

/** Creates an inspection registry (the `create` half of the lifecycle). */
export function createInspectionRegistry(): InspectionRegistry {
  return new InspectionRegistry();
}
