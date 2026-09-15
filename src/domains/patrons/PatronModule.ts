/**
 * Patron scene module — the café's barista, seated regulars and standing crowd.
 *
 * This is intentionally the only orchestration point in `src/domains/patrons`:
 *
 *  - it reads the environment's structural layout and room bounds, then asks
 *    {@link planPatronPlacement} for a deterministic seating plan,
 *  - it builds procedural {@link FigureInstance}s from the selected era's
 *    blueprint map,
 *  - it advances each idle loop only from `update(delta, context)`,
 *  - it sends the era's density to the already-created audio engine through the
 *    narrow `setAmbienceIntensity` service method (safe while audio is locked),
 *  - it exposes three inspect anchors: barista, seated patron and gadget bearer.
 *
 * It does not create a room, synthesize audio, own a registry or install timers.
 * The composition owner supplies the environment and audio services in
 * `BuildContext.services` using `environmentModule`/`environment` and
 * `audioEngine`/`audio` respectively.
 */

import * as THREE from 'three';
import {
  createStructuralLayout,
  type StructuralLayout,
} from '../environment';
import {
  type BuildContext,
  type Hotspot,
  type PeriodDefinition,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import { disposeObject3D } from '../../core/kernel';
import {
  createFigureInstance,
  createFigureResources,
  type FigureInstance,
  type FigureTransform,
} from './figures/FigureRig';
import {
  createFigureMaterialLibrary,
  type FigureMaterialLibraryOptions,
} from './figures/Wardrobe';
import {
  gadgetChronologyConflicts,
  type GadgetId,
} from './figures/GadgetProps';
import {
  clampDensity,
  formatPlacementPlan,
  planPatronPlacement,
  placementConflicts,
  type PlacementPlan,
} from './placement/placement';
import {
  PATRON_SPEC_1945,
  PATRON_SPECS_1945,
  type PatronSpec,
} from './data/1945';
import { PATRON_SPEC_1965, PATRON_SPECS_1965 } from './data/1965';
import { PATRON_SPEC_1985, PATRON_SPECS_1985 } from './data/1985';
import { PATRON_SPEC_2005, PATRON_SPECS_2005 } from './data/2005';
import { PATRON_SPEC_2025, PATRON_SPECS_2025 } from './data/2025';

/** Stable registry key and node namespace. */
export const PATRON_MODULE_ID = 'patrons';

/** Per-year maps are exported individually for registry aggregation. */
export { PATRON_SPECS_1945, PATRON_SPECS_1965, PATRON_SPECS_1985, PATRON_SPECS_2005, PATRON_SPECS_2025 };

/** Complete patron spec map keyed by the frozen {@link YearId}. */
export const PATRON_SPECS: Readonly<Record<YearId, PatronSpec>> = Object.freeze({
  '1945': PATRON_SPEC_1945,
  '1965': PATRON_SPEC_1965,
  '1985': PATRON_SPEC_1985,
  '2005': PATRON_SPEC_2005,
  '2025': PATRON_SPEC_2025,
});

/** Looks up one era's patron spec. */
export function patronSpec(year: YearId): PatronSpec {
  return PATRON_SPECS[year];
}

/** Service shape intentionally narrower than the full audio engine contract. */
export interface PatronDensitySink {
  setAmbienceIntensity(value: number, seconds?: number): void;
}

export interface PatronModuleOptions extends FigureMaterialLibraryOptions {
  /** Seed used for all placement, variations and idle phases. */
  readonly seed?: number;
  /** Environment structural anchors; normally read from `services`. */
  readonly layout?: StructuralLayout;
  /** Era shown by `getHotspots` before the first build. */
  readonly initialYear?: YearId;
}

export interface PatronModuleDescription {
  readonly moduleId: typeof PATRON_MODULE_ID;
  readonly year: YearId;
  readonly built: boolean;
  readonly patronCount: number;
  readonly occupancy: number;
  readonly density: number;
  readonly seated: number;
  readonly standing: number;
  readonly skipped: readonly string[];
  readonly placementSignature: string;
  readonly figureIds: readonly string[];
  readonly gadgetIds: readonly GadgetId[];
  readonly resourceId: string | null;
  readonly materialCount: number;
  readonly textureCount: number;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function environmentLayout(context: BuildContext, options: PatronModuleOptions): StructuralLayout {
  if (options.layout) return options.layout;
  const services = context.services;
  for (const key of ['environmentModule', 'environment', 'environmentShell']) {
    const candidate = asObject(services?.[key]);
    const layout = candidate?.['layout'];
    if (layout && typeof layout === 'object') return layout as StructuralLayout;
  }
  // This is the environment domain's own derivation, not a competing geometry
  // constant. It also makes a patron-only headless harness useful in isolation.
  return createStructuralLayout(context.bounds);
}

function densitySink(context: BuildContext): PatronDensitySink | null {
  const services = context.services;
  for (const key of ['audioEngine', 'audio', 'cafeAudioEngine']) {
    const candidate = asObject(services?.[key]);
    if (candidate && typeof candidate['setAmbienceIntensity'] === 'function') {
      return candidate as unknown as PatronDensitySink;
    }
  }
  return null;
}

function placementSeed(context: BuildContext, options: PatronModuleOptions): number {
  if (options.seed !== undefined && Number.isFinite(options.seed)) return Math.trunc(options.seed);
  const sample = context.random();
  return Math.trunc(Math.max(0, Math.min(0.999999999, sample)) * 0xffffffff);
}

function figureGadgetIds(figures: readonly FigureInstance[]): readonly GadgetId[] {
  return Object.freeze(
    [...new Set(figures.flatMap((figure) => figure.blueprint.gadgets))],
  );
}

/**
 * The complete patron domain implementation of the frozen `SceneModule` API.
 */
export class PatronModule implements SceneModule<PatronSpec> {
  readonly id = PATRON_MODULE_ID;
  private readonly options: PatronModuleOptions;
  private rootValue: THREE.Group | null = null;
  private layoutValue: StructuralLayout | null = null;
  private resources: ReturnType<typeof createFigureResources> | null = null;
  private materials: ReturnType<typeof createFigureMaterialLibrary> | null = null;
  private figuresValue: FigureInstance[] = [];
  private planValue: PlacementPlan | null = null;
  private specValue: PatronSpec | undefined;
  private seedValue = 0;
  private disposedValue = false;

  constructor(options: PatronModuleOptions = {}) {
    this.options = options;
  }

  get root(): THREE.Object3D | undefined {
    return this.rootValue ?? undefined;
  }

  get spec(): PatronSpec | undefined {
    return this.specValue;
  }

  get bounds(): StructuralLayout['bounds'] | undefined {
    return this.layoutValue?.bounds;
  }

  /** Structural anchors consumed from environment-shell for diagnostics/tests. */
  get layout(): StructuralLayout | undefined {
    return this.layoutValue ?? undefined;
  }

  get figures(): readonly FigureInstance[] {
    return Object.freeze([...this.figuresValue]);
  }

  get placementPlan(): PlacementPlan | undefined {
    return this.planValue ?? undefined;
  }

  get patronCount(): number {
    return this.specValue?.patronCount ?? 0;
  }

  get density(): number {
    return this.specValue?.density ?? 0;
  }

  get occupancy(): number {
    return this.specValue?.occupancy ?? 0;
  }

  get disposed(): boolean {
    return this.disposedValue;
  }

  build(context: BuildContext): void {
    this.dispose();
    this.disposedValue = false;
    this.seedValue = placementSeed(context, this.options);
    this.layoutValue = environmentLayout(context, this.options);
    this.buildEra(context, patronSpec(context.year), context);
  }

  applyPeriod(period: PeriodDefinition, context: BuildContext): void {
    if (!this.rootValue || !this.layoutValue) {
      this.build(context);
      return;
    }
    // Rebuilding is deliberate: it guarantees that no old era prop, material or
    // idle driver remains alive while the timeline transitions.
    this.disposeObjects();
    this.disposedValue = false;
    this.layoutValue = environmentLayout(context, this.options);
    this.buildEra(context, patronSpec(period.year), context);
  }

  update(deltaSeconds: number, context: UpdateContext): void {
    if (this.disposedValue || !this.rootValue) return;
    if (this.specValue?.year !== context.year) return;
    for (const figure of this.figuresValue) figure.advance(deltaSeconds);
  }

  dispose(): void {
    this.disposeObjects();
    this.disposedValue = true;
    this.specValue = undefined;
    this.planValue = null;
    this.layoutValue = null;
  }

  getHotspots(): readonly Hotspot[] {
    const year = this.specValue?.year ?? this.options.initialYear ?? '1945';
    const result: Hotspot[] = [];
    const barista = this.figuresValue.find((figure) => figure.role === 'barista');
    const seated = this.figuresValue.find((figure) => figure.seated);
    const gadget = this.figuresValue.find((figure) => figure.props.length > 0);
    const add = (figure: FigureInstance | undefined, id: string, label: string, kind: 'interactive' | 'info'): void => {
      if (!figure) return;
      result.push({
        id,
        label,
        description: figure.blueprint.caption,
        position: new THREE.Vector3(figure.root.position.x, figure.root.position.y + figure.height * 0.55, figure.root.position.z),
        radius: Math.max(figure.footprintRadius * 2.2, 0.45),
        year,
        moduleId: this.id,
        kind,
        anchor: figure.root,
      });
    };
    add(barista, 'patron-barista', `Barista — ${year}`, 'interactive');
    add(seated, 'patron-seated', `Seated patron — ${year}`, 'info');
    add(gadget, 'patron-gadget', `Gadget-bearing patron — ${year}`, 'interactive');
    return Object.freeze(result);
  }

  describe(): PatronModuleDescription {
    const spec = this.specValue ?? patronSpec(this.options.initialYear ?? '1945');
    const gadgetIds = figureGadgetIds(this.figuresValue);
    return Object.freeze({
      moduleId: this.id,
      year: spec.year,
      built: this.rootValue !== null,
      patronCount: spec.patronCount,
      occupancy: spec.occupancy,
      density: spec.density,
      seated: this.planValue?.seated ?? 0,
      standing: this.planValue?.standing ?? 0,
      skipped: this.planValue?.skipped ?? [],
      placementSignature: this.planValue ? formatPlacementPlan(this.planValue) : '',
      figureIds: Object.freeze(this.figuresValue.map((figure) => figure.id)),
      gadgetIds,
      resourceId: this.resources?.id ?? null,
      materialCount: this.materials?.materialCount ?? 0,
      textureCount: this.materials?.textureCount ?? 0,
    });
  }

  /** Placement diagnostics, useful to registries and headless integration tests. */
  placementConflicts(): readonly string[] {
    return this.planValue && this.layoutValue
      ? placementConflicts(this.planValue, this.layoutValue)
      : Object.freeze([]);
  }

  /** Stable transform values after the last update. */
  transforms(): readonly FigureTransform[] {
    return Object.freeze(this.figuresValue.map((figure) => figure.transform()));
  }

  private buildEra(context: BuildContext, spec: PatronSpec, buildContext: BuildContext): void {
    const layout = this.layoutValue;
    if (!layout) throw new Error('Patron layout is unavailable.');
    const root = new THREE.Group();
    root.name = `patrons:${spec.year}`;
    const resources = createFigureResources(`patron-primitives:${spec.year}`);
    const materials = createFigureMaterialLibrary(spec.year, spec.palette, {
      canvasFactory: this.options.canvasFactory,
      textureSize: this.options.textureSize,
    });
    const plan = planPatronPlacement({ layout, figures: spec.figures, seed: this.seedValue });
    const byId = new Map(spec.figures.map((figure) => [figure.id, figure]));
    const figures: FigureInstance[] = [];
    try {
      for (const placed of plan.placed) {
        const blueprint = byId.get(placed.figureId);
        if (!blueprint) continue;
        const figure = createFigureInstance({
          blueprint: { ...blueprint, stature: placed.variation.stature * blueprint.stature },
          year: spec.year,
          placed,
          resources,
          materials,
          surfaceHeight: placed.surfaceHeight,
        });
        root.add(figure.root);
        figures.push(figure);
      }
      const conflicts = placementConflicts(plan, layout);
      if (conflicts.length > 0) throw new Error(`Patron placement invalid: ${conflicts.join('; ')}`);
    } catch (error) {
      disposeObject3D(root);
      materials.dispose();
      resources.dispose();
      throw error;
    }

    this.rootValue = root;
    this.resources = resources;
    this.materials = materials;
    this.figuresValue = figures;
    this.planValue = plan;
    this.specValue = spec;
    this.disposedValue = false;
    buildContext.root.add(root);

    const conflicts = figures.flatMap((figure) => gadgetChronologyConflicts(spec.year, figure.blueprint.gadgets));
    if (conflicts.length > 0) throw new Error(`Anachronistic patron gadget: ${conflicts.join('; ')}`);
    densitySink(context)?.setAmbienceIntensity(clampDensity(spec.density), 0.35);
  }

  private disposeObjects(): void {
    if (this.rootValue) {
      disposeObject3D(this.rootValue);
      this.rootValue = null;
    }
    if (this.materials) {
      this.materials.dispose();
      this.materials = null;
    }
    if (this.resources) {
      this.resources.dispose();
      this.resources = null;
    }
    this.figuresValue = [];
  }
}

/** Convenience factory used by period-registry and composition. */
export function createPatronModule(options: PatronModuleOptions = {}): PatronModule {
  return new PatronModule(options);
}

/** Stable density map for audio and HUD consumers. */
export const PATRON_DENSITY: Readonly<Record<YearId, number>> = Object.freeze({
  '1945': PATRON_SPEC_1945.density,
  '1965': PATRON_SPEC_1965.density,
  '1985': PATRON_SPEC_1985.density,
  '2005': PATRON_SPEC_2005.density,
  '2025': PATRON_SPEC_2025.density,
});
