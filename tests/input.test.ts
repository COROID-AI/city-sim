// @vitest-environment happy-dom
/**
 * Input router: pointer, touch, wheel and keyboard intents over the phase-2
 * presentation contracts.
 *
 * Everything here drives the *real* router with synthetic DOM events, so the
 * assertions are about observable behaviour rather than internal bookkeeping:
 *
 *  - a canvas drag raises orbit / pan / zoom intents and moves the camera rig
 *    through `orbit`/`pan`/`zoom`;
 *  - a click or a tap resolves through the real render-plan-graph picking
 *    contract (`pickFromPointer`) and carries the task key, and the graph's
 *    visible selection follows;
 *  - every pointer action has a key, and the hotkey table matches the scheme the
 *    HUD preview documents (I O V C Esc, Space, 1/2/4) without touching bare Tab,
 *    browser shortcuts, a focused text field or a focused HUD control;
 *  - the first gesture asks for the audio unlock exactly once, for whichever
 *    gesture comes first, and discrete actions cue the bus;
 *  - interactive interface gestures are never captured by the canvas;
 *  - disposal releases every listener, is idempotent and leaves nothing behind.
 *
 * The second describe block runs the router over the real `createCameraRig`,
 * `createPlanGraphView` and `createAudioBus` from the phase-2 modules, so the
 * consumed contracts are exercised as shipped instead of as stubs.
 */

import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAudioBus, type AudioCue } from '../src/audio/audio';
import {
  DEFAULT_TIME_SPEED,
  INPUT_HOTKEYS,
  INPUT_INTENT_TYPES,
  ORBIT_NUDGE_RADIANS,
  PAN_NUDGE_FRACTION,
  POLAR_NUDGE_RADIANS,
  TIME_SPEEDS,
  ZOOM_NUDGE_FACTOR,
  createInputRouter,
  type InputAudioTarget,
  type InputCameraTarget,
  type InputGraphTarget,
  type InputIntent,
  type InputRouter,
  type InputRouterOptions,
} from '../src/game/input';
import { createCameraRig, ORBIT_RADIANS_PER_HEIGHT, ORBIT_RADIANS_PER_WIDTH, ZOOM_PER_WHEEL_UNIT } from '../src/render/camera';
import { createHeadlessAdapter } from '../src/render/headless';
import { createPlanGraphView, screenAnchorOf, type RectLike, type TaskNodePick } from '../src/render/nodes';
import { createSampleState } from '../src/sim/fixtures';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const SURFACE_WIDTH = 400;
const SURFACE_HEIGHT = 200;

/** Camera rig stand-in that records what the router drove it with. */
class StubCamera implements InputCameraTarget {
  readonly orbit = vi.fn((_deltaAzimuth: number, _deltaPolar: number): void => undefined);
  readonly pan = vi.fn((_deltaRight: number, _deltaUp: number): void => undefined);
  readonly zoom = vi.fn((_factor: number): void => undefined);
}

/** Plan graph stand-in: the picking contract plus the selection halo. */
class StubGraph implements InputGraphTarget {
  readonly nodes: { id: string }[];
  /** What the next `pickFromPointer` resolves to. */
  pick: TaskNodePick | null = null;
  readonly pickFromPointer = vi.fn(
    (_clientX: number, _clientY: number, _rect: RectLike): TaskNodePick | null => this.pick,
  );
  readonly select = vi.fn((_taskId: string | null): string | null => null);

  constructor(ids: readonly string[]) {
    this.nodes = ids.map((id) => ({ id }));
  }
}

/** Audio bus stand-in: the unlock and cue surface the router may touch. */
class StubAudio implements InputAudioTarget {
  unlocked = false;
  readonly unlock = vi.fn(async (): Promise<boolean> => {
    this.unlocked = true;
    return true;
  });
  readonly trigger = vi.fn((_cue: AudioCue): boolean => true);
}

interface Harness {
  surface: HTMLElement;
  captured: number[];
  released: number[];
  camera: StubCamera;
  graph: StubGraph;
  audio: StubAudio;
  intents: InputIntent[];
  router: InputRouter;
}

const openRouters: InputRouter[] = [];

