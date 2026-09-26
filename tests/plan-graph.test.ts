/**
 * Task nodes, phase tiers, dependency conduits and pointer picking.
 *
 * Everything here runs over the *shared* foundation contracts: the headless
 * render adapter (a real three.js scene, no GPU) and `createSampleState` fixture
 * state. The tests assert observable behaviour — which polyhedron a status is
 * drawn with, how many instances each status group holds, when a conduit lights
 * and where its energy head is, what a pointer resolves to, what disposal
 * releases — rather than implementation counters.
 */

import { describe, expect, it } from 'vitest';
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  OctahedronGeometry,
  PerspectiveCamera,
  Quaternion,
  TetrahedronGeometry,
  Vector2,
  Vector3,
} from 'three';

import { createGame } from '../src/game/Game';
import { createHeadlessAdapter } from '../src/render/headless';
import {
  CONDUIT_DEFAULTS,
  conduitGlow,
  conduitPulseU,
  conduitTravelWave,
  createConduitPath,
  sampleConduitPoint,
} from '../src/render/edges';
import {
  PLAN_GRAPH_NAMES,
  PLAN_GRAPH_STATUSES,
  TASK_STATUS_PALETTE,
  classifyNodeStatus,
  createNodeGlyphGeometry,
  createNodeShapeGeometry,
  createPhaseTierLayout,
  createPlanGraphSystem,
  createPlanGraphView,
  nodeStatusGlow,
  planSignature,
  pointerToNdc,
  screenAnchorOf,
  type PlanGraphView,
  type PlanNodeStatus,
} from '../src/render/nodes';
import { createSampleState } from '../src/sim/fixtures';
import {
  applyDomainEvents,
  makeDomainEvent,
  type DeepReadonly,
  type DomainEvent,
  type GameState,
  type TaskStatus,
} from '../src/sim/state';
import {
  createPlanGraphDirector,
  createPlanGraphScenarios,
  createSelectionController,
  describePlanGraph,
  inspectionKey,
  inspectionText,
  selectBusiestTask,
} from '../dev-preview/plan-graph';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const SAMPLE = createSampleState();

/** Apply events at a deterministic offset from the state's simulated clock. */
function advance(state: GameState, events: readonly DomainEvent[], offsetMs = 500): GameState {
  const at = state.mission.elapsedMs + offsetMs;
  return applyDomainEvents(
    state,
    events.map((event) => ({ ...event, at }) as DomainEvent),
  );
}

function withTaskStatus(
  state: GameState,
  taskId: string,
  status: TaskStatus,
  progress?: number,
): GameState {
  return advance(
    state,
    [
      makeDomainEvent(
        'plan/task-updated',
        progress === undefined ? { taskId, status } : { taskId, status, progress },
        0,
      ),
    ],
    500,
  );
}

/** Move a state's simulated clock forward without changing its structure. */
function atClock(state: GameState, elapsedMs: number): GameState {
  return { ...state, mission: { ...state.mission, elapsedMs } };
}

/** Mount the view over a headless adapter and draw the given state once. */
function mountView(state: GameState): {
  adapter: ReturnType<typeof createHeadlessAdapter>;
  view: PlanGraphView;
} {
  const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
  const view = createPlanGraphView(adapter.scene);
  view.setCamera(adapter.camera);
  view.update(state);
  return { adapter, view };
}

/** Per-instance scale, read back out of the instance transform attribute. */
function instanceScale(mesh: InstancedMesh, index: number): number {
  const matrix = new Matrix4();
  const scale = new Vector3();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(new Vector3(), new Quaternion(), scale);
  return scale.x;
}

