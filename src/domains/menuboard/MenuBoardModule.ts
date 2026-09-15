/**
 * Menu board scene module — the café's board, its typography and its prices.
 *
 * One module owns the board across the whole timeline, exactly the way the
 * frozen {@link SceneModule} contract expects:
 *
 *  - `build(context)` derives the era's board form, hangs it on the environment
 *    shell's designated menu mount, lays the menu out procedurally (lettering,
 *    columns, promo band, wear), paints the face and glow maps into procedural
 *    textures, assembles the carcass members and panel meshes, and attaches the
 *    whole thing as a single `menuboard` group under the composition root.
 *  - `applyPeriod(period, context)` swaps the board to the new era: the next
 *    board is built and attached first, then the previous group is detached and
 *    its geometries, materials and textures are released, so a frame can never
 *    reach a disposed resource.
 *  - `update(delta, context)` runs the era's small life: fluorescent flicker on
 *    the 1985 light box, backlight breathing on the 2005 acrylic, and the 2025
 *    screen rotating through its menu panels on the era's own timings.
 *  - `dispose()` releases every geometry, material and texture this module
 *    created and detaches the group, leaving nothing retained. Safe twice.
 *  - `getHotspots()` exposes the board plus one affordance per menu panel, with
 *    `Object3D` anchors owned by this module, and {@link MenuBoardModule.focus}
 *    gives the exact framing the navigation controller should use to inspect a
 *    panel up close.
 *
 * The module is cosmetic and data-driven: it renders menu content and prices and
 * never touches the till, the register display or any POS state.
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
import { CAFE_ROOM_BOUNDS, STRUCTURAL_LAYOUT } from '../environment/EnvironmentModule';
import type { StructuralLayout } from '../environment/roomBounds';
import {
  boardFocusDistance,
  boardFormForSpec,
  boardFormNotes,
  boardGeometrySignature,
  boardMembers,
  boardPanelRegions,
  boardPlacement,
  boardPlacementProblems,
  resolveBoardAnchor,
} from './boardGeometry';
import { MENU_BOARD_SPECS, describeMenuBoardSpec, menuBoardSpec } from './data/index';
import {
  createMenuBoardTexture,
  defaultCanvasFactory,
  disposeBoardTexture,
  layoutMenuBoard,
  MENU_BOARD_TEXTURE_HEIGHT,
  type BoardLayout,
  type BoardTexture,
  type CanvasFactory,
} from './lettering';
import type {
  BoardForm,
  BoardMaterialRole,
  BoardMember,
  BoardPlacement,
  MenuBoardSpec,
  MenuBoardSpecSummary,
  PanelRegion,
} from './types';

/** Stable module id: registry key, hotspot owner id and node namespace. */
export const MENU_BOARD_MODULE_ID = 'menuboard';

/** Name of the single group every board node is parented to. */
export const MENU_BOARD_GROUP_NAME = 'menuboard';

/** Canonical names of the board nodes. */
export const MENU_BOARD_NODE_NAMES = Object.freeze({
  root: 'menuboard',
  board: 'menuboard-board',
  face: 'menuboard-face',
  glow: 'menuboard-glow',
  members: 'menuboard-members',
  panels: 'menuboard-panels',
});

/** Node name of one menu panel. */
export function menuBoardPanelNodeName(panelId: string): string {
  return `menuboard-panel:${panelId}`;
}

export interface MenuBoardModuleOptions {
  /** Interior volume; defaults to {@link CAFE_ROOM_BOUNDS}. */
  readonly bounds?: RoomBounds;
  /** Structural anchor set; defaults to {@link STRUCTURAL_LAYOUT}. */
  readonly layout?: StructuralLayout;
  /** Canvas factory for the procedural maps (defaults to the DOM canvas). */
  readonly canvasFactory?: CanvasFactory;
  /** Texture height override; defaults to {@link MENU_BOARD_TEXTURE_HEIGHT}. */
  readonly textureHeight?: number;
  /** Layout seed override; defaults to the deterministic era seed. */
  readonly seed?: number;
  /** Era reported by `getHotspots` before the first build. */
  readonly initialYear?: YearId;
}

