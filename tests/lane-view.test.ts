/**
 * Lane comets, verification gate rings and the quality constellation.
 *
 * Everything here runs over the *shared* foundation contracts: the headless
 * render adapter (a real three.js scene, no GPU) and `createSampleState` fixture
 * state. The tests assert observable behaviour — where comets are, how many,
 * which ring segments a gate lights, which shape a criterion is drawn with, what
 * disposal releases — rather than implementation counters.
 */

import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Mesh,
  OctahedronGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';

import { createGame } from '../src/game/Game';
import { createHeadlessAdapter } from '../src/render/headless';
import {
  COMET_TRAVEL_MS,
  GATE_RING_COLORS,
  LANE_AGENT_NAMES,
  SPRINT_OCCUPANCY,
  TRAIL_MAX_LENGTH,
  classifyGateRing,
  cometPhase,
  cometTrailLength,
  createConduitPath,
  createLaneAgentsSystem,
  createLaneAgentsView,
  createLaneGraphLayout,
  gateTargetNode,
  measureLaneOccupancy,
  measureLaneOccupancies,
  sampleConduitPath,
  sampleConduitTangent,
} from '../src/render/laneAgents';
import {
  CONSTELLATION_DEFAULTS,
  CRITERION_NAMES,
  FINAL_INVARIANT_WEIGHT,
  classifyCriterion,
  createConstellationLayout,
  createQualityGraph,
  createQualityGraphSystem,
  readQualityMetrics,
} from '../src/render/qualityGraph';
import { createSampleState } from '../src/sim/fixtures';
import { createLaneShowDirector, createScenarioControls, describeHologram } from '../dev-preview/lane-view';
import {
  applyDomainEvents,
  createSnapshot,
  makeDomainEvent,
  type DomainEvent,
  type GameState,
  type TaskStatus,
} from '../src/sim/state';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const SAMPLE = createSampleState();

/** Apply events at a deterministic offset from the state's simulated clock. */
function advance(
  state: GameState,
  events: readonly DomainEvent[],
  offsetMs = 500,
): GameState {
  const at = state.mission.elapsedMs + offsetMs;
  return applyDomainEvents(
    state,
    events.map((event) => ({ ...event, at }) as DomainEvent),
  );
}

function withTaskProgress(state: GameState, taskId: string, progress: number): GameState {
  return advance(state, [makeDomainEvent('plan/task-updated', { taskId, progress }, 0)], 0);
}

function withGateRun(
  state: GameState,
  gateId: string,
  status: TaskStatus,
  coverage: number,
): GameState {
  return advance(state, [makeDomainEvent('verification/run', { gateId, status, coverage }, 0)]);
}

function withMetric(state: GameState, id: string, value: number): GameState {
  const metric = state.quality.metrics[id];
  if (!metric) throw new Error(`missing metric ${id}`);
  return advance(
    state,
    [
      makeDomainEvent(
        'quality/measured',
        {
          metric: {
            id,
            label: metric.label,
            value,
            target: metric.target,
            weight: metric.weight,
          },
        },
        0,
      ),
    ],
    0,
  );
}

function withQueuedTask(state: GameState, laneId: string, taskId: string): GameState {
  return advance(state, [makeDomainEvent('lane/queued', { laneId, taskId }, 0)]);
}

function tickTheClock(state: GameState, ms: number): GameState {
  return advance(state, [makeDomainEvent('economy/spend', { credits: 1, contextTokens: 1 }, 0)], ms);
}

function findActiveComet(
  view: ReturnType<typeof createLaneAgentsView>,
  laneId: string,
): ReturnType<typeof createLaneAgentsView>['comets'][number] {
  const comet = view.comets.find((candidate) => candidate.active && candidate.laneId === laneId);
  if (!comet) throw new Error(`no active comet for ${laneId}`);
  return comet;
}

/* -------------------------------------------------------------------------- */
/* Conduit paths                                                              */
/* -------------------------------------------------------------------------- */