/** Aim a camera radially outward from the tower so a node is dead centre. */
function aimAtNode(camera: PerspectiveCamera, center: Vector3): void {
  const radial = new Vector3(center.x, 0, center.z);
  if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
  radial.normalize();
  camera.position.set(center.x + radial.x * 30, center.y, center.z + radial.z * 30);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/* -------------------------------------------------------------------------- */
/* Status palette                                                             */
/* -------------------------------------------------------------------------- */

describe('status palette', () => {
  it('publishes the mandated colours', () => {
    expect(TASK_STATUS_PALETTE.queued.color).toBe(0x5c7f9e);
    expect(TASK_STATUS_PALETTE.running.color).toBe(0x35f0ff);
    expect(TASK_STATUS_PALETTE.verifying.color).toBe(0xffc15c);
    expect(TASK_STATUS_PALETTE.passed.color).toBe(0x59ff9b);
    expect(TASK_STATUS_PALETTE.failed.color).toBe(0xff2d6f);
    expect(TASK_STATUS_PALETTE.superseded.color).toBe(0x6f5a9c);
  });

  it('codes every status redundantly: colour, polyhedron and glyph', () => {
    const colors = new Set<number>();
    const shapes = new Set<string>();
    const glyphs = new Set<string>();

    for (const status of PLAN_GRAPH_STATUSES) {
      const visual = TASK_STATUS_PALETTE[status];
      expect(visual.status).toBe(status);
      expect(visual.label.length).toBeGreaterThan(0);
      expect(visual.meaning.length).toBeGreaterThan(20);
      colors.add(visual.color);
      shapes.add(visual.shape);
      glyphs.add(visual.glyph);
    }

    // No two statuses share a colour, a shape or a badge.
    expect(colors.size).toBe(PLAN_GRAPH_STATUSES.length);
    expect(shapes.size).toBe(PLAN_GRAPH_STATUSES.length);
    expect(glyphs.size).toBe(PLAN_GRAPH_STATUSES.length);
  });

  it('gives every status a distinct polyhedron and a non-empty badge', () => {
    const types = new Set<string>();
    for (const status of PLAN_GRAPH_STATUSES) {
      const visual = TASK_STATUS_PALETTE[status];
      const body = createNodeShapeGeometry(visual.shape);
      types.add(body.type);
      expect(body.getAttribute('position').count).toBeGreaterThan(3);
      body.dispose();

      const badge = createNodeGlyphGeometry(visual.glyph);
      expect(badge.getAttribute('position').count).toBeGreaterThan(3);
      badge.dispose();
    }
    expect(types.size).toBe(PLAN_GRAPH_STATUSES.length);
  });

  it('draws each status with the polyhedron its palette names', () => {
    expect(createNodeShapeGeometry('tetrahedron')).toBeInstanceOf(TetrahedronGeometry);
    expect(createNodeShapeGeometry('octahedron')).toBeInstanceOf(OctahedronGeometry);
    expect(createNodeShapeGeometry('dodecahedron')).toBeInstanceOf(DodecahedronGeometry);
    expect(createNodeShapeGeometry('icosahedron')).toBeInstanceOf(IcosahedronGeometry);
    expect(createNodeShapeGeometry('hex-prism')).toBeInstanceOf(CylinderGeometry);
    expect(createNodeShapeGeometry('pyramid')).toBeInstanceOf(ConeGeometry);
  });

  it('maps the plan lifecycle onto the six visual statuses', () => {
    expect(classifyNodeStatus('pending', 'build')).toBe('queued');
    expect(classifyNodeStatus('running', 'build')).toBe('running');
    expect(classifyNodeStatus('running', 'verify')).toBe('verifying');
    expect(classifyNodeStatus('passed', 'integrate')).toBe('passed');
    expect(classifyNodeStatus('failed', 'build')).toBe('failed');
    expect(classifyNodeStatus('blocked', 'observe')).toBe('superseded');
  });

  it('breathes only the statuses that are still moving', () => {
    expect(nodeStatusGlow('queued', 5_000, 0)).toBe(1);
    expect(nodeStatusGlow('superseded', 5_000, 0)).toBe(1);
    const early = nodeStatusGlow('running', 0, 0);
    const quarter = nodeStatusGlow('running', 600, 0);
    expect(early).toBeCloseTo(0.5, 6);
    expect(quarter).toBeCloseTo(1, 6);
    for (const status of PLAN_GRAPH_STATUSES) {
      expect(nodeStatusGlow(status, 900, 2)).toBeGreaterThanOrEqual(0);
      expect(nodeStatusGlow(status, 900, 2)).toBeLessThanOrEqual(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Phase tier layout                                                          */
/* -------------------------------------------------------------------------- */

describe('phase tier layout', () => {
  it('rests every task on a tier that follows its dependency chain', () => {
    const layout = createPhaseTierLayout(SAMPLE);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(layout.nodes.length).toBe(SAMPLE.plan.order.length);
    expect(byId.get('task-shell')?.tier).toBe(0);
    expect(byId.get('task-contract')?.tier).toBe(1);
    expect(byId.get('task-lane-comets')?.tier).toBe(2);
    expect(byId.get('task-economy')?.tier).toBe(2);
    expect(byId.get('task-constellation')?.tier).toBe(3);
    expect(byId.get('task-review')?.tier).toBe(4);
    expect(layout.tiers.length).toBe(5);

    for (const tier of layout.tiers) {
      expect(tier.label).toBe(`PHASE ${tier.tier + 1}`);
      expect(tier.notchCount).toBe(tier.tier + 1);
      expect(tier.taskIds.length).toBeGreaterThan(0);
      for (const taskId of tier.taskIds) {
        expect(byId.get(taskId)?.tier).toBe(tier.tier);
      }
    }
  });

  it('stands nodes on their platform, on their tier ring', () => {
    const layout = createPhaseTierLayout(SAMPLE);
    for (const node of layout.nodes) {
      const tier = layout.tiers[node.tier];
      expect(tier).toBeDefined();
      if (!tier) continue;
      expect(node.position.y).toBeGreaterThan(tier.y);
      expect(Math.hypot(node.position.x, node.position.z)).toBeCloseTo(tier.ringRadius, 6);
      // Higher tiers rise higher: the plan is readable as a staircase.
      expect(node.position.y).toBeCloseTo(tier.tier * 4.6 + 1.7, 6);
      expect(node.anchor.y).toBeGreaterThan(node.position.y);
      expect(Math.hypot(node.anchor.x, node.anchor.z)).toBeCloseTo(tier.ringRadius, 6);
    }
    expect(layout.bounds.tierCount).toBe(layout.tiers.length);
    expect(layout.bounds.maxY).toBeGreaterThan(layout.bounds.minY);
  });

  it('derives one conduit per dependency edge', () => {
    const layout = createPhaseTierLayout(SAMPLE);
    expect(layout.edges.length).toBe(7);
    for (const edge of layout.edges) {
      const upstream = layout.nodes.find((node) => node.id === edge.from);
      const dependent = layout.nodes.find((node) => node.id === edge.to);
      expect(upstream).toBeDefined();
      expect(dependent).toBeDefined();
      // Dependencies always point up the tiers.
      expect(dependent?.tier ?? 0).toBeGreaterThan(upstream?.tier ?? 0);
    }
  });

  it('fingerprints structure, not status', () => {
    const layout = createPhaseTierLayout(SAMPLE);
    expect(layout.signature).toBe(planSignature(SAMPLE));
    expect(planSignature(withTaskStatus(SAMPLE, 'task-review', 'failed'))).toBe(layout.signature);
  });
});

/* -------------------------------------------------------------------------- */
/* Instanced nodes                                                            */
/* -------------------------------------------------------------------------- */

describe('instanced task nodes', () => {
  it('instances one body per status group, sized from the fixture', () => {
    const { view } = mountView(SAMPLE);
    expect(view.count).toBe(SAMPLE.plan.order.length);

    for (const status of PLAN_GRAPH_STATUSES) {
      expect(view.bodies[status]).toBeInstanceOf(InstancedMesh);
      expect(view.bodies[status].name).toBe(PLAN_GRAPH_NAMES.body(status));
      expect(view.bodies[status].count).toBeLessThanOrEqual(view.capacity);
      expect(view.glyphs[status].count).toBe(view.bodies[status].count);
    }

    expect(view.bodies.passed.count).toBe(2); // task-shell, task-contract
    expect(view.bodies.running.count).toBe(2); // lane-comets, constellation
    expect(view.bodies.verifying.count).toBe(1); // gates, on a verify lane
    expect(view.bodies.superseded.count).toBe(1); // economy, blocked
    expect(view.bodies.queued.count).toBe(1); // review, pending
    expect(view.bodies.failed.count).toBe(0);

    expect(view.nodes.filter((node) => node.active).length).toBe(view.count);
  });

  it('carries status colour and scale in instance attributes', () => {
    const { view } = mountView(SAMPLE);
    const color = new Color();

    for (const status of PLAN_GRAPH_STATUSES) {
      const mesh = view.bodies[status];
      if (mesh.count === 0) continue;
      expect(mesh.instanceColor).not.toBeNull();
      const expected = new Color(TASK_STATUS_PALETTE[status].color);
      mesh.getColorAt(0, color);
      // The instance colour tracks the palette hue exactly (only its intensity
      // is modulated by the status pulse).
      expect(color.r / color.g).toBeCloseTo(expected.r / expected.g, 4);
      expect(color.b / color.g).toBeCloseTo(expected.b / expected.g, 4);
    }

    // Per-instance scale rides in the instance transform attribute, so a
    // spring-green passed node is visibly larger than dim-violet history.
    expect(instanceScale(view.bodies.passed, 0)).toBeGreaterThan(
      instanceScale(view.bodies.superseded, 0),
    );
    expect(instanceScale(view.bodies.passed, 0)).toBeGreaterThan(0);
  });

  it('re-codes nodes in place as the plan moves, without rebuilding the layout', () => {
    const { view } = mountView(SAMPLE);
    const revision = view.revision;

    const failed = withTaskStatus(SAMPLE, 'task-review', 'failed', 0.2);
    view.update(failed);

    expect(view.revision).toBe(revision);
    expect(view.node('task-review')?.status).toBe('failed');
    expect(view.bodies.failed.count).toBe(1);
    expect(view.bodies.queued.count).toBe(0);
    expect(view.nodes.length).toBe(SAMPLE.plan.order.length);

    // An authored override retires a node as history without touching state.
    view.setStatusOverride('task-shell', 'superseded');
    view.update(failed);
    expect(view.node('task-shell')?.status).toBe('superseded');
    expect(view.node('task-shell')?.complete).toBe(true);

    view.clearStatusOverrides();
    view.update(failed);
    expect(view.node('task-shell')?.status).toBe('passed');
  });

  it('rebuilds the layout when the plan shape changes', () => {
    const { view } = mountView(SAMPLE);
    const revision = view.revision;

    const grown = advance(SAMPLE, [
      makeDomainEvent(
        'plan/task-registered',
        {
          task: {
            id: 'task-follow-up',
            title: 'Follow up on the review',
            laneId: 'lane-build',
            dependencies: ['task-review'],
          },
        },
        0,
      ),
    ]);
    view.update(grown);

    expect(view.revision).toBeGreaterThan(revision);
    expect(view.count).toBe(SAMPLE.plan.order.length + 1);
    expect(view.node('task-follow-up')?.tier).toBe(5);
  });

  it('builds a platform group per tier with tier-indexed rim notches', () => {
    const { view } = mountView(SAMPLE);
    for (const tier of view.tiers) {
      const group = view.root.getObjectByName(PLAN_GRAPH_NAMES.platform(tier.tier));
      expect(group).toBeDefined();
      expect(group?.position.y).toBeCloseTo(tier.y, 6);
      for (let index = 0; index < tier.notchCount; index += 1) {
        expect(group?.getObjectByName(PLAN_GRAPH_NAMES.notch(tier.tier, index))).toBeDefined();
      }
    }
    expect(view.platformFor(0)).toBeDefined();
  });

  it('releases everything it created, idempotently', () => {
    const { adapter, view } = mountView(SAMPLE);
    const root = view.root;
    expect(root.parent).toBe(adapter.scene);

    view.dispose();
    expect(view.disposed).toBe(true);
    expect(view.disposedResources?.geometries ?? 0).toBeGreaterThan(0);
    expect(view.disposedResources?.materials ?? 0).toBeGreaterThan(0);
    expect(root.parent).toBeNull();
    expect(view.edges.disposed).toBe(true);
    expect(view.edges.count).toBe(0);

    view.dispose(); // idempotent
    expect(view.disposed).toBe(true);
    adapter.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Dependency conduits                                                        */
/* -------------------------------------------------------------------------- */

describe('dependency conduits', () => {
  it('ramps from dim to lit at the upstream task completion time', () => {
    expect(conduitGlow(null, 10_000)).toBe(0);
    expect(conduitGlow(1_000, 900)).toBe(0);
    expect(conduitGlow(1_000, 1_000)).toBe(0);
    expect(conduitGlow(1_000, 1_000 + CONDUIT_DEFAULTS.fadeMs / 2)).toBeCloseTo(0.5, 5);
    expect(conduitGlow(1_000, 500_000)).toBe(1);
  });

  it('sends the energy head from the upstream task toward the dependent', () => {
    const travel = CONDUIT_DEFAULTS.travelMs;
    expect(conduitPulseU(null, 5_000)).toBe(0);
    expect(conduitPulseU(0, travel / 4)).toBeCloseTo(0.25, 5);
    expect(conduitPulseU(0, travel * 1.5)).toBeCloseTo(0.5, 5);
    expect(conduitPulseU(0, travel * 3.25)).toBeCloseTo(0.25, 5);

    expect(conduitTravelWave(0.5, 0.5, 0.2)).toBe(1);
    expect(conduitTravelWave(0, 0.5, 0.1)).toBe(0);
    // The band wraps across the seam of the loop.
    expect(conduitTravelWave(0.02, 0.97, 0.1)).toBeGreaterThan(0);
  });

  it('builds deterministic arches between node anchors', () => {
    const path = createConduitPath(new Vector3(-4, 2, 0), new Vector3(4, 6, 0));
    expect(path.points.length).toBe(path.samples + 1);

    const start = sampleConduitPoint(path, 0, new Vector3());
    const middle = sampleConduitPoint(path, 0.5, new Vector3());
    const end = sampleConduitPoint(path, 1, new Vector3());

    expect(start.toArray()).toEqual([-4, 2, 0]);
    expect(end.toArray()).toEqual([4, 6, 0]);
    expect(middle.y).toBeGreaterThan((path.from.y + path.to.y) / 2);
    expect(path.length).toBeGreaterThan(path.from.distanceTo(path.to));
    expect(createConduitPath(new Vector3(-4, 2, 0), new Vector3(4, 6, 0)).points[3]?.toArray()).toEqual(
      path.points[3]?.toArray(),
    );
  });

  it('lights each conduit as its upstream task completes and pulses it', () => {
    const { view } = mountView(SAMPLE);
    expect(view.edges.count).toBe(7);
    // shell → contract, contract → {lane-comets, gates, economy}
    expect(view.edges.litCount).toBe(4);
    expect(view.edges.pulsingCount).toBe(4);

    const dim = view.edges.conduitBetween('task-lane-comets', 'task-constellation');
    expect(dim).toBeDefined();
    if (!dim) return;
    expect(dim.lit).toBe(false);
    expect(dim.glow).toBe(0);
    expect(view.edges.headFor(dim.id)).toBeUndefined();

    // The upstream task lands: the conduit lights from the task's own finish time.
    const completed = withTaskStatus(SAMPLE, 'task-lane-comets', 'passed', 1);
    const finishedAt = completed.plan.tasks['task-lane-comets']?.finishedAtMs ?? 0;
    view.update(completed);

    const lit = view.edges.conduit(dim.id);
    expect(lit).toBeDefined();
    if (!lit) return;
    expect(lit.lit).toBe(true);
    expect(lit.litAtMs).toBe(finishedAt);
    expect(lit.glow).toBe(0);
    expect(view.edges.litCount).toBe(5);

    // Half a fade later it is half lit; the energy head is on its way.
    view.update(atClock(completed, finishedAt + CONDUIT_DEFAULTS.fadeMs / 2));
    expect(view.edges.conduit(dim.id)?.glow).toBeCloseTo(0.5, 5);
    expect(view.edges.headFor(dim.id)).toBeDefined();

    // A fade later it is fully lit; the energy head is on its way.
    view.update(atClock(completed, finishedAt + CONDUIT_DEFAULTS.fadeMs));
    const travelling = view.edges.conduit(dim.id);
    expect(travelling?.glow).toBe(1);
    expect(travelling?.pulseU).toBeCloseTo(CONDUIT_DEFAULTS.fadeMs / CONDUIT_DEFAULTS.travelMs, 5);
    expect(view.edges.headFor(dim.id)).toBeDefined();

    // The energy head really travels along the curve.
    const head = view.edges.headFor(dim.id);
    const expectedPoint = sampleConduitPoint(dim.path, travelling?.pulseU ?? 0, new Vector3());
    expect(head?.position.toArray()).toEqual(expectedPoint.toArray());
  });
});

/* -------------------------------------------------------------------------- */
/* Picking                                                                    */
/* -------------------------------------------------------------------------- */

describe('pointer picking', () => {
  it('resolves normalized pointer coordinates to a task key and screen anchor', () => {
    const { adapter, view } = mountView(SAMPLE);
    const node = view.node('task-review');
    expect(node).toBeDefined();
    if (!node) return;

    aimAtNode(adapter.camera, node.position);
    const pick = view.pick(new Vector2(0, 0));

    expect(pick?.taskId).toBe('task-review');
    expect(pick?.title).toBe(node.title);
    expect(pick?.status).toBe('queued');
    expect(pick?.tier).toBe(4);
    expect(pick?.instanceId).toBeGreaterThanOrEqual(0);
    expect(pick?.distance).toBeGreaterThan(25);
    expect(pick?.distance).toBeLessThan(31);
    expect(Math.abs((pick?.point.y ?? 0) - node.position.y)).toBeLessThan(1.4);
    // The inspector anchor is the node's normalized canvas position.
    expect(pick?.screen?.x).toBeCloseTo(0.5, 2);
    expect(pick?.screen?.y).toBeCloseTo(0.5, 2);

    // Nothing under the far corner of the canvas.
    expect(view.pick(new Vector2(-0.99, 0.99))).toBeNull();
  });

  it('takes the same path for mouse and touch coordinates', () => {
    const { adapter, view } = mountView(SAMPLE);
    const node = view.node('task-review');
    if (!node) return;
    aimAtNode(adapter.camera, node.position);

    const rect = { left: 100, top: 40, width: 800, height: 450 };
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const viaMouse = view.pickFromPointer(centerX, centerY, rect);
    const viaTouch = view.pickFromPointer(centerX, centerY, rect);
    expect(viaMouse?.taskId).toBe('task-review');
    expect(viaTouch?.taskId).toBe(viaMouse?.taskId);

    const center = pointerToNdc(centerX, centerY, rect);
    expect(center.x).toBeCloseTo(0, 6);
    expect(center.y).toBeCloseTo(0, 6);

    const topLeft = pointerToNdc(rect.left, rect.top, rect);
    expect(topLeft.x).toBeCloseTo(-1, 6);
    expect(topLeft.y).toBeCloseTo(1, 6);

    const bottomRight = pointerToNdc(rect.left + rect.width, rect.top + rect.height, rect);
    expect(bottomRight.x).toBeCloseTo(1, 6);
    expect(bottomRight.y).toBeCloseTo(-1, 6);

    // Without a camera there is nothing to cast.
    view.setCamera(null);
    expect(view.pick(new Vector2(0, 0))).toBeNull();
    expect(view.pickFromPointer(centerX, centerY, rect)).toBeNull();
  });

  it('projects world positions onto normalized screen anchors', () => {
    const camera = new PerspectiveCamera(52, 16 / 9, 0.1, 400);
    camera.position.set(0, 10, 40);
    camera.lookAt(0, 10, 0);
    camera.updateMatrixWorld();

    const center = screenAnchorOf(new Vector3(0, 10, 0), camera);
    expect(center.x).toBeCloseTo(0.5, 6);
    expect(center.y).toBeCloseTo(0.5, 6);

    const right = screenAnchorOf(new Vector3(6, 10, 0), camera);
    expect(right.x).toBeGreaterThan(0.5);
    expect(right.y).toBeCloseTo(0.5, 6);
  });

  it('marks a picked node selected for the inspector', () => {
    const adapter = createHeadlessAdapter({ width: 1024, height: 640 });
    const view = createPlanGraphView(adapter.scene);
    view.update(SAMPLE);

    const selection = view.select('task-gates');
    expect(selection?.taskId).toBe('task-gates');
    expect(selection?.status).toBe('verifying');
    expect(selection?.tier).toBe(2);
    expect(view.selectedTaskId).toBe('task-gates');
    expect(view.selection?.title).toBe('Light the verification gates');
    expect(view.root.getObjectByName(PLAN_GRAPH_NAMES.halo)?.visible).toBe(true);

    expect(view.select('task-that-does-not-exist')).toBeNull();
    expect(view.selectedTaskId).toBeNull();
    expect(view.root.getObjectByName(PLAN_GRAPH_NAMES.halo)?.visible).toBe(false);
    adapter.dispose();
  });

  it('resolves the page’s client coordinates through the same pick path', () => {
    const { adapter, view } = mountView(SAMPLE);
    const node = view.node('task-review');
    if (!node) return;
    aimAtNode(adapter.camera, node.position);

    // A canvas stand-in: the controller only needs a client rectangle.
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    } as unknown as HTMLCanvasElement;

    const controller = createSelectionController(view, canvas);
    const pick = controller.selectAt(640, 360); // mouse click at the canvas centre
    expect(pick?.taskId).toBe('task-review');
    expect(view.selectedTaskId).toBe('task-review');

    // Touch input takes the same path, and a miss keeps the inspector readout.
    expect(controller.selectAt(4, 4)).toBeNull();
    expect(view.selectedTaskId).toBe('task-review');
  });

  it('opens the preview on the busiest task so the inspector is never empty', () => {
    const { view } = mountView(SAMPLE);
    const selection = selectBusiestTask(view);
    expect(selection).not.toBeNull();
    expect(selection?.status === 'running' || selection?.status === 'verifying').toBe(true);
    expect(view.selectedTaskId).toBe(selection?.taskId);
    expect(view.root.getObjectByName(PLAN_GRAPH_NAMES.halo)?.visible).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Runtime composition and the preview page                                   */
/* -------------------------------------------------------------------------- */

describe('plan graph system', () => {
  it('runs over the shared headless adapter inside the game runtime', () => {
    const adapter = createHeadlessAdapter({ width: 800, height: 600 });
    const system = createPlanGraphSystem();
    const game = createGame({ adapter, systems: [system], state: createSampleState() });

    game.advance(16 * 20);

    expect(game.state.plan.order.length).toBe(7);
    expect(system.view.count).toBe(7);
    expect(adapter.scene.getObjectByName(PLAN_GRAPH_NAMES.root)).toBeDefined();
    expect(system.view.edges.count).toBe(7);

    const node = system.view.node('task-shell');
    if (!node) throw new Error('expected task-shell to be laid out');
    aimAtNode(adapter.camera, node.position);
    expect(system.view.pick(new Vector2(0, 0))?.taskId).toBe('task-shell');

    game.dispose();
    expect(system.view.disposed).toBe(true);
    expect(adapter.scene.getObjectByName(PLAN_GRAPH_NAMES.root)).toBeUndefined();
  });

  it('drives the fixture through every status code the palette documents', () => {
    const adapter = createHeadlessAdapter({ width: 1024, height: 640 });
    const system = createPlanGraphSystem();
    const game = createGame({
      adapter,
      systems: [system, createPlanGraphDirector()],
      state: createSampleState(),
    });

    const seen = new Set<PlanNodeStatus>();
    for (let step = 0; step < 400; step += 1) {
      game.advance(100);
      for (const node of system.view.nodes) {
        if (node.active) seen.add(node.status);
      }
    }

    expect([...seen].sort()).toEqual([...PLAN_GRAPH_STATUSES].sort());
    // The director keeps the floor honest: every status has its own shape.
    const shapes = new Set(
      [...seen].map((status) => TASK_STATUS_PALETTE[status].shape),
    );
    expect(shapes.size).toBe(PLAN_GRAPH_STATUSES.length);

    game.dispose();
  });

  it('gives the preview page scenario controls and inspector text', () => {
    const adapter = createHeadlessAdapter({ width: 800, height: 600 });
    const system = createPlanGraphSystem();
    const game = createGame({ adapter, systems: [system], state: createSampleState() });
    const scenarios = createPlanGraphScenarios({ game, view: system.view });

    expect(scenarios.failTask('task-lane-comets')).toBe('task-lane-comets');
    // The runtime owns the state; the view reads it in its own update.
    system.view.update(game.state as DeepReadonly<GameState>);
    expect(system.view.node('task-lane-comets')?.status).toBe('failed');
    expect(system.view.bodies.failed.count).toBe(1);

    scenarios.repairTasks();
    system.view.update(game.state as DeepReadonly<GameState>);
    expect(system.view.node('task-lane-comets')?.status).toBe('running');

    expect(scenarios.supersedeTask('task-shell')).toBe('task-shell');
    system.view.update(game.state as DeepReadonly<GameState>);
    expect(system.view.node('task-shell')?.status).toBe('superseded');

    scenarios.restoreTasks();
    system.view.update(game.state as DeepReadonly<GameState>);
    expect(system.view.node('task-shell')?.status).toBe('passed');

    const summary = describePlanGraph(game.state, system.view);
    expect(summary.join('\n')).toContain('conduits');
    expect(summary.join('\n')).toContain('conduits   4/7 lit');

    expect(inspectionKey(null)).toBe('NO TASK SELECTED');
    expect(inspectionText(null, game.state)).toContain('click any task node');
    const selection = system.view.select('task-gates');
    expect(inspectionKey(selection)).toBe('task-gates');
    const text = inspectionText(selection, game.state);
    expect(text).toContain('VERIFYING');
    expect(text).toContain('PHASE 3');
    expect(text).toContain('lane-verify');
    expect(text).toContain('depends on task-contract');

    game.dispose();
  });
});