/** How much of a board resource set is still retained, and what was made. */
export interface MenuBoardResourceReport {
  readonly retainedGeometries: number;
  readonly retainedMaterials: number;
  readonly retainedTextures: number;
  readonly createdGeometries: number;
  readonly createdMaterials: number;
  readonly createdTextures: number;
  readonly disposedGeometries: number;
  readonly disposedMaterials: number;
  readonly disposedTextures: number;
  readonly nodes: number;
  readonly panels: number;
  readonly members: number;
}

/** Diagnostics snapshot of the module for one moment in the timeline. */
export interface MenuBoardModuleDescription {
  readonly moduleId: string;
  readonly year: YearId;
  readonly built: boolean;
  readonly boardKind: MenuBoardSpec['boardKind'];
  readonly boardName: string;
  readonly boardNotes: string;
  readonly lettering: MenuBoardSpec['lettering'];
  readonly currency: MenuBoardSpec['currency'];
  readonly heading: string;
  readonly itemCount: number;
  readonly itemIds: readonly string[];
  readonly sectionCount: number;
  readonly panelCount: number;
  readonly panelTitles: readonly string[];
  readonly rotating: boolean;
  readonly activePanelIndex: number;
  /** True when the era's board lights itself (1985 letter board onwards). */
  readonly lit: boolean;
  /** Emissive strength currently applied to the board face. */
  readonly faceEmissiveIntensity: number;
  /** Opacity of the additive glow layer in front of the face. */
  readonly glowOpacity: number;
  readonly benchmarkPrice: string;
  readonly benchmarkPence: number;
  readonly mountId: string | null;
  readonly anchorSource: BoardPlacement['source'] | 'none';
  readonly wall: BoardPlacement['wall'] | 'none';
  readonly geometrySignature: string | null;
  readonly layoutSignature: string | null;
  readonly placementSignature: string | null;
  readonly placementProblems: readonly string[];
  readonly textureCount: number;
  readonly materialCount: number;
  readonly geometryCount: number;
  readonly nodeCount: number;
  readonly resources: MenuBoardResourceReport;
  readonly summary: MenuBoardSpecSummary;
}

/** How the navigation controller should frame the board for close inspection. */
export interface MenuBoardFocus {
  readonly moduleId: string;
  readonly year: YearId;
  readonly label: string;
  readonly panelId: string | null;
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly distance: number;
}

interface RotationSegment {
  readonly regionIndex: number;
  readonly start: number;
  readonly end: number;
}

/** One built board, with everything needed to release it again. */
interface BoardParts {
  readonly group: THREE.Group;
  readonly boardGroup: THREE.Group;
  readonly membersGroup: THREE.Group;
  readonly panelsGroup: THREE.Group;
  readonly faceMesh: THREE.Mesh;
  readonly glowMesh: THREE.Mesh;
  readonly panelMeshes: readonly THREE.Mesh[];
  readonly memberMeshes: readonly THREE.Mesh[];
  readonly textures: readonly BoardTexture[];
  readonly materials: readonly THREE.Material[];
  readonly geometries: readonly THREE.BufferGeometry[];
  readonly placement: BoardPlacement;
  readonly layout: BoardLayout;
  readonly form: BoardForm;
  readonly members: readonly BoardMember[];
  readonly regions: readonly PanelRegion[];
  readonly schedule: readonly RotationSegment[];
  readonly cycleSeconds: number;
  readonly mountId: string | null;
}

function placementSignature(placement: BoardPlacement): string {
  const round = (value: number): string => value.toFixed(3);
  return [
    placement.anchorId,
    placement.wall,
    round(placement.position.x),
    round(placement.position.y),
    round(placement.position.z),
    round(placement.rotationY),
    round(placement.tilt),
    round(placement.width),
    round(placement.height),
    round(placement.depth),
  ].join('|');
}

/**
 * The café menu board: five era forms, five menus, one module.
 */
export class MenuBoardModule implements SceneModule<MenuBoardSpec> {
  readonly id = MENU_BOARD_MODULE_ID;

  /** Interior volume the board is hung inside. */
  readonly bounds: RoomBounds;

