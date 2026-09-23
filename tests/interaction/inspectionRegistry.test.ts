/**
 * Chrono City — interaction and inspection suite.
 *
 * Covers the three halves of the task and how they compose:
 *  - `InspectionRegistry`: register/deregister/lookup, subtree resolution and
 *    the era-keyed label fallback chain, asserted for every `EraId`.
 *  - `PickingController`: raycast hover highlight (emissive clone + edge
 *    outline + pointer cursor), drag/pick disambiguation, and composition with
 *    the shared `SceneContext` tick loop.
 *  - `InfoCard`: click-to-inspect copy that is a pure function of
 *    `(objectId, EraId)`, re-rendered by the caller-supplied era.
 *
 * Everything runs in jsdom against the real Three.js math and the real
 * `SceneContext` (only the WebGL renderer is stubbed), and the picking tests
 * use the dev fixture inspectables, so the assertions exercise integrated
 * behaviour rather than mocked collaborators.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { DEFAULT_ERA, ERA_IDS, type EraId } from '../../src/core/eraContracts';
import { SceneContext } from '../../src/core/sceneContext';
import { INFO_CARD_SELECTORS, createInfoCard } from '../../src/interaction/infoCard';
import {
  DEFAULT_PICK_SYSTEM_ID,
  HIGHLIGHT_OUTLINE_NAME,
  HOVER_CURSOR,
  PickingController,
  createInspectionLayer,
} from '../../src/interaction/pickingController';
import {
  DEFAULT_HIGHLIGHT_STYLE,
  INSPECTION_REGISTRY_VERSION,
  InspectionRegistry,
  createInspectionRegistry,
  resolveRecordCopy,
  type InspectableCopyByEra,
  type InspectableRecord,
  type ResolvedInspectableCopy,
} from '../../src/interaction/inspectionRegistry';
import {
  FIXTURE_GROUP_NAME,
  FIXTURE_INSPECTABLES,
  FIXTURE_INSPECTABLE_IDS,
  createFixtureInspectables,
  createFixtureInspectionLayer,
  fixtureErasWithCopy,
  type FixtureInspectionLayer,
} from '../../src/interaction/fixtureInspectables';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;

/** Screen corner whose ray misses every fixture (above the horizon). */
const EMPTY_POINT = { x: 20, y: 15 } as const;

const CIVIC_HALL = 'civic-hall';
const DRUGSTORE = 'corner-drugstore';
const CLOCK = 'street-clock';

function stubRendererFactory(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    setAnimationLoop: () => {},
    dispose: () => {},
  };
  return stub as unknown as THREE.WebGLRenderer;
}

function copy(name: string, blurb: string) {
  return { name, blurb };
}

function createBox(name = 'box'): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  mesh.name = name;
  return mesh;
}

interface ScenarioOptions {
  readonly era?: EraId;
  readonly onSelect?: (resolution: ResolvedInspectableCopy | null) => void;
  readonly onHover?: (record: InspectableRecord | null) => void;
}

interface Scenario {
  readonly context: SceneContext;
  readonly layer: FixtureInspectionLayer;
  readonly overlay: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  dispose(): void;
}

const scenarios: Scenario[] = [];

/** Boots a real SceneContext with the fixture inspection layer on top. */
function createScenario(options: ScenarioOptions = {}): Scenario {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const overlay = document.createElement('div');
  overlay.setAttribute('data-chrono-overlay', '');
  container.appendChild(overlay);

  const context = new SceneContext({
    container,
    overlayRoot: overlay,
    createRenderer: stubRendererFactory,
    autoResize: false,
    autoStart: false,
  });
  context.resize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

  const layer = createFixtureInspectionLayer({
    context,
    overlayRoot: overlay,
    era: options.era ?? DEFAULT_ERA,
    onSelect: options.onSelect,
    onHover: options.onHover,
  });
  context.scene.updateMatrixWorld(true);

  let disposed = false;
  const scenario: Scenario = {
    context,
    layer,
    overlay,
    canvas: context.canvas,
    dispose() {
      if (disposed) return;
      disposed = true;
      layer.dispose();
      context.dispose();
      container.remove();
    },
  };
  scenarios.push(scenario);
  return scenario;
}

/** Points the camera straight at an object's centre from `distance` metres away. */
function aimCameraAt(context: SceneContext, object: THREE.Object3D, distance = 30): void {
  const center = object.getWorldPosition(new THREE.Vector3());
  context.camera.position.set(center.x, center.y + 4, center.z + distance);
  context.camera.lookAt(center);
  context.camera.updateMatrixWorld(true);
}

