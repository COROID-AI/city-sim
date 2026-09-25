/**
 * Chrono City click-to-inspect focus controller.
 *
 * Implements the pickable half of the camera API declared in `./camera`:
 * objects are registered with an era-aware {@link FocusTarget}, a raycast turns
 * a click or tap into a hit, the camera glides to a framed view of that target
 * and a `focus` event carries the info-card payload to the HUD.
 *
 * The controller is scene-content agnostic: it accepts bare `Object3D`s, whole
 * `SceneSystem`s or arbitrary object lists with a resolver, so scene assembly
 * can register buildings, vehicles, pedestrians, props and signage without the
 * controls ever importing their modules.
 *
 * Two behaviours matter for the timeline: labels are resolved for the *active*
 * era (an object can read differently in 1945 and 2025), and an era swap
 * refreshes the info card without touching the camera pose, so the block can
 * transform in front of the viewer while the view is preserved.
 */

import * as THREE from "three";

import type { EraId } from "../era/eraTypes";
import { CITY_LAYOUT, type CameraLandmark, type CityLayout, type WorldPoint } from "../scene/layout";
import type {
  CameraRig,
  CameraViewport,
  FocusClearSource,
  FocusClearedPayload,
  FocusEventMap,
  FocusEventName,
  FocusInfo,
  FocusKind,
  FocusLabelOverride,
  FocusListener,
  FocusSource,
  FocusTarget,
  PickableSource,
} from "./camera";

/* -------------------------------------------------------------------------- */
/* Pickable registry                                                          */
/* -------------------------------------------------------------------------- */

/** One registered object plus its info-card descriptor. */
export interface PickableEntry {
  readonly object: THREE.Object3D;
  readonly target: FocusTarget;
}

/** Maps a scene object to its descriptor; return `null` to skip it. */
export type FocusTargetResolver = (object: THREE.Object3D, index: number) => FocusTarget | null;

const FOCUS_KINDS: readonly FocusKind[] = ["building", "vehicle", "pedestrian", "prop", "signage", "landmark", "other"];

function isFocusKind(value: unknown): value is FocusKind {
  return typeof value === "string" && (FOCUS_KINDS as readonly string[]).includes(value);
}

function isFocusTarget(value: unknown): value is FocusTarget {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; kind?: unknown; title?: unknown };
  return (
    typeof candidate.id === "string" &&
    isFocusKind(candidate.kind) &&
    typeof candidate.title === "string"
  );
}

function readLabel(object: THREE.Object3D): string | null {
  const data = object.userData as Record<string, unknown>;
  for (const key of ["label", "focusLabel", "vehicleId", "pedestrianId", "storefrontId", "id"]) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return object.name.length > 0 ? object.name : null;
}

/**
 * Default resolver for registered scene systems.
 *
 * Systems may attach a full {@link FocusTarget} on `userData.focus`
 * (`userData.focusTarget` is accepted too); otherwise the object's own label,
 * id or name is used to build a neutral, still-era-aware descriptor.
 */
export function defaultFocusTargetResolver(object: THREE.Object3D, index: number): FocusTarget | null {
  const data = object.userData as Record<string, unknown>;
  for (const key of ["focus", "focusTarget"]) {
    const candidate = data[key];
    if (isFocusTarget(candidate)) return candidate;
  }
  const label = readLabel(object);
  if (!label) return null;
  const id = typeof data.focusId === "string" && data.focusId.length > 0 ? data.focusId : `${label}-${index}`;
  const kind = isFocusKind(data.focusKind) ? data.focusKind : isFocusKind(data.kind) ? data.kind : "other";
  return { id, kind, title: label };
}

/**
 * Ordered registry of pickable objects.
 *
 * Insertion order is preserved so scene assembly can express pick priority, and
 * lookups are identity based (a hit on any descendant resolves to its
 * registered ancestor, which is what makes single-mesh pickables workable).
 */
export class PickableRegistry {
  private readonly entries = new Map<THREE.Object3D, PickableEntry>();

  /** Registers (or replaces) one object. */
  add(target: FocusTarget, object: THREE.Object3D): PickableEntry {
    const entry: PickableEntry = { object, target };
    this.entries.set(object, entry);
    return entry;
  }

