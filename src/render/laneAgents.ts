/**
 * Lane agents — comets that race the conduits of the plan graph, and the
 * verification gate rings that halo the nodes they guard.
 *
 * Design notes:
 *
 *  - The view reads only the foundation state slices (`plan`, `lanes`,
 *    `verification`). It deliberately does not import the lane, quality or graph
 *    simulation modules: the comet path is a deterministic pure function of the
 *    plan state (node positions derived from dependency depth and lane order),
 *    derived and sampled locally so the motion layer stays independent of
 *    dispatch.
 *  - Nothing here is driven by wall-clock time. Comet travel, gate pulses and
 *    ring spin are functions of `state.mission.elapsedMs` and of the task
 *    progress values carried by the state, so a replay draws identical frames.
 *  - Every mesh, geometry, material and ribbon is pooled when the view is
 *    created. `update()` walks cached records and writes transforms and vertex
 *    buffers in place, so the per-frame path allocates nothing; layout is
 *    rebuilt only when the plan/lane/gate *shape* changes (a new id, a new
 *    dependency edge), which is detected from the state revision.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  RingGeometry,
  Vector3,
} from 'three';

import { disposeRenderResources, type DisposedResources } from './renderer';
import type { GameSystem } from '../game/systems';
import type { DeepReadonly, GameState, LaneKind, TaskStatus } from '../sim/state';

/* -------------------------------------------------------------------------- */
/* Tunables and public constants                                              */
/* -------------------------------------------------------------------------- */

/** Simulated milliseconds a comet needs for one full conduit pass. */
export const COMET_TRAVEL_MS = 2_600;
/** Shortest comet trail, in world units. */
export const TRAIL_MIN_LENGTH = 1.6;
/** Longest comet trail, in world units. */
export const TRAIL_MAX_LENGTH = 5.2;
/** Lane occupancy at which a trail reaches `TRAIL_MAX_LENGTH`. */
export const SPRINT_OCCUPANCY = 3;
/** Samples written into a comet trail ribbon. */
export const TRAIL_SAMPLES = 14;
/** Object-name prefixes, so tests and tooling can address the scene graph. */
export const LANE_AGENT_NAMES = {
  root: 'lane-agents',
  nodes: 'lane-agents-nodes',
  conduits: 'lane-agents-conduits',
  comets: 'lane-agents-comets',
  gates: 'lane-agents-gates',
  node: (taskId: string): string => `plan-node-${taskId}`,
  conduit: (conduitId: string): string => `conduit-${conduitId}`,
  comet: (laneId: string, index: number): string => `comet-${laneId}-${index}`,
  cometTrail: (laneId: string, index: number): string => `comet-${laneId}-${index}-trail`,
  gate: (gateId: string): string => `gate-ring-${gateId}`,
  gateSegment: (gateId: string, segment: number): string => `gate-ring-${gateId}-segment-${segment}`,
} as const;

/** Ring colour per gate state. Also mirrored into the sampled descriptor. */
export const GATE_RING_COLORS = {
  pending: 0x2f6f86,
  passed: 0x59ff9b,
  failed: 0xff2d6f,
} as const;

/**
 * Ring segment pattern per gate state.
 *
 *  - `sparse-dashes` — four short dim dashes (nothing settled yet).
 *  - `solid-ring`    — one unbroken ring plus a filled core (settled green).
 *  - `broken-arcs`   — two long arcs, two dark gaps and a short repair arc
 *                      (failed, a repair is in flight).
 */
export type GateRingPattern = 'sparse-dashes' | 'solid-ring' | 'broken-arcs';
/** The three visually distinct gate states. */
export type GateRingState = 'pending' | 'passed' | 'failed';

export interface GateRingDescriptor {
  readonly state: GateRingState;
  readonly pattern: GateRingPattern;
  /** Number of ring-body segments the pattern lights up. */
  readonly segments: number;
  /** True for `failed`, where a repair arc accompanies the alarm. */
  readonly repair: boolean;
  /** True for `passed`, which also lights a filled core. */
  readonly core: boolean;
  readonly color: number;
  /** Pulse period in simulated milliseconds. */
  readonly pulsePeriodMs: number;
}

