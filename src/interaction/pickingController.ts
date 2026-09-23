/**
 * Chrono City — raycast picking, hover highlight and the inspection layer.
 *
 * Input model:
 *  - `pointermove` records the pointer and raycasts it against every object
 *    registered in the `InspectionRegistry`. The nearest registered hit becomes
 *    the hover target: its materials get an emissive tint plus an edge outline,
 *    and the canvas switches to a pointer cursor. Moving off the object (or
 *    leaving the canvas) restores the original materials and cursor.
 *  - `pointerdown` + `pointerup` only count as a *pick* when the pointer barely
 *    moved and the press was short — a movement-threshold (and duration)
 *    disambiguation, so drag-look navigation and click-to-inspect never fight
 *    each other. While a drag is in progress the hover highlight is suspended.
 *  - The hover raycast also runs from the `SceneContext` tick registry, so an
 *    inspectable that appears under a stationary pointer (or a camera that
 *    moved) is picked up on the next frame. Picking therefore composes with the
 *    shared frame loop instead of owning its own animation timing.
 *
 * Era awareness: the controller never reads live year state. The caller passes
 * the active `EraId` (layer option or `setEra()`), which is what the info card
 * is rendered with; a year change simply re-resolves the open card through the
 * registry. The wiring of the year slider belongs to the era-transition
 * integration task.
 *
 * Lifecycle:
 *   create    → `new PickingController(...)` or `createInspectionLayer(...)`.
 *   consume   → `hoveredId` / `onHover` / `onSelect`, `pickAt()`, `setEra()`.
 *   integrate → `createInspectionLayer({ context, registry })` registers the
 *               pick system on the shared context and publishes the layer on
 *               `window` via `integrateInspectionGlobal()`.
 */

import * as THREE from 'three';

import { DEFAULT_ERA, assertEraId, type EraId } from '../core/eraContracts';
import type { SceneContext, SystemRegistration } from '../core/sceneContext';
import { createInfoCard, type InfoCard, type InfoCardOptions } from './infoCard';
import {
  createInspectionRegistry,
  type InspectionRegistry,
  type InspectableRecord,
  type RegistryChangeEvent,
  type ResolvedHighlightStyle,
  type ResolvedInspectableCopy,
} from './inspectionRegistry';

export const PICKING_CONTROLLER_VERSION = 1;

/** Pointer travel (px) that turns a press into a drag-look instead of a pick. */
export const DEFAULT_DRAG_THRESHOLD_PX = 5;
/** Longest press (ms) still counted as a click. */
export const DEFAULT_CLICK_MAX_DURATION_MS = 600;
/** Id the pick system registers under on the shared scene context. */
export const DEFAULT_PICK_SYSTEM_ID = 'chrono-inspection-picking';
/** Pick systems run late so camera/HUD systems have already updated. */
export const DEFAULT_PICK_SYSTEM_ORDER = 10;
/** Name of the outline object added to a hovered mesh. */
export const HIGHLIGHT_OUTLINE_NAME = 'chrono-hover-outline';
/** Cursor shown while an inspectable is hovered. */
export const HOVER_CURSOR = 'pointer';
/** Global key `integrateInspectionGlobal()` publishes the layer on. */
export const INSPECTION_GLOBAL_KEY = '__chronoCityInspection';

const EDGE_OUTLINE_OPACITY = 0.9;

/* ------------------------------------------------------------------------- *
 * Hover highlight
 * ------------------------------------------------------------------------- */

interface MaterialHighlight {
  readonly mesh: THREE.Mesh;
  readonly original: THREE.Material | THREE.Material[];
  readonly applied: readonly THREE.Material[];
}

interface OutlineHighlight {
  readonly outline: THREE.LineSegments;
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

/**
 * `true` when neither the hit object nor any ancestor up to the registered root
 * is hidden. Three's raycaster ignores visibility, so era content that hides an
 * object would otherwise stay pickable.
 */
function isVisibleChain(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    if (current === root) return true;
    current = current.parent;
  }
  // Unreachable while the registry maps the hit back to this root.
  return false;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
    return;
  }
  material.dispose();
}

