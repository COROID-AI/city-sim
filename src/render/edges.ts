/**
 * Dependency conduits — the curved energy channels that carry work from a task
 * node to every task that depends on it.
 *
 * Design notes:
 *
 *  - **The curves are pure math.** `createConduitPath` builds a quadratic Bézier
 *    arch between two node anchors, lifted above the floor and bowed outward
 *    from the tower axis so channels wrap around the graph instead of cutting
 *    through it. `sampleConduitPoint` evaluates that curve in closed form, so
 *    pulses (and tests) share the exact math the renderer uses.
 *  - **One draw call for every channel.** All conduits are written into a single
 *    pooled `LineSegments` whose per-vertex colour attribute carries the
 *    dim → lit state and the travelling energy band. Adding conduits never adds
 *    draw calls.
 *  - **Lit means the upstream task completed.** `conduitGlow` ramps from 0 to 1
 *    over `fadeMs`, measured from the upstream task's own `finishedAtMs`, so a
 *    conduit that was already energized before the view existed reads as fully
 *    lit. `conduitPulseU` then sweeps an energy head from the upstream anchor
 *    toward the dependent, and `conduitTravelWave` lights the spine behind it.
 *  - Nothing here reads wall-clock time: every animation is a function of
 *    `state.elapsedMs`, so a replay draws byte-identical frames.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';

import { disposeRenderResources, type DisposedResources } from './renderer';

/* -------------------------------------------------------------------------- */
/* Tunables and public constants                                              */
/* -------------------------------------------------------------------------- */

/** Conduit colours: cold and barely-there until the upstream task lands. */
export const CONDUIT_COLORS = {
  /** Upstream unfinished: a dim, cold channel. */
  dim: 0x1d4a5e,
  /** Upstream complete: the channel is energized and stays lit. */
  lit: 0x59ff9b,
  /** The energy head travelling toward the dependent task. */
  head: 0xd9fffb,
} as const;

/** Default conduit shape and animation timings. */
export const CONDUIT_DEFAULTS = {
  /** Line segments sampled per conduit. */
  samples: 24,
  /** Arch height above the straight line between the two anchors. */
  arcHeight: 2.4,
  /** Lateral bow, as a fraction of the anchor-to-anchor span. */
  bow: 0.06,
  /** Simulated ms the dim → lit transition takes. */
  fadeMs: 900,
  /** Simulated ms one pulse needs to travel upstream → dependent. */
  travelMs: 1_500,
  /** Radius of the energy head mesh, in world units. */
  headSize: 0.34,
  /** Half-width of the bright band around the head, in path units. */
  waveWidth: 0.22,
  /** Conduit pool capacity. */
  maxConduits: 256,
} as const;

/** Object-name prefixes, so tests and tooling can address the scene graph. */
export const CONDUIT_NAMES = {
  root: 'plan-graph-conduits',
  spine: 'plan-graph-conduit-spine',
  heads: 'plan-graph-conduit-heads',
  head: (conduitId: string): string => `plan-graph-conduit-head-${conduitId}`,
} as const;

/* -------------------------------------------------------------------------- */
/* Energy math                                                                */
/* -------------------------------------------------------------------------- */

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Dim → lit ramp for one conduit.
 *
 * `litAtMs` is the simulated millisecond the upstream task completed, or `null`
 * while the upstream is still unfinished. The conduit is fully lit once
 * `fadeMs` has passed since then — which means a conduit whose upstream settled
 * before the view existed (or which is updated long after the fact) reads as lit
 * immediately rather than replaying the fade.
 */
export function conduitGlow(
  litAtMs: number | null,
  elapsedMs: number,
  fadeMs: number = CONDUIT_DEFAULTS.fadeMs,
): number {
  if (litAtMs === null || !Number.isFinite(litAtMs) || !Number.isFinite(elapsedMs)) return 0;
  if (elapsedMs <= litAtMs) return 0;
  if (fadeMs <= 0) return 1;
  return clamp01((elapsedMs - litAtMs) / fadeMs);
}

