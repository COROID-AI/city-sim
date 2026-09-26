/**
 * The quality constellation — a floating graph of the mission's quality
 * criteria, read purely from the `quality` state slice.
 *
 * Each criterion is drawn as a distinct shape plus a glyph, so its lifecycle
 * reads without relying on colour:
 *
 *  - `milestone`       — small bright tetrahedron with a chip glyph.
 *  - `final-invariant` — large bright octahedron with a halo glyph; the ones
 *                        that must hold before the mission can ship.
 *  - `superseded`      — dim wireframe tetrahedron with a slash glyph, linked
 *                        by a beam to the criterion that replaced it.
 *
 * The classification is derived from the state, because the foundation slice
 * carries measurements rather than lifecycle labels:
 *
 *  1. a settled *milestone* (weight below `FINAL_INVARIANT_WEIGHT`) that a
 *     later-registered, strictly heavier settled milestone has replaced is
 *     `superseded` — it stays in the constellation as history, linked to its
 *     replacement;
 *  2. otherwise a criterion whose weight reaches `FINAL_INVARIANT_WEIGHT` is a
 *     `final-invariant` — these must hold for the mission to ship, so they are
 *     never replaced;
 *  3. everything else is a `milestone`.
 *
 * The constellation grows upward as criteria are satisfied: a criterion rests on
 * its anchor at zero satisfaction and climbs as its measured value approaches
 * its target, so completed final invariants float above the rest.
 *
 * Like the lane view, everything is pooled: `update()` rewrites pooled records,
 * transforms and vertex buffers in place, so the per-frame path allocates
 * nothing (metric records are only ever grown when a new metric first appears).
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';

import { disposeRenderResources, type DisposedResources } from './renderer';
import type { GameSystem } from '../game/systems';
import type { DeepReadonly, GameState } from '../sim/state';

/* -------------------------------------------------------------------------- */
/* Tunables and public constants                                              */
/* -------------------------------------------------------------------------- */

/** Weight at or above which a criterion is a mission-level invariant. */
export const FINAL_INVARIANT_WEIGHT = 0.25;
/** Golden angle used to spread criteria around the constellation. */
export const GOLDEN_ANGLE = 2.399963229728653;

export const CRITERION_COLORS = {
  milestone: 0x35f0ff,
  'final-invariant': 0xeaffff,
  superseded: 0x3f6272,
} as const;

export const CRITERION_GLYPH_COLORS = {
  milestone: 0x9ffbff,
  'final-invariant': 0xd8feff,
  superseded: 0x8a5f8f,
} as const;

/** Object-name prefixes, so tests and tooling can address the scene graph. */
export const CRITERION_NAMES = {
  root: 'quality-constellation',
  criteria: 'quality-criteria',
  links: 'quality-links',
  node: (id: string): string => `criterion-${id}`,
  body: (id: string): string => `criterion-${id}-body`,
  glyph: (id: string): string => `criterion-${id}-glyph`,
  link: (id: string): string => `criterion-link-${id}`,
} as const;

/** Default constellation framing. */
export const CONSTELLATION_DEFAULTS = {
  baseHeight: 11,
  radius: 6.2,
  radiusStep: 1.6,
  milestoneRise: 3.4,
  invariantRise: 8,
  supersededDrop: 1.8,
} as const;

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

/** The three criterion lifecycles the constellation distinguishes. */
export type QualityCriterionKind = 'milestone' | 'final-invariant' | 'superseded';

/** The subset of a quality metric the constellation reads. */
export interface QualityCriterionSource {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly target: number;
  readonly weight: number;
}

export interface CriterionClassification {
  readonly kind: QualityCriterionKind;
  /** Id of the criterion that replaced this one, for `superseded`. */
  readonly supersededBy: string | null;
  /** Weight of that replacement, or 0. */
  readonly replacementWeight: number;
}

const EPSILON = 1e-6;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** True when the measured value has reached the metric's target. */
export function isCriterionSatisfied(metric: QualityCriterionSource): boolean {
  if (metric.target <= 0) return metric.value > 0;
  return metric.value >= metric.target - EPSILON;
}