describe('conduit paths derived from plan state', () => {
  it('lays tasks out by dependency depth and lane, deterministically', () => {
    const first = createLaneGraphLayout(SAMPLE);
    const second = createLaneGraphLayout(SAMPLE);

    const node = (id: string): Vector3 => {
      const found = first.nodes.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`missing node ${id}`);
      return found.position;
    };

    // Deeper dependency chains march to the right.
    expect(node('task-shell').x).toBeLessThan(node('task-contract').x);
    expect(node('task-contract').x).toBeLessThan(node('task-lane-comets').x);
    expect(node('task-lane-comets').x).toBeLessThan(node('task-constellation').x);
    // Lanes occupy distinct rows.
    expect(node('task-lane-comets').z).not.toBe(node('task-gates').z);
    // Same state in, same floor out.
    for (const candidate of first.nodes) {
      const twin = second.nodes.find((entry) => entry.id === candidate.id);
      expect(twin?.position.equals(candidate.position)).toBe(true);
    }
    expect(second.signature).toBe(first.signature);
  });

  it('builds one dependency conduit per plan edge plus one portal per lane', () => {
    const layout = createLaneGraphLayout(SAMPLE);
    const dependencyConduits = layout.conduits.filter((conduit) => conduit.kind === 'dependency');
    // Fixture edges: shell→contract, contract→lane-comets, contract→gates,
    // lane-comets→constellation, contract→economy, gates→review,
    // constellation→review.
    expect(dependencyConduits).toHaveLength(7);
    expect(dependencyConduits.every((conduit) => conduit.path.length > 0)).toBe(true);
    expect(layout.anchors).toHaveLength(SAMPLE.lanes.order.length);
    for (const conduit of layout.conduits) {
      expect(layout.conduitsByLane.get(conduit.laneId)).toContain(conduit);
    }
    // Every occupied lane can be reached: the approach conduit exists.
    expect(layout.conduitsByLane.get('lane-build')?.some((c) => c.kind === 'approach')).toBe(true);
    expect(layout.conduitsByLane.get('lane-verify')?.some((c) => c.kind === 'approach')).toBe(true);
  });

  it('samples a path deterministically from its start node to its target node', () => {
    const layout = createLaneGraphLayout(SAMPLE);
    const conduit = layout.conduits.find((candidate) => candidate.id === 'task-contract->task-lane-comets');
    if (!conduit) throw new Error('missing conduit');

    const start = sampleConduitPath(conduit.path, 0, new Vector3());
    const end = sampleConduitPath(conduit.path, 1, new Vector3());
    const from = layout.nodes.find((node) => node.id === 'task-contract')?.position;
    const to = layout.nodes.find((node) => node.id === 'task-lane-comets')?.position;
    expect(start.x).toBeCloseTo(from?.x ?? 0, 6);
    expect(start.z).toBeCloseTo(from?.z ?? 0, 6);
    expect(end.x).toBeCloseTo(to?.x ?? 0, 6);
    expect(end.z).toBeCloseTo(to?.z ?? 0, 6);
    // The arch makes the path longer than the straight line between the nodes.
    expect(conduit.path.length).toBeGreaterThan(start.distanceTo(end));
    // Tangents are unit length.
    expect(sampleConduitTangent(conduit.path, 0.37, new Vector3()).length()).toBeCloseTo(1, 6);

    // Rebuilding the same conduit from the same anchors is byte-identical.
    const rebuilt = createConduitPath({
      id: conduit.path.id,
      kind: conduit.path.kind,
      from: conduit.path.from,
      to: conduit.path.to,
      laneId: conduit.path.laneId,
      start: conduit.path.controlPoints[0].clone(),
      end: conduit.path.controlPoints[3].clone(),
    });
    expect(Array.from(rebuilt.points)).toEqual(Array.from(conduit.path.points));
    expect(rebuilt.length).toBeCloseTo(conduit.path.length, 9);
  });
});

/* -------------------------------------------------------------------------- */
/* Comets                                                                     */
/* -------------------------------------------------------------------------- */

