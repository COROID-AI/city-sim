/**
 * The plan graph — instanced task polyhedra standing on phase tier platforms,
 * joined by the dependency conduits from `./edges`.
 *
 * Design notes:
 *
 *  - **Status is coded three ways.** Every task status owns a colour (the
 *    mandatory palette below), a distinct polyhedron and an on-node glyph
 *    badge, so the plan reads for colour-blind players and in screenshots.
 *  - **Nodes are instanced.** One `InstancedMesh` per status shape (plus a
 *    wireframe overlay and a badge mesh) covers hundreds of tasks: per-instance
 *    colour rides in the `instanceColor` attribute and per-instance position and
 *    scale ride in the `instanceMatrix` attribute. `update()` rewrites those
 *    attributes in place; nothing is allocated per frame.
 *  - **Phase tiers come from the plan itself.** A task's tier is its longest
 *    dependency chain, so the factory floor is literally the plan's shape:
 *    roots rest on the lowest platform and dependent work climbs. Platform
 *    radius follows how many tasks a tier holds, and each platform carries
 *    `tier + 1` rim notches so the tier index is readable without colour.
 *  - **Picking is raycasting against the instanced meshes.** `pick` maps
 *    normalized pointer coordinates to the task key, the world hit point and a
 *    normalized screen anchor for the inspector; `pointerToNdc` adapts mouse or
 *    touch client coordinates, so both input paths share one code path.
 *  - The layout is derived from `plan` and `lanes` only. No simulation module is
 *    imported here beyond the shared state contract.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Raycaster,
  TetrahedronGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';

import { disposeRenderResources, type DisposedResources } from './renderer';
import { createPlanGraphEdges, type ConduitEdge, type PlanGraphEdgesView } from './edges';
import type { GameSystem } from '../game/systems';
import type { DeepReadonly, LaneKind, LaneState, PlanTaskState, TaskStatus } from '../sim/state';

/* -------------------------------------------------------------------------- */
/* Status palette                                                             */
/* -------------------------------------------------------------------------- */

/** The six visual statuses a task node can wear. */
export const PLAN_GRAPH_STATUSES = [
  'queued',
  'running',
  'verifying',
  'passed',
  'failed',
  'superseded',
] as const;

export type PlanNodeStatus = (typeof PLAN_GRAPH_STATUSES)[number];

/** Distinct polyhedra, one per status. */
export type NodeShape =
  | 'tetrahedron'
  | 'octahedron'
  | 'dodecahedron'
  | 'icosahedron'
  | 'hex-prism'
  | 'pyramid';

/** Distinct on-node badge silhouettes, one per status. */
export type NodeGlyph = 'pip' | 'ring' | 'diamond' | 'coin' | 'halt-bar' | 'strike';

/** Everything the renderer needs to draw one status. */
export interface NodeStatusVisual {
  readonly status: PlanNodeStatus;
  /** Body colour — the mandatory palette for this status. */
  readonly color: number;
  /** Badge colour, brighter than the body so the mark reads when the body is dim. */
  readonly glyphColor: number;
  readonly shape: NodeShape;
  readonly glyph: NodeGlyph;
  /** Human label used by legends and the inspector. */
  readonly label: string;
  /** One-line art-direction note: colour, shape and badge in words. */
  readonly meaning: string;
  /** Body size multiplier. */
  readonly scale: number;
  /** Spin period in simulated ms; `0` means the body does not turn. */
  readonly spinPeriodMs: number;
  /** Whether the body breathes while it holds this status. */
  readonly pulse: boolean;
}

/**
 * The mandatory status palette.
 *
 * `queued` cool slate · `running` cyan · `verifying` amber · `passed` spring
 * green · `failed` magenta-red · `superseded` dim violet. Colour is only one of
 * three channels: `shape` names the polyhedron and `glyph` the badge, so no
 * status depends on colour alone.
 */
export const TASK_STATUS_PALETTE: Readonly<Record<PlanNodeStatus, NodeStatusVisual>> = {
  queued: {
    status: 'queued',
    color: 0x5c7f9e,
    glyphColor: 0xa9c9dd,
    shape: 'tetrahedron',
    glyph: 'pip',
    label: 'Queued',
    meaning: 'cool slate tetrahedron with a seed pip — waiting for its upstream work',
    scale: 0.86,
    spinPeriodMs: 0,
    pulse: false,
  },
  running: {
    status: 'running',
    color: 0x35f0ff,
    glyphColor: 0xd9fbff,
    shape: 'octahedron',
    glyph: 'ring',
    label: 'Running',
    meaning: 'cyan octahedron with a spinning ring — an agent lane is building it',
    scale: 1,
    spinPeriodMs: 5_200,
    pulse: true,
  },
  verifying: {
    status: 'verifying',
    color: 0xffc15c,
    glyphColor: 0xffe7b5,
    shape: 'dodecahedron',
    glyph: 'diamond',
    label: 'Verifying',
    meaning: 'amber dodecahedron with a diamond badge — a gate is measuring it',
    scale: 1.06,
    spinPeriodMs: 3_600,
    pulse: true,
  },
  passed: {
    status: 'passed',
    color: 0x59ff9b,
    glyphColor: 0xdcffe9,
    shape: 'icosahedron',
    glyph: 'coin',
    label: 'Passed',
    meaning: 'spring-green icosahedron with a settled coin — shipped and trusted',
    scale: 1.16,
    spinPeriodMs: 9_600,
    pulse: false,
  },
  failed: {
    status: 'failed',
    color: 0xff2d6f,
    glyphColor: 0xffb6ce,
    shape: 'hex-prism',
    glyph: 'halt-bar',
    label: 'Failed',
    meaning: 'magenta-red hex prism with a halt bar — the work came back broken',
    scale: 1.08,
    spinPeriodMs: 0,
    pulse: true,
  },
  superseded: {
    status: 'superseded',
    color: 0x6f5a9c,
    glyphColor: 0xbfaee4,
    shape: 'pyramid',
    glyph: 'strike',
    label: 'Superseded',
    meaning: 'dim violet pyramid with a struck bar — kept as history, no longer planned',
    scale: 0.8,
    spinPeriodMs: 0,
    pulse: false,
  },
};