  /** Registers a list of objects through a resolver; returns how many landed. */
  addObjects(objects: readonly THREE.Object3D[], resolver: FocusTargetResolver): number {
    let registered = 0;
    objects.forEach((object, index) => {
      const target = resolver(object, index);
      if (!target) return;
      this.add(target, object);
      registered += 1;
    });
    return registered;
  }

  /** Registers every pickable a scene system exposes. */
  addSystem(source: PickableSource, resolver: FocusTargetResolver = defaultFocusTargetResolver): number {
    return this.addObjects(source.getPickables(), resolver);
  }

  /** Removes a registered object. */
  remove(object: THREE.Object3D): boolean {
    return this.entries.delete(object);
  }

  /** Removes every registration carrying `id`; returns how many were dropped. */
  removeById(id: string): number {
    let removed = 0;
    for (const [object, entry] of this.entries) {
      if (entry.target.id !== id) continue;
      this.entries.delete(object);
      removed += 1;
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Registered objects in pick priority order. */
  objects(): readonly THREE.Object3D[] {
    return [...this.entries.keys()];
  }

  /** Registrations in pick priority order. */
  list(): readonly PickableEntry[] {
    return [...this.entries.values()];
  }

  /** Looks an object up by descriptor id. */
  byId(id: string): PickableEntry | null {
    for (const entry of this.entries.values()) {
      if (entry.target.id === id) return entry;
    }
    return null;
  }

  /** Resolves an object (or any ancestor of it) to its registration. */
  resolve(object: THREE.Object3D | null): PickableEntry | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const entry = this.entries.get(current);
      if (entry) return entry;
      current = current.parent;
    }
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Labels and framing                                                         */
/* -------------------------------------------------------------------------- */

/** Era-resolved label rows handed to the info card. */
export interface FocusLabel {
  readonly title: string;
  readonly description: string;
  readonly facts: Readonly<Record<string, string | number>>;
}

/** Resolves a target's label for one era, merging era overrides over the base. */
export function resolveFocusLabel(target: FocusTarget, era: EraId): FocusLabel {
  const override: FocusLabelOverride | undefined = target.eraLabels?.[era];
  return {
    title: override?.title ?? target.title,
    description: override?.description ?? target.description ?? "",
    facts: { ...(target.facts ?? {}), ...(override?.facts ?? {}) },
  };
}

/** World-space framing frame for one object. */
export interface FocusFrame {
  readonly center: WorldPoint;
  readonly radius: number;
}

/**
 * Measures an object's bounding sphere for framing.
 *
 * `focusPoint` (from the target descriptor) wins over the measured centre so a
 * system can aim the camera at a facade or a cockpit rather than a bounding-box
 * centre.
 */
export function measureFocusFrame(object: THREE.Object3D | null, focusPoint?: WorldPoint): FocusFrame {
  const fallbackCenter: WorldPoint = focusPoint ?? {
    x: object?.position.x ?? 0,
    y: object?.position.y ?? 0,
    z: object?.position.z ?? 0,
  };
  if (!object) return { center: fallbackCenter, radius: 2 };
  object.updateWorldMatrix(false, true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return { center: fallbackCenter, radius: 2 };
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    center: focusPoint ?? { x: center.x, y: center.y, z: center.z },
    radius: Math.max(0.5, size.length() / 2),
  };
}

/** Descriptor for a layout landmark preset. */
export function landmarkFocusTarget(landmark: CameraLandmark): FocusTarget {
  return {
    id: `landmark:${landmark.id}`,
    kind: "landmark",
    title: landmark.name,
    description: landmark.description,
    facts: { view: "preset", landmark: landmark.id },
  };
}

/** Framing frame for a landmark: an elevated preset aimed at the block centre. */
export function landmarkFocusFrame(landmark: CameraLandmark): FocusFrame {
  const span = Math.hypot(
    landmark.position.x - landmark.target.x,
    landmark.position.y - landmark.target.y,
    landmark.position.z - landmark.target.z,
  );
  return { center: { ...landmark.target }, radius: Math.max(4, span * 0.25) };
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/** Minimal typed emitter for the two info-card events. */
export class FocusEventEmitter {
  private readonly listeners = new Map<FocusEventName, Set<(event: FocusEventMap[FocusEventName]) => void>>();

  /** Subscribes to an event; returns an unsubscribe function. */
  on<K extends FocusEventName>(name: K, listener: FocusListener<K>): () => void {
    const bucket = this.listeners.get(name) ?? new Set<(event: FocusEventMap[FocusEventName]) => void>();
    bucket.add(listener as (event: FocusEventMap[FocusEventName]) => void);
    this.listeners.set(name, bucket);
    return () => this.off(name, listener);
  }

  /** Subscribes for exactly one event. */
  once<K extends FocusEventName>(name: K, listener: FocusListener<K>): () => void {
    const unsubscribe = this.on(name, (event) => {
      unsubscribe();
      listener(event);
    });
    return unsubscribe;
  }

  off<K extends FocusEventName>(name: K, listener: FocusListener<K>): void {
    this.listeners.get(name)?.delete(listener as (event: FocusEventMap[FocusEventName]) => void);
  }

  emit<K extends FocusEventName>(name: K, event: FocusEventMap[K]): void {
    const bucket = this.listeners.get(name);
    if (!bucket) return;
    for (const listener of [...bucket]) listener(event);
  }

  removeAll(): void {
    this.listeners.clear();
  }
}

/* -------------------------------------------------------------------------- */
/* Controller                                                                 */
/* -------------------------------------------------------------------------- */

/** Pixel-space viewport used to convert client coordinates to NDC. */
export interface FocusViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A successful raycast against the pickable registry. */
export interface FocusHit {
  readonly target: FocusTarget;
  readonly object: THREE.Object3D;
  readonly entry: PickableEntry;
  /** Distance from the eye, in metres. */
  readonly distance: number;
  /** World-space intersection point. */
  readonly point: WorldPoint;
  readonly ndc: Readonly<{ x: number; y: number }>;
}

export interface FocusControllerOptions {
  /** Navigation rig the controller glides and raycasts through. */
  readonly camera: CameraRig;
  readonly layout?: CityLayout;
  /** DOM element to bind click/tap/hotkey listeners to. */
  readonly element?: HTMLElement;
  /** Active era for label resolution. */
  readonly era?: EraId;
  readonly registry?: PickableRegistry;
  readonly raycaster?: THREE.Raycaster;
  /** Tap/click tolerance in pixels. Defaults to the rig's `clickTolerancePx`. */
  readonly tapTolerancePx?: number;
  /** Presses longer than this never count as a tap. */
  readonly maxTapDurationMs?: number;
  /** Glide duration used when focusing; defaults to the rig's `focusGlideDurationMs`. */
  readonly focusDurationMs?: number;
}

interface FocusState {
  readonly info: FocusInfo;
  readonly target: FocusTarget;
  readonly object: THREE.Object3D | null;
  readonly pointer: { x: number; y: number };
}

const DIGIT_PATTERN = /^[1-9]$/;

/**
 * Turns clicks, taps and hotkeys into focus events the HUD can render.
 *
 * The controller never owns the render loop: scene assembly ticks
 * `camera.update(delta)`, which advances any focus glide started here.
 */
export class FocusController {
  readonly camera: CameraRig;
  readonly layout: CityLayout;
  readonly registry: PickableRegistry;
  readonly events = new FocusEventEmitter();

  private readonly raycaster: THREE.Raycaster;
  private readonly tapTolerancePx: number;
  private readonly maxTapDurationMs: number;
  private readonly focusDurationMs: number;
  private readonly landmarkIndex: ReadonlyMap<string, CameraLandmark>;
  private eraId: EraId;
  private state: FocusState | null = null;
  private element: HTMLElement | null = null;
  private pressState: { x: number; y: number; time: number } | null = null;

  constructor(options: FocusControllerOptions) {
    this.camera = options.camera;
    this.layout = options.layout ?? options.camera.layout ?? CITY_LAYOUT;
    this.registry = options.registry ?? new PickableRegistry();
    this.raycaster = options.raycaster ?? new THREE.Raycaster();
    this.eraId = options.era ?? "1945";
    this.tapTolerancePx = options.tapTolerancePx ?? this.camera.config.clickTolerancePx;
    this.maxTapDurationMs = options.maxTapDurationMs ?? 600;
    this.focusDurationMs = options.focusDurationMs ?? this.camera.config.focusGlideDurationMs;
    this.landmarkIndex = new Map(this.layout.cameraLandmarks.map((landmark) => [landmark.id, landmark]));
    if (options.element) this.attach(options.element);
  }

  /* ------------------------------------------------------------- era + HUD */

  /** Active era used to resolve label data for focus events. */
  get era(): EraId {
    return this.eraId;
  }

  /** Info-card payload for the focused target, or `null`. */
  get focused(): FocusInfo | null {
    return this.state?.info ?? null;
  }

  /** Picked object behind the current focus, when the focus came from a raycast. */
  get focusedObject(): THREE.Object3D | null {
    return this.state?.object ?? null;
  }

  /**
   * Switches the label era.
   *
   * A focused target re-emits its `focus` event with the new label data and the
   * *unchanged* camera pose, so an era transition can rebuild the block behind
   * the user without disturbing navigation.
   */
  setEra(era: EraId): void {
    if (this.eraId === era) return;
    this.eraId = era;
    const state = this.state;
    if (!state) return;
    const label = resolveFocusLabel(state.target, era);
    const info: FocusInfo = { ...state.info, era, ...label };
    this.state = { ...state, info };
    const payload: FocusEventMap["focus"] = {
      info,
      object: state.object,
      pose: this.camera.pose,
      pointer: { x: state.pointer.x, y: state.pointer.y },
      source: "era",
    };
    this.events.emit("focus", payload);
  }

  /* ------------------------------------------------------------- registry */

  /** Registers one pickable object with its descriptor. */
  register(target: FocusTarget, object: THREE.Object3D): PickableEntry {
    return this.registry.add(target, object);
  }

  /** Registers a list of objects through a resolver. */
  registerObjects(objects: readonly THREE.Object3D[], resolver: FocusTargetResolver): number {
    return this.registry.addObjects(objects, resolver);
  }

  /** Registers every pickable a scene system exposes. */
  registerSystem(source: PickableSource, resolver: FocusTargetResolver = defaultFocusTargetResolver): number {
    return this.registry.addSystem(source, resolver);
  }

  unregister(object: THREE.Object3D): boolean {
    return this.registry.remove(object);
  }

  clearRegistry(): void {
    this.registry.clear();
  }

  on<K extends FocusEventName>(name: K, listener: FocusListener<K>): () => void {
    return this.events.on(name, listener);
  }

  off<K extends FocusEventName>(name: K, listener: FocusListener<K>): void {
    this.events.off(name, listener);
  }

  /* ------------------------------------------------------------- picking */

  /** Raycasts the registry with normalized device coordinates. */
  pickNdc(x: number, y: number): FocusHit | null {
    const objects = this.registry.objects();
    if (objects.length === 0) return null;
    // Pickables may not have been through a render yet, so make sure their world
    // matrices are current before intersecting (a click is rare and cheap).
    for (const object of objects) object.updateWorldMatrix(true, true);
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.pickCamera());
    const intersections = this.raycaster.intersectObjects(objects as THREE.Object3D[], true);
    for (const intersection of intersections) {
      const entry = this.registry.resolve(intersection.object);
      if (!entry) continue;
      return {
        target: entry.target,
        object: entry.object,
        entry,
        distance: intersection.distance,
        point: { x: intersection.point.x, y: intersection.point.y, z: intersection.point.z },
        ndc: { x, y },
      };
    }
    return null;
  }

  /** Raycasts from client pixels, using the element box when available. */
  pickAt(clientX: number, clientY: number, viewport?: FocusViewport): FocusHit | null {
    const box = viewport ?? this.viewportBox();
    const ndcX = ((clientX - box.left) / box.width) * 2 - 1;
    const ndcY = -(((clientY - box.top) / box.height) * 2 - 1);
    return this.pickNdc(ndcX, ndcY);
  }

  /** Click/tap entry point: focus the hit target, or clear the info card. */
  clickAt(clientX: number, clientY: number, viewport?: FocusViewport): FocusInfo | null {
    const hit = this.pickAt(clientX, clientY, viewport);
    if (!hit) {
      this.clearFocus("raycast");
      return null;
    }
    return this.focusOn(hit, "raycast");
  }

  /** Focuses a hit: glides to a framed view and emits the info-card event. */
  focusOn(hit: FocusHit, source: FocusSource = "raycast"): FocusInfo {
    const frame = measureFocusFrame(hit.object, hit.target.focusPoint);
    const label = resolveFocusLabel(hit.target, this.eraId);
    const info: FocusInfo = {
      id: hit.target.id,
      kind: hit.target.kind,
      era: this.eraId,
      title: label.title,
      description: label.description,
      facts: label.facts,
      worldPosition: frame.center,
      radius: hit.target.radius ?? frame.radius,
    };
    const pose = this.camera.framingPose(info.worldPosition, info.radius);
    this.camera.glideTo(pose, { durationMs: this.focusDurationMs });
    this.state = { info, target: hit.target, object: hit.object, pointer: { x: hit.ndc.x, y: hit.ndc.y } };
    this.events.emit("focus", {
      info,
      object: hit.object,
      pose,
      pointer: { x: hit.ndc.x, y: hit.ndc.y },
      source,
    });
    return info;
  }

  /** Focuses a registered target by descriptor id. */
  focusTarget(id: string, source: FocusSource = "api"): FocusInfo | null {
    const entry = this.registry.byId(id);
    if (!entry) return null;
    const frame = measureFocusFrame(entry.object, entry.target.focusPoint);
    return this.focusOn(
      {
        target: entry.target,
        object: entry.object,
        entry,
        distance: Math.hypot(
          frame.center.x - this.camera.pose.position.x,
          frame.center.y - this.camera.pose.position.y,
          frame.center.z - this.camera.pose.position.z,
        ),
        point: frame.center,
        ndc: { x: 0, y: 0 },
      },
      source,
    );
  }

  /**
   * Glides to a named layout landmark preset and emits the matching info card.
   *
   * Landmarks are pickable-free: they are authored view anchors, so focusing one
   * uses the preset pose rather than a raycast.
   */
  focusLandmark(id: string, source: FocusSource = "landmark"): FocusInfo {
    const landmark = this.landmarkIndex.get(id);
    if (!landmark) throw new Error(`Unknown Chrono City camera landmark "${id}".`);
    const pose = this.camera.applyLandmark(landmark, { durationMs: this.focusDurationMs });
    const frame = landmarkFocusFrame(landmark);
    const target = landmarkFocusTarget(landmark);
    const label = resolveFocusLabel(target, this.eraId);
    const info: FocusInfo = {
      id: target.id,
      kind: target.kind,
      era: this.eraId,
      title: label.title,
      description: label.description,
      facts: label.facts,
      worldPosition: frame.center,
      radius: frame.radius,
      landmarkId: landmark.id,
    };
    this.state = { info, target, object: null, pointer: { x: 0, y: 0 } };
    this.events.emit("focus", { info, object: null, pose, pointer: { x: 0, y: 0 }, source });
    return info;
  }

  /** Hides the info card; no-op event-wise for an already-empty card. */
  clearFocus(source: FocusClearSource = "api"): void {
    const hadFocus = this.state !== null;
    this.state = null;
    if (!hadFocus && source === "raycast") return;
    const payload: FocusClearedPayload = { era: this.eraId, source };
    this.events.emit("focus-cleared", payload);
  }

  /* --------------------------------------------------------- gesture input */

  /** Records a press for tap detection. */
  press(x: number, y: number): void {
    this.pressState = { x, y, time: nowMs() };
  }

  /** Finishes a press; converts a short, still gesture into a focus click. */
  release(x: number, y: number): FocusInfo | null {
    const press = this.pressState;
    this.pressState = null;
    if (!press) return null;
    if (nowMs() - press.time > this.maxTapDurationMs) return null;
    if (Math.hypot(x - press.x, y - press.y) > this.tapTolerancePx) return null;
    return this.clickAt(x, y);
  }

  /**
   * Keyboard hotkeys owned by the info card: `Escape` clears, `Home`/`0`
   * resets to the establishing view, digits `1..9` jump to landmark presets.
   */
  handleHotkey(rawKey: string): boolean {
    const key = rawKey.trim().toLowerCase();
    if (key === "escape") {
      this.clearFocus("escape");
      return true;
    }
    if (key === "home" || key === "0") {
      this.camera.reset({ durationMs: this.focusDurationMs });
      this.clearFocus("api");
      return true;
    }
    if (DIGIT_PATTERN.test(key)) {
      const landmark = this.layout.cameraLandmarks[Number.parseInt(key, 10) - 1];
      if (!landmark) return false;
      this.focusLandmark(landmark.id);
      return true;
    }
    return false;
  }

  /* --------------------------------------------------------------- DOM I/O */

  /** Binds click, tap and hotkey listeners to `element`. */
  attach(element: HTMLElement): void {
    if (this.element === element) return;
    this.detach();
    this.element = element;
    element.addEventListener("mousedown", this.handleMouseDown);
    element.addEventListener("mouseup", this.handleMouseUp);
    element.addEventListener("touchstart", this.handleTouchStart, { passive: true });
    element.addEventListener("touchend", this.handleTouchEnd, { passive: true });
    element.addEventListener("keydown", this.handleKeyDown);
  }

  /** Removes every listener added by {@link attach}. */
  detach(): void {
    const element = this.element;
    if (!element) return;
    element.removeEventListener("mousedown", this.handleMouseDown);
    element.removeEventListener("mouseup", this.handleMouseUp);
    element.removeEventListener("touchstart", this.handleTouchStart);
    element.removeEventListener("touchend", this.handleTouchEnd);
    element.removeEventListener("keydown", this.handleKeyDown);
    this.element = null;
    this.pressState = null;
  }

  /** Detaches listeners, drops registrations and clears subscribers. */
  dispose(): void {
    this.detach();
    this.registry.clear();
    this.events.removeAll();
    this.state = null;
  }

  /* ------------------------------------------------------------- internals */

  private pickCamera(): THREE.Camera {
    return this.camera.camera;
  }

  private viewportBox(): FocusViewport {
    const element = this.element;
    if (element && typeof element.getBoundingClientRect === "function") {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }
    }
    const viewport: CameraViewport = this.camera.viewport;
    return { left: 0, top: 0, width: viewport.width, height: viewport.height };
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.press(event.clientX, event.clientY);
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.release(event.clientX, event.clientY);
  };

  private readonly handleTouchStart = (event: Event): void => {
    const touches = readTouchPoints(event, "touches");
    if (touches.length !== 1) {
      this.pressState = null;
      return;
    }
    const first = touches[0];
    if (first) this.press(first.x, first.y);
  };

  private readonly handleTouchEnd = (event: Event): void => {
    const changed = readTouchPoints(event, "changedTouches");
    const first = changed[0];
    if (!first) return;
    this.release(first.x, first.y);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as { tagName?: unknown; isContentEditable?: unknown } | null;
    if (target) {
      const tag = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
      if ((tag === "input" || tag === "textarea" || tag === "select") || target.isContentEditable === true) return;
    }
    if (this.handleHotkey(event.key) && event.cancelable) event.preventDefault();
  };
}

/** Creates the click-to-inspect controller for a navigation rig. */
export function createFocusController(options: FocusControllerOptions): FocusController {
  return new FocusController(options);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/** Reads a `TouchList`-like field off a DOM event (jsdom has no `TouchEvent`). */
function readTouchPoints(event: Event, field: "touches" | "changedTouches"): { x: number; y: number }[] {
  const list = (event as unknown as Record<string, unknown>)[field];
  if (!list || typeof list !== "object") return [];
  const arrayLike = list as { length?: number; [index: number]: unknown };
  const length = typeof arrayLike.length === "number" ? arrayLike.length : 0;
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index < length; index += 1) {
    const candidate = arrayLike[index] as { clientX?: unknown; clientY?: unknown } | undefined;
    if (!candidate) continue;
    points.push({ x: Number(candidate.clientX ?? 0), y: Number(candidate.clientY ?? 0) });
  }
  return points;
}
