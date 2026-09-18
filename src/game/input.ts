/**
 * Player input router — the single source of player intents.
 *
 * ── What this module is ─────────────────────────────────────────────────────
 * One place turns raw DOM events into typed, semantic intents and hands them to
 * the flow layer through `onIntent`. Nothing else in the game listens to the
 * mouse or the keyboard, so the HUD, the camera, the audio bus and the flow
 * layer never have to know what a `pointermove` or a `wheel` event is:
 *
 *   pointer / wheel / touch ─┐
 *   keyboard ────────────────┤──▶ createInputRouter ──▶ InputIntent
 *   (both, first gesture) ───┘            │
 *                                         ├─▶ camera rig   (orbit / pan / zoom)
 *                                         ├─▶ plan graph   (pick / select)
 *                                         └─▶ audio bus    (unlock, ui-click)
 *
 * ── The intent vocabulary ───────────────────────────────────────────────────
 *   camera-orbit   pointer/touch drag, and camera nudges, in radians
 *   camera-pan     drag with a pan modifier (shift / right or middle button,
 *                  or two fingers), in viewport fractions
 *   camera-zoom    wheel and pinch, as a distance multiplier
 *   camera-nudge   keyboard camera step: orbit, pan or zoom
 *   camera-focus   keyboard "frame the plan graph" request
 *   pick           a click or tap resolved through the render-plan-graph
 *                  picking contract; carries the task key (or `null` on empty
 *                  space) plus the anchors the inspector needs
 *   select         the selection decision that follows a pick, or a keyboard
 *                  cursor move; carries the task key or `null`
 *   dispatch       send the focused task down its lane
 *   approve        approve the plan, or the focused task
 *   speed          absolute playback speed (1 / 2 / 4)
 *   pause          absolute paused flag
 *   panel          open or close one HUD panel
 *   audio-unlock   the first user gesture; raised exactly once
 *
 * The router never mutates simulation state and imports no simulation module:
 * dispatch, approval and time control are decisions for the flow layer, which
 * consumes the intents above. Only the three presentation contracts it owns are
 * driven directly — the camera rig (`orbit`/`pan`/`zoom`), the plan graph
 * (`pickFromPointer`/`select`) and the audio bus (`unlock`/`trigger`).
 *
 * ── Keyboard-only operation ─────────────────────────────────────────────────
 * Every pointer action has a key:
 *
 *   ArrowLeft / ArrowRight      orbit left / right
 *   ArrowUp / ArrowDown         tilt the eye down / up
 *   Shift + arrows              pan the focus instead of orbiting
 *   `=` `+` PageUp              zoom in          `-` `_` PageDown   zoom out
 *   F                           frame the plan graph (camera-focus)
 *   `,` `[`  /  `.` `]`         previous / next task node (moves the graph's
 *                               selection halo, so keyboard focus is visible)
 *   Enter                       select the focused task node
 *   D                           dispatch the focused task down its lane
 *   A                           approve the plan (or the focused task)
 *   I / O / V / C               toggle inspector / outline / report / codex
 *   Esc                         close the open panel
 *   Space                       toggle pause
 *   1 / 2 / 4                   select playback speed (and resume playback)
 *
 * The scheme matches the one the HUD preview documents (`I O V C Esc Tab B`
 * plus `↑ ↓ Enter` inside a panel) and adds no key that a browser or the HUD
 * already owns:
 *
 *  - bare `Tab` is never intercepted, so native focus order and the panel focus
 *    trap keep working — the router deliberately does not preventDefault it;
 *  - `keydown` handlers run only when no modifier (ctrl/meta/alt) is held, so
 *    browser and OS shortcuts are untouched;
 *  - an event another layer already consumed (`defaultPrevented`), an event
 *    whose target is a text field or `contenteditable`, and any moment the
 *    optional `keyGuard` reports a modal owner all suppress hotkeys;
 *  - Space and Enter belong to the focused control first: on a button, a link or
 *    a `role="button"`, the router leaves them alone instead of deactivating the
 *    HUD.
 *
 * ── Pointer capture and HUD interactivity ───────────────────────────────────
 * A gesture that starts on an interface element (`[data-hud]`, a button, a link,
 * a form control — the selector is `INTERFACE_EVENT_SELECTOR`) is ignored
 * *before* the router captures the pointer, so the interface keeps its own
 * clicks and never has a gesture retargeted onto the canvas underneath it.
 *
 * ── Disposal ────────────────────────────────────────────────────────────────
 * Every listener is registered through one bookkeeping helper and released by
 * one `dispose()`. `disposed` guards every handler, pending pointer captures are
 * released, `attachedListeners` drops to zero, and a second `dispose()` is a
 * no-op.
 */

import type { AudioCue } from '../audio/audio';
import {
  ORBIT_RADIANS_PER_HEIGHT,
  ORBIT_RADIANS_PER_WIDTH,
  ZOOM_PER_WHEEL_UNIT,
} from '../render/camera';
import {
  pointerToNdc,
  type PlanNodeStatus,
  type RectLike,
  type ScreenAnchor,
  type TaskNodePick,
} from '../render/nodes';
import type { HudPanelAction } from '../ui/hud';

