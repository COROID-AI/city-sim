/**
 * Shared harness for the café end-to-end verification suites.
 *
 * Everything here drives the **assembled application** rather than individual
 * modules: the real composition root (`src/app/compose.ts`) builds the ten
 * registered domain modules, the real kernel runs in headless mode, the real
 * timeline control and the real period transition are used to change eras, and
 * the real audio engine runs against an injected headless audio-context fake.
 * Nothing in these helpers reaches into module internals, and no helper requires
 * a GPU, a canvas or an audio device.
 *
 * The harness owns four responsibilities:
 *
 *  - **Boot** — compose the café headlessly (node) or with DOM chrome (jsdom),
 *    install the headless audio context, and hand back detachable runtime.
 *  - **Drive** — switch eras through the composition selection path (or the real
 *    slider control) and step deterministic frames until the choreography
 *    settles, recording every completion signal the transition publishes.
 *  - **Observe** — read the live per-domain era specs, count the scene graph's
 *    render statistics and node names, and summarise menu pricing.
 *  - **Expect** — the {@link ERA_EXPECTATIONS} table: one era's expected
 *    inventory for every requested detail domain, plus the node-level patterns
 *    that must (and must not) appear in that era's scene graph.
 *
 * The expectations table is deliberately data-driven: it records the era-exact
 * device/board/currency/tier vocabulary from the domain specs and the ordering
 * rules the acceptance criteria describe, never a single hardcoded price or
 * object count that legitimate content tuning would break.
 */

import * as THREE from 'three';
import { YEAR_IDS, type YearId } from '../../src/contracts/period';
import {
  bootHeadlessCafe,
  createCafeComposition,
  type CafeComposition,
  type CafeCompositionOptions,
} from '../../src/app/compose';
import { createManualFrameScheduler, type ManualFrameScheduler } from '../../src/core/kernel';
import type { TransitionSignal } from '../../src/core/transition';
import type { DomainId } from '../../src/data/periodRegistry';
import { createFakeAudioContextFactory, type FakeContextFactory } from '../audio/fakeAudioContext';
import type { MusicDeviceKind } from '../../src/domains/music/devices';
import type { MachineArchetypeKind } from '../../src/domains/machines/BrewingModule';
import type {
  CounterDeviceFamily,
  CounterPaymentMode,
  CounterTechSpec,
} from '../../src/domains/counter/CounterTechModule';
import type { CurrencyId, MenuBoardKind, MenuBoardSpec } from '../../src/domains/menuboard/types';
import type { PosterYearSpec } from '../../src/domains/posters/data';
import type { FurnitureSpec } from '../../src/domains/furniture/FurnitureModule';
import type { TablewareSpec } from '../../src/domains/tableware/TablewareModule';
import type { SignageLightingSpec } from '../../src/domains/signage/SignageLightingModule';
import type { PatronSpec } from '../../src/domains/patrons/data/1945';
import type { EnvironmentSpec } from '../../src/domains/environment/data/years';
import type { BrewingSpec } from '../../src/domains/machines/BrewingModule';

/* -------------------------------------------------------------------------- */
/* Era vocabulary                                                              */
/* -------------------------------------------------------------------------- */

/** The five eras in timeline order, re-exported for the suites. */
export const ERA_YEARS: readonly YearId[] = YEAR_IDS;

/** One point step used by {@link CafeHarness.switchTo}, seconds (60 fps). */
export const STEP_SECONDS = 1 / 60;

/** Upper bound of scene time a suite will step before calling a switch stuck. */
export const DEFAULT_SETTLE_SECONDS = 24;

/**
 * Expected inventory of one era, expressed in the vocabulary the assembled
 * scene actually reports. Fields are compared against the live per-domain spec
 * after the composition has switched eras, so this is integration data, not a
 * copy of the registry's static tables.
 */
