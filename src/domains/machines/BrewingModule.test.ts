/**
 * Brewing domain suite (headless, node).
 *
 * The bar must be real in a GPU-free process: the kernel boots headless, the
 * module builds, moves through all five eras and disposes, while the tests assert
 * the actual integrated behaviour:
 *
 *  - one era-exact primary brewing machine per year — 1945 enamelled percolator
 *    urn with a hand-crank wall grinder and no espresso group at all, 1965 lever
 *    espresso machine with two steam wands, 1985 semi-automatic group machine
 *    with a knock box, 2005 super-automatic with digital dosing and a backlit LCD,
 *    2025 three-group machine with a glass touch panel — recorded as an inventory
 *    snapshot per era,
 *  - the supporting equipment checklist (kettles, filter brewers, grinders, milk
 *    pitchers, tampers, scales and cup stacks), with the era-only accessories —
 *    the manual wall grinder in 1945, the knock box in 1985, the scale and cup
 *    stacks in 2005/2025 — present only in their own era,
 *  - machine-SFX cues fired at the *injected* machine bus on the right
 *    interactions (`shot`, `steam`, `grind`, `cup-clatter`, `milk-knock`) and
 *    routed nowhere else: the module never builds an `AudioContext`, and it stays
 *    silent-but-alive while the engine is still locked,
 *  - procedural surfaces only: canvas where a canvas exists, data textures in
 *    node, deterministic bytes, no fetched assets, and lettering genuinely
 *    painted onto legends, dial cards, LCD readouts and touch panels,
 *  - placement derived from the environment's `RoomBounds` and structural layout:
 *    every machine and accessory inside the room, on the counter, clear of the
 *    barista's service lane and of each other,
 *  - `applyPeriod` rebuilding the bar for the new era with nothing of the
 *    previous era left behind, and `update` running the machines (needles,
 *    lamps, plumes, drips, rattling hardware),
 *  - `dispose` releasing every geometry, material and texture, unsubscribing the
 *    machine-SFX listener and leaving no surviving node, timer or DOM listener,
 *  - `getHotspots` exposing the era's machine, wands, equipment and touch panel.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { build as viteBuild } from 'vite';
import {
  YEAR_IDS,
  isSceneModule,
  type BuildContext,
  type PeriodDefinition,
  type YearId,
} from '../../contracts/period';
import { createKernel, createManualFrameScheduler, type Kernel } from '../../core/kernel';
import {
  createAudioEngine,
  isCafeAudioEngine,
  type CafeAudioEngine,
  type MachineSfxKind,
  type MachineTriggerOptions,
  type MachineTriggerRecord,
} from '../../audio';
import { ERA_MUSIC_MIXES } from '../music/MusicSourceModule';
import {
  CAFE_ROOM_BOUNDS,
  STRUCTURAL_LAYOUT,
  counterRect,
  createEnvironmentModule,
  environmentSpec,
  serviceLaneRect,
} from '../environment';
import { createFakeAudioContextFactory } from '../../../tests/audio/fakeAudioContext';
import {
  ACCESSORY_KINDS,
  BREWING_ERA_DISCRIMINATOR_FIELDS,
  BREWING_MODULE_ID,
  BREWING_SPECS,
  MACHINE_ARCHETYPE_KINDS,
  MACHINE_CUES,
  MACHINE_INTERACTIONS,
  MACHINES_GROUP_NAME,
  brewingEraConflicts,
  brewingSpec,
  brewingSpecs,
  createBrewingModule,
  describeBrewingSpec,
  interactionForKind,
  isMachineAudioPort,
  type AccessoryKind,
  type BrewingModule,
  type MachineAudioPort,
  type MachineCueId,
} from './BrewingModule';
import {
  DEFAULT_MACHINE_TEXTURE_SIZE,
  MACHINE_TEXTURE_PREFIX,
  createMachineMaterialSet,
  createMachineTexture,
  distinctPixelColors,
  machineSurface,
  machineSurfaceIds,
  paintMachineSurface,
} from './textures';
import { MACHINE_NODE_PREFIX, hasSteamWand, machineFootprint } from './build/machines';
import { ACCESSORY_NODE_PREFIX } from './build/accessories';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function headlessKernel(): Kernel {
  const kernel = createKernel(null, {
    forceHeadless: true,
    autoResize: false,
    resizeTarget: null,
    scheduler: createManualFrameScheduler(),
    bounds: CAFE_ROOM_BOUNDS,
  });
  openKernels.push(kernel);
  return kernel;
}

function countNodes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => {
    count += 1;
  });
  return count;
}

/**
 * Era fixture for the build context. The period registry (a later task) owns the
 * real `PeriodDefinition`s; this fixture derives one from the shell's era data so
 * the suite exercises the contract with era-correct colours.
 */
function periodFor(year: YearId): PeriodDefinition {
  const spec = environmentSpec(year);
  return {
    year,
    label: spec.label,
    name: spec.name,
    summary: spec.summary,
    palette: {
      background: spec.paint.trimBase,
      floor: spec.floor.palette.base,
      wall: spec.paint.wallBase,
      ceiling: spec.ceiling.finish.palette.base,
      accent: spec.accentColor,
      lamp: spec.signage.lampColor,
    },
    lighting: {
      ambientColor: spec.lightBounce.wall,
      ambientIntensity: 0.5,
      keyColor: spec.lightBounce.ceiling,
      keyIntensity: 1.4,
      fillColor: spec.lightBounce.wall,
      fillIntensity: 0.35,
      lampColor: spec.signage.lampColor,
      lampIntensity: 20,
      fogDensity: 0,
    },
    details: spec.tags,
  };
}

/**
 * Builds the module for `year`: `build` on the first era, `applyPeriod` after it,
 * with the injected machine-SFX handle in `BuildContext.services.audio` exactly as
 * the composition root supplies it. The engine's era mix is applied when given.
 */
