/**
 * Counter technology domain suite (headless, node).
 *
 * The suite drives {@link CounterTechModule} the way the period registry and the
 * app composition layer will: build an era, assert its inventory, its placement
 * report, its hotspots and its animation, swap eras, and dispose. Nothing here
 * needs a GPU — the procedural surfaces fall back to `DataTexture`, so the same
 * pixels the browser uploads are exercised in node.
 *
 * Covered per era: the expected prop inventory (and the props the era must *not*
 * have), the named silhouettes the builder raises, the placement report against
 * the room and the shell's fixed geometry, the era's animation cues, and
 * disposal. Across eras: determinism, the absence of per-frame allocation,
 * replacement rather than accumulation on the timeline, and the hotspot anchors
 * inspect mode relies on.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  YEAR_IDS,
  isSceneModule,
  yearToNumber,
  type BuildContext,
  type PeriodDefinition,
  type YearId,
} from '../../contracts/period';
import { createSeededRandom } from '../../core/kernel';
import { CAFE_ROOM_BOUNDS, STRUCTURAL_LAYOUT, environmentSpec } from '../environment';
import {
  COUNTER_TECH_MODULE_ID,
  COUNTER_TECH_SPECS,
  COUNTER_DEVICE_BUILDERS,
  CounterTechModule,
  computeCounterAnimation,
  counterBandAnchors,
  counterBoxesOverlap,
  counterIslandRect,
  counterPlanSignature,
  counterShellClearanceBoxes,
  counterTechSpec,
  createCounterTechModule,
  describeCounterTechSpec,
  planCounterTech,
  validateCounterPlan,
  type CounterAnimationState,
  type CounterPropKind,
  type PlacedCounterProp,
} from './CounterTechModule';
import {
  COUNTER_MATERIAL_SLOTS,
  counterSurfaces,
  createCounterMaterialSet,
  disposeCounterMaterialSet,
  isCounterTexture,
} from './textures/labels';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** Every prop kind that belongs to a screen, a printer or a card reader. */
const ELECTRONIC_KINDS: readonly CounterPropKind[] = [
  'display-led',
  'crt-monitor',
  'tablet',
  'card-terminal',
  'contactless-reader',
  'tap-target',
  'loyalty-cards',
  'barcode-scanner',
  'scanner-goods',
  'ecr-body',
  'pos-terminal',
  'receipt-printer',
  'receipt-tape',
  'receipt-roll',
];

/** Prop kinds each era must build, and the ones it must not. */
const ERA_INVENTORY: Readonly<
  Record<YearId, { readonly required: readonly CounterPropKind[]; readonly forbidden: readonly CounterPropKind[] }>
> = Object.freeze({
  '1945': {
    required: [
      'till-body',
      'till-lid',
      'till-lever',
      'till-bell',
      'cash-drawer',
      'drawer-pull',
      'coin-tray',
      'docket-pad',
      'docket-pencil',
      'ledger',
      'price-card',
      'tip-jar',
    ],
    forbidden: [
      'display-led',
      'crt-monitor',
      'tablet',
      'tablet-stand',
      'card-terminal',
      'contactless-reader',
      'tap-target',
      'loyalty-cards',
      'barcode-scanner',
      'ecr-body',
      'pos-terminal',
      'register-body',
      'receipt-printer',
      'receipt-tape',
      'cable',
    ],
  },
  '1965': {
    required: ['register-body', 'register-crank', 'receipt-printer', 'receipt-tape', 'cash-drawer', 'coin-tray', 'printed-label'],
    forbidden: ['till-body', 'till-lever', 'till-bell', 'drawer-pull', 'display-led', 'crt-monitor', 'tablet', 'card-terminal', 'contactless-reader', 'ecr-body'],
  },
  '1985': {
    required: ['ecr-body', 'display-led', 'barcode-scanner', 'scanner-goods', 'receipt-roll', 'receipt-tape', 'cash-drawer', 'coin-tray'],
    forbidden: ['register-body', 'register-crank', 'till-body', 'till-lever', 'till-bell', 'crt-monitor', 'pos-terminal', 'tablet', 'card-terminal', 'contactless-reader'],
  },
  '2005': {
    required: ['pos-terminal', 'crt-monitor', 'receipt-printer', 'receipt-tape', 'card-terminal', 'loyalty-cards', 'cash-drawer', 'coin-tray', 'cable'],
    forbidden: ['ecr-body', 'display-led', 'register-body', 'register-crank', 'till-body', 'tablet', 'contactless-reader', 'barcode-scanner'],
  },
  '2025': {
    required: ['tablet', 'tablet-stand', 'contactless-reader', 'tap-target', 'qr-card', 'pickup-shelf', 'cash-drawer', 'coin-tray'],
    forbidden: ['crt-monitor', 'pos-terminal', 'ecr-body', 'display-led', 'register-body', 'register-crank', 'till-body', 'card-terminal', 'loyalty-cards', 'receipt-tape', 'receipt-printer'],
  },
});