/**
 * Normalized position of the energy head on the conduit, 0 at the upstream
 * anchor and 1 at the dependent. One full traverse takes `travelMs`; the head
 * loops for as long as the conduit stays lit.
 */
export function conduitPulseU(
  litAtMs: number | null,
  elapsedMs: number,
  travelMs: number = CONDUIT_DEFAULTS.travelMs,
): number {
  if (litAtMs === null || !Number.isFinite(litAtMs) || !Number.isFinite(elapsedMs)) return 0;
  if (elapsedMs <= litAtMs) return 0;
  const period = Math.max(1, travelMs);
  const travelled = (elapsedMs - litAtMs) / period;
  return travelled - Math.floor(travelled);
}

/**
 * Brightness of the travelling energy band at path position `t`, given the
 * head's position. Wraps around the seam, so a head at `u = 0.97` still lights
 * the start of the conduit at `t = 0.02`.
 */
export function conduitTravelWave(t: number, headU: number, width: number): number {
  if (width <= 0) return 0;
  let distance = Math.abs(t - headU);
  if (distance > 0.5) distance = 1 - distance;
  const falloff = Math.max(0, 1 - distance / width);
  return falloff * falloff;
}

const DIM_COLOR = new Color(CONDUIT_COLORS.dim);
const LIT_COLOR = new Color(CONDUIT_COLORS.lit);

/**
 * Colour of a conduit vertex: the dim channel colour lerped toward the lit
 * colour by the glow, brightened where the energy band passes overhead.
 */
export function conduitColor(glow: number, wave: number, out: Color): Color {
  const band = clamp01(wave);
  const intensity = clamp01(glow * (0.5 + 0.85 * band));
  return out.copy(DIM_COLOR).lerp(LIT_COLOR, intensity);
}

/* -------------------------------------------------------------------------- */
/* Curves and paths                                                           */
/* -------------------------------------------------------------------------- */

const UP = new Vector3(0, 1, 0);

export interface ConduitCurveOptions {
  /** Line segments to sample. Defaults to `CONDUIT_DEFAULTS.samples`. */
  samples?: number;
  /** Arch height above the straight line between the anchors. */
  arcHeight?: number;
  /** Lateral bow away from the tower axis, as a fraction of the span. */
  bow?: number;
}

/** A sampled conduit curve plus the control point it was built from. */
export interface ConduitPath {
  /** Upstream anchor the channel leaves. */
  readonly from: Vector3;
  /** Dependent anchor the channel empties into. */
  readonly to: Vector3;
  /** Quadratic Bézier control point (arch apex, bowed off the tower axis). */
  readonly control: Vector3;
  /** `samples + 1` polyline points; `from` first, `to` last. */
  readonly points: readonly Vector3[];
  /** Segments the polyline is split into. */
  readonly samples: number;
  /** Approximate arc length in world units. */
  readonly length: number;
}

/** Quadratic Bézier evaluation, written into `out`. */
function writeQuadratic(
  from: Vector3,
  control: Vector3,
  to: Vector3,
  u: number,
  out: Vector3,
): Vector3 {
  const inv = 1 - u;
  const a = inv * inv;
  const b = 2 * inv * u;
  const c = u * u;
  return out.set(
    a * from.x + b * control.x + c * to.x,
    a * from.y + b * control.y + c * to.y,
    a * from.z + b * control.z + c * to.z,
  );
}

/**
 * Build the arch between two node anchors.
 *
 * Pure: identical anchors and options always give byte-identical points, which
 * is what lets the view, a pulse and a test derive the same curve independently.
 */