/**
 * Clones a material and applies the highlight tint. Cloning keeps the effect
 * local: a material shared between several objects is never mutated globally.
 */
function tintMaterial(material: THREE.Material, style: ResolvedHighlightStyle): THREE.Material {
  const clone = material.clone() as THREE.Material & {
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  };
  if (clone.emissive instanceof THREE.Color) {
    clone.emissive.setHex(style.emissive);
    if (typeof clone.emissiveIntensity === 'number') {
      clone.emissiveIntensity = style.emissiveIntensity;
    }
  }
  return clone;
}

/**
 * Applies and removes the hover look for exactly one inspectable record.
 *
 * Emissive-capable materials get a tinted clone; every mesh additionally gets a
 * non-depth-tested edge outline, so geometry that cannot glow (basic materials,
 * unlit content) is still visibly marked. `clear()` restores the original
 * materials and disposes everything it created.
 */
export class HoverHighlight {
  private readonly outlineName: string;
  private recordId: string | null = null;
  private materials: MaterialHighlight[] = [];
  private outlines: OutlineHighlight[] = [];

  constructor(outlineName: string = HIGHLIGHT_OUTLINE_NAME) {
    this.outlineName = outlineName;
  }

  /** Id of the record currently highlighted, or `null`. */
  get activeId(): string | null {
    return this.recordId;
  }

  get isActive(): boolean {
    return this.recordId !== null;
  }

  /** Number of meshes currently carrying a tinted material clone. */
  get materialCount(): number {
    return this.materials.length;
  }

  /** Number of outline objects currently attached. */
  get outlineCount(): number {
    return this.outlines.length;
  }

  /** Highlights `record`, replacing any previous highlight. Idempotent per id. */
  apply(record: InspectableRecord): void {
    if (this.recordId === record.id) return;
    this.clear();
    this.recordId = record.id;

    const style = record.highlight;
    record.object.traverse((child) => {
      if (!isMesh(child)) return;
      this.applyMaterialHighlight(child, style);
      if (style.outline) this.applyOutline(child, style);
    });
  }

  /** Restores every material and removes every outline. */
  clear(): void {
    for (const entry of this.materials) {
      entry.mesh.material = entry.original;
      for (const material of entry.applied) material.dispose();
    }
    this.materials = [];

    for (const entry of this.outlines) {
      entry.outline.removeFromParent();
      entry.outline.geometry.dispose();
      disposeMaterial(entry.outline.material);
    }
    this.outlines = [];

    this.recordId = null;
  }

  private applyMaterialHighlight(mesh: THREE.Mesh, style: ResolvedHighlightStyle): void {
    const original = mesh.material;
    if (!original) return;

    const sources = Array.isArray(original) ? original : [original];
    const applied = sources.map((material) => tintMaterial(material, style));
    mesh.material = Array.isArray(original) ? applied : applied[0];
    this.materials.push({ mesh, original, applied });
  }

  private applyOutline(mesh: THREE.Mesh, style: ResolvedHighlightStyle): void {
    const geometry = mesh.geometry;
    if (!geometry || !geometry.getAttribute('position')) return;

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: style.outlineColor,
        transparent: true,
        opacity: EDGE_OUTLINE_OPACITY,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    outline.name = this.outlineName;
    outline.renderOrder = 999;
    // The outline must sit exactly on the mesh transform, so it never updates
    // its own matrix.
    outline.matrixAutoUpdate = false;

    mesh.add(outline);
    this.outlines.push({ outline });
  }
}

/* ------------------------------------------------------------------------- *
 * Pointer plumbing
 * ------------------------------------------------------------------------- */

interface PointerReading {
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly pointerId: number;
}

