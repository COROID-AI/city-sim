/**
 * Chrono City — timeline HUD suite.
 *
 * Exercises the three modules of the era HUD against the *real* upstream
 * systems rather than doubles:
 *
 *  - `src/ui/timelineSlider.ts` — exactly five stops (1945 / 1965 / 1985 /
 *    2005 / 2025), click / drag / touch / keyboard input, aria + tooltip.
 *  - `src/ui/helpOverlay.ts` — the controls cheat-sheet, its focus handling and
 *    the mode-aware copy.
 *  - `src/ui/hudApi.ts` — the composition seam: slider ⇄ `TimelineRuntime`
 *    mirrored in both directions through `SceneContext.tick()`, the mute toggle
 *    and unlock path against a real `AudioDirector`, the UI click/tick SFX, the
 *    toast / era-info helpers and the global handle.
 *
 * The Web Audio implementation at the top is a small in-memory stub — it owns a
 * real gain graph, real `AudioParam` automation records and a real `resume()`,
 * so the director under test is the production class, not a mock.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  AUDIO_GLOBAL_KEY,
  AudioDirector,
  createAudioDirector,
  type AudioEngineContext,
} from '../../src/audio/audioDirector';
import { UI_CLICK_CUE, createSfxLibrary } from '../../src/audio/sfxSynth';
import { ERA_IDS, type EraId } from '../../src/core/eraContracts';
import {
  SceneContext,
  createSceneContext,
  type SceneContextOptions,
} from '../../src/core/sceneContext';
import {
  TimelineRuntime,
  createTimelineRuntime,
} from '../../src/era/timelineRuntime';
import { HELP_SELECTORS, defaultHelpSections } from '../../src/ui/helpOverlay';
import {
  HUD_CLICK_RATE,
  HUD_GLOBAL_KEY,
  HUD_SELECTORS,
  HUD_SYSTEM_ID,
  HUD_SYSTEM_ORDER,
  HUD_TICK_RATE,
  HudApi,
  TIMELINE_GLOBAL_KEY,
  bootHudApi,
  createHudApi,
  getHudApi,
} from '../../src/ui/hudApi';
import {
  TIMELINE_SELECTORS,
  TimelineSlider,
  createTimelineSlider,
  type TimelineInteraction,
} from '../../src/ui/timelineSlider';

/* ------------------------------------------------------------------ */
/* Web Audio stub                                                      */
/* ------------------------------------------------------------------ */

interface StubParam {
  value: number;
  setValueAtTime(value: number, time: number): StubParam;
  linearRampToValueAtTime(value: number, time: number): StubParam;
  exponentialRampToValueAtTime(value: number, time: number): StubParam;
  setTargetAtTime(value: number, time: number, constant: number): StubParam;
  cancelScheduledValues(time: number): StubParam;
  cancelAndHoldAtTime(time: number): StubParam;
}

function createStubParam(value = 0): StubParam {
  const param: StubParam = {
    value,
    setValueAtTime(next: number) {
      param.value = next;
      return param;
    },
    linearRampToValueAtTime(next: number) {
      param.value = next;
      return param;
    },
    exponentialRampToValueAtTime(next: number) {
      param.value = next;
      return param;
    },
    setTargetAtTime(next: number) {
      param.value = next;
      return param;
    },
    cancelScheduledValues() {
      return param;
    },
    cancelAndHoldAtTime() {
      return param;
    },
  };
  return param;
}

class StubNode {
  readonly kind: string;

  constructor(kind: string) {
    this.kind = kind;
  }

  connect(target: unknown): unknown {
    return target;
  }

  disconnect(): void {}
}

class StubSource extends StubNode {
  onended: (() => void) | null = null;
  private endedListeners: Array<() => void> = [];

  start(): void {}

  stop(): void {}

  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.endedListeners.push(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type !== 'ended') return;
    this.endedListeners = this.endedListeners.filter((entry) => entry !== listener);
  }
}

class StubGain extends StubNode {
  readonly gain = createStubParam(1);

  constructor() {
    super('gain');
  }
}

class StubPanner extends StubNode {
  readonly positionX = createStubParam(0);
  readonly positionY = createStubParam(0);
  readonly positionZ = createStubParam(0);
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;

  constructor() {
    super('panner');
  }
}

class StubOscillator extends StubSource {
  type = 'sine';
  readonly frequency = createStubParam(440);

  constructor() {
    super('oscillator');
  }
}

class StubBufferSource extends StubSource {
  buffer: StubBuffer | null = null;
  loop = false;
  readonly playbackRate = createStubParam(1);

  constructor() {
    super('bufferSource');
  }
}

class StubBiquadFilter extends StubNode {
  type = 'lowpass';
  readonly frequency = createStubParam(350);
  readonly Q = createStubParam(1);

  constructor() {
    super('biquad');
  }
}

class StubBuffer {
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    void sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] as Float32Array;
  }
}

class StubListener {
  readonly positionX = createStubParam(0);
  readonly positionY = createStubParam(0);
  readonly positionZ = createStubParam(0);
  readonly forwardX = createStubParam(0);
  readonly forwardY = createStubParam(0);
  readonly forwardZ = createStubParam(-1);
  readonly upX = createStubParam(0);
  readonly upY = createStubParam(1);
  readonly upZ = createStubParam(0);
}