/* -------------------------------------------------------------------------- */
/* Intent vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/** Where an intent came from. */
export const INPUT_SOURCES = ['pointer', 'touch', 'pen', 'wheel', 'keyboard'] as const;

export type InputSource = (typeof INPUT_SOURCES)[number];

/** Playback speeds the time controls can select. */
export const TIME_SPEEDS = [1, 2, 4] as const;

export type TimeSpeed = (typeof TIME_SPEEDS)[number];

/** Speed a fresh router reports until a hotkey or `syncTime` changes it. */
export const DEFAULT_TIME_SPEED: TimeSpeed = 2;

/** Orbit step for one arrow-key press, radians. */
export const ORBIT_NUDGE_RADIANS = Math.PI / 18;
/** Polar step for one arrow-key press, radians. */
export const POLAR_NUDGE_RADIANS = Math.PI / 26;
/** Focus step for one shift+arrow press, as a fraction of the viewport. */
export const PAN_NUDGE_FRACTION = 0.045;
/** Distance multiplier for one zoom key press. */
export const ZOOM_NUDGE_FACTOR = 1.12;
/** Pointer travel (px) that separates a click from a drag. */
export const DRAG_THRESHOLD_PX = 4;

/** A pointer drag that orbits the camera rig. */
export interface CameraOrbitIntent {
  readonly type: 'camera-orbit';
  readonly source: InputSource;
  /** Radians added to the orbit azimuth (positive turns the rig right). */
  readonly azimuth: number;
  /** Radians added to the polar angle (positive lowers the eye). */
  readonly polar: number;
}

/** A pointer or touch gesture that moves the focus target. */
export interface CameraPanIntent {
  readonly type: 'camera-pan';
  readonly source: InputSource;
  /** Focus shift along the screen's right axis, as a viewport fraction. */
  readonly right: number;
  /** Focus shift along the screen's up axis, as a viewport fraction. */
  readonly up: number;
}

/** A wheel roll or two-finger pinch. */
export interface CameraZoomIntent {
  readonly type: 'camera-zoom';
  readonly source: InputSource;
  /** Distance multiplier: `> 1` pulls back, `< 1` moves in. */
  readonly factor: number;
}

/** Which way a keyboard camera step moves. */
export type CameraNudgeDirection = 'left' | 'right' | 'up' | 'down' | 'in' | 'out';

/** One keyboard camera step. */
export interface CameraNudgeIntent {
  readonly type: 'camera-nudge';
  readonly source: 'keyboard';
  readonly direction: CameraNudgeDirection;
  /** What the step does to the rig. */
  readonly action: 'orbit' | 'pan' | 'zoom';
}

/** Keyboard request to frame the plan graph. */
export interface CameraFocusIntent {
  readonly type: 'camera-focus';
  readonly source: 'keyboard';
}

/** A click or tap resolved through the render-plan-graph picking contract. */
export interface PickIntent {
  readonly type: 'pick';
  readonly source: InputSource;
  /** Task key at the pointer, or `null` when the gesture hit empty space. */
  readonly taskId: string | null;
  /** Task title, when a node was hit. */
  readonly title: string | null;
  /** Visual task status, when a node was hit. */
  readonly status: PlanNodeStatus | null;
  /** Phase tier of the hit node, when there was one. */
  readonly tier: number | null;
  /** Normalized device coordinates (−1…1), exactly as the picking contract reports them. */
  readonly ndc: ScreenAnchor;
  /** Normalized canvas anchor (0…1, y down) of the hit node, or `null`. */
  readonly screen: ScreenAnchor | null;
  /** Camera distance to the hit point, or `null`. */
  readonly distance: number | null;
  /** Pointer that produced the pick; `0` for programmatic picks. */
  readonly pointerId: number;
}

/** The selection decision that follows a pick or a keyboard cursor move. */
export interface SelectIntent {
  readonly type: 'select';
  readonly source: InputSource;
  readonly taskId: string | null;
}

/** Send a task down its lane. */
export interface DispatchIntent {
  readonly type: 'dispatch';
  readonly source: InputSource;
  readonly taskId: string;
  /** Lane resolved for the task, or `null` when the flow layer must choose. */
  readonly laneId: string | null;
}

/** Approve the plan, or the task the keyboard cursor points at. */
export interface ApproveIntent {
  readonly type: 'approve';
  readonly source: InputSource;
  readonly taskId: string | null;
}

/** Absolute playback speed. Selecting a speed always resumes playback. */
export interface SpeedIntent {
  readonly type: 'speed';
  readonly source: InputSource;
  readonly speed: TimeSpeed;
}

/** Absolute paused flag. */
export interface PauseIntent {
  readonly type: 'pause';
  readonly source: InputSource;
  readonly paused: boolean;
}

/** Open or close one HUD panel. */
export interface PanelIntent {
  readonly type: 'panel';
  readonly source: InputSource;
  readonly panel: HudPanelAction;
  readonly open: boolean;
}