/** The client-space point an object's centre projects to. */
function screenPointOf(context: SceneContext, object: THREE.Object3D) {
  const projected = object.getWorldPosition(new THREE.Vector3()).project(context.camera);
  return {
    x: (projected.x * 0.5 + 0.5) * context.viewport.width,
    y: (-projected.y * 0.5 + 0.5) * context.viewport.height,
  };
}

function dispatchPointer(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): void {
  element.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
}

function clickCanvas(scenario: Scenario, point: { x: number; y: number }): void {
  dispatchPointer(scenario.canvas, 'pointerdown', point.x, point.y);
  dispatchPointer(scenario.canvas, 'pointerup', point.x, point.y);
}

function fixtureMesh(scenario: Scenario, objectId: string): THREE.Mesh {
  const mesh = scenario.layer.fixtures.meshFor(objectId);
  if (!mesh) throw new Error(`Fixture "${objectId}" is missing.`);
  return mesh;
}

afterEach(() => {
  while (scenarios.length > 0) scenarios.pop()?.dispose();
  document.body.replaceChildren();
});

/* ------------------------------------------------------------------ */
/* InspectionRegistry                                                  */
/* ------------------------------------------------------------------ */

describe('InspectionRegistry', () => {
  it('registers, looks up and lists inspectables in registration order', () => {
    const registry = createInspectionRegistry();
    expect(registry.version).toBe(INSPECTION_REGISTRY_VERSION);
    expect(registry.size).toBe(0);
    expect(registry.revision).toBe(0);

    const first = registry.register({
      id: 'town-hall',
      object: createBox('town-hall'),
      copy: { '1945': copy('Provisional Town Hall', 'Sandbagged stonework.') },
    });
    const second = registry.register({
      id: 'corner-store',
      object: createBox('corner-store'),
      copy: { '2025': copy('Civic Hub', 'Solar cladding and a co-working atrium.') },
    });

    expect(registry.size).toBe(2);
    expect(registry.has('town-hall')).toBe(true);
    expect(registry.get('town-hall')).toBe(first);
    expect(registry.require('corner-store')).toBe(second);
    expect(registry.ids()).toEqual(['town-hall', 'corner-store']);
    expect(registry.list().map((record) => record.id)).toEqual(['town-hall', 'corner-store']);
    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(registry.revision).toBe(2);
    expect(registry.pickTargets()).toEqual([first.object, second.object]);
  });

  it('rejects duplicate ids and malformed metadata', () => {
    const registry = new InspectionRegistry();
    const object = createBox();
    const eraCopy: InspectableCopyByEra = { '1945': copy('Hall', 'A hall.') };

    registry.register({ id: 'hall', object, copy: eraCopy });

    expect(() => registry.register({ id: 'hall', object, copy: eraCopy })).toThrow(
      /already registered/,
    );
    expect(() => registry.register({ id: '', object, copy: eraCopy })).toThrow(/non-empty/);
    expect(() =>
      registry.register({
        id: 'not-an-object',
        object: null as unknown as THREE.Object3D,
        copy: eraCopy,
      }),
    ).toThrow(/Object3D/);
    expect(() =>
      registry.register({
        id: 'bad-era',
        object,
        copy: { 1999: copy('Nope', 'Nope.') } as unknown as InspectableCopyByEra,
      }),
    ).toThrow(/unknown era/);
    expect(() =>
      registry.register({ id: 'empty-copy', object, copy: { '1945': copy('   ', 'Blurb.') } }),
    ).toThrow(/empty name/);
    expect(() => registry.require('missing')).toThrow(/No inspectable registered/);
  });

  it('supports a label-only record that falls back to its label', () => {
    const registry = new InspectionRegistry();
    registry.register({ id: 'flag-pole', object: createBox(), label: 'Flag pole' });

    const resolved = registry.resolve('flag-pole', '1965');
    expect(resolved?.name).toBe('Flag pole');
    expect(resolved?.blurb).toBe('');
    expect(resolved?.source).toBe('label');
    expect(resolved?.sourceEra).toBeNull();
    expect(resolved?.hasEraCopy).toBe(false);
  });

  it('deregisters, clears and notifies subscribers', () => {
    const registry = new InspectionRegistry();
    const actions: string[] = [];
    const unsubscribe = registry.subscribe((event) => actions.push(event.action));

    registry.register({ id: 'a', object: createBox(), copy: { '1985': copy('A', 'A blurb.') } });
    expect(registry.deregister('a')).toBe(true);
    expect(registry.deregister('a')).toBe(false);
    expect(registry.has('a')).toBe(false);
    expect(registry.size).toBe(0);

    registry.register({ id: 'b', object: createBox(), copy: { '2005': copy('B', 'B blurb.') } });
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
    expect(registry.pickTargets()).toEqual([]);
    expect(actions).toEqual(['register', 'deregister', 'register', 'clear']);

    unsubscribe();
    registry.register({ id: 'c', object: createBox(), copy: { '2025': copy('C', 'C blurb.') } });
    expect(actions).toHaveLength(4);
  });

  it('resolves a hit on a collected child to the registered root', () => {
    const registry = new InspectionRegistry();
    const root = new THREE.Group();
    root.name = 'kiosk';
    const child = createBox('kiosk-sign');
    root.add(child);

    const record = registry.register({
      id: 'kiosk',
      object: root,
      copy: { '1985': copy('News Kiosk', 'Papers and a cigarette machine.') },
    });

    expect(registry.findByObject(child)).toBe(record);
    expect(registry.findByObject(root)).toBe(record);
    expect(registry.findByObject(new THREE.Object3D())).toBeNull();
    expect(registry.findByObject(null)).toBeNull();
    expect(registry.pickTargets()).toEqual([root]);
    expect(registry.resolveObject(child, '1985')?.name).toBe('News Kiosk');
  });

  it('stops resolving an object once it is deregistered', () => {
    const registry = new InspectionRegistry();
    const object = createBox();
    registry.register({ id: 'bench', object, copy: { '1945': copy('Bench', 'A bench.') } });

    expect(registry.findByObject(object)?.id).toBe('bench');
    registry.deregister('bench');
    expect(registry.findByObject(object)).toBeNull();
    expect(registry.resolve('bench', '1945')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Era-keyed label resolution                                          */
/* ------------------------------------------------------------------ */

describe('era-keyed label resolution', () => {
  function registryWithFullCopy(): InspectionRegistry {
    const registry = new InspectionRegistry();
    const copyByEra: InspectableCopyByEra = Object.fromEntries(
      ERA_IDS.map((era) => [era, copy(`Hall ${era}`, `Blurb for ${era}.`)]),
    ) as InspectableCopyByEra;
    registry.register({ id: 'hall', object: createBox(), copy: copyByEra });
    return registry;
  }

  it('resolves the exact era copy for every EraId in the shared union', () => {
    const registry = registryWithFullCopy();

    for (const era of ERA_IDS) {
      const resolved = registry.resolve('hall', era);
      expect(resolved, `era ${era}`).not.toBeNull();
      expect(resolved?.objectId).toBe('hall');
      expect(resolved?.era).toBe(era);
      expect(resolved?.name).toBe(`Hall ${era}`);
      expect(resolved?.blurb).toBe(`Blurb for ${era}.`);
      expect(resolved?.source).toBe('era');
      expect(resolved?.sourceEra).toBe(era);
      expect(resolved?.hasEraCopy).toBe(true);
    }
  });

  it('is pure in (objectId, EraId): same arguments, same result, any order', () => {
    const registry = registryWithFullCopy();

    const first = registry.resolve('hall', '1985');
    for (const era of ERA_IDS) registry.resolve('hall', era);
    const again = registry.resolve('hall', '1985');

    expect(again).toEqual(first);
    expect(registry.resolve('hall', '1965')?.name).toBe('Hall 1965');
    expect(registry.resolve('unregistered', '1965')).toBeNull();
  });

  it('matches the exported pure resolver for a held record', () => {
    const registry = registryWithFullCopy();
    const record = registry.require('hall');

    expect(resolveRecordCopy(record, '2005')).toEqual(registry.resolve('hall', '2005'));
  });

  it('uses the authored fallbackCopy for a year the object does not cover', () => {
    const registry = new InspectionRegistry();
    registry.register({
      id: 'drugstore',
      object: createBox(),
      copy: {
        '1945': copy('Apothecary', 'Ration notices in the window.'),
        '1965': copy('Pharmacy', 'Neon script over a self-service aisle.'),
      },
      fallbackCopy: copy('Meridian Corner Store', 'Repainted sandstone bones.'),
    });

    for (const era of ['1985', '2005', '2025'] as const) {
      const resolved = registry.resolve('drugstore', era);
      expect(resolved?.era).toBe(era);
      expect(resolved?.name).toBe('Meridian Corner Store');
      expect(resolved?.blurb).toBe('Repainted sandstone bones.');
      expect(resolved?.source).toBe('fallback');
      expect(resolved?.sourceEra).toBeNull();
      expect(resolved?.hasEraCopy).toBe(false);
    }

    expect(registry.resolve('drugstore', '1945')?.source).toBe('era');
  });

  it('reuses the nearest authored era, preferring the older year on a tie', () => {
    const registry = new InspectionRegistry();
    registry.register({
      id: 'clock',
      object: createBox(),
      copy: {
        '1945': copy('Street Clock', 'Wound by hand every Monday.'),
        '2025': copy('Transit Clock', 'LED face synced to the tram network.'),
      },
    });

    const tie = registry.resolve('clock', '1985');
    expect(tie?.source).toBe('nearest-era');
    expect(tie?.sourceEra).toBe('1945');
    expect(tie?.name).toBe('Street Clock');
    expect(tie?.hasEraCopy).toBe(false);

    const nearer = registry.resolve('clock', '2005');
    expect(nearer?.sourceEra).toBe('2025');
    expect(nearer?.name).toBe('Transit Clock');

    expect(registry.resolve('clock', '2025')?.source).toBe('era');
  });
});

/* ------------------------------------------------------------------ */
/* Picking + hover highlight with the shared scene context             */
/* ------------------------------------------------------------------ */

describe('picking with the shared scene context', () => {
  it('registers its pick system on the context tick loop', () => {
    const scenario = createScenario();

    expect(scenario.context.hasSystem(DEFAULT_PICK_SYSTEM_ID)).toBe(true);
    expect(scenario.layer.picking.isAttached).toBe(true);
    expect(scenario.layer.picking.era).toBe(DEFAULT_ERA);
    expect(scenario.context.getSystem(DEFAULT_PICK_SYSTEM_ID)?.tick).toBeTypeOf('function');

    scenario.layer.dispose();
    expect(scenario.context.hasSystem(DEFAULT_PICK_SYSTEM_ID)).toBe(false);
    expect(scenario.layer.picking.isAttached).toBe(false);
  });

  it('hovers every registered fixture and restores it when the pointer leaves', () => {
    const scenario = createScenario();

    for (const objectId of FIXTURE_INSPECTABLE_IDS) {
      const mesh = fixtureMesh(scenario, objectId);
      const originalMaterial = mesh.material;
      aimCameraAt(scenario.context, mesh);

      const point = screenPointOf(scenario.context, mesh);
      scenario.layer.picking.setPointer(point.x, point.y);

      expect(scenario.layer.picking.hoveredId, objectId).toBe(objectId);
      expect(scenario.canvas.style.cursor).toBe(HOVER_CURSOR);

      const highlighted = mesh.material as THREE.MeshStandardMaterial;
      expect(highlighted, objectId).not.toBe(originalMaterial);
      expect(highlighted.emissive.getHex()).toBe(DEFAULT_HIGHLIGHT_STYLE.emissive);
      expect(highlighted.emissiveIntensity).toBe(DEFAULT_HIGHLIGHT_STYLE.emissiveIntensity);
      const outline = mesh.getObjectByName(HIGHLIGHT_OUTLINE_NAME);
      expect(outline, objectId).toBeInstanceOf(THREE.LineSegments);
      expect(outline?.parent).toBe(mesh);

      // Moving off the object clears the highlight.
      scenario.layer.picking.setPointer(EMPTY_POINT.x, EMPTY_POINT.y);
      expect(scenario.layer.picking.hoveredId, objectId).toBeNull();
      expect(mesh.material, objectId).toBe(originalMaterial);
      expect(mesh.getObjectByName(HIGHLIGHT_OUTLINE_NAME)).toBeUndefined();
      expect(scenario.layer.picking.hoverHighlight.isActive).toBe(false);
      expect(scenario.canvas.style.cursor).toBe('');
    }
  });

  it('clears hover and highlight on pointerleave', () => {
    const scenario = createScenario();
    const mesh = fixtureMesh(scenario, CIVIC_HALL);
    aimCameraAt(scenario.context, mesh);
    const point = screenPointOf(scenario.context, mesh);

    scenario.layer.picking.setPointer(point.x, point.y);
    expect(scenario.layer.picking.hoveredId).toBe(CIVIC_HALL);

    scenario.canvas.dispatchEvent(new MouseEvent('pointerleave'));
    expect(scenario.layer.picking.isPointerInside).toBe(false);
    expect(scenario.layer.picking.hoveredId).toBeNull();
    expect(scenario.layer.picking.hoverHighlight.isActive).toBe(false);
    expect(mesh.getObjectByName(HIGHLIGHT_OUTLINE_NAME)).toBeUndefined();
  });

  it('ignores inspectables that the era content has hidden', () => {
    const scenario = createScenario();
    const picking = scenario.layer.picking;
    const mesh = fixtureMesh(scenario, CIVIC_HALL);
    aimCameraAt(scenario.context, mesh);
    const point = screenPointOf(scenario.context, mesh);

    mesh.visible = false;
    expect(picking.pickAt(point.x, point.y)).toBeNull();

    picking.setPointer(point.x, point.y);
    expect(picking.hoveredId).toBeNull();

    mesh.visible = true;
    picking.setPointer(point.x, point.y);
    expect(picking.hoveredId).toBe(CIVIC_HALL);
  });

  it('picks an inspectable that appears under a stationary pointer on the next tick', () => {
    const scenario = createScenario();
    const picking = scenario.layer.picking;

    // Screen point whose ray currently misses everything.
    picking.setPointer(540, 195);
    expect(picking.hoveredId).toBeNull();

    // Drop a pickable box exactly on that ray and register it.
    scenario.context.camera.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0.35, 0.35), scenario.context.camera);
    const mesh = createBox('late-arrival');
    mesh.position.copy(raycaster.ray.at(40, new THREE.Vector3()));
    scenario.context.scene.add(mesh);
    scenario.context.scene.updateMatrixWorld(true);
    scenario.layer.registry.register({
      id: 'late-arrival',
      object: mesh,
      copy: { '2025': copy('Late Arrival', 'Registered after the pointer settled.') },
    });

    // No tick yet: the pointer has not moved, so nothing is hovered.
    expect(picking.hoveredId).toBeNull();

    scenario.context.tick(1 / 60);
    expect(picking.hoveredId).toBe('late-arrival');
    expect(picking.hoverHighlight.activeId).toBe('late-arrival');

    // Deregistering the hovered object clears the highlight immediately.
    scenario.layer.registry.deregister('late-arrival');
    expect(picking.hoveredId).toBeNull();
    expect(picking.hoverHighlight.isActive).toBe(false);
    expect(mesh.getObjectByName(HIGHLIGHT_OUTLINE_NAME)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Click to inspect + info card                                        */
/* ------------------------------------------------------------------ */

describe('click to inspect', () => {
  it('opens the info card for the clicked object and closes it on empty space', () => {
    const onSelect = vi.fn();
    const scenario = createScenario({ era: '1965', onSelect });
    const card = scenario.layer.infoCard;
    if (!card) throw new Error('The fixture layer must create an info card.');

    expect(card.isOpen).toBe(false);

    const mesh = fixtureMesh(scenario, CIVIC_HALL);
    aimCameraAt(scenario.context, mesh);
    clickCanvas(scenario, screenPointOf(scenario.context, mesh));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const resolution = onSelect.mock.calls[0]?.[0] as ResolvedInspectableCopy | null;
    expect(resolution?.objectId).toBe(CIVIC_HALL);
    expect(card.isOpen).toBe(true);
    expect(card.objectId).toBe(CIVIC_HALL);
    expect(card.era).toBe('1965');
    expect(card.element.hidden).toBe(false);
    expect(card.element.dataset.chronoInfoCardState).toBe('open');
    expect(scenario.overlay.contains(card.element)).toBe(true);
    expect(card.nameElement.textContent).toBe('Civic Administration Building');
    expect(card.blurbElement.textContent).toMatch(/concrete and aluminium/);
    expect(card.element.dataset.chronoCopySource).toBe('era');

    clickCanvas(scenario, EMPTY_POINT);
    expect(card.isOpen).toBe(false);
    expect(card.element.hidden).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[1]?.[0]).toBeNull();
  });

  it('treats a moving press as drag-look instead of a pick', () => {
    const onSelect = vi.fn();
    const scenario = createScenario({ era: '1985', onSelect });
    const card = scenario.layer.infoCard;
    const picking = scenario.layer.picking;
    const mesh = fixtureMesh(scenario, CIVIC_HALL);
    const originalMaterial = mesh.material;

    aimCameraAt(scenario.context, mesh);
    const point = screenPointOf(scenario.context, mesh);

    dispatchPointer(scenario.canvas, 'pointerdown', point.x, point.y);
    dispatchPointer(scenario.canvas, 'pointermove', point.x + 40, point.y + 12);

    expect(picking.isDragging).toBe(true);
    expect(picking.hoveredId).toBeNull();
    expect(mesh.material).toBe(originalMaterial);

    // Hover stays suspended while the drag continues, even over an object.
    const clock = fixtureMesh(scenario, CLOCK);
    aimCameraAt(scenario.context, clock);
    const clockPoint = screenPointOf(scenario.context, clock);
    dispatchPointer(scenario.canvas, 'pointermove', clockPoint.x + 60, clockPoint.y);

    expect(picking.hoveredId).toBeNull();
    dispatchPointer(scenario.canvas, 'pointerup', clockPoint.x + 60, clockPoint.y);

    expect(onSelect).not.toHaveBeenCalled();
    expect(card?.isOpen).toBe(false);
    expect(picking.isDragging).toBe(false);
  });

  it('ignores a press that outlasts the click window', () => {
    const onSelect = vi.fn();
    const scenario = createScenario({ onSelect });
    const picking = scenario.layer.picking;
    const mesh = fixtureMesh(scenario, CIVIC_HALL);
    aimCameraAt(scenario.context, mesh);
    const point = screenPointOf(scenario.context, mesh);

    picking.pressPointer(point.x, point.y, { timeMs: 1000 });
    picking.releasePointer(point.x, point.y, { timeMs: 1000 + 5_000 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(scenario.layer.infoCard?.isOpen).toBe(false);
    // The pointer is still over the object, so a tick keeps it highlighted.
    expect(picking.hoveredId).toBe(CIVIC_HALL);
  });

  it('picks the nearest registered object when reveals overlap', () => {
    const scenario = createScenario();
    const picking = scenario.layer.picking;
    const context = scenario.context;

    const front = createBox('front-panel');
    const back = createBox('back-panel');

    context.camera.position.set(0, 0, 20);
    context.camera.lookAt(0, 0, 0);
    context.camera.updateMatrixWorld(true);

    front.position.set(0, 0, 3);
    back.position.set(0, 0, -3);
    context.scene.add(front, back);
    context.scene.updateMatrixWorld(true);

    scenario.layer.registry.register({
      id: 'front-panel',
      object: front,
      copy: { '2025': copy('Front Panel', 'Closer to the camera.') },
    });
    scenario.layer.registry.register({
      id: 'back-panel',
      object: back,
      copy: { '2025': copy('Back Panel', 'Further from the camera.') },
    });

    // Fix the camera again: adding to the scene must not move it.
    context.camera.position.set(0, 0, 20);
    context.camera.lookAt(0, 0, 0);
    context.camera.updateMatrixWorld(true);

    picking.setPointer(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
    expect(picking.hoveredId).toBe('front-panel');
  });
});

/* ------------------------------------------------------------------ */
/* Per-era info card copy                                              */
/* ------------------------------------------------------------------ */

describe('per-era info card copy', () => {
  it('renders each year’s copy for one object across all five EraIds', () => {
    const scenario = createScenario({ era: '1945' });
    const card = scenario.layer.infoCard;
    if (!card) throw new Error('The fixture layer must create an info card.');

    const mesh = fixtureMesh(scenario, CIVIC_HALL);
    aimCameraAt(scenario.context, mesh);
    clickCanvas(scenario, screenPointOf(scenario.context, mesh));
    expect(card.isOpen).toBe(true);
    expect(card.nameElement.textContent).toBe('Provisional Town Hall');

    const names = new Set<string>();
    for (const era of ERA_IDS) {
      scenario.layer.setEra(era);
      const expected = scenario.layer.registry.resolve(CIVIC_HALL, era);
      expect(expected, era).not.toBeNull();

      expect(scenario.layer.era).toBe(era);
      expect(card.era).toBe(era);
      expect(card.eraElement.textContent).toBe(era);
      expect(card.nameElement.textContent).toBe(expected?.name);
      expect(card.blurbElement.textContent).toBe(expected?.blurb);
      expect(card.element.dataset.chronoCopySource).toBe('era');
      expect(card.element.dataset.chronoSourceEra).toBe(era);
      names.add(expected?.name ?? '');
    }

    // Every year has its own identity, which is the point of the per-year keys.
    expect(names.size).toBe(ERA_IDS.length);
    expect(card.element.dataset.chronoObjectId).toBe(CIVIC_HALL);
  });

  it('renders authored fallback copy when a year is missing', () => {
    const scenario = createScenario({ era: '2025' });
    const card = scenario.layer.infoCard;
    if (!card) throw new Error('The fixture layer must create an info card.');

    const resolution = scenario.layer.open(DRUGSTORE);

    expect(resolution?.source).toBe('fallback');
    expect(card.isOpen).toBe(true);
    expect(card.nameElement.textContent).toBe('Meridian Corner Store');
    expect(card.blurbElement.textContent).toMatch(/sandstone bones/);
    expect(card.element.dataset.chronoCopySource).toBe('fallback');
  });

  it('reuses the nearest authored era when a year has no copy and no fallback', () => {
    const scenario = createScenario({ era: '2005' });
    const card = scenario.layer.infoCard;
    if (!card) throw new Error('The fixture layer must create an info card.');

    const clock = FIXTURE_INSPECTABLES.find((definition) => definition.id === CLOCK);
    const resolution = scenario.layer.open(CLOCK);

    expect(resolution?.source).toBe('nearest-era');
    expect(resolution?.sourceEra).toBe('1985');
    expect(resolution?.blurb).toBe(clock?.copy['1985']?.blurb);
    expect(card.nameElement.textContent).toBe('Street Clock');
    expect(card.element.dataset.chronoCopySource).toBe('nearest-era');
  });

  it('keeps the era of one layer independent from the era of another', () => {
    const past = createScenario({ era: '1945' });
    const present = createScenario({ era: '2025' });

    expect(past.layer.open(CIVIC_HALL)?.name).toBe('Provisional Town Hall');
    expect(present.layer.open(CIVIC_HALL)?.name).toBe('Civic Hub');

    past.layer.setEra('2025');
    present.layer.setEra('1945');

    expect(past.layer.era).toBe('2025');
    expect(past.layer.infoCard?.nameElement.textContent).toBe('Civic Hub');
    expect(present.layer.era).toBe('1945');
    expect(present.layer.infoCard?.nameElement.textContent).toBe('Provisional Town Hall');

    expect(() => past.layer.setEra('1999' as EraId)).toThrow(/Unknown era/);
    expect(past.layer.era).toBe('2025');
  });

  it('re-renders an open card on the caller’s year change and hides when closed', () => {
    const scenario = createScenario({ era: '1965' });
    const card = scenario.layer.infoCard;
    if (!card) throw new Error('The fixture layer must create an info card.');

    scenario.layer.open(CIVIC_HALL);
    expect(card.nameElement.textContent).toBe('Civic Administration Building');

    scenario.layer.setEra('2025');
    expect(card.isOpen).toBe(true);
    expect(card.nameElement.textContent).toBe('Civic Hub');

    scenario.layer.close();
    expect(card.isOpen).toBe(false);

    // A closed card stays closed when the year moves.
    scenario.layer.setEra('1945');
    expect(card.isOpen).toBe(false);
    expect(card.nameElement.textContent).toBe('');
  });

  it('can be built with picking only, without a DOM card', () => {
    const context = new SceneContext({
      createRenderer: stubRendererFactory,
      autoResize: false,
      autoStart: false,
    });
    context.resize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    const layer = createInspectionLayer({ context, infoCard: false, era: '1985' });

    expect(layer.infoCard).toBeNull();
    expect(layer.isOpen).toBe(false);
    expect(context.hasSystem(DEFAULT_PICK_SYSTEM_ID)).toBe(true);
    expect(layer.open('nothing-registered')).toBeNull();

    layer.dispose();
    context.dispose();
  });
});

/* ------------------------------------------------------------------ */
/* InfoCard in isolation                                               */
/* ------------------------------------------------------------------ */

describe('InfoCard', () => {
  function registryWithOneObject(): InspectionRegistry {
    const registry = new InspectionRegistry();
    registry.register({
      id: 'relay-box',
      object: createBox(),
      copy: { '1985': copy('Relay Box', 'Painted shut since the blackout.') },
      fallbackCopy: copy('Relay Box', 'The housing outlived its equipment.'),
    });
    return registry;
  }

  it('shows resolved copy, exposes query hooks and hides for unknown ids', () => {
    const registry = registryWithOneObject();
    const root = document.createElement('div');
    root.setAttribute('data-chrono-overlay', '');
    document.body.appendChild(root);

    const card = createInfoCard({
      root,
      resolve: (objectId, era) => registry.resolve(objectId, era),
    });

    expect(card.isOpen).toBe(false);
    expect(card.element.hidden).toBe(true);
    expect(card.element.dataset.chronoInfoCardState).toBe('closed');

    const shown = card.show('relay-box', '1985');
    expect(shown?.name).toBe('Relay Box');
    expect(card.element.dataset.chronoInfoCardState).toBe('open');
    expect(root.querySelector(INFO_CARD_SELECTORS.card)).toBe(card.element);
    expect(root.querySelector(INFO_CARD_SELECTORS.name)?.textContent).toBe('Relay Box');
    expect(root.querySelector(INFO_CARD_SELECTORS.blurb)?.textContent).toBe(
      'Painted shut since the blackout.',
    );
    expect(root.querySelector(INFO_CARD_SELECTORS.era)?.textContent).toBe('1985');
    expect(root.querySelector(INFO_CARD_SELECTORS.meta)?.textContent).toContain('era copy');

    expect(card.show('unknown', '1985')).toBeNull();
    expect(card.isOpen).toBe(false);

    card.dispose();
    expect(root.contains(card.element)).toBe(false);
    expect(root.querySelector(INFO_CARD_SELECTORS.card)).toBeNull();
  });

  it('re-resolves through the era setter and reports provenance', () => {
    const registry = registryWithOneObject();
    const card = createInfoCard({
      root: document.body,
      resolve: (objectId, era) => registry.resolve(objectId, era),
    });

    card.show('relay-box', '1985');
    const fallback = card.setEra('2025');

    expect(fallback?.source).toBe('fallback');
    expect(card.nameElement.textContent).toBe('Relay Box');
    expect(card.element.dataset.chronoCopySource).toBe('fallback');
    expect(card.element.dataset.chronoSourceEra).toBe('');

    card.dispose();
  });

  it('closes on the close button and on Escape', () => {
    const registry = registryWithOneObject();
    const onClose = vi.fn();
    const card = createInfoCard({
      root: document.body,
      resolve: (objectId, era) => registry.resolve(objectId, era),
      onClose,
    });

    card.show('relay-box', '1985');
    card.closeButton?.click();
    expect(card.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);

    card.show('relay-box', '1985');
    expect(card.isOpen).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);

    // Programmatic hide does not run the close callback.
    card.show('relay-box', '1985');
    card.hide();
    expect(onClose).toHaveBeenCalledTimes(2);

    card.dispose();
  });
});

/* ------------------------------------------------------------------ */
/* Fixture content                                                     */
/* ------------------------------------------------------------------ */

describe('fixture inspectables', () => {
  it('creates meshes, registers them and tears both down', () => {
    const registry = new InspectionRegistry();
    const parent = new THREE.Scene();

    const fixtures = createFixtureInspectables(registry, { parent });

    expect(registry.size).toBe(FIXTURE_INSPECTABLES.length);
    expect(registry.ids()).toEqual(FIXTURE_INSPECTABLE_IDS);
    expect(parent.getObjectByName(FIXTURE_GROUP_NAME)).toBe(fixtures.group);
    expect(fixtures.meshes).toHaveLength(FIXTURE_INSPECTABLES.length);
    expect(fixtures.meshFor(CLOCK)).toBeInstanceOf(THREE.Mesh);
    expect(fixtures.meshFor('missing')).toBeNull();
    expect(fixtures.records.map((record) => record.id)).toEqual(FIXTURE_INSPECTABLE_IDS);

    fixtures.dispose();
    expect(registry.size).toBe(0);
    expect(parent.children).toHaveLength(0);
    fixtures.dispose();
    expect(registry.size).toBe(0);
  });

  it('ships full copy for the fixtures that exercise the happy path', () => {
    const civicHall = FIXTURE_INSPECTABLES.find((definition) => definition.id === CIVIC_HALL);
    const drugstore = FIXTURE_INSPECTABLES.find((definition) => definition.id === DRUGSTORE);
    const clock = FIXTURE_INSPECTABLES.find((definition) => definition.id === CLOCK);

    expect(fixtureErasWithCopy(civicHall!)).toEqual([...ERA_IDS]);
    expect(fixtureErasWithCopy(drugstore!)).toEqual(['1945', '1965', '1985', '2005']);
    expect(drugstore?.fallbackCopy?.name).toBe('Meridian Corner Store');
    expect(fixtureErasWithCopy(clock!)).toEqual(['1945', '1965', '1985', '2025']);

    for (const definition of FIXTURE_INSPECTABLES) {
      expect(fixtureErasWithCopy(definition).length, definition.id).toBeGreaterThan(0);
    }
  });

  it('is reachable through the picking controller for every fixture', () => {
    const scenario = createScenario();

    for (const objectId of FIXTURE_INSPECTABLE_IDS) {
      const mesh = fixtureMesh(scenario, objectId);
      aimCameraAt(scenario.context, mesh);
      const point = screenPointOf(scenario.context, mesh);

      expect(scenario.layer.picking.pickAt(point.x, point.y)?.id, objectId).toBe(objectId);
    }
  });

  it('keeps the picking controller usable through the direct constructor', () => {
    const context = new SceneContext({
      createRenderer: stubRendererFactory,
      autoResize: false,
      autoStart: false,
    });
    context.resize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    const registry = createInspectionRegistry();
    const events: string[] = [];
    const controller = new PickingController({
      context,
      registry,
      era: '2005',
      autoAttach: false,
      onHover: (record) => events.push(`hover:${record?.id ?? 'none'}`),
      onEraChanged: (era) => events.push(`era:${era}`),
    });

    expect(controller.isAttached).toBe(false);
    expect(controller.era).toBe('2005');
    expect(context.hasSystem(DEFAULT_PICK_SYSTEM_ID)).toBe(false);

    controller.attach();
    expect(controller.isAttached).toBe(true);
    expect(context.hasSystem(DEFAULT_PICK_SYSTEM_ID)).toBe(true);
    expect(controller.pickAt(400, 300)).toBeNull();

    // The year change is caller-driven, and reporting it is idempotent.
    controller.setEra('1965');
    expect(controller.era).toBe('1965');
    controller.setEra('1965');
    expect(events).toEqual(['era:1965']);

    controller.detach();
    expect(controller.isAttached).toBe(false);
    expect(context.hasSystem(DEFAULT_PICK_SYSTEM_ID)).toBe(false);

    controller.dispose();
    context.dispose();
  });
});