/** 0..1 progress of a metric towards its target. */
export function criterionSatisfaction(metric: QualityCriterionSource): number {
  if (metric.target <= 0) return metric.value > 0 ? 1 : 0;
  return clamp01(metric.value / metric.target);
}

/**
 * Classify the criterion at `index` against its siblings. Pure and
 * deterministic: the same metrics always produce the same lifecycle.
 */
export function classifyCriterion(
  metrics: readonly QualityCriterionSource[],
  index: number,
): CriterionClassification {
  const metric = metrics[index];
  if (!metric) {
    return { kind: 'milestone', supersededBy: null, replacementWeight: 0 };
  }

  // Final invariants are pillars: they are never replaced by another criterion.
  if (!isCriterionSatisfied(metric) || metric.weight >= FINAL_INVARIANT_WEIGHT) {
    return metric.weight >= FINAL_INVARIANT_WEIGHT
      ? { kind: 'final-invariant', supersededBy: null, replacementWeight: 0 }
      : { kind: 'milestone', supersededBy: null, replacementWeight: 0 };
  }

  let replacementId: string | null = null;
  let replacementWeight = 0;
  for (let i = index + 1; i < metrics.length; i += 1) {
    const sibling = metrics[i];
    if (!sibling) continue;
    if (!isCriterionSatisfied(sibling)) continue;
    if (sibling.weight <= metric.weight) continue;
    // Strongest replacement wins; ties keep the earliest registered one.
    if (replacementId === null || sibling.weight > replacementWeight) {
      replacementId = sibling.id;
      replacementWeight = sibling.weight;
    }
  }
  if (replacementId !== null) {
    return { kind: 'superseded', supersededBy: replacementId, replacementWeight };
  }
  return { kind: 'milestone', supersededBy: null, replacementWeight: 0 };
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export interface ConstellationLayoutOptions {
  /** Height the constellation's resting plane floats at. */
  baseHeight?: number;
  /** Base orbital radius. */
  radius?: number;
  /** Extra radius per orbit step. */
  radiusStep?: number;
  /** Height a satisfied milestone climbs. */
  milestoneRise?: number;
  /** Height a satisfied final invariant climbs. */
  invariantRise?: number;
  /** Depth of the superseded band below the resting plane. */
  supersededDrop?: number;
  /** Centre of the constellation in world space. */
  center?: Vector3;
}

/** Mutable, pooled layout record for one criterion. */
export interface CriterionLayout {
  id: string;
  label: string;
  kind: QualityCriterionKind;
  /** Index in `state.quality.order`. */
  index: number;
  value: number;
  target: number;
  weight: number;
  /** 0..1 progress towards the target. */
  satisfaction: number;
  completed: boolean;
  supersededBy: string | null;
  /** Resting position at zero satisfaction. */
  anchor: Vector3;
  /** Live position; climbs upward as the criterion is satisfied. */
  position: Vector3;
}

/** A criterion plus its pooled-slot state. */
export interface QualityCriterion extends CriterionLayout {
  /** False for pooled slots that currently hold no criterion. */
  active: boolean;
}

/**
 * Write the layout of criterion `index` into `target`, in place.
 *
 * Allocation-free: callers pass pooled records, which is what keeps the
 * per-frame update path free of garbage.
 */
export function writeCriterionLayout(
  target: CriterionLayout,
  metrics: readonly QualityCriterionSource[],
  index: number,
  options: ConstellationLayoutOptions = {},
): void {
  const metric = metrics[index];
  if (!metric) {
    target.id = '';
    target.label = '';
    target.supersededBy = null;
    target.satisfaction = 0;
    target.completed = false;
    return;
  }

  const baseHeight = options.baseHeight ?? CONSTELLATION_DEFAULTS.baseHeight;
  const radius = options.radius ?? CONSTELLATION_DEFAULTS.radius;
  const radiusStep = options.radiusStep ?? CONSTELLATION_DEFAULTS.radiusStep;
  const milestoneRise = options.milestoneRise ?? CONSTELLATION_DEFAULTS.milestoneRise;
  const invariantRise = options.invariantRise ?? CONSTELLATION_DEFAULTS.invariantRise;
  const supersededDrop = options.supersededDrop ?? CONSTELLATION_DEFAULTS.supersededDrop;
  const center = options.center;

  const classification = classifyCriterion(metrics, index);
  const satisfaction = criterionSatisfaction(metric);
  const angle = index * GOLDEN_ANGLE;
  const orbit = radius + (index % 3) * radiusStep * 0.5;
  const x = (center?.x ?? 0) + Math.cos(angle) * orbit;
  const z = (center?.z ?? 0) + Math.sin(angle) * orbit;

  const restingHeight =
    classification.kind === 'final-invariant'
      ? baseHeight + 3.2
      : classification.kind === 'superseded'
        ? baseHeight - supersededDrop - 0.35 * (index % 3)
        : baseHeight;

  target.id = metric.id;
  target.label = metric.label;
  target.kind = classification.kind;
  target.index = index;
  target.value = metric.value;
  target.target = metric.target;
  target.weight = metric.weight;
  target.satisfaction = satisfaction;
  target.completed = isCriterionSatisfied(metric);
  target.supersededBy = classification.supersededBy;
  target.anchor.set(x, restingHeight, z);
  // Growth is upward: only live criteria climb. Superseded criteria rest as
  // history in the low band, already leaning towards their replacement.
  const rise =
    classification.kind === 'superseded'
      ? 0
      : satisfaction * (classification.kind === 'final-invariant' ? invariantRise : milestoneRise);
  target.position.set(x, restingHeight + rise, z);
}

/**
 * Build the full constellation layout for a state. Pure; allocates fresh
 * records, which makes it the natural helper for tests and tooling. The view
 * uses `writeCriterionLayout` against pooled records instead.
 */
export function createConstellationLayout(
  state: QualityViewState,
  options: ConstellationLayoutOptions = {},
): QualityCriterion[] {
  const metrics = readQualityMetrics(state);
  const criteria: QualityCriterion[] = [];
  for (let index = 0; index < metrics.length; index += 1) {
    const entry: QualityCriterion = {
      id: '',
      label: '',
      kind: 'milestone',
      index,
      value: 0,
      target: 1,
      weight: 0,
      satisfaction: 0,
      completed: false,
      supersededBy: null,
      anchor: new Vector3(),
      position: new Vector3(),
      active: false,
    };
    writeCriterionLayout(entry, metrics, index, options);
    entry.active = entry.id !== '';
    criteria.push(entry);
  }
  return criteria;
}

/** State this module reads: the live document or a frozen snapshot. */
export type QualityViewState = GameState | DeepReadonly<GameState>;

/** Quality metrics in registration order, as plain criterion sources. */
export function readQualityMetrics(state: QualityViewState): QualityCriterionSource[] {
  const metrics: QualityCriterionSource[] = [];
  for (const metricId of state.quality.order) {
    const metric = state.quality.metrics[metricId];
    if (!metric) continue;
    metrics.push({
      id: metric.id,
      label: metric.label,
      value: metric.value,
      target: metric.target,
      weight: metric.weight,
    });
  }
  return metrics;
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export interface QualityGraphViewOptions extends ConstellationLayoutOptions {
  /** Criterion pool size. Defaults to 24. */
  maxCriteria?: number;
  /** System/view id used by `createQualityGraphSystem`. */
  id?: string;
}

export interface QualityGraphView {
  readonly root: Group;
  /** Pooled criteria; filter on `active`. */
  readonly criteria: readonly QualityCriterion[];
  /** Number of live criteria. */
  readonly count: number;
  /** Satisfied final invariants — the mission-level criteria that hold. */
  readonly completedFinalInvariants: number;
  readonly supersededCount: number;
  /** How far the constellation has grown: highest live criterion, Y. */
  readonly apexY: number;
  readonly capacity: number;
  readonly disposed: boolean;
  readonly disposedResources: DisposedResources | null;
  update(state: DeepReadonly<GameState>): void;
  criterion(id: string): QualityCriterion | undefined;
  /** Group object for a criterion id. */
  objectFor(id: string): Object3D | undefined;
  /** Shape mesh for a criterion id (tetra or octahedron, per lifecycle). */
  bodyFor(id: string): Mesh | undefined;
  /** Glyph mesh for a criterion id (chip, halo or slash, per lifecycle). */
  glyphFor(id: string): Mesh | undefined;
  /** Replacement beam for a criterion id, or undefined when there is none. */
  linkFor(id: string): Line | undefined;
  dispose(): void;
}

interface MutableMetricRecord {
  id: string;
  label: string;
  value: number;
  target: number;
  weight: number;
}

interface CriterionSlot {
  readonly group: Group;
  readonly body: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly glyph: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly link: Line<BufferGeometry, LineBasicMaterial>;
  readonly linkPositions: Float32Array;
  criterionId: string;
}

/**
 * Create the constellation view under `target`.
 *
 * The returned view owns every pooled mesh, geometry and material it creates;
 * `dispose()` releases all of them and is idempotent.
 */
export function createQualityGraph(
  target: Object3D,
  options: QualityGraphViewOptions = {},
): QualityGraphView {
  const config = {
    baseHeight: options.baseHeight ?? CONSTELLATION_DEFAULTS.baseHeight,
    radius: options.radius ?? CONSTELLATION_DEFAULTS.radius,
    radiusStep: options.radiusStep ?? CONSTELLATION_DEFAULTS.radiusStep,
    milestoneRise: options.milestoneRise ?? CONSTELLATION_DEFAULTS.milestoneRise,
    invariantRise: options.invariantRise ?? CONSTELLATION_DEFAULTS.invariantRise,
    supersededDrop: options.supersededDrop ?? CONSTELLATION_DEFAULTS.supersededDrop,
    center: options.center,
    maxCriteria: options.maxCriteria ?? 24,
  };

  const layout: ConstellationLayoutOptions = {
    baseHeight: config.baseHeight,
    radius: config.radius,
    radiusStep: config.radiusStep,
    milestoneRise: config.milestoneRise,
    invariantRise: config.invariantRise,
    supersededDrop: config.supersededDrop,
    ...(config.center ? { center: config.center } : {}),
  };

  const root = new Group();
  root.name = CRITERION_NAMES.root;
  target.add(root);

  const linkLayer = new Group();
  linkLayer.name = CRITERION_NAMES.links;
  const criteriaLayer = new Group();
  criteriaLayer.name = CRITERION_NAMES.criteria;
  root.add(linkLayer, criteriaLayer);

  /* ------------------------------------------------------------- materials */

  const bodyMaterials: Record<QualityCriterionKind, MeshBasicMaterial> = {
    milestone: new MeshBasicMaterial({
      color: CRITERION_COLORS.milestone,
      transparent: true,
      opacity: 0.8,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    'final-invariant': new MeshBasicMaterial({
      color: CRITERION_COLORS['final-invariant'],
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    superseded: new MeshBasicMaterial({
      color: CRITERION_COLORS.superseded,
      transparent: true,
      opacity: 0.4,
      wireframe: true,
      depthWrite: false,
    }),
  };

  const glyphMaterials: Record<QualityCriterionKind, MeshBasicMaterial> = {
    milestone: new MeshBasicMaterial({
      color: CRITERION_GLYPH_COLORS.milestone,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    'final-invariant': new MeshBasicMaterial({
      color: CRITERION_GLYPH_COLORS['final-invariant'],
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    superseded: new MeshBasicMaterial({
      color: CRITERION_GLYPH_COLORS.superseded,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  };

  const linkMaterial = new LineBasicMaterial({
    color: 0xff4fd8,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });

  /* -------------------------------------------------------------- geometry */

  const bodyGeometry: Record<QualityCriterionKind, BufferGeometry> = {
    milestone: new TetrahedronGeometry(0.5, 0),
    'final-invariant': new OctahedronGeometry(0.8, 0),
    // Superseded criteria keep the small tetra silhouette, drawn as wireframe.
    superseded: new TetrahedronGeometry(0.4, 0),
  };
  const glyphGeometry: Record<QualityCriterionKind, BufferGeometry> = {
    milestone: new BoxGeometry(0.2, 0.2, 0.2),
    'final-invariant': new TorusGeometry(0.92, 0.04, 8, 40),
    superseded: new BoxGeometry(0.06, 0.06, 1.2),
  };

  /* --------------------------------------------------------------- records */

  const criteria: QualityCriterion[] = [];
  const slots: CriterionSlot[] = [];
  for (let index = 0; index < config.maxCriteria; index += 1) {
    const criterion: QualityCriterion = {
      id: '',
      label: '',
      kind: 'milestone',
      index: 0,
      value: 0,
      target: 1,
      weight: 0,
      satisfaction: 0,
      completed: false,
      supersededBy: null,
      anchor: new Vector3(),
      position: new Vector3(),
      active: false,
    };
    criteria.push(criterion);

    const group = new Group();
    group.visible = false;
    const body = new Mesh(bodyGeometry.milestone, bodyMaterials.milestone);
    const glyph = new Mesh(glyphGeometry.milestone, glyphMaterials.milestone);
    group.add(body, glyph);

    const linkPositions = new Float32Array(6);
    const linkGeometry = new BufferGeometry();
    const linkAttribute = new BufferAttribute(linkPositions, 3);
    linkAttribute.setUsage(DynamicDrawUsage);
    linkGeometry.setAttribute('position', linkAttribute);
    linkGeometry.boundingSphere = null;
    const link = new Line(linkGeometry, linkMaterial);
    link.frustumCulled = false;
    link.visible = false;

    criteriaLayer.add(group);
    linkLayer.add(link);
    slots.push({ group, body, glyph, link, linkPositions, criterionId: '' });
  }

  const metricPool: MutableMetricRecord[] = [];
  const activeMetrics: QualityCriterionSource[] = [];

  let count = 0;
  let completedFinalInvariants = 0;
  let supersededCount = 0;
  let apexY = 0;
  let disposed = false;
  let disposedResources: DisposedResources | null = null;

  /** Refresh the metric records from the state slice (no record allocation). */
  const refreshMetrics = (state: DeepReadonly<GameState>): void => {
    activeMetrics.length = 0;
    for (const metricId of state.quality.order) {
      const metric = state.quality.metrics[metricId];
      if (!metric) continue;
      const index = activeMetrics.length;
      let record = metricPool[index];
      if (!record) {
        record = { id: '', label: '', value: 0, target: 1, weight: 1 };
        metricPool[index] = record;
      }
      record.id = metric.id;
      record.label = metric.label;
      record.value = metric.value;
      record.target = metric.target;
      record.weight = metric.weight;
      activeMetrics.push(record);
    }
  };

  const update = (state: DeepReadonly<GameState>): void => {
    if (disposed) return;
    refreshMetrics(state);
    const elapsedMs = state.mission.elapsedMs;

    // Pass 1: refresh every pooled layout record for this state. Supersession
    // links need the whole constellation written before they can be drawn.
    let live = 0;
    for (let index = 0; index < criteria.length; index += 1) {
      const criterion = criteria[index];
      if (!criterion) continue;
      writeCriterionLayout(criterion, activeMetrics, index, layout);
      criterion.active = criterion.id !== '';
      if (criterion.active) live += 1;
    }
    count = live;

    // Pass 2: bind shapes, animate them and draw the replacement beams.
    let completedInvariants = 0;
    let superseded = 0;
    let apex = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < criteria.length; index += 1) {
      const criterion = criteria[index];
      const slot = slots[index];
      if (!criterion || !slot) continue;
      if (!criterion.active) {
        slot.group.visible = false;
        slot.link.visible = false;
        continue;
      }

      const kind = criterion.kind;
      if (slot.body.geometry !== bodyGeometry[kind]) slot.body.geometry = bodyGeometry[kind];
      if (slot.body.material !== bodyMaterials[kind]) slot.body.material = bodyMaterials[kind];
      if (slot.glyph.geometry !== glyphGeometry[kind]) slot.glyph.geometry = glyphGeometry[kind];
      if (slot.glyph.material !== glyphMaterials[kind]) slot.glyph.material = glyphMaterials[kind];

      if (slot.criterionId !== criterion.id) {
        slot.criterionId = criterion.id;
        slot.group.name = CRITERION_NAMES.node(criterion.id);
        slot.body.name = CRITERION_NAMES.body(criterion.id);
        slot.glyph.name = CRITERION_NAMES.glyph(criterion.id);
        slot.link.name = CRITERION_NAMES.link(criterion.id);
      }

      slot.group.visible = true;
      slot.group.position.copy(criterion.position);
      // Lifecycle reads through motion too: live criteria turn, history drifts.
      slot.body.rotation.y = elapsedMs / 2_600 + index * 0.7;
      slot.glyph.rotation.y = -elapsedMs / 1_800 + index;
      slot.body.scale.setScalar(0.9 + 0.1 * criterion.satisfaction);

      const replacementId = criterion.supersededBy;
      let replacement: QualityCriterion | undefined;
      if (replacementId !== null) {
        for (let candidate = 0; candidate < activeMetrics.length; candidate += 1) {
          if (activeMetrics[candidate]?.id === replacementId) {
            replacement = criteria[candidate];
            break;
          }
        }
      }
      if (replacement && replacement.id !== '') {
        slot.linkPositions[0] = criterion.position.x;
        slot.linkPositions[1] = criterion.position.y;
        slot.linkPositions[2] = criterion.position.z;
        slot.linkPositions[3] = replacement.position.x;
        slot.linkPositions[4] = replacement.position.y;
        slot.linkPositions[5] = replacement.position.z;
        const attribute = slot.link.geometry.getAttribute('position');
        if (attribute) attribute.needsUpdate = true;
        slot.link.visible = true;
      } else {
        slot.link.visible = false;
      }

      apex = Math.max(apex, criterion.position.y);
      if (kind === 'final-invariant' && criterion.completed) completedInvariants += 1;
      if (kind === 'superseded') superseded += 1;
    }

    completedFinalInvariants = completedInvariants;
    supersededCount = superseded;
    apexY = live > 0 ? apex : 0;
  };

  const findSlot = (id: string): CriterionSlot | undefined =>
    slots.find((slot) => slot.criterionId === id);

  return {
    root,
    criteria,
    get count() {
      return count;
    },
    get completedFinalInvariants() {
      return completedFinalInvariants;
    },
    get supersededCount() {
      return supersededCount;
    },
    get apexY() {
      return apexY;
    },
    capacity: config.maxCriteria,
    get disposed() {
      return disposed;
    },
    get disposedResources() {
      return disposedResources;
    },
    update,
    criterion(id: string): QualityCriterion | undefined {
      return criteria.find((entry) => entry.active && entry.id === id);
    },
    objectFor(id: string): Object3D | undefined {
      return findSlot(id)?.group;
    },
    bodyFor(id: string): Mesh | undefined {
      return findSlot(id)?.body;
    },
    glyphFor(id: string): Mesh | undefined {
      return findSlot(id)?.glyph;
    },
    linkFor(id: string): Line | undefined {
      const slot = findSlot(id);
      return slot && slot.link.visible ? slot.link : undefined;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const report = disposeRenderResources(root);
      disposedResources = report;
      for (const criterion of criteria) criterion.active = false;
      root.removeFromParent();
      root.clear();
      count = 0;
      apexY = 0;
      completedFinalInvariants = 0;
      supersededCount = 0;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* System factory                                                             */
/* -------------------------------------------------------------------------- */

export interface QualityGraphSystemOptions extends QualityGraphViewOptions {
  /** System id. Defaults to `render/quality-graph`. */
  id?: string;
}

/**
 * Compose the constellation as a game system: attach builds the scene subtree,
 * update feeds it the frozen snapshot, dispose releases every pooled resource.
 */
export function createQualityGraphSystem(options: QualityGraphSystemOptions = {}): GameSystem {
  let view: QualityGraphView | null = null;
  return {
    id: options.id ?? 'render/quality-graph',
    attach(context): void {
      view = createQualityGraph(context.scene, options);
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