describe('lane agent comets', () => {
  it('spawns exactly one comet per unit of lane occupancy', () => {
    const adapter = createHeadlessAdapter();
    const view = createLaneAgentsView(adapter.scene);
    view.update(createSnapshot(SAMPLE));

    const build = measureLaneOccupancy(SAMPLE, 'lane-build');
    const verify = measureLaneOccupancy(SAMPLE, 'lane-verify');
    expect(build.occupancy).toBe(2); // one task riding, one queued
    expect(verify.occupancy).toBe(1);

    expect(view.cometCountForLane('lane-build')).toBe(build.occupancy);
    expect(view.cometCountForLane('lane-verify')).toBe(verify.occupancy);
    expect(view.cometCountForLane('lane-discovery')).toBe(0);
    expect(view.cometCount).toBe(build.occupancy + verify.occupancy);
    expect(view.comets.filter((comet) => comet.active)).toHaveLength(view.cometCount);

    // The leading comet carries the lane's active task along its inbound conduit.
    const lead = findActiveComet(view, 'lane-verify');
    expect(lead.taskId).toBe('task-gates');
    expect(lead.conduitId).toBe('task-contract->task-gates');
    // The head object is named for tooling and is actually in the scene graph.
    expect(view.root.getObjectByName(LANE_AGENT_NAMES.comet('lane-verify', 0))?.visible).toBe(true);
    expect(view.root.getObjectByName(LANE_AGENT_NAMES.cometTrail('lane-verify', 0))?.visible).toBe(
      true,
    );
    view.dispose();
  });

  it('grows comet trails with lane occupancy', () => {
    expect(cometTrailLength(1)).toBeLessThan(cometTrailLength(2));
    expect(cometTrailLength(SPRINT_OCCUPANCY)).toBeCloseTo(TRAIL_MAX_LENGTH, 6);

    const adapter = createHeadlessAdapter();
    const view = createLaneAgentsView(adapter.scene);
    view.update(createSnapshot(SAMPLE));
    expect(view.trailLengthForLane('lane-build')).toBeGreaterThan(
      view.trailLengthForLane('lane-verify'),
    );

    const busier = withQueuedTask(
      withQueuedTask(SAMPLE, 'lane-verify', 'task-economy'),
      'lane-verify',
      'task-review',
    );
    view.update(createSnapshot(busier));
    expect(view.cometCountForLane('lane-verify')).toBe(3);
    expect(view.trailLengthForLane('lane-verify')).toBeCloseTo(TRAIL_MAX_LENGTH, 6);
    expect(view.cometCount).toBe(5);
    view.dispose();
  });

  it('drives motion from state — simulated time and progress, never wall clock', () => {
    const adapter = createHeadlessAdapter();
    const view = createLaneAgentsView(adapter.scene);
    const snapshot = createSnapshot(SAMPLE);
    view.update(snapshot);
    const comet = findActiveComet(view, 'lane-build');
    const firstU = comet.u;
    const firstPosition = comet.position.clone();

    // Same state twice: an identical frame, so a replay cannot drift.
    view.update(snapshot);
    expect(comet.u).toBe(firstU);
    expect(comet.position.equals(firstPosition)).toBe(true);

    // Progress on the travelling task alone moves the comet, with no time passing.
    const progressed = withTaskProgress(SAMPLE, 'task-lane-comets', 0.95);
    expect(progressed.mission.elapsedMs).toBe(snapshot.mission.elapsedMs);
    view.update(createSnapshot(progressed));
    expect(comet.u).not.toBe(firstU);

    // Simulated time advances the comet, and repeating that state is stable.
    const later = tickTheClock(progressed, 700);
    view.update(createSnapshot(later));
    const laterU = comet.u;
    view.update(createSnapshot(later));
    expect(comet.u).toBe(laterU);

    // A second view over the same state derives the same motion.
    const twinAdapter = createHeadlessAdapter();
    const twin = createLaneAgentsView(twinAdapter.scene);
    twin.update(createSnapshot(SAMPLE));
    expect(findActiveComet(twin, 'lane-build').u).toBe(firstU);
    expect(findActiveComet(twin, 'lane-build').position.equals(firstPosition)).toBe(true);

    // Phases wrap inside one travel period and stay ordered across a lane.
    expect(cometPhase(0, 0, 3, 0, COMET_TRAVEL_MS)).toBeCloseTo(0, 6);
    const wrapped = cometPhase(COMET_TRAVEL_MS, 0, 3, 0, COMET_TRAVEL_MS);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(1);
    expect(cometPhase(1_000, 1, 3, 0, COMET_TRAVEL_MS)).toBeGreaterThan(
      cometPhase(1_000, 0, 3, 0, COMET_TRAVEL_MS),
    );

    view.dispose();
    twin.dispose();
  });

  it('reuses pooled objects and buffers instead of allocating per frame', () => {
    const adapter = createHeadlessAdapter();
    const view = createLaneAgentsView(adapter.scene);
    view.update(createSnapshot(SAMPLE));

    const cometsLayer = view.root.getObjectByName(LANE_AGENT_NAMES.comets);
    const gatesLayer = view.root.getObjectByName(LANE_AGENT_NAMES.gates);
    if (!cometsLayer || !gatesLayer) throw new Error('missing scene layers');

    const comet = findActiveComet(view, 'lane-build');
    const head = view.root.getObjectByName(LANE_AGENT_NAMES.comet('lane-build', comet.index));
    const trail = view.root.getObjectByName(LANE_AGENT_NAMES.cometTrail('lane-build', comet.index));
    expect(head).toBeInstanceOf(Mesh);
    expect(trail).toBeInstanceOf(Mesh);
    const trailBuffer = (trail as Mesh).geometry.getAttribute('position').array;
    const cometsChildren = cometsLayer.children.length;
    const gatesChildren = gatesLayer.children.length;

    let state = SAMPLE;
    for (let step = 0; step < 24; step += 1) {
      state = advance(
        state,
        [makeDomainEvent('plan/task-updated', { taskId: 'task-lane-comets', progress: 0.5 + step * 0.01 }, 0)],
        20,
      );
      view.update(createSnapshot(state));
      // Pool sizes are fixed and the same objects are re-used every frame.
      expect(cometsLayer.children).toHaveLength(cometsChildren);
      expect(gatesLayer.children).toHaveLength(gatesChildren);
      expect(view.root.getObjectByName(LANE_AGENT_NAMES.comet('lane-build', comet.index))).toBe(head);
    }
    expect((trail as Mesh).geometry.getAttribute('position').array).toBe(trailBuffer);
    expect(comet.active).toBe(true);
    expect(comet.trailLength).toBeGreaterThan(0);
    view.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Verification gates                                                         */
/* -------------------------------------------------------------------------- */

describe('verification gate rings', () => {
  it('separates pending, passed and failed-with-repair by pattern, not colour alone', () => {
    const pending = classifyGateRing('pending');
    const running = classifyGateRing('running');
    const blocked = classifyGateRing('blocked');
    const passed = classifyGateRing('passed');
    const failed = classifyGateRing('failed');

    expect(pending.state).toBe('pending');
    expect(running.state).toBe('pending');
    expect(blocked.state).toBe('pending');
    expect(passed.state).toBe('passed');
    expect(failed.state).toBe('failed');

    // Three visually distinct segment patterns.
    expect(new Set([pending.pattern, passed.pattern, failed.pattern]).size).toBe(3);
    expect(failed.repair).toBe(true);
    expect(pending.repair).toBe(false);
    expect(passed.repair).toBe(false);
    expect(passed.core).toBe(true);

    // Distinct colours, and the alarm reads redder than green.
    expect(new Set([pending.color, passed.color, failed.color]).size).toBe(3);
    const red = (colour: number): number => (colour >> 16) & 0xff;
    const green = (colour: number): number => (colour >> 8) & 0xff;
    expect(red(GATE_RING_COLORS.failed)).toBeGreaterThan(green(GATE_RING_COLORS.failed));
    expect(green(GATE_RING_COLORS.passed)).toBeGreaterThan(red(GATE_RING_COLORS.passed));
    // A fast alarm pulse, a slow settled swell.
    expect(failed.pulsePeriodMs).toBeLessThan(passed.pulsePeriodMs);
  });

  it('haloes the gate target node with the state-specific segment pattern', () => {
    const adapter = createHeadlessAdapter();
    const view = createLaneAgentsView(adapter.scene);
    view.update(createSnapshot(SAMPLE));

    const node = view.layout.nodes.find((candidate) => candidate.id === 'task-gates');
    if (!node) throw new Error('missing gate node');
    expect(gateTargetNode(view.layout, 'lane-verify')?.id).toBe('task-gates');

    const passedRing = view.gateRing('gate-typecheck');
    expect(passedRing?.state).toBe('passed');
    expect(passedRing?.pattern).toBe('solid-ring');
    expect(passedRing?.targetNodeId).toBe('task-gates');
    expect(view.gateSegments('gate-typecheck')).toBe(2); // solid ring plus filled core
    expect(passedRing?.position.x).toBeCloseTo(node.position.x, 6);
    expect(passedRing?.position.z).toBeCloseTo(node.position.z, 6);
    expect(passedRing?.position.y).toBeGreaterThan(node.position.y);

    // The in-flight gate is dim and sparse.
    const liveRing = view.gateRing('gate-boot-smoke');
    expect(liveRing?.state).toBe('pending');
    expect(liveRing?.pattern).toBe('sparse-dashes');
    expect(liveRing?.color).toBe(GATE_RING_COLORS.pending);
    expect(view.gateSegments('gate-boot-smoke')).toBe(4);

    // Gates on the same node nest instead of overlapping; the observe gate
    // guards the observability node.
    expect(view.gateRing('gate-bundle')?.targetNodeId).toBe('task-gates');
    expect(view.gateRing('gate-fidelity')?.targetNodeId).toBe('task-economy');
    expect(view.gateRing('gate-boot-smoke')?.position.y).toBeGreaterThan(
      passedRing?.position.y ?? 0,
    );
    view.dispose();
  });

  it('raises a magenta-red repair alarm when a gate fails, then settles when repaired', () => {
    const adapter = createHeadlessAdapter();
    const view = createLaneAgentsView(adapter.scene);
    view.update(createSnapshot(SAMPLE));
    expect(view.gateRing('gate-bundle')?.state).toBe('passed');

    const failed = withGateRun(SAMPLE, 'gate-bundle', 'failed', 0.42);
    view.update(createSnapshot(failed));
    const alarm = view.gateRing('gate-bundle');
    expect(alarm?.state).toBe('failed');
    expect(alarm?.pattern).toBe('broken-arcs');
    expect(alarm?.repair).toBe(true);
    expect(alarm?.color).toBe(GATE_RING_COLORS.failed);
    expect(alarm?.attempts).toBe(2); // registration plus the failing run
    expect(alarm?.coverage).toBeCloseTo(0.42, 6);
    expect(view.gateSegments('gate-bundle')).toBe(3); // two arcs plus the repair arc

    // The alarm pulses with simulated time, not with the wall clock.
    const pulse = alarm?.pulse ?? 0;
    view.update(createSnapshot(tickTheClock(failed, 240)));
    const laterPulse = view.gateRing('gate-bundle')?.pulse ?? pulse;
    expect(laterPulse).not.toBe(pulse);
    // ...and it is stable for a frozen state.
    view.update(createSnapshot(failed));
    expect(view.gateRing('gate-bundle')?.pulse).toBe(pulse);

    const repaired = withGateRun(tickTheClock(failed, 900), 'gate-bundle', 'passed', 1);
    view.update(createSnapshot(repaired));
    const settled = view.gateRing('gate-bundle');
    expect(settled?.state).toBe('passed');
    expect(settled?.repair).toBe(false);
    expect(settled?.color).toBe(GATE_RING_COLORS.passed);
    expect(view.gateSegments('gate-bundle')).toBe(2);
    view.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Quality constellation                                                      */
/* -------------------------------------------------------------------------- */

describe('quality constellation', () => {
  it('classifies every criterion against the metrics in state', () => {
    const metrics = readQualityMetrics(SAMPLE);
    expect(metrics.map((metric) => metric.id)).toEqual([
      'metric-fidelity',
      'metric-determinism',
      'metric-frame-budget',
      'metric-contract-coverage',
      'metric-readability',
    ]);

    const kinds = metrics.map((_, index) => classifyCriterion(metrics, index).kind);
    expect(kinds).toEqual([
      'final-invariant',
      'final-invariant',
      'milestone',
      'milestone',
      'milestone',
    ]);
    expect(FINAL_INVARIANT_WEIGHT).toBe(0.25);

    // A weak criterion settled before a heavier one is superseded by it.
    const live = readQualityMetrics(
      withMetric(withMetric(SAMPLE, 'metric-contract-coverage', 0.96), 'metric-frame-budget', 1),
    );
    const frameBudget = classifyCriterion(live, 2);
    expect(frameBudget.kind).toBe('superseded');
    expect(frameBudget.supersededBy).toBe('metric-contract-coverage');
    // The heavier settlement stays a milestone of its own.
    expect(classifyCriterion(live, 3).kind).toBe('milestone');
  });

  it('draws a distinct shape and glyph per lifecycle', () => {
    const adapter = createHeadlessAdapter();
    const view = createQualityGraph(adapter.scene);
    const state = withMetric(withMetric(SAMPLE, 'metric-contract-coverage', 0.96), 'metric-frame-budget', 1);
    view.update(createSnapshot(state));

    expect(view.count).toBe(5);

    const invariant = view.bodyFor('metric-determinism');
    expect(invariant?.geometry).toBeInstanceOf(OctahedronGeometry);
    expect(view.glyphFor('metric-determinism')?.geometry).toBeInstanceOf(TorusGeometry);

    const milestone = view.bodyFor('metric-readability');
    expect(milestone?.geometry).toBeInstanceOf(TetrahedronGeometry);
    expect(view.glyphFor('metric-readability')?.geometry).toBeInstanceOf(BoxGeometry);
    expect(milestone?.geometry).not.toBe(invariant?.geometry);

    const superseded = view.bodyFor('metric-frame-budget');
    expect(superseded?.geometry).toBeInstanceOf(TetrahedronGeometry);
    expect((superseded?.material as { wireframe?: boolean }).wireframe).toBe(true);
    expect(
      (view.bodyFor('metric-readability')?.material as { wireframe?: boolean }).wireframe,
    ).toBe(false);

    // Named for tooling: one group, body and glyph per criterion.
    expect(view.root.getObjectByName(CRITERION_NAMES.body('metric-readability'))).toBeDefined();
    expect(view.objectFor('metric-readability')?.name).toBe(
      CRITERION_NAMES.node('metric-readability'),
    );
    view.dispose();
  });

  it('grows upward as final invariants complete', () => {
    const adapter = createHeadlessAdapter();
    const view = createQualityGraph(adapter.scene);
    view.update(createSnapshot(SAMPLE));

    const invariant = view.criterion('metric-fidelity');
    expect(invariant?.kind).toBe('final-invariant');
    expect(invariant?.completed).toBe(false);
    const invariantY = invariant?.position.y ?? 0;
    expect(view.completedFinalInvariants).toBe(1); // determinism already holds
    expect(view.apexY).toBeGreaterThan(invariantY);

    // Easing the strongest invariant shrinks the constellation...
    view.update(createSnapshot(withMetric(SAMPLE, 'metric-determinism', 0.5)));
    const shrunkenApex = view.apexY;
    expect(view.completedFinalInvariants).toBe(0);

    // ...and completing it lifts the apex: the constellation grows upward.
    view.update(createSnapshot(withMetric(SAMPLE, 'metric-determinism', 1)));
    const highest = view.criterion('metric-determinism');
    expect(highest?.completed).toBe(true);
    expect(highest?.position.y).toBeCloseTo(
      CONSTELLATION_DEFAULTS.baseHeight + 3.2 + CONSTELLATION_DEFAULTS.invariantRise,
      6,
    );
    expect(view.apexY).toBeGreaterThan(shrunkenApex);
    expect(view.apexY).toBeCloseTo(highest?.position.y ?? 0, 6);
    expect(view.completedFinalInvariants).toBe(1);

    // A second final invariant completing climbs to join it.
    view.update(createSnapshot(withMetric(SAMPLE, 'metric-fidelity', 1)));
    expect(view.criterion('metric-fidelity')?.completed).toBe(true);
    expect(view.criterion('metric-fidelity')?.position.y).toBeGreaterThan(invariantY);
    expect(view.completedFinalInvariants).toBe(2);
    expect(view.objectFor('metric-fidelity')?.position.y).toBeCloseTo(
      view.criterion('metric-fidelity')?.position.y ?? 0,
      6,
    );

    // Milestones climb as well, but stay in their own band.
    const milestoneY = view.criterion('metric-readability')?.position.y ?? 0;
    view.update(createSnapshot(withMetric(SAMPLE, 'metric-readability', 1)));
    expect(view.criterion('metric-readability')?.position.y).toBeGreaterThan(milestoneY);
    expect(view.criterion('metric-readability')?.position.y).toBeLessThan(
      view.criterion('metric-fidelity')?.position.y ?? 0,
    );
    view.dispose();
  });

  it('links a superseded criterion to its replacement', () => {
    const adapter = createHeadlessAdapter();
    const view = createQualityGraph(adapter.scene);
    const state = withMetric(withMetric(SAMPLE, 'metric-contract-coverage', 0.96), 'metric-frame-budget', 1);
    view.update(createSnapshot(state));

    const superseded = view.criterion('metric-frame-budget');
    const replacement = view.criterion('metric-contract-coverage');
    expect(superseded?.kind).toBe('superseded');
    expect(superseded?.supersededBy).toBe('metric-contract-coverage');
    expect(view.supersededCount).toBe(1);
    expect(replacement?.kind).toBe('milestone');

    const link = view.linkFor('metric-frame-budget');
    expect(link).toBeDefined();
    const positions = link?.geometry.getAttribute('position');
    expect(positions?.count).toBe(2);
    expect(positions?.getX(0)).toBeCloseTo(superseded?.position.x ?? 0, 6);
    expect(positions?.getY(1)).toBeCloseTo(replacement?.position.y ?? 0, 6);

    // History rests below the live bands, drawn as a dim wireframe.
    expect(superseded?.position.y).toBeLessThan(CONSTELLATION_DEFAULTS.baseHeight);
    expect(link?.visible).toBe(true);
    // Live criteria are not linked.
    expect(view.linkFor('metric-readability')).toBeUndefined();
    view.dispose();
  });

  it('builds the same layout twice from the same state', () => {
    const first = createConstellationLayout(SAMPLE);
    const second = createConstellationLayout(SAMPLE);
    expect(first).toHaveLength(5);
    for (let index = 0; index < first.length; index += 1) {
      const left = first[index];
      const right = second[index];
      expect(left?.active).toBe(true);
      expect(right?.kind).toBe(left?.kind);
      expect(right?.position.x).toBeCloseTo(left?.position.x ?? 0, 9);
      expect(right?.position.y).toBeCloseTo(left?.position.y ?? 0, 9);
      expect(right?.position.z).toBeCloseTo(left?.position.z ?? 0, 9);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Composition and disposal                                                   */
/* -------------------------------------------------------------------------- */

describe('composition over the shared contracts', () => {
  it('builds, updates, renders and disposes through createGame + headless adapter', () => {
    const adapter = createHeadlessAdapter({ width: 960, height: 540 });
    const game = createGame({
      adapter,
      systems: [createLaneAgentsSystem(), createQualityGraphSystem()],
      state: createSampleState(),
      stepMs: 10,
    });

    game.advance(120);
    game.render();

    expect(adapter.scene.getObjectByName(LANE_AGENT_NAMES.root)).toBeDefined();
    expect(adapter.scene.getObjectByName(CRITERION_NAMES.root)).toBeDefined();
    expect(adapter.frameCount).toBeGreaterThan(0);

    const comets = adapter.scene.getObjectByName(LANE_AGENT_NAMES.comets);
    const travelling = (comets?.children ?? []).filter((child) => child.visible);
    expect(travelling.length).toBeGreaterThanOrEqual(3);

    const settled = adapter.scene.getObjectByName(LANE_AGENT_NAMES.gate('gate-typecheck'));
    expect(settled?.visible).toBe(true);
    expect((settled?.children ?? []).filter((child) => child.visible)).toHaveLength(2);

    const constellationYBefore =
      adapter.scene.getObjectByName(CRITERION_NAMES.node('metric-fidelity'))?.position.y ?? 0;

    // Drive the fixture from the running simulation: a gate fails into an alarm
    // and an invariant completes, growing the constellation.
    const at = game.state.mission.elapsedMs + 1;
    game.emit(
      makeDomainEvent('verification/run', { gateId: 'gate-boot-smoke', status: 'failed', coverage: 0.31 }, at),
    );
    game.emit(
      makeDomainEvent(
        'quality/measured',
        { metric: { id: 'metric-fidelity', label: 'Visual fidelity', value: 1, target: 1, weight: 0.25 } },
        at,
      ),
    );
    game.advance(60);

    const alarm = adapter.scene.getObjectByName(LANE_AGENT_NAMES.gate('gate-boot-smoke'));
    expect((alarm?.children ?? []).filter((child) => child.visible)).toHaveLength(3);
    const constellationYAfter =
      adapter.scene.getObjectByName(CRITERION_NAMES.node('metric-fidelity'))?.position.y ?? 0;
    expect(constellationYAfter).toBeGreaterThan(constellationYBefore);
    expect(constellationYAfter).toBeGreaterThan(CONSTELLATION_DEFAULTS.baseHeight + 3.2);

    game.dispose();
    expect(game.disposed).toBe(true);
    expect(adapter.disposed).toBe(true);
    expect(adapter.scene.children).toHaveLength(0);
  });

  it('streams the preview show: comets, a repair alarm and a changing constellation', () => {
    const adapter = createHeadlessAdapter();
    const game = createGame({
      adapter,
      systems: [
        createLaneAgentsSystem(),
        createQualityGraphSystem(),
        createLaneShowDirector({ cycleMs: 12_000 }),
      ],
      state: createSampleState(),
      stepMs: 20,
    });

    const cometName = LANE_AGENT_NAMES.comet('lane-build', 0);
    game.advance(20);
    const start = adapter.scene.getObjectByName(cometName)?.position.clone() ?? new Vector3();
    let travelled = 0;
    let sawAlarm = false;
    let sawAlarmSegments = false;
    let sawSuperseded = false;
    let settledInvariants = 0;
    const occupancyAt = (state: typeof game.state): number =>
      measureLaneOccupancies(state).reduce((total, lane) => total + lane.occupancy, 0);
    let maxOccupancy = occupancyAt(game.state);

    for (let tick = 0; tick < 700; tick += 1) {
      game.advance(20);
      const state = game.state;
      const head = adapter.scene.getObjectByName(cometName);
      if (head) travelled = Math.max(travelled, head.position.distanceTo(start));

      const failing = state.verification.order
        .map((gateId) => state.verification.gates[gateId])
        .find((gate) => gate?.status === 'failed');
      if (failing) {
        sawAlarm = true;
        const ring = adapter.scene.getObjectByName(LANE_AGENT_NAMES.gate(failing.id));
        const lit = (ring?.children ?? []).filter((child) => child.visible);
        if (lit.length === 3) sawAlarmSegments = true;
      }

      const criteria = createConstellationLayout(state);
      if (criteria.some((criterion) => criterion.kind === 'superseded')) sawSuperseded = true;
      settledInvariants = Math.max(
        settledInvariants,
        criteria.filter((criterion) => criterion.kind === 'final-invariant' && criterion.completed)
          .length,
      );
      maxOccupancy = Math.max(maxOccupancy, occupancyAt(state));
    }

    expect(travelled).toBeGreaterThan(1); // comets stream along the conduits
    expect(sawAlarm).toBe(true); // a gate raises the repair alarm
    expect(sawAlarmSegments).toBe(true); // drawn as broken arcs, not colour alone
    expect(sawSuperseded).toBe(true); // criteria move through their lifecycles
    expect(settledInvariants).toBeGreaterThanOrEqual(2); // invariants complete
    expect(maxOccupancy).toBeGreaterThan(3); // queued work multiplies the comets
    expect(describeHologram(game.state)).toHaveLength(4);

    game.dispose();
  });

  it('drives the preview gate scenarios on demand (fail a gate, repair the fleet)', () => {
    const adapter = createHeadlessAdapter();
    const game = createGame({
      adapter,
      systems: [createLaneAgentsSystem(), createQualityGraphSystem()],
      state: createSampleState(),
      stepMs: 20,
    });
    const controls = createScenarioControls({ game });
    game.advance(20);

    // Baseline: nothing is alarmed.
    expect(
      game.state.verification.order.map((gateId) => game.state.verification.gates[gateId]?.status),
    ).not.toContain('failed');

    // "Fail a gate": the alarm state appears in state and in the ring geometry.
    controls.failGate();
    const failedId = game.state.verification.order.find(
      (gateId) => game.state.verification.gates[gateId]?.status === 'failed',
    );
    expect(failedId).toBeDefined();
    game.advance(20);
    const alarmed = adapter.scene.getObjectByName(LANE_AGENT_NAMES.gate(failedId ?? ''));
    expect((alarmed?.children ?? []).filter((child) => child.visible)).toHaveLength(3);

    // "Repair gates": every ring settles back to the unbroken green state.
    controls.repairGates();
    game.advance(20);
    const statuses = game.state.verification.order.map(
      (gateId) => game.state.verification.gates[gateId]?.status,
    );
    expect(statuses.every((status) => status === 'passed')).toBe(true);
    const repaired = adapter.scene.getObjectByName(LANE_AGENT_NAMES.gate(failedId ?? ''));
    expect((repaired?.children ?? []).filter((child) => child.visible)).toHaveLength(2);

    game.dispose();
  });

  it('releases pooled resources and is safe to dispose twice', () => {    const adapter = createHeadlessAdapter();
    const laneView = createLaneAgentsView(adapter.scene);
    const graphView = createQualityGraph(adapter.scene);
    laneView.update(createSnapshot(SAMPLE));
    graphView.update(createSnapshot(SAMPLE));
    expect(adapter.scene.children.length).toBeGreaterThan(0);

    laneView.dispose();
    graphView.dispose();

    expect(laneView.disposed).toBe(true);
    expect(graphView.disposed).toBe(true);
    expect(laneView.disposedResources?.geometries ?? 0).toBeGreaterThan(0);
    expect(laneView.disposedResources?.materials ?? 0).toBeGreaterThan(0);
    expect(graphView.disposedResources?.geometries ?? 0).toBeGreaterThan(0);
    expect(graphView.disposedResources?.materials ?? 0).toBeGreaterThan(0);
    expect(laneView.root.children).toHaveLength(0);
    expect(graphView.root.children).toHaveLength(0);
    expect(laneView.root.parent).toBeNull();
    expect(graphView.root.parent).toBeNull();
    expect(laneView.comets.every((comet) => !comet.active)).toBe(true);

    // Updates after disposal do nothing rather than throwing.
    laneView.update(createSnapshot(SAMPLE));
    graphView.update(createSnapshot(SAMPLE));
    expect(laneView.cometCount).toBe(0);
    expect(graphView.count).toBe(0);
    expect(graphView.apexY).toBe(0);

    laneView.dispose();
    graphView.dispose();
  });
});
