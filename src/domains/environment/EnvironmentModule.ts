/**
 * Environment scene module — the café's physical architecture.
 *
 * One module owns the whole room, exactly the way the frozen {@link SceneModule}
 * contract expects:
 *
 *  - `build(context)` raises the closed shell (floor, four walls, ceiling,
 *    wainscot, service-counter shell, back room doorway, storefront glazing,
 *    entrance door, street sliver, exterior signage bracket) as named nodes in a
 *    single `environment` group, dressed in the era's material set.
 *  - `applyPeriod(period, context)` moves every surface and every profile driven
 *    detail to the new era: material set, dado profile, ceiling structure,
 *    glazing mullion grid, window dressing, awning and signage blade. The
 *    envelope and the structural anchors never move, so navigation and prop
 *    placement stay valid across the whole timeline.
 *  - `update(delta, context)` animates the era's emissive signage.
 *  - `dispose()` releases every geometry, material and texture this module
 *    created and detaches the group, returning the kernel's node count to its
 *    pre-build baseline.
 *  - `getHotspots()` exposes the era's counter, storefront, back room and
 *    signage affordances for the overlay.
 *
 * Consumers that need the room (navigation, machines, tableware, posters,
 * signage, patrons) read {@link EnvironmentModule.bounds} — the exported
 * {@link RoomBounds} — and {@link EnvironmentModule.layout} — the structural
 * anchor and zone set.
 */

import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  type BuildContext,
  type Hotspot,
  type PeriodDefinition,
  type RoomBounds,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import {
  applyShellEra,
  assignShellMaterials,
  buildShell,
  disposeShell,
  shellEraSignature,
  shellNodeInventory,
  type ShellParts,
} from './architecture';
import {
  ENVIRONMENT_SPECS,
  describeEnvironmentSpec,
  environmentSpec,
  type EnvironmentSpec,
  type EnvironmentSpecSummary,
} from './data/years';
import {
  createMaterialSet,
  disposeMaterialSet,
  materialSetSignature,
  type MaterialSet,
} from './materials';
import {
  CAFE_ROOM_BOUNDS,
  SIGNAGE_MOUNT_HEIGHT,
  STRUCTURAL_LAYOUT,
  measureShellEnvelope,
  roomBoundsEqual,
  validateLayout,
  type ShellNodeKey,
  type StructuralLayout,
} from './roomBounds';
import { applyStorefrontEra, buildStorefront, storefrontEraSignature, type StorefrontParts } from './storefront';
import type { CanvasFactory } from './textures';

/** Stable module id: registry key, hotspot owner id and node namespace. */
export const ENVIRONMENT_MODULE_ID = 'environment';

export interface EnvironmentModuleOptions {
  /** Interior volume; defaults to {@link CAFE_ROOM_BOUNDS}. */
  readonly bounds?: RoomBounds;
  /** Structural anchor set; defaults to {@link STRUCTURAL_LAYOUT}. */
  readonly layout?: StructuralLayout;
  /** Canvas factory for the procedural finishes (defaults to the DOM canvas). */
  readonly canvasFactory?: CanvasFactory;
  /** Texture resolution override for every procedural finish. */
  readonly textureSize?: number;
  /** Era reported by `getHotspots` before the first build. */
  readonly initialYear?: YearId;
}

/** Era window dressing, as exposed for diagnostics and the HUD. */
export interface WindowDressingState {
  readonly id: string;
  readonly style: string;
  readonly kind: EnvironmentSpec['windowDressing']['kind'];
  readonly coverage: number;
  readonly awning: boolean;
}

/** Diagnostics snapshot of the module for one moment in the timeline. */
export interface EnvironmentModuleDescription {
  readonly moduleId: string;
  readonly year: YearId;
  readonly built: boolean;
  readonly paletteName: string | null;
  readonly materialSetId: string | null;
  readonly textureSource: MaterialSet['textureSource'] | 'none';
  readonly textureCount: number;
  readonly materialCount: number;
  readonly nodeCount: number;
  readonly layoutProblems: readonly string[];
  readonly shellSignature: string | null;
  readonly storefrontSignature: string | null;
  readonly summary: EnvironmentSpecSummary;
}

/**
 * The café environment: room shell, period finishes, storefront, exported room
 * bounds and the structural placement anchors.
 */
export class EnvironmentModule implements SceneModule<EnvironmentSpec> {
  readonly id = ENVIRONMENT_MODULE_ID;

  /** Interior volume navigation, prop placement and hotspots read. */
  readonly bounds: RoomBounds;

  /** Table slot grid, counter zone, pass slots, service lane, mounts and zones. */
  readonly layout: StructuralLayout;

  private readonly options: EnvironmentModuleOptions;
  private shell: ShellParts | null = null;
  private storefront: StorefrontParts | null = null;
  private materials: MaterialSet | null = null;
  private currentSpec: EnvironmentSpec | null = null;
  private phase = 0;
  private updates = 0;