  /** Structural anchor set the board is placed from. */
  readonly layout: StructuralLayout;

  private readonly options: MenuBoardModuleOptions;
  private parts: BoardParts | null = null;
  private currentSpec: MenuBoardSpec | null = null;
  private phase = 0;
  private updates = 0;
  private activeRegionIndex = -1;
  private createdGeometries = 0;
  private createdMaterials = 0;
  private createdTextures = 0;
  private disposedGeometries = 0;
  private disposedMaterials = 0;
  private disposedTextures = 0;

  constructor(options: MenuBoardModuleOptions = {}) {
    this.options = options;
    this.bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
    this.layout = options.layout ?? STRUCTURAL_LAYOUT;
  }

  /* -- SceneModule surface -------------------------------------------------- */

  /** The single `menuboard` group, once built. */
  get root(): THREE.Object3D | undefined {
    return this.parts?.group;
  }

  /** Era data currently shown. */
  get spec(): MenuBoardSpec | undefined {
    return this.currentSpec ?? undefined;
  }

  build(context: BuildContext): void {
    this.dispose();
    const spec = menuBoardSpec(context.year);
    const parts = this.createParts(spec);
    context.root.add(parts.group);
    this.parts = parts;
    this.currentSpec = spec;
    this.phase = 0;
    this.updates = 0;
    this.activeRegionIndex = parts.schedule.length > 0 ? parts.schedule[0]?.regionIndex ?? -1 : -1;
  }

  applyPeriod(period: PeriodDefinition, context: BuildContext): void {
    if (!this.parts) {
      this.build(context);
      return;
    }
    const spec = menuBoardSpec(period.year);
    // Build the next board first: a frame never sees a released material.
    const next = this.createParts(spec);
    context.root.add(next.group);
    const previous = this.parts;
    this.parts = next;
    this.currentSpec = spec;
    this.phase = 0;
    this.activeRegionIndex = next.schedule.length > 0 ? next.schedule[0]?.regionIndex ?? -1 : -1;
    this.release(previous);
  }

  update(deltaSeconds: number, context: UpdateContext): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    this.phase = (this.phase + delta) % 1_000_000;
    this.updates += 1;

    const parts = this.parts;
    const spec = this.currentSpec;
    if (!parts || !spec) return;

    const flicker = 1 + Math.sin(this.phase * 8.3) * 0.06 + Math.sin(this.phase * 2.7 + 0.7) * 0.03;
    const faceMaterial = parts.faceMesh.material as THREE.MeshStandardMaterial;

    switch (spec.boardKind) {
      case 'fluorescent-letterboard': {
        // A tired fluorescent tube behind the felt: the letters pulse unevenly.
        faceMaterial.emissiveIntensity = 0.9 * flicker;
        break;
      }
      case 'backlit-acrylic': {
        // Even backlighting, breathing very slightly as the diffuser warms.
        faceMaterial.emissiveIntensity = 0.72 + Math.sin(this.phase * 1.6) * 0.04;
        break;
      }
      case 'digital-screen': {
        faceMaterial.emissiveIntensity = 0.78;
        break;
      }
      case 'chalk-slate':
      case 'painted-vinyl':
      default: {
        faceMaterial.emissiveIntensity = 0.06;
        break;
      }
    }

    if (parts.schedule.length === 0) {
      if (spec.boardKind === 'backlit-acrylic') {
        parts.panelMeshes.forEach((mesh, index) => {
          const material = mesh.material as THREE.MeshStandardMaterial;
          material.emissiveIntensity = 0.9 + Math.sin(this.phase * 1.6 + index * 0.4) * 0.08;
        });
      }
      return;
    }