function readPointer(event: Event): PointerReading | null {
  const candidate = event as Partial<PointerEvent> & Partial<MouseEvent>;
  if (typeof candidate.clientX !== 'number' || typeof candidate.clientY !== 'number') {
    return null;
  }
  if (!Number.isFinite(candidate.clientX) || !Number.isFinite(candidate.clientY)) return null;
  return {
    x: candidate.clientX,
    y: candidate.clientY,
    button: typeof candidate.button === 'number' ? candidate.button : 0,
    pointerId: typeof candidate.pointerId === 'number' ? candidate.pointerId : 0,
  };
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

interface PressState {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
  readonly pointerId: number;
}

export interface PressPointerOptions {
  /** Pointer button; only the primary button (`0`) can pick. */
  readonly button?: number;
  readonly pointerId?: number;
  /** Override the press timestamp (tests / replay). */
  readonly timeMs?: number;
}

export interface ReleasePointerOptions extends PressPointerOptions {}

/* ------------------------------------------------------------------------- *
 * Picking controller
 * ------------------------------------------------------------------------- */

export interface PickingControllerOptions {
  /** Shared scene context: camera, canvas, scene and tick registry. */
  readonly context: SceneContext;
  /** Registry of inspectables to pick against. */
  readonly registry: InspectionRegistry;
  /** Element that owns the pointer listeners. Defaults to `context.canvas`. */
  readonly element?: HTMLElement;
  /** Camera to raycast from. Defaults to `context.camera`. */
  readonly camera?: THREE.Camera;
  /** Active era, supplied by the caller. Defaults to `DEFAULT_ERA`. */
  readonly era?: EraId;
  /** Drag/pick movement threshold in CSS pixels. */
  readonly dragThresholdPx?: number;
  /** Longest press still counted as a click. */
  readonly clickMaxDurationMs?: number;
  /** Re-raycast every context tick (default) or only after pointer/registry changes. */
  readonly pickEveryFrame?: boolean;
  /** Toggle the pointer cursor on hover. Defaults to `true`. */
  readonly cursor?: boolean;
  /** System id registered on the context. */
  readonly systemId?: string;
  /** System order registered on the context. */
  readonly systemOrder?: number;
  /** Attach listeners and register the tick immediately. Defaults to `true`. */
  readonly autoAttach?: boolean;
  /** Called when the hover target changes. */
  readonly onHover?: (record: InspectableRecord | null) => void;
  /** Called after a click resolves (never for drags). `null` = clicked empty space. */
  readonly onSelect?: (record: InspectableRecord | null) => void;
  /** Called when the caller-supplied era changes through `setEra()`. */
  readonly onEraChanged?: (era: EraId) => void;
}

/**
 * Turns pointer events into hover highlights and picks, and keeps doing so once
 * per `SceneContext` tick.
 */
export class PickingController {
  readonly version = PICKING_CONTROLLER_VERSION;
  readonly context: SceneContext;
  readonly registry: InspectionRegistry;
  readonly element: HTMLElement;
  readonly camera: THREE.Camera;

  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly highlight = new HoverHighlight();
  private readonly dragThresholdPx: number;
  private readonly clickMaxDurationMs: number;
  private readonly pickEveryFrame: boolean;
  private readonly togglesCursor: boolean;
  private readonly systemId: string;
  private readonly systemOrder: number;
  private readonly onHoverCallback: ((record: InspectableRecord | null) => void) | undefined;
  private readonly onSelectCallback: ((record: InspectableRecord | null) => void) | undefined;
  private readonly onEraChangedCallback: ((era: EraId) => void) | undefined;

  private activeEra: EraId;
  private registration: SystemRegistration | null = null;
  private unsubscribe: (() => void) | null = null;
  private attached = false;
  private disposedState = false;

  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;
  private pointerDirty = false;
  private down: PressState | null = null;
  private draggingState = false;
  private hovered: InspectableRecord | null = null;
  private savedCursor: string | null = null;

  constructor(options: PickingControllerOptions) {
    if (!options?.context) throw new TypeError('PickingController needs a SceneContext.');
    if (!options.registry) throw new TypeError('PickingController needs an InspectionRegistry.');

    this.context = options.context;
    this.registry = options.registry;
    this.element = options.element ?? options.context.canvas;
    this.camera = options.camera ?? options.context.camera;
    this.activeEra = options.era === undefined ? DEFAULT_ERA : assertEraId(options.era);
    this.dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;
    this.clickMaxDurationMs = options.clickMaxDurationMs ?? DEFAULT_CLICK_MAX_DURATION_MS;
    this.pickEveryFrame = options.pickEveryFrame ?? true;
    this.togglesCursor = options.cursor ?? true;
    this.systemId = options.systemId ?? DEFAULT_PICK_SYSTEM_ID;
    this.systemOrder = options.systemOrder ?? DEFAULT_PICK_SYSTEM_ORDER;
    this.onHoverCallback = options.onHover;
    this.onSelectCallback = options.onSelect;
    this.onEraChangedCallback = options.onEraChanged;

    if (options.autoAttach ?? true) this.attach();
  }

  /* ---------------- state ---------------- */

  /** Active era used for label resolution; set by the caller. */
  get era(): EraId {
    return this.activeEra;
  }

  /** `true` between `attach()` and `detach()`. */
  get isAttached(): boolean {
    return this.attached;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** Currently hovered inspectable, or `null`. */
  get hoveredRecord(): InspectableRecord | null {
    return this.hovered;
  }

  /** Id of the currently hovered inspectable, or `null`. */
  get hoveredId(): string | null {
    return this.hovered?.id ?? null;
  }

  /** `true` while a press has travelled far enough to be a drag-look. */
  get isDragging(): boolean {
    return this.draggingState;
  }

  /** `true` while the pointer is over the pick element. */
  get isPointerInside(): boolean {
    return this.pointerInside;
  }

  /** Highlight helper, exposed for tests and HUD systems. */
  get hoverHighlight(): HoverHighlight {
    return this.highlight;
  }

  /** System registration on the shared context, or `null` when detached. */
  get systemRegistration(): SystemRegistration | null {
    return this.registration;
  }

  /* ---------------- lifecycle ---------------- */

  /** Attaches pointer listeners and registers the pick system. Idempotent. */
  attach(): void {
    if (this.disposedState) throw new Error('PickingController has been disposed.');
    if (this.attached) return;
    this.attached = true;

    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointerup', this.handlePointerUp);
    this.element.addEventListener('pointerleave', this.handlePointerLeave);
    this.element.addEventListener('pointercancel', this.handlePointerCancel);

    this.registration = this.context.registerSystem(this.systemId, this.tick, {
      order: this.systemOrder,
    });
    this.unsubscribe = this.registry.subscribe(this.handleRegistryChange);

    // Nothing has rendered yet when a controller attaches, so make sure the
    // first raycast sees up-to-date world matrices.
    this.context.scene.updateMatrixWorld(true);
  }

  /** Removes listeners, the tick registration and any active highlight. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;

    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointerleave', this.handlePointerLeave);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);

    this.registration?.dispose();
    this.registration = null;
    this.unsubscribe?.();
    this.unsubscribe = null;

    this.down = null;
    this.draggingState = false;
    this.setHovered(null);
  }

  /** Detaches and releases the highlighter. Safe to call twice. */
  dispose(): void {
    if (this.disposedState) return;
    this.detach();
    this.disposedState = true;
    this.highlight.clear();
  }

  /* ---------------- era ---------------- */

  /**
   * Sets the era used by callers of `setEra()`-aware wiring. The controller
   * itself only stores the value and notifies `onEraChanged`; it never reads
   * the live timeline.
   */
  setEra(era: EraId): void {
    const next = assertEraId(era);
    if (next === this.activeEra) return;
    this.activeEra = next;
    this.onEraChangedCallback?.(next);
  }

  /* ---------------- pointer API ---------------- */

  /** Records a hover position and updates the highlight immediately. */
  setPointer(clientX: number, clientY: number): void {
    if (this.disposedState) return;
    this.recordPointer(clientX, clientY);
    this.trackDrag(clientX, clientY);
    this.resolveHover();
  }

  /** Begins a press; only the primary button continues towards a pick. */
  pressPointer(clientX: number, clientY: number, options: PressPointerOptions = {}): void {
    if (this.disposedState) return;
    this.recordPointer(clientX, clientY);

    const button = options.button ?? 0;
    if (button !== 0) {
      this.down = null;
      return;
    }

    this.down = {
      x: clientX,
      y: clientY,
      timeMs: options.timeMs ?? nowMs(),
      pointerId: options.pointerId ?? 0,
    };
    this.draggingState = false;
    this.resolveHover();
  }

  /**
   * Ends a press. A pick is emitted only when the pointer stayed within the
   * drag threshold for less than the click duration — everything else is a
   * drag-look and is ignored by inspection.
   */
  releasePointer(clientX: number, clientY: number, options: ReleasePointerOptions = {}): void {
    if (this.disposedState) return;

    const down = this.down;
    const wasDragging = this.draggingState;
    this.down = null;
    this.draggingState = false;
    this.recordPointer(clientX, clientY);

    const button = options.button ?? 0;
    if (!down || button !== 0) {
      this.resolveHover();
      return;
    }

    const travel = Math.hypot(clientX - down.x, clientY - down.y);
    const elapsed = (options.timeMs ?? nowMs()) - down.timeMs;
    const isPick =
      !wasDragging && travel <= this.dragThresholdPx && elapsed <= this.clickMaxDurationMs;

    if (!isPick) {
      this.resolveHover();
      return;
    }

    const record = this.pickAt(clientX, clientY);
    this.setHovered(record);
    this.onSelectCallback?.(record);
  }

  /** Pointer left the pick element: clear hover and cancel any press. */
  leavePointer(): void {
    if (this.disposedState) return;
    this.pointerInside = false;
    this.pointerDirty = false;
    this.down = null;
    this.draggingState = false;
    this.setHovered(null);
  }

  /** Forces a hover re-resolve from the last pointer position. */
  refresh(): void {
    if (this.disposedState) return;
    this.pointerDirty = false;
    this.resolveHover();
  }

  /**
   * Nearest registered inspectable under a client-space point, or `null`.
   * Hits on children resolve to the registered root; unregistered geometry is
   * not considered an occluder.
   */
  pickAt(clientX: number, clientY: number): InspectableRecord | null {
    if (this.disposedState) return null;

    const targets = [...this.registry.pickTargets()];
    if (targets.length === 0) return null;

    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.toNdc(clientX, clientY), this.camera);

    for (const hit of this.raycaster.intersectObjects(targets, true)) {
      const record = this.registry.findByObject(hit.object);
      if (record && isVisibleChain(hit.object, record.object)) return record;
    }
    return null;
  }

  /* ---------------- internals ---------------- */

  private readonly tick = (): void => {
    if (this.disposedState) return;
    const dirty = this.pointerDirty;
    this.pointerDirty = false;
    if (this.pickEveryFrame || dirty) this.resolveHover();
  };

  private readonly handlePointerMove = (event: Event): void => {
    const pointer = readPointer(event);
    if (!pointer) return;
    this.setPointer(pointer.x, pointer.y);
  };

  private readonly handlePointerDown = (event: Event): void => {
    const pointer = readPointer(event);
    if (!pointer) return;
    this.pressPointer(pointer.x, pointer.y, {
      button: pointer.button,
      pointerId: pointer.pointerId,
    });
  };

  private readonly handlePointerUp = (event: Event): void => {
    const pointer = readPointer(event);
    if (!pointer) return;
    this.releasePointer(pointer.x, pointer.y, {
      button: pointer.button,
      pointerId: pointer.pointerId,
    });
  };

  private readonly handlePointerLeave = (): void => {
    this.leavePointer();
  };

  private readonly handlePointerCancel = (): void => {
    this.leavePointer();
  };

  private readonly handleRegistryChange = (event: RegistryChangeEvent): void => {
    if (event.action === 'clear') {
      this.setHovered(null);
      this.pointerDirty = true;
      return;
    }
    if (event.action === 'register') {
      this.pointerDirty = true;
      return;
    }
    if (this.hovered?.id === event.record.id) {
      this.setHovered(null);
    }
  };

  private recordPointer(clientX: number, clientY: number): void {
    this.pointerX = clientX;
    this.pointerY = clientY;
    this.pointerInside = true;
    this.pointerDirty = true;
  }

  private trackDrag(clientX: number, clientY: number): void {
    if (!this.down || this.draggingState) return;
    if (Math.hypot(clientX - this.down.x, clientY - this.down.y) > this.dragThresholdPx) {
      this.draggingState = true;
      // Looking around must not fight the hover highlight.
      this.setHovered(null);
    }
  }

  private resolveHover(): void {
    if (this.disposedState || !this.pointerInside || this.draggingState) {
      this.setHovered(null);
      return;
    }
    this.setHovered(this.pickAt(this.pointerX, this.pointerY));
  }

  private setHovered(record: InspectableRecord | null): void {
    if (this.hovered === record) return;
    this.hovered = record;
    if (record) this.highlight.apply(record);
    else this.highlight.clear();
    this.updateCursor(record !== null);
    this.onHoverCallback?.(record);
  }

  private updateCursor(hovered: boolean): void {
    if (!this.togglesCursor) return;
    if (hovered) {
      if (this.savedCursor === null) this.savedCursor = this.element.style.cursor;
      this.element.style.cursor = HOVER_CURSOR;
      return;
    }
    if (this.savedCursor !== null) {
      this.element.style.cursor = this.savedCursor;
      this.savedCursor = null;
    }
  }

  /**
   * Client point → normalised device coordinates. Falls back to the context
   * viewport when the element has no layout box (headless tests), which keeps
   * picking deterministic without a real browser layout.
   */
  private toNdc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.element.getBoundingClientRect();
    const hasLayout = rect.width > 0 && rect.height > 0;
    const width = hasLayout ? rect.width : this.context.viewport.width;
    const height = hasLayout ? rect.height : this.context.viewport.height;
    const left = hasLayout ? rect.left : 0;
    const top = hasLayout ? rect.top : 0;

    this.ndc.set(
      ((clientX - left) / Math.max(1, width)) * 2 - 1,
      -((clientY - top) / Math.max(1, height)) * 2 + 1,
    );
    return this.ndc;
  }
}