/* -------------------------------------------------------------------------- */
/* Tunables and public constants                                              */
/* -------------------------------------------------------------------------- */

/** Object-name prefixes, so tests and tooling can address the scene graph. */
export const PLAN_GRAPH_NAMES = {
  root: 'plan-graph',
  platforms: 'plan-graph-platforms',
  bodies: 'plan-graph-bodies',
  glyphs: 'plan-graph-glyphs',
  conduits: 'plan-graph-edges',
  selection: 'plan-graph-selection',
  spine: 'plan-graph-tier-spine',
  halo: 'plan-graph-selection-halo',
  platform: (tier: number): string => `plan-graph-platform-${tier}`,
  notch: (tier: number, index: number): string => `plan-graph-platform-${tier}-notch-${index}`,
  body: (status: PlanNodeStatus): string => `plan-graph-bodies-${status}`,
  wire: (status: PlanNodeStatus): string => `plan-graph-wires-${status}`,
  glyph: (status: PlanNodeStatus): string => `plan-graph-glyphs-${status}`,
} as const;

/** Default layout, materials and pool sizes. */
export const PLAN_GRAPH_DEFAULTS = {
  /** Vertical gap between phase tier platforms. */
  tierHeight: 4.6,
  /** Arc distance between neighbouring nodes on a tier ring. */
  nodeGap: 5.4,
  /** Smallest tier ring radius. */
  minRadius: 2.8,
  /** Extra platform radius beyond its node ring. */
  platformMargin: 2,
  /** Height of a node body above its platform surface. */
  nodeLift: 1.7,
  /** Platform slab thickness. */
  platformThickness: 0.34,
  /** Twist added per tier so conduits spiral instead of stacking. */
  tierTwist: 0.42,
  /** Height of the conduit attach point above a node body centre. */
  anchorLift: 1,
  /** Height of the status badge above a node body centre. */
  glyphLift: 1,
  /** Size of the badge relative to its authored geometry. */
  glyphScale: 0.62,
  /** Size of the rim notches that encode the tier index. */
  notchSize: 0.3,
  /** Instanced node pool capacity. */
  maxNodes: 256,
  /** Conduit pool capacity. */
  maxConduits: 256,
} as const;

/** Platform colours, lerped by how much of the tier has passed. */
export const PLATFORM_COLORS = {
  dim: 0x16293a,
  lit: 0x1c6c8c,
  rimDim: 0x27506a,
  rimLit: 0x59ff9b,
  spine: 0x1f5a70,
  notch: 0x8fd8ef,
} as const;

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/** Build the polyhedron for a shape. Callers own disposal. */
export function createNodeShapeGeometry(shape: NodeShape): BufferGeometry {
  switch (shape) {
    case 'tetrahedron':
      return new TetrahedronGeometry(1.02, 0);
    case 'octahedron':
      return new OctahedronGeometry(0.88, 0);
    case 'dodecahedron':
      return new DodecahedronGeometry(0.8, 0);
    case 'icosahedron':
      return new IcosahedronGeometry(0.82, 0);
    case 'hex-prism':
      return new CylinderGeometry(0.62, 0.62, 1.3, 6);
    case 'pyramid': {
      const pyramid = new ConeGeometry(0.94, 1.26, 4);
      pyramid.rotateY(Math.PI / 4);
      return pyramid;
    }
  }
}