    // The screen rotates through its panels, each for its own number of seconds.
    const elapsed = parts.cycleSeconds > 0 ? this.phase % parts.cycleSeconds : 0;
    const active = parts.schedule.find((segment) => elapsed >= segment.start && elapsed < segment.end);
    this.activeRegionIndex = active ? active.regionIndex : -1;
    parts.panelMeshes.forEach((mesh, index) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const isActive = index === this.activeRegionIndex;
      const target = isActive ? 1.9 : 0.42;
      const current = Number.isFinite(material.emissiveIntensity) ? material.emissiveIntensity : target;
      material.emissiveIntensity = current + (target - current) * Math.min(delta * 3, 1);
    });
  }

  dispose(): void {
    const parts = this.parts;
    this.parts = null;
    this.currentSpec = null;
    this.phase = 0;
    this.activeRegionIndex = -1;
    if (parts) this.release(parts);
  }

  getHotspots(): readonly Hotspot[] {
    const parts = this.parts;
    const spec = this.currentSpec;
    if (!parts || !spec) return [];
    parts.group.updateMatrixWorld(true);
    const caster = ` — ${spec.boardName}`;
    const hotspots: Hotspot[] = [
      {
        id: `${MENU_BOARD_MODULE_ID}:board`,
        label: `${spec.heading}${caster}`,
        description: `${spec.items.length} lines chalked, painted or set for ${spec.year}. ${spec.boardNote}.`,
        position: new THREE.Vector3(
          parts.placement.position.x,
          parts.placement.position.y,
          parts.placement.position.z,
        ),
        radius: Math.max(parts.placement.width, parts.placement.height) / 2,
        year: spec.year,
        moduleId: this.id,
        kind: 'interactive',
        anchor: parts.boardGroup,
      },
    ];

    parts.regions.forEach((region, index) => {
      const mesh = parts.panelMeshes[index];
      const local = new THREE.Vector3(
        ((region.rect.x + region.rect.width / 2) / parts.layout.aspect - 0.5) * parts.placement.width,
        (region.rect.y + region.rect.height / 2 - 0.5) * parts.placement.height,
        parts.placement.depth / 2,
      );
      const world = parts.boardGroup.localToWorld(local.clone());
      const items = region.itemIds
        .map((itemId) => spec.items.find((item) => item.id === itemId))
        .filter((item): item is MenuBoardSpec['items'][number] => item !== undefined);
      const priceList = items
        .slice(0, 3)
        .map((item) => `${item.name} ${item.price.display}${item.substitute ? ` or ${item.substitute.price.display}` : ''}`)
        .join(' · ');
      hotspots.push({
        id: `${MENU_BOARD_MODULE_ID}:${region.panelId}`,
        label: `${region.title || spec.boardName} — ${spec.year}`,
        description: `${priceList}${items.length > 3 ? ` and ${items.length - 3} more` : ''}.`,
        position: world,
        radius: Math.max(region.rect.width * parts.placement.width, region.rect.height * parts.placement.height) / 2,
        year: spec.year,
        moduleId: this.id,
        kind: 'info',
        ...(mesh ? { anchor: mesh } : {}),
      });
    });
    return Object.freeze(hotspots);
  }

  /* -- Diagnostics and consumer accessors ---------------------------------- */

  /** True once a board has been hung. */
  get built(): boolean {
    return this.parts !== null;
  }

  /** The era's board form, once built. */
  get form(): BoardForm | undefined {
    return this.parts?.form;
  }

  /** Where the board hangs, once built. */
  get placement(): BoardPlacement | undefined {
    return this.parts?.placement;
  }

  /** The procedural layout the visible board was painted from. */
  get boardLayout(): BoardLayout | undefined {
    return this.parts?.layout;
  }

  /** Addressable menu panels of the visible board (excludes header and footer). */
  get panels(): readonly PanelRegion[] {
    return this.parts?.regions ?? [];
  }

  /** Carcass members of the visible board. */
  get members(): readonly BoardMember[] {
    return this.parts?.members ?? [];
  }

  /** Anchor the board was hung on (`null` before the first build). */
  get mountId(): string | null {
    return this.parts?.mountId ?? null;
  }

  /** Index of the rotating panel currently up, or `-1` when nothing rotates. */
  get activePanelIndex(): number {
    return this.activeRegionIndex;
  }

  /** Length of the rotation cycle in seconds (`0` when nothing rotates). */
  get cycleSeconds(): number {
    return this.parts?.cycleSeconds ?? 0;
  }

  /** Number of times {@link SceneModule.update} has run. */
  get updateCount(): number {
    return this.updates;
  }

  /** Number of scene-graph nodes under the board group. */
  get nodeCount(): number {
    const parts = this.parts;
    if (!parts) return 0;
    let count = 0;
    parts.group.traverse(() => {
      count += 1;
    });
    return count;
  }

  /** Which backend painted the era's maps. */
  get textureSource(): BoardTexture['source'] | 'none' {
    return this.parts?.textures[0]?.source ?? 'none';
  }

  /** What the module created and what it still holds. */
  resourceReport(): MenuBoardResourceReport {
    const parts = this.parts;
    return Object.freeze({
      retainedGeometries: parts?.geometries.length ?? 0,
      retainedMaterials: parts?.materials.length ?? 0,
      retainedTextures: parts?.textures.length ?? 0,
      createdGeometries: this.createdGeometries,
      createdMaterials: this.createdMaterials,
      createdTextures: this.createdTextures,
      disposedGeometries: this.disposedGeometries,
      disposedMaterials: this.disposedMaterials,
      disposedTextures: this.disposedTextures,
      nodes: this.nodeCount,
      panels: parts?.panelMeshes.length ?? 0,
      members: parts?.memberMeshes.length ?? 0,
    });
  }

  /** Everything diagnostics (and the tests) need in one snapshot. */
  describe(): MenuBoardModuleDescription {
    const spec = this.currentSpec ?? menuBoardSpec(this.options.initialYear ?? DEFAULT_YEAR_ID);
    const parts = this.parts;
    const placement = parts?.placement;
    const regions = parts?.regions ?? [];
    // From 1985 on the board lights itself; chalk and paint do not.
    const lit = parts
      ? parts.form.emissive
      : spec.boardKind !== 'chalk-slate' && spec.boardKind !== 'painted-vinyl';
    return Object.freeze({
      moduleId: this.id,
      year: spec.year,
      built: this.built,
      boardKind: spec.boardKind,
      boardName: spec.boardName,
      boardNotes: boardFormNotes(spec.boardKind),
      lettering: spec.lettering,
      currency: spec.currency,
      heading: spec.heading,
      itemCount: spec.items.length,
      itemIds: Object.freeze(spec.items.map((item) => item.id)),
      sectionCount: spec.sections.length,
      panelCount: regions.length,
      panelTitles: Object.freeze(regions.map((region) => region.title)),
      rotating: (parts?.schedule.length ?? 0) > 0,
      activePanelIndex: this.activeRegionIndex,
      lit,
      faceEmissiveIntensity: parts
        ? (parts.faceMesh.material as THREE.MeshStandardMaterial).emissiveIntensity
        : 0,
      glowOpacity: parts ? (parts.glowMesh.material as THREE.MeshBasicMaterial).opacity : 0,
      benchmarkPrice: describeMenuBoardSpec(spec).benchmarkPrice,
      benchmarkPence: describeMenuBoardSpec(spec).benchmarkPence,
      mountId: parts?.mountId ?? null,
      anchorSource: placement?.source ?? 'none',
      wall: placement?.wall ?? 'none',
      geometrySignature: parts ? boardGeometrySignature(parts.form) : null,
      layoutSignature: parts?.layout.signature ?? null,
      placementSignature: placement ? placementSignature(placement) : null,
      placementProblems: placement
        ? boardPlacementProblems(placement, this.layout, this.bounds)
        : Object.freeze([]),
      textureCount: parts?.textures.length ?? 0,
      materialCount: parts?.materials.length ?? 0,
      geometryCount: parts?.geometries.length ?? 0,
      nodeCount: this.nodeCount,
      resources: this.resourceReport(),
      summary: describeMenuBoardSpec(spec),
    });
  }

  /**
   * Framing for close inspection, mirroring the posters module's focus helper:
   * the camera sits `distance` metres off the face, looking straight at the
   * panel centre, and the board's own inward normal decides the side.
   */
  focus(panelId?: string): MenuBoardFocus | null {
    const parts = this.parts;
    const spec = this.currentSpec;
    if (!parts || !spec) return null;
    const region = panelId
      ? parts.regions.find((entry) => entry.panelId === panelId)
      : parts.regions[0];
    parts.group.updateMatrixWorld(true);
    const target = new THREE.Vector3(
      parts.placement.position.x,
      parts.placement.position.y,
      parts.placement.position.z,
    );
    if (region) {
      const local = new THREE.Vector3(
        ((region.rect.x + region.rect.width / 2) / parts.layout.aspect - 0.5) * parts.placement.width,
        (region.rect.y + region.rect.height / 2 - 0.5) * parts.placement.height,
        0,
      );
      target.copy(parts.boardGroup.localToWorld(local));
    }
    const distance = boardFocusDistance(parts.placement);
    const position = new THREE.Vector3(
      target.x + parts.placement.normal.x * distance,
      target.y + parts.placement.normal.y * distance + 0.08,
      target.z + parts.placement.normal.z * distance,
    );
    return Object.freeze({
      moduleId: this.id,
      year: spec.year,
      label: region ? `${region.title || spec.boardName}` : spec.boardName,
      panelId: region ? region.panelId : null,
      position,
      target,
      distance,
    });
  }

  /* -- Assembly ------------------------------------------------------------- */

  private createParts(spec: MenuBoardSpec): BoardParts {
    const form = boardFormForSpec(spec);
    const anchor = resolveBoardAnchor(this.layout, form);
    const placement = boardPlacement(anchor, form);
    const layout = layoutMenuBoard(spec, placement.form, {
      ...(this.options.seed !== undefined ? { seed: this.options.seed } : {}),
    });
    const members = boardMembers(placement.form);
    const regions = boardPanelRegions(layout);

    const faceTexture = createMenuBoardTexture({
      layout,
      surface: spec.surface,
      form: placement.form,
      layer: 'face',
      key: `face:${spec.year}`,
      ...(this.options.textureHeight !== undefined ? { height: this.options.textureHeight } : {}),
      ...(this.options.canvasFactory !== undefined ? { canvasFactory: this.options.canvasFactory } : {}),
    });
    const glowTexture = createMenuBoardTexture({
      layout,
      surface: spec.surface,
      form: placement.form,
      layer: 'glow',
      key: `glow:${spec.year}`,
      ...(this.options.textureHeight !== undefined ? { height: this.options.textureHeight } : {}),
      ...(this.options.canvasFactory !== undefined ? { canvasFactory: this.options.canvasFactory } : {}),
    });
    this.createdTextures += 2;

    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];

    const faceMaterial = new THREE.MeshStandardMaterial({
      name: `menu:${spec.year}:face`,
      map: faceTexture.texture,
      emissiveMap: glowTexture.texture,
      emissive: new THREE.Color(spec.surface.glow),
      emissiveIntensity: placement.form.emissive ? 0.8 : 0.06,
      roughness: spec.surface.roughness,
      metalness: spec.surface.metalness,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      name: `menu:${spec.year}:glow`,
      map: glowTexture.texture,
      transparent: true,
      opacity: placement.form.emissive ? 0.9 : 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    materials.push(faceMaterial, glowMaterial);
    this.createdMaterials += 2;

    const group = new THREE.Group();
    group.name = MENU_BOARD_NODE_NAMES.root;
    group.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
    group.rotation.y = anchor.rotationY;

    const boardGroup = new THREE.Group();
    boardGroup.name = MENU_BOARD_NODE_NAMES.board;
    boardGroup.position.set(0, 0, placement.form.depth / 2);
    boardGroup.rotation.x = placement.form.tilt;
    group.add(boardGroup);

    const faceGeometry = new THREE.PlaneGeometry(placement.width, placement.height);
    const faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
    faceMesh.name = MENU_BOARD_NODE_NAMES.face;
    faceMesh.position.set(0, 0, placement.depth / 2 - 0.003);
    geometries.push(faceGeometry);
    this.createdGeometries += 1;
    boardGroup.add(faceMesh);

    const glowGeometry = new THREE.PlaneGeometry(placement.width, placement.height);
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    glowMesh.name = MENU_BOARD_NODE_NAMES.glow;
    glowMesh.position.set(0, 0, placement.depth / 2 - 0.0005);
    geometries.push(glowGeometry);
    this.createdGeometries += 1;
    boardGroup.add(glowMesh);

    const memberMaterials = new Map<BoardMaterialRole, THREE.Material>();
    const materialForRole = (role: BoardMaterialRole): THREE.Material => {
      const existing = memberMaterials.get(role);
      if (existing) return existing;
      const created = this.createMemberMaterial(spec, role);
      memberMaterials.set(role, created);
      materials.push(created);
      this.createdMaterials += 1;
      return created;
    };

    const membersGroup = new THREE.Group();
    membersGroup.name = MENU_BOARD_NODE_NAMES.members;
    const memberMeshes: THREE.Mesh[] = [];
    for (const entry of members) {
      const width = (entry.rect.width / layout.aspect) * placement.width;
      const height = entry.rect.height * placement.height;
      const geometry = new THREE.BoxGeometry(
        Math.max(width, 0.004),
        Math.max(height, 0.004),
        Math.max(entry.depth, 0.003),
      );
      const mesh = new THREE.Mesh(geometry, materialForRole(entry.material));
      mesh.name = `menuboard-member:${entry.id}`;
      mesh.position.set(
        ((entry.rect.x + entry.rect.width / 2) / layout.aspect - 0.5) * placement.width,
        (entry.rect.y + entry.rect.height / 2 - 0.5) * placement.height,
        entry.offset - placement.depth / 2,
      );
      geometries.push(geometry);
      this.createdGeometries += 1;
      membersGroup.add(mesh);
      memberMeshes.push(mesh);
    }
    boardGroup.add(membersGroup);

    const panelsGroup = new THREE.Group();
    panelsGroup.name = MENU_BOARD_NODE_NAMES.panels;
    const panelMeshes: THREE.Mesh[] = [];
    regions.forEach((region, index) => {
      const width = (region.rect.width / layout.aspect) * placement.width;
      const height = region.rect.height * placement.height;
      const geometry = new THREE.PlaneGeometry(Math.max(width, 0.01), Math.max(height, 0.01));
      applyPanelUvs(geometry, region.rect, layout.aspect);
      const material = new THREE.MeshStandardMaterial({
        name: `menu:${spec.year}:panel-${region.panelId}`,
        map: faceTexture.texture,
        emissiveMap: glowTexture.texture,
        emissive: new THREE.Color(spec.surface.glow),
        emissiveIntensity: placement.form.emissive ? (index === 0 ? 1.4 : 0.5) : 0.05,
        roughness: Math.max(spec.surface.roughness * 0.8, 0.18),
        metalness: spec.surface.metalness,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = menuBoardPanelNodeName(region.panelId);
      mesh.position.set(
        ((region.rect.x + region.rect.width / 2) / layout.aspect - 0.5) * placement.width,
        (region.rect.y + region.rect.height / 2 - 0.5) * placement.height,
        placement.depth / 2 - 0.0015,
      );
      geometries.push(geometry);
      this.createdGeometries += 1;
      materials.push(material);
      this.createdMaterials += 1;
      panelsGroup.add(mesh);
      panelMeshes.push(mesh);
    });
    boardGroup.add(panelsGroup);

    const rotating = regions.filter((region) => region.rotationSeconds > 0);
    const schedule: RotationSegment[] = [];
    let cursor = 0;
    for (const region of rotating) {
      schedule.push({
        regionIndex: regions.indexOf(region),
        start: cursor,
        end: cursor + region.rotationSeconds,
      });
      cursor += region.rotationSeconds;
    }

    return {
      group,
      boardGroup,
      membersGroup,
      panelsGroup,
      faceMesh,
      glowMesh,
      panelMeshes,
      memberMeshes,
      textures: Object.freeze([faceTexture, glowTexture]),
      materials: Object.freeze(materials),
      geometries: Object.freeze(geometries),
      placement,
      layout,
      form: placement.form,
      members,
      regions,
      schedule: Object.freeze(schedule),
      cycleSeconds: cursor,
      mountId: anchor.id,
    };
  }

  private createMemberMaterial(spec: MenuBoardSpec, role: BoardMaterialRole): THREE.Material {
    const surface = spec.surface;
    switch (role) {
      case 'face':
        return new THREE.MeshStandardMaterial({
          name: `menu:${spec.year}:member-face`,
          color: new THREE.Color(surface.face),
          roughness: surface.roughness,
          metalness: surface.metalness,
        });
      case 'trim':
        return new THREE.MeshStandardMaterial({
          name: `menu:${spec.year}:trim`,
          color: new THREE.Color(surface.trim),
          roughness: 0.32,
          metalness: 0.82,
        });
      case 'metal':
        return new THREE.MeshStandardMaterial({
          name: `menu:${spec.year}:metal`,
          color: new THREE.Color(surface.trim),
          roughness: 0.42,
          metalness: 0.92,
        });
      case 'glass':
        return new THREE.MeshPhysicalMaterial({
          name: `menu:${spec.year}:glass`,
          color: new THREE.Color(surface.faceAccent),
          roughness: 0.12,
          metalness: 0,
          transparent: true,
          opacity: 0.42,
          transmission: 0.35,
        });
      case 'emissive':
        return new THREE.MeshStandardMaterial({
          name: `menu:${spec.year}:emissive`,
          color: new THREE.Color(surface.faceShadow),
          emissive: new THREE.Color(surface.glow),
          emissiveIntensity: 0.85,
          roughness: 0.7,
          metalness: 0.1,
        });
      case 'felt':
        return new THREE.MeshStandardMaterial({
          name: `menu:${spec.year}:felt`,
          color: new THREE.Color(surface.faceShadow),
          roughness: 0.95,
          metalness: 0,
        });
      case 'stone':
        return new THREE.MeshStandardMaterial({
          name: `menu:${spec.year}:stone`,
          color: new THREE.Color(surface.faceShadow),
          roughness: 0.94,
          metalness: 0.02,
        });
      case 'frame':
      default:
        return new THREE.MeshStandardMaterial({
          name: `menu:${spec.year}:frame`,
          color: new THREE.Color(surface.frame),
          roughness: Math.min(surface.roughness + 0.2, 1),
          metalness: 0.08,
        });
    }
  }

  private release(parts: BoardParts): void {
    parts.group.parent?.remove(parts.group);
    for (const geometry of parts.geometries) geometry.dispose();
    for (const material of parts.materials) material.dispose();
    for (const texture of parts.textures) disposeBoardTexture(texture.texture);
    parts.group.clear();
    this.disposedGeometries += parts.geometries.length;
    this.disposedMaterials += parts.materials.length;
    this.disposedTextures += parts.textures.length;
  }
}

/** Maps one menu panel onto its sub-rectangle of the board texture. */
function applyPanelUvs(geometry: THREE.BufferGeometry, rect: FaceRectLike, aspect: number): void {
  const u0 = rect.x / aspect;
  const u1 = (rect.x + rect.width) / aspect;
  const v0 = rect.y;
  const v1 = rect.y + rect.height;
  const uv = geometry.getAttribute('uv');
  const order: readonly (readonly [number, number])[] = [
    [u0, v0],
    [u1, v0],
    [u0, v1],
    [u1, v1],
  ];
  for (let index = 0; index < order.length && index < uv.count; index += 1) {
    const pair = order[index];
    if (!pair) continue;
    uv.setXY(index, pair[0], pair[1]);
  }
  uv.needsUpdate = true;
}

interface FaceRectLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Convenience factory mirroring `createEnvironmentModule` / `createPosterModule`. */
export function createMenuBoardModule(options: MenuBoardModuleOptions = {}): MenuBoardModule {
  return new MenuBoardModule(options);
}

/** Per-year era menu board specs, keyed by {@link YearId}. */
export { MENU_BOARD_SPECS };

/** Looks up one era's menu board spec. */
export { menuBoardSpec };

/** Texture height used when none is supplied. */
export { MENU_BOARD_TEXTURE_HEIGHT };

/** Default canvas factory, re-exported so composition can share one backend. */
export { defaultCanvasFactory };