/** Raised once, on the first user gesture, so the flow can unlock audio. */
export interface AudioUnlockIntent {
  readonly type: 'audio-unlock';
  readonly source: InputSource;
}

/** Everything the router can raise. */
export type InputIntent =
  | CameraOrbitIntent
  | CameraPanIntent
  | CameraZoomIntent
  | CameraNudgeIntent
  | CameraFocusIntent
  | PickIntent
  | SelectIntent
  | DispatchIntent
  | ApproveIntent
  | SpeedIntent
  | PauseIntent
  | PanelIntent
  | AudioUnlockIntent;

/** Stable intent order for tooling, documentation and tests. */
export const INPUT_INTENT_TYPES = [
  'camera-orbit',
  'camera-pan',
  'camera-zoom',
  'camera-nudge',
  'camera-focus',
  'pick',
  'select',
  'dispatch',
  'approve',
  'speed',
  'pause',
  'panel',
  'audio-unlock',
] as const satisfies readonly InputIntent['type'][];

/* -------------------------------------------------------------------------- */
/* Consumed contracts                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The slice of the camera rig the router drives.
 *
 * `CameraRig` from `src/render/camera.ts` satisfies this structurally, so the
 * composed game passes the real rig. Create it *without* an `element` (or call
 * `detach()`): the router is the one translating gestures, and two live gesture
 * surfaces would double-apply every drag.
 */
export interface InputCameraTarget {
  /** Orbit by delta radians, clamped by the rig. */
  orbit(deltaAzimuth: number, deltaPolar: number): void;
  /** Pan the focus target; deltas are fractions of the viewport. */
  pan(deltaRight: number, deltaUp: number): void;
  /** Zoom by a distance multiplier (`> 1` pulls back). */
  zoom(factor: number): void;
}

/**
 * The slice of the plan graph the router uses.
 *
 * `PlanGraphView` from `src/render/nodes.ts` satisfies this structurally:
 * `pickFromPointer` is the picking contract, `select` moves the visible
 * selection halo, and `nodes` supplies the keyboard cursor order.
 */
export interface InputGraphTarget {
  /** Raycast a task node from client coordinates over the canvas rectangle. */
  pickFromPointer(clientX: number, clientY: number, rect: RectLike): TaskNodePick | null;
  /** Show the selection halo for a task, or clear it with `null`. */
  select(taskId: string | null): unknown;
  /** Nodes in visual order; used by the keyboard cursor when `taskOrder` is absent. */
  readonly nodes?: readonly { readonly id: string }[];
  /** The task the graph currently marks as selected, if it exposes one. */
  readonly selectedTaskId?: string | null;
}

/**
 * The slice of the audio bus the router touches.
 *
 * `AudioBus` from `src/audio/audio.ts` satisfies this structurally. The router
 * unlocks on the first gesture and plays the `ui-click` cue for discrete
 * actions; every other cue belongs to domain events and stays with the bus.
 */
export interface InputAudioTarget {
  /** True once the bus has built its graph. */
  readonly unlocked: boolean;
  /** Create and resume the audio graph. Safe to call again. */
  unlock(): Promise<boolean>;
  /** Synthesize one cue now. Returns whether anything was audible. */
  trigger(cue: AudioCue): boolean;
}

/* -------------------------------------------------------------------------- */
/* Hotkeys and tunables                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Interface selector a gesture must not steal.
 *
 * `[data-hud]` is the HUD's documented hook, so every overlay, panel and live
 * region is covered without the router knowing any class names; the rest keeps
 * ordinary focusable controls safe when the canvas is a stage that contains
 * them.
 */
export const INTERFACE_EVENT_SELECTOR =
  '[data-hud], button, a[href], input, select, textarea, summary, label';

/** Elements that own the keyboard while they hold focus. */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Elements that own Space and Enter as activation keys. */
const ACTIVATION_SELECTOR =
  'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], input, select, textarea';

/** The documented hotkey scheme. `INPUT_HOTKEYS.panels` mirrors the HUD. */
export interface InputHotkeyMap {
  /** Pause toggle. */
  readonly pause: string;
  /** Absolute playback speeds, keyed by digit. */
  readonly speeds: Readonly<Record<string, TimeSpeed>>;
  /** Panel toggles, keyed by letter; the values are the HUD's `HudPanelAction`. */
  readonly panels: Readonly<Record<string, HudPanelAction>>;
  /** Keys that step the task cursor back. */
  readonly focusPrevious: readonly string[];
  /** Keys that step the task cursor forward. */
  readonly focusNext: readonly string[];
  /** Key that selects the focused task. */
  readonly activate: string;
  /** Key that dispatches the focused task. */
  readonly dispatch: string;
  /** Key that approves the plan. */
  readonly approve: string;
  /** Key that frames the plan graph. */
  readonly frame: string;
  /** Keys that zoom in. */
  readonly zoomIn: readonly string[];
  /** Keys that zoom out. */
  readonly zoomOut: readonly string[];
  /** Key that closes the open panel. */
  readonly closePanel: string;
}