  constructor(options: EnvironmentModuleOptions = {}) {
    this.options = options;
    this.bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
    this.layout = options.layout ?? STRUCTURAL_LAYOUT;

    if (!roomBoundsEqual(this.layout.bounds, this.bounds, 1e-6)) {
      throw new Error('The structural layout must describe the same room as `bounds`.');
    }
    const problems = validateLayout(this.layout);
    if (problems.length > 0) {
      throw new Error(`Invalid environment layout: ${problems.join('; ')}`);
    }
  }

  /* -- SceneModule surface -------------------------------------------------- */

  /** The single `environment` group, once built. */
  get root(): THREE.Object3D | undefined {
    return this.shell?.group;
  }

  /** Era data currently applied. */
  get spec(): EnvironmentSpec | undefined {
    return this.currentSpec ?? undefined;
  }

  build(context: BuildContext): void {
    this.dispose();

    const spec = environmentSpec(context.period.year);
    const materials = createMaterialSet(spec, {
      canvasFactory: this.options.canvasFactory,
      textureSize: this.options.textureSize,
    });
    const shell = buildShell({ bounds: this.bounds, layout: this.layout, spec, materials });
    const storefront = buildStorefront(shell, { spec, materials });
    assignShellMaterials(shell, materials);

    const inventory = shellNodeInventory(shell);
    if (!inventory) {
      disposeShell(shell);
      disposeMaterialSet(materials);
      throw new Error('The environment shell is incomplete: a required node is missing.');
    }

    context.root.add(shell.group);

    this.shell = shell;
    this.storefront = storefront;
    this.materials = materials;
    this.currentSpec = spec;
    this.phase = 0;
  }

  applyPeriod(period: PeriodDefinition, context: BuildContext): void {
    const spec = environmentSpec(period.year);
    if (!this.shell || !this.storefront || !this.materials) {
      this.build(context);
      return;
    }

    // Build the new set first and only release the old one once every mesh has
    // been re-pointed, so a frame can never reach a disposed material.
    const next = createMaterialSet(spec, {
      canvasFactory: this.options.canvasFactory,
      textureSize: this.options.textureSize,
    });
    applyStorefrontEra(this.storefront, this.shell, spec);
    applyShellEra(this.shell, spec, next);

    const previous = this.materials;
    this.materials = next;
    this.currentSpec = spec;
    disposeMaterialSet(previous);
  }

  update(deltaSeconds: number, _context: UpdateContext): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    this.phase = (this.phase + delta) % (Math.PI * 2);
    this.updates += 1;

    const spec = this.currentSpec;
    const materials = this.materials;
    if (!spec || !materials) return;

