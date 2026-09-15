/**
 * Brewing scene module — the café's coffee machines and brewing equipment.
 *
 * One module owns every machine in the bar, exactly the way the frozen
 * {@link SceneModule} contract expects:
 *
 *  - `build(context)` raises the era's *primary brewing machine* (1945
 *    percolator urn, 1965 lever espresso machine with steam wands, 1985
 *    semi-automatic group machine with a knock box, 2005 super-automatic with
 *    digital dosing, 2025 multi-group machine with a touch panel) plus the
 *    supporting equipment the era would have on the counter — kettle, filter
 *    brewer, grinder, milk pitcher, tamper, scale and cup stacks — as named
 *    nodes inside a single `machines` group.
 *  - `applyPeriod(period, context)` rebuilds the bar for the new era. Machines
 *    *are* period specific: a 1945 enamelled percolator urn is not a 2025
 *    saturated multi-group machine, so the previous content and its material set
 *    are released before the next are raised. Nothing of the old era survives.
 *  - `update(delta, context)` runs the machines: gauge needles tremble, pilot
 *    lamps breathe, steam plumes rise and fade, a shot drips, a grinder's hopper
 *    rattles, a cup stack shivers.
 *  - `dispose()` releases every geometry, material and texture the module
 *    created, detaches its group, and unsubscribes the machine-SFX listener, so
 *    repeated re-instantiation leaks nothing.
 *  - `getHotspots()` exposes the era's machine bays and equipment (the espresso
 *    machine, steam wand, grinder, kettle, knock box, cup stacks, touch panel)
 *    for the overlay, without touching the core hotspot registry.
 *
 * ## Sound
 *
 * The module never owns an `AudioContext`. It consumes the injected machine-SFX
 * bus (the `cafe-audio-engine` handle, either passed in the constructor or
 * supplied through `BuildContext.services.audio` as the composition root does)
 * and fires the engine's parameterised one-shots:
 *
 * | interaction | cue id | engine one-shot | geometry it animates |
 * | --- | --- | --- | --- |
 * | `pull-shot` | `shot` | `extraction` | group head drip, needle sweep |
 * | `purge-steam` | `steam` | `steamPurge` | wand steam plumes |
 * | `run-grinder` | `grind` | `grinder` | hopper rattle |
 * | `cup-clatter` | `cup-clatter` | `cupClatter` | warming-rail and stacked cups |
 * | `milk-knock` | `milk-knock` | `milkKnock` | milk pitcher |
 *
 * `purgeSteam()` is era-correct rather than universal: a 1945 percolator urn has
 * no steam wand, so the call is a no-op that returns `null` (its hiss belongs to
 * the percolation `extraction` cue). Everything else is available in every era
 * because every era's bar has a grinder, a pitcher, cups and a brewing machine.
 *
 * A locked engine (before the visitor's first gesture) or a missing audio handle
 * never throws out of the module: the cue is recorded with `emitted: false` and
 * the module keeps running silently, which is how the composition root boots the
 * café before the enter gesture.
 *
 * ## Determinism
 *
 * Placement uses the environment's {@link StructuralLayout} (the counter-pass
 * slots, the service lane, the wall mounts) plus a per-era seeded source (the
 * module seed hashed with the {@link YearId}), never the shared context source,
 * so re-applying an era always reproduces the same layout.
 */

import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  type BuildContext,
  type DomainSpecBase,
  type Hotspot,
  type PeriodDefinition,
  type RoomBounds,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import { createSeededRandom, disposeObject3D, type Unsubscribe } from '../../core/kernel';
import type {
  MachineSfxKind,
  MachineTriggerOptions,
  MachineTriggerRecord,
} from '../../audio';
import {
  CAFE_ROOM_BOUNDS,
  STRUCTURAL_LAYOUT,
  hashString,
  type StructuralLayout,
} from '../environment';
import {
  createMachineMaterialSet,
  disposeMachineMaterialSet,
  machineMaterialSignature,
  machineSurface,
  type CanvasFactory,
  type MachineMaterialRecipe,
  type MachineMaterialSet,
} from './textures';
import {
  MACHINE_NODE_PREFIX,
  buildMachine,
  hasSteamWand,
  planMachines,
  placementProblems,
  type MachineBuild,
  type MachinePlanEntry,
} from './build/machines';
import {
  ACCESSORY_NODE_PREFIX,
  buildAccessory,
  planAccessories,
  type AccessoryBuild,
  type AccessoryPlanEntry,
} from './build/accessories';
import { SPEC_1945 } from './data/1945';
import { SPEC_1965 } from './data/1965';
import { SPEC_1985 } from './data/1985';
import { SPEC_2005 } from './data/2005';
import { SPEC_2025 } from './data/2025';

/* -------------------------------------------------------------------------- */
/* Module identity                                                            */
/* -------------------------------------------------------------------------- */

/** Stable module id: registry key, hotspot owner id and node namespace. */
export const BREWING_MODULE_ID = 'machines';

/** Name of the group every machine node is parented to. */
export const MACHINES_GROUP_NAME = 'machines';

/* -------------------------------------------------------------------------- */
/* Era vocabulary: machines                                                   */
/* -------------------------------------------------------------------------- */

/** The five brewing-machine archetypes the timeline moves through. */
export type MachineArchetypeKind =
  | 'percolator'
  | 'lever-espresso'
  | 'semi-automatic'
  | 'super-automatic'
  | 'multi-group';

export const MACHINE_ARCHETYPE_KINDS: readonly MachineArchetypeKind[] = Object.freeze([
  'percolator',
  'lever-espresso',
  'semi-automatic',
  'super-automatic',
  'multi-group',
]);

/** How the era's machine gets water through the coffee. */
export type BrewMethod = 'percolation' | 'lever-espresso' | 'pump-espresso';

/** How a dose is measured and started — the era's control signature. */
export type DosingKind =
  | 'none'
  | 'lever-pull'
  | 'volumetric-buttons'
  | 'digital-dosing'
  | 'touch-dosing';