/** The hotkey table, kept in one place so help text and tests cannot drift. */
export const INPUT_HOTKEYS: InputHotkeyMap = {
  pause: ' ',
  speeds: { '1': 1, '2': 2, '4': 4 },
  panels: { i: 'inspector', o: 'outline', v: 'report', c: 'codex' },
  focusPrevious: [',', '['],
  focusNext: ['.', ']'],
  activate: 'Enter',
  dispatch: 'd',
  approve: 'a',
  frame: 'f',
  zoomIn: ['=', '+', 'PageUp'],
  zoomOut: ['-', '_', 'PageDown'],
  closePanel: 'Escape',
};

const SPEED_BY_KEY: ReadonlyMap<string, TimeSpeed> = new Map(Object.entries(INPUT_HOTKEYS.speeds));
const PANEL_BY_KEY: ReadonlyMap<string, HudPanelAction> = new Map(
  Object.entries(INPUT_HOTKEYS.panels),
);
const PREVIOUS_KEYS: ReadonlySet<string> = new Set(INPUT_HOTKEYS.focusPrevious);
const NEXT_KEYS: ReadonlySet<string> = new Set(INPUT_HOTKEYS.focusNext);
const ZOOM_IN_KEYS: ReadonlySet<string> = new Set(INPUT_HOTKEYS.zoomIn);
const ZOOM_OUT_KEYS: ReadonlySet<string> = new Set(INPUT_HOTKEYS.zoomOut);

/** Keys whose auto-repeat is useful (held camera moves); toggles ignore repeats. */
const REPEATABLE_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  ...INPUT_HOTKEYS.zoomIn,
  ...INPUT_HOTKEYS.zoomOut,
]);

/* -------------------------------------------------------------------------- */
/* Router contract                                                            */
/* -------------------------------------------------------------------------- */

/** Time controls as the router reports them. */
export interface TimeControlState {
  readonly speed: TimeSpeed;
  readonly paused: boolean;
}

export interface InputRouterOptions {
  /**
   * Element that owns canvas gestures: the WebGL canvas, or a stage element
   * that contains it. Pointer listeners are bound here.
   */
  canvas: HTMLElement;
  /**
   * Keyboard surface. Defaults to the canvas owner document, so hotkeys work
   * wherever focus sits in the page. Pass `null` to bind nothing (a host that
   * routes keys itself through `handleKey`).
   */
  keyboardTarget?: EventTarget | null;
  /**
   * Surface observed for the first-gesture audio unlock: any pointer press or
   * key press anywhere in the app, including the interface. Defaults to the
   * canvas owner document. Pass `null` to disable the extra listeners.
   */
  gestureTarget?: EventTarget | null;
  /**
   * Interface host whose descendants must keep their own gestures. Defaults to
   * `null`, which relies on `INTERFACE_EVENT_SELECTOR` alone.
   */
  interfaceHost?: Element | null;
  /** Camera rig to drive. Omit when the flow layer owns camera intents only. */
  camera?: InputCameraTarget | null;
  /** Plan graph to pick from and select in. */
  graph?: InputGraphTarget | null;
  /** Audio bus to unlock and cue. */
  audio?: InputAudioTarget | null;
  /**
   * Task keys in keyboard-cursor order. Defaults to `graph.nodes`, so passing a
   * real `PlanGraphView` is enough.
   */
  taskOrder?: (() => readonly string[]) | null;
  /** Resolve the lane that should carry a dispatched task. */
  laneOf?: ((taskId: string) => string | null) | null;
  /**
   * Return `true` while another layer owns the keyboard (a modal panel, a text
   * dialog). Hotkeys are suppressed for as long as it holds.
   */
  keyGuard?: (() => boolean) | null;
  /** Receives every intent, in the order it was raised. */
  onIntent?: ((intent: InputIntent) => void) | null;
  /** Starting time controls. Defaults to speed 2, playing. */
  time?: Partial<TimeControlState>;
  /** Play the `ui-click` cue for discrete actions. Defaults to `true`. */
  cues?: boolean;
  /** Pointer travel in px that separates a click from a drag. Defaults to 4. */
  dragThresholdPx?: number;
}