function applyYear(
  kernel: Kernel,
  module: BrewingModule,
  year: YearId,
  audio: { readonly engine?: CafeAudioEngine; readonly port?: MachineAudioPort } = {},
): BuildContext {
  const period = periodFor(year);
  kernel.setYear(year);
  const context = kernel.createBuildContext(period, audio.port ? { services: { audio: audio.port } } : {});
  if (module.spec === undefined) module.build(context);
  else module.applyPeriod(period, context);
  audio.engine?.applyMix(ERA_MUSIC_MIXES[year]);
  return context;
}

function nodeNames(root: THREE.Object3D, contains = ''): string[] {
  const names: string[] = [];
  root.traverse((object) => {
    if (object.name.length > 0 && object.name.includes(contains)) names.push(object.name);
  });
  return names;
}

function moduleNodeNames(module: BrewingModule): string[] {
  const root = module.root;
  return root ? nodeNames(root) : [];
}

interface CollectedResources {
  readonly geometries: Set<THREE.BufferGeometry>;
  readonly materials: Set<THREE.Material>;
  readonly textures: Set<THREE.Texture>;
}

function collectResources(root: THREE.Object3D): CollectedResources {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    const material = renderable.material;
    if (Array.isArray(material)) for (const entry of material) materials.add(entry);
    else if (material) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }
  return { geometries, materials, textures };
}

/** Surface ids actually attached to a mesh in `root` (proves no dead recipes). */
function usedSurfaceIds(root: THREE.Object3D): Set<string> {
  const ids = new Set<string>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const material = mesh.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const entry of list) {
      const parts = entry.name.split(':');
      if (parts.length < 3 || parts[0] !== 'machine') continue;
      ids.add(parts[parts.length - 1] ?? '');
    }
  });
  return ids;
}

/** Recording audio handle: proves every cue goes through the injected bus. */
interface RecordingPort extends MachineAudioPort {
  readonly calls: { readonly kind: MachineSfxKind; readonly options: MachineTriggerOptions | undefined }[];
  readonly counters: () => { readonly subscriptions: number; readonly unsubscriptions: number };
}

function recordingPort(engine: CafeAudioEngine): RecordingPort {
  const calls: { kind: MachineSfxKind; options: MachineTriggerOptions | undefined }[] = [];
  let subscriptions = 0;
  let unsubscriptions = 0;
  return {
    get state() {
      return engine.state;
    },
    calls,
    counters: () => ({ subscriptions, unsubscriptions }),
    triggerMachine(kind: MachineSfxKind, options?: MachineTriggerOptions): MachineTriggerRecord {
      calls.push({ kind, options });
      return engine.triggerMachine(kind, options);
    },
    onMachineTrigger(listener) {
      subscriptions += 1;
      const off = engine.onMachineTrigger(listener);
      return () => {
        unsubscriptions += 1;
        off();
      };
    },
  };
}

function accessoryKinds(module: BrewingModule): AccessoryKind[] {
  return module.accessoryPlan.map((entry) => entry.kind);
}

const CUES_FOR_ALL_INTERACTIONS: Readonly<Record<string, MachineCueId>> = Object.freeze({
  'pull-shot': 'shot',
  'purge-steam': 'steam',
  'run-grinder': 'grind',
  'cup-clatter': 'cup-clatter',
  'milk-knock': 'milk-knock',
});

/* -------------------------------------------------------------------------- */
/* Composition: kernel + environment + injected audio engine                  */
/* -------------------------------------------------------------------------- */