/* ------------------------------------------------------------------------- *
 * Inspection layer (composition)
 * ------------------------------------------------------------------------- */

export interface InspectionLayerOptions {
  /** Shared scene context the layer registers its pick system on. */
  readonly context: SceneContext;
  /** Registry content tasks register into. Defaults to a fresh one. */
  readonly registry?: InspectionRegistry;
  /** Pointer target element. Defaults to `context.canvas`. */
  readonly element?: HTMLElement;
  readonly camera?: THREE.Camera;
  /** Overlay root the info card mounts in. Defaults to `context.overlayRoot`. */
  readonly overlayRoot?: HTMLElement;
  /** Initial era, supplied by the caller. Defaults to `DEFAULT_ERA`. */
  readonly era?: EraId;
  readonly dragThresholdPx?: number;
  readonly clickMaxDurationMs?: number;
  readonly pickEveryFrame?: boolean;
  readonly cursor?: boolean;
  readonly systemId?: string;
  readonly systemOrder?: number;
  /** Close the info card when empty space is clicked. Defaults to `true`. */
  readonly closeOnEmptyClick?: boolean;
  /** `false` disables the DOM card; an options object configures it. */
  readonly infoCard?: boolean | InfoCardOptions;
  /** Called after each pick with the resolved copy (`null` = empty space). */
  readonly onSelect?: (resolution: ResolvedInspectableCopy | null) => void;
  readonly onHover?: (record: InspectableRecord | null) => void;
}