function createSurface(): {
  element: HTMLElement;
  captured: number[];
  released: number[];
} {
  const element = document.createElement('div');
  const captured: number[] = [];
  const released: number[] = [];
  Object.defineProperty(element, 'clientWidth', { value: SURFACE_WIDTH, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: SURFACE_HEIGHT, configurable: true });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: (): DOMRect =>
      ({
        left: 0,
        top: 0,
        right: SURFACE_WIDTH,
        bottom: SURFACE_HEIGHT,
        width: SURFACE_WIDTH,
        height: SURFACE_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  });
  Object.defineProperty(element, 'setPointerCapture', {
    configurable: true,
    value: (pointerId: number): void => void captured.push(pointerId),
  });
  Object.defineProperty(element, 'releasePointerCapture', {
    configurable: true,
    value: (pointerId: number): void => void released.push(pointerId),
  });
  document.body.append(element);
  return { element, captured, released };
}

function setup(
  overrides: Partial<Omit<InputRouterOptions, 'canvas'>> = {},
  taskIds: readonly string[] = ['task-a', 'task-b', 'task-c'],
): Harness {
  const { element, captured, released } = createSurface();
  const camera = new StubCamera();
  const graph = new StubGraph(taskIds);
  const audio = new StubAudio();
  const intents: InputIntent[] = [];
  const router = createInputRouter({
    canvas: element,
    camera,
    graph,
    audio,
    onIntent: (intent) => void intents.push(intent),
    ...overrides,
  });
  openRouters.push(router);
  return { surface: element, captured, released, camera, graph, audio, intents, router };
}

/** Build a pointer event that reaches listeners bound on the surface. */
function pointer(
  type: string,
  init: PointerEventInit & { pointerId?: number; pointerType?: string } = {},
): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
}

/** Press a key on the page body, the way a keyboard-only player would. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}

/** Intents of one type, narrowed. */
function intentsOf<T extends InputIntent['type']>(
  intents: readonly InputIntent[],
  type: T,
): Extract<InputIntent, { type: T }>[] {
  return intents.filter((intent): intent is Extract<InputIntent, { type: T }> => intent.type === type);
}

/** A task node hit as the picking contract reports it. */
function pickOf(taskId: string, overrides: Partial<TaskNodePick> = {}): TaskNodePick {
  return {
    taskId,
    title: `Task ${taskId}`,
    status: 'running',
    tier: 1,
    instanceId: 0,
    distance: 12,
    point: new Vector3(0, 1, 0),
    center: new Vector3(0, 1, 0),
    ndc: { x: 0.1, y: -0.2 },
    screen: { x: 0.55, y: 0.4 },
    ...overrides,
  };
}

/** One complete click: press and release at the same spot. */
function click(surface: HTMLElement, x: number, y: number, init: PointerEventInit = {}): void {
  surface.dispatchEvent(pointer('pointerdown', { clientX: x, clientY: y, ...init }));
  surface.dispatchEvent(pointer('pointerup', { clientX: x, clientY: y, ...init }));
}

/** One complete drag. */
function drag(
  surface: HTMLElement,
  from: [number, number],
  to: [number, number],
  init: PointerEventInit = {},
): void {
  surface.dispatchEvent(pointer('pointerdown', { clientX: from[0], clientY: from[1], ...init }));
  surface.dispatchEvent(pointer('pointermove', { clientX: to[0], clientY: to[1], ...init }));
  surface.dispatchEvent(pointer('pointerup', { clientX: to[0], clientY: to[1], ...init }));
}

afterEach(() => {
  for (const router of openRouters.splice(0)) router.dispose();
  document.body.replaceChildren();
});

/* -------------------------------------------------------------------------- */
/* Documented vocabulary                                                      */
/* -------------------------------------------------------------------------- */

describe('input router vocabulary', () => {
  it('publishes the hotkey scheme the HUD documents', () => {
    expect(Object.values(INPUT_HOTKEYS.panels).sort()).toEqual([
      'codex',
      'inspector',
      'outline',
      'report',
    ]);
    expect(INPUT_HOTKEYS.speeds).toEqual({ '1': 1, '2': 2, '4': 4 });
    expect(INPUT_HOTKEYS.pause).toBe(' ');
    expect(INPUT_HOTKEYS.closePanel).toBe('Escape');
    expect(TIME_SPEEDS).toEqual([1, 2, 4]);
    expect(DEFAULT_TIME_SPEED).toBe(2);
    expect(INPUT_INTENT_TYPES).toContain('audio-unlock');
    expect(INPUT_INTENT_TYPES).toContain('camera-nudge');
  });
});

/* -------------------------------------------------------------------------- */
/* Pointer, touch and wheel                                                   */
/* -------------------------------------------------------------------------- */