class StubAudioContext {
  readonly destination = new StubNode('destination');
  readonly listener = new StubListener();
  sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = 'suspended';
  resumeCalls = 0;

  createGain(): StubGain {
    return new StubGain();
  }

  createPanner(): StubPanner {
    return new StubPanner();
  }

  createOscillator(): StubOscillator {
    return new StubOscillator();
  }

  createBufferSource(): StubBufferSource {
    return new StubBufferSource();
  }

  createBiquadFilter(): StubBiquadFilter {
    return new StubBiquadFilter();
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): StubBuffer {
    return new StubBuffer(numberOfChannels, length, sampleRate);
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

/* ------------------------------------------------------------------ */
/* Harness helpers                                                     */
/* ------------------------------------------------------------------ */

const openHuds: HudApi[] = [];
const openSliders: TimelineSlider[] = [];
const openDirectors: AudioDirector[] = [];
const openTimelines: TimelineRuntime[] = [];
const openContexts: SceneContext[] = [];

function createStubRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render: () => undefined,
    setAnimationLoop: () => undefined,
    dispose: () => undefined,
  };
  return stub as unknown as THREE.WebGLRenderer;
}

/** A scene context wired to the overlay root the HUD expects. */
function openSceneContext(options: SceneContextOptions = {}): SceneContext {
  const container = document.createElement('div');
  const overlayRoot = document.createElement('div');
  overlayRoot.setAttribute('data-chrono-overlay', '');
  container.appendChild(overlayRoot);
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  const context = createSceneContext({
    canvas,
    container,
    overlayRoot,
    autoResize: false,
    autoStart: false,
    maxPixelRatio: 1,
    createRenderer: () => createStubRenderer(canvas),
    ...options,
  });
  openContexts.push(context);
  return context;
}

function openDirector(state: AudioContextState = 'suspended'): {
  director: AudioDirector;
  stub: StubAudioContext;
} {
  const stub = new StubAudioContext();
  stub.state = state;
  const director = createAudioDirector({
    createAudioContext: () => stub as unknown as AudioEngineContext,
  });
  director.registerCues(createSfxLibrary());
  openDirectors.push(director);
  return { director, stub };
}

interface Composition {
  readonly context: SceneContext;
  readonly timeline: TimelineRuntime;
  readonly director: AudioDirector | null;
  readonly hud: HudApi;
}

/** HUD + timeline + (optional) audio on one scene, exactly as the app wires it. */
function openComposition(
  options: { durationMs?: number; initialEra?: EraId; withAudio?: boolean } = {},
): Composition {
  const context = openSceneContext();
  const timeline = createTimelineRuntime({
    initialEra: options.initialEra ?? '2025',
    durationMs: options.durationMs ?? 0,
  });
  timeline.attach(context);
  openTimelines.push(timeline);
  const director = options.withAudio ? openDirector().director : null;
  const hud = createHudApi({ context, timeline, audio: director, integrateGlobal: false });
  openHuds.push(hud);
  return { context, timeline, director, hud };
}

/** A standalone slider in its own mount, with the interactions it reported. */
function openSlider(): {
  container: HTMLElement;
  slider: TimelineSlider;
  interactions: TimelineInteraction[];
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const interactions: TimelineInteraction[] = [];
  const slider = createTimelineSlider({
    root: container,
    onInteract: (interaction) => interactions.push(interaction),
  });
  openSliders.push(slider);
  return { container, slider, interactions };
}