export interface EraExpectation {
  readonly year: YearId;
  /* music */
  readonly musicKind: MusicDeviceKind;
  readonly musicDeviceId: string;
  readonly musicProgramId: string;
  /* machines */
  readonly machineArchetype: MachineArchetypeKind;
  /* counter technology */
  readonly counterFamily: CounterDeviceFamily;
  readonly counterPaymentKind: string;
  readonly counterPaymentMode: CounterPaymentMode;
  /* menu board */
  readonly menuBoardKind: MenuBoardKind;
  readonly menuCurrency: CurrencyId;
  readonly menuBoardName: string;
  /* signage + lighting */
  readonly signageFixtureKind: string;
  /* environment shell */
  readonly environmentBlade: string;
  /* furniture + decor */
  readonly furnitureChairKind: string;
  readonly furnitureMaterialSet: string;
  /* tableware */
  readonly tablewareCupKind: string;
  readonly tablewareMaterialSet: string;
  /* posters + advertising */
  readonly posterMount: string;
  readonly posterPalette: string;
  /* patrons */
  readonly patronDensity: number;
  readonly baristaHair: string;
  readonly gadgets: readonly string[];
  readonly forbiddenGadgets: readonly string[];
  /** Scene-node name patterns that must exist in this era. */
  readonly nodesPresent: readonly RegExp[];
  /** Scene-node name patterns that must never exist in this era. */
  readonly nodesAbsent: readonly RegExp[];
}