    // The illuminated fascias shimmer the way a real neon tube does; the
    // painted 1945 board never flickers.
    const signage = materials.slots.signage as THREE.MeshStandardMaterial;
    if (spec.signage.illuminated) {
      const flicker =
        1 + Math.sin(this.phase * 7.3) * 0.05 + Math.sin(this.phase * 2.17 + 1.1) * 0.03;
      signage.emissiveIntensity = spec.signage.lampIntensity * flicker;
    } else {
      signage.emissiveIntensity = 0.05;
    }
  }

  dispose(): void {
    if (this.shell) {
      disposeShell(this.shell);
      this.shell = null;
    }
    if (this.storefront) {
      this.storefront = null;
    }
    if (this.materials) {
      disposeMaterialSet(this.materials);
      this.materials = null;
    }
    this.currentSpec = null;
    this.phase = 0;
  }

  getHotspots(): readonly Hotspot[] {
    const spec = this.currentSpec ?? ENVIRONMENT_SPECS[this.options.initialYear ?? DEFAULT_YEAR_ID];
    const { layout } = this;
    const halfDepth = this.bounds.depth / 2;
    const firstBay = layout.glazingZones[0];
    const anchors = this.shell?.nodes;

    return [
      {
        id: 'environment-counter',
        label: `Service counter — ${spec.paletteName}`,
        description: `${spec.counter.shell}. ${spec.counter.backBar}.`,
        position: new THREE.Vector3(
          layout.counter.center.x,
          layout.counter.surfaceHeight,
          layout.counter.center.z,
        ),
        radius: Math.max(layout.counter.width, layout.counter.depth) / 2,
        year: spec.year,
        moduleId: this.id,
        kind: 'interactive',
        anchor: anchors?.counterShell,
      },
      {
        id: 'environment-storefront',
        label: `Storefront — ${spec.glazing.style}`,
        description: `${spec.windowDressing.style}${spec.windowDressing.awning ? ', under a fabric awning' : ''}.`,
        position: new THREE.Vector3(
          firstBay ? firstBay.position.x : 0,
          firstBay ? firstBay.sillHeight + firstBay.height / 2 : 1.6,
          halfDepth - 0.2,
        ),
        radius: 1.1,
        year: spec.year,
        moduleId: this.id,
        kind: 'info',
        anchor: anchors?.storefrontGlazing,
      },
      {
        id: 'environment-back-room',
        label: `Back room — ${spec.doorway.doorStyle}`,
        description: `Behind the ${spec.doorway.glazed ? 'glazed' : 'planked'} door: stock, prep and the staff kettle.`,
        position: new THREE.Vector3(layout.doorway.position.x, 1.05, -halfDepth + 0.25),
        radius: 0.85,
        year: spec.year,
        moduleId: this.id,
        kind: 'transition',
        anchor: anchors?.backRoomDoorway,
      },
      {
        id: 'environment-signage',
        label: `Signage — “${spec.signage.lettering}”`,
        description: `${spec.signage.blade}${spec.signage.illuminated ? ', lit' : ', unlit'}, mounted on the ${spec.signage.armStyle.replace(/-/g, ' ')}.`,
        position: new THREE.Vector3(0, SIGNAGE_MOUNT_HEIGHT, halfDepth + spec.signage.projection),
        radius: 0.9,
        year: spec.year,
        moduleId: this.id,
        kind: 'info',
        anchor: anchors?.signageBracket,
      },
    ];
  }

  /* -- Diagnostics and consumer accessors ---------------------------------- */

  /** True once the shell has been raised. */
  get built(): boolean {
    return this.shell !== null;
  }

  /** The era's material set (every material is named `env:<year>:<slot>`). */
  get materialSet(): MaterialSet | undefined {
    return this.materials ?? undefined;
  }

  /** Identifier of the active material set. */
  get materialSetId(): string | undefined {
    return this.materials?.id;
  }

  /** Name of the active era palette. */
  get paletteName(): string | undefined {
    return this.currentSpec?.paletteName;
  }

  /** Where the era's finishes came from. */
  get textureSource(): MaterialSet['textureSource'] | 'none' {
    return this.materials?.textureSource ?? 'none';
  }

  /** The era's window dressing, or `undefined` before the first build. */
  get windowDressing(): WindowDressingState | undefined {
    const dressing = this.currentSpec?.windowDressing;
    if (!dressing) return undefined;
    return {
      id: dressing.id,
      style: dressing.style,
      kind: dressing.kind,
      coverage: dressing.coverage,
      awning: dressing.awning,
    };
  }

  /** Named shell nodes, once built. */
  get nodes(): Readonly<Partial<Record<ShellNodeKey, THREE.Object3D>>> | undefined {
    return this.shell ? { ...this.shell.nodes } : undefined;
  }

  /** Number of scene-graph nodes under the environment group. */
  get nodeCount(): number {
    if (!this.shell) return 0;
    let count = 0;
    this.shell.group.traverse(() => {
      count += 1;
    });
    return count;
  }

  /** Number of times {@link SceneModule.update} has run. */
  get updateCount(): number {
    return this.updates;
  }

  /** Interior envelope measured back off the built shell geometry. */
  get measuredBounds(): RoomBounds | null {
    return this.shell ? measureShellEnvelope(this.shell.group) : null;
  }

  /** Structural fingerprint of the era's interior geometry. */
  get shellSignature(): string | null {
    return this.shell ? shellEraSignature(this.shell) : null;
  }

  /** Structural fingerprint of the era's storefront geometry. */
  get storefrontSignature(): string | null {
    return this.storefront ? storefrontEraSignature(this.storefront) : null;
  }

  /** Fingerprint of the era's material set (names and procedural maps). */
  get materialSignature(): string | null {
    return this.materials ? materialSetSignature(this.materials) : null;
  }

  /** Everything diagnostics (and the tests) need in one snapshot. */
  describe(): EnvironmentModuleDescription {
    const spec = this.currentSpec ?? ENVIRONMENT_SPECS[this.options.initialYear ?? DEFAULT_YEAR_ID];
    return Object.freeze({
      moduleId: this.id,
      year: spec.year,
      built: this.built,
      paletteName: this.currentSpec?.paletteName ?? null,
      materialSetId: this.materials?.id ?? null,
      textureSource: this.textureSource,
      textureCount: this.materials?.textures.length ?? 0,
      materialCount: this.materials ? Object.keys(this.materials.slots).length : 0,
      nodeCount: this.nodeCount,
      layoutProblems: validateLayout(this.layout),
      shellSignature: this.shellSignature,
      storefrontSignature: this.storefrontSignature,
      summary: describeEnvironmentSpec(spec),
    });
  }
}

/** Convenience factory mirroring `createKernel` / `createNavigationController`. */
export function createEnvironmentModule(options: EnvironmentModuleOptions = {}): EnvironmentModule {
  return new EnvironmentModule(options);
}

/** Per-year era specs, keyed by {@link YearId}. */
export { ENVIRONMENT_SPECS };

/** Looks up one era's environment spec. */
export { environmentSpec };

/** Room volume and structural anchor set re-exported for consumers. */
export { CAFE_ROOM_BOUNDS, STRUCTURAL_LAYOUT };