/** Build the badge mesh for a glyph. Callers own disposal. */
export function createNodeGlyphGeometry(glyph: NodeGlyph): BufferGeometry {
  switch (glyph) {
    case 'pip':
      return new BoxGeometry(0.34, 0.34, 0.34);
    case 'ring':
      return new TorusGeometry(0.36, 0.06, 8, 22);
    case 'diamond':
      return new OctahedronGeometry(0.36);
    case 'coin':
      return new CylinderGeometry(0.34, 0.34, 0.1, 18);
    case 'halt-bar':
      return new BoxGeometry(0.74, 0.15, 0.15);
    case 'strike': {
      const bar = new BoxGeometry(0.78, 0.12, 0.12);
      bar.rotateZ(Math.PI / 4);
      return bar;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Status classification                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Map the lifecycle status a task carries in state onto its node status.
 *
 * The plan slice is deliberately small: it distinguishes `pending`, `running`,
 * `passed`, `failed` and `blocked`. The visualization needs six codes, so the
 * two extra ones come from data the plan already carries:
 *
 *  - a `running` task on a **verify** lane is `verifying` (a gate is measuring
 *    it) — everything else running is `running`;
 *  - a `blocked` task is `superseded`: it will not proceed on this plan, so it
 *    is kept as dim history rather than shown as an alarm. Alarms are reserved
 *    for `failed` work, so the floor never cries wolf twice.
 */
export function classifyNodeStatus(taskStatus: TaskStatus, laneKind: LaneKind): PlanNodeStatus {
  switch (taskStatus) {
    case 'pending':
      return 'queued';
    case 'running':
      return laneKind === 'verify' ? 'verifying' : 'running';
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'blocked':
      return 'superseded';
  }
}

/** Body size for a status, nudged by how far the task has actually got. */
export function nodeScale(status: PlanNodeStatus, progress: number): number {
  const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return TASK_STATUS_PALETTE[status].scale * (0.94 + 0.14 * clamped);
}

/**
 * Breathing factor in [0, 1] for a node's brightness and size.
 *
 * Statuses that are actively moving (`running`, `verifying`, `failed`) breathe;
 * settled ones (`queued`, `passed`, `superseded`) hold a constant 1 so a still
 * screenshot still reads.
 */
export function nodeStatusGlow(
  status: PlanNodeStatus,
  elapsedMs: number,
  index: number,
): number {
  const visual = TASK_STATUS_PALETTE[status];
  if (!visual.pulse) return 1;
  const phase = elapsedMs / 2_400 + index * 0.37;
  return 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
}

/** Body rotation in radians for a status; `0` for statuses that do not turn. */
export function nodeSpin(status: PlanNodeStatus, elapsedMs: number, index: number): number {
  const period = TASK_STATUS_PALETTE[status].spinPeriodMs;
  if (period <= 0) return 0;
  return (elapsedMs / period) * Math.PI * 2 + index * 0.7;
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The state the plan graph reads: the `plan` and `lanes` slices, taken from
 * either the live document or a frozen snapshot.
 *
 * The shape is structural on purpose — `GameState` and `DeepReadonly<GameState>`
 * are both accepted — so this module depends on the shared state contract
 * without importing the simulation.
 */
export interface PlanGraphState {
  /** Mission clock; every animation is a function of `elapsedMs`. */
  readonly mission: { readonly elapsedMs: number };
  readonly plan: {
    readonly id: string;
    readonly order: readonly string[];
    readonly tasks: Readonly<Record<string, DeepReadonly<PlanTaskState>>>;
  };
  readonly lanes: {
    readonly order: readonly string[];
    readonly lanes: Readonly<Record<string, DeepReadonly<LaneState>>>;
  };
}

export interface PhaseTierLayoutOptions {
  /** Vertical gap between platform levels. */
  tierHeight?: number;
  /** Arc distance between neighbouring nodes on a tier ring. */
  nodeGap?: number;
  /** Smallest tier ring radius. */
  minRadius?: number;
  /** Extra platform radius beyond its node ring. */
  platformMargin?: number;
  /** Height of a node body above its platform surface. */
  nodeLift?: number;
  /** Twist added per tier, in radians. */
  tierTwist?: number;
  /** Height of the conduit attach point above a node body centre. */
  anchorLift?: number;
}

/** One phase tier: a platform plus the tasks that rest on it. */
export interface PhaseTier {
  /** Dependency depth the tier stands for; `0` is the root tier. */
  readonly tier: number;
  readonly taskIds: readonly string[];
  /** Height of the platform surface. */
  readonly y: number;
  /** Platform radius. */
  readonly radius: number;
  /** Radius of the node ring on top of the platform. */
  readonly ringRadius: number;
  /** Rim notches; `tier + 1`, so the tier index reads without colour. */
  readonly notchCount: number;
  /** Legend label, e.g. `PHASE 2`. */
  readonly label: string;
}

/** One instanced task node in the layout. */
export interface PlanGraphNode {
  readonly id: string;
  readonly title: string;
  readonly laneId: string;
  /** Phase tier: the task's longest dependency chain. */
  readonly tier: number;
  /** Index in `plan.order`. */
  readonly index: number;
  /** Index of this node inside its tier ring. */
  readonly ringIndex: number;
  /** Index inside its phase tier. */
  readonly tierIndex: number;
  /** World position of the node body centre. */
  readonly position: Vector3;
  /** World position conduits attach to (the top of the body). */
  readonly anchor: Vector3;
  /** Raw lifecycle status from `plan`. */
  taskStatus: TaskStatus;
  /** Visual status after `classifyNodeStatus`, before any override. */
  status: PlanNodeStatus;
  /** True once the task passed; what conduit lighting keys off. */
  complete: boolean;
  /** Simulated ms the task settled, or `null`. */
  completedAtMs: number | null;
  /** 0..1 task progress, used to size the body. */
  progress: number;
  /** Body size multiplier for this frame. */
  scale: number;
  /** False when the task vanished from state. */
  active: boolean;
}

export interface PlanGraphBounds {
  readonly minY: number;
  readonly maxY: number;
  /** Largest platform radius. */
  readonly radius: number;
  readonly nodeCount: number;
  readonly tierCount: number;
  readonly conduitCount: number;
}

/** The whole pure layout: nodes, phase tiers, dependency edges and bounds. */
export interface PlanGraphLayout {
  readonly nodes: readonly PlanGraphNode[];
  readonly tiers: readonly PhaseTier[];
  readonly edges: readonly ConduitEdge[];
  readonly bounds: PlanGraphBounds;
  /** Structural fingerprint; the view rebuilds only when this changes. */
  readonly signature: string;
}

/**
 * Longest dependency chain per task, memoised and cycle-safe.
 *
 * This is the "phase tier": roots sit on the lowest platform and every task
 * climbs one level above its deepest dependency.
 */
export function computeTierDepths(state: PlanGraphState): Map<string, number> {
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

/**
 * Deterministic structural fingerprint of everything the layout depends on.
 *
 * Only structure is fingerprinted — statuses and progress change constantly and
 * must not force a rebuild.
 */
export function planSignature(state: PlanGraphState): string {
  const parts: string[] = [state.plan.id, state.plan.order.join(',')];
  for (const taskId of state.plan.order) {
    const task = state.plan.tasks[taskId];
    if (!task) continue;
    parts.push(`${taskId}@${task.laneId}<${task.dependencies.join(',')}`);
  }
  for (const laneId of state.lanes.order) {
    parts.push(`${laneId}:${state.lanes.lanes[laneId]?.kind ?? '?'}`);
  }
  return parts.join('|');
}

/**
 * Build the phase tier layout: one node per plan task, one platform per tier,
 * one edge per dependency.
 *
 * Pure: identical state and options always give byte-identical positions, which
 * is what lets the preview, the picking test and the view agree without sharing
 * mutable state.
 */
export function createPhaseTierLayout(
  state: PlanGraphState,
  options: PhaseTierLayoutOptions = {},
): PlanGraphLayout {
  const tierHeight = options.tierHeight ?? PLAN_GRAPH_DEFAULTS.tierHeight;
  const nodeGap = options.nodeGap ?? PLAN_GRAPH_DEFAULTS.nodeGap;
  const minRadius = options.minRadius ?? PLAN_GRAPH_DEFAULTS.minRadius;
  const platformMargin = options.platformMargin ?? PLAN_GRAPH_DEFAULTS.platformMargin;
  const nodeLift = options.nodeLift ?? PLAN_GRAPH_DEFAULTS.nodeLift;
  const tierTwist = options.tierTwist ?? PLAN_GRAPH_DEFAULTS.tierTwist;
  const anchorLift = options.anchorLift ?? PLAN_GRAPH_DEFAULTS.anchorLift;

  const depths = computeTierDepths(state);
  const ordered: string[] = [];
  for (const taskId of state.plan.order) {
    if (state.plan.tasks[taskId]) ordered.push(taskId);
  }

  let maxTier = 0;
  for (const taskId of ordered) {
    maxTier = Math.max(maxTier, depths.get(taskId) ?? 0);
  }

  const buckets: string[][] = [];
  for (let tier = 0; tier <= maxTier; tier += 1) buckets.push([]);
  for (const taskId of ordered) {
    const bucket = buckets[depths.get(taskId) ?? 0];
    if (bucket) bucket.push(taskId);
  }

  const tiers: PhaseTier[] = [];
  const nodes: PlanGraphNode[] = [];
  let largestRadius = 0;

  for (let tier = 0; tier <= maxTier; tier += 1) {
    const taskIds = buckets[tier] ?? [];
    const ringRadius = Math.max(minRadius, (taskIds.length * nodeGap) / (2 * Math.PI));
    const radius = ringRadius + platformMargin;
    const y = tier * tierHeight;
    largestRadius = Math.max(largestRadius, radius);
    tiers.push({
      tier,
      taskIds: [...taskIds],
      y,
      radius,
      ringRadius,
      notchCount: tier + 1,
      label: `PHASE ${tier + 1}`,
    });

    // Node order inside a tier follows plan order, so replays never reshuffle.
    taskIds.forEach((taskId, tierIndex) => {
      const task = state.plan.tasks[taskId];
      if (!task) return;
      const angle =
        -Math.PI / 2 + ((tierIndex + 0.5) * Math.PI * 2) / taskIds.length + tier * tierTwist;
      const position = new Vector3(
        Math.cos(angle) * ringRadius,
        y + nodeLift,
        Math.sin(angle) * ringRadius,
      );
      const lane = state.lanes.lanes[task.laneId];
      nodes.push({
        id: task.id,
        title: task.title,
        laneId: task.laneId,
        tier,
        index: nodes.length,
        ringIndex: tierIndex,
        tierIndex,
        position,
        anchor: new Vector3(position.x, position.y + anchorLift, position.z),
        taskStatus: task.status,
        status: classifyNodeStatus(task.status, lane?.kind ?? 'build'),
        complete: task.status === 'passed',
        completedAtMs: task.finishedAtMs,
        progress: task.progress,
        scale: nodeScale(classifyNodeStatus(task.status, lane?.kind ?? 'build'), task.progress),
        active: true,
      });
    });
  }

  const known = new Set(nodes.map((node) => node.id));
  const edges: ConduitEdge[] = [];
  for (const taskId of ordered) {
    const task = state.plan.tasks[taskId];
    if (!task) continue;
    for (const dependency of task.dependencies) {
      if (!known.has(dependency) || !known.has(taskId) || dependency === taskId) continue;
      edges.push({ id: `${dependency}->${taskId}`, from: dependency, to: taskId });
    }
  }

  return {
    nodes,
    tiers,
    edges,
    bounds: {
      minY: 0,
      maxY: maxTier * tierHeight + nodeLift + anchorLift,
      radius: largestRadius,
      nodeCount: nodes.length,
      tierCount: tiers.length,
      conduitCount: edges.length,
    },
    signature: planSignature(state),
  };
}

/** Frame the camera on the whole tower; used by previews and tests. */
export function framePlanGraphCamera(camera: PerspectiveCamera, bounds: PlanGraphBounds): void {
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const distance = Math.max(26, bounds.radius * 2.4 + bounds.maxY * 1.15);
  camera.position.set(Math.cos(0.9) * distance, centerY + distance * 0.42, Math.sin(0.9) * distance);
  camera.lookAt(0, centerY, 0);
  camera.updateMatrixWorld();
}

/* -------------------------------------------------------------------------- */
/* Picking                                                                    */
/* -------------------------------------------------------------------------- */

/** Normalized screen anchor: `x` right, `y` down, both usually within [0, 1]. */
export interface ScreenAnchor {
  readonly x: number;
  readonly y: number;
}

/** Client rectangle of the canvas; the DOM's `DOMRect` structurally matches. */
export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Convert pointer/touch client coordinates into normalized device coordinates.
 *
 * Both `PointerEvent` and `Touch` expose `clientX`/`clientY`, so mouse and touch
 * input share this single conversion.
 */
export function pointerToNdc(clientX: number, clientY: number, rect: RectLike): Vector2 {
  const width = rect.width > 0 ? rect.width : 1;
  const height = rect.height > 0 ? rect.height : 1;
  return new Vector2(
    ((clientX - rect.left) / width) * 2 - 1,
    -(((clientY - rect.top) / height) * 2 - 1),
  );
}

const projectScratch = new Vector3();

/**
 * Project a world position to a normalized screen anchor: `(0, 0)` is the
 * top-left of the canvas and `(1, 1)` the bottom-right. Off-screen nodes project
 * outside [0, 1] rather than being clamped, so an inspector can still tell which
 * way the node went.
 */
export function screenAnchorOf(position: Vector3, camera: PerspectiveCamera): ScreenAnchor {
  camera.updateMatrixWorld();
  projectScratch.copy(position).project(camera);
  return { x: (projectScratch.x + 1) / 2, y: (1 - projectScratch.y) / 2 };
}

/** A task node resolved from the pointer, plus the anchor an inspector sits on. */
export interface TaskNodePick {
  readonly taskId: string;
  readonly title: string;
  readonly status: PlanNodeStatus;
  readonly tier: number;
  readonly instanceId: number;
  /** Distance from the camera to the hit point. */
  readonly distance: number;
  /** World-space intersection point. */
  readonly point: Vector3;
  /** World-space centre of the picked node body. */
  readonly center: Vector3;
  /** The normalized device coordinates the pick was made at. */
  readonly ndc: ScreenAnchor;
  /** Normalized canvas anchor of the node, or `null` without a camera. */
  readonly screen: ScreenAnchor | null;
}

/** A selection record for the inspector: same shape, no hit geometry. */
export interface TaskNodeSelection {
  readonly taskId: string;
  readonly title: string;
  readonly status: PlanNodeStatus;
  readonly tier: number;
  readonly center: Vector3;
  readonly screen: ScreenAnchor | null;
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export interface PlanGraphViewOptions extends PhaseTierLayoutOptions {
  /** Instanced node pool capacity. Defaults to `PLAN_GRAPH_DEFAULTS.maxNodes`. */
  maxNodes?: number;
  /** Conduit pool capacity. Defaults to `PLAN_GRAPH_DEFAULTS.maxConduits`. */
  maxConduits?: number;
  /** Badge height above the body centre. */
  glyphLift?: number;
  /** Badge scale. */
  glyphScale?: number;
  /** Platform slab thickness. */
  platformThickness?: number;
  /** Rim notch size. */
  notchSize?: number;
  /** Camera used by picking; `setCamera` replaces it later. */
  camera?: PerspectiveCamera | null;
  /** Conduit curve overrides. */
  conduitArcHeight?: number;
  /** Conduit dim → lit transition. */
  conduitFadeMs?: number;
}

export interface PlanGraphView {
  readonly root: Group;
  /** Instanced body mesh per status (also the raycast targets). */
  readonly bodies: Readonly<Record<PlanNodeStatus, InstancedMesh>>;
  /** Wireframe overlay per status, so the polyhedron facets read without light. */
  readonly wires: Readonly<Record<PlanNodeStatus, InstancedMesh>>;
  /** On-node badge mesh per status. */
  readonly glyphs: Readonly<Record<PlanNodeStatus, InstancedMesh>>;
  /** Dependency conduit layer. */
  readonly edges: PlanGraphEdgesView;
  readonly nodes: readonly PlanGraphNode[];
  readonly tiers: readonly PhaseTier[];
  readonly bounds: PlanGraphBounds;
  /** Number of live task nodes. */
  readonly count: number;
  readonly capacity: number;
  readonly selectedTaskId: string | null;
  readonly selection: TaskNodeSelection | null;
  /** Monotonic layout revision; changes only when the plan's shape changes. */
  readonly revision: number;
  readonly disposed: boolean;
  readonly disposedResources: DisposedResources | null;
  setCamera(camera: PerspectiveCamera | null): void;
  /** Force a node to a visual status, or clear the override with `null`. */
  setStatusOverride(taskId: string, status: PlanNodeStatus | null): void;
  clearStatusOverrides(): void;
  update(state: PlanGraphState): void;
  node(id: string): PlanGraphNode | undefined;
  /** Platform group for a tier. */
  platformFor(tier: number): Object3D | undefined;
  /** Raycast the instanced node bodies from normalized device coordinates. */
  pick(ndc: Vector2 | ScreenAnchor): TaskNodePick | null;
  /** Same, from mouse or touch client coordinates over the canvas rectangle. */
  pickFromPointer(clientX: number, clientY: number, rect: RectLike): TaskNodePick | null;
  /** Mark a task selected (drives the halo), or clear with `null`. */
  select(taskId: string | null): TaskNodeSelection | null;
  dispose(): void;
}

interface StatusGroup {
  readonly status: PlanNodeStatus;
  readonly body: InstancedMesh;
  readonly wire: InstancedMesh;
  readonly glyph: InstancedMesh;
  readonly taskIds: string[];
}

interface PlatformRecord {
  readonly tier: number;
  readonly disc: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly rim: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly discMaterial: MeshBasicMaterial;
  readonly rimMaterial: MeshBasicMaterial;
}

const PLATFORM_DIM = new Color(PLATFORM_COLORS.dim);
const PLATFORM_LIT = new Color(PLATFORM_COLORS.lit);
const RIM_DIM = new Color(PLATFORM_COLORS.rimDim);
const RIM_LIT = new Color(PLATFORM_COLORS.rimLit);

/**
 * Create the plan graph view under `target`.
 *
 * The returned view owns every geometry, material and buffer it creates — node
 * bodies, badges, phase platforms, the tier spine, the selection halo and the
 * conduit layer. `dispose()` releases all of them and is idempotent.
 */
export function createPlanGraphView(
  target: Object3D,
  options: PlanGraphViewOptions = {},
): PlanGraphView {
  const layoutOptions: PhaseTierLayoutOptions = {
    tierHeight: options.tierHeight,
    nodeGap: options.nodeGap,
    minRadius: options.minRadius,
    platformMargin: options.platformMargin,
    nodeLift: options.nodeLift,
    tierTwist: options.tierTwist,
    anchorLift: options.anchorLift,
  };
  const maxNodes = Math.max(1, Math.floor(options.maxNodes ?? PLAN_GRAPH_DEFAULTS.maxNodes));
  const glyphLift = options.glyphLift ?? PLAN_GRAPH_DEFAULTS.glyphLift;
  const glyphScale = options.glyphScale ?? PLAN_GRAPH_DEFAULTS.glyphScale;
  const platformThickness = options.platformThickness ?? PLAN_GRAPH_DEFAULTS.platformThickness;
  const notchSize = options.notchSize ?? PLAN_GRAPH_DEFAULTS.notchSize;

  const root = new Group();
  root.name = PLAN_GRAPH_NAMES.root;
  target.add(root);

  const platformLayer = new Group();
  platformLayer.name = PLAN_GRAPH_NAMES.platforms;
  const bodyLayer = new Group();
  bodyLayer.name = PLAN_GRAPH_NAMES.bodies;
  const glyphLayer = new Group();
  glyphLayer.name = PLAN_GRAPH_NAMES.glyphs;
  const edgeLayer = new Group();
  edgeLayer.name = PLAN_GRAPH_NAMES.conduits;
  const selectionLayer = new Group();
  selectionLayer.name = PLAN_GRAPH_NAMES.selection;
  root.add(platformLayer, bodyLayer, glyphLayer, edgeLayer, selectionLayer);

  /* ------------------------------------------------------ shared geometries */

  const shapeGeometries = {} as Record<NodeShape, BufferGeometry>;
  const glyphGeometries = {} as Record<NodeGlyph, BufferGeometry>;
  for (const status of PLAN_GRAPH_STATUSES) {
    const visual = TASK_STATUS_PALETTE[status];
    if (!shapeGeometries[visual.shape]) {
      shapeGeometries[visual.shape] = createNodeShapeGeometry(visual.shape);
    }
    if (!glyphGeometries[visual.glyph]) {
      glyphGeometries[visual.glyph] = createNodeGlyphGeometry(visual.glyph);
    }
  }

  /* ------------------------------------------------------- instanced meshes */

  const materialFor = (
    opacity: number,
    wireframe: boolean,
  ): MeshBasicMaterial =>
    new MeshBasicMaterial({
      // White: the per-instance colour attribute carries the status palette.
      color: 0xffffff,
      wireframe,
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    });

  const bodies = {} as Record<PlanNodeStatus, InstancedMesh>;
  const wires = {} as Record<PlanNodeStatus, InstancedMesh>;
  const glyphs = {} as Record<PlanNodeStatus, InstancedMesh>;
  const groups = {} as Record<PlanNodeStatus, StatusGroup>;
  const taskIds = {} as Record<PlanNodeStatus, string[]>;

  for (const status of PLAN_GRAPH_STATUSES) {
    const visual = TASK_STATUS_PALETTE[status];
    const geometry = shapeGeometries[visual.shape];
    const badgeGeometry = glyphGeometries[visual.glyph];

    const body = new InstancedMesh(geometry, materialFor(0.5, false), maxNodes);
    body.name = PLAN_GRAPH_NAMES.body(status);
    body.instanceMatrix.setUsage(DynamicDrawUsage);
    body.frustumCulled = false;

    const wire = new InstancedMesh(geometry, materialFor(0.9, true), maxNodes);
    wire.name = PLAN_GRAPH_NAMES.wire(status);
    wire.instanceMatrix.setUsage(DynamicDrawUsage);
    wire.frustumCulled = false;

    const glyph = new InstancedMesh(badgeGeometry, materialFor(0.92, false), maxNodes);
    glyph.name = PLAN_GRAPH_NAMES.glyph(status);
    glyph.instanceMatrix.setUsage(DynamicDrawUsage);
    glyph.frustumCulled = false;

    body.count = 0;
    wire.count = 0;
    glyph.count = 0;
    bodyLayer.add(body, wire);
    glyphLayer.add(glyph);

    const ids: string[] = [];
    bodies[status] = body;
    wires[status] = wire;
    glyphs[status] = glyph;
    taskIds[status] = ids;
    groups[status] = { status, body, wire, glyph, taskIds: ids };
  }

  const pickTargets: Object3D[] = PLAN_GRAPH_STATUSES.map((status) => bodies[status]);
  const groupByMesh = new Map<Object3D, StatusGroup>();
  for (const status of PLAN_GRAPH_STATUSES) {
    const group = groups[status];
    groupByMesh.set(group.body, group);
    groupByMesh.set(group.wire, group);
  }

  /* ------------------------------------------------------------- selection */

  const halo = new Mesh(
    new TorusGeometry(1, 0.05, 8, 42),
    new MeshBasicMaterial({
      color: 0xd9fbff,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.name = PLAN_GRAPH_NAMES.halo;
  halo.rotation.x = -Math.PI / 2;
  halo.visible = false;
  halo.frustumCulled = false;
  selectionLayer.add(halo);

  /* ------------------------------------------------------------ conduit view */

  const edges = createPlanGraphEdges(edgeLayer, {
    maxConduits: options.maxConduits ?? PLAN_GRAPH_DEFAULTS.maxConduits,
    arcHeight: options.conduitArcHeight,
    fadeMs: options.conduitFadeMs,
  });

  /* ------------------------------------------------------------------ state */

  const scratch = new Object3D();
  const scratchColor = new Color();
  const nodeById = new Map<string, PlanGraphNode>();
  const overrides = new Map<string, PlanNodeStatus>();
  const counters: Record<PlanNodeStatus, number> = {
    queued: 0,
    running: 0,
    verifying: 0,
    passed: 0,
    failed: 0,
    superseded: 0,
  };
  const raycaster = new Raycaster();
  const ndcScratch = new Vector2();

  let platforms: PlatformRecord[] = [];
  let layout: PlanGraphLayout = createPhaseTierLayout(EMPTY_PLAN_GRAPH_STATE, layoutOptions);
  let lastSignature = '';
  let revision = 0;
  let activeCamera: PerspectiveCamera | null = options.camera ?? null;
  let selectedTaskId: string | null = null;
  let count = 0;
  let disposed = false;
  let disposedResources: DisposedResources | null = null;

  /** Rebuild the platform layer for a new tier shape. */
  const rebuildPlatforms = (next: PlanGraphLayout): void => {
    disposeRenderResources(platformLayer);
    platformLayer.clear();
    platforms = [];

    const spineHeight = next.tiers[next.tiers.length - 1]?.y ?? 0;
    if (spineHeight > 0) {
      const spine = new Mesh(
        new CylinderGeometry(0.1, 0.1, spineHeight, 8),
        new MeshBasicMaterial({
          color: PLATFORM_COLORS.spine,
          transparent: true,
          opacity: 0.5,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      spine.name = PLAN_GRAPH_NAMES.spine;
      spine.position.y = spineHeight / 2;
      platformLayer.add(spine);
    }

    for (const tier of next.tiers) {
      const group = new Group();
      group.name = PLAN_GRAPH_NAMES.platform(tier.tier);
      group.position.y = tier.y;

      const discMaterial = new MeshBasicMaterial({
        color: PLATFORM_DIM.clone(),
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      });
      const disc = new Mesh(
        new CylinderGeometry(tier.radius, tier.radius, platformThickness, 6),
        discMaterial,
      );
      disc.name = `${PLAN_GRAPH_NAMES.platform(tier.tier)}-disc`;
      group.add(disc);

      const rimMaterial = new MeshBasicMaterial({
        color: RIM_DIM.clone(),
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const rim = new Mesh(new TorusGeometry(tier.radius, 0.05, 4, 6), rimMaterial);
      rim.name = `${PLAN_GRAPH_NAMES.platform(tier.tier)}-rim`;
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = platformThickness / 2;
      group.add(rim);

      const notchGeometry = new BoxGeometry(notchSize, notchSize * 0.55, notchSize);
      const notchMaterial = new MeshBasicMaterial({
        color: PLATFORM_COLORS.notch,
        transparent: true,
        opacity: 0.75,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      for (let index = 0; index < tier.notchCount; index += 1) {
        const angle = (index / tier.notchCount) * Math.PI * 2;
        const notch = new Mesh(notchGeometry, notchMaterial);
        notch.name = PLAN_GRAPH_NAMES.notch(tier.tier, index);
        notch.position.set(
          Math.cos(angle) * tier.radius,
          platformThickness / 2,
          Math.sin(angle) * tier.radius,
        );
        notch.rotation.y = -angle;
        group.add(notch);
      }

      platformLayer.add(group);
      platforms.push({ tier: tier.tier, disc, rim, discMaterial, rimMaterial });
    }
  };

  const placeHalo = (node: PlanGraphNode): void => {
    halo.position.copy(node.position);
    halo.rotation.set(-Math.PI / 2, 0, 0);
    halo.scale.setScalar(1.9 * node.scale);
  };

  const selectionOf = (node: PlanGraphNode): TaskNodeSelection => ({
    taskId: node.id,
    title: node.title,
    status: node.status,
    tier: node.tier,
    center: node.position.clone(),
    screen: activeCamera ? screenAnchorOf(node.position, activeCamera) : null,
  });

  const update = (state: PlanGraphState): void => {
    if (disposed) return;
    const elapsedMs = state.mission.elapsedMs;
    const signature = planSignature(state);
    if (signature !== lastSignature) {
      layout = createPhaseTierLayout(state, layoutOptions);
      lastSignature = signature;
      revision += 1;
      nodeById.clear();
      for (const node of layout.nodes) nodeById.set(node.id, node);
      rebuildPlatforms(layout);
      // Keep a live selection across a rebuild.
      if (selectedTaskId !== null) {
        const node = nodeById.get(selectedTaskId);
        if (node) placeHalo(node);
        else {
          selectedTaskId = null;
          halo.visible = false;
        }
      }
    }

    // 1. Refresh every node record from this frame's state.
    let live = 0;
    for (const node of layout.nodes) {
      const task = state.plan.tasks[node.id];
      if (!task) {
        node.active = false;
        continue;
      }
      const lane = state.lanes.lanes[task.laneId];
      const derived = classifyNodeStatus(task.status, lane?.kind ?? 'build');
      node.taskStatus = task.status;
      node.status = overrides.get(node.id) ?? derived;
      node.complete = task.status === 'passed';
      node.completedAtMs = task.finishedAtMs;
      node.progress = task.progress;
      node.scale = nodeScale(node.status, task.progress);
      node.active = true;
      live += 1;
    }
    count = live;

    // 2. Write the instanced bodies, wireframes and badges. Per-instance colour
    //    rides in `instanceColor`, per-instance position and scale in
    //    `instanceMatrix` — both are rewritten in place, so nothing allocates.
    for (const status of PLAN_GRAPH_STATUSES) counters[status] = 0;

    for (const node of layout.nodes) {
      if (!node.active) continue;
      const group = groups[node.status];
      const visual = TASK_STATUS_PALETTE[node.status];
      const index = counters[node.status];
      counters[node.status] = index + 1;

      const glow = nodeStatusGlow(node.status, elapsedMs, node.index);
      const spin = nodeSpin(node.status, elapsedMs, node.index);

      scratch.position.copy(node.position);
      scratch.rotation.set(0, spin, 0);
      scratch.scale.setScalar(node.scale * (0.94 + 0.12 * glow));
      scratch.updateMatrix();
      group.body.setMatrixAt(index, scratch.matrix);
      group.wire.setMatrixAt(index, scratch.matrix);

      scratchColor.setHex(visual.color).multiplyScalar(0.5 + 0.8 * glow);
      group.body.setColorAt(index, scratchColor);
      group.wire.setColorAt(index, scratchColor.multiplyScalar(1.3));

      scratch.position.set(node.position.x, node.position.y + glyphLift, node.position.z);
      scratch.rotation.set(0, -spin * 1.4, 0);
      scratch.scale.setScalar(glyphScale * (0.95 + 0.1 * glow));
      scratch.updateMatrix();
      group.glyph.setMatrixAt(index, scratch.matrix);
      scratchColor.setHex(visual.glyphColor).multiplyScalar(0.72 + 0.5 * glow);
      group.glyph.setColorAt(index, scratchColor);

      group.taskIds[index] = node.id;
    }

    for (const status of PLAN_GRAPH_STATUSES) {
      const group = groups[status];
      const used = counters[status];
      group.taskIds.length = used;
      group.body.count = used;
      group.wire.count = used;
      group.glyph.count = used;
      group.body.instanceMatrix.needsUpdate = true;
      group.wire.instanceMatrix.needsUpdate = true;
      group.glyph.instanceMatrix.needsUpdate = true;
      if (group.body.instanceColor) group.body.instanceColor.needsUpdate = true;
      if (group.wire.instanceColor) group.wire.instanceColor.needsUpdate = true;
      if (group.glyph.instanceColor) group.glyph.instanceColor.needsUpdate = true;
    }

    // 3. Phase platforms light up as the tier's tasks settle.
    for (const record of platforms) {
      const tier = layout.tiers[record.tier];
      if (!tier) continue;
      let passed = 0;
      for (const taskId of tier.taskIds) {
        if (nodeById.get(taskId)?.complete) passed += 1;
      }
      const fraction = tier.taskIds.length === 0 ? 0 : passed / tier.taskIds.length;
      record.discMaterial.color.copy(PLATFORM_DIM).lerp(PLATFORM_LIT, fraction * 0.9);
      record.rimMaterial.color.copy(RIM_DIM).lerp(RIM_LIT, fraction);
      record.rim.rotation.y = elapsedMs / 11_000;
    }

    // 4. Keep the selection halo on its node.
    if (selectedTaskId !== null) {
      const node = nodeById.get(selectedTaskId);
      if (node && node.active) placeHalo(node);
      else {
        selectedTaskId = null;
        halo.visible = false;
      }
    }

    // 5. Conduits: they light as their upstream task completes.
    edges.update({ nodes: layout.nodes, edges: layout.edges, elapsedMs, revision });
  };

  const pick = (ndc: Vector2 | ScreenAnchor): TaskNodePick | null => {
    if (disposed) return null;
    const camera = activeCamera;
    if (!camera) return null;
    ndcScratch.set(ndc.x, ndc.y);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndcScratch, camera);
    root.updateWorldMatrix(true, true);

    const hits = raycaster.intersectObjects(pickTargets, false);
    for (const hit of hits) {
      const instanceId = hit.instanceId;
      if (instanceId === undefined) continue;
      const group = groupByMesh.get(hit.object);
      const taskId = group?.taskIds[instanceId];
      if (taskId === undefined) continue;
      const node = nodeById.get(taskId);
      if (!node || !node.active) continue;
      return {
        taskId,
        title: node.title,
        status: node.status,
        tier: node.tier,
        instanceId,
        distance: hit.distance,
        point: hit.point.clone(),
        center: node.position.clone(),
        ndc: { x: ndcScratch.x, y: ndcScratch.y },
        screen: screenAnchorOf(node.position, camera),
      };
    }
    return null;
  };

  return {
    root,
    bodies,
    wires,
    glyphs,
    edges,
    get nodes() {
      return layout.nodes;
    },
    get tiers() {
      return layout.tiers;
    },
    get bounds() {
      return layout.bounds;
    },
    get count() {
      return count;
    },
    capacity: maxNodes,
    get selectedTaskId() {
      return selectedTaskId;
    },
    get selection() {
      if (selectedTaskId === null) return null;
      const node = nodeById.get(selectedTaskId);
      return node && node.active ? selectionOf(node) : null;
    },
    get revision() {
      return revision;
    },
    get disposed() {
      return disposed;
    },
    get disposedResources() {
      return disposedResources;
    },
    setCamera(camera: PerspectiveCamera | null): void {
      activeCamera = camera;
    },
    setStatusOverride(taskId: string, status: PlanNodeStatus | null): void {
      if (status === null) overrides.delete(taskId);
      else overrides.set(taskId, status);
    },
    clearStatusOverrides(): void {
      overrides.clear();
    },
    update,
    node(id: string): PlanGraphNode | undefined {
      return nodeById.get(id);
    },
    platformFor(tier: number): Object3D | undefined {
      return platforms.find((record) => record.tier === tier)?.disc ?? undefined;
    },
    pick,
    pickFromPointer(clientX: number, clientY: number, rect: RectLike): TaskNodePick | null {
      return pick(pointerToNdc(clientX, clientY, rect));
    },
    select(taskId: string | null): TaskNodeSelection | null {
      if (disposed) return null;
      const node = taskId === null ? undefined : nodeById.get(taskId);
      if (!node || !node.active) {
        selectedTaskId = null;
        halo.visible = false;
        return null;
      }
      selectedTaskId = node.id;
      placeHalo(node);
      halo.visible = true;
      return selectionOf(node);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // The conduit layer owns its own subtree; release it first so the reports
      // do not overlap, then release what is left of the plan graph.
      edges.dispose();
      const conduitReport = edges.disposedResources;
      const own = disposeRenderResources(root);
      disposedResources = {
        geometries: own.geometries + (conduitReport?.geometries ?? 0),
        materials: own.materials + (conduitReport?.materials ?? 0),
        textures: own.textures + (conduitReport?.textures ?? 0),
      };
      root.removeFromParent();
      root.clear();
      platformLayer.clear();
      bodyLayer.clear();
      glyphLayer.clear();
      selectionLayer.clear();
      platforms = [];
      nodeById.clear();
      overrides.clear();
      selectedTaskId = null;
      count = 0;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* System factory                                                             */
/* -------------------------------------------------------------------------- */

export interface PlanGraphSystemOptions extends PlanGraphViewOptions {
  /** System id. Defaults to `render/plan-graph`. */
  id?: string;
}

/** The plan graph exposed as a composable game system. */
export interface PlanGraphSystem extends GameSystem {
  readonly view: PlanGraphView;
}

/**
 * Wrap the plan graph in the runtime's system contract.
 *
 * The view is created eagerly, so `system.view` is usable (for picking, HUD text
 * and inspection) as soon as the system is composed; `attach` only mounts the
 * host group into the scene and takes the runtime camera for picking.
 */
export function createPlanGraphSystem(options: PlanGraphSystemOptions = {}): PlanGraphSystem {
  const host = new Group();
  host.name = `${PLAN_GRAPH_NAMES.root}-host`;
  const view = createPlanGraphView(host, options);

  return {
    id: options.id ?? 'render/plan-graph',
    view,
    attach(context): void {
      view.setCamera(context.camera);
      context.scene.add(host);
    },
    update(update): void {
      view.update(update.state);
    },
    dispose(): void {
      view.dispose();
      host.removeFromParent();
      host.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Empty-state helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A plan-less placeholder so the view has a layout before its first `update`.
 * The first real `update()` always rebuilds, because its signature differs.
 */
const EMPTY_PLAN_GRAPH_STATE: PlanGraphState = {
  mission: { elapsedMs: 0 },
  plan: { id: '', order: [], tasks: {} },
  lanes: { order: [], lanes: {} },
};