/** jsdom has no `PointerEvent` in every build, so synthesise whichever exists. */
function pointerEvent(
  type: string,
  init: { clientX?: number; clientY?: number; pointerType?: string; pointerId?: number; button?: number } = {},
): Event {
  const { clientX = 0, clientY = 0, pointerType = 'mouse', pointerId = 1, button = 0 } = init;
  const Ctor = (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent;
  if (typeof Ctor === 'function') {
    return new Ctor(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerType,
      pointerId,
      button,
    });
  }
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

function keyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

/** jsdom reports a zero-sized rect, so give the track real geometry. */
function stubTrackRect(track: HTMLElement, left: number, width: number): void {
  track.getBoundingClientRect = () =>
    ({
      x: left,
      y: 0,
      left,
      top: 0,
      width,
      height: 42,
      right: left + width,
      bottom: 42,
      toJSON: () => ({}),
    }) as unknown as DOMRect;
}

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  while (openHuds.length > 0) openHuds.pop()?.dispose();
  while (openSliders.length > 0) openSliders.pop()?.dispose();
  while (openTimelines.length > 0) openTimelines.pop()?.dispose();
  while (openDirectors.length > 0) openDirectors.pop()?.dispose();
  while (openContexts.length > 0) openContexts.pop()?.dispose();
  delete (window as unknown as Record<string, unknown>)[HUD_GLOBAL_KEY];
  delete (window as unknown as Record<string, unknown>)[TIMELINE_GLOBAL_KEY];
  delete (window as unknown as Record<string, unknown>)[AUDIO_GLOBAL_KEY];
  delete (window as unknown as Record<string, unknown>).__chronoCity;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Slider: five stops and input paths                                  */
/* ------------------------------------------------------------------ */

describe('timeline slider — five stops', () => {
  it('presents exactly 1945, 1965, 1985, 2005 and 2025, in order', () => {
    const { slider } = openSlider();

    expect(ERA_IDS).toEqual(['1945', '1965', '1985', '2005', '2025']);
    expect(slider.stopElements).toHaveLength(5);
    expect(slider.stopElements.map((element) => element.dataset.chronoTimelineYear)).toEqual([
      '1945',
      '1965',
      '1985',
      '2005',
      '2025',
    ]);
    expect(slider.root.dataset.chronoTimelineCount).toBe('5');
    expect(slider.track.getAttribute('aria-valuemin')).toBe('1945');
    expect(slider.track.getAttribute('aria-valuemax')).toBe('2025');
    expect(slider.track.getAttribute('role')).toBe('slider');
    expect(slider.track.getAttribute('tabindex')).toBe('0');
  });

  it('starts on the newest era and renders the era title plus tooltip', () => {
    const { slider } = openSlider();

    expect(slider.selectedEra).toBe('2025');
    expect(slider.selectedYear).toBe(2025);
    expect(slider.titleElement.textContent).toBe('Contemporary City');
    expect(slider.yearElement.textContent).toBe('2025');
    expect(slider.tooltipLabelElement.textContent).toBe('2025 — Contemporary City');
    expect(slider.tooltipCopyElement.textContent?.length ?? 0).toBeGreaterThan(10);
    expect(slider.track.getAttribute('aria-valuetext')).toBe('2025 — Contemporary City');
    expect(slider.track.getAttribute('aria-valuenow')).toBe('2025');
  });

  it('marks exactly one stop active at a time', () => {
    const { slider } = openSlider();
    const active = () =>
      slider.stopElements
        .map((element, index) => (element.dataset.chronoTimelineActive === 'true' ? index : -1))
        .filter((index) => index >= 0);

    expect(active()).toEqual([4]);
    slider.setEra('1945');
    expect(active()).toEqual([0]);
  });

  it('mirrors an external year without reporting it back as a user interaction', () => {
    const { slider, interactions } = openSlider();

    slider.setEra('1985');

    expect(slider.selectedEra).toBe('1985');
    expect(slider.selectedIndex).toBe(2);
    expect(interactions).toEqual([]);
    expect(slider.root.dataset.chronoTimelineEra).toBe('1985');
    expect(slider.root.dataset.chronoTimelineYear).toBe('1985');
  });

  it('snaps out-of-range years onto the nearest stop', () => {
    const { slider } = openSlider();

    slider.setEra(1990);
    expect(slider.selectedYear).toBe(1985);
    slider.setEra(1900);
    expect(slider.selectedYear).toBe(1945);
    slider.setEra(9999);
    expect(slider.selectedYear).toBe(2025);
  });
});

describe('timeline slider — pointer, drag, touch and keyboard input', () => {
  it('selects a year on click and reports the click source', () => {
    const { slider, interactions } = openSlider();
    stubTrackRect(slider.track, 0, 100);

    // 25% along a 100px track is the second of five stops (1965).
    slider.track.dispatchEvent(pointerEvent('pointerdown', { clientX: 25 }));

    expect(slider.selectedYear).toBe(1965);
    const last = interactions.at(-1) as TimelineInteraction;
    expect(last.source).toBe('click');
    expect(last.selection).toBe(true);
    expect(last.sound).toBe('click');
    expect(last.era).toBe('1965');
    expect(last.index).toBe(1);
  });

  it('scrubs across stops while dragging and never leaves a valid year', () => {
    const { slider, interactions } = openSlider();
    stubTrackRect(slider.track, 0, 100);

    slider.track.dispatchEvent(pointerEvent('pointerdown', { clientX: 0 }));
    expect(slider.selectedYear).toBe(1945);
    expect(slider.isDragging).toBe(true);
    expect(slider.root.dataset.chronoTimelineState).toBe('dragging');

    slider.track.dispatchEvent(pointerEvent('pointermove', { clientX: 50 }));
    expect(slider.selectedYear).toBe(1985);

    // Way past the end: clamped to the newest authored stop, never 2200.
    slider.track.dispatchEvent(pointerEvent('pointermove', { clientX: 900 }));
    expect(slider.selectedYear).toBe(2025);

    slider.track.dispatchEvent(pointerEvent('pointerup', { clientX: 900 }));
    expect(slider.isDragging).toBe(false);
    expect(slider.root.dataset.chronoTimelineState).toBe('settled');

    expect(interactions.map((entry) => entry.year)).toEqual([1945, 1985, 2025]);
    expect(interactions.every((entry) => ERA_IDS.includes(String(entry.year) as EraId))).toBe(true);
    expect(interactions[1]?.source).toBe('drag');
    expect(interactions[1]?.sound).toBe('tick');
  });

  it('stays silent while the pointer stays inside the same stop', () => {
    const { slider, interactions } = openSlider();
    stubTrackRect(slider.track, 0, 100);

    slider.track.dispatchEvent(pointerEvent('pointerdown', { clientX: 0 }));
    slider.track.dispatchEvent(pointerEvent('pointermove', { clientX: 3 }));
    slider.track.dispatchEvent(pointerEvent('pointermove', { clientX: 5 }));

    expect(slider.selectedYear).toBe(1945);
    expect(interactions).toHaveLength(1);
  });

  it('supports touch drag and tap', () => {
    const { slider, interactions } = openSlider();
    stubTrackRect(slider.track, 0, 100);

    slider.track.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, pointerType: 'touch' }));
    expect(slider.selectedYear).toBe(1945);

    slider.track.dispatchEvent(pointerEvent('pointermove', { clientX: 75, pointerType: 'touch' }));
    expect(slider.selectedYear).toBe(2005);
    expect(interactions.at(-1)?.source).toBe('touch');

    slider.track.dispatchEvent(pointerEvent('pointerup', { clientX: 75, pointerType: 'touch' }));
    expect(slider.selectedYear).toBe(2005);
  });

  it('steps years with the arrow, home and end keys', () => {
    const { slider, interactions } = openSlider();

    slider.setEra('1985');
    slider.track.dispatchEvent(keyEvent('ArrowRight'));
    expect(slider.selectedYear).toBe(2005);
    slider.track.dispatchEvent(keyEvent('ArrowLeft'));
    expect(slider.selectedYear).toBe(1985);
    slider.track.dispatchEvent(keyEvent('Home'));
    expect(slider.selectedYear).toBe(1945);
    slider.track.dispatchEvent(keyEvent('End'));
    expect(slider.selectedYear).toBe(2025);

    expect(interactions.every((entry) => entry.source === 'keyboard')).toBe(true);
    expect(interactions.every((entry) => entry.sound === 'tick')).toBe(true);
  });

  it('clamps arrow stepping at both ends of the timeline', () => {
    const { slider } = openSlider();

    slider.setEra('1945');
    slider.track.dispatchEvent(keyEvent('ArrowLeft'));
    expect(slider.selectedYear).toBe(1945);
    slider.setEra('2025');
    slider.track.dispatchEvent(keyEvent('ArrowRight'));
    expect(slider.selectedYear).toBe(2025);
  });

  it('activates the focused year on Enter and Space', () => {
    const { slider, interactions } = openSlider();
    slider.setEra('1985');

    slider.track.dispatchEvent(keyEvent('Enter'));
    expect(interactions.at(-1)?.activation).toBe(true);
    expect(interactions.at(-1)?.selection).toBe(false);
    expect(interactions.at(-1)?.sound).toBe('click');

    slider.track.dispatchEvent(keyEvent(' '));
    expect(interactions.at(-1)?.activation).toBe(true);
    expect(slider.selectedYear).toBe(1985);
  });

  it('treats a programmatic stop click as activation of that stop', () => {
    const { slider, interactions } = openSlider();

    slider.stopElements[1]?.click();

    expect(slider.selectedYear).toBe(1965);
    expect(interactions.at(-1)).toMatchObject({ era: '1965', selection: true, sound: 'click' });
  });

  it('keeps HUD keystrokes away from the window (camera) listeners', () => {
    const { slider } = openSlider();
    const seen: string[] = [];
    const listener = (event: Event): void => {
      seen.push((event as KeyboardEvent).key);
    };
    window.addEventListener('keydown', listener);
    const consumed = keyEvent('ArrowRight');
    slider.track.dispatchEvent(consumed);
    window.removeEventListener('keydown', listener);

    expect(seen).toEqual([]);
    expect(consumed.defaultPrevented).toBe(true);
  });

  it('keeps HUD pointer gestures away from the page listeners', () => {
    const { slider } = openSlider();
    stubTrackRect(slider.track, 0, 100);
    const seen: Event[] = [];
    const listener = (event: Event): void => {
      seen.push(event);
    };
    document.addEventListener('pointerdown', listener);
    const consumed = pointerEvent('pointerdown', { clientX: 50 });
    slider.track.dispatchEvent(consumed);
    document.removeEventListener('pointerdown', listener);

    expect(seen).toEqual([]);
    expect(consumed.defaultPrevented).toBe(true);
  });

  it('takes DOM focus as a single tab stop with a visible focus state', () => {
    const { slider } = openSlider();

    slider.focus();

    expect(document.activeElement).toBe(slider.track);
    expect(slider.root.dataset.chronoTimelineFocus).toBe('true');
    slider.track.dispatchEvent(new FocusEvent('blur'));
    expect(slider.root.dataset.chronoTimelineFocus).toBe('false');
  });

  it('paints tween progress for the chrome', () => {
    const { slider } = openSlider();

    slider.setTransitionProgress(0.5);
    expect(slider.root.dataset.chronoTimelineProgress).toBe('0.500');
    slider.setTransitionProgress(1);
    expect(slider.root.dataset.chronoTimelineProgress).toBe('1.000');
  });

  it('detaches completely on dispose', () => {
    const { slider, interactions } = openSlider();

    slider.dispose();

    expect(slider.isDisposed).toBe(true);
    expect(slider.root.isConnected).toBe(false);
    slider.track.dispatchEvent(keyEvent('ArrowRight'));
    expect(interactions).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Composition: HUD ⇄ TimelineRuntime through SceneContext ticks        */
/* ------------------------------------------------------------------ */

describe('HudApi composition with TimelineRuntime', () => {
  it('mounts the chrome in the scene overlay root and joins the tick loop', () => {
    const { context, hud } = openComposition();

    expect(hud.root.parentElement).toBe(context.overlayRoot);
    expect(hud.root.getAttribute('data-chrono-hud')).toBe('root');
    expect(context.hasSystem(HUD_SYSTEM_ID)).toBe(true);
    expect(context.getSystem(HUD_SYSTEM_ID)?.order).toBe(HUD_SYSTEM_ORDER);
    expect(hud.snapshot().attached).toBe(true);
    expect(hud.slider?.root.parentElement).toBe(hud.timelineSlot);
    expect(hud.timelineSlot.querySelectorAll(TIMELINE_SELECTORS.stop)).toHaveLength(5);
  });

  it('reports exactly the five era stops in the HUD snapshot', () => {
    const { hud } = openComposition();

    expect(hud.snapshot().stops).toEqual([1945, 1965, 1985, 2005, 2025]);
    expect(hud.snapshot().timeline).toBe('shared');
  });

  it('drives TimelineRuntime from a slider selection (HUD → runtime)', () => {
    const { timeline, hud } = openComposition();

    hud.slider?.stopElements[2]?.click();

    expect(timeline.era).toBe('1985');
    expect(timeline.year).toBe(1985);
    expect(hud.year).toBe(1985);
    expect(hud.era).toBe('1985');
    expect(hud.slider?.titleElement.textContent).toBe('Neon Downtown');
    expect(hud.root.dataset.chronoHudEra).toBe('1985');
    expect(hud.root.dataset.chronoHudYear).toBe('1985');
    expect(hud.slider?.track.getAttribute('aria-valuenow')).toBe('1985');
  });

  it('mirrors an external runtime selection on the next SceneContext tick (runtime → HUD)', () => {
    const { context, timeline, hud } = openComposition();

    hud.slider?.stopElements[2]?.click();
    expect(hud.year).toBe(1985);

    // Another system moves the year. Until the scene ticks, the HUD's rendered
    // state is untouched — the tick is the single mirror path.
    timeline.selectEra('2005', { immediate: true });
    expect(timeline.era).toBe('2005');
    expect(hud.slider?.selectedEra).toBe('1985');
    expect(hud.root.dataset.chronoHudYear).toBe('1985');
    expect(hud.root.dataset.chronoHudEra).toBe('1985');

    context.tick(0.016);

    expect(hud.year).toBe(2005);
    expect(hud.slider?.selectedEra).toBe('2005');
    expect(hud.slider?.titleElement.textContent).toBe('Digital Turn');
    expect(hud.root.dataset.chronoHudYear).toBe('2005');
    expect(hud.root.dataset.chronoHudEra).toBe('2005');

    // ...and the HUD can then drive the runtime back the other way.
    hud.selectEra(1945);
    expect(timeline.era).toBe('1945');
    expect(hud.year).toBe(1945);
    expect(hud.slider?.selectedYear).toBe(1945);
  });

  it('keeps the slider in step with the running era tween across frames', () => {
    const { context, timeline, hud } = openComposition({ durationMs: 1000 });

    timeline.selectEra('1985', { durationMs: 1000 });
    context.tick(0.25);

    expect(hud.snapshot().transitioning).toBe(true);
    expect(hud.snapshot().progress).toBeGreaterThan(0);
    expect(hud.slider?.root.dataset.chronoTimelineProgress).not.toBe('1.000');
    expect(hud.root.dataset.chronoHudTransitioning).toBe('true');

    context.tick(0.75);

    expect(hud.snapshot().transitioning).toBe(false);
    expect(hud.snapshot().progress).toBe(1);
    expect(hud.slider?.root.dataset.chronoTimelineProgress).toBe('1.000');
    expect(hud.root.dataset.chronoHudTransitioning).toBe('false');
    expect(hud.slider?.selectedEra).toBe('1985');
  });

  it('walks the whole timeline one stop at a time through the keyboard', () => {
    const { context, timeline, hud } = openComposition({ initialEra: '1945' });

    expect(hud.year).toBe(1945);
    for (const expected of [1965, 1985, 2005, 2025]) {
      hud.slider?.track.dispatchEvent(keyEvent('ArrowRight'));
      context.tick(0.016);
      expect(timeline.year).toBe(expected);
      expect(hud.year).toBe(expected);
      expect(hud.slider?.track.getAttribute('aria-valuenow')).toBe(String(expected));
    }
  });

  it('steps eras and creates its own runtime when none is supplied', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = createHudApi({ root: container, integrateGlobal: false });
    openHuds.push(hud);

    expect(hud.snapshot().timeline).toBe('internal');
    expect(hud.ownsTimelineRuntime).toBe(true);
    expect(hud.year).toBe(2025);

    hud.stepEra(-1);
    expect(hud.year).toBe(2005);
    hud.stepEra(-4);
    expect(hud.year).toBe(1945);
    hud.stepEra(3);
    expect(hud.year).toBe(2005);
  });

  it('leaves the shared runtime alone when the HUD is disposed', () => {
    const { timeline, hud } = openComposition();

    hud.dispose();

    expect(timeline.isDisposed).toBe(false);
    expect(timeline.era).toBe('2025');
    expect(getHudApi()).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Era info + toasts                                                   */
/* ------------------------------------------------------------------ */

describe('HudApi era info and toasts', () => {
  it('describes the active era from the shared descriptor table', () => {
    const { hud } = openComposition({ initialEra: '1985' });
    const info = hud.eraInfo();

    expect(info.era).toBe('1985');
    expect(info.year).toBe(1985);
    expect(info.label).toBe('Neon Downtown');
    expect(info.description.length).toBeGreaterThan(10);
    expect(info.index).toBe(2);
    expect(info.total).toBe(5);
    expect(info.soundscapeId).toBe('soundscape-1985-neon');
    expect(info.transitioning).toBe(false);
  });

  it('resolves era info for any authored year and rejects unknown ones', () => {
    const { hud } = openComposition();

    expect(hud.eraInfo(1945).label).toBe('Post-war Reconstruction');
    expect(hud.eraInfo('2005').label).toBe('Digital Turn');
    expect(hud.eraInfo(1990).era).toBe('1985');
    expect(() => hud.eraInfo('whenever')).toThrow(RangeError);
  });

  it('pushes, dismisses and clears toasts', () => {
    const { hud } = openComposition();

    const first = hud.toast('Welcome to Chrono City', { tone: 'info', durationMs: 0, sound: null });
    const second = hud.toast('Era ready', { tone: 'era', durationMs: 0, sound: null });

    expect(hud.toastCount).toBe(2);
    expect(hud.snapshot().toasts).toEqual(['Welcome to Chrono City', 'Era ready']);
    expect(hud.toastsRegion.querySelectorAll(HUD_SELECTORS.toast)).toHaveLength(2);
    expect(first.element.dataset.chronoHudToastTone).toBe('info');
    expect(second.element.dataset.chronoHudToastTone).toBe('era');

    first.dismiss();
    expect(hud.toastCount).toBe(1);
    expect(hud.dismissToast('missing')).toBe(false);
    hud.clearToasts();
    expect(hud.toastCount).toBe(0);
  });

  it('auto-dismisses a timed toast', async () => {
    const { hud } = openComposition();

    hud.toast('Short lived', { durationMs: 5, sound: null });
    expect(hud.toastCount).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(hud.toastCount).toBe(0);
    expect(hud.toastsRegion.querySelectorAll(HUD_SELECTORS.toast)).toHaveLength(0);
  });

  it('announces the era through the toast helper', () => {
    const { hud } = openComposition({ initialEra: '1965' });
    const info = hud.announceEra();

    expect(info.era).toBe('1965');
    expect(hud.snapshot().toasts).toEqual(['1965 — Mid-century Boom']);
  });

  it('notifies a listener for every toast', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const seen: string[] = [];
    const hud = createHudApi({
      root: container,
      integrateGlobal: false,
      onToast: (handle) => seen.push(handle.message),
    });
    openHuds.push(hud);

    hud.toast('one', { durationMs: 0, sound: null });
    hud.toast('two', { durationMs: 0, sound: null });

    expect(seen).toEqual(['one', 'two']);
  });
});

/* ------------------------------------------------------------------ */
/* Mute toggle, help overlay and UI SFX                                */
/* ------------------------------------------------------------------ */

describe('HudApi mute toggle and help overlay', () => {
  it('offers a locked sound control that unlocks the AudioDirector on demand', async () => {
    const { director, hud } = openComposition({ withAudio: true });

    expect(hud.muteButton?.dataset.chronoHudMuteState).toBe('locked');
    expect(hud.muteButton?.getAttribute('aria-pressed')).toBe('false');

    hud.muteButton?.click();
    await flushTimers();

    expect(director?.isUnlocked).toBe(true);
    hud.refresh(true);
    expect(hud.muteButton?.dataset.chronoHudMuteState).toBe('on');
    expect(hud.isAudioUnlocked).toBe(true);
  });

  it('flips mute through the AudioDirector and renders the state', async () => {
    const { director, hud } = openComposition({ withAudio: true });
    await director?.unlock();
    hud.refresh(true);

    hud.muteButton?.click();

    expect(director?.isMuted).toBe(true);
    expect(hud.isMuted).toBe(true);
    expect(hud.muteButton?.dataset.chronoHudMuteState).toBe('muted');
    expect(hud.muteButton?.getAttribute('aria-pressed')).toBe('true');
    expect(hud.snapshot().muted).toBe(true);
    expect(hud.snapshot().toasts).toContain('Sound muted');
    expect(hud.root.dataset.chronoHudAudioState).toBe('muted');

    hud.muteButton?.click();

    expect(director?.isMuted).toBe(false);
    expect(hud.muteButton?.getAttribute('aria-pressed')).toBe('false');
    expect(hud.snapshot().toasts).toContain('Sound on');
  });

  it('mirrors a mute performed elsewhere on the AudioDirector', async () => {
    const { context, director, hud } = openComposition({ withAudio: true });
    await director?.unlock();

    director?.setMuted(true);
    context.tick(0.016);

    expect(hud.isMuted).toBe(true);
    expect(hud.muteButton?.dataset.chronoHudMuteState).toBe('muted');

    director?.setMuted(false);
    context.tick(0.016);

    expect(hud.isMuted).toBe(false);
    expect(hud.muteButton?.dataset.chronoHudMuteState).toBe('on');
  });

  it('opens and closes the controls help overlay while the timeline stays usable', () => {
    const { context, timeline, hud } = openComposition();

    expect(hud.helpButton?.getAttribute('aria-expanded')).toBe('false');
    expect(hud.isHelpOpen).toBe(false);

    hud.helpButton?.click();

    expect(hud.isHelpOpen).toBe(true);
    expect(hud.help?.root.hidden).toBe(false);
    expect(hud.help?.root.getAttribute('aria-hidden')).toBe('false');
    expect(hud.helpButton?.getAttribute('aria-expanded')).toBe('true');
    expect(hud.helpButton?.dataset.chronoHudHelpState).toBe('open');
    // The panel documents the timeline controls.
    const timelineSection = hud.help?.sections.find((section) => section.id === 'timeline');
    expect(timelineSection?.items.flatMap((item) => item.keys)).toContain('←');

    // The slider still works with help open.
    hud.slider?.stopElements[0]?.click();
    context.tick(0.016);
    expect(timeline.era).toBe('1945');
    expect(hud.year).toBe(1945);
    expect(hud.isHelpOpen).toBe(true);

    // Escape closes it again.
    document.dispatchEvent(keyEvent('Escape'));
    expect(hud.isHelpOpen).toBe(false);
    expect(hud.help?.root.hidden).toBe(true);
    expect(hud.helpButton?.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the help overlay from its own close button', () => {
    const { hud } = openComposition();

    hud.setHelpOpen(true);
    expect(hud.help?.isOpen).toBe(true);

    hud.help?.closeButton.click();
    expect(hud.isHelpOpen).toBe(false);
  });

  it('keeps the help copy in step with the navigation rig mode', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = createHudApi({
      root: container,
      integrateGlobal: false,
      navigation: { mode: 'walk' },
    });
    openHuds.push(hud);

    const camera = hud.help?.sections.find((section) => section.id === 'navigation');
    const walkToggle = camera?.items.find((item) => item.keys.includes('F'));
    expect(walkToggle?.action).toContain('orbit view');

    expect(defaultHelpSections('orbit').find((section) => section.id === 'navigation')?.items).toContainEqual({
      keys: ['F'],
      action: 'Enter first-person walk mode',
    });
  });

  it('toggles help and mute from the H / M shortcuts', async () => {
    const { director, hud } = openComposition({ withAudio: true });
    await director?.unlock();
    hud.refresh(true);

    window.dispatchEvent(keyEvent('h'));
    expect(hud.isHelpOpen).toBe(true);
    window.dispatchEvent(keyEvent('h'));
    expect(hud.isHelpOpen).toBe(false);

    window.dispatchEvent(keyEvent('m'));
    expect(director?.isMuted).toBe(true);
    expect(hud.isMuted).toBe(true);
    window.dispatchEvent(keyEvent('m'));
    expect(hud.isMuted).toBe(false);
  });
});

describe('HudApi UI sound effects', () => {
  it('queues the first cue behind the autoplay unlock, then plays it', async () => {
    const { director, hud } = openComposition({ withAudio: true });
    const play = vi.spyOn(director as AudioDirector, 'play');

    expect(director?.isUnlocked).toBe(false);
    hud.slider?.stopElements[2]?.click();

    // Not audible yet: the cue waits for the gesture-driven unlock.
    expect(play).not.toHaveBeenCalled();

    await flushTimers();

    expect(director?.isUnlocked).toBe(true);
    expect(play).toHaveBeenCalledWith(UI_CLICK_CUE, expect.objectContaining({ rate: HUD_CLICK_RATE }));
  });

  it('voices a click for a pick and a tick for a step once unlocked', async () => {
    const { director, hud } = openComposition({ withAudio: true });
    await director?.unlock();
    const play = vi.spyOn(director as AudioDirector, 'play');

    hud.slider?.stopElements[2]?.click();
    expect(play).toHaveBeenLastCalledWith(
      UI_CLICK_CUE,
      expect.objectContaining({ rate: HUD_CLICK_RATE }),
    );

    play.mockClear();
    hud.slider?.track.dispatchEvent(keyEvent('ArrowRight'));
    expect(play).toHaveBeenLastCalledWith(
      UI_CLICK_CUE,
      expect.objectContaining({ rate: HUD_TICK_RATE }),
    );
  });

  it('voices a cue for the mute and help buttons', async () => {
    const { director, hud } = openComposition({ withAudio: true });
    await director?.unlock();
    const play = vi.spyOn(director as AudioDirector, 'play');

    hud.helpButton?.click();
    expect(play).toHaveBeenCalledTimes(1);

    play.mockClear();
    hud.muteButton?.click();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stays silent while muted', async () => {
    const { director, hud } = openComposition({ withAudio: true });
    await director?.unlock();
    director?.setMuted(true);
    const play = vi.spyOn(director as AudioDirector, 'play');

    hud.slider?.stopElements[1]?.click();
    hud.helpButton?.click();
    hud.playUiSound('tick');

    expect(play).not.toHaveBeenCalled();
  });

  it('keeps working without an audio engine', () => {
    const { timeline, hud } = openComposition();

    expect(hud.audio).toBeNull();
    expect(hud.muteButton?.disabled).toBe(true);
    expect(hud.muteButton?.dataset.chronoHudMuteState).toBe('unavailable');
    expect(() => {
      hud.playUiSound('click');
      hud.slider?.stopElements[0]?.click();
    }).not.toThrow();
    expect(timeline.era).toBe('1945');
  });
});

/* ------------------------------------------------------------------ */
/* Overlay bounds + global integration                                 */
/* ------------------------------------------------------------------ */

describe('HUD chrome bounds', () => {
  it('is click-through outside each widget, so camera drags survive', () => {
    const { context, hud } = openComposition();

    expect(hud.root.style.pointerEvents).toBe('none');
    expect(hud.slider?.root.style.pointerEvents).toBe('auto');
    expect(hud.actionsElement.style.pointerEvents).toBe('auto');
    expect(hud.help?.root.style.pointerEvents).toBe('none');
    expect(hud.help?.panel.style.pointerEvents).toBe('auto');

    // A press on the overlay outside the HUD still reaches the page.
    const seen: Event[] = [];
    const listener = (event: Event): void => {
      seen.push(event);
    };
    document.addEventListener('pointerdown', listener);
    context.overlayRoot.dispatchEvent(pointerEvent('pointerdown', { clientX: 640, clientY: 480 }));
    document.removeEventListener('pointerdown', listener);
    expect(seen).toHaveLength(1);
  });

  it('exposes stable selectors for browser harnesses', () => {
    const { hud } = openComposition();

    expect(document.querySelector(HUD_SELECTORS.root)).toBe(hud.root);
    expect(hud.root.querySelectorAll(TIMELINE_SELECTORS.stop)).toHaveLength(5);
    expect(document.querySelector(HELP_SELECTORS.root)).toBe(hud.help?.root);
    expect(document.querySelector(HUD_SELECTORS.mute)).toBe(hud.muteButton);
    expect(document.querySelector(HUD_SELECTORS.help)).toBe(hud.helpButton);
  });
});

describe('HUD boot and global integration', () => {
  it('publishes the live HUD and cleans the handle up on dispose', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new HudApi({ root: container });
    openHuds.push(hud);

    expect(hud.root.dataset.chronoHudTimeline).toBe('internal');
    expect(window.__chronoCityHud).toBe(hud);
    expect(getHudApi()).toBe(hud);

    hud.dispose();

    expect(window.__chronoCityHud).toBeUndefined();
    expect(getHudApi()).toBeNull();
  });

  it('discovers the live scene, audio and timeline handles when booting', async () => {
    const context = openSceneContext();
    const timeline = createTimelineRuntime({ initialEra: '1985', durationMs: 0 });
    openTimelines.push(timeline);
    const { director } = openDirector();
    await director.unlock();
    const scope = window as unknown as Record<string, unknown>;
    scope.__chronoCity = { context };
    scope[TIMELINE_GLOBAL_KEY] = timeline;
    scope[AUDIO_GLOBAL_KEY] = director;

    const hud = bootHudApi();
    openHuds.push(hud as HudApi);

    expect(hud).not.toBeNull();
    expect(hud?.context).toBe(context);
    expect(hud?.timeline).toBe(timeline);
    expect(hud?.audio).toBe(director);
    expect(hud?.snapshot().timeline).toBe('shared');
    expect(hud?.year).toBe(1985);
    expect(hud?.root.parentElement).toBe(context.overlayRoot);
    expect(context.hasSystem(HUD_SYSTEM_ID)).toBe(true);
    expect(window.__chronoCityHud).toBe(hud);
  });

  it('returns the running HUD when booted twice, so wiring cannot double-mount', () => {
    const context = openSceneContext();
    (window as unknown as Record<string, unknown>).__chronoCity = { context };

    const first = bootHudApi();
    openHuds.push(first as HudApi);
    const second = bootHudApi();

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(document.querySelectorAll(HUD_SELECTORS.root)).toHaveLength(1);
    expect(context.hasSystem(HUD_SYSTEM_ID)).toBe(true);
  });

  it('boots an internal runtime when the app has not published one', () => {
    const context = openSceneContext();
    (window as unknown as Record<string, unknown>).__chronoCity = { context };

    const hud = bootHudApi();
    openHuds.push(hud as HudApi);

    expect(hud).not.toBeNull();
    expect(hud?.snapshot().timeline).toBe('internal');
    expect(hud?.audio).toBeNull();
  });

  it('degrades safely when there is nothing to attach to', () => {
    const hud = bootHudApi({ document: null });

    expect(hud).not.toBeNull();
    openHuds.push(hud as HudApi);
    expect(hud?.root.parentElement).toBe(document.body);
  });
});