describe('input router pointer gestures', () => {
  it('raises an orbit intent on a drag and drives the rig with it', () => {
    const harness = setup();
    drag(harness.surface, [100, 100], [140, 120], { pointerId: 1 });

    const orbits = intentsOf(harness.intents, 'camera-orbit');
    expect(orbits).toHaveLength(1);
    const orbit = orbits[0];
    expect(orbit?.source).toBe('pointer');
    expect(orbit?.azimuth).toBeCloseTo(-(40 / SURFACE_WIDTH) * ORBIT_RADIANS_PER_WIDTH, 10);
    expect(orbit?.polar).toBeCloseTo(-(20 / SURFACE_HEIGHT) * ORBIT_RADIANS_PER_HEIGHT, 10);
    expect(harness.camera.orbit).toHaveBeenCalledTimes(1);
    expect(harness.camera.orbit).toHaveBeenCalledWith(orbit?.azimuth, orbit?.polar);

    // A drag captures the pointer and is never mistaken for a click.
    expect(harness.captured).toEqual([1]);
    expect(harness.released).toEqual([1]);
    expect(intentsOf(harness.intents, 'pick')).toHaveLength(0);
    expect(harness.graph.pickFromPointer).not.toHaveBeenCalled();
  });

  it('pans instead of orbiting when the gesture asks for it', () => {
    const harness = setup();
    drag(harness.surface, [100, 100], [140, 100], { pointerId: 1, shiftKey: true });
    drag(harness.surface, [100, 100], [140, 100], { pointerId: 2, button: 2 });

    const pans = intentsOf(harness.intents, 'camera-pan');
    expect(pans).toHaveLength(2);
    expect(pans[0]?.right).toBeCloseTo(-40 / SURFACE_WIDTH, 10);
    expect(pans[0]?.up).toBe(0);
    expect(pans[1]?.right).toBeCloseTo(-40 / SURFACE_WIDTH, 10);
    expect(harness.camera.pan).toHaveBeenCalledTimes(2);
    expect(harness.camera.orbit).not.toHaveBeenCalled();
  });

  it('zooms through wheel deltas', () => {
    const harness = setup();
    const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    harness.surface.dispatchEvent(wheel);

    const zooms = intentsOf(harness.intents, 'camera-zoom');
    expect(zooms).toHaveLength(1);
    expect(zooms[0]?.source).toBe('wheel');
    expect(zooms[0]?.factor).toBeCloseTo(Math.exp(120 * ZOOM_PER_WHEEL_UNIT), 10);
    expect(zooms[0]?.factor).toBeGreaterThan(1);
    expect(harness.camera.zoom).toHaveBeenCalledWith(zooms[0]?.factor);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it('turns a click into a pick intent that carries the task key', () => {
    const harness = setup();
    harness.graph.pick = pickOf('task-b');

    click(harness.surface, 220, 100, { pointerId: 1 });

    expect(harness.graph.pickFromPointer).toHaveBeenCalledTimes(1);
    const picks = intentsOf(harness.intents, 'pick');
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({
      taskId: 'task-b',
      title: 'Task task-b',
      status: 'running',
      tier: 1,
      pointerId: 1,
      distance: 12,
    });
    expect(picks[0]?.ndc).toEqual({ x: 0.1, y: -0.2 });
    expect(picks[0]?.screen).toEqual({ x: 0.55, y: 0.4 });

    // The selection decision follows the pick, and the graph shows it.
    const selects = intentsOf(harness.intents, 'select');
    expect(selects).toEqual([{ type: 'select', source: 'pointer', taskId: 'task-b' }]);
    expect(harness.graph.select).toHaveBeenCalledWith('task-b');
    expect(harness.router.focusedTaskId).toBe('task-b');
  });

  it('clears the selection when a click misses every node', () => {
    const harness = setup();
    harness.graph.pick = pickOf('task-a');
    click(harness.surface, 10, 10);
    expect(harness.router.focusedTaskId).toBe('task-a');

    harness.graph.pick = null;
    click(harness.surface, 300, 180);

    const picks = intentsOf(harness.intents, 'pick');
    expect(picks[1]).toMatchObject({ taskId: null, title: null, status: null, screen: null });
    expect(intentsOf(harness.intents, 'select')[1]).toEqual({
      type: 'select',
      source: 'pointer',
      taskId: null,
    });
    expect(harness.graph.select).toHaveBeenLastCalledWith(null);
    expect(harness.router.focusedTaskId).toBeNull();
  });

  it('routes a touch tap through the same pick path', () => {
    const harness = setup();
    harness.graph.pick = pickOf('task-c');
    click(harness.surface, 200, 120, { pointerId: 7, pointerType: 'touch' });

    const picks = intentsOf(harness.intents, 'pick');
    expect(picks[0]?.source).toBe('touch');
    expect(picks[0]?.taskId).toBe('task-c');
    expect(intentsOf(harness.intents, 'select')[0]?.source).toBe('touch');
    expect(harness.captured).toEqual([7]);
  });

  it('pinches two fingers into zoom and pan without clicking', () => {
    const harness = setup();
    harness.graph.pick = pickOf('task-a');

    harness.surface.dispatchEvent(
      pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }),
    );
    harness.surface.dispatchEvent(
      pointer('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 }),
    );
    harness.surface.dispatchEvent(
      pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 240, clientY: 100 }),
    );

    const zooms = intentsOf(harness.intents, 'camera-zoom');
    expect(zooms).toHaveLength(1);
    // Spreading the fingers pulls the camera in.
    expect(zooms[0]?.factor).toBeLessThan(1);
    expect(zooms[0]?.source).toBe('touch');
    const pans = intentsOf(harness.intents, 'camera-pan');
    expect(pans).toHaveLength(1);
    expect(pans[0]?.right).toBeCloseTo(-40 / SURFACE_WIDTH, 10);

    harness.surface.dispatchEvent(
      pointer('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }),
    );
    harness.surface.dispatchEvent(
      pointer('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 240, clientY: 100 }),
    );
    expect(intentsOf(harness.intents, 'pick')).toHaveLength(0);
    expect(harness.graph.pickFromPointer).not.toHaveBeenCalled();
  });

  it('leaves gestures that start on interface elements alone', () => {
    const harness = setup();
    const hud = document.createElement('div');
    hud.dataset.hud = 'root';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.textContent = 'Approve plan';
    hud.append(approve);
    // The interface lives inside the gesture surface, the hard case for capture.
    harness.surface.append(hud);
    harness.graph.pick = pickOf('task-a');

    approve.dispatchEvent(pointer('pointerdown', { pointerId: 3, clientX: 12, clientY: 12 }));
    approve.dispatchEvent(pointer('pointerup', { pointerId: 3, clientX: 12, clientY: 12 }));
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    approve.dispatchEvent(menu);

    // The interface keeps its own clicks, and the canvas never captures them.
    expect(harness.captured).toEqual([]);
    expect(menu.defaultPrevented).toBe(false);
    expect(harness.graph.pickFromPointer).not.toHaveBeenCalled();
    expect(harness.graph.select).not.toHaveBeenCalled();
    expect(intentsOf(harness.intents, 'camera-orbit')).toHaveLength(0);
    // Any real gesture still counts as the first user gesture for audio.
    expect(intentsOf(harness.intents, 'audio-unlock')).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Keyboard                                                                   */
/* -------------------------------------------------------------------------- */

describe('input router keyboard', () => {
  it('never fires hotkeys while a text field has focus', () => {
    const harness = setup();
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(input, editable);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    editable.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }));

    // The key press is still a user gesture for audio, but no hotkey fires.
    expect(harness.intents.filter((intent) => intent.type !== 'audio-unlock')).toEqual([]);
    expect(harness.camera.orbit).not.toHaveBeenCalled();
    expect(harness.graph.select).not.toHaveBeenCalled();
  });

  it('toggles pause on Space and selects speeds on 1 / 2 / 4', () => {
    const harness = setup();

    const space = press(' ');
    expect(space.defaultPrevented).toBe(true);
    expect(intentsOf(harness.intents, 'pause')).toEqual([
      { type: 'pause', source: 'keyboard', paused: true },
    ]);
    expect(harness.router.time).toEqual({ speed: DEFAULT_TIME_SPEED, paused: true });

    press(' ');
    expect(intentsOf(harness.intents, 'pause')[1]?.paused).toBe(false);

    press(' ');
    press('4');
    expect(intentsOf(harness.intents, 'speed')).toEqual([
      { type: 'speed', source: 'keyboard', speed: 4 },
    ]);
    // Selecting a speed resumes playback.
    expect(harness.router.time).toEqual({ speed: 4, paused: false });

    press('2');
    expect(harness.router.time.speed).toBe(2);
    // 3 is not a speed; the router leaves the key to the page.
    expect(press('3').defaultPrevented).toBe(false);
    expect(intentsOf(harness.intents, 'speed')).toHaveLength(2);
  });

  it('nudges, pans and zooms the camera from the keyboard', () => {
    const harness = setup();

    const right = press('ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(harness.camera.orbit).toHaveBeenCalledWith(ORBIT_NUDGE_RADIANS, 0);
    expect(intentsOf(harness.intents, 'camera-nudge')[0]).toEqual({
      type: 'camera-nudge',
      source: 'keyboard',
      direction: 'right',
      action: 'orbit',
    });

    press('ArrowUp', { shiftKey: true });
    expect(harness.camera.pan).toHaveBeenCalledWith(0, PAN_NUDGE_FRACTION);
    expect(intentsOf(harness.intents, 'camera-nudge')[1]).toMatchObject({
      direction: 'up',
      action: 'pan',
    });
    expect(harness.camera.orbit).toHaveBeenCalledTimes(1);

    press('ArrowDown');
    expect(harness.camera.orbit).toHaveBeenLastCalledWith(0, -POLAR_NUDGE_RADIANS);
    press('ArrowLeft', { shiftKey: true });
    expect(harness.camera.pan).toHaveBeenLastCalledWith(-PAN_NUDGE_FRACTION, 0);

    press('=');
    expect(harness.camera.zoom).toHaveBeenCalledWith(1 / ZOOM_NUDGE_FACTOR);
    press('PageDown');
    expect(harness.camera.zoom).toHaveBeenLastCalledWith(ZOOM_NUDGE_FACTOR);

    // Held camera keys repeat; toggles do not.
    const nudges = intentsOf(harness.intents, 'camera-nudge').length;
    press('ArrowRight', { repeat: true });
    expect(intentsOf(harness.intents, 'camera-nudge')).toHaveLength(nudges + 1);
    press('i', { repeat: true });
    expect(intentsOf(harness.intents, 'panel')).toHaveLength(0);
  });

  it('frames the plan graph on F', () => {
    const harness = setup();
    expect(press('f').defaultPrevented).toBe(true);
    expect(intentsOf(harness.intents, 'camera-focus')).toEqual([
      { type: 'camera-focus', source: 'keyboard' },
    ]);
  });

  it('walks the plan with the keyboard cursor and moves the visible selection', () => {
    const harness = setup();

    press(']');
    expect(harness.graph.select).toHaveBeenLastCalledWith('task-a');
    expect(harness.router.focusedTaskId).toBe('task-a');
    expect(intentsOf(harness.intents, 'select')[0]).toEqual({
      type: 'select',
      source: 'keyboard',
      taskId: 'task-a',
    });

    press('.');
    expect(harness.router.focusedTaskId).toBe('task-b');
    press(',');
    expect(harness.router.focusedTaskId).toBe('task-a');
    press(',');
    expect(harness.router.focusedTaskId).toBe('task-c'); // wraps backwards
    expect(harness.graph.select.mock.calls.map((call) => call[0])).toEqual([
      'task-a',
      'task-b',
      'task-a',
      'task-c',
    ]);
  });

  it('activates, dispatches and approves the focused task from the keyboard', () => {
    const harness = setup({ laneOf: (taskId) => (taskId === 'task-a' ? 'lane-build' : null) });

    // Nothing focused yet: dispatch has nothing to send.
    expect(press('d').defaultPrevented).toBe(false);
    expect(intentsOf(harness.intents, 'dispatch')).toHaveLength(0);

    press(']');
    const dispatch = press('d');
    expect(dispatch.defaultPrevented).toBe(true);
    expect(intentsOf(harness.intents, 'dispatch')).toEqual([
      { type: 'dispatch', source: 'keyboard', taskId: 'task-a', laneId: 'lane-build' },
    ]);

    press('a');
    expect(intentsOf(harness.intents, 'approve')).toEqual([
      { type: 'approve', source: 'keyboard', taskId: 'task-a' },
    ]);

    press('Enter');
    expect(intentsOf(harness.intents, 'select').at(-1)).toEqual({
      type: 'select',
      source: 'keyboard',
      taskId: 'task-a',
    });
  });

  it('toggles panels on I / O / V / C and closes them on Escape', () => {
    const harness = setup();

    expect(press('i').defaultPrevented).toBe(true);
    expect(intentsOf(harness.intents, 'panel')).toEqual([
      { type: 'panel', source: 'keyboard', panel: 'inspector', open: true },
    ]);
    expect(harness.router.panel).toBe('inspector');

    press('i');
    expect(intentsOf(harness.intents, 'panel')[1]?.open).toBe(false);
    expect(harness.router.panel).toBeNull();

    press('o');
    press('v');
    expect(intentsOf(harness.intents, 'panel')[3]).toEqual({
      type: 'panel',
      source: 'keyboard',
      panel: 'report',
      open: true,
    });
    expect(harness.router.panel).toBe('report');

    const escape = press('Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(intentsOf(harness.intents, 'panel').at(-1)).toEqual({
      type: 'panel',
      source: 'keyboard',
      panel: 'report',
      open: false,
    });
    expect(harness.router.panel).toBeNull();

    // Escape with nothing open means nothing to close.
    expect(press('Escape').defaultPrevented).toBe(false);
    expect(intentsOf(harness.intents, 'panel')).toHaveLength(5);
  });

  it('leaves bare Tab, B and browser shortcuts to the page', () => {
    const harness = setup();

    expect(press('Tab').defaultPrevented).toBe(false);
    expect(press('b').defaultPrevented).toBe(false);
    expect(press('1', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('1', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press('Escape', { altKey: true }).defaultPrevented).toBe(false);
    expect(harness.intents.filter((intent) => intent.type !== 'audio-unlock')).toEqual([]);
    expect(harness.router.panel).toBeNull();
  });

  it('leaves Space and Enter on a focused control to that control', () => {
    const harness = setup();
    const button = document.createElement('button');
    button.type = 'button';
    document.body.append(button);
    button.focus();

    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    button.dispatchEvent(space);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(enter);

    expect(space.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    expect(intentsOf(harness.intents, 'pause')).toHaveLength(0);
    expect(intentsOf(harness.intents, 'select')).toHaveLength(0);
  });

  it('ignores keys another layer consumed or guarded', () => {
    const harness = setup();
    const consumed = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    consumed.preventDefault();
    document.body.dispatchEvent(consumed);
    expect(intentsOf(harness.intents, 'pause')).toHaveLength(0);

    const guarded = setup({ keyGuard: () => true });
    press(' ');
    press(']');
    press('i');
    expect(guarded.intents.filter((intent) => intent.type !== 'audio-unlock')).toEqual([]);

    guarded.router.syncTime({ paused: false });
    expect(guarded.router.time.paused).toBe(false);
  });

  it('mirrors panel and time state pushed by the flow layer', () => {
    const harness = setup();

    harness.router.syncTime({ speed: 4, paused: true });
    expect(harness.router.time).toEqual({ speed: 4, paused: true });
    press(' ');
    expect(intentsOf(harness.intents, 'pause')[0]?.paused).toBe(false);

    harness.router.syncPanel('report');
    expect(harness.router.panel).toBe('report');
    press('v');
    expect(intentsOf(harness.intents, 'panel')).toEqual([
      { type: 'panel', source: 'keyboard', panel: 'report', open: false },
    ]);
    expect(harness.router.panel).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Audio unlock and disposal                                                  */
/* -------------------------------------------------------------------------- */

describe('input router audio and disposal', () => {
  it('unlocks audio once on the first gesture and cues discrete actions', () => {
    const harness = setup();
    expect(harness.router.audioUnlockRequested).toBe(false);

    click(harness.surface, 60, 60, { pointerId: 1 });

    expect(harness.router.audioUnlockRequested).toBe(true);
    expect(harness.audio.unlock).toHaveBeenCalledTimes(1);
    const unlocks = intentsOf(harness.intents, 'audio-unlock');
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]?.source).toBe('pointer');
    // The click that unlocked audio also cues the interface.
    expect(harness.audio.trigger).toHaveBeenCalledWith('ui-click');

    // Later gestures never ask again.
    press(' ');
    harness.surface.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
    );
    harness.surface.dispatchEvent(pointer('pointerdown', { pointerId: 2, clientX: 10, clientY: 10 }));
    harness.surface.dispatchEvent(pointer('pointerup', { pointerId: 2, clientX: 10, clientY: 10 }));

    expect(harness.audio.unlock).toHaveBeenCalledTimes(1);
    expect(intentsOf(harness.intents, 'audio-unlock')).toHaveLength(1);
  });

  it('unlocks on the first key press when the keyboard comes first', () => {
    const harness = setup();
    press(' ');

    const unlocks = intentsOf(harness.intents, 'audio-unlock');
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]?.source).toBe('keyboard');
    expect(harness.audio.unlock).toHaveBeenCalledTimes(1);

    press('i');
    expect(harness.audio.unlock).toHaveBeenCalledTimes(1);
  });

  it('disposes every listener idempotently', () => {
    const harness = setup();
    harness.surface.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }));
    harness.surface.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 90, clientY: 10 }));
    expect(harness.router.attachedListeners).toBe(9);

    harness.router.dispose();
    expect(harness.router.disposed).toBe(true);
    expect(harness.router.attachedListeners).toBe(0);
    // The pending drag releases its pointer capture on the way out.
    expect(harness.released).toEqual([1]);

    const intents = harness.intents.length;
    harness.camera.orbit.mockClear();
    harness.graph.select.mockClear();
    harness.surface.dispatchEvent(pointer('pointerdown', { pointerId: 2, clientX: 10, clientY: 10 }));
    harness.surface.dispatchEvent(pointer('pointerup', { pointerId: 2, clientX: 10, clientY: 10 }));
    harness.surface.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
    );
    press(' ');
    press(']');
    press('ArrowRight');

    expect(harness.intents.length).toBe(intents);
    expect(harness.camera.orbit).not.toHaveBeenCalled();
    expect(harness.graph.select).not.toHaveBeenCalled();
    expect(harness.router.handleKey(new KeyboardEvent('keydown', { key: ' ' }))).toBe(false);

    harness.router.dispose();
    expect(harness.router.attachedListeners).toBe(0);
  });

  it('picks programmatically through the same contract', () => {
    const harness = setup();
    harness.graph.pick = pickOf('task-c');

    const intent = harness.router.pickAt(120, 80);

    expect(intent.taskId).toBe('task-c');
    expect(intent.pointerId).toBe(0);
    expect(harness.graph.pickFromPointer).toHaveBeenCalledWith(120, 80, expect.anything());
    expect(harness.router.focusedTaskId).toBe('task-c');
  });
});