/** The live input router. */
export interface InputRouter {
  readonly canvas: HTMLElement;
  /** DOM listeners currently attached; zero once disposed. */
  readonly attachedListeners: number;
  readonly disposed: boolean;
  /** Task the keyboard cursor points at, or `null`. */
  readonly focusedTaskId: string | null;
  /** Panel the router believes is open, or `null`. */
  readonly panel: HudPanelAction | null;
  /** Time controls as last reported by a hotkey or `syncTime`. */
  readonly time: TimeControlState;
  /** True once the first gesture has spent itself on the audio unlock. */
  readonly audioUnlockRequested: boolean;
  /**
   * Route one keyboard event. Returns whether the router consumed it (and
   * called `preventDefault`). This is the same function the attached listener
   * uses, for hosts that prefer to route keys themselves.
   */
  handleKey(event: KeyboardEvent): boolean;
  /** Move the keyboard cursor and the graph's visible focus. */
  focusTask(taskId: string | null): void;
  /** Step the keyboard cursor: `+1` forwards, `-1` backwards, wrapping. */
  stepFocus(direction: 1 | -1): boolean;
  /** Resolve a pick at client coordinates and raise pick + select intents. */
  pickAt(clientX: number, clientY: number, source?: InputSource, pointerId?: number): PickIntent;
  /** Mirror the flow layer's panel state so toggles stay absolute. */
  syncPanel(panel: HudPanelAction | null): void;
  /** Mirror the flow layer's time controls so hotkeys stay absolute. */
  syncTime(time: Partial<TimeControlState>): void;
  /** Release every listener and pending pointer capture. Idempotent. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

interface ActivePointer {
  readonly id: number;
  readonly source: InputSource;
  readonly startX: number;
  readonly startY: number;
  readonly button: number;
  readonly pans: boolean;
  x: number;
  y: number;
  dragging: boolean;
  suppressClick: boolean;
}

/** The element a gesture belongs to, or `null` for documents and windows. */
function elementOf(target: EventTarget | null): Element | null {
  const element = target as Element | null;
  return element && typeof element.closest === 'function' ? element : null;
}

function pointerIdOf(event: MouseEvent | PointerEvent): number {
  const id = (event as PointerEvent).pointerId;
  return typeof id === 'number' ? id : 0;
}

function sourceOf(event: MouseEvent | PointerEvent): InputSource {
  const type = (event as PointerEvent).pointerType;
  if (type === 'touch') return 'touch';
  if (type === 'pen') return 'pen';
  return 'pointer';
}

/**
 * Create the input router.
 *
 * Constructing binds the listeners; `dispose()` releases them. Every dependency
 * is optional, so the router is useful in a unit test with a stub graph, on a
 * page with no audio, or with the flow layer as the only consumer.
 */
export function createInputRouter(options: InputRouterOptions): InputRouter {
  const canvas = options.canvas;
  const ownerDocument = canvas.ownerDocument ?? (typeof document === 'undefined' ? null : document);
  const keyboardTarget = options.keyboardTarget === undefined ? ownerDocument : options.keyboardTarget;
  const gestureTarget = options.gestureTarget === undefined ? ownerDocument : options.gestureTarget;
  const camera = options.camera ?? null;
  const graph = options.graph ?? null;
  const audio = options.audio ?? null;
  const cuesEnabled = options.cues !== false;
  const dragThreshold = Math.max(0, options.dragThresholdPx ?? DRAG_THRESHOLD_PX);

  let disposed = false;
  let liveListeners = 0;
  let focusedTaskId: string | null = null;
  let openPanel: HudPanelAction | null = null;
  let speed: TimeSpeed = options.time?.speed ?? DEFAULT_TIME_SPEED;
  let paused = options.time?.paused ?? false;
  let audioUnlockRequested = false;

  /** One teardown per registered listener, so `dispose` can prove it is clean. */
  const teardowns: Array<() => void> = [];
  const activePointers = new Map<number, ActivePointer>();

  /* ------------------------------------------------------------- plumbing */

  function listen(
    target: EventTarget | null | undefined,
    type: string,
    handler: EventListener,
    listenerOptions?: AddEventListenerOptions | boolean,
  ): void {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, listenerOptions);
    liveListeners += 1;
    let live = true;
    teardowns.push(() => {
      if (!live) return;
      live = false;
      liveListeners -= 1;
      target.removeEventListener(type, handler, listenerOptions);
    });
  }

  function emit(intent: InputIntent): void {
    options.onIntent?.(intent);
  }

  /** Play a UI cue, without ever breaking input when the bus refuses. */
  function cue(kind: AudioCue): void {
    if (!cuesEnabled || !audio) return;
    audio.trigger(kind);
  }

  /** Unlock audio on the first gesture, exactly once, wherever it lands. */
  function unlockAudio(source: InputSource): void {
    if (disposed || audioUnlockRequested) return;
    audioUnlockRequested = true;
    emit({ type: 'audio-unlock', source });
    if (!audio) return;
    const pending: unknown = audio.unlock();
    if (pending && typeof (pending as PromiseLike<unknown>).then === 'function') {
      Promise.resolve(pending).catch(() => undefined);
    }
  }

  function selectSpeed(next: TimeSpeed, source: InputSource): void {
    speed = next;
    paused = false;
    emit({ type: 'speed', source, speed: next });
    cue('ui-click');
  }

  function setPaused(next: boolean, source: InputSource): void {
    paused = next;
    emit({ type: 'pause', source, paused: next });
    cue('ui-click');
  }

  function togglePanel(next: HudPanelAction, source: InputSource): void {
    const open = openPanel !== next;
    openPanel = open ? next : null;
    emit({ type: 'panel', source, panel: next, open });
    cue('ui-click');
  }

  function closePanel(source: InputSource): boolean {
    const previous = openPanel;
    if (!previous) return false;
    openPanel = null;
    emit({ type: 'panel', source, panel: previous, open: false });
    cue('ui-click');
    return true;
  }

  /* ---------------------------------------------------------------- camera */