export function createConduitPath(
  from: Vector3,
  to: Vector3,
  options: ConduitCurveOptions = {},
): ConduitPath {
  const samples = Math.max(2, Math.floor(options.samples ?? CONDUIT_DEFAULTS.samples));
  const arcHeight = options.arcHeight ?? CONDUIT_DEFAULTS.arcHeight;
  const bow = options.bow ?? CONDUIT_DEFAULTS.bow;

  const start = from.clone();
  const end = to.clone();
  const span = start.distanceTo(end);

  const control = new Vector3().addVectors(start, end).multiplyScalar(0.5);
  control.y += arcHeight + span * 0.08;

  // Bow the arch outward so neighbouring channels do not overlap across the
  // middle of the graph.
  const flat = new Vector3().subVectors(end, start);
  flat.y = 0;
  if (bow !== 0 && flat.lengthSq() > 1e-6) {
    const perpendicular = new Vector3().crossVectors(UP, flat).normalize();
    const radial = new Vector3(control.x, 0, control.z);
    const outward = radial.lengthSq() > 1e-6 && perpendicular.dot(radial) < 0 ? -1 : 1;
    control.addScaledVector(perpendicular, outward * span * bow);
  }

  const points: Vector3[] = [];
  let length = 0;
  let previous: Vector3 | null = null;
  for (let index = 0; index <= samples; index += 1) {
    const point = writeQuadratic(start, control, end, index / samples, new Vector3());
    if (previous) length += previous.distanceTo(point);
    previous = point;
    points.push(point);
  }

  return { from: start, to: end, control, points, samples, length };
}