/** Named parts each era's builder is expected to raise. */
const ERA_NODE_NAMES: Readonly<Record<YearId, readonly string[]>> = Object.freeze({
  '1945': [
    'counter-cash-drawer',
    'counter-till-body',
    'counter-till-body-plate',
    'counter-till-lever',
    'counter-till-bell',
    'counter-docket-pad',
    'counter-docket-pencil',
    'counter-coin-tray-divider-3',
    'counter-ledger-pages',
    'counter-tip-jar-coin-2',
  ],
  '1965': [
    'counter-register-body-keybank',
    'counter-register-body-dials',
    'counter-register-crank',
    'counter-receipt-printer-slot',
    'counter-receipt-tape',
    'counter-coin-tray-label-strip',
    'counter-printed-label-plate',
    'counter-cable-plug',
  ],
  '1985': [
    'counter-ecr-body-keypad',
    'counter-display-led-led-face',
    'counter-receipt-roll-roll',
    'counter-receipt-tape',
    'counter-barcode-scanner-read-lamp',
    'counter-scanner-goods-barcode',
    'counter-coin-tray-denominations',
  ],
  '2005': [
    'counter-pos-terminal-keyboard',
    'counter-crt-monitor-screen',
    'counter-crt-monitor-tilt-stand',
    'counter-receipt-printer-ready-lamp',
    'counter-receipt-tape',
    'counter-card-terminal-status-lamp',
    'counter-loyalty-cards-card-2',
    'counter-cable-connector',
  ],
  '2025': [
    'counter-tablet-screen',
    'counter-tablet-stand-pole',
    'counter-contactless-reader-led-ring',
    'counter-tap-target-disc',
    'counter-qr-card-card',
    'counter-pickup-shelf-header',
    'counter-pickup-shelf-ticket-2',
    'counter-cash-drawer-pull',
  ],
});

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

interface Rig {
  readonly module: CounterTechModule;
  readonly scene: THREE.Scene;
  readonly root: THREE.Object3D;
  readonly context: BuildContext;
}

function rigFor(year: YearId, options: { readonly seed?: number } = {}): Rig {
  const scene = new THREE.Scene();
  const root = new THREE.Object3D();
  root.name = 'world';
  scene.add(root);
  const module = createCounterTechModule({ seed: options.seed ?? 7 });
  const context: BuildContext = {
    scene,
    root,
    camera: new THREE.PerspectiveCamera(),
    bounds: CAFE_ROOM_BOUNDS,
    year,
    period: periodFor(year),
    random: createSeededRandom(yearToNumber(year)),
  };
  return { module, scene, root, context };
}

const openModules: CounterTechModule[] = [];

function build(year: YearId, options: { readonly seed?: number } = {}): Rig {
  const rig = rigFor(year, options);
  rig.module.build(rig.context);
  openModules.push(rig.module);
  return rig;
}

function updateAt(module: CounterTechModule, year: YearId, elapsedSeconds: number, deltaSeconds = 1 / 60): void {
  module.update(deltaSeconds, { year, elapsedSeconds, frame: Math.round(elapsedSeconds * 60) });
}

function namesOf(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((object) => {
    if (object.name.length > 0) names.push(object.name);
  });
  return names;
}

function countNodes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => {
    count += 1;
  });
  return count;
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
}

function animationSamples(
  animation: CounterTechSpecAnimation,
  year: YearId,
  seconds: readonly number[],
): CounterAnimationState[] {
  const target: CounterAnimationState = computeCounterAnimation(
    {
      year: null,
      elapsedSeconds: 0,
      displayKind: 'none',
      displayOn: false,
      displayGlow: 0,
      screenGlow: 0,
      tapeAdvance: 0,
      drawerOpen: false,
      drawerOffset: 0,
      tapActive: false,
      tapPulse: 0,
      tapCount: 0,
      crankTurn: 0,
      statusGlow: 0,
    },
    animation,
    year,
    0,
  );
  return seconds.map((second) => ({ ...computeCounterAnimation(target, animation, year, second) }));
}

type CounterTechSpecAnimation = (typeof COUNTER_TECH_SPECS)[YearId]['animation'];

afterEach(() => {
  for (const module of openModules.splice(0)) module.dispose();
});

/* -------------------------------------------------------------------------- */
/* Era data                                                                   */
/* -------------------------------------------------------------------------- */