  function applyOrbit(azimuth: number, polar: number, source: InputSource): void {
    if (azimuth === 0 && polar === 0) return;
    camera?.orbit(azimuth, polar);
    emit({ type: 'camera-orbit', source, azimuth, polar });
  }

  function applyPan(right: number, up: number, source: InputSource): void {
    if (right === 0 && up === 0) return;
    camera?.pan(right, up);
    emit({ type: 'camera-pan', source, right, up });
  }

  function applyZoom(factor: number, source: InputSource): void {
    if (!Number.isFinite(factor) || factor === 1) return;
    camera?.zoom(factor);
    emit({ type: 'camera-zoom', source, factor });
  }

  /**
   * Keyboard camera step.
   *
   * `panning` (shift held) turns the directional steps into focus moves; the
   * zoom keys ignore it. The rig is driven with the same numbers the intent
   * reports, so a keyboard player and a mouse player end up in the same place.
   */
  function nudge(direction: CameraNudgeDirection, panning: boolean): void {
    if (direction === 'in' || direction === 'out') {
      const factor = direction === 'in' ? 1 / ZOOM_NUDGE_FACTOR : ZOOM_NUDGE_FACTOR;
      camera?.zoom(factor);
      emit({ type: 'camera-nudge', source: 'keyboard', direction, action: 'zoom' });
      return;
    }

    const step = panning
      ? { action: 'pan' as const, orbit: 0, pan: PAN_NUDGE_FRACTION }
      : { action: 'orbit' as const, orbit: ORBIT_NUDGE_RADIANS, pan: 0 };

    switch (direction) {
      case 'left':
        if (panning) camera?.pan(-step.pan, 0);
        else camera?.orbit(-step.orbit, 0);
        break;
      case 'right':
        if (panning) camera?.pan(step.pan, 0);
        else camera?.orbit(step.orbit, 0);
        break;
      case 'up':
        if (panning) camera?.pan(0, step.pan);
        else camera?.orbit(0, POLAR_NUDGE_RADIANS);
        break;
      case 'down':
        if (panning) camera?.pan(0, -step.pan);
        else camera?.orbit(0, -POLAR_NUDGE_RADIANS);
        break;
    }

    emit({ type: 'camera-nudge', source: 'keyboard', direction, action: step.action });
  }

  /* ------------------------------------------------------------- selection */

  function taskIds(): readonly string[] {
    const ordered = options.taskOrder?.();
    if (ordered) return ordered;
    return graph?.nodes?.map((node) => node.id) ?? [];
  }

  function focusTask(taskId: string | null): void {
    focusedTaskId = taskId;
    graph?.select(taskId);
  }

  function stepFocus(direction: 1 | -1): boolean {
    const ids = taskIds();
    if (ids.length === 0) return false;
    const current = focusedTaskId === null ? -1 : ids.indexOf(focusedTaskId);
    const from = current < 0 ? (direction > 0 ? -1 : 0) : current;
    const next = ids[(from + direction + ids.length) % ids.length];
    if (next === undefined) return false;
    focusTask(next);
    emit({ type: 'select', source: 'keyboard', taskId: next });
    cue('ui-click');
    return true;
  }

  /** Select the focused task, or focus the first task when nothing is focused. */
  function activateFocus(): boolean {
    if (focusedTaskId === null) return stepFocus(1);
    emit({ type: 'select', source: 'keyboard', taskId: focusedTaskId });
    cue('ui-click');
    return true;
  }

  function dispatchFocused(): boolean {
    if (focusedTaskId === null) return false;
    const taskId = focusedTaskId;
    emit({ type: 'dispatch', source: 'keyboard', taskId, laneId: options.laneOf?.(taskId) ?? null });
    cue('ui-click');
    return true;
  }

  function approve(source: InputSource): void {
    emit({ type: 'approve', source, taskId: focusedTaskId });
    cue('ui-click');
  }

  /* --------------------------------------------------------------- picking */