/** Era-exact inventory for 1945, 1965, 1985, 2005 and 2025. */
export const ERA_EXPECTATIONS: Readonly<Record<YearId, EraExpectation>> = Object.freeze({
  '1945': Object.freeze({
    year: '1945',
    musicKind: 'wireless-set',
    musicDeviceId: 'wireless-1945',
    musicProgramId: 'valve-ensemble-1945',
    machineArchetype: 'percolator',
    counterFamily: 'manual-till',
    counterPaymentKind: 'cash-drawer',
    counterPaymentMode: 'cash-only',
    menuBoardKind: 'chalk-slate',
    menuCurrency: 'gbp-predecimal',
    menuBoardName: 'Hand-chalked slate',
    signageFixtureKind: 'bare-bulb-pendant',
    environmentBlade: 'THE BLUE BIRD',
    furnitureChairKind: 'bentwood-cane',
    furnitureMaterialSet: 'material-set:1945-utility-oak-and-oxblood-rexine',
    tablewareCupKind: 'china-cup',
    tablewareMaterialSet: 'material-set:1945-utility-china',
    posterMount: 'pinned',
    posterPalette: 'Ration cream, oxblood and utility green',
    patronDensity: 0.42,
    baristaHair: 'short-back-and-sides',
    gadgets: ['newspaper', 'cigarette', 'coffee-cup'],
    forbiddenGadgets: [
      'transistor-radio',
      'walkman',
      'boombox',
      'cassette-tape',
      'shoulder-bag',
      'mp3-player',
      'wired-earbuds',
      'flip-phone',
      'smartphone',
      'headphones',
      'wireless-earbuds',
      'laptop',
      'reusable-cup',
    ],
    nodesPresent: [/^music:1945:wireless-1945$/],
    nodesAbsent: [/jukebox|boombox|ipod|contactless|smartphone|walkman|flip-phone|mp3-player/i],
  }),
  '1965': Object.freeze({
    year: '1965',
    musicKind: 'jukebox',
    musicDeviceId: 'jukebox-1965',
    musicProgramId: 'orchestral-pop-1965',
    machineArchetype: 'lever-espresso',
    counterFamily: 'mechanical-register',
    counterPaymentKind: 'cash-drawer',
    counterPaymentMode: 'cash-only',
    menuBoardKind: 'painted-vinyl',
    menuCurrency: 'gbp-predecimal',
    menuBoardName: 'Painted panel with applied vinyl lettering',
    signageFixtureKind: 'fluorescent-tube',
    environmentBlade: 'CAFE CONTINENTAL',
    furnitureChairKind: 'vinyl-diner',
    furnitureMaterialSet: 'material-set:1965-chrome-melamine-and-tomato-vinyl',
    tablewareCupKind: 'narrow-rim-cup',
    tablewareMaterialSet: 'material-set:1965-turquoise-ceramic',
    posterMount: 'framed',
    posterPalette: 'Coated cream, soda red and turquoise',
    patronDensity: 0.5,
    baristaHair: 'mop-top',
    gadgets: ['transistor-radio', 'cassette-tape', 'coffee-cup'],
    forbiddenGadgets: ['newspaper', 'walkman', 'boombox', 'flip-phone', 'smartphone', 'laptop', 'reusable-cup'],
    nodesPresent: [/^music:1965:jukebox-1965$/],
    nodesAbsent: [/wireless-1945|ipod|contactless|smartphone|walkman|boombox-1985|flip-phone|mp3-player|reusable-cup/i],
  }),
  '1985': Object.freeze({
    year: '1985',
    musicKind: 'boombox',
    musicDeviceId: 'boombox-1985',
    musicProgramId: 'synth-drive-1985',
    machineArchetype: 'semi-automatic',
    counterFamily: 'electronic-register',
    counterPaymentKind: 'cash-drawer',
    counterPaymentMode: 'cash-first',
    menuBoardKind: 'fluorescent-letterboard',
    menuCurrency: 'gbp-decimal',
    menuBoardName: 'Fluorescent letter board in a light box',
    signageFixtureKind: 'halogen-downlight',
    environmentBlade: 'CAFE MODERNE',
    furnitureChairKind: 'stacking-polypropylene',
    furnitureMaterialSet: 'material-set:1985-grey-laminate-chrome-and-dusty-pink',
    tablewareCupKind: 'stoneware-mug',
    tablewareMaterialSet: 'material-set:1985-oxblood-stoneware',
    posterMount: 'framed',
    posterPalette: 'Black board, neon magenta and cyan',
    patronDensity: 0.58,
    baristaHair: 'mullet',
    gadgets: ['walkman', 'boombox', 'cassette-tape', 'shoulder-bag'],
    forbiddenGadgets: [
      'newspaper',
      'transistor-radio',
      'mp3-player',
      'wired-earbuds',
      'flip-phone',
      'smartphone',
      'wireless-earbuds',
      'laptop',
      'reusable-cup',
    ],
    nodesPresent: [/^music:1985:boombox-1985$/],
    nodesAbsent: [/wireless-1945|jukebox-1965|ipod|contactless|smartphone|flip-phone|mp3-player|reusable-cup|wireless-earbuds/i],
  }),
  '2005': Object.freeze({
    year: '2005',
    musicKind: 'ipod-dock',
    musicDeviceId: 'ipod-dock-2005',
    musicProgramId: 'dock-pop-2005',
    machineArchetype: 'super-automatic',
    counterFamily: 'pos-terminal',
    counterPaymentKind: 'card-terminal',
    counterPaymentMode: 'card-and-cash',
    menuBoardKind: 'backlit-acrylic',
    menuCurrency: 'gbp-decimal',
    menuBoardName: 'Backlit acrylic menu panels',
    signageFixtureKind: 'compact-fluorescent',
    environmentBlade: 'CAFE VELO',
    furnitureChairKind: 'plywood-shell',
    furnitureMaterialSet: 'material-set:2005-bleached-oak-steel-and-chocolate-leather',
    tablewareCupKind: 'paper-cup',
    tablewareMaterialSet: 'material-set:2005-kraft-and-card',
    posterMount: 'framed',
    posterPalette: 'Office white with film red and telecom blue',
    patronDensity: 0.64,
    baristaHair: 'textured-crop',
    gadgets: ['flip-phone', 'mp3-player', 'wired-earbuds', 'laptop'],
    forbiddenGadgets: [
      'newspaper',
      'cigarette',
      'transistor-radio',
      'walkman',
      'boombox',
      'cassette-tape',
      'smartphone',
      'headphones',
      'wireless-earbuds',
      'reusable-cup',
    ],
    nodesPresent: [/^music:2005:ipod-dock-2005$/],
    nodesAbsent: [/wireless-1945|jukebox-1965|boombox-1985|contactless|smartphone|walkman|reusable-cup|wireless-earbuds/i],
  }),
  '2025': Object.freeze({
    year: '2025',
    musicKind: 'smart-speaker',
    musicDeviceId: 'phone-speaker-2025',
    musicProgramId: 'stream-pop-2025',
    machineArchetype: 'multi-group',
    counterFamily: 'tablet-contactless',
    counterPaymentKind: 'contactless-reader',
    counterPaymentMode: 'contactless-first',
    menuBoardKind: 'digital-screen',
    menuCurrency: 'gbp-decimal',
    menuBoardName: 'Emissive digital menu screen',
    signageFixtureKind: 'led-strip',
    environmentBlade: 'CAFE ARBOUR',
    furnitureChairKind: 'moulded-shell',
    furnitureMaterialSet: 'material-set:2025-reclaimed-oak-moss-and-terrazzo',
    tablewareCupKind: 'reusable-cup',
    tablewareMaterialSet: 'material-set:2025-recycled-green',
    posterMount: 'pinned',
    posterPalette: 'Recycled off-white, terracotta and leaf green',
    patronDensity: 0.76,
    baristaHair: 'undercut-fade',
    gadgets: ['smartphone', 'headphones', 'wireless-earbuds', 'laptop', 'reusable-cup'],
    forbiddenGadgets: [
      'newspaper',
      'cigarette',
      'transistor-radio',
      'walkman',
      'boombox',
      'cassette-tape',
      'flip-phone',
      'mp3-player',
      'wired-earbuds',
    ],
    nodesPresent: [/^music:2025:phone-speaker-2025$/, /contactless/i],
    nodesAbsent: [/wireless-1945|jukebox-1965|boombox-1985|ipod-dock-2005|walkman|flip-phone|mp3-player|wired-earbuds/i],
  }),
});