/** Picking + registry + info card, wired together for one scene context. */
export interface InspectionLayer {
  readonly context: SceneContext;
  readonly registry: InspectionRegistry;
  readonly picking: PickingController;
  readonly infoCard: InfoCard | null;
  /** Era the layer currently resolves labels with. */
  readonly era: EraId;
  /** `true` while the info card is showing. */
  readonly isOpen: boolean;
  /** Caller-supplied year change; re-renders an open card through the registry. */
  setEra(era: EraId): void;
  /** Opens the card for an object without a click. */
  open(objectId: string): ResolvedInspectableCopy | null;
  close(): void;
  dispose(): void;
}

/**
 * Builds the whole inspection subsystem for a scene context: one registry, one
 * picking controller registered on the shared tick loop, and one info card in
 * the overlay root. Content tasks only ever need `layer.registry`.
 */
export function createInspectionLayer(options: InspectionLayerOptions): InspectionLayer {
  if (!options?.context) throw new TypeError('createInspectionLayer() needs a SceneContext.');

  const registry = options.registry ?? createInspectionRegistry();
  const closeOnEmptyClick = options.closeOnEmptyClick ?? true;
  let era: EraId = options.era === undefined ? DEFAULT_ERA : assertEraId(options.era);

  let card: InfoCard | null = null;
  if (options.infoCard !== false) {
    const cardOptions: InfoCardOptions = typeof options.infoCard === 'object' ? options.infoCard : {};
    card = createInfoCard({
      root: options.overlayRoot ?? options.context.overlayRoot,
      ...cardOptions,
      resolve: (objectId, targetEra) => registry.resolve(objectId, targetEra),
    });
  }

  const picking = new PickingController({
    context: options.context,
    registry,
    element: options.element,
    camera: options.camera,
    era,
    dragThresholdPx: options.dragThresholdPx,
    clickMaxDurationMs: options.clickMaxDurationMs,
    pickEveryFrame: options.pickEveryFrame,
    cursor: options.cursor,
    systemId: options.systemId,
    systemOrder: options.systemOrder,
    onHover: options.onHover,
    onEraChanged: (nextEra) => {
      card?.setEra(nextEra);
    },
    onSelect: (record) => {
      const resolution = record ? registry.resolve(record.id, era) : null;
      if (record && resolution) card?.show(record.id, era);
      else if (closeOnEmptyClick) card?.hide();
      options.onSelect?.(resolution);
    },
  });

  const layer: InspectionLayer = {
    context: options.context,
    registry,
    picking,
    infoCard: card,
    get era() {
      return era;
    },
    get isOpen() {
      return card?.isOpen ?? false;
    },
    setEra(nextEra: EraId) {
      const resolved = assertEraId(nextEra);
      if (resolved === era) return;
      era = resolved;
      picking.setEra(resolved);
    },
    open(objectId: string) {
      const resolution = registry.resolve(objectId, era);
      if (resolution) card?.show(objectId, era);
      return resolution;
    },
    close() {
      card?.hide();
    },
    dispose() {
      picking.dispose();
      card?.dispose();
    },
  };

  return layer;
}

/**
 * Publishes the layer on `window` (and announces it), mirroring the scene
 * context's global handle so browser harnesses can drive inspection without
 * re-creating the app.
 */
export function integrateInspectionGlobal(
  layer: InspectionLayer,
  key: string = INSPECTION_GLOBAL_KEY,
): InspectionLayer {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[key] = layer;
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('chrono-city:inspection-ready', { detail: layer }));
    }
  }
  return layer;
}