/** What keeps the era's cups warm. */
export type CupWarmerKind = 'none' | 'shelf' | 'top-rail' | 'heated-drawer';

/** How the fascia is made and dressed. */
export type PanelStyle =
  | 'riveted-enamel'
  | 'crackle-fascia'
  | 'stainless-moulding'
  | 'screen-printed-fascia'
  | 'backlit-glass';

/** What the machine stands on. */
export type FeetKind = 'cast-iron-pads' | 'chrome-bun-feet' | 'rubber-cups' | 'adjustable-studs';

/** The era's group head construction. */
export type GroupHeadKind =
  | 'none'
  | 'lever-group'
  | 'e61-group'
  | 'integrated-groups'
  | 'saturated-groups';

/** What catches the drips. */
export type DripTrayKind = 'none' | 'brass-tray' | 'perforated-steel-tray' | 'deep-stainless-tray';

/** A control on the fascia: gauge, knob, rocker, pedal, key or touch row. */
export type DialFaceKind =
  | 'gauge'
  | 'knob'
  | 'rocker'
  | 'toggle'
  | 'paddle'
  | 'push-button'
  | 'touch-key';

/** Dimensions in metres, width × depth × height. */
export interface MachineDimensions {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/** One control on the machine fascia. */
export interface DialSpec {
  readonly id: string;
  readonly label: string;
  /** Which control it is (drives the builder and the hotspot note). */
  readonly face: DialFaceKind;
  /** Surface id of the control's own face (dial card, knob, key). */
  readonly slot: string;
  /** Surface id of the bezel/legend around it. */
  readonly bezel: string;
  readonly units?: string;
  readonly range?: readonly [number, number];
  /** Where the needle sits, 0..1 of the sweep (gauges only). */
  readonly needle?: number;
  /** Prose detail for the hotspot and the diagnostics snapshot. */
  readonly detail: string;
}

/** The machine's housing: materials, fascia, feet and the wear it carries. */
export interface HousingSpec {
  /** Surface id of the main body. */
  readonly body: string;
  /** Surface id of the front fascia / urn body. */
  readonly front: string;
  /** Surface id of the control panel plate and dose keys. */
  readonly panel: string;
  /** Surface id of rails, trims, gauges and knuckle joints. */
  readonly trim: string;
  /** Surface id of grips, handles and control knobs. */
  readonly handle: string;
  /** Surface id of the boiler (copper urn, HX tank, saturated block). */
  readonly boiler: string;
  /** Surface id of the steam-path pipes. */
  readonly pipe: string;
  /** Surface id of sight glasses, hoppers and windows. */
  readonly glass: string;
  /** Surface id of the cups on the warming rail. */
  readonly cup: string;
  /** Surface id of side cheeks / cladding panels. */
  readonly cheek: string;
  /** Surface id of the display (LCD readout or touch panel glass). */
  readonly display: string;
  /** Surface id of the scuff and stain decals. */
  readonly wearPatch: string;
  readonly panelStyle: PanelStyle;
  readonly feet: FeetKind;
  /** How worn the machine is, 0..1 (drives the wear decals). */
  readonly wearLevel: number;
  /** Vent slots / louvres pressed into the body. */
  readonly ventCount: number;
  /** Prose description of the wear and patina. */
  readonly patina: string;
  /** Prose description of dial, panel and lettering detail. */
  readonly panelNote: string;
}

/** The steam path: boiler, groups, wands and how it purges. */
export interface SteamPathSpec {
  /** Boiler construction, era by era. */
  readonly boiler: string;
  readonly boilerLitres: number;
  readonly groupHead: GroupHeadKind;
  /** Steam wands on the machine (0 for the percolator era). */
  readonly wandCount: number;
  /** Wand length in metres. */
  readonly wandLength: number;
  readonly pressureBar: number;
  /** Whether the era shows a sight glass on the boiler face. */
  readonly sightGlass: boolean;
  readonly dripTray: DripTrayKind;
  /** Visible pipe runs inside/behind the group (copper, then braided steel). */
  readonly pipeRuns: number;
  /** How long a purge hisses, in seconds (mirrors the engine's character). */
  readonly purgeSeconds: number;
  /** Prose description of the steam path. */
  readonly detail: string;
}

/** A pilot lamp, backlit panel or LED strip the builder lights up. */
export interface MachineLampSpec {
  /** Surface id of the emissive material. */
  readonly slot: string;
  readonly label: string;
  readonly count: number;
}

/** The era's primary brewing machine. */
export interface BrewingMachineSpec {
  /** Node id, e.g. `machines:1945:percolator`. */
  readonly id: string;
  readonly archetype: MachineArchetypeKind;
  /** Human label, e.g. `'Electric percolator urn'`. */
  readonly label: string;
  /** Model designation painted on the machine. */
  readonly model: string;
  readonly brand: string;
  readonly summary: string;
  readonly dimensions: MachineDimensions;
  readonly housing: HousingSpec;
  /** Espresso groups (0 for the percolator and filter-brew era). */
  readonly groupCount: number;
  /** False for 1945: the percolator has no espresso group at all. */
  readonly hasEspressoGroup: boolean;
  readonly brewMethod: BrewMethod;
  readonly dosingKind: DosingKind;
  readonly dosingLabel: string;
  readonly dosingDetail: string;
  /** LCD/numeric readout (2005 onward). */
  readonly hasDigitalDisplay: boolean;
  /** Glass touch UI (2025 only). */
  readonly hasTouchPanel: boolean;
  readonly hasSteamWand: boolean;
  readonly steam: SteamPathSpec;
  readonly dials: readonly DialSpec[];
  readonly lamps: readonly MachineLampSpec[];
  readonly cupWarmer: CupWarmerKind;
  /** Integrated knock drawer/chute (1985 onward). */
  readonly knockBox: boolean;
  readonly portafilterMm: number;
  readonly basketCount: number;
  /** Free space in front of the group, metres (the barista's hands). */
  readonly clearance: number;
  /** Prose list of the era's wear and material tells. */
  readonly wear: readonly string[];
  readonly detail: readonly string[];
  readonly tags: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Era vocabulary: supporting equipment                                        */
/* -------------------------------------------------------------------------- */

/** The supporting equipment the bar stands on. */
export type AccessoryKind =
  | 'kettle'
  | 'filter-brewer'
  | 'grinder'
  | 'milk-pitcher'
  | 'tamper'
  | 'scale'
  | 'cup-stack'
  | 'knock-box';

export const ACCESSORY_KINDS: readonly AccessoryKind[] = Object.freeze([
  'kettle',
  'filter-brewer',
  'grinder',
  'milk-pitcher',
  'tamper',
  'scale',
  'cup-stack',
  'knock-box',
]);

/** Where an accessory is anchored in the room. */
export type AccessoryMount = 'counter-slot' | 'machine-top' | 'machine-front' | 'wall';

/** How an era's grinder works. */
export type GrinderKind =
  | 'manual-conical-burr'
  | 'electric-doser'
  | 'doserless-burr'
  | 'on-demand-flat'
  | 'single-dose-flat';

/** One piece of supporting brewing equipment. */
export interface AccessorySpec {
  readonly id: string;
  readonly kind: AccessoryKind;
  readonly label: string;
  readonly model: string;
  /**
   * Build variant the geometry dispatcher switches on (`'wall-crank'`,
   * `'vacuum-pot'`, `'calibrated-tamper'`, ...). Each kind documents its own
   * variants in `build/accessories.ts`; unknown values fall back to the first.
   */
  readonly variant: string;
  /** Surface id of the main body. */
  readonly material: string;
  /** Surface id of handles, bands and trims. */
  readonly trim: string;
  /** Optional third surface (glass, wood, ceramic). */
  readonly secondary?: string;
  readonly dimensions: MachineDimensions;
  readonly mount: AccessoryMount;
  /** Counter-pass kind the accessory stands on (`counter-slot` mounts only). */
  readonly counterSlot?: 'machine-bay' | 'grinder-bay' | 'tray-run' | 'handoff';
  /** Offset from the slot/machine anchor, metres. */
  readonly offset?: { readonly x: number; readonly z: number };
  /** Position along the back wall for `wall` mounts, metres from centre. */
  readonly wallX?: number;
  /** Height above the floor for `wall` mounts, metres. */
  readonly wallHeight?: number;
  readonly grinderKind?: GrinderKind;
  /** Prose description of the hopper/doser detail. */
  readonly hopperDetail?: string;
  readonly cupCapacity?: number;
  /** Stack height in metres (cup stacks). */
  readonly stackHeight?: number;
  readonly capacityLitres?: number;
  /** What makes this piece period correct. */
  readonly detail: readonly string[];
  readonly tags: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Era specs                                                                  */
/* -------------------------------------------------------------------------- */

/** One era's brewing domain data. */
export interface BrewingSpec extends DomainSpecBase {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly summary: string;
  readonly paletteName: string;
  /** Id of the material set this era builds with. */
  readonly materialSetId: string;
  readonly accentColor: string;
  readonly tags: readonly string[];
  readonly notes: readonly string[];
  /** The era's primary brewing machine. */
  readonly machine: BrewingMachineSpec;
  /** The era's supporting equipment, in build order. */
  readonly accessories: readonly AccessorySpec[];
  /** The era's procedural surface recipes. */
  readonly surfaces: readonly MachineMaterialRecipe[];
}

const SPEC_SOURCES: Readonly<Record<YearId, BrewingSpec>> = {
  '1945': SPEC_1945,
  '1965': SPEC_1965,
  '1985': SPEC_1985,
  '2005': SPEC_2005,
  '2025': SPEC_2025,
};

function buildSpecMap(): Readonly<Record<YearId, BrewingSpec>> {
  const map = {} as Record<YearId, BrewingSpec>;
  for (const year of Object.keys(SPEC_SOURCES) as YearId[]) {
    map[year] = Object.freeze(SPEC_SOURCES[year]);
  }
  return Object.freeze(map);
}

/** The five era specs, keyed by the shared `YearId`. */
export const BREWING_SPECS: Readonly<Record<YearId, BrewingSpec>> = buildSpecMap();

/** Spec of `year` (always defined for the five café eras). */
export function brewingSpec(year: YearId): BrewingSpec {
  const spec = BREWING_SPECS[year];
  if (!spec) throw new RangeError(`No brewing spec for era "${year}".`);
  return spec;
}

/** The era specs in timeline order. */
export function brewingSpecs(): readonly BrewingSpec[] {
  return Object.freeze((Object.keys(BREWING_SPECS) as YearId[]).map((year) => BREWING_SPECS[year]));
}

/**
 * Fields the tests and the era-conflict report compare: two eras are *distinct*
 * when the data differs on the machine, the equipment inventory or the finish.
 */
export const BREWING_ERA_DISCRIMINATOR_FIELDS = Object.freeze([
  'machine.id',
  'machine.archetype',
  'machine.dosingKind',
  'machine.groupCount',
  'machine.hasEspressoGroup',
  'machine.hasTouchPanel',
  'materialSetId',
  'paletteName',
] as const);

/** Fields two eras agree on (empty means the eras are fully distinct). */
export function brewingEraConflicts(a: BrewingSpec, b: BrewingSpec): readonly string[] {
  return BREWING_ERA_DISCRIMINATOR_FIELDS.filter((field) => {
    const [head, tail] = field.split('.');
    if (head === 'machine' && tail) {
      const left = a.machine as unknown as Record<string, unknown>;
      const right = b.machine as unknown as Record<string, unknown>;
      return left[tail] === right[tail];
    }
    const left = a as unknown as Record<string, unknown>;
    const right = b as unknown as Record<string, unknown>;
    return left[field] === right[field];
  });
}

/** Diagnostics-friendly summary of one era's brewing data. */
export interface BrewingSpecSummary {
  readonly year: YearId;
  readonly machineId: string;
  readonly archetype: MachineArchetypeKind;
  readonly machineLabel: string;
  readonly accessoryKinds: readonly AccessoryKind[];
  readonly accessoryIds: readonly string[];
  readonly engraving: string;
  readonly surfaceCount: number;
  readonly surfaceSignature: string;
}

/** Packs one era spec into a compact record for tests, HUD and logs. */
export function describeBrewingSpec(spec: BrewingSpec): BrewingSpecSummary {
  return {
    year: spec.year,
    machineId: spec.machine.id,
    archetype: spec.machine.archetype,
    machineLabel: spec.machine.label,
    accessoryKinds: Object.freeze(spec.accessories.map((accessory) => accessory.kind)),
    accessoryIds: Object.freeze(spec.accessories.map((accessory) => accessory.id)),
    engraving: `${spec.machine.brand} ${spec.machine.model}`,
    surfaceCount: spec.surfaces.length,
    surfaceSignature: `${spec.materialSetId}:${machineMaterialSignature(spec.surfaces)}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Machine-SFX cues                                                           */
/* -------------------------------------------------------------------------- */

/** The interactions the bar exposes to the scene/HUD. */
export type MachineInteractionKind =
  | 'pull-shot'
  | 'purge-steam'
  | 'run-grinder'
  | 'cup-clatter'
  | 'milk-knock';

export const MACHINE_INTERACTIONS: readonly MachineInteractionKind[] = Object.freeze([
  'pull-shot',
  'purge-steam',
  'run-grinder',
  'cup-clatter',
  'milk-knock',
]);

/** Short cue ids the module reports for each interaction. */
export type MachineCueId = 'shot' | 'steam' | 'grind' | 'cup-clatter' | 'milk-knock';

/** Interaction → cue id (module vocabulary) and engine one-shot (audio bus). */
export const MACHINE_CUES: Readonly<
  Record<MachineInteractionKind, { readonly cue: MachineCueId; readonly kind: MachineSfxKind }>
> = Object.freeze({
  'pull-shot': { cue: 'shot', kind: 'extraction' },
  'purge-steam': { cue: 'steam', kind: 'steamPurge' },
  'run-grinder': { cue: 'grind', kind: 'grinder' },
  'cup-clatter': { cue: 'cup-clatter', kind: 'cupClatter' },
  'milk-knock': { cue: 'milk-knock', kind: 'milkKnock' },
});

/**
 * The slice of the café audio engine this module consumes. The real
 * {@link CafeAudioEngine} satisfies it structurally; tests inject a recording
 * stand-in. Crucially it is *injected*: the module never creates a context.
 */
export interface MachineAudioPort {
  /** Engine state, when the handle publishes one (`'locked' | 'running' | ...`). */
  readonly state?: string;
  /** Fires one parameterised machine one-shot on the machine-SFX bus. */
  triggerMachine(kind: MachineSfxKind, options?: MachineTriggerOptions): MachineTriggerRecord;
  /** Optional subscription used to mirror externally fired one-shots visually. */
  onMachineTrigger?(listener: (record: MachineTriggerRecord) => void): () => void;
}

/** Runtime guard for an injected audio handle. */
export function isMachineAudioPort(value: unknown): value is MachineAudioPort {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['triggerMachine'] === 'function';
}

/**
 * One recorded cue. `emitted` is false when the engine was locked, no character
 * was applied yet, or no handle was injected — the interaction still happened
 * visually, it was simply silent.
 */
export interface MachineCueRecord {
  readonly cue: MachineCueId;
  readonly interaction: MachineInteractionKind;
  readonly kind: MachineSfxKind;
  readonly year: YearId;
  readonly machineId: string;
  /** Seconds on the module's own clock when the interaction fired. */
  readonly at: number;
  readonly emitted: boolean;
  /** Why the cue was silent, when it was. */
  readonly reason: string | null;
  /** The engine's own record for the one-shot, when it fired. */
  readonly trigger: MachineTriggerRecord | null;
  /** Surface the interaction came from (`'group-1'`, `'steam-wand'`, ...). */
  readonly source: string;
}

const CUE_LOG_LIMIT = 64;

/** Options accepted by {@link BrewingModule.interact}. */
export interface MachineInteractionOptions extends MachineTriggerOptions {
  /** Overrides the reported source (`'group-2'`). */
  readonly source?: string;
}

/* -------------------------------------------------------------------------- */
/* Module options and diagnostics                                             */
/* -------------------------------------------------------------------------- */

export interface BrewingModuleOptions {
  /** Structural anchor set; defaults to {@link STRUCTURAL_LAYOUT}. */
  readonly layout?: StructuralLayout;
  /** Interior volume; defaults to {@link CAFE_ROOM_BOUNDS}. */
  readonly bounds?: RoomBounds;
  /** Injected machine-SFX handle; `BuildContext.services.audio` is the fallback. */
  readonly audio?: MachineAudioPort | null;
  /** Canvas factory for the procedural finishes (defaults to the DOM canvas). */
  readonly canvasFactory?: CanvasFactory;
  /** Texture resolution override for every procedural finish. */
  readonly textureSize?: number;
  /** Placement seed; defaults to a fixed module seed. */
  readonly seed?: number;
  /** Era reported by `getHotspots` before the first build. */
  readonly initialYear?: YearId;
}

/** Diagnostics snapshot of the module for one moment in the timeline. */
export interface BrewingModuleDescription {
  readonly moduleId: string;
  readonly year: YearId;
  readonly built: boolean;
  readonly machineId: string | null;
  readonly machineArchetype: MachineArchetypeKind | null;
  readonly accessoryIds: readonly string[];
  readonly surfaceIds: readonly string[];
  readonly textureCount: number;
  readonly materialCount: number;
  readonly nodeCount: number;
  readonly hotspotIds: readonly string[];
  readonly cueCount: number;
  readonly cueIds: readonly MachineCueId[];
  readonly interactions: Readonly<Record<MachineInteractionKind, number>>;
  readonly audioConnected: boolean;
  readonly audioSubscriptions: number;
  readonly audioReactions: number;
  readonly placementProblems: readonly string[];
  readonly signature: string | null;
}

const DEFAULT_MODULE_SEED = 0x6d6163;

/* -------------------------------------------------------------------------- */
/* Runtime effect rig                                                         */
/* -------------------------------------------------------------------------- */

interface ActiveEffect {
  readonly interaction: MachineInteractionKind;
  readonly startedAt: number;
  readonly duration: number;
}

const EFFECT_SECONDS: Readonly<Record<MachineInteractionKind, number>> = Object.freeze({
  'pull-shot': 2.2,
  'purge-steam': 1.4,
  'run-grinder': 1.8,
  'cup-clatter': 0.9,
  'milk-knock': 0.6,
});

interface MachineRig {
  readonly machine: MachineBuild;
  readonly accessories: readonly AccessoryBuild[];
  readonly plumes: readonly THREE.Mesh[];
  readonly drips: readonly THREE.Mesh[];
  readonly jiggles: readonly THREE.Object3D[];
  readonly needles: readonly THREE.Object3D[];
  readonly lamps: readonly { readonly material: THREE.MeshStandardMaterial; readonly base: number }[];
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The café's brewing equipment: one module, five eras, one injected sound bus.
 */
export class BrewingModule implements SceneModule<BrewingSpec> {
  readonly id = BREWING_MODULE_ID;

  private readonly layout: StructuralLayout;
  private readonly bounds: RoomBounds;
  private readonly canvasFactory: CanvasFactory | undefined;
  private readonly textureSize: number | undefined;
  private readonly seed: number;
  private readonly injectedAudio: MachineAudioPort | null;

  private rootValue: THREE.Group | null = null;
  private contentValue: THREE.Group | null = null;
  private materialsValue: MachineMaterialSet | null = null;
  private rigValue: MachineRig | null = null;
  private planValue: readonly MachinePlanEntry[] = [];
  private accessoryPlanValue: readonly AccessoryPlanEntry[] = [];
  private specValue: BrewingSpec | null = null;
  private yearValue: YearId;

  private audioPort: MachineAudioPort | null = null;
  private audioOff: Unsubscribe | null = null;
  private audioSubscriptions = 0;
  private audioReactions = 0;
  private lastSelfTrigger: MachineTriggerRecord | null = null;

  private clock = 0;
  private updates = 0;
  private effects: ActiveEffect[] = [];
  private readonly cueLog: MachineCueRecord[] = [];
  private readonly interactionCounts: Record<MachineInteractionKind, number> = {
    'pull-shot': 0,
    'purge-steam': 0,
    'run-grinder': 0,
    'cup-clatter': 0,
    'milk-knock': 0,
  };
  private hotspotsValue: readonly Hotspot[] = [];
  private disposed = false;

  constructor(options: BrewingModuleOptions = {}) {
    this.layout = options.layout ?? STRUCTURAL_LAYOUT;
    this.bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
    this.canvasFactory = options.canvasFactory;
    this.textureSize = options.textureSize;
    this.seed = options.seed ?? DEFAULT_MODULE_SEED;
    this.injectedAudio = options.audio ?? null;
    this.yearValue = options.initialYear ?? DEFAULT_YEAR_ID;
  }

  /* -- SceneModule surface -------------------------------------------------- */

  /** Era data currently shown (undefined before the first build). */
  get spec(): BrewingSpec | undefined {
    return this.specValue ?? undefined;
  }

  /** Node the module owns, once {@link BrewingModule.build} has run. */
  get root(): THREE.Object3D | undefined {
    return this.rootValue ?? undefined;
  }

  /** The material set of the era on screen (diagnostics and tests). */
  get materials(): MachineMaterialSet | null {
    return this.materialsValue;
  }

  /** The structural anchors the bar was placed on. */
  get structuralLayout(): StructuralLayout {
    return this.layout;
  }

  /** The primary machine's plan entry for the era on screen. */
  get machinePlan(): MachinePlanEntry | null {
    return this.planValue[0] ?? null;
  }

  /** The supporting equipment plan for the era on screen. */
  get accessoryPlan(): readonly AccessoryPlanEntry[] {
    return this.accessoryPlanValue;
  }

  /** The engine handle this module is currently driving, if any. */
  get audio(): MachineAudioPort | null {
    return this.audioPort;
  }

  /** True once the module is disposed (build() may be called again to revive it). */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Seconds simulated by {@link BrewingModule.update}. */
  get elapsedSeconds(): number {
    return this.clock;
  }

  build(context: BuildContext): void {
    this.disposed = false;
    this.yearValue = context.year;
    this.specValue = brewingSpec(context.year);
    this.audioPort = this.resolveAudio(context);

    if (this.rootValue === null) {
      const group = new THREE.Group();
      group.name = MACHINES_GROUP_NAME;
      group.userData['moduleId'] = this.id;
      this.rootValue = group;
    }
    if (this.rootValue.parent !== context.root) {
      context.root.add(this.rootValue);
    }
    this.buildContent(context);
    this.subscribeAudio();
  }

  applyPeriod(period: PeriodDefinition, context: BuildContext): void {
    const next = brewingSpec(period.year);
    this.yearValue = period.year;
    this.specValue = next;
    this.audioPort = this.resolveAudio(context);

    if (this.rootValue === null || this.contentValue === null) {
      this.build(context);
      return;
    }
    // Machines are period specific: release the old bar before raising the new.
    this.releaseContent();
    if (this.rootValue.parent !== context.root) {
      context.root.add(this.rootValue);
    }
    this.buildContent(context);
    this.subscribeAudio();
  }

  update(deltaSeconds: number, context: UpdateContext): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    if (context.year !== this.yearValue && this.specValue !== null) {
      // The kernel moved the era without a rebuild; keep the data in step.
      this.yearValue = context.year;
    }
    this.clock += delta;
    this.updates += 1;
    const rig = this.rigValue;
    if (rig === null) return;

    // Retire finished effects.
    if (this.effects.length > 0) {
      this.effects = this.effects.filter(
        (effect) => this.clock - effect.startedAt < effect.duration,
      );
    }
    const active = new Map<MachineInteractionKind, number>();
    for (const effect of this.effects) {
      const progress = Math.min(Math.max((this.clock - effect.startedAt) / effect.duration, 0), 1);
      active.set(effect.interaction, Math.max(active.get(effect.interaction) ?? 0, progress));
    }

    // Pilot lamps breathe; gauges tremble at a beat of their own.
    const breath = 0.86 + 0.14 * Math.sin(this.clock * 2.4);
    for (const lamp of rig.lamps) {
      lamp.material.emissiveIntensity = lamp.base * (this.effects.length > 0 ? breath + 0.35 : breath);
    }
    const needleTremble = this.effects.some((effect) => effect.interaction === 'pull-shot') ? 1 : 0;
    rig.needles.forEach((needle, index) => {
      const beat = Math.sin(this.clock * 5.2 + index * 1.3) * 0.02;
      const sweep = Math.sin(this.clock * 2.1 + index * 0.7) * 0.012 * (0.6 + needleTremble);
      needle.rotation.z = (needle.userData['baseRotationZ'] as number | undefined ?? 0) + beat + sweep;
    });

    // Steam plumes rise, spread and fade.
    const steam = active.get('purge-steam');
    rig.plumes.forEach((plume, index) => {
      const baseY = (plume.userData['baseY'] as number | undefined) ?? plume.position.y;
      if (steam === undefined) {
        plume.visible = false;
        plume.position.y = baseY;
        return;
      }
      const offset = (index % 3) * 0.08;
      const progress = Math.min(Math.max(steam - offset, 0), 1);
      plume.visible = progress < 0.98;
      plume.position.y = baseY + progress * 0.18;
      const scale = 0.6 + progress * 1.1;
      plume.scale.setScalar(scale);
      const material = plume.material as THREE.MeshStandardMaterial;
      material.opacity = 0.34 * (1 - progress);
    });

    // The extraction drips into the cup, thinning as the shot finishes.
    const shot = active.get('pull-shot');
    rig.drips.forEach((drip) => {
      const material = drip.material as THREE.MeshStandardMaterial;
      if (shot === undefined) {
        drip.visible = false;
        material.opacity = 0.5;
        return;
      }
      drip.visible = shot < 0.95;
      material.opacity = 0.5 * (1 - shot);
    });

    // Mechanical cues rattle their hardware while they run.
    const grind = active.get('run-grinder') ?? null;
    const clatter = active.get('cup-clatter') ?? null;
    const knock = active.get('milk-knock') ?? null;
    for (const node of rig.jiggles) {
      const tag = (node.userData['machineCue'] as string | undefined) ?? '';
      const progress =
        tag === 'grind' ? grind : tag === 'cup-clatter' ? clatter : tag === 'milk-knock' ? knock : null;
      const baseZ = (node.userData['baseRotationZ'] as number | undefined) ?? 0;
      if (progress === null || progress === undefined) {
        node.rotation.z = baseZ;
        continue;
      }
      const decay = 1 - progress;
      node.rotation.z = baseZ + Math.sin(this.clock * 46) * 0.05 * decay;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseContent();
    const root = this.rootValue;
    if (root) {
      disposeObject3D(root);
      this.rootValue = null;
    }
    this.hotspotsValue = [];
    this.disposed = true;
  }

  getHotspots(): readonly Hotspot[] {
    return this.hotspotsValue;
  }

  /* -- interactions --------------------------------------------------------- */

  /**
   * Fires one barista interaction: the audio cue goes to the injected
   * machine-SFX bus, the matching geometry reacts and the cue is recorded.
   */
  interact(
    interaction: MachineInteractionKind,
    options: MachineInteractionOptions = {},
  ): MachineCueRecord {
    const spec = this.specValue ?? brewingSpec(this.yearValue);
    const mapping = MACHINE_CUES[interaction];
    const source = options.source ?? defaultSource(interaction, spec);
    const record = this.emit(interaction, mapping.cue, mapping.kind, source, spec, options);
    this.interactionCounts[interaction] += 1;
    this.startEffect(interaction);
    return record;
  }

  /** Pulls a shot: espresso hiss / percolator bubble on the machine bus. */
  pullShot(options: MachineInteractionOptions = {}): MachineCueRecord {
    return this.interact('pull-shot', options);
  }

  /**
   * Purges the steam wand. Eras without a wand (1945's percolator urn) have no
   * steam to purge, so this is a documented no-op returning `null`.
   */
  purgeSteam(options: MachineInteractionOptions = {}): MachineCueRecord | null {
    const spec = this.specValue;
    if (spec !== null && !hasSteamWand(spec.machine)) return null;
    return this.interact('purge-steam', options);
  }

  /** Runs the era's grinder: burr and motor cue on the machine bus. */
  runGrinder(options: MachineInteractionOptions = {}): MachineCueRecord {
    return this.interact('run-grinder', options);
  }

  /** Sets cups down: clatter on the machine bus, cups and saucers rattling. */
  clatterCups(options: MachineInteractionOptions = {}): MachineCueRecord {
    return this.interact('cup-clatter', options);
  }

  /** Drops the milk pitcher on the counter: knock plus steam tail. */
  knockMilkPitcher(options: MachineInteractionOptions = {}): MachineCueRecord {
    return this.interact('milk-knock', options);
  }

  /** Every cue the module has fired, oldest first (bounded log). */
  getCueLog(): readonly MachineCueRecord[] {
    return Object.freeze([...this.cueLog]);
  }

  /** Cue ids seen since the last build/applyPeriod (chronological). */
  getCueIds(): readonly MachineCueId[] {
    return Object.freeze(this.cueLog.map((record) => record.cue));
  }

  /** How often each interaction has been fired since the last build. */
  getInteractionCounts(): Readonly<Record<MachineInteractionKind, number>> {
    return Object.freeze({ ...this.interactionCounts });
  }

  /** Dropping the log is the composition root's job between takes. */
  clearCueLog(): void {
    this.cueLog.length = 0;
  }

  /** Diagnostics snapshot of the module (used by the tests and the HUD). */
  describe(): BrewingModuleDescription {
    const rig = this.rigValue;
    return {
      moduleId: this.id,
      year: this.yearValue,
      built: rig !== null,
      machineId: rig?.machine.entry.id ?? null,
      machineArchetype: this.specValue?.machine.archetype ?? null,
      accessoryIds: Object.freeze(this.accessoryPlanValue.map((entry) => entry.id)),
      surfaceIds: this.materialsValue ? Object.freeze([...this.materialsValue.materials.keys()]) : Object.freeze([]),
      textureCount: this.materialsValue?.textures.length ?? 0,
      materialCount: this.materialsValue?.materials.size ?? 0,
      nodeCount: this.countNodes(),
      hotspotIds: Object.freeze(this.hotspotsValue.map((hotspot) => hotspot.id)),
      cueCount: this.cueLog.length,
      cueIds: Object.freeze(this.cueLog.map((record) => record.cue)),
      interactions: Object.freeze({ ...this.interactionCounts }),
      audioConnected: this.audioPort !== null,
      audioSubscriptions: this.audioSubscriptions,
      audioReactions: this.audioReactions,
      placementProblems: this.placementProblems(),
      signature: this.materialsValue?.signature ?? null,
    };
  }

  /** Live node count of the module's own group (0 before build/after dispose). */
  countNodes(): number {
    const root = this.rootValue;
    if (root === null) return 0;
    let count = 0;
    root.traverse(() => {
      count += 1;
    });
    return count;
  }

  /** Placement rule violations for the era on screen (empty means sound). */
  placementProblems(): readonly string[] {
    const problems: string[] = [];
    problems.push(...placementProblems(this.planValue, this.accessoryPlanValue, this.layout, this.bounds));
    return Object.freeze(problems);
  }

  /* -- internals ------------------------------------------------------------ */

  private resolveAudio(context: BuildContext): MachineAudioPort | null {
    const service = context.services?.['audio'];
    if (isMachineAudioPort(service)) return service;
    return this.injectedAudio;
  }

  private seedFor(year: YearId): () => number {
    return createSeededRandom((this.seed ^ hashString(`${year}:${this.specValue?.materialSetId ?? ''}`)) >>> 0);
  }

  private buildContent(context: BuildContext): void {
    const spec = this.specValue;
    const root = this.rootValue;
    if (spec === null || root === null) return;

    const materials = createMachineMaterialSet({
      id: spec.materialSetId,
      year: spec.year,
      recipes: spec.surfaces,
      canvasFactory: this.canvasFactory,
      textureSize: this.textureSize,
    });
    this.materialsValue = materials;

    const random = this.seedFor(spec.year);
    const plan = planMachines({
      spec: spec.machine,
      layout: this.layout,
      bounds: this.bounds,
      year: spec.year,
    });
    this.planValue = plan.entries;

    const machineBuilds = plan.entries.map((entry) =>
      buildMachine(entry, spec.machine, { materials, year: spec.year, random }),
    );
    const accessoryPlan = planAccessories({
      spec,
      layout: this.layout,
      bounds: this.bounds,
      machinePlan: plan,
      random,
    });
    this.accessoryPlanValue = accessoryPlan.entries;
    const accessoryBuilds = accessoryPlan.entries.map((entry) =>
      buildAccessory(entry, { materials, year: spec.year, random }),
    );

    const content = new THREE.Group();
    content.name = `${MACHINE_NODE_PREFIX}${spec.year}`;
    content.userData['moduleId'] = this.id;
    for (const build of machineBuilds) content.add(build.group);
    for (const build of accessoryBuilds) content.add(build.group);
    root.add(content);
    this.contentValue = content;

    this.rigValue = this.createRig(machineBuilds, accessoryBuilds, materials);
    this.hotspotsValue = Object.freeze(this.buildHotspots(spec, machineBuilds, accessoryBuilds));
  }

  private createRig(
    machineBuilds: readonly MachineBuild[],
    accessoryBuilds: readonly AccessoryBuild[],
    materials: MachineMaterialSet,
  ): MachineRig {
    const machine = machineBuilds[0];
    if (!machine) throw new Error('The brewing module built no primary machine.');
    const lamps: { material: THREE.MeshStandardMaterial; base: number }[] = [];
    const seen = new Set<string>();
    for (const lamp of this.specValue?.machine.lamps ?? []) {
      if (seen.has(lamp.slot)) continue;
      if (!materials.materials.has(lamp.slot)) continue;
      seen.add(lamp.slot);
      const material = machineSurface(materials, lamp.slot);
      lamps.push({ material, base: material.emissiveIntensity });
    }
    return {
      machine,
      accessories: accessoryBuilds,
      plumes: machine.steamPlumes,
      drips: machine.drips,
      jiggles: [...machine.jiggles, ...accessoryBuilds.flatMap((build) => build.jiggles)],
      needles: machine.needles,
      lamps,
    };
  }

  private buildHotspots(
    spec: BrewingSpec,
    machineBuilds: readonly MachineBuild[],
    accessoryBuilds: readonly AccessoryBuild[],
  ): Hotspot[] {
    const hotspots: Hotspot[] = [];
    const machine = machineBuilds[0];
    if (machine) {
      const entry = machine.entry;
      const half = entry.dimensions.height / 2;
      hotspots.push({
        id: `hotspot:machines:${spec.year}:machine`,
        label: spec.machine.label,
        description: spec.machine.summary,
        position: new THREE.Vector3(entry.position.x, entry.position.y + half, entry.position.z),
        radius: Math.max(entry.dimensions.width, entry.dimensions.height) * 0.55,
        year: spec.year,
        moduleId: this.id,
        kind: 'interactive',
        anchor: machine.group,
      });
      if (hasSteamWand(spec.machine)) {
        hotspots.push({
          id: `hotspot:machines:${spec.year}:steam-wand`,
          label: 'Steam wand',
          description: spec.machine.steam.detail,
          position: new THREE.Vector3(
            entry.position.x + entry.dimensions.width * 0.32,
            entry.position.y + entry.dimensions.height * 0.45,
            entry.position.z + entry.dimensions.depth * 0.35,
          ),
          radius: 0.24,
          year: spec.year,
          moduleId: this.id,
          kind: 'interactive',
        });
      }
      if (spec.machine.hasTouchPanel) {
        hotspots.push({
          id: `hotspot:machines:${spec.year}:touch-panel`,
          label: 'Touch panel',
          description: spec.machine.dosingDetail,
          position: new THREE.Vector3(
            entry.position.x - entry.dimensions.width * 0.32,
            entry.position.y + entry.dimensions.height * 0.72,
            entry.position.z + entry.dimensions.depth * 0.5,
          ),
          radius: 0.22,
          year: spec.year,
          moduleId: this.id,
          kind: 'interactive',
        });
      }
    }
    for (const build of accessoryBuilds) {
      const entry = build.entry;
      hotspots.push({
        id: `hotspot:machines:${spec.year}:${entry.kind}`,
        label: entry.label,
        description: entry.spec.detail.join(' '),
        position: new THREE.Vector3(
          entry.position.x,
          entry.position.y + entry.dimensions.height / 2,
          entry.position.z,
        ),
        radius: Math.max(entry.dimensions.width, entry.dimensions.height) * 0.6,
        year: spec.year,
        moduleId: this.id,
        kind: entry.kind === 'grinder' || entry.kind === 'knock-box' ? 'interactive' : 'info',
        anchor: build.group,
      });
    }
    return hotspots;
  }

  private emit(
    interaction: MachineInteractionKind,
    cue: MachineCueId,
    kind: MachineSfxKind,
    source: string,
    spec: BrewingSpec,
    options: MachineInteractionOptions,
  ): MachineCueRecord {
    let trigger: MachineTriggerRecord | null = null;
    let emitted = false;
    let reason: string | null = null;
    const port = this.audioPort;
    if (port === null) {
      reason = 'no audio handle injected';
    } else {
      const { source: _ignored, ...triggerOptions } = options;
      try {
        trigger = port.triggerMachine(kind, triggerOptions);
        emitted = true;
        this.lastSelfTrigger = trigger;
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    }
    const record: MachineCueRecord = {
      cue,
      interaction,
      kind,
      year: spec.year,
      machineId: spec.machine.id,
      at: this.clock,
      emitted,
      reason,
      trigger,
      source,
    };
    this.cueLog.push(record);
    if (this.cueLog.length > CUE_LOG_LIMIT) this.cueLog.splice(0, this.cueLog.length - CUE_LOG_LIMIT);
    return record;
  }

  private startEffect(interaction: MachineInteractionKind): void {
    this.effects = this.effects.filter((effect) => effect.interaction !== interaction);
    this.effects.push({
      interaction,
      startedAt: this.clock,
      duration: EFFECT_SECONDS[interaction],
    });
  }

  private subscribeAudio(): void {
    const port = this.audioPort;
    if (port === null || port.onMachineTrigger === undefined) return;
    if (this.audioOff !== null) return;
    const listener = (record: MachineTriggerRecord): void => {
      // One-shots this module fired already animate their own hardware.
      if (record === this.lastSelfTrigger) return;
      this.audioReactions += 1;
      const interaction = interactionForKind(record.kind);
      if (interaction !== null) this.startEffect(interaction);
    };
    const off = port.onMachineTrigger(listener);
    this.audioSubscriptions += 1;
    this.audioOff = () => {
      off();
      this.audioSubscriptions = Math.max(this.audioSubscriptions - 1, 0);
    };
  }

  private unsubscribeAudio(): void {
    const off = this.audioOff;
    this.audioOff = null;
    if (off !== null) off();
  }

  private releaseContent(): void {
    this.unsubscribeAudio();
    const content = this.contentValue;
    if (content !== null) {
      disposeObject3D(content);
      this.contentValue = null;
    }
    if (this.materialsValue !== null) {
      disposeMachineMaterialSet(this.materialsValue);
      this.materialsValue = null;
    }
    this.rigValue = null;
    this.planValue = [];
    this.accessoryPlanValue = [];
    this.effects = [];
    this.hotspotsValue = [];
    this.lastSelfTrigger = null;
  }
}

/** Builds the brewing module (the composition root's factory). */
export function createBrewingModule(options: BrewingModuleOptions = {}): BrewingModule {
  return new BrewingModule(options);
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function defaultSource(interaction: MachineInteractionKind, spec: BrewingSpec): string {
  switch (interaction) {
    case 'pull-shot':
      return spec.machine.groupCount > 0 ? 'group-1' : 'percolator-basket';
    case 'purge-steam':
      return 'steam-wand';
    case 'run-grinder':
      return 'grinder';
    case 'cup-clatter':
      return 'cup-rail';
    case 'milk-knock':
    default:
      return 'milk-pitcher';
  }
}

/** Maps an engine one-shot kind back to the interaction that produces it. */
export function interactionForKind(kind: MachineSfxKind): MachineInteractionKind | null {
  const entry = MACHINE_INTERACTIONS.find((interaction) => MACHINE_CUES[interaction].kind === kind);
  return entry ?? null;
}

/** Node-name namespace of one machine (`machines:1965:lever-espresso:...`). */
export function machineNodeName(year: YearId, slug: string, part: string): string {
  return `${MACHINE_NODE_PREFIX}${year}:${slug}:${part}`;
}

/** Node-name namespace of one accessory (`machines:1985:knock-box:...`). */
export function accessoryNodeName(year: YearId, slug: string, part: string): string {
  return `${ACCESSORY_NODE_PREFIX}${year}:${slug}:${part}`;
}