describe('composing the brewing domain with the kernel and the audio engine', () => {
  it('builds the bar for all five eras and fires a machine-SFX cue on the injected bus', async () => {
    const kernel = headlessKernel();
    const { factory, contexts } = createFakeAudioContextFactory();
    const engine = createAudioEngine({ contextFactory: factory, seed: 20250915 });
    expect(isCafeAudioEngine(engine)).toBe(true);
    const environment = createEnvironmentModule();
    const first = periodFor('1945');
    environment.build(kernel.createBuildContext(first));
    const roomNodes = countNodes(kernel.world);

    const module = createBrewingModule({ seed: 20250915 });
    expect(isSceneModule(module)).toBe(true);
    expect(module.id).toBe(BREWING_MODULE_ID);
    module.build(kernel.createBuildContext(first, { services: { audio: engine } }));
    expect(module.audio).toBe(engine);
    expect(module.root?.name).toBe(MACHINES_GROUP_NAME);

    // Locked engine: the interaction happens, the cue is silent, nothing throws.
    const silent = module.pullShot();
    expect(silent.emitted).toBe(false);
    expect(silent.reason).toMatch(/locked/i);
    expect(engine.state).toBe('locked');
    expect(contexts).toHaveLength(0);

    const gesture = await engine.unlock();
    expect(gesture).toBe('running');
    expect(contexts).toHaveLength(1);

    for (const year of YEAR_IDS) {
      const context = applyYear(kernel, module, year, { engine, port: engine });
      const spec = brewingSpec(year);
      expect(module.spec?.year).toBe(year);
      expect(module.machinePlan?.id).toBe(spec.machine.id);
      expect(kernel.bounds).toEqual(CAFE_ROOM_BOUNDS);

      engine.clearEventLog();
      module.clearCueLog();
      const record = module.pullShot();
      expect(record.emitted).toBe(true);
      expect(record.cue).toBe('shot');
      expect(record.kind).toBe('extraction');
      expect(record.year).toBe(year);
      expect(record.trigger).not.toBeNull();
      const events = engine.getEventLog().filter((event) => event.kind === 'machine-trigger');
      expect(events).toHaveLength(1);
      expect(events[0]?.id).toBe('extraction');
      expect(events[0]?.year).toBe(year);
      expect(engine.getMixState().machineCharacterId).toBe(`music-machine-${year}`);
      expect(engine.getMachineSfx()?.triggerCount).toBeGreaterThan(0);

      // The module is registered on the machine bus: externally fired one-shots
      // animate the same hardware.
      const reactionsBefore = module.describe().audioReactions;
      engine.triggerMachine('cupClatter');
      expect(module.describe().audioReactions).toBeGreaterThan(reactionsBefore);

      module.update(1 / 60, { year, elapsedSeconds: 1, frame: 1 });
      expect(module.describe().placementProblems).toEqual([]);
      expect(module.getHotspots()[0]?.year).toBe(year);
      expect(context.year).toBe(year);
    }

    // The room survived every machine swap, and the module owns only its bar.
    expect(countNodes(kernel.world)).toBeGreaterThan(roomNodes);

    module.dispose();
    expect(module.root).toBeUndefined();
    expect(module.describe().built).toBe(false);
    expect(engine.isDisposed).toBe(false);
    environment.dispose();
    expect(kernel.world.children).toHaveLength(0);
    engine.dispose();
    expect(engine.isDisposed).toBe(true);
    kernel.dispose();
  });

  it('stays alive on a stale data year and keeps the module id stable', () => {
    const kernel = headlessKernel();
    const module = createBrewingModule({ initialYear: '2005' });
    applyYear(kernel, module, '1985');
    expect(module.spec?.year).toBe('1985');
    // `update` reports the year the kernel is on without rebuilding.
    module.update(0.5, { year: '1985', elapsedSeconds: 0.5, frame: 2 });
    expect(module.describe().year).toBe('1985');
    expect(module.id).toBe('machines');
    module.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Era inventory                                                              */
/* -------------------------------------------------------------------------- */

describe('era machine and equipment inventory', () => {
  it('resolves one era-exact machine per year and only that era\'s equipment', () => {
    const kernel = headlessKernel();
    const module = createBrewingModule();
    const snapshot: Record<string, string[]> = {};

    for (const year of YEAR_IDS) {
      applyYear(kernel, module, year);
      const spec = brewingSpec(year);
      const names = moduleNodeNames(module);
      snapshot[year] = names.filter((name) => name.includes(`:${year}:`));

      // Exactly one primary machine, and it is the era's machine.
      const machineRoots = names.filter((name) => name === spec.machine.id);
      expect(machineRoots).toHaveLength(1);
      expect(MACHINE_NODE_PREFIX).toBe(ACCESSORY_NODE_PREFIX);
      const owned = names.filter((name) => name !== MACHINES_GROUP_NAME);
      expect(owned.length).toBeGreaterThan(20);
      expect(owned.every((name) => name.startsWith(MACHINE_NODE_PREFIX))).toBe(true);

      // Exactly one primary machine node carries the machine id.
      let machineNodes = 0;
      module.root?.traverse((object) => {
        if (object.userData['machineId'] !== undefined) machineNodes += 1;
      });
      expect(machineNodes).toBe(1);

      // The equipment plan is the era's data, in order.
      expect(module.accessoryPlan.map((entry) => entry.id)).toEqual(spec.accessories.map((a) => a.id));
      expect(module.describe().accessoryIds).toEqual(spec.accessories.map((a) => a.id));

      // Every surface the era references exists in its material set.
      const surfaces = machineSurfaceIds(module.materials!);
      const housing = spec.machine.housing;
      const housingSurfaces = [
        housing.body,
        housing.front,
        housing.panel,
        housing.trim,
        housing.handle,
        housing.boiler,
        housing.pipe,
        housing.glass,
        housing.cup,
        housing.cheek,
        housing.display,
        housing.wearPatch,
      ];
      for (const id of housingSurfaces) expect(surfaces).toContain(id);
      for (const dial of spec.machine.dials) {
        expect(surfaces).toContain(dial.slot);
        expect(surfaces).toContain(dial.bezel);
      }
      for (const accessory of spec.accessories) {
        expect(surfaces).toContain(accessory.material);
        expect(surfaces).toContain(accessory.trim);
        if (accessory.secondary) expect(surfaces).toContain(accessory.secondary);
      }
      expect(module.describe().surfaceIds).toEqual(surfaces);
      expect(module.describe().signature).toContain(spec.materialSetId);

      // Every declared surface is on a mesh: no dead recipes in the era's data.
      const used = usedSurfaceIds(module.root!);
      const unused = surfaces.filter((id) => !used.has(id));
      expect({ year, unused }).toEqual({ year, unused: [] });
    }

    // Five distinct inventories; no era repeats another's equipment list.
    const inventories = YEAR_IDS.map((year) => snapshot[year]?.join('|') ?? '');
    expect(new Set(inventories).size).toBe(YEAR_IDS.length);

    module.dispose();
  });

  it('carries the era-specific machine hardware the acceptance criteria name', () => {
    const kernel = headlessKernel();
    const module = createBrewingModule();

    // 1945: percolator urn, no espresso group, no touch panel, manual grinder.
    applyYear(kernel, module, '1945');
    const spec1945 = brewingSpec('1945');
    expect(spec1945.machine.archetype).toBe('percolator');
    expect(spec1945.machine.hasEspressoGroup).toBe(false);
    expect(spec1945.machine.groupCount).toBe(0);
    expect(spec1945.machine.hasTouchPanel).toBe(false);
    expect(spec1945.machine.hasDigitalDisplay).toBe(false);
    expect(spec1945.machine.hasSteamWand).toBe(false);
    expect(hasSteamWand(spec1945.machine)).toBe(false);
    let names = moduleNodeNames(module);
    expect(names).toContain('machines:1945:percolator:urn-body');
    expect(names).toContain('machines:1945:percolator:spigot');
    expect(names.some((name) => name.includes('group-1'))).toBe(false);
    expect(names.some((name) => name.includes('touch-panel'))).toBe(false);
    expect(names.some((name) => name.includes('steam-wand'))).toBe(false);
    expect(names).toContain('machines:1945:grinder:wall-plate');
    expect(names).toContain('machines:1945:grinder:crank-arm');
    expect(module.purgeSteam()).toBeNull();

    // 1965: lever machine with two steam wands and printed gauge cards.
    applyYear(kernel, module, '1965');
    const spec1965 = brewingSpec('1965');
    expect(spec1965.machine.archetype).toBe('lever-espresso');
    expect(spec1965.machine.groupCount).toBe(1);
    expect(spec1965.machine.hasEspressoGroup).toBe(true);
    expect(spec1965.machine.steam.wandCount).toBe(2);
    names = moduleNodeNames(module);
    expect(names).toContain('machines:1965:lever-espresso:lever-arm');
    expect(names).toContain('machines:1965:lever-espresso:steam-wand-1-arm');
    expect(names).toContain('machines:1965:lever-espresso:steam-wand-2-arm');
    expect(names).toContain('machines:1965:lever-espresso:group-1-body');
    expect(names).toContain('machines:1965:lever-espresso:dial-boiler-face');
    expect(module.purgeSteam()?.cue).toBe('steam');

    // 1985: semi-automatic group machine with an integrated knock drawer and a
    // counter knock box.
    applyYear(kernel, module, '1985');
    const spec1985 = brewingSpec('1985');
    expect(spec1985.machine.archetype).toBe('semi-automatic');
    expect(spec1985.machine.knockBox).toBe(true);
    expect(spec1985.machine.dosingKind).toBe('volumetric-buttons');
    names = moduleNodeNames(module);
    expect(names).toContain('machines:1985:semi-automatic:knock-drawer');
    expect(names).toContain('machines:1985:semi-automatic:knock-bar');
    expect(names).toContain('machines:1985:semi-automatic:group-1-body');
    expect(names).toContain('machines:1985:knock-box:knock-bar');
    expect(names).toContain('machines:1985:semi-automatic:dose-button-1');

    // 2005: super-automatic with digital dosing, an LCD and a bean hopper.
    applyYear(kernel, module, '2005');
    const spec2005 = brewingSpec('2005');
    expect(spec2005.machine.archetype).toBe('super-automatic');
    expect(spec2005.machine.dosingKind).toBe('digital-dosing');
    expect(spec2005.machine.hasDigitalDisplay).toBe(true);
    expect(spec2005.machine.hasTouchPanel).toBe(false);
    names = moduleNodeNames(module);
    expect(names).toContain('machines:2005:super-automatic:lcd-screen');
    expect(names).toContain('machines:2005:super-automatic:bean-hopper');
    expect(names).toContain('machines:2005:super-automatic:group-2-body');
    expect(module.describe().surfaceIds).toContain('display-lcd');

    // 2025: multi-group machine with a glass touch panel.
    applyYear(kernel, module, '2025');
    const spec2025 = brewingSpec('2025');
    expect(spec2025.machine.archetype).toBe('multi-group');
    expect(spec2025.machine.groupCount).toBe(3);
    expect(spec2025.machine.dosingKind).toBe('touch-dosing');
    expect(spec2025.machine.hasTouchPanel).toBe(true);
    names = moduleNodeNames(module);
    expect(names).toContain('machines:2025:multi-group:touch-panel');
    expect(names).toContain('machines:2025:multi-group:group-3-body');
    expect(names).toContain('machines:2025:multi-group:granite-cheek-1');
    expect(names).toContain('machines:2025:multi-group:walnut-top');

    module.dispose();
  });

  it('places era-only accessories only in their own era', () => {
    const kernel = headlessKernel();
    const module = createBrewingModule();
    const byYear = new Map<YearId, AccessoryKind[]>();
    for (const year of YEAR_IDS) {
      applyYear(kernel, module, year);
      byYear.set(year, accessoryKinds(module));
    }
    const kindsOf = (year: YearId): readonly AccessoryKind[] => byYear.get(year) ?? [];

    // Every era stands on a kettle, a filter brewer, a grinder and a pitcher.
    for (const year of YEAR_IDS) {
      for (const kind of ['kettle', 'filter-brewer', 'grinder', 'milk-pitcher'] as const) {
        expect(kindsOf(year)).toContain(kind);
      }
      expect(kindsOf(year).every((kind) => ACCESSORY_KINDS.includes(kind))).toBe(true);
    }

    // 1945 grinds by hand: the mill hangs on the wall and no espresso-era
    // hardware exists yet.
    const manualGrinder = brewingSpec('1945').accessories.find((item) => item.kind === 'grinder');
    expect(manualGrinder?.mount).toBe('wall');
    expect(manualGrinder?.variant).toBe('wall-crank');
    expect(kindsOf('1945')).not.toContain('tamper');
    expect(kindsOf('1945')).not.toContain('knock-box');
    expect(kindsOf('1945')).not.toContain('scale');
    expect(kindsOf('1945')).not.toContain('cup-stack');
    expect(kindsOf('1945')).not.toContain('knock-box');

    // The knock box belongs to 1985 only.
    expect(kindsOf('1985')).toContain('knock-box');
    expect(kindsOf('1965')).not.toContain('knock-box');
    expect(kindsOf('2005')).not.toContain('knock-box');
    expect(kindsOf('2025')).not.toContain('knock-box');

    // Scales and cup stacks appear on the pass from 2005.
    for (const year of ['2005', '2025'] as const) {
      expect(kindsOf(year)).toContain('scale');
      expect(kindsOf(year)).toContain('cup-stack');
    }
    for (const year of ['1945', '1965', '1985'] as const) {
      expect(kindsOf(year)).not.toContain('scale');
      expect(kindsOf(year)).not.toContain('cup-stack');
    }

    // Espresso-era tampers start with the lever machine.
    expect(kindsOf('1965')).toContain('tamper');
    expect(kindsOf('1985')).toContain('tamper');

    module.dispose();
  });

  it('keeps the five era specs discrete and describable', () => {
    expect(Object.keys(BREWING_SPECS)).toEqual([...YEAR_IDS]);
    expect(brewingSpecs()).toHaveLength(YEAR_IDS.length);
    expect(MACHINE_ARCHETYPE_KINDS).toHaveLength(YEAR_IDS.length);
    for (const year of YEAR_IDS) {
      const spec = brewingSpec(year);
      const summary = describeBrewingSpec(spec);
      expect(summary.year).toBe(year);
      expect(summary.machineId).toBe(spec.machine.id);
      expect(summary.archetype).toBe(spec.machine.archetype);
      expect(summary.accessoryKinds.length).toBeGreaterThanOrEqual(4);
      expect(summary.surfaceCount).toBe(spec.surfaces.length);
      expect(summary.engraving).toContain(spec.machine.brand);
      expect(MACHINE_ARCHETYPE_KINDS).toContain(spec.machine.archetype);
      // Data integrity: every recipe id is unique within the era.
      expect(new Set(spec.surfaces.map((recipe) => recipe.id)).size).toBe(spec.surfaces.length);
    }
    // Eras share only the panel flags they genuinely have in common; the machine
    // id, archetype, dosing signature and finish always differ.
    for (const a of YEAR_IDS) {
      for (const b of YEAR_IDS) {
        if (a === b) continue;
        const shared = brewingEraConflicts(brewingSpec(a), brewingSpec(b));
        expect(shared).not.toContain('machine.id');
        expect(shared).not.toContain('machine.archetype');
        expect(shared).not.toContain('machine.dosingKind');
        expect(shared).not.toContain('materialSetId');
        expect(shared).not.toContain('paletteName');
        expect(shared.length).toBeLessThan(BREWING_ERA_DISCRIMINATOR_FIELDS.length);
      }
    }
    expect(new Set(YEAR_IDS.map((year) => brewingSpec(year).machine.id)).size).toBe(YEAR_IDS.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Audio cues                                                                 */
/* -------------------------------------------------------------------------- */

describe('machine-SFX cues on the injected bus', () => {
  it('fires the shot, steam, grind, cup-clatter and milk-knock cues for their interactions', async () => {
    const kernel = headlessKernel();
    const { factory } = createFakeAudioContextFactory();
    const engine = createAudioEngine({ contextFactory: factory, seed: 77 });
    expect(await engine.unlock()).toBe('running');
    const port = recordingPort(engine);
    expect(isMachineAudioPort(port)).toBe(true);
    const module = createBrewingModule({ audio: port });
    applyYear(kernel, module, '1965', { engine, port });

    expect(module.describe().audioConnected).toBe(true);
    engine.clearEventLog();
    module.clearCueLog();

    const shot = module.pullShot();
    const steam = module.purgeSteam();
    const grind = module.runGrinder();
    const clatter = module.clatterCups();
    const knock = module.knockMilkPitcher();

    expect(module.getCueIds()).toEqual(['shot', 'steam', 'grind', 'cup-clatter', 'milk-knock']);
    expect(shot.cue).toBe(CUES_FOR_ALL_INTERACTIONS['pull-shot']);
    expect(steam?.cue).toBe('steam');
    expect(grind.cue).toBe('grind');
    expect(clatter.cue).toBe('cup-clatter');
    expect(knock.cue).toBe('milk-knock');
    for (const record of [shot, steam, grind, clatter, knock]) {
      expect(record?.emitted).toBe(true);
      expect(record?.year).toBe('1965');
      expect(record?.machineId).toBe('machines:1965:lever-espresso');
      expect(record?.source.length).toBeGreaterThan(0);
    }

    // The cue vocabulary maps one to one onto the engine's one-shots.
    expect(MACHINE_INTERACTIONS).toHaveLength(5);
    expect(MACHINE_CUES['pull-shot']).toEqual({ cue: 'shot', kind: 'extraction' });
    expect(MACHINE_CUES['purge-steam']).toEqual({ cue: 'steam', kind: 'steamPurge' });
    expect(MACHINE_CUES['run-grinder']).toEqual({ cue: 'grind', kind: 'grinder' });
    expect(MACHINE_CUES['cup-clatter']).toEqual({ cue: 'cup-clatter', kind: 'cupClatter' });
    expect(MACHINE_CUES['milk-knock']).toEqual({ cue: 'milk-knock', kind: 'milkKnock' });
    expect(module.getCueLog().map((record) => record.kind)).toEqual([
      'extraction',
      'steamPurge',
      'grinder',
      'cupClatter',
      'milkKnock',
    ]);
    expect(interactionForKind('steamPurge')).toBe('purge-steam');

    // Every one of them went through the injected handle and nowhere else.
    expect(port.calls.map((call) => call.kind)).toEqual([
      'extraction',
      'steamPurge',
      'grinder',
      'cupClatter',
      'milkKnock',
    ]);
    const events = engine.getEventLog().filter((event) => event.kind === 'machine-trigger');
    expect(events.map((event) => event.id)).toEqual([
      'extraction',
      'steamPurge',
      'grinder',
      'cupClatter',
      'milkKnock',
    ]);
    expect(engine.getMachineSfx()?.triggerCount).toBe(5);
    // The machine bus carries the sounds: the engine's machine strip exists.
    expect(engine.getBus('machine')).not.toBeNull();

    // Interactions are counted, and the visual side runs with them.
    const counts = module.getInteractionCounts();
    for (const interaction of MACHINE_INTERACTIONS) expect(counts[interaction]).toBe(1);
    const nodes = moduleNodeNames(module);
    expect(nodes.some((name) => name.includes('steam-wand-1-plume'))).toBe(true);
    expect(nodes.some((name) => name.includes('extraction-drip'))).toBe(true);

    // The geometry answers the cue: the plumes appear while the steam purge runs.
    module.update(0.2, { year: '1965', elapsedSeconds: 0.2, frame: 3 });
    let plumes = 0;
    module.root?.traverse((object) => {
      if (object.userData['baseY'] !== undefined) plumes += 1;
    });
    expect(plumes).toBeGreaterThan(0);

    module.dispose();
    engine.dispose();
  });

  it('never constructs an audio context: the module only needs the injected handle', () => {
    const kernel = headlessKernel();
    // Headless node: there is no Web Audio constructor to reach for at all.
    expect((globalThis as Record<string, unknown>)['AudioContext']).toBeUndefined();
    expect((globalThis as Record<string, unknown>)['webkitAudioContext']).toBeUndefined();

    const seen: MachineSfxKind[] = [];
    const stub: MachineAudioPort = {
      triggerMachine(kind: MachineSfxKind): MachineTriggerRecord {
        seen.push(kind);
        return {
          kind,
          year: '1985',
          archetype: 'semi-automatic',
          material: 'ceramic',
          time: 0,
          durationSeconds: 0.2,
          velocity: 1,
          pitchFactor: 1,
          durationFactor: 1,
          levelFactor: 1,
          level: 0.5,
          seed: 1,
          nodes: 2,
          emitted: true,
          index: seen.length - 1,
        } as unknown as MachineTriggerRecord;
      },
    };
    const module = createBrewingModule({ audio: stub });
    applyYear(kernel, module, '1985');
    const record = module.pullShot();
    expect(record.emitted).toBe(true);
    expect(record.trigger).not.toBeNull();
    expect(record.reason).toBeNull();
    expect(seen).toEqual(['extraction']);
    // With no injected handle at all the module still runs, just silently.
    const quiet = createBrewingModule();
    applyYear(kernel, quiet, '1985');
    const quietRecord = quiet.pullShot();
    expect(quietRecord.emitted).toBe(false);
    expect(quietRecord.reason).toMatch(/no audio handle/i);
    quiet.dispose();
    module.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle: applyPeriod, dispose and re-instantiation                       */
/* -------------------------------------------------------------------------- */

describe('module lifecycle', () => {
  it('replaces the previous era completely when the timeline moves', () => {
    const kernel = headlessKernel();
    const module = createBrewingModule();
    applyYear(kernel, module, '1945');
    const firstYear = moduleNodeNames(module);
    expect(firstYear.some((name) => name.includes(':1945:'))).toBe(true);

    applyYear(kernel, module, '2025');
    const secondYear = moduleNodeNames(module);
    expect(secondYear.some((name) => name.includes(':1945:'))).toBe(false);
    expect(secondYear.some((name) => name.includes(':2025:'))).toBe(true);
    expect(module.spec?.machine.id).toBe('machines:2025:multi-group');
    // The machine group is reused, not duplicated.
    expect(kernel.world.children.filter((child) => child.name === MACHINES_GROUP_NAME)).toHaveLength(1);

    // Re-applying the same era twice neither duplicates nor empties the bar.
    const before = countNodes(module.root!);
    applyYear(kernel, module, '2025');
    expect(countNodes(module.root!)).toBe(before);

    module.dispose();
  });

  it('releases every geometry, material and texture on dispose', () => {
    const kernel = headlessKernel();
    const module = createBrewingModule();
    applyYear(kernel, module, '1965');
    const resources = collectResources(module.root!);
    expect(resources.geometries.size).toBeGreaterThan(30);
    expect(resources.materials.size).toBeGreaterThan(10);
    // Every surface the era declares is worn by a mesh: no dead recipes.
    expect(resources.textures.size).toBe(brewingSpec('1965').surfaces.length);

    const geometrySpies = [...resources.geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialSpies = [...resources.materials].map((material) => vi.spyOn(material, 'dispose'));
    const textureSpies = [...resources.textures].map((texture) => vi.spyOn(texture, 'dispose'));

    module.dispose();
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalled();
    for (const spy of materialSpies) expect(spy).toHaveBeenCalled();
    for (const spy of textureSpies) expect(spy).toHaveBeenCalled();

    // Idempotent, and the scene graph is back to its pre-build baseline.
    expect(kernel.world.children).toHaveLength(0);
    module.dispose();
    expect(kernel.world.children).toHaveLength(0);
    expect(module.describe().nodeCount).toBe(0);
  });

  it('re-instantiates three times without leaking nodes, listeners or timers', () => {
    const kernel = headlessKernel();
    vi.useFakeTimers();
    const baselineNodes = countNodes(kernel.world);
    const baselineListeners = kernel.getListenerStats();
    expect(baselineNodes).toBe(1);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const module = createBrewingModule();
      applyYear(kernel, module, YEAR_IDS[cycle] ?? '1945');
      expect(countNodes(kernel.world)).toBeGreaterThan(baselineNodes);
      module.pullShot();
      module.update(1 / 60, { year: YEAR_IDS[cycle] ?? '1945', elapsedSeconds: 1 / 60, frame: cycle });
      module.dispose();
      expect(countNodes(kernel.world)).toBe(baselineNodes);
      expect(kernel.world.children).toHaveLength(0);
    }

    // No timer survived the module: it drives everything from `update`.
    expect(vi.getTimerCount()).toBe(0);
    const listeners = kernel.getListenerStats();
    expect(listeners.frame).toBe(baselineListeners.frame);
    expect(listeners.resize).toBe(baselineListeners.resize);
    expect(listeners.dom).toBe(baselineListeners.dom);
    expect(listeners.dispose).toBe(baselineListeners.dispose);
    expect(kernel.listenerCount).toBe(0);
  });

  it('unsubscribes its machine-SFX listener on dispose and rebuild', async () => {
    const kernel = headlessKernel();
    const { factory } = createFakeAudioContextFactory();
    const engine = createAudioEngine({ contextFactory: factory, seed: 4 });
    await engine.unlock();
    const port = recordingPort(engine);
    const module = createBrewingModule({ audio: port });
    applyYear(kernel, module, '1985', { engine, port });

    expect(module.describe().audioSubscriptions).toBe(1);
    expect(port.counters().subscriptions).toBe(1);
    const before = module.describe().audioReactions;
    engine.triggerMachine('grinder');
    expect(module.describe().audioReactions).toBeGreaterThan(before);

    applyYear(kernel, module, '2005', { engine, port });
    expect(module.describe().audioSubscriptions).toBe(1);
    expect(port.counters().unsubscriptions).toBe(1);

    module.dispose();
    expect(module.describe().audioSubscriptions).toBe(0);
    expect(port.counters().unsubscriptions).toBe(2);
    const after = module.describe().audioReactions;
    engine.triggerMachine('grinder');
    engine.triggerMachine('cupClatter');
    expect(module.describe().audioReactions).toBe(after);

    engine.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Placement                                                                  */
/* -------------------------------------------------------------------------- */

describe('counter placement and the structural anchors', () => {
  it('stands every machine and accessory inside the room, on the counter and clear of the lane', () => {
    const kernel = headlessKernel();
    const module = createBrewingModule();
    const lane = serviceLaneRect(STRUCTURAL_LAYOUT.serviceLane);
    const counter = counterRect(STRUCTURAL_LAYOUT.counter);

    for (const year of YEAR_IDS) {
      applyYear(kernel, module, year);
      expect(module.placementProblems()).toEqual([]);
      const machine = module.machinePlan;
      expect(machine).not.toBeNull();
      const footprint = machineFootprint(machine!);
      expect(footprint.minX).toBeGreaterThan(counter.minX);
      expect(footprint.maxX).toBeLessThan(counter.maxX);
      expect(footprint.maxZ).toBeLessThan(lane.minZ);
      expect(machine!.position.y).toBeCloseTo(STRUCTURAL_LAYOUT.counter.surfaceHeight, 6);

      for (const entry of module.accessoryPlan) {
        expect(Number.isFinite(entry.position.x)).toBe(true);
        expect(Number.isFinite(entry.position.z)).toBe(true);
        expect(Math.abs(entry.position.x)).toBeLessThan(CAFE_ROOM_BOUNDS.width / 2);
        expect(Math.abs(entry.position.z)).toBeLessThan(CAFE_ROOM_BOUNDS.depth / 2);
        if (entry.mount === 'wall') {
          // The 1945 crank mill hangs on the back wall above the counter.
          expect(entry.position.z).toBeLessThan(-CAFE_ROOM_BOUNDS.depth / 2 + 0.3);
          expect(entry.position.y).toBeGreaterThan(1);
        } else {
          expect(entry.position.y).toBeCloseTo(STRUCTURAL_LAYOUT.counter.surfaceHeight, 6);
        }
      }
    }
    module.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Procedural surfaces                                                        */
/* -------------------------------------------------------------------------- */

describe('procedural machine surfaces', () => {
  it('paints deterministic textures that carry lettering, wear and no remote asset', () => {
    const style = {
      kind: 'legend' as const,
      palette: { base: '#1f2124', accent: '#f2f2f2', detail: '#8d8d8d', highlight: '#ffffff' },
      legend: { title: 'GAGGIA', subtitle: 'SEMI-AUTOMATIC', lines: ['GROUP 1'], ink: '#f2f2f2' },
    };
    const first = paintMachineSurface(style);
    const second = paintMachineSurface(style);
    expect(first.data).toEqual(second.data);
    expect(distinctPixelColors(first)).toBeGreaterThan(3);

    const legend = createMachineTexture(style, { key: 'test:legend' });
    expect(legend.source).toBe('data');
    expect(legend.texture).toBeInstanceOf(THREE.DataTexture);
    expect(legend.texture.name).toBe(`${MACHINE_TEXTURE_PREFIX}test:legend`);
    expect(legend.width).toBe(DEFAULT_MACHINE_TEXTURE_SIZE);

    // The lettering really is painted: ink pixels differ from the plate colour.
    const ink = parseHex('#f2f2f2');
    const pixels = (legend.texture as THREE.DataTexture).image.data as Uint8Array;
    let inkPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset] === ink.r && pixels[offset + 1] === ink.g && pixels[offset + 2] === ink.b) {
        inkPixels += 1;
      }
    }
    expect(inkPixels).toBeGreaterThan(20);

    // A wear overlay is genuinely transparent where it has no scuff.
    const wear = paintMachineSurface({
      kind: 'wear',
      palette: { base: '#2f2f2b', accent: '#565248' },
      transparency: 'pattern',
      wear: 0.6,
    });
    let transparent = 0;
    for (let offset = 3; offset < wear.data.length; offset += 4) if (wear.data[offset] === 0) transparent += 1;
    expect(transparent).toBeGreaterThan(0);

    // Dial faces and readouts paint real content too.
    for (const kind of ['dial-face', 'lcd', 'touch-panel', 'copper', 'granite', 'wood'] as const) {
      const pixels = paintMachineSurface({
        kind,
        palette: { base: '#c8b28a', accent: '#333026', detail: '#22201b', highlight: '#f6efdd' },
        legend: { title: 'BAR', subtitle: 'BOILER', digits: '12' },
        grid: 8,
        needle: 0.4,
      });
      expect(distinctPixelColors(pixels)).toBeGreaterThan(2);
    }
  });

  it('builds a material set whose every material is procedural and disposable', () => {
    const spec = brewingSpec('2025');
    const set = createMachineMaterialSet({ id: spec.materialSetId, year: spec.year, recipes: spec.surfaces });
    expect(set.materials.size).toBe(spec.surfaces.length);
    expect(set.textures).toHaveLength(spec.surfaces.length);
    for (const texture of set.textures) {
      expect(texture.source).toBe('data');
      expect(texture.texture.name.startsWith(MACHINE_TEXTURE_PREFIX)).toBe(true);
      expect(texture.texture.userData['procedural']).toBe(true);
    }
    for (const recipe of spec.surfaces) {
      const material = machineSurface(set, recipe.id);
      expect(material.name).toBe(`machine:${spec.materialSetId}:${recipe.id}`);
      expect(material.map).not.toBeNull();
    }
    // The touch panel and LCD glow: emissive maps come from the procedural map.
    const touch = machineSurface(set, 'display-touch');
    expect(touch.emissiveMap).toBe(touch.map);
    expect(touch.emissiveIntensity).toBeGreaterThan(0);
    expect(() => machineSurface(set, 'nope')).toThrow(/no surface/);
  });
});

/* -------------------------------------------------------------------------- */
/* Hotspots, updates and the production bundle                                */
/* -------------------------------------------------------------------------- */

describe('hotspots, animation and packaging', () => {
  it('exposes era hotspots for the overlay without touching the core registry', () => {
    const kernel = headlessKernel();
    const module = createBrewingModule();
    const seen = new Set<string>();
    for (const year of YEAR_IDS) {
      applyYear(kernel, module, year);
      const hotspots = module.getHotspots();
      expect(hotspots.length).toBeGreaterThanOrEqual(5);
      const ids = hotspots.map((hotspot) => hotspot.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(seen.has(id)).toBe(false);
      for (const id of ids) seen.add(id);
      for (const hotspot of hotspots) {
        expect(hotspot.moduleId).toBe('machines');
        expect(hotspot.year).toBe(year);
        expect(hotspot.label.length).toBeGreaterThan(0);
        expect(Number.isFinite(hotspot.position.x)).toBe(true);
        expect(hotspot.position.y).toBeGreaterThan(0);
        expect(hotspot.radius).toBeGreaterThan(0);
      }
      expect(ids).toContain(`hotspot:machines:${year}:machine`);
      expect(ids.some((id) => id.endsWith(':steam-wand'))).toBe(hasSteamWand(brewingSpec(year).machine));
      expect(ids.some((id) => id.endsWith(':touch-panel'))).toBe(brewingSpec(year).machine.hasTouchPanel);
      expect(ids.some((id) => id.endsWith(':grinder'))).toBe(true);
      expect(ids.some((id) => id.endsWith(':cup-stack'))).toBe(
        brewingSpec(year).accessories.some((item) => item.kind === 'cup-stack'),
      );
    }
    module.dispose();
  });

  it('runs the machines on update: needles, lamps and steam all move', () => {
    const kernel = headlessKernel();
    const module = createBrewingModule();
    applyYear(kernel, module, '2025');

    const needles: THREE.Object3D[] = [];
    const lamps: THREE.MeshStandardMaterial[] = [];
    module.root?.traverse((object) => {
      if (object.userData['baseRotationZ'] !== undefined && object.name.includes('needle')) needles.push(object);
    });
    for (const material of module.materials!.materials.values()) {
      if (material.emissiveIntensity > 0) lamps.push(material);
    }
    expect(needles.length).toBeGreaterThan(0);
    expect(lamps.length).toBeGreaterThan(0);

    const lampBefore = lamps.map((material) => material.emissiveIntensity);
    module.pullShot();
    module.purgeSteam();
    module.update(0.4, { year: '2025', elapsedSeconds: 0.4, frame: 1 });
    module.update(0.4, { year: '2025', elapsedSeconds: 0.8, frame: 2 });
    const needleRotations = needles.map((needle) => needle.rotation.z);
    expect(needleRotations.some((value) => Math.abs(value) > 1e-4)).toBe(true);
    expect(lamps.some((material, index) => material.emissiveIntensity !== lampBefore[index])).toBe(true);

    // A purge later in the sequence hides the plumes again once it has finished.
    module.clearCueLog();
    const plumes: THREE.Mesh[] = [];
    module.root?.traverse((object) => {
      if (object.name.includes('-plume')) plumes.push(object as THREE.Mesh);
    });
    expect(plumes.length).toBeGreaterThan(0);
    for (let step = 0; step < 120; step += 1) {
      module.update(0.1, { year: '2025', elapsedSeconds: step * 0.1, frame: step });
    }
    expect(plumes.every((plume) => plume.visible)).toBe(false);
    expect(module.describe().audioSubscriptions).toBe(0);
    module.dispose();
  });

  it('bundles through the production Vite pipeline with no assets or network code', async () => {
    const entry = new URL('./BrewingModule.ts', import.meta.url).pathname;
    const root = new URL('../..', import.meta.url).pathname;
    const result = (await viteBuild({
      root,
      logLevel: 'silent',
      configFile: false,
      build: {
        write: false,
        minify: false,
        target: 'es2022',
        rollupOptions: { external: ['three'] },
        lib: {
          entry,
          formats: ['es'],
          name: 'CafeBrewingDomain',
          fileName: 'cafe-brewing',
        },
      },
    })) as unknown;

    const outputs: readonly unknown[] = Array.isArray(result) ? result : [result];
    const files = outputs.flatMap(
      (output) => (output as { output?: readonly { type: string; code?: string }[] }).output ?? [],
    );
    const chunks = files.filter((file) => file.type === 'chunk');
    const assets = files.filter((file) => file.type === 'asset');
    expect(chunks.length).toBeGreaterThan(0);
    expect(assets).toHaveLength(0);
    const code = chunks.map((chunk) => chunk.code ?? '').join('\n');
    expect(code.length).toBeGreaterThan(1000);
    // Executable code only: bundle prose in doc comments is not the payload.
    const executable = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

    // No remote assets, no audio device construction, no network code.
    expect(executable).not.toMatch(/\.(png|jpe?g|gif|webp|avif|svg|ttf|otf|woff2?)\b/i);
    expect(executable).not.toMatch(/\.(mp3|wav|ogg|m4a|aac|flac|opus)\b/i);
    expect(executable).not.toMatch(/AudioContext/);
    expect(executable).not.toMatch(/new\s+Audio\s*\(/);
    expect(executable).not.toMatch(/\bfetch\s*\(/);
    expect(executable).not.toMatch(/XMLHttpRequest|from\s*['"]node:/);
    expect(executable).not.toMatch(/https?:\/\//);

    // The era data really is in the bundle.
    expect(code).toMatch(/machines:1945:percolator/);
    expect(code).toMatch(/machines:1965:lever-espresso/);
    expect(code).toMatch(/machines:1985:semi-automatic/);
    expect(code).toMatch(/machines:2005:super-automatic/);
    expect(code).toMatch(/machines:2025:multi-group/);
    expect(code).toMatch(/gooseneck-temperature/);
    expect(code).toMatch(/sock-filter-dripolator/);
    expect(code).toMatch(/calibrated-tamper/);
    expect(code).toMatch(/PERCO/);
    expect(code).toMatch(/FAEMA/);
  }, 180_000);
});

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

function parseHex(value: string): { r: number; g: number; b: number } {
  const hex = value.replace('#', '');
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