/* -------------------------------------------------------------------------- */
/* Real phase-2 contracts                                                     */
/* -------------------------------------------------------------------------- */

describe('input router over the real camera rig, plan graph and audio bus', () => {
  it('accepts the shipped presentation contracts as targets', () => {
    const rig = createCameraRig({
      camera: new PerspectiveCamera(52, 16 / 9, 0.1, 400),
      state: 'plan',
      drift: false,
    });
    const view = createPlanGraphView(new Object3D());
    const bus = createAudioBus();
    // Structural compatibility with the phase-2 contracts: these three lines
    // stop compiling the moment a consumed contract drifts.
    const camera: InputCameraTarget = rig;
    const graph: InputGraphTarget = view;
    const audio: InputAudioTarget = bus;

    expect(typeof camera.orbit).toBe('function');
    expect(typeof graph.pickFromPointer).toBe('function');
    expect(typeof audio.unlock).toBe('function');
    expect(typeof audio.trigger).toBe('function');

    rig.dispose();
    view.dispose();
    bus.dispose();
  });

  it('unlocks the real audio bus exactly once from a canvas gesture', () => {
    const { element } = createSurface();
    const bus = createAudioBus();
    const unlock = vi.spyOn(bus, 'unlock');
    // happy-dom ships no WebAudio. The bus reports that and stays silent; the
    // router must keep working, so the warning is asserted here instead of
    // leaking into the test output.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const router = createInputRouter({ canvas: element, audio: bus });
    openRouters.push(router);

    click(element, 40, 40, { pointerId: 1 });
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(router.audioUnlockRequested).toBe(true);
    // The request is the router's contract, the graph is the bus's: with no
    // WebAudio the bus declines (and says so) rather than breaking input, and a
    // cue attempt is answered, never thrown.
    expect(warn).toHaveBeenCalled();
    expect(bus.stats.contextsCreated).toBe(0);
    expect(typeof bus.trigger('ui-click')).toBe('boolean');

    click(element, 80, 40, { pointerId: 2 });
    expect(unlock).toHaveBeenCalledTimes(1);

    router.dispose();
    bus.dispose();
  });

  it('picks and selects a real task node from a canvas click', () => {
    const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
    const view = createPlanGraphView(adapter.scene);
    view.setCamera(adapter.camera);
    view.update(createSampleState());

    const node = view.nodes.find((candidate) => candidate.active);
    if (!node) throw new Error('the sample mission should have at least one active task node');

    const rig = createCameraRig({ camera: adapter.camera, state: 'plan', drift: false });
    // Aim the adapter camera at the node so the click lands on it, exactly as
    // tests/plan-graph.test.ts does for the picking contract itself.
    const radial = new Vector3(node.position.x, 0, node.position.z);
    if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
    radial.normalize();
    adapter.camera.position.set(
      node.position.x + radial.x * 30,
      node.position.y,
      node.position.z + radial.z * 30,
    );
    adapter.camera.lookAt(node.position);
    adapter.camera.updateProjectionMatrix();
    adapter.camera.updateMatrixWorld();

    const { element } = createSurface();
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: (): DOMRect =>
        ({
          left: 0,
          top: 0,
          right: 1280,
          bottom: 720,
          width: 1280,
          height: 720,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    const intents: InputIntent[] = [];
    const router = createInputRouter({
      canvas: element,
      camera: rig,
      graph: view,
      onIntent: (intent) => void intents.push(intent),
    });
    openRouters.push(router);

    const anchor = screenAnchorOf(node.position, adapter.camera);
    click(element, anchor.x * 1280, anchor.y * 720, { pointerId: 1 });

    const pick = intentsOf(intents, 'pick')[0];
    expect(pick?.taskId).toBe(node.id);
    expect(pick?.screen?.x).toBeCloseTo(anchor.x, 3);
    expect(view.selectedTaskId).toBe(node.id);
    expect(router.focusedTaskId).toBe(node.id);
    expect(intentsOf(intents, 'select')[0]?.taskId).toBe(node.id);

    router.dispose();
    rig.dispose();
    view.dispose();
    adapter.dispose();
  });

  it('drives the real rig into free flight from a drag and from arrow keys', () => {
    const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
    const rig = createCameraRig({ camera: adapter.camera, state: 'plan', drift: false });
    expect(rig.mode).toBe('named');

    const { element } = createSurface();
    const router = createInputRouter({ canvas: element, camera: rig });
    openRouters.push(router);

    const azimuthBefore = rig.target.azimuth;
    drag(element, [200, 100], [260, 130], { pointerId: 1 });
    expect(rig.mode).toBe('free');
    expect(rig.target.azimuth).not.toBeCloseTo(azimuthBefore, 6);

    const altitudeBefore = rig.target.polar;
    press('ArrowUp');
    expect(rig.target.polar).toBeGreaterThan(altitudeBefore);

    const distanceBefore = rig.target.distance;
    press('=');
    expect(rig.target.distance).toBeLessThan(distanceBefore);

    // The damping carries the free pose onto the camera itself. The rig clamps
    // one update to `MAX_CAMERA_STEP_MS`, so step it the way the loop would.
    const cameraBefore = rig.camera.position.clone();
    for (let step = 0; step < 12; step += 1) rig.update(100);
    expect(rig.pose.azimuth).toBeCloseTo(rig.target.azimuth, 2);
    expect(rig.camera.position.equals(cameraBefore)).toBe(false);

    router.dispose();
    rig.dispose();
    adapter.dispose();
  });

  it('dispatches the keyboard-focused task with the lane the graph reports', () => {
    const adapter = createHeadlessAdapter({ width: 1024, height: 640 });
    const view = createPlanGraphView(adapter.scene);
    view.setCamera(adapter.camera);
    view.update(createSampleState());

    const { element } = createSurface();
    const intents: InputIntent[] = [];
    const router = createInputRouter({
      canvas: element,
      graph: view,
      taskOrder: () => view.nodes.map((task) => task.id),
      laneOf: (taskId) => view.node(taskId)?.laneId ?? null,
      onIntent: (intent) => void intents.push(intent),
    });
    openRouters.push(router);

    press(']');
    const focused = router.focusedTaskId;
    expect(focused).not.toBeNull();
    expect(view.selectedTaskId).toBe(focused);

    press('d');
    const dispatch = intentsOf(intents, 'dispatch')[0];
    const node = focused === null ? undefined : view.node(focused);
    expect(dispatch?.taskId).toBe(focused);
    expect(dispatch?.laneId).toBe(node?.laneId);
    expect(dispatch?.laneId).toBeTruthy();

    press('a');
    expect(intentsOf(intents, 'approve')[0]?.taskId).toBe(focused);

    router.dispose();
    view.dispose();
    adapter.dispose();
  });
});