describe('counter era data', () => {
  it('publishes five coherent eras keyed by year', () => {
    expect(Object.keys(COUNTER_TECH_SPECS).sort()).toEqual([...YEAR_IDS].sort());
    for (const year of YEAR_IDS) {
      const spec = counterTechSpec(year);
      expect(spec.year).toBe(year);
      expect(spec.label).toBe(year);
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.summary.length).toBeGreaterThan(0);
      expect(spec.caption.length).toBeGreaterThan(0);
      expect(spec.paletteName.length).toBeGreaterThan(0);
      expect(spec.materialSetId).toContain(year);
      expect(spec.tags?.length ?? 0).toBeGreaterThan(2);
      expect(spec.notes.length).toBeGreaterThan(0);
      expect(COUNTER_DEVICE_BUILDERS[spec.deviceFamily].family).toBe(spec.deviceFamily);
      expect(describeCounterTechSpec(spec)).toContain(year);
    }
  });

  it('gives every era a distinct device family, palette and material recipe set', () => {
    const families = new Set<string>();
    const palettes = new Set<string>();
    const signatures = new Set<string>();
    for (const year of YEAR_IDS) {
      const spec = counterTechSpec(year);
      families.add(spec.deviceFamily);
      palettes.add(spec.paletteName);
      const surfaces = counterSurfaces(spec);
      signatures.add(
        COUNTER_MATERIAL_SLOTS.map((slot) => `${slot}:${surfaces[slot].style.base}`).join('|'),
      );
    }
    expect(families.size).toBe(5);
    expect(palettes.size).toBe(5);
    expect(signatures.size).toBe(5);
  });

  it('keeps the animation recipe consistent with the era inventory', () => {
    for (const year of YEAR_IDS) {
      const spec = counterTechSpec(year);
      const kinds = spec.inventory.map((entry) => entry.kind);
      const hasPaper = kinds.includes('receipt-tape');
      const hasDisplay = kinds.some((kind) =>
        (['display-led', 'crt-monitor', 'tablet'] as readonly CounterPropKind[]).includes(kind),
      );
      expect(spec.animation.tapeSpeed > 0).toBe(hasPaper);
      expect(spec.animation.tapeLength > 0).toBe(hasPaper);
      if (hasDisplay) {
        expect(['led', 'crt', 'tablet']).toContain(spec.animation.displayKind);
      } else {
        expect(['none', 'mechanical-dial']).toContain(spec.animation.displayKind);
      }
      expect(spec.animation.drawerNudgeSeconds).toBeGreaterThan(spec.animation.drawerNudgeDuration);
      expect(spec.animation.drawerNudgeMetres).toBeGreaterThan(0);
      expect(spec.animation.cue.length).toBeGreaterThan(20);
      const ids = spec.inventory.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const entry of spec.inventory) {
        expect(entry.size.x).toBeGreaterThan(0);
        expect(entry.size.y).toBeGreaterThan(0);
        expect(entry.size.z).toBeGreaterThan(0);
        expect(entry.detail.length).toBeGreaterThan(10);
      }
    }
  });

  it('keeps the era payment modes and display kinds distinct', () => {
    expect(counterTechSpec('1945').payment.mode).toBe('cash-only');
    expect(counterTechSpec('1965').payment.mode).toBe('cash-only');
    expect(counterTechSpec('2025').payment.mode).toBe('contactless-first');
    expect(counterTechSpec('2005').animation.displayKind).toBe('crt');
    expect(counterTechSpec('1985').animation.displayKind).toBe('led');
    expect(counterTechSpec('2025').animation.tapPeriodSeconds).toBeGreaterThan(0);
    expect(counterTechSpec('2005').animation.tapPeriodSeconds).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

describe('counter placement plan', () => {
  it('derives the island from the published counter zone', () => {
    const island = counterIslandRect(STRUCTURAL_LAYOUT);
    const counter = STRUCTURAL_LAYOUT.counter;
    expect(island.minX).toBeCloseTo(counter.center.x - counter.width / 2 + 0.02, 6);
    expect(island.minZ).toBeCloseTo(counter.backFaceZ + 0.05, 6);
    expect(island.maxZ).toBeCloseTo(counter.serviceFaceZ - 0.02, 6);
    expect(island.datum).toBeGreaterThan(counter.surfaceHeight);
    const bands = counterBandAnchors(island, STRUCTURAL_LAYOUT);
    expect(bands['counter-back'].maxZ).toBeLessThanOrEqual(bands['counter-front'].minZ);
    expect(bands['counter-front'].maxZ).toBeLessThanOrEqual(bands['counter-lip'].minZ);
    expect(bands['counter-lip'].maxZ).toBeLessThanOrEqual(island.maxZ);
    expect(bands['floor-side'].support).toBe('floor');
  });

  it('plans every era inside the room, on its support and clear of the shell', () => {
    const problems: string[] = [];
    for (const year of YEAR_IDS) {
      const plan = planCounterTech({
        year,
        spec: counterTechSpec(year),
        layout: STRUCTURAL_LAYOUT,
        bounds: CAFE_ROOM_BOUNDS,
        seed: 3,
      });
      problems.push(...plan.report.problems.map((problem) => `${year}: ${problem}`));
      expect(plan.report.propCount).toBeGreaterThanOrEqual(10);
      expect(plan.report.clearance).toContain('counter-top-slab');
      expect(plan.report.clearance).toContain('counter-splashback');
      expect(plan.report.clearance).toContain('counter-pass-mat-3');
      expect(plan.report.anchorIds).toContain('counter-top-service-end');
      for (const entry of plan.entries) {
        expect(entry.min.y, `${year} ${entry.id} support`).toBeGreaterThanOrEqual(entry.supportHeight - 1e-6);
        expect(entry.max.x).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2 + 1e-6);
        expect(entry.min.x).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.width / 2 - 1e-6);
        expect(entry.max.z).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.depth / 2 + 1e-6);
        expect(entry.max.y).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.height + 1e-6);
      }
      const stacks = plan.entries.filter((entry) => entry.support === 'drawer');
      expect(stacks.length).toBeGreaterThan(0);
      for (const entry of stacks) {
        expect(entry.anchorId.startsWith('counter-drawer-shell:')).toBe(true);
      }
    }
    expect(problems).toEqual([]);
  });

  it('reports a problem when a prop is pushed into the shell', () => {
    const plan = planCounterTech({
      year: '1945',
      spec: counterTechSpec('1945'),
      layout: STRUCTURAL_LAYOUT,
      bounds: CAFE_ROOM_BOUNDS,
      seed: 1,
    });
    const first: PlacedCounterProp | undefined = plan.entries[0];
    expect(first).toBeDefined();
    if (!first) return;
    const broken: PlacedCounterProp = {
      ...first,
      center: { x: first.center.x, y: first.center.y, z: first.center.z + 0.75 },
      min: { ...first.min, z: first.min.z + 0.75 },
      max: { ...first.max, z: first.max.z + 0.75 },
    };
    const problems = validateCounterPlan(
      [broken, ...plan.entries.slice(1)],
      CAFE_ROOM_BOUNDS,
      STRUCTURAL_LAYOUT,
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((message) => message.includes('island'))).toBe(true);
    expect(counterShellClearanceBoxes(STRUCTURAL_LAYOUT).length).toBeGreaterThan(5);
  });

  it('never overlaps two props of the same era', () => {
    for (const year of YEAR_IDS) {
      const plan = planCounterTech({
        year,
        spec: counterTechSpec(year),
        layout: STRUCTURAL_LAYOUT,
        bounds: CAFE_ROOM_BOUNDS,
        seed: 2,
      });
      for (let first = 0; first < plan.entries.length; first += 1) {
        for (let second = first + 1; second < plan.entries.length; second += 1) {
          const a = plan.entries[first];
          const b = plan.entries[second];
          if (!a || !b) continue;
          expect(counterBoxesOverlap(a, b), `${year}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('is deterministic and independent of the module seed for the boxes', () => {
    const a = planCounterTech({
      year: '1985',
      spec: counterTechSpec('1985'),
      layout: STRUCTURAL_LAYOUT,
      bounds: CAFE_ROOM_BOUNDS,
      seed: 1,
    });
    const b = planCounterTech({
      year: '1985',
      spec: counterTechSpec('1985'),
      layout: STRUCTURAL_LAYOUT,
      bounds: CAFE_ROOM_BOUNDS,
      seed: 1,
    });
    const c = planCounterTech({
      year: '1985',
      spec: counterTechSpec('1985'),
      layout: STRUCTURAL_LAYOUT,
      bounds: CAFE_ROOM_BOUNDS,
      seed: 99,
    });
    expect(counterPlanSignature(a)).toBe(counterPlanSignature(b));
    expect(counterPlanSignature(a)).toBe(counterPlanSignature(c));
    expect(a.variationSeed).not.toBe(c.variationSeed);
  });
});

/* -------------------------------------------------------------------------- */
/* Building                                                                   */
/* -------------------------------------------------------------------------- */

describe('counter module build', () => {
  it('satisfies the SceneModule contract and reports its id', () => {
    const { module } = build('1945');
    expect(module.id).toBe(COUNTER_TECH_MODULE_ID);
    expect(isSceneModule(module)).toBe(true);
    expect(module.built).toBe(true);
    expect(module.spec?.year).toBe('1945');
    expect(module.node?.name).toBe('counter');
    expect(module.describe().family).toBe('manual-till');
  });

  it('builds exactly the era inventory, with the props the era forbids absent', () => {
    for (const year of YEAR_IDS) {
      const { module, root } = build(year);
      const kinds = module.kinds;
      for (const kind of ERA_INVENTORY[year].required) {
        expect(kinds, `${year} should build ${kind}`).toContain(kind);
      }
      for (const kind of ERA_INVENTORY[year].forbidden) {
        expect(kinds, `${year} should not build ${kind}`).not.toContain(kind);
      }
      expect(module.placements.length).toBe(kinds.length);
      expect(module.island?.maxX).toBeGreaterThan(module.island?.minX ?? 0);
      expect(countNodes(root)).toBe(module.nodeCount + 1)
      module.dispose();
    }
  });

  it('raises the named silhouettes every era promises', () => {
    for (const year of YEAR_IDS) {
      const { module } = build(year);
      const names = new Set(module.nodeNames);
      for (const expected of ERA_NODE_NAMES[year]) {
        expect(names.has(expected), `${year} is missing ${expected}`).toBe(true);
      }
      for (const mesh of meshesOf(module.node as THREE.Object3D)) {
        expect(mesh.geometry.attributes.position?.count ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every built prop inside the room and inside the island', () => {
    for (const year of YEAR_IDS) {
      const { module } = build(year);
      const island = module.island;
      expect(island).toBeDefined();
      if (!island) continue;
      for (const entry of module.placements) {
        if (entry.support === 'floor') {
          expect(entry.min.x).toBeGreaterThan(-CAFE_ROOM_BOUNDS.width / 2);
          expect(entry.max.x).toBeLessThan(CAFE_ROOM_BOUNDS.width / 2);
          continue;
        }
        expect(entry.min.x, `${year} ${entry.id}`).toBeGreaterThanOrEqual(island.minX - 1e-6);
        expect(entry.max.x, `${year} ${entry.id}`).toBeLessThanOrEqual(island.maxX + 1e-6);
        expect(entry.min.z, `${year} ${entry.id}`).toBeGreaterThanOrEqual(island.minZ - 1e-6);
        expect(entry.max.z, `${year} ${entry.id}`).toBeLessThanOrEqual(island.maxZ + 1e-6);
        expect(entry.min.y, `${year} ${entry.id}`).toBeGreaterThan(island.surfaceHeight);
      }
    }
  });

  it('stays inside the shared frame budget', () => {
    for (const year of YEAR_IDS) {
      const { module } = build(year);
      expect(module.meshCount, `${year} mesh budget`).toBeLessThanOrEqual(90);
      expect(module.meshCount).toBeGreaterThanOrEqual(20);
      expect(module.geometryCount).toBeLessThanOrEqual(module.meshCount);
      expect(module.materialCount).toBeLessThanOrEqual(module.meshCount + 1);
    }
  });

  it('dresses every era in its own procedural material set', () => {
    const signatures = new Set<string>();
    for (const year of YEAR_IDS) {
      const { module } = build(year);
      const set = module.materialSet;
      expect(set).toBeDefined();
      if (!set) continue;
      expect(set.year).toBe(year);
      expect(set.textureSource).toBe('data');
      expect(set.textures.length).toBe(COUNTER_MATERIAL_SLOTS.length);
      for (const texture of set.textures) expect(isCounterTexture(texture)).toBe(true);
      signatures.add(module.materialSignature ?? '');
    }
    expect(signatures.size).toBe(5);
  });

  it('builds the 1945 counter without a single powered device', () => {
    const { module } = build('1945');
    for (const kind of module.kinds) {
      expect(ELECTRONIC_KINDS).not.toContain(kind);
    }
    const cues = module.cueTargets;
    expect(cues?.displayMaterials.length).toBe(0);
    expect(cues?.tapeNodes.length).toBe(0);
    expect(cues?.tapRings.length).toBe(0);
    expect(cues?.leverNodes.length).toBe(1);
    expect(cues?.bellNodes.length).toBe(1);
    expect(module.animation.displayKind).toBe('none');
  });

  it('dresses the 2025 counter with a tablet, a tap pad, a QR card and a shelf', () => {
    const { module } = build('2025');
    expect(module.hasKind('tablet')).toBe(true);
    expect(module.hasKind('contactless-reader')).toBe(true);
    expect(module.hasKind('qr-card')).toBe(true);
    expect(module.hasKind('pickup-shelf')).toBe(true);
    const shelf = module.placements.find((entry) => entry.kind === 'pickup-shelf');
    expect(shelf?.support).toBe('floor');
    expect(shelf?.max.y).toBeLessThan(1.6);
    const cues = module.cueTargets;
    expect(cues?.displayMaterials.length).toBe(1);
    expect(cues?.tapRings.length).toBe(1);
    expect(cues?.tapLights.length).toBe(1);
    expect(counterTechSpec('2025').animation.tapPeriodSeconds).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Animation                                                                  */
/* -------------------------------------------------------------------------- */

describe('counter animation', () => {
  it('lights a display only in the electronic eras', () => {
    for (const year of YEAR_IDS) {
      const { module } = build(year);
      const cues = module.cueTargets;
      const hasDisplay = (['led', 'crt', 'tablet'] as readonly string[]).includes(
        counterTechSpec(year).animation.displayKind,
      );
      updateAt(module, year, 1.2);
      if (hasDisplay) {
        expect(cues?.displayMaterials.length, `${year} display`).toBeGreaterThan(0);
        expect(module.animation.displayGlow).toBeGreaterThan(0);
        for (const material of cues?.displayMaterials ?? []) {
          expect(material.emissiveIntensity).toBeGreaterThan(0);
        }
      } else {
        expect(cues?.displayMaterials.length).toBe(0);
        expect(module.animation.displayGlow).toBe(0);
      }
    }
  });

  it('blinks the 1985 LED face and breathes the 2005 and 2025 screens', () => {
    const led: Rig = build('1985');
    const samples = animationSamples(counterTechSpec('1985').animation, '1985', [0, 0.4, 1.2, 3.2]);
    expect(samples.some((sample) => sample.displayOn)).toBe(true);
    expect(samples.some((sample) => !sample.displayOn)).toBe(true);
    const glowValues = new Set(samples.map((sample) => sample.displayGlow.toFixed(4)));
    expect(glowValues.size).toBeGreaterThan(1);

    updateAt(led.module, '1985', 0.2);
    const firstGlow = led.module.animation.displayGlow;
    const ledFace = led.module.cueTargets?.displayMaterials[0];
    expect(ledFace?.emissiveIntensity).toBeGreaterThan(0);
    updateAt(led.module, '1985', 1.4);
    expect(led.module.animation.displayGlow).not.toBe(firstGlow);

    for (const year of ['2005', '2025'] as const) {
      const rig = build(year);
      const screenSamples = animationSamples(counterTechSpec(year).animation, year, [0, 1.1, 2.6]);
      const screenGlows = new Set(screenSamples.map((sample) => sample.screenGlow.toFixed(4)));
      expect(screenGlows.size, `${year} screen breathes`).toBeGreaterThan(1);
      updateAt(rig.module, year, 0.3);
      expect(rig.module.animation.screenGlow).toBeGreaterThan(0);
      expect(rig.module.cueTargets?.displayMaterials.length).toBeGreaterThan(0);
    }
  });

  it('feeds the receipt tape forward and scrolls its print', () => {
    for (const year of ['1965', '1985', '2005'] as const) {
      const { module } = build(year);
      const tape = module.cueTargets?.tapeNodes[0];
      expect(tape, `${year} tape`).toBeDefined();
      if (!tape) continue;
      updateAt(module, year, 0);
      const baseY = tape.position.y;
      const baseOffset = (tape as THREE.Mesh & { material: THREE.MeshStandardMaterial }).material.map?.offset.y ?? 0;
      updateAt(module, year, 1.6);
      expect(module.animation.tapeAdvance).toBeGreaterThan(0);
      expect(tape.position.y).toBeGreaterThan(baseY);
      const offset = (tape as THREE.Mesh & { material: THREE.MeshStandardMaterial }).material.map?.offset.y ?? 0;
      expect(offset).toBeGreaterThan(baseOffset);
      const samples = animationSamples(counterTechSpec(year).animation, year, [0.3, 0.8, 1.2]);
      expect(samples[2]?.tapeAdvance ?? 0).toBeGreaterThan(samples[0]?.tapeAdvance ?? 0);
    }
    for (const year of ['1945', '2025'] as const) {
      const { module } = build(year);
      updateAt(module, year, 4);
      expect(module.animation.tapeAdvance).toBe(0);
      expect(module.cueTargets?.tapeNodes.length).toBe(0);
    }
  });

  it('nudges the cash drawer in every era', () => {
    for (const year of YEAR_IDS) {
      const spec = counterTechSpec(year);
      const samples = animationSamples(spec.animation, year, Array.from({ length: 60 }, (_u, index) => index * 0.2));
      const open = samples.filter((sample) => sample.drawerOpen);
      expect(open.length, `${year} opens the drawer`).toBeGreaterThan(0);
      expect(samples.length - open.length, `${year} closes the drawer`).toBeGreaterThan(0);
      for (const sample of samples) {
        expect(sample.drawerOffset).toBeGreaterThanOrEqual(0);
        expect(sample.drawerOffset).toBeLessThanOrEqual(spec.animation.drawerNudgeMetres + 1e-9);
      }
      expect(samples[0]?.drawerOpen, `${year} starts closed`).toBe(false);

      const { module } = build(year);
      const drawer = module.cueTargets?.drawerNodes[0];
      expect(drawer).toBeDefined();
      if (!drawer) continue;
      updateAt(module, year, 0);
      const baseZ = drawer.position.z;
      const openAt = spec.animation.drawerNudgeSeconds - spec.animation.drawerNudgeSeconds * 0.4;
      updateAt(module, year, openAt + spec.animation.drawerNudgeDuration / 2);
      expect(module.animation.drawerOpen).toBe(true);
      expect(drawer.position.z).toBeLessThan(baseZ);
    }
  });

  it('acknowledges a 2025 contactless tap and leaves the other eras alone', () => {
    const spec = counterTechSpec('2025');
    const { module } = build('2025');
    const ring = module.cueTargets?.tapRings[0];
    expect(ring).toBeDefined();
    const lamp = module.cueTargets?.tapLights[0];
    expect(lamp).toBeDefined();

    updateAt(module, '2025', 0);
    expect(module.animation.tapActive).toBe(true);
    expect(module.animation.tapPulse).toBe(0);
    const idleLamp = lamp?.emissiveIntensity ?? 0;

    const tapStart = spec.animation.tapPeriodSeconds * 3 + 0.2;
    updateAt(module, '2025', tapStart);
    expect(module.animation.tapActive).toBe(true);
    expect(module.animation.tapCount).toBe(3);
    expect(module.animation.tapPulse).toBeGreaterThan(0);
    expect(ring?.visible).toBe(true);
    expect((lamp?.emissiveIntensity ?? 0)).toBeGreaterThan(0);
    const pulseScale = ring?.scale.x ?? 1;
    expect(pulseScale).toBeGreaterThan(1);
    expect((lamp?.emissiveIntensity ?? 0)).toBeLessThan(idleLamp);

    updateAt(module, '2025', spec.animation.tapPeriodSeconds * 3 + 5);
    expect(module.animation.tapActive).toBe(false);
    expect(module.animation.tapPulse).toBe(0);
    expect(ring?.visible).toBe(false);
    expect(ring?.scale.x).toBeCloseTo(1, 6);

    for (const year of ['1945', '1965', '1985', '2005'] as const) {
      const other = build(year);
      updateAt(other.module, year, 9);
      expect(other.module.animation.tapCount).toBe(0);
      expect(other.module.animation.tapActive).toBe(false);
      expect(other.module.cueTargets?.tapRings.length).toBe(0);
    }
  });

  it('is time driven and deterministic', () => {
    const a = build('2025', { seed: 4 });
    const b = build('2025', { seed: 4 });
    expect(a.module.plan?.signature).toBe(b.module.plan?.signature);
    for (const second of [0, 0.75, 3, 7.6, 12.4]) {
      updateAt(a.module, '2025', second);
      updateAt(b.module, '2025', second);
      expect(a.module.animation).toEqual(b.module.animation);
    }
    // The same elapsed second always yields the same state, whatever the order.
    updateAt(a.module, '2025', 0.75);
    const first = a.module.animationSnapshot();
    updateAt(a.module, '2025', 9.4);
    updateAt(a.module, '2025', 0.75);
    expect(a.module.animationSnapshot()).toEqual(first);
  });

  it('allocates nothing per frame', () => {
    const { module } = build('2005');
    updateAt(module, '2005', 0.5);
    const nodes = module.nodeCount;
    const geometries = module.geometryCount;
    const materials = module.materialCount;
    const resources = module.resourceCount;
    const animation = module.animation;
    const snapshot = module.animationSnapshot();
    for (let frame = 0; frame < 600; frame += 1) {
      updateAt(module, '2005', frame / 60, 1 / 60);
    }
    expect(module.animation).toBe(animation);
    expect(module.nodeCount).toBe(nodes);
    expect(module.geometryCount).toBe(geometries);
    expect(module.materialCount).toBe(materials);
    expect(module.resourceCount).toBe(resources);
    expect(module.updateCount).toBe(601);
    expect(Object.keys(module.animation).length).toBe(Object.keys(snapshot).length);
  });
});

/* -------------------------------------------------------------------------- */
/* Hotspots                                                                   */
/* -------------------------------------------------------------------------- */

describe('counter hotspots', () => {
  it('frames the register, the payment device and the counter surface for every era', () => {
    for (const year of YEAR_IDS) {
      const { module } = build(year);
      const hotspots = module.getHotspots();
      const ids = hotspots.map((hotspot) => hotspot.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const required of ['counter:register', 'counter:payment', 'counter:surface']) {
        expect(ids, `${year} ${required}`).toContain(required);
      }
      for (const hotspot of hotspots) {
        expect(hotspot.label.length).toBeGreaterThan(0);
        expect(hotspot.label).toContain(year);
        expect(hotspot.description ?? '').toContain(year);
        expect(hotspot.description ?? '').toContain(counterTechSpec(year).caption);
        expect(hotspot.radius).toBeGreaterThan(0.1);
        expect(hotspot.year).toBe(year);
        expect(hotspot.moduleId).toBe(COUNTER_TECH_MODULE_ID);
        expect(hotspot.anchor).toBeDefined();
        expect(Math.abs(hotspot.position.x)).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2);
        expect(Math.abs(hotspot.position.z)).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.depth / 2);
        expect(hotspot.position.y).toBeGreaterThanOrEqual(0);
        expect(hotspot.position.y).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.height);
      }
      const register = hotspots.find((hotspot) => hotspot.id === 'counter:register');
      const payment = hotspots.find((hotspot) => hotspot.id === 'counter:payment');
      expect(register?.kind).toBe('interactive');
      expect(payment?.kind).toBe('interactive');
      expect(hotspots.some((hotspot) => hotspot.kind === 'info')).toBe(true);
    }
  });

  it('targets the era device the caption promises', () => {
    const expectations: Readonly<Record<YearId, string>> = {
      '1945': 'Hallam',
      '1965': 'Norvic',
      '1985': 'Cirra',
      '2005': 'Meridian',
      '2025': 'CounterTab',
    };
    for (const year of YEAR_IDS) {
      const { module } = build(year);
      const register = module.getHotspots().find((hotspot) => hotspot.id === 'counter:register');
      expect(register?.label).toContain(expectations[year]);
    }
  });

  it('works before the first build so the overlay can frame an unbuilt era', () => {
    const module = createCounterTechModule({ initialYear: '1985' });
    openModules.push(module);
    const hotspots = module.getHotspots();
    expect(module.built).toBe(false);
    expect(hotspots.map((hotspot) => hotspot.id)).toContain('counter:register');
    expect(hotspots.map((hotspot) => hotspot.id)).toContain('counter:surface');
    expect(hotspots.every((hotspot) => hotspot.anchor === undefined)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Era swaps and disposal                                                     */
/* -------------------------------------------------------------------------- */

describe('counter era swaps', () => {
  it('replaces the era rather than accumulating it', () => {
    const rig = rigFor('1945');
    openModules.push(rig.module);
    rig.module.build(rig.context);
    const firstNodes = rig.module.nodeCount;
    const firstMeshes = rig.module.meshCount;

    const sequence: readonly YearId[] = ['2025', '1945', '1985', '2025', '1965', '2005', '1945'];
    for (const year of sequence) {
      rig.module.applyPeriod(periodFor(year), { ...rig.context, year, period: periodFor(year) });
      expect(rig.module.spec?.year).toBe(year);
      expect(rig.root.children.length).toBe(1);
      expect(rig.root.children[0]?.name).toBe('counter');
      expect(rig.module.nodeCount).toBe(year === '1945' ? firstNodes : rig.module.nodeCount);
      expect(rig.module.meshCount).toBeGreaterThan(15);
      expect(rig.module.placements.every((entry) => entry.id.length > 0)).toBe(true);
      expect(rig.module.getHotspots().length).toBeGreaterThanOrEqual(3);
    }
    rig.module.applyPeriod(periodFor('1945'), { ...rig.context, year: '1945', period: periodFor('1945') });
    expect(rig.module.nodeCount).toBe(firstNodes);
    expect(rig.module.meshCount).toBe(firstMeshes);
    expect(countNodes(rig.root)).toBe(firstNodes + 1);
  });

  it('disposes every tracked resource and is safe to call twice', () => {
    const rig = rigFor('2005');
    openModules.push(rig.module);
    rig.module.build(rig.context);
    expect(rig.module.resourceCount).toBeGreaterThan(0);
    const names = namesOf(rig.root);
    expect(names.length).toBeGreaterThan(20);
    rig.module.dispose();
    expect(rig.module.built).toBe(false);
    expect(rig.module.root).toBeUndefined();
    expect(rig.module.nodeCount).toBe(0);
    expect(rig.module.geometryCount).toBe(0);
    expect(rig.module.materialCount).toBe(0);
    expect(rig.module.resourceCount).toBe(0);
    expect(rig.root.children.length).toBe(0);
    rig.module.dispose();
    expect(rig.module.resourceCount).toBe(0);

    // Rebuilding after disposal is a fresh, complete counter.
    rig.module.build(rig.context);
    expect(rig.module.built).toBe(true);
    expect(rig.module.meshCount).toBeGreaterThan(15);
    expect(countNodes(rig.root)).toBe(rig.module.nodeCount + 1);
  });

  it('keeps the scene graph flat across a long timeline scrub', () => {
    const rig = rigFor('1945');
    openModules.push(rig.module);
    rig.module.build(rig.context);
    const baseline = rig.module.nodeCount;
    for (let pass = 0; pass < 4; pass += 1) {
      for (const year of YEAR_IDS) {
        rig.module.applyPeriod(periodFor(year), { ...rig.context, year, period: periodFor(year) });
        updateAt(rig.module, year, pass + 0.4);
      }
    }
    rig.module.applyPeriod(periodFor('1945'), { ...rig.context, year: '1945', period: periodFor('1945') });
    expect(rig.module.nodeCount).toBe(baseline);
    expect(rig.root.children.length).toBe(1);
    expect(rig.module.resourceCount).toBeLessThan(400);
  });
});

/* -------------------------------------------------------------------------- */
/* Material plumbing                                                          */
/* -------------------------------------------------------------------------- */

describe('counter material plumbing', () => {
  it('builds and releases a material set on its own', () => {
    const spec = counterTechSpec('1965');
    const set = createCounterMaterialSet(spec);
    expect(set.id).toContain('1965');
    expect(set.paletteName).toBe(spec.paletteName);
    expect(set.textures.length).toBe(COUNTER_MATERIAL_SLOTS.length);
    for (const slot of COUNTER_MATERIAL_SLOTS) {
      const material = set.slots[slot];
      expect(material.name).toBe(`counter:1965:${slot}`);
      expect(material.map).not.toBeNull();
    }
    disposeCounterMaterialSet(set);
    disposeCounterMaterialSet(set);
  });

  it('refuses to construct itself against a mismatched room', () => {
    expect(() => new CounterTechModule({ bounds: { width: 12, depth: 11, height: 3.6 } })).toThrow();
  });
});