/** Evaluate the path at `u` in [0, 1], written into `out`. */
export function sampleConduitPoint(path: ConduitPath, u: number, out: Vector3): Vector3 {
  return writeQuadratic(path.from, path.control, path.to, clamp01(u), out);
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

/** The slice of a plan-graph node the conduit view needs. */
export interface ConduitEndpointNode {
  readonly id: string;
  /** World position the channel attaches to (the top of the node body). */
  readonly anchor: Vector3;
  /** True once the upstream task completed (`passed`). */
  readonly complete: boolean;
  /** Simulated ms the upstream task settled, or `null` while it is unfinished. */
  readonly completedAtMs: number | null;
}

/** One dependency edge: `from` must complete before `to` can run. */
export interface ConduitEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Everything the conduit view reads in one update.
 *
 * `revision` is a monotonic layout revision owned by the caller: conduit paths
 * are rebuilt only when it changes, which keeps the per-frame path free of
 * geometry allocation.
 */
export interface ConduitGraphState {
  readonly nodes: readonly ConduitEndpointNode[];
  readonly edges: readonly ConduitEdge[];
  readonly elapsedMs: number;
  readonly revision: number;
}

/** A live conduit: its curve plus its current energy state. */
export interface PlanConduit {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly path: ConduitPath;
  /** 0 = dim, 1 = fully lit. */
  glow: number;
  /** True once the upstream task has completed. */
  lit: boolean;
  /** Simulated ms the upstream completed, or `null`. */
  litAtMs: number | null;
  /** Position of the energy head in [0, 1]; 0 when the conduit is idle. */
  pulseU: number;
}

export interface PlanGraphEdgesOptions extends ConduitCurveOptions {
  /** Conduit pool capacity. Defaults to `CONDUIT_DEFAULTS.maxConduits`. */
  maxConduits?: number;
  /** Override the dim → lit transition duration. */
  fadeMs?: number;
  /** Override one pulse traverse. */
  travelMs?: number;
  /** Override the travelling band half-width. */
  waveWidth?: number;
}

export interface PlanGraphEdgesView {
  readonly root: Group;
  /** Live conduits, in dependency order (upstream first in the plan). */
  readonly conduits: readonly PlanConduit[];
  /** Number of live conduits. */
  readonly count: number;
  /** Conduits whose upstream task has completed. */
  readonly litCount: number;
  /** Lit conduits currently showing an energy head. */
  readonly pulsingCount: number;
  readonly capacity: number;
  readonly disposed: boolean;
  readonly disposedResources: DisposedResources | null;
  update(state: ConduitGraphState): void;
  conduit(id: string): PlanConduit | undefined;
  conduitBetween(from: string, to: string): PlanConduit | undefined;
  /** Energy-head mesh for a conduit while it is lit, otherwise undefined. */
  headFor(id: string): Mesh | undefined;
  dispose(): void;
}

/**
 * Create the conduit layer under `target`.
 *
 * The returned view owns the single line segment buffer, its materials and the
 * pooled energy heads; `dispose()` releases all of them and is idempotent.
 */
export function createPlanGraphEdges(
  target: Object3D,
  options: PlanGraphEdgesOptions = {},
): PlanGraphEdgesView {
  const config = {
    samples: Math.max(2, Math.floor(options.samples ?? CONDUIT_DEFAULTS.samples)),
    arcHeight: options.arcHeight ?? CONDUIT_DEFAULTS.arcHeight,
    bow: options.bow ?? CONDUIT_DEFAULTS.bow,
    fadeMs: options.fadeMs ?? CONDUIT_DEFAULTS.fadeMs,
    travelMs: options.travelMs ?? CONDUIT_DEFAULTS.travelMs,
    waveWidth: options.waveWidth ?? CONDUIT_DEFAULTS.waveWidth,
    maxConduits: Math.max(1, Math.floor(options.maxConduits ?? CONDUIT_DEFAULTS.maxConduits)),
  };

  const root = new Group();
  root.name = CONDUIT_NAMES.root;
  target.add(root);

  /* ---------------------------------------------------------- spine buffers */

  const verticesPerConduit = config.samples * 2;
  const totalVertices = config.maxConduits * verticesPerConduit;
  const positions = new Float32Array(totalVertices * 3);
  const colors = new Float32Array(totalVertices * 3);

  const spineGeometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  positionAttribute.setUsage(DynamicDrawUsage);
  const colorAttribute = new BufferAttribute(colors, 3);
  colorAttribute.setUsage(DynamicDrawUsage);
  spineGeometry.setAttribute('position', positionAttribute);
  spineGeometry.setAttribute('color', colorAttribute);
  spineGeometry.setDrawRange(0, 0);

  const spine = new LineSegments(
    spineGeometry,
    new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  spine.name = CONDUIT_NAMES.spine;
  // The buffer covers the whole floor; never let three cull it away.
  spine.frustumCulled = false;

  /* ------------------------------------------------------------ head pool */

  const headLayer = new Group();
  headLayer.name = CONDUIT_NAMES.heads;
  const headGeometry = new SphereGeometry(1, 14, 10);
  const headMaterial = new MeshBasicMaterial({
    color: CONDUIT_COLORS.head,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const heads: Mesh[] = [];
  for (let index = 0; index < config.maxConduits; index += 1) {
    const head = new Mesh(headGeometry, headMaterial);
    head.visible = false;
    head.frustumCulled = false;
    heads.push(head);
    headLayer.add(head);
  }

  root.add(spine, headLayer);

  /* ----------------------------------------------------------------- state */

  const endpointById = new Map<string, ConduitEndpointNode>();
  const scratchPoint = new Vector3();
  const scratchColor = new Color();

  let conduits: PlanConduit[] = [];
  let revision = -1;
  let litCount = 0;
  let pulsingCount = 0;
  let disposed = false;
  let disposedResources: DisposedResources | null = null;

  const segmentBase = (index: number): number => index * verticesPerConduit * 3;

  /** Write one conduit's polyline and its current dim → lit vertex colours. */
  const writeConduit = (conduit: PlanConduit, index: number): void => {
    const points = conduit.path.points;
    const base = segmentBase(index);
    for (let segment = 0; segment < config.samples; segment += 1) {
      const start = points[segment] ?? conduit.path.from;
      const end = points[segment + 1] ?? conduit.path.to;
      const offset = base + segment * 6;

      positions[offset] = start.x;
      positions[offset + 1] = start.y;
      positions[offset + 2] = start.z;
      positions[offset + 3] = end.x;
      positions[offset + 4] = end.y;
      positions[offset + 5] = end.z;

      const t0 = segment / config.samples;
      const t1 = (segment + 1) / config.samples;
      conduitColor(conduit.glow, conduitTravelWave(t0, conduit.pulseU, config.waveWidth), scratchColor);
      colors[offset] = scratchColor.r;
      colors[offset + 1] = scratchColor.g;
      colors[offset + 2] = scratchColor.b;
      conduitColor(conduit.glow, conduitTravelWave(t1, conduit.pulseU, config.waveWidth), scratchColor);
      colors[offset + 3] = scratchColor.r;
      colors[offset + 4] = scratchColor.g;
      colors[offset + 5] = scratchColor.b;
    }
  };

  /** Rebuild the conduit curves whenever the caller's layout revision moves. */
  const rebuild = (state: ConduitGraphState): void => {
    const next: PlanConduit[] = [];
    for (const edge of state.edges) {
      if (next.length >= config.maxConduits) break;
      const from = endpointById.get(edge.from);
      const to = endpointById.get(edge.to);
      if (!from || !to) continue;
      next.push({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        path: createConduitPath(from.anchor, to.anchor, {
          samples: config.samples,
          arcHeight: config.arcHeight,
          bow: config.bow,
        }),
        glow: 0,
        lit: false,
        litAtMs: null,
        pulseU: 0,
      });
    }
    conduits = next;

    for (let index = 0; index < heads.length; index += 1) {
      const head = heads[index];
      if (!head) continue;
      head.visible = false;
      const conduit = conduits[index];
      head.name = CONDUIT_NAMES.head(conduit ? conduit.id : `free-${index}`);
    }
    revision = state.revision;
  };

  const update = (state: ConduitGraphState): void => {
    if (disposed) return;

    endpointById.clear();
    for (const node of state.nodes) endpointById.set(node.id, node);
    if (state.revision !== revision) rebuild(state);

    let lit = 0;
    let pulsing = 0;
    for (let index = 0; index < conduits.length; index += 1) {
      const conduit = conduits[index];
      if (!conduit) continue;
      const upstream = endpointById.get(conduit.from);
      conduit.lit = upstream?.complete === true;
      conduit.litAtMs = conduit.lit
        ? (upstream?.completedAtMs ?? state.elapsedMs)
        : null;
      conduit.glow = conduitGlow(conduit.litAtMs, state.elapsedMs, config.fadeMs);
      conduit.pulseU = conduitPulseU(conduit.litAtMs, state.elapsedMs, config.travelMs);
      writeConduit(conduit, index);

      const head = heads[index];
      if (head) {
        const visible = conduit.lit && conduit.glow > 0.02;
        head.visible = visible;
        if (visible) {
          sampleConduitPoint(conduit.path, conduit.pulseU, scratchPoint);
          head.position.copy(scratchPoint);
          head.scale.setScalar(CONDUIT_DEFAULTS.headSize * (0.55 + 0.65 * conduit.glow));
        }
      }

      if (conduit.lit) lit += 1;
      if (conduit.lit && conduit.glow > 0) pulsing += 1;
    }

    litCount = lit;
    pulsingCount = pulsing;
    spineGeometry.setDrawRange(0, conduits.length * verticesPerConduit);
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  };

  const indexOf = (id: string): number => conduits.findIndex((conduit) => conduit.id === id);

  return {
    root,
    get conduits() {
      return conduits;
    },
    get count() {
      return conduits.length;
    },
    get litCount() {
      return litCount;
    },
    get pulsingCount() {
      return pulsingCount;
    },
    capacity: config.maxConduits,
    get disposed() {
      return disposed;
    },
    get disposedResources() {
      return disposedResources;
    },
    update,
    conduit(id: string): PlanConduit | undefined {
      const index = indexOf(id);
      return index < 0 ? undefined : conduits[index];
    },
    conduitBetween(from: string, to: string): PlanConduit | undefined {
      return conduits.find((conduit) => conduit.from === from && conduit.to === to);
    },
    headFor(id: string): Mesh | undefined {
      const index = indexOf(id);
      if (index < 0) return undefined;
      const head = heads[index];
      return head && head.visible ? head : undefined;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposedResources = disposeRenderResources(root);
      root.removeFromParent();
      root.clear();
      conduits = [];
      endpointById.clear();
      litCount = 0;
      pulsingCount = 0;
      spineGeometry.setDrawRange(0, 0);
    },
  };
}