/* -------------------------------------------------------------------------- */
/* Scene statistics                                                           */
/* -------------------------------------------------------------------------- */

/** Render statistics the headless scene graph implies, per era. */
export interface SceneCounts {
  /** Nodes in the composed scene. */
  readonly nodes: number;
  /** Visible meshes (one draw call each, plus instanced batches). */
  readonly drawCalls: number;
  readonly triangles: number;
  /** Distinct geometries / materials / textures the visible meshes share. */
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly lights: number;
}

function textureProperties(material: THREE.Material): readonly string[] {
  return Object.entries(material as unknown as Record<string, unknown>)
    .filter(([, value]) => value instanceof THREE.Texture)
    .map(([key]) => key);
}

function materialList(mesh: THREE.Mesh): readonly THREE.Material[] {
  const material = mesh.material as THREE.Material | THREE.Material[];
  return Array.isArray(material) ? material : [material];
}

/**
 * Walks `root` counting what a renderer would be asked to draw, honouring
 * effective visibility or ignoring it. `InstancedMesh` batches count their
 * instances as draw calls and multiply their triangle budget accordingly, so the
 * numbers cannot be improved just by batching.
 */
function countScene(root: THREE.Object3D, requireVisible: boolean): SceneCounts {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let nodes = 0;
  let drawCalls = 0;
  let triangles = 0;
  let lights = 0;

  const visit = (object: THREE.Object3D, parentVisible: boolean): void => {
    nodes += 1;
    const visible = parentVisible && object.visible;
    if (!requireVisible || visible) {
      const candidate = object as THREE.Mesh & { count?: number; isInstancedMesh?: boolean };
      if (candidate.isMesh === true || 'geometry' in candidate) {
        const geometry = candidate.geometry;
        const instances = candidate.isInstancedMesh === true ? Math.max(candidate.count ?? 1, 0) : 1;
        drawCalls += instances;
        if (geometry) {
          geometries.add(geometry);
          const index = geometry.getIndex();
          const positions = geometry.getAttribute('position');
          const perInstance = index ? index.count / 3 : positions ? positions.count / 3 : 0;
          triangles += Math.max(perInstance * instances, 0);
        }
        for (const material of materialList(candidate)) {
          materials.add(material);
          for (const key of textureProperties(material)) {
            const texture = (material as unknown as Record<string, unknown>)[key];
            if (texture instanceof THREE.Texture) textures.add(texture);
          }
        }
      }
      if ((object as THREE.Light).isLight === true) lights += 1;
    }
    for (const child of object.children) visit(child, visible);
  };

  visit(root, true);
  return {
    nodes,
    drawCalls,
    triangles: Math.round(triangles),
    geometries: geometries.size,
    materials: materials.size,
    textures: textures.size,
    lights,
  };
}