/** Map a gate lifecycle status onto its ring descriptor. Pure. */
export function classifyGateRing(status: TaskStatus): GateRingDescriptor {
  switch (status) {
    case 'passed':
      return {
        state: 'passed',
        pattern: 'solid-ring',
        segments: 1,
        repair: false,
        core: true,
        color: GATE_RING_COLORS.passed,
        pulsePeriodMs: 1_500,
      };
    case 'failed':
      return {
        state: 'failed',
        pattern: 'broken-arcs',
        segments: 3,
        repair: true,
        core: false,
        color: GATE_RING_COLORS.failed,
        pulsePeriodMs: 480,
      };
    case 'pending':
    case 'running':
    case 'blocked':
    default:
      return {
        state: 'pending',
        pattern: 'sparse-dashes',
        segments: 4,
        repair: false,
        core: false,
        color: GATE_RING_COLORS.pending,
        pulsePeriodMs: 3_200,
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Pure geometry helpers                                                      */
/* -------------------------------------------------------------------------- */

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Cubic Bézier evaluation into `out`. Allocation-free. */
function bezier(
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  t: number,
  out: Vector3,
): Vector3 {
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const c = 3 * s * t * t;
  const d = t * t * t;
  return out.set(
    p0.x * a + p1.x * b + p2.x * c + p3.x * d,
    p0.y * a + p1.y * b + p2.y * c + p3.y * d,
    p0.z * a + p1.z * b + p2.z * c + p3.z * d,
  );
}

/** Comet trail length for a lane occupancy reading. Pure. */
export function cometTrailLength(occupancy: number): number {
  const load = clamp01(occupancy / SPRINT_OCCUPANCY);
  return TRAIL_MIN_LENGTH + (TRAIL_MAX_LENGTH - TRAIL_MIN_LENGTH) * load;
}

/**
 * Deterministic comet phase along its conduit, in [0, 1).
 *
 * `elapsedMs` is the *simulated* clock carried by the state, `progress` is the
 * travelling task's own progress, and `index / count` spaces the comets of one
 * lane evenly along the path. The same inputs always give the same phase, which
 * is what makes a replay frame-identical.
 */
export function cometPhase(
  elapsedMs: number,
  index: number,
  count: number,
  progress: number,
  travelMs: number = COMET_TRAVEL_MS,
): number {
  const period = travelMs > 0 ? travelMs : COMET_TRAVEL_MS;
  const cycle = ((elapsedMs % period) + period) % period;
  const spacing = count > 0 ? index / count : 0;
  const u = cycle / period + spacing + clamp01(progress) * 0.45;
  return u - Math.floor(u);
}

export type ConduitKind = 'dependency' | 'approach';

export interface ConduitPathOptions {
  /** Samples recorded along the conduit. Defaults to 48. */
  samples?: number;
  /** Arch height as a fraction of the horizontal span. */
  arc?: number;
  /** Lateral bow as a fraction of the horizontal span. */
  bow?: number;
  /** Minimum arch height in world units. */
  minArch?: number;
}

export interface ConduitSpec {
  id: string;
  kind: ConduitKind;
  /** Source node id (or `entry:<laneId>` for a lane portal). */
  from: string;
  /** Target node id. */
  to: string;
  laneId: string;
  start: Vector3;
  end: Vector3;
  options?: ConduitPathOptions;
}

/**
 * A sampled conduit: four Bézier control points plus baked point/tangent tables.
 *
 * The tables are the reason comet motion is allocation-free: `update()` only
 * lerps between two precomputed samples instead of evaluating a curve.
 */
export interface ConduitPath {
  readonly id: string;
  readonly kind: ConduitKind;
  readonly from: string;
  readonly to: string;
  readonly laneId: string;
  readonly controlPoints: readonly [Vector3, Vector3, Vector3, Vector3];
  readonly points: Float32Array;
  readonly tangents: Float32Array;
  readonly samples: number;
  /** Polyline length in world units. */
  readonly length: number;
}

/** Build a conduit path from two node anchors. Pure and deterministic. */
export function createConduitPath(spec: ConduitSpec): ConduitPath {
  const { start, end } = spec;
  const options = spec.options ?? {};
  const samples = Math.max(2, Math.trunc(options.samples ?? 48));
  const arc = options.arc ?? 0.24;
  const bow = options.bow ?? 0.12;
  const minArch = options.minArch ?? 0.6;

  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const span = Math.hypot(dx, dz) || 1;
  const dirX = dx / span;
  const dirZ = dz / span;
  // Horizontal perpendicular, used for the lateral bow.
  const perpX = -dirZ;
  const perpZ = dirX;

  const arch = Math.max(minArch, span * arc);
  const lateral = span * bow;

  const p0 = start.clone();
  const p1 = new Vector3(
    start.x + dirX * (span / 3) + perpX * lateral,
    start.y + arch,
    start.z + dirZ * (span / 3) + perpZ * lateral,
  );
  const p2 = new Vector3(
    end.x - dirX * (span / 3) + perpX * lateral,
    end.y + arch,
    end.z - dirZ * (span / 3) + perpZ * lateral,
  );
  const p3 = end.clone();

  const points = new Float32Array(samples * 3);
  const tangents = new Float32Array(samples * 3);
  const cursor = new Vector3();
  const ahead = new Vector3();
  const behind = new Vector3();
  const tangent = new Vector3();

  for (let i = 0; i < samples; i += 1) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    bezier(p0, p1, p2, p3, t, cursor);
    points[i * 3] = cursor.x;
    points[i * 3 + 1] = cursor.y;
    points[i * 3 + 2] = cursor.z;

    const tBefore = Math.max(0, t - 1 / (samples - 1) / 2);
    const tAfter = Math.min(1, t + 1 / (samples - 1) / 2);
    bezier(p0, p1, p2, p3, tBefore, behind);
    bezier(p0, p1, p2, p3, tAfter, ahead);
    tangent.copy(ahead).sub(behind);
    if (tangent.lengthSq() < 1e-8) tangent.set(dirX, 0, dirZ);
    tangent.normalize();
    tangents[i * 3] = tangent.x;
    tangents[i * 3 + 1] = tangent.y;
    tangents[i * 3 + 2] = tangent.z;
  }

  let length = 0;
  for (let i = 1; i < samples; i += 1) {
    const ax = points[(i - 1) * 3] ?? 0;
    const ay = points[(i - 1) * 3 + 1] ?? 0;
    const az = points[(i - 1) * 3 + 2] ?? 0;
    const bx = points[i * 3] ?? 0;
    const by = points[i * 3 + 1] ?? 0;
    const bz = points[i * 3 + 2] ?? 0;
    length += Math.hypot(bx - ax, by - ay, bz - az);
  }

  return {
    id: spec.id,
    kind: spec.kind,
    from: spec.from,
    to: spec.to,
    laneId: spec.laneId,
    controlPoints: [p0, p1, p2, p3],
    points,
    tangents,
    samples,
    length,
  };
}

/** Sample a conduit at `u` (clamped). Allocation-free for a given `out`. */
export function sampleConduitPath(path: ConduitPath, u: number, out: Vector3): Vector3 {
  const clamped = clamp01(u);
  const scaled = clamped * (path.samples - 1);
  const index = Math.min(path.samples - 2, Math.floor(scaled));
  const frac = scaled - index;
  const a = index * 3;
  const b = a + 3;
  const ax = path.points[a] ?? 0;
  const ay = path.points[a + 1] ?? 0;
  const az = path.points[a + 2] ?? 0;
  const bx = path.points[b] ?? ax;
  const by = path.points[b + 1] ?? ay;
  const bz = path.points[b + 2] ?? az;
  return out.set(ax + (bx - ax) * frac, ay + (by - ay) * frac, az + (bz - az) * frac);
}

/** Sample a conduit tangent at `u` (clamped, normalised). */
export function sampleConduitTangent(path: ConduitPath, u: number, out: Vector3): Vector3 {
  const clamped = clamp01(u);
  const index = Math.round(clamped * (path.samples - 1));
  const a = Math.min(path.samples - 1, Math.max(0, index)) * 3;
  out.set(path.tangents[a] ?? 1, path.tangents[a + 1] ?? 0, path.tangents[a + 2] ?? 0);
  if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
  return out.normalize();
}

/* -------------------------------------------------------------------------- */
/* Plan-graph layout                                                          */
/* -------------------------------------------------------------------------- */

export interface LaneGraphLayoutOptions {
  /** Horizontal gap between plan-depth columns. */
  columnGap?: number;
  /** Horizontal gap between lane rows. */
  rowGap?: number;
  /** Height of the floor the nodes stand on. */
  floorY?: number;
  /** Distance in front of the first column where lane portals sit. */
  entryGap?: number;
  /** Conduit arch height as a fraction of the horizontal span. */
  arc?: number;
  /** Conduit lateral bow as a fraction of the horizontal span. */
  bow?: number;
  /** Samples recorded per conduit path. */
  samples?: number;
}

/** Defaults used by the view and by the preview page. */
export const LANE_LAYOUT_DEFAULTS: Required<LaneGraphLayoutOptions> = {
  columnGap: 9,
  rowGap: 7.2,
  floorY: 0.5,
  entryGap: 8.5,
  arc: 0.24,
  bow: 0.12,
  samples: 48,
};

export interface LaneGraphNode {
  readonly id: string;
  readonly title: string;
  readonly laneId: string;
  readonly status: TaskStatus;
  /** Longest dependency chain from a root task, root tasks being 0. */
  readonly depth: number;
  /** Index in `plan.order`. */
  readonly index: number;
  readonly position: Vector3;
}

export interface LaneAnchor {
  readonly laneId: string;
  readonly kind: LaneKind;
  readonly label: string;
  /** Portal the lane's agents enter the floor through. */
  readonly entry: Vector3;
  /** Resting position used when a lane has no task nodes. */
  readonly position: Vector3;
}

export interface LaneGraphConduit {
  readonly id: string;
  readonly kind: ConduitKind;
  readonly laneId: string;
  readonly from: string;
  readonly to: string;
  readonly path: ConduitPath;
}

export interface LaneGraphLayout {
  readonly nodes: readonly LaneGraphNode[];
  readonly conduits: readonly LaneGraphConduit[];
  readonly anchors: readonly LaneAnchor[];
  /** Conduits that empty into a given task node, dependencies first. */
  readonly conduitsByTarget: ReadonlyMap<string, readonly LaneGraphConduit[]>;
  /** Conduits a lane operates, in plan order. */
  readonly conduitsByLane: ReadonlyMap<string, readonly LaneGraphConduit[]>;
  /** Structural fingerprint; the view rebuilds only when this changes. */
  readonly signature: string;
  readonly bounds: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly maxDepth: number;
    readonly laneCount: number;
  };
}

/** State this module reads: the live document or a frozen snapshot. */
export type LaneViewState = GameState | DeepReadonly<GameState>;

/**
 * Longest dependency chain per task, memoised and cycle-safe.
 *
 * Depth is what turns the plan DAG into a left-to-right factory floor: roots sit
 * in the first column, everything downstream marches to the right.
 */
export function computeTaskDepths(state: LaneViewState): Map<string, number> {
  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (taskId: string): number => {
    const cached = depths.get(taskId);
    if (cached !== undefined) return cached;
    if (visiting.has(taskId)) return 0;
    const task = state.plan.tasks[taskId];
    if (!task) return 0;
    visiting.add(taskId);
    let depth = 0;
    for (const dependency of task.dependencies) {
      depth = Math.max(depth, depthOf(dependency) + 1);
    }
    visiting.delete(taskId);
    depths.set(taskId, depth);
    return depth;
  };

  for (const taskId of state.plan.order) depthOf(taskId);
  return depths;
}

/** Deterministic structural fingerprint of everything the layout depends on. */
function layoutSignature(state: LaneViewState): string {
  const parts: string[] = [];
  for (const taskId of state.plan.order) {
    const task = state.plan.tasks[taskId];
    if (!task) continue;
    parts.push(`${taskId}@${task.laneId}<${task.dependencies.join(',')}`);
  }
  parts.push('#', state.lanes.order.join(','));
  for (const gateId of state.verification.order) {
    const gate = state.verification.gates[gateId];
    if (!gate) continue;
    parts.push(`${gateId}@${gate.laneId}`);
  }
  return parts.join('|');
}

/**
 * Build the floor layout: one node per plan task, one conduit per dependency
 * edge, one portal and one approach conduit per lane.
 *
 * Pure: identical state gives byte-identical positions, which is what lets the
 * view and its test derive the same comet path independently.
 */
export function createLaneGraphLayout(
  state: LaneViewState,
  options: LaneGraphLayoutOptions = {},
): LaneGraphLayout {
  const config = { ...LANE_LAYOUT_DEFAULTS, ...options };
  const laneIds = state.lanes.order.filter((laneId) => state.lanes.lanes[laneId] !== undefined);
  const laneCount = Math.max(1, laneIds.length);
  const laneIndexById = new Map<string, number>();
  laneIds.forEach((laneId, index) => laneIndexById.set(laneId, index));

  const depths = computeTaskDepths(state);
  let maxDepth = 0;
  for (const depth of depths.values()) maxDepth = Math.max(maxDepth, depth);

  const rowZ = (laneIndex: number): number =>
    (laneIndex - (laneCount - 1) / 2) * config.rowGap;
  const columnX = (depth: number): number => (depth - maxDepth / 2) * config.columnGap;

  const nodes: LaneGraphNode[] = [];
  for (const taskId of state.plan.order) {
    const task = state.plan.tasks[taskId];
    if (!task) continue;
    const depth = depths.get(taskId) ?? 0;
    const laneIndex = laneIndexById.get(task.laneId) ?? 0;
    nodes.push({
      id: task.id,
      title: task.title,
      laneId: task.laneId,
      status: task.status,
      depth,
      index: nodes.length,
      position: new Vector3(columnX(depth), config.floorY, rowZ(laneIndex)),
    });
  }
  const nodeById = new Map<string, LaneGraphNode>();
  for (const node of nodes) nodeById.set(node.id, node);

  /** Top of a node's pylon — where conduits and comets meet the node. */
  const nodeAnchor = (node: LaneGraphNode): Vector3 =>
    new Vector3(node.position.x, node.position.y + 1.05, node.position.z);

  const anchors: LaneAnchor[] = laneIds.map((laneId, index) => {
    const lane = state.lanes.lanes[laneId];
    const kind: LaneKind = lane?.kind ?? 'build';
    const label = lane?.label ?? laneId;
    const entry = new Vector3(
      columnX(0) - config.entryGap,
      config.floorY,
      rowZ(index),
    );
    return {
      laneId,
      kind,
      label,
      entry,
      // A lane without task nodes still needs a resting anchor to hang from.
      position: entry.clone(),
    };
  });
  const anchorByLane = new Map<string, LaneAnchor>();
  for (const anchor of anchors) anchorByLane.set(anchor.laneId, anchor);

  const conduits: LaneGraphConduit[] = [];
  // Dependency conduits first, in plan order: they are the primary agent paths.
  for (const taskId of state.plan.order) {
    const task = state.plan.tasks[taskId];
    if (!task) continue;
    const target = nodeById.get(task.id);
    if (!target) continue;
    for (const dependency of task.dependencies) {
      const source = nodeById.get(dependency);
      if (!source) continue;
      conduits.push({
        id: `${dependency}->${task.id}`,
        kind: 'dependency',
        laneId: task.laneId,
        from: dependency,
        to: task.id,
        path: createConduitPath({
          id: `${dependency}->${task.id}`,
          kind: 'dependency',
          from: dependency,
          to: task.id,
          laneId: task.laneId,
          start: nodeAnchor(source),
          end: nodeAnchor(target),
          options: config,
        }),
      });
    }
  }

  // One portal conduit per lane, aimed at the lane's deepest node.
  for (const anchor of anchors) {
    const laneNodes = nodes.filter((node) => node.laneId === anchor.laneId);
    const primary = laneNodes.reduce<LaneGraphNode | null>(
      (best, node) =>
        best === null || node.depth > best.depth || (node.depth === best.depth && node.index < best.index)
          ? node
          : best,
      null,
    );
    if (!primary) continue;
    conduits.push({
      id: `entry:${anchor.laneId}->${primary.id}`,
      kind: 'approach',
      laneId: anchor.laneId,
      from: `entry:${anchor.laneId}`,
      to: primary.id,
      path: createConduitPath({
        id: `entry:${anchor.laneId}->${primary.id}`,
        kind: 'approach',
        from: `entry:${anchor.laneId}`,
        to: primary.id,
        laneId: anchor.laneId,
        start: anchor.entry.clone(),
        end: nodeAnchor(primary),
        options: { ...config, arc: config.arc * 0.7 },
      }),
    });
  }

  // Root tasks whose lane portal aims elsewhere still need an inbound path.
  for (const node of nodes) {
    if (depths.get(node.id) !== 0) continue;
    const anchor = anchorByLane.get(node.laneId);
    if (!anchor) continue;
    const alreadyInbound = conduits.some(
      (conduit) => conduit.to === node.id && conduit.kind === 'approach',
    );
    if (alreadyInbound) continue;
    conduits.push({
      id: `entry:${node.laneId}->${node.id}`,
      kind: 'approach',
      laneId: node.laneId,
      from: `entry:${node.laneId}`,
      to: node.id,
      path: createConduitPath({
        id: `entry:${node.laneId}->${node.id}`,
        kind: 'approach',
        from: `entry:${node.laneId}`,
        to: node.id,
        laneId: node.laneId,
        start: anchor.entry.clone(),
        end: nodeAnchor(node),
        options: { ...config, arc: config.arc * 0.7 },
      }),
    });
  }

  const conduitsByTarget = new Map<string, LaneGraphConduit[]>();
  const conduitsByLane = new Map<string, LaneGraphConduit[]>();
  for (const conduit of conduits) {
    const inbound = conduitsByTarget.get(conduit.to);
    if (inbound) inbound.push(conduit);
    else conduitsByTarget.set(conduit.to, [conduit]);

    const owned = conduitsByLane.get(conduit.laneId);
    if (owned) owned.push(conduit);
    else conduitsByLane.set(conduit.laneId, [conduit]);
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const track = (x: number, z: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (const node of nodes) track(node.position.x, node.position.z);
  for (const anchor of anchors) track(anchor.entry.x, anchor.entry.z);
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
    minZ = 0;
    maxZ = 0;
  }

  return {
    nodes,
    conduits,
    anchors,
    conduitsByTarget,
    conduitsByLane,
    signature: layoutSignature(state),
    bounds: { minX, maxX, minZ, maxZ, maxDepth, laneCount: laneIds.length },
  };
}

/** The node a verification gate guards: its lane's deepest task node. */
export function gateTargetNode(
  layout: LaneGraphLayout,
  laneId: string,
): LaneGraphNode | undefined {
  const candidates = layout.nodes.filter((node) => node.laneId === laneId);
  return candidates.reduce<LaneGraphNode | undefined>(
    (best, node) =>
      best === undefined || node.depth > best.depth || (node.depth === best.depth && node.index < best.index)
        ? node
        : best,
    undefined,
  );
}

/* -------------------------------------------------------------------------- */
/* Lane occupancy                                                             */
/* -------------------------------------------------------------------------- */

export interface LaneOccupancy {
  readonly laneId: string;
  readonly capacity: number;
  /** 1 when a task is riding the lane, else 0. */
  readonly active: number;
  readonly queued: number;
  /** Running plan tasks assigned to this lane. */
  readonly running: number;
  /** Occupancy the comet count follows: `max(active + queued, running)`. */
  readonly occupancy: number;
  readonly utilization: number;
}

/** Occupancy of a single lane, read straight from the state slices. Pure. */
export function measureLaneOccupancy(state: LaneViewState, laneId: string): LaneOccupancy {
  const lane = state.lanes.lanes[laneId];
  let running = 0;
  for (const taskId of state.plan.order) {
    const task = state.plan.tasks[taskId];
    if (!task || task.laneId !== laneId) continue;
    if (task.status === 'running') running += 1;
  }
  const active = lane?.activeTaskId ? 1 : 0;
  const queued = lane?.queue.length ?? 0;
  const occupancy = Math.max(active + queued, running);
  return {
    laneId,
    capacity: lane?.capacity ?? 1,
    active,
    queued,
    running,
    occupancy,
    utilization: lane?.utilization ?? 0,
  };
}

/** Occupancy of every registered lane, in registration order. Pure. */
export function measureLaneOccupancies(state: LaneViewState): LaneOccupancy[] {
  return state.lanes.order
    .filter((laneId) => state.lanes.lanes[laneId] !== undefined)
    .map((laneId) => measureLaneOccupancy(state, laneId));
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export interface LaneAgentsViewOptions extends LaneGraphLayoutOptions {
  /** Comet pool size. Defaults to 48. */
  maxComets?: number;
  /** Plan-node pool size. Defaults to 32. */
  maxNodes?: number;
  /** Conduit pool size. Defaults to 48. */
  maxConduits?: number;
  /** Gate pool size. Defaults to 12. */
  maxGates?: number;
  /** Simulated milliseconds per full conduit pass. */
  travelMs?: number;
}

/** One travelling agent, pooled: identity is stable across updates. */
export interface CometSample {
  readonly index: number;
  readonly laneId: string;
  readonly taskId: string;
  readonly conduitId: string;
  /** False for pooled slots that are not carrying an agent. */
  readonly active: boolean;
  /** Head position along the conduit, in [0, 1]. */
  readonly u: number;
  /** Trail length in world units, driven by lane occupancy. */
  readonly trailLength: number;
  readonly intensity: number;
  /** Live world position of the comet head. */
  readonly position: Vector3;
}

/** One verification gate ring, pooled. */
export interface GateRingSample {
  readonly gateId: string;
  readonly name: string;
  readonly laneId: string;
  readonly targetNodeId: string;
  readonly state: GateRingState;
  readonly pattern: GateRingPattern;
  readonly segments: number;
  readonly repair: boolean;
  readonly color: number;
  /** 0..1 alarm/pass pulse read from simulated time. */
  readonly pulse: number;
  readonly coverage: number;
  readonly attempts: number;
  readonly active: boolean;
  readonly position: Vector3;
}

/** Per-lane pooled summary: occupancy in, comet count and trail out. */
export interface LaneCometSummary {
  readonly laneId: string;
  readonly occupancy: number;
  readonly utilization: number;
  readonly comets: number;
  readonly trailLength: number;
}

export interface LaneAgentsView {
  readonly root: Group;
  readonly layout: LaneGraphLayout;
  /** Pooled comet samples; filter on `active`. */
  readonly comets: readonly CometSample[];
  /** Pooled gate rings in gate order. */
  readonly gates: readonly GateRingSample[];
  /** Number of comets currently travelling. */
  readonly cometCount: number;
  readonly gateCount: number;
  readonly cometCapacity: number;
  readonly gateCapacity: number;
  readonly disposed: boolean;
  /** Resource counts reported by `dispose()`, or null while alive. */
  readonly disposedResources: DisposedResources | null;
  /** Occupancy, comet count and trail length per lane, in lane order. */
  laneSummaries(): readonly LaneCometSummary[];
  laneSummary(laneId: string): LaneCometSummary | undefined;
  cometCountForLane(laneId: string): number;
  trailLengthForLane(laneId: string): number;
  gateRing(gateId: string): GateRingSample | undefined;
  /** Live visible ring segments of a gate — geometry, not just colour. */
  gateSegments(gateId: string): number;
  /** Refresh transforms and colours from a state snapshot. */
  update(state: DeepReadonly<GameState>): void;
  dispose(): void;
}

interface NodeSlot {
  readonly group: Group;
  readonly pad: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly pylon: Mesh<BufferGeometry, MeshBasicMaterial>;
  nodeId: string;
  status: TaskStatus | null;
}

interface ConduitSlot {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial> | null;
  owned: BufferGeometry | null;
  conduitId: string;
  laneId: string;
}

interface MutableCometSample {
  index: number;
  laneId: string;
  taskId: string;
  conduitId: string;
  active: boolean;
  u: number;
  trailLength: number;
  intensity: number;
  position: Vector3;
}

interface MutableGateSample {
  gateId: string;
  name: string;
  laneId: string;
  targetNodeId: string;
  state: GateRingState;
  pattern: GateRingPattern;
  segments: number;
  repair: boolean;
  color: number;
  pulse: number;
  coverage: number;
  attempts: number;
  active: boolean;
  position: Vector3;
}

interface CometSlot {
  readonly head: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly trail: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly positions: Float32Array;
  readonly colours: Float32Array;
  readonly sample: MutableCometSample;
  path: ConduitPath | null;
  trailFraction: number;
  /** Lane/index the slot last drew, so names are rewritten only on change. */
  nameLaneId: string;
  nameIndex: number;
}

interface GateSlot {
  readonly group: Group;
  readonly solid: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly core: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly arcs: readonly Mesh<BufferGeometry, MeshBasicMaterial>[];
  readonly dashes: readonly Mesh<BufferGeometry, MeshBasicMaterial>[];
  readonly sample: MutableGateSample;
  gateId: string;
  radiusScale: number;
  segments: readonly Mesh<BufferGeometry, MeshBasicMaterial>[];
}

interface MutableLaneSummary {
  laneId: string;
  occupancy: number;
  utilization: number;
  comets: number;
  trailLength: number;
}

const LANE_KINDS: readonly LaneKind[] = ['discovery', 'build', 'verify', 'integrate', 'observe'];

/** Per-lane-kind comet colour (hologram palette). */
const LANE_COLORS: Record<LaneKind, number> = {
  discovery: 0x7ff8ff,
  build: 0x35f0ff,
  verify: 0x59ff9b,
  integrate: 0xff4fd8,
  observe: 0xffb347,
};

const NODE_STATUS_COLORS: Record<TaskStatus, number> = {
  pending: 0x1d4a5e,
  running: 0x35f0ff,
  passed: 0x59ff9b,
  failed: 0xff2d6f,
  blocked: 0xffb347,
};

/**
 * Create the lane-agent view: nodes, lit conduits, pooled comets and pooled
 * verification gate rings under a single root object.
 */
export function createLaneAgentsView(
  target: Object3D,
  options: LaneAgentsViewOptions = {},
): LaneAgentsView {
  const config: Required<LaneAgentsViewOptions> = {
    ...LANE_LAYOUT_DEFAULTS,
    maxComets: options.maxComets ?? 48,
    maxNodes: options.maxNodes ?? 32,
    maxConduits: options.maxConduits ?? 48,
    maxGates: options.maxGates ?? 12,
    travelMs: options.travelMs ?? COMET_TRAVEL_MS,
    columnGap: options.columnGap ?? LANE_LAYOUT_DEFAULTS.columnGap,
    rowGap: options.rowGap ?? LANE_LAYOUT_DEFAULTS.rowGap,
    floorY: options.floorY ?? LANE_LAYOUT_DEFAULTS.floorY,
    entryGap: options.entryGap ?? LANE_LAYOUT_DEFAULTS.entryGap,
    arc: options.arc ?? LANE_LAYOUT_DEFAULTS.arc,
    bow: options.bow ?? LANE_LAYOUT_DEFAULTS.bow,
    samples: options.samples ?? LANE_LAYOUT_DEFAULTS.samples,
  };

  const root = new Group();
  root.name = LANE_AGENT_NAMES.root;
  target.add(root);

  /** Shared read-only fallback position (never mutated). */
  const ORIGIN = new Vector3();

  const nodeLayer = new Group();
  nodeLayer.name = LANE_AGENT_NAMES.nodes;
  const conduitLayer = new Group();
  conduitLayer.name = LANE_AGENT_NAMES.conduits;
  const cometLayer = new Group();
  cometLayer.name = LANE_AGENT_NAMES.comets;
  const gateLayer = new Group();
  gateLayer.name = LANE_AGENT_NAMES.gates;
  root.add(nodeLayer, conduitLayer, cometLayer, gateLayer);

  /* ------------------------------------------------------------- materials */

  const nodeMaterials = new Map<TaskStatus, MeshBasicMaterial>();
  for (const status of Object.keys(NODE_STATUS_COLORS) as TaskStatus[]) {
    const colour = NODE_STATUS_COLORS[status];
    const settled = status !== 'pending';
    nodeMaterials.set(
      status,
      new MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: settled ? 0.6 : 0.32,
        // Settled nodes glow additively; unstarted nodes stay matte.
        blending: settled ? AdditiveBlending : NormalBlending,
        depthWrite: false,
      }),
    );
  }
  const nodeMaterial = (status: TaskStatus): MeshBasicMaterial =>
    nodeMaterials.get(status) ?? nodeMaterials.get('pending')!;

  const railMaterials = new Map<LaneKind, MeshBasicMaterial>();
  for (const kind of LANE_KINDS) {
    railMaterials.set(
      kind,
      new MeshBasicMaterial({
        color: LANE_COLORS[kind],
        transparent: true,
        opacity: 0.16,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
  }
  const railMaterial = (kind: LaneKind): MeshBasicMaterial =>
    railMaterials.get(kind) ?? railMaterials.get('build')!;

  const headMaterials = new Map<LaneKind, MeshBasicMaterial>();
  const trailMaterials = new Map<LaneKind, MeshBasicMaterial>();
  for (const kind of LANE_KINDS) {
    headMaterials.set(
      kind,
      new MeshBasicMaterial({
        color: LANE_COLORS[kind],
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    trailMaterials.set(
      kind,
      new MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
  }
  const headMaterial = (kind: LaneKind): MeshBasicMaterial =>
    headMaterials.get(kind) ?? headMaterials.get('build')!;
  const trailMaterial = (kind: LaneKind): MeshBasicMaterial =>
    trailMaterials.get(kind) ?? trailMaterials.get('build')!;

  const gateMaterials = {
    pending: new MeshBasicMaterial({
      color: GATE_RING_COLORS.pending,
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
      depthWrite: false,
    }),
    passed: new MeshBasicMaterial({
      color: GATE_RING_COLORS.passed,
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    }),
    passedCore: new MeshBasicMaterial({
      color: 0x9dffcf,
      transparent: true,
      opacity: 0.18,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    }),
    alarm: new MeshBasicMaterial({
      color: GATE_RING_COLORS.failed,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    }),
    repair: new MeshBasicMaterial({
      color: 0xffd0e6,
      transparent: true,
      opacity: 0.75,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    }),
  } as const;

  /* ------------------------------------------------------------- geometry */

  const placeholderGeometry = new BufferGeometry();
  const padGeometry = new CylinderGeometry(1.05, 1.25, 0.16, 24);
  const pylonGeometry = new CylinderGeometry(0.1, 0.18, 2.1, 10, 1, true);
  const headGeometry = new IcosahedronGeometry(0.28, 0);
  const ringGeometry = new RingGeometry(1.32, 1.56, 96);
  const coreGeometry = new CircleGeometry(1.24, 48);
  const arcGeometries = [
    new RingGeometry(1.32, 1.56, 48, 1, 0, 2.15),
    new RingGeometry(1.32, 1.56, 48, 1, 0, 1.05),
    new RingGeometry(1.32, 1.56, 16, 1, 0, 0.5),
  ] as const;
  const dashGeometry = new RingGeometry(1.32, 1.56, 8, 1, 0, 0.26);
  const ARC_ROTATIONS = [0, 2.65, 4.2] as const;
  const DASH_ROTATIONS = [0.4, 1.97, 3.54, 5.11] as const;

  /* -------------------------------------------------------------- records */

  const nodeSlots: NodeSlot[] = [];
  for (let i = 0; i < config.maxNodes; i += 1) {
    const group = new Group();
    group.visible = false;
    const pad = new Mesh(padGeometry, nodeMaterial('pending'));
    pad.position.y = 0.08;
    const pylon = new Mesh(pylonGeometry, nodeMaterial('pending'));
    pylon.position.y = 1.13;
    group.add(pad, pylon);
    nodeLayer.add(group);
    nodeSlots.push({ group, pad, pylon, nodeId: '', status: null });
  }

  const conduitSlots: ConduitSlot[] = [];
  for (let i = 0; i < config.maxConduits; i += 1) {
    const mesh = new Mesh(placeholderGeometry, railMaterial('build'));
    mesh.visible = false;
    conduitLayer.add(mesh);
    conduitSlots.push({ mesh, owned: null, conduitId: '', laneId: '' });
  }

  const cometSlots: CometSlot[] = [];
  const cometSamples: CometSample[] = [];
  for (let i = 0; i < config.maxComets; i += 1) {
    const positions = new Float32Array(TRAIL_SAMPLES * 2 * 3);
    const colours = new Float32Array(TRAIL_SAMPLES * 2 * 4);
    const trailGeometry = createRibbonGeometry(positions, colours);
    const head = new Mesh(headGeometry, headMaterial('build'));
    head.visible = false;
    head.frustumCulled = false;
    const trail = new Mesh(trailGeometry, trailMaterial('build'));
    trail.visible = false;
    trail.frustumCulled = false;
    cometLayer.add(head, trail);
    const sample: MutableCometSample = {
      index: i,
      laneId: '',
      taskId: '',
      conduitId: '',
      active: false,
      u: 0,
      trailLength: 0,
      intensity: 0,
      position: new Vector3(),
    };
    cometSamples.push(sample);
    cometSlots.push({
      head,
      trail,
      positions,
      colours,
      sample,
      path: null,
      trailFraction: 0,
      nameLaneId: '',
      nameIndex: -1,
    });
  }

  const gateSlots: GateSlot[] = [];
  const gateSamples: GateRingSample[] = [];
  for (let i = 0; i < config.maxGates; i += 1) {
    const group = new Group();
    group.visible = false;
    group.rotation.x = -Math.PI / 2;
    const solid = new Mesh(ringGeometry, gateMaterials.passed);
    const core = new Mesh(coreGeometry, gateMaterials.passedCore);
    const arcs = [
      new Mesh(arcGeometries[0], gateMaterials.alarm),
      new Mesh(arcGeometries[1], gateMaterials.alarm),
      new Mesh(arcGeometries[2], gateMaterials.repair),
    ];
    const dashes = DASH_ROTATIONS.map((rotation) => {
      const dash = new Mesh(dashGeometry, gateMaterials.pending);
      dash.rotation.z = rotation;
      return dash;
    });
    const segments = [solid, core, ...arcs, ...dashes];
    arcs.forEach((arc, index) => {
      arc.rotation.z = ARC_ROTATIONS[index] ?? 0;
    });
    group.add(...segments);
    gateLayer.add(group);
    const sample: MutableGateSample = {
      gateId: '',
      name: '',
      laneId: '',
      targetNodeId: '',
      state: 'pending',
      pattern: 'sparse-dashes',
      segments: 0,
      repair: false,
      color: GATE_RING_COLORS.pending,
      pulse: 0,
      coverage: 0,
      attempts: 0,
      active: false,
      position: new Vector3(),
    };
    gateSamples.push(sample);
    gateSlots.push({
      group,
      solid,
      core,
      arcs,
      dashes,
      sample,
      gateId: '',
      radiusScale: 1,
      segments,
    });
  }

  /* ------------------------------------------------------------- scratch */

  const scratch: RibbonScratch = {
    point: new Vector3(),
    up: new Vector3(0, 1, 0),
    tangent: new Vector3(),
    side: new Vector3(),
  };
  const laneEnergy = new Float32Array(LANE_KINDS.length);
  let runningPerLane = new Uint16Array(1);
  let laneSummaries: MutableLaneSummary[] = [];

  let layout: LaneGraphLayout = createLaneGraphLayout(emptyState());
  let signature = '';
  let lastRevision = -1;
  let cometCount = 0;
  let gateCount = 0;
  let disposed = false;
  let disposedResources: DisposedResources | null = null;

  const laneIds: string[] = [];

  /** Bind the pooled records to a fresh layout. Allocates, but only on a structural change. */
  const bindLayout = (next: LaneGraphLayout, state: LaneViewState): void => {
    layout = next;
    signature = next.signature;

    // Nodes.
    for (let i = 0; i < nodeSlots.length; i += 1) {
      const slot = nodeSlots[i];
      if (!slot) continue;
      const node = next.nodes[i];
      if (!node) {
        slot.group.visible = false;
        slot.nodeId = '';
        slot.status = null;
        continue;
      }
      slot.nodeId = node.id;
      slot.status = null;
      slot.group.name = LANE_AGENT_NAMES.node(node.id);
      slot.group.position.copy(node.position);
      slot.group.visible = true;
    }

    // Conduits: one static lit ribbon per path, rebuilt with the layout.
    for (let i = 0; i < conduitSlots.length; i += 1) {
      const slot = conduitSlots[i];
      if (!slot?.mesh) continue;
      const conduit = next.conduits[i];
      if (!conduit) {
        slot.mesh.visible = false;
        slot.conduitId = '';
        slot.laneId = '';
        continue;
      }
      slot.owned?.dispose();
      slot.owned = createRailGeometry(conduit.path);
      slot.mesh.geometry = slot.owned;
      slot.mesh.visible = true;
      slot.mesh.name = LANE_AGENT_NAMES.conduit(conduit.id);
      slot.conduitId = conduit.id;
      slot.laneId = conduit.laneId;
      const lane = state.lanes.lanes[conduit.laneId];
      slot.mesh.material = railMaterial(lane?.kind ?? 'build');
    }

    // Gates: bind slots to gate ids, ring size staggered per shared node.
    const perNode = new Map<string, number>();
    for (let i = 0; i < gateSlots.length; i += 1) {
      const slot = gateSlots[i];
      if (!slot) continue;
      const gate = state.verification.order[i];
      const gateState = gate ? state.verification.gates[gate] : undefined;
      if (!gate || !gateState) {
        slot.group.visible = false;
        slot.gateId = '';
        slot.sample.active = false;
        continue;
      }
      const target = gateTargetNode(next, gateState.laneId);
      const anchor = next.anchors.find((candidate) => candidate.laneId === gateState.laneId);
      const nodeId = target?.id ?? `lane:${gateState.laneId}`;
      const seen = perNode.get(nodeId) ?? 0;
      perNode.set(nodeId, seen + 1);
      const base = target?.position ?? anchor?.entry ?? ORIGIN;
      slot.gateId = gateState.id;
      slot.radiusScale = 1 + seen * 0.3;
      slot.group.name = LANE_AGENT_NAMES.gate(gateState.id);
      slot.group.position.set(base.x, base.y + 1.12 + seen * 0.03, base.z);
      slot.group.visible = true;
      slot.sample.gateId = gateState.id;
      slot.sample.name = gateState.name;
      slot.sample.laneId = gateState.laneId;
      slot.sample.targetNodeId = nodeId;
      slot.sample.active = true;
      slot.sample.position.copy(slot.group.position);
    }

    // Lane summary slots follow lane registration order; existing records are
    // reused so `laneSummaries()` keeps stable identities.
    laneIds.length = 0;
    for (const laneId of state.lanes.order) {
      if (state.lanes.lanes[laneId]) laneIds.push(laneId);
    }
    const nextSummaries: MutableLaneSummary[] = [];
    for (let index = 0; index < laneIds.length; index += 1) {
      const laneId = laneIds[index] ?? '';
      const existing = laneSummaries[index];
      if (existing) {
        existing.laneId = laneId;
        nextSummaries.push(existing);
      } else {
        nextSummaries.push({ laneId, occupancy: 0, utilization: 0, comets: 0, trailLength: 0 });
      }
    }
    laneSummaries = nextSummaries;
    runningPerLane = new Uint16Array(Math.max(1, laneIds.length));
  };

  /** Pick the conduit an agent travelling to `taskId` should ride. */
  const conduitForTask = (laneId: string, taskId: string): ConduitPath | null => {
    if (taskId) {
      const inbound = layout.conduitsByTarget.get(taskId);
      const primary = inbound?.[0];
      if (primary) return primary.path;
    }
    const owned = layout.conduitsByLane.get(laneId);
    return owned?.[0]?.path ?? null;
  };

  /* --------------------------------------------------------------- update */

  const updateConduits = (state: DeepReadonly<GameState>): void => {
    laneEnergy.fill(0);
    for (let i = 0; i < laneIds.length; i += 1) {
      const laneId = laneIds[i];
      if (laneId === undefined) continue;
      const lane = state.lanes.lanes[laneId];
      if (!lane) continue;
      const kindIndex = LANE_KINDS.indexOf(lane.kind);
      if (kindIndex < 0) continue;
      laneEnergy[kindIndex] = Math.max(laneEnergy[kindIndex] ?? 0, lane.utilization);
    }
    for (const kind of LANE_KINDS) {
      const index = LANE_KINDS.indexOf(kind);
      const material = railMaterials.get(kind);
      if (!material) continue;
      // Lit conduits: a busy lane glows, an idle one stays nearly dark.
      material.opacity = 0.22 + 0.6 * clamp01(laneEnergy[index] ?? 0);
    }
  };

  const updateNodes = (state: DeepReadonly<GameState>, elapsedMs: number): void => {
    const pulse = 0.5 + 0.5 * Math.sin((elapsedMs / 900) * Math.PI * 2);
    for (let i = 0; i < nodeSlots.length; i += 1) {
      const slot = nodeSlots[i];
      if (!slot || slot.nodeId === '') continue;
      const task = state.plan.tasks[slot.nodeId];
      const status: TaskStatus = task?.status ?? 'pending';
      if (status !== slot.status) {
        slot.status = status;
        const material = nodeMaterial(status);
        slot.pad.material = material;
        slot.pylon.material = material;
      }
      const material = nodeMaterial(status);
      if (status === 'running') {
        material.opacity = 0.42 + 0.3 * pulse;
        slot.pylon.scale.y = 1 + 0.12 * pulse;
      } else if (status === 'pending') {
        material.opacity = 0.3;
        slot.pylon.scale.y = 1;
      } else {
        material.opacity = 0.62;
        slot.pylon.scale.y = 1;
      }
    }
  };

  const updateComets = (state: DeepReadonly<GameState>, elapsedMs: number): void => {
    runningPerLane.fill(0);
    for (const taskId of state.plan.order) {
      const task = state.plan.tasks[taskId];
      if (!task || task.status !== 'running') continue;
      for (let i = 0; i < laneIds.length; i += 1) {
        if (laneIds[i] === task.laneId) {
          runningPerLane[i] = (runningPerLane[i] ?? 0) + 1;
          break;
        }
      }
    }

    let cursor = 0;
    let active = 0;
    for (let laneIndex = 0; laneIndex < laneIds.length; laneIndex += 1) {
      const laneId = laneIds[laneIndex];
      const summary = laneSummaries[laneIndex];
      if (laneId === undefined || !summary) continue;
      const lane = state.lanes.lanes[laneId];
      const running = runningPerLane[laneIndex] ?? 0;
      if (!lane) {
        summary.occupancy = running;
        summary.utilization = 0;
        summary.comets = 0;
        summary.trailLength = 0;
        continue;
      }
      const occupancy = Math.max((lane.activeTaskId ? 1 : 0) + lane.queue.length, running);
      const trailLength = cometTrailLength(occupancy);
      const affordance = Math.max(0, config.maxComets - cursor);
      const count = Math.min(occupancy, affordance);
      summary.occupancy = occupancy;
      summary.utilization = lane.utilization;
      summary.comets = count;
      summary.trailLength = count > 0 ? trailLength : 0;

      for (let i = 0; i < count; i += 1) {
        const slot = cometSlots[cursor];
        cursor += 1;
        if (!slot) continue;
        const taskId = i === 0 ? lane.activeTaskId ?? '' : lane.queue[i - 1] ?? lane.activeTaskId ?? '';
        const task = taskId ? state.plan.tasks[taskId] : undefined;
        const progress = task?.progress ?? 0;
        const path = conduitForTask(laneId, taskId);
        const u = cometPhase(elapsedMs, i, count, progress, config.travelMs);
        const intensity = 0.5 + 0.5 * clamp01(lane.utilization) * (0.6 + 0.4 * progress);
        const sample = slot.sample;
        sample.laneId = laneId;
        sample.taskId = taskId;
        sample.active = true;
        sample.u = u;
        sample.trailLength = trailLength;
        sample.intensity = intensity;
        if (!path) {
          slot.head.visible = false;
          slot.trail.visible = false;
          sample.conduitId = '';
          sample.active = false;
          continue;
        }
        slot.path = path;
        slot.trailFraction = clamp01(trailLength / Math.max(0.001, path.length));
        sample.conduitId = path.id;

        if (slot.nameLaneId !== laneId || slot.nameIndex !== i) {
          slot.nameLaneId = laneId;
          slot.nameIndex = i;
          slot.head.name = LANE_AGENT_NAMES.comet(laneId, i);
          slot.trail.name = LANE_AGENT_NAMES.cometTrail(laneId, i);
        }

        const kind = lane.kind;
        slot.head.material = headMaterial(kind);
        slot.trail.material = trailMaterial(kind);
        slot.head.visible = true;
        slot.trail.visible = true;

        sampleConduitPath(path, u, scratch.point);
        sampleConduitTangent(path, u, scratch.tangent);
        slot.head.position.copy(scratch.point);
        slot.head.position.y += 0.12;
        // Reuse the scratch up-vector: quaternion maths stays allocation-free.
        slot.head.quaternion.setFromUnitVectors(scratch.up, scratch.tangent);
        slot.head.scale.setScalar(1 + 0.6 * intensity);
        sample.position.copy(slot.head.position);

        writeCometTrail(slot, path, u, lane.kind, intensity, scratch);
        active += 1;
      }
    }

    for (let i = cursor; i < cometSlots.length; i += 1) {
      const slot = cometSlots[i];
      if (!slot) continue;
      slot.head.visible = false;
      slot.trail.visible = false;
      slot.sample.active = false;
      slot.sample.laneId = '';
      slot.sample.conduitId = '';
      slot.sample.taskId = '';
    }
    cometCount = active;
  };

  const updateGates = (state: DeepReadonly<GameState>, elapsedMs: number): void => {
    let active = 0;
    for (let i = 0; i < gateSlots.length; i += 1) {
      const slot = gateSlots[i];
      if (!slot || slot.gateId === '') continue;
      const gate = state.verification.gates[slot.gateId];
      if (!gate) continue;
      const descriptor = classifyGateRing(gate.status);
      const sample = slot.sample;
      const period = descriptor.pulsePeriodMs;
      // Alarm states use a sharp attack; settled states use a soft swell.
      const cycle = period > 0 ? (elapsedMs % period) / period : 0;
      const pulse =
        descriptor.state === 'failed'
          ? 1 - cycle
          : 0.5 + 0.5 * Math.sin(cycle * Math.PI * 2);
      sample.state = descriptor.state;
      sample.pattern = descriptor.pattern;
      sample.segments = descriptor.segments;
      sample.repair = descriptor.repair;
      sample.color = descriptor.color;
      sample.pulse = pulse;
      sample.coverage = gate.coverage;
      sample.attempts = gate.attempts;
      sample.active = true;

      // Segment pattern: which meshes are lit *is* the state, not just colour.
      const showSolid = descriptor.state === 'passed';
      slot.solid.visible = showSolid;
      slot.core.visible = descriptor.core;
      for (let a = 0; a < slot.arcs.length; a += 1) {
        const arc = slot.arcs[a];
        if (arc) arc.visible = descriptor.state === 'failed';
      }
      for (let d = 0; d < slot.dashes.length; d += 1) {
        const dash = slot.dashes[d];
        if (dash) dash.visible = descriptor.state === 'pending';
      }

      const swell = 1 + 0.06 * pulse * (showSolid ? 1 : 1.6);
      slot.group.scale.setScalar(slot.radiusScale * swell);
      slot.group.rotation.z =
        descriptor.state === 'failed'
          ? -((elapsedMs % 4_000) / 4_000) * Math.PI * 2
          : ((elapsedMs % 24_000) / 24_000) * Math.PI * 2;
      gateMaterials.passed.opacity = 0.55 + 0.4 * pulse;
      gateMaterials.passedCore.opacity = 0.12 + 0.16 * pulse;
      gateMaterials.alarm.opacity = 0.45 + 0.55 * pulse;
      gateMaterials.repair.opacity = 0.35 + 0.6 * (1 - pulse);
      gateMaterials.pending.opacity = 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(cycle * Math.PI * 2));
      active += 1;
    }
    gateCount = active;
  };

  const update = (state: DeepReadonly<GameState>): void => {
    if (disposed) return;
    if (state.revision !== lastRevision) {
      lastRevision = state.revision;
      const nextSignature = layoutSignature(state);
      if (nextSignature !== signature) bindLayout(createLaneGraphLayout(state, config), state);
    }
    const elapsedMs = state.mission.elapsedMs;
    updateConduits(state);
    updateNodes(state, elapsedMs);
    updateComets(state, elapsedMs);
    updateGates(state, elapsedMs);
  };

  // Bind the initial (usually empty) layout so the layers exist before the first
  // state arrives.
  bindLayout(layout, emptyState());

  return {
    root,
    get layout() {
      return layout;
    },
    comets: cometSamples,
    gates: gateSamples,
    get cometCount() {
      return cometCount;
    },
    get gateCount() {
      return gateCount;
    },
    cometCapacity: config.maxComets,
    gateCapacity: config.maxGates,
    get disposed() {
      return disposed;
    },
    get disposedResources() {
      return disposedResources;
    },
    laneSummaries(): readonly LaneCometSummary[] {
      return laneSummaries;
    },
    laneSummary(laneId: string): LaneCometSummary | undefined {
      return laneSummaries.find((summary) => summary.laneId === laneId);
    },
    cometCountForLane(laneId: string): number {
      return laneSummaries.find((summary) => summary.laneId === laneId)?.comets ?? 0;
    },
    trailLengthForLane(laneId: string): number {
      return laneSummaries.find((summary) => summary.laneId === laneId)?.trailLength ?? 0;
    },
    gateRing(gateId: string): GateRingSample | undefined {
      return gateSamples.find((sample) => sample.active && sample.gateId === gateId);
    },
    gateSegments(gateId: string): number {
      const slot = gateSlots.find((candidate) => candidate.gateId === gateId);
      if (!slot) return 0;
      let visible = 0;
      for (const segment of slot.segments) {
        if (segment.visible) visible += 1;
      }
      return visible;
    },
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const slot of conduitSlots) {
        slot.owned?.dispose();
        slot.owned = null;
        if (slot.mesh) slot.mesh.geometry = placeholderGeometry;
      }
      const report = disposeRenderResources(root);
      placeholderGeometry.dispose();
      disposedResources = {
        geometries: report.geometries + 1,
        materials: report.materials,
        textures: report.textures,
      };
      root.removeFromParent();
      root.clear();
      cometCount = 0;
      gateCount = 0;
      for (const slot of cometSlots) slot.sample.active = false;
      for (const slot of gateSlots) slot.sample.active = false;
      laneSummaries = [];
    },
  };
}

/** An empty state shell, used to bind an idle layout before the first frame. */
function emptyState(): GameState {
  return {
    seed: 0,
    revision: 0,
    mission: {
      id: '',
      codename: '',
      objective: '',
      status: 'bootstrapping',
      elapsedMs: 0,
      progress: 0,
    },
    plan: { id: '', order: [], tasks: {} },
    lanes: { order: [], lanes: {} },
    verification: { order: [], gates: {}, passRate: 0 },
    quality: { order: [], metrics: {}, findings: [], score: 0 },
    economy: {
      credits: 0,
      creditRatePerTask: 0,
      creditsPerSecond: 0,
      contextBudget: 0,
      contextSpent: 0,
      reputation: 0,
      deadlineMs: 0,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Ribbon geometry                                                            */
/* -------------------------------------------------------------------------- */

/** Two vertices per sample, triangle strip indices. Allocation happens once. */
function createRibbonGeometry(positions: Float32Array, colours: Float32Array): BufferGeometry {
  const samples = positions.length / 6;
  const indices = new Uint16Array((samples - 1) * 6);
  for (let s = 0; s < samples - 1; s += 1) {
    const a = s * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices[s * 6] = a;
    indices[s * 6 + 1] = b;
    indices[s * 6 + 2] = d;
    indices[s * 6 + 3] = a;
    indices[s * 6 + 4] = d;
    indices[s * 6 + 5] = c;
  }
  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  positionAttribute.setUsage(DynamicDrawUsage);
  const colourAttribute = new BufferAttribute(colours, 4);
  colourAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', colourAttribute);
  geometry.setIndex(new BufferAttribute(indices, 1));
  // Comet trails are rewritten every frame and never frustum-culled.
  geometry.boundingSphere = null;
  return geometry;
}

interface RibbonScratch {
  point: Vector3;
  /** Up axis, reused as the `from` vector when orienting a comet head. */
  up: Vector3;
  tangent: Vector3;
  side: Vector3;
}

/** Write a comet's tapered trail into its pooled vertex buffers. No allocation. */
function writeCometTrail(
  slot: CometSlot,
  path: ConduitPath,
  uHead: number,
  kind: LaneKind,
  intensity: number,
  scratch: RibbonScratch,
): void {
  const colourHex = LANE_COLORS[kind];
  const r = ((colourHex >> 16) & 0xff) / 255;
  const g = ((colourHex >> 8) & 0xff) / 255;
  const b = (colourHex & 0xff) / 255;
  const positions = slot.positions;
  const colours = slot.colours;
  const step = slot.trailFraction / (TRAIL_SAMPLES - 1);

  for (let k = 0; k < TRAIL_SAMPLES; k += 1) {
    const u = clamp01(uHead - step * k);
    sampleConduitPath(path, u, scratch.point);
    sampleConduitTangent(path, u, scratch.tangent);
    scratch.side.set(scratch.tangent.z, 0, -scratch.tangent.x);
    if (scratch.side.lengthSq() < 1e-6) scratch.side.set(1, 0, 0);
    else scratch.side.normalize();

    const falloff = 1 - k / (TRAIL_SAMPLES - 1);
    const halfWidth = 0.08 + 0.22 * falloff * falloff;
    const alpha = intensity * falloff * falloff;

    const a = k * 6;
    positions[a] = scratch.point.x + scratch.side.x * halfWidth;
    positions[a + 1] = scratch.point.y + 0.12 + scratch.side.y * halfWidth;
    positions[a + 2] = scratch.point.z + scratch.side.z * halfWidth;
    positions[a + 3] = scratch.point.x - scratch.side.x * halfWidth;
    positions[a + 4] = scratch.point.y + 0.12 - scratch.side.y * halfWidth;
    positions[a + 5] = scratch.point.z - scratch.side.z * halfWidth;

    const c = k * 8;
    const d = c + 4;
    colours[c] = r;
    colours[c + 1] = g;
    colours[c + 2] = b;
    colours[c + 3] = alpha;
    colours[d] = r;
    colours[d + 1] = g;
    colours[d + 2] = b;
    colours[d + 3] = alpha;
  }

  const positionAttribute = slot.trail.geometry.getAttribute('position');
  const colourAttribute = slot.trail.geometry.getAttribute('color');
  if (positionAttribute) positionAttribute.needsUpdate = true;
  if (colourAttribute) colourAttribute.needsUpdate = true;
}

/** Static lit ribbon along a conduit: the rail comets ride. */
function createRailGeometry(path: ConduitPath): BufferGeometry {
  const samples = path.samples;
  const positions = new Float32Array(samples * 2 * 3);
  const colours = new Float32Array(samples * 2 * 4);
  for (let i = 0; i < samples; i += 1) {
    const a = i * 3;
    const px = path.points[a] ?? 0;
    const py = path.points[a + 1] ?? 0;
    const pz = path.points[a + 2] ?? 0;
    const tx = path.tangents[a] ?? 1;
    const tz = path.tangents[a + 2] ?? 0;
    const sideLength = Math.hypot(tz, tx) || 1;
    const sx = tz / sideLength;
    const sz = -tx / sideLength;
    const halfWidth = 0.08;
    const p = i * 6;
    positions[p] = px + sx * halfWidth;
    positions[p + 1] = py + 0.06;
    positions[p + 2] = pz + sz * halfWidth;
    positions[p + 3] = px - sx * halfWidth;
    positions[p + 4] = py + 0.06;
    positions[p + 5] = pz - sz * halfWidth;
    const c = i * 8;
    const d = c + 4;
    for (const offset of [c, d]) {
      colours[offset] = 1;
      colours[offset + 1] = 1;
      colours[offset + 2] = 1;
      colours[offset + 3] = 0.55;
    }
  }
  return createRibbonGeometry(positions, colours);
}

/* -------------------------------------------------------------------------- */
/* System factory                                                             */
/* -------------------------------------------------------------------------- */

export interface LaneAgentsSystemOptions extends LaneAgentsViewOptions {
  /** System id. Defaults to `render/lane-agents`. */
  id?: string;
}

/**
 * Compose the view as a game system: attach builds the scene subtree, update
 * feeds it the frozen snapshot, dispose releases every pooled resource.
 */
export function createLaneAgentsSystem(options: LaneAgentsSystemOptions = {}): GameSystem {
  let view: LaneAgentsView | null = null;
  return {
    id: options.id ?? 'render/lane-agents',
    attach(context): void {
      view = createLaneAgentsView(context.scene, options);
    },
    update(update): void {
      view?.update(update.state);
    },
    dispose(): void {
      view?.dispose();
      view = null;
    },
  };
}