  function rectOf(element: HTMLElement): RectLike {
    if (typeof element.getBoundingClientRect === 'function') {
      const rect = element.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) return rect;
    }
    return {
      left: 0,
      top: 0,
      width: Math.max(1, element.clientWidth || 0),
      height: Math.max(1, element.clientHeight || 0),
    };
  }

  function sizeOf(): { width: number; height: number } {
    const rect = rectOf(canvas);
    return {
      width: Math.max(1, canvas.clientWidth || rect.width || 1),
      height: Math.max(1, canvas.clientHeight || rect.height || 1),
    };
  }

  function pickAt(
    clientX: number,
    clientY: number,
    source: InputSource = 'pointer',
    pointerId = 0,
  ): PickIntent {
    const rect = rectOf(canvas);
    const ndc = pointerToNdc(clientX, clientY, rect);
    const hit = graph ? graph.pickFromPointer(clientX, clientY, rect) : null;
    const intent: PickIntent = {
      type: 'pick',
      source,
      taskId: hit?.taskId ?? null,
      title: hit?.title ?? null,
      status: hit?.status ?? null,
      tier: hit?.tier ?? null,
      ndc: hit ? { x: hit.ndc.x, y: hit.ndc.y } : { x: ndc.x, y: ndc.y },
      screen: hit ? { x: hit.screen?.x ?? 0, y: hit.screen?.y ?? 0 } : null,
      distance: hit?.distance ?? null,
      pointerId,
    };
    emit(intent);
    focusTask(intent.taskId);
    emit({ type: 'select', source, taskId: intent.taskId });
    cue('ui-click');
    return intent;
  }

  /* -------------------------------------------------------------- pointer */

  function isInterfaceEvent(target: EventTarget | null): boolean {
    const element = elementOf(target);
    if (!element) return false;
    const host = options.interfaceHost ?? null;
    if (host && (host === element || host.contains(element))) return true;
    return element.closest(INTERFACE_EVENT_SELECTOR) !== null;
  }

  function capturePointer(id: number): void {
    const capture = (canvas as { setPointerCapture?: (pointerId: number) => void }).setPointerCapture;
    if (typeof capture !== 'function') return;
    try {
      capture.call(canvas, id);
    } catch {
      // Pointer capture is a nicety; dragging still works without it.
    }
  }

  function releasePointer(id: number): void {
    const release = (canvas as { releasePointerCapture?: (pointerId: number) => void })
      .releasePointerCapture;
    if (typeof release !== 'function') return;
    try {
      release.call(canvas, id);
    } catch {
      // Ignore: capture may already have been lost.
    }
  }

  function onPointerDown(event: MouseEvent | PointerEvent): void {
    if (disposed) return;
    // An interface gesture is the interface's own: no capture, no intents.
    if (isInterfaceEvent(event.target)) return;
    unlockAudio(sourceOf(event));

    const id = pointerIdOf(event);
    activePointers.set(id, {
      id,
      source: sourceOf(event),
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      pans: event.button === 1 || event.button === 2 || event.shiftKey || event.altKey || event.metaKey,
      dragging: false,
      suppressClick: false,
    });

    // A second finger turns the gesture into a pinch: both pointers drag, and
    // neither of them lifts into a click.
    if (activePointers.size > 1) {
      for (const pointer of activePointers.values()) {
        pointer.dragging = true;
        pointer.suppressClick = true;
      }
    }

    capturePointer(id);
  }

  function onPointerMove(event: MouseEvent | PointerEvent): void {
    if (disposed) return;
    const id = pointerIdOf(event);
    const pointer = activePointers.get(id);
    if (!pointer) return;

    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (!pointer.dragging) {
      const travel = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
      if (travel <= dragThreshold) return;
      pointer.dragging = true;
    }

    const size = sizeOf();
    const others = [...activePointers.values()].filter((candidate) => candidate.id !== id);
    const other = others[others.length - 1];

    if (other) {
      // Two fingers: pinch the distance and carry the focus with the midpoint.
      const spread = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      const previousSpread = Math.max(1, spread - Math.hypot(dx, dy));
      const factor = Math.min(2, Math.max(0.5, previousSpread / Math.max(1, spread)));
      applyZoom(factor, pointer.source);
      applyPan(-dx / size.width, dy / size.height, pointer.source);
      return;
    }

    const panning = pointer.pans || event.shiftKey || event.altKey || event.metaKey;
    if (panning) {
      applyPan(-dx / size.width, dy / size.height, pointer.source);
      return;
    }
    applyOrbit(
      -(dx / size.width) * ORBIT_RADIANS_PER_WIDTH,
      -(dy / size.height) * ORBIT_RADIANS_PER_HEIGHT,
      pointer.source,
    );
  }

  function onPointerUp(event: MouseEvent | PointerEvent): void {
    if (disposed) return;
    const id = pointerIdOf(event);
    const pointer = activePointers.get(id);
    if (!pointer) return;
    activePointers.delete(id);
    releasePointer(id);

    // A press that never travelled is a click or a tap: pick through the graph.
    if (!pointer.dragging && !pointer.suppressClick && activePointers.size === 0) {
      pickAt(event.clientX, event.clientY, pointer.source, id);
    }
  }

  function onWheel(event: WheelEvent): void {
    if (disposed) return;
    if (isInterfaceEvent(event.target)) return;
    unlockAudio('pointer');
    event.preventDefault();
    applyZoom(Math.exp(event.deltaY * ZOOM_PER_WHEEL_UNIT), 'wheel');
  }

  function onContextMenu(event: Event): void {
    if (disposed) return;
    if (isInterfaceEvent(event.target)) return;
    // Right-drag pans; the browser menu would interrupt it.
    event.preventDefault();
  }

  /* ------------------------------------------------------------- keyboard */

  /** Lower-case single characters, leave named keys (`ArrowLeft`, `Escape`) alone. */
  function normalizeKey(key: string): string {
    if (key === 'Spacebar' || key === 'Space') return ' ';
    return key.length === 1 ? key.toLowerCase() : key;
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    const element = elementOf(target);
    if (!element) return false;
    if (element.closest(EDITABLE_SELECTOR) !== null) return true;
    return (element as HTMLElement).isContentEditable === true;
  }

  function isActivationTarget(target: EventTarget | null): boolean {
    const element = elementOf(target);
    return element ? element.closest(ACTIVATION_SELECTOR) !== null : false;
  }

  function handleKey(event: KeyboardEvent): boolean {
    if (disposed || event.defaultPrevented) return false;
    // Browser and OS shortcuts stay theirs.
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    // A modal layer (open panel, dialog) owns the keyboard while it is up.
    if (options.keyGuard?.()) return false;
    // Hotkeys never fire while a text field has focus.
    if (isTypingTarget(event.target)) return false;

    const key = normalizeKey(event.key);
    // Space and Enter activate a focused control before they mean anything here.
    if ((key === INPUT_HOTKEYS.pause || key === INPUT_HOTKEYS.activate) && isActivationTarget(event.target)) {
      return false;
    }
    // Held keys only repeat camera moves; toggles fire once per press.
    if (event.repeat === true && !REPEATABLE_KEYS.has(key)) return false;

    const consume = (): true => {
      event.preventDefault();
      return true;
    };

    if (key === INPUT_HOTKEYS.pause) {
      setPaused(!paused, 'keyboard');
      return consume();
    }

    const nextSpeed = SPEED_BY_KEY.get(key);
    if (nextSpeed !== undefined) {
      selectSpeed(nextSpeed, 'keyboard');
      return consume();
    }

    switch (key) {
      case 'ArrowLeft':
        nudge('left', event.shiftKey);
        return consume();
      case 'ArrowRight':
        nudge('right', event.shiftKey);
        return consume();
      case 'ArrowUp':
        nudge('up', event.shiftKey);
        return consume();
      case 'ArrowDown':
        nudge('down', event.shiftKey);
        return consume();
      case INPUT_HOTKEYS.frame:
        emit({ type: 'camera-focus', source: 'keyboard' });
        return consume();
      default:
        break;
    }

    if (ZOOM_IN_KEYS.has(key)) {
      nudge('in', false);
      return consume();
    }
    if (ZOOM_OUT_KEYS.has(key)) {
      nudge('out', false);
      return consume();
    }
    if (PREVIOUS_KEYS.has(key)) {
      return stepFocus(-1) ? consume() : false;
    }
    if (NEXT_KEYS.has(key)) {
      return stepFocus(1) ? consume() : false;
    }
    if (key === INPUT_HOTKEYS.activate) {
      return activateFocus() ? consume() : false;
    }
    if (key === INPUT_HOTKEYS.dispatch) {
      return dispatchFocused() ? consume() : false;
    }
    if (key === INPUT_HOTKEYS.approve) {
      approve('keyboard');
      return consume();
    }

    const nextPanel = PANEL_BY_KEY.get(key);
    if (nextPanel !== undefined) {
      togglePanel(nextPanel, 'keyboard');
      return consume();
    }
    if (key === INPUT_HOTKEYS.closePanel) {
      return closePanel('keyboard') ? consume() : false;
    }

    // Bare Tab, B, Escape with nothing open and every other key stay with the
    // page: the panel focus trap and browser defaults keep working.
    return false;
  }

  function onKeyDown(event: KeyboardEvent): void {
    handleKey(event);
  }

  function onGesturePointerDown(): void {
    unlockAudio('pointer');
  }

  function onGestureKeyDown(): void {
    unlockAudio('keyboard');
  }

  /* ---------------------------------------------------------------- wiring */

  listen(canvas, 'pointerdown', onPointerDown as EventListener);
  listen(canvas, 'pointermove', onPointerMove as EventListener);
  listen(canvas, 'pointerup', onPointerUp as EventListener);
  listen(canvas, 'pointercancel', onPointerUp as EventListener);
  listen(canvas, 'wheel', onWheel as EventListener, { passive: false });
  listen(canvas, 'contextmenu', onContextMenu);
  listen(keyboardTarget, 'keydown', onKeyDown as EventListener);
  listen(gestureTarget, 'pointerdown', onGesturePointerDown as EventListener, true);
  listen(gestureTarget, 'keydown', onGestureKeyDown as EventListener, true);

  return {
    canvas,
    get attachedListeners(): number {
      return liveListeners;
    },
    get disposed(): boolean {
      return disposed;
    },
    get focusedTaskId(): string | null {
      return focusedTaskId;
    },
    get panel(): HudPanelAction | null {
      return openPanel;
    },
    get time(): TimeControlState {
      return { speed, paused };
    },
    get audioUnlockRequested(): boolean {
      return audioUnlockRequested;
    },
    handleKey,
    focusTask,
    stepFocus,
    pickAt,
    syncPanel(next: HudPanelAction | null): void {
      openPanel = next;
    },
    syncTime(next: Partial<TimeControlState>): void {
      if (next.speed !== undefined) speed = next.speed;
      if (next.paused !== undefined) paused = next.paused;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const pointer of [...activePointers.values()]) releasePointer(pointer.id);
      activePointers.clear();
      for (const teardown of teardowns.splice(0)) teardown();
    },
  };
}