/** Render statistics a renderer would see for the currently visible scene. */
export function sceneCounts(root: THREE.Object3D): SceneCounts {
  return countScene(root, true);
}

/**
 * Visibility-independent scene inventory: every mesh in the scene, whether or
 * not it is currently visible. Two settled states of the same era must match on
 * this exactly — a mismatch means geometry was left behind or duplicated — while
 * the visible draw-call count legitimately varies by a mesh or two with the
 * per-frame cue animation (a tap target, a steam puff).
 */
export function sceneInventory(root: THREE.Object3D): SceneCounts {
  return countScene(root, false);
}

/** Every node name in the scene that matches `pattern`. */export function nodeNamesMatching(root: THREE.Object3D, pattern: RegExp): readonly string[] {
  const matches: string[] = [];
  root.traverse((object) => {
    if (object.name && pattern.test(object.name)) matches.push(object.name);
  });
  return matches.sort();
}

/** All node names in the composed scene, sorted. */
export function allNodeNames(root: THREE.Object3D): readonly string[] {
  const names: string[] = [];
  root.traverse((object) => {
    if (object.name) names.push(object.name);
  });
  return names;
}

/**
 * Names of the nodes the music domain publishes this era. The domain names its
 * device root `music:<year>:<deviceId>`, so the count is the era's visible music
 * playback device count.
 */
export function musicDeviceNodes(composition: CafeComposition): readonly string[] {
  return nodeNamesMatching(composition.kernel.world, /^music:/);
}

/* -------------------------------------------------------------------------- */
/* Live era specs                                                             */
/* -------------------------------------------------------------------------- */

/** Live spec type per aggregated detail domain. */
export interface DomainSpecTypes {
  readonly environment: EnvironmentSpec;
  readonly furniture: FurnitureSpec;
  readonly machines: BrewingSpec;
  readonly menuboard: MenuBoardSpec;
  readonly posters: PosterYearSpec;
  readonly tableware: TablewareSpec;
  readonly 'signage-lighting': SignageLightingSpec;
  readonly counter: CounterTechSpec;
  readonly patrons: PatronSpec;
  readonly music: import('../../src/domains/music/devices').MusicDeviceSpec;
}

/**
 * Reads the era spec a composed domain module is currently showing. This is the
 * live spec (`module.spec`), i.e. what the module applied to the scene graph for
 * the era it reports — not the static registry table.
 */
export function liveSpec<T extends DomainId>(
  composition: CafeComposition,
  domain: T,
): DomainSpecTypes[T] {
  const entry = composition.modules.find((candidate) => candidate.id === domain);
  if (entry === undefined) {
    throw new Error(`The composition has no '${domain}' module (modules: ${composition.modules.length}).`);
  }
  const spec = entry.module.spec as DomainSpecTypes[T] | undefined;
  if (spec === undefined) {
    throw new Error(`The '${domain}' module reports no era spec.`);
  }
  return spec;
}

/** All ten live specs of the era the composition currently shows. */
export function liveSpecs(composition: CafeComposition): DomainSpecTypes {
  return {
    environment: liveSpec(composition, 'environment'),
    furniture: liveSpec(composition, 'furniture'),
    machines: liveSpec(composition, 'machines'),
    menuboard: liveSpec(composition, 'menuboard'),
    posters: liveSpec(composition, 'posters'),
    tableware: liveSpec(composition, 'tableware'),
    'signage-lighting': liveSpec(composition, 'signage-lighting'),
    counter: liveSpec(composition, 'counter'),
    patrons: liveSpec(composition, 'patrons'),
    music: liveSpec(composition, 'music'),
  };
}

/* -------------------------------------------------------------------------- */
/* Menu pricing                                                               */
/* -------------------------------------------------------------------------- */

/** Data-driven pricing summary of one era's menu board. */
export interface MenuPricing {
  readonly year: YearId;
  readonly boardKind: MenuBoardKind;
  readonly currency: CurrencyId;
  readonly itemCount: number;
  readonly minPence: number;
  readonly medianPence: number;
  readonly meanPence: number;
  readonly maxPence: number;
  /** Price as written on the board, per item id. */
  readonly display: readonly string[];
}

/** Summarises a menu board spec's prices in cross-era comparable pence. */
export function menuPricing(spec: MenuBoardSpec): MenuPricing {
  const pence = spec.items
    .map((item) => item.price.pence)
    .slice()
    .sort((left, right) => left - right);
  if (pence.length === 0) throw new Error(`The ${spec.year} menu board lists no priced items.`);
  const total = pence.reduce((sum, value) => sum + value, 0);
  const middle = pence[Math.floor(pence.length / 2)] ?? pence[0] ?? 0;
  return {
    year: spec.year,
    boardKind: spec.boardKind,
    currency: spec.currency,
    itemCount: pence.length,
    minPence: pence[0] ?? 0,
    medianPence: middle,
    meanPence: Math.round(total / pence.length),
    maxPence: pence[pence.length - 1] ?? 0,
    display: spec.items.map((item) => item.price.display),
  };
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

export interface CafeHarnessOptions {
  /** Create the DOM chrome (timeline slider, HUD, inspect overlay). */
  readonly ui?: boolean;
  /** Mount point for the chrome; required when `ui` is true. */
  readonly container?: HTMLElement | null;
  /** Force the instant-swap path (used by suites that only need end state). */
  readonly reducedMotion?: boolean;
  readonly initialYear?: YearId;
  /** Step the choreography with fixed frames and record every signal. */
  readonly settleSeconds?: number;
}

/** Result of driving one era selection to completion. */
export interface SwitchReport {
  readonly year: YearId;
  /** Fixed frames stepped to reach the end state. */
  readonly steps: number;
  /** Scene time the choreography consumed, seconds. */
  readonly sceneSeconds: number;
  /** Completion signals the transition published while this switch ran. */
  readonly signals: readonly TransitionSignal[];
}

/** Deterministic end-to-end driver around one assembled café runtime. */
export interface CafeHarness {
  readonly composition: CafeComposition;
  readonly audioFactory: FakeContextFactory;
  readonly scheduler: ManualFrameScheduler;
  /** Every completion signal published since boot, in order. */
  readonly signals: readonly TransitionSignal[];
  /** Switches eras through the composition's own selection path. */
  switchTo(year: YearId, options?: { readonly maxSeconds?: number }): Promise<SwitchReport>;
  /** Steps frames until the choreography in flight settles on `year`. */
  settle(year: YearId, options?: { readonly maxSeconds?: number }): Promise<SwitchReport>;
  /** Advances the frame pipeline without changing era. */
  advance(seconds: number): number;
  /** Lets queued completion callbacks run. */
  idle(): Promise<void>;
  dispose(): void;
}

class Harness implements CafeHarness {
  readonly composition: CafeComposition;
  readonly audioFactory: FakeContextFactory;
  readonly scheduler: ManualFrameScheduler;
  private readonly signalLog: TransitionSignal[] = [];

  constructor(options: CafeHarnessOptions) {
    this.audioFactory = createFakeAudioContextFactory();
    this.scheduler = createManualFrameScheduler();
    const ui = options.ui === true;
    const shared: Partial<CafeCompositionOptions> = {
      scheduler: this.scheduler,
      initialYear: options.initialYear,
      reducedMotion: options.reducedMotion ?? false,
      audioOptions: { contextFactory: this.audioFactory.factory },
    };
    this.composition = ui
      ? createCafeComposition({
          ...shared,
          container: options.container ?? null,
          forceHeadless: true,
          ui: true,
          autoStart: false,
        })
      : bootHeadlessCafe(shared);
    this.composition.transition.onComplete((signal) => {
      this.signalLog.push(signal);
    });
  }

  get signals(): readonly TransitionSignal[] {
    return this.signalLog;
  }

  advance(seconds: number): number {
    const steps = Math.max(Math.round(seconds / STEP_SECONDS), 1);
    for (let step = 0; step < steps; step += 1) this.composition.tick(STEP_SECONDS);
    return steps;
  }

  async idle(): Promise<void> {
    for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
  }

  async switchTo(year: YearId, options: { readonly maxSeconds?: number } = {}): Promise<SwitchReport> {
    const before = this.signalLog.length;
    this.composition.selectYear(year);
    const report = await this.settle(year, options);
    return { ...report, signals: this.signalLog.slice(before) };
  }

  async settle(year: YearId, options: { readonly maxSeconds?: number } = {}): Promise<SwitchReport> {
    const maxSeconds = options.maxSeconds ?? DEFAULT_SETTLE_SECONDS;
    const before = this.signalLog.length;
    const target = this.composition.transition;
    let steps = 0;
    let sceneSeconds = 0;
    while (
      sceneSeconds < maxSeconds &&
      (target.isTransitioning || this.composition.year !== year || target.targetYear !== year)
    ) {
      this.composition.tick(STEP_SECONDS);
      steps += 1;
      sceneSeconds += STEP_SECONDS;
    }
    await this.idle();
    if (this.composition.year !== year) {
      throw new Error(
        `The ${year} transition did not settle within ${maxSeconds}s of scene time ` +
          `(reported ${this.composition.year}, status ${target.status}).`,
      );
    }
    return { year, steps, sceneSeconds, signals: this.signalLog.slice(before) };
  }

  dispose(): void {
    if (!this.composition.disposed) this.composition.dispose();
  }
}

/** Composes the café for a suite; the caller owns {@link CafeHarness.dispose}. */
export function createHarness(options: CafeHarnessOptions = {}): CafeHarness {
  return new Harness(options);
}

/** Waits for every pending microtask callback (transition completion handlers). */
export async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
}

/**
 * Mount point for the composed DOM chrome. Returns a detached `#app`-shaped
 * element appended to the document body, so the slider, HUD, enter gate and
 * inspect overlay mount exactly as they do in `index.html`.
 */
export function createMountPoint(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'app';
  container.setAttribute('data-cafe-app', 'true');
  document.body.appendChild(container);
  return container;
}

/** Removes a mount point created by {@link createMountPoint}. */
export function removeMountPoint(container: HTMLElement): void {
  container.remove();
}

/** Dispatches a keyboard event on the document (walk/inspect input path). */
export function pressKey(type: 'keydown' | 'keyup', code: string): void {
  const event = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true });
  (document as unknown as { dispatchEvent(event: Event): boolean }).dispatchEvent(event);
}
