// @vitest-environment jsdom
/**
 * Hotspot inspection composition suite (real modules, browser-like DOM).
 *
 * This is the end-to-end proof of the close-up viewing layer, composed from the
 * real participants rather than doubles:
 *
 *  - the real `EnvironmentModule` built against the headless `SceneKernel` (no
 *    GPU, no canvas),
 *  - the real `NavigationController` attached to that kernel's camera rig,
 *  - the real `HotspotRegistry` with its `RoomBounds`-derived default anchors,
 *  - the real overlay and inspect mode, rendered into jsdom.
 *
 * It asserts the behaviour the acceptance criteria describe: the default anchor
 * set is placed from the live room bounds, framing moves the camera to the
 * declared distance and looks at the focus point, a second frame call is
 * idempotent, the return control restores the exact pre-inspect viewpoint, the
 * overlay shows the label plus the era caption for the selected year (and never
 * empty text), and disposal empties the registry and the DOM.
 *
 * jsdom has no layout engine, so "clear of the timeline slider" is asserted
 * against the positioning contract (a reserved top band plus a bottom-anchored
 * panel) rather than measured pixels.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  YEAR_IDS,
  isPeriodDefinition,
  type PeriodDefinition,
  type YearId,
} from '../../src/contracts/period';
import { createKernel, type Kernel } from '../../src/core/kernel';
import { createNavigationController, type NavigationController } from '../../src/core/navigation';
import {
  DEFAULT_ANCHOR_IDS,
  DEFAULT_ANCHOR_SUBJECTS,
  DEFAULT_ANCHOR_TAG,
  NEUTRAL_CAPTION_FALLBACK,
  createHotspotRegistry,
  registerDefaultAnchors,
  type HotspotRecord,
  type HotspotRegistry,
} from '../../src/core/hotspots';
import {
  INSPECT_OVERLAY_CSS,
  INSPECT_OVERLAY_PARTS,
  INSPECT_RETURN_LABEL,
  INSPECT_TIMELINE_CLEARANCE_PX,
  createInspectMode,
  createInspectOverlay,
  type InspectMode,
  type InspectOverlay,
} from '../../src/ui/inspect/InspectOverlay';
import { createEnvironmentModule, type EnvironmentModule } from '../../src/domains/environment/EnvironmentModule';
import {
  CAFE_ROOM_BOUNDS,
  measureShellEnvelope,
  roomBoundsEqual,
} from '../../src/domains/environment/roomBounds';
import { createTimelineSlider, type TimelineSlider } from '../../src/ui/timeline/TimelineSlider';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];
const openRegistries: HotspotRegistry[] = [];
const openNavigations: NavigationController[] = [];
const openEnvironments: EnvironmentModule[] = [];
const openModes: InspectMode[] = [];
const openOverlays: InspectOverlay[] = [];
const openSliders: TimelineSlider[] = [];

afterEach(() => {
  for (const mode of openModes.splice(0)) mode.dispose();
  for (const overlay of openOverlays.splice(0)) overlay.dispose();
  for (const slider of openSliders.splice(0)) slider.dispose();
  for (const navigation of openNavigations.splice(0)) navigation.dispose();
  for (const environment of openEnvironments.splice(0)) environment.dispose();
  for (const registry of openRegistries.splice(0)) {
    if (!registry.disposed) registry.dispose();
  }
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

/**
 * Neutral era fixture. The period registry task owns the real definitions; the
 * hotspot layer must not depend on, or author, any era content.
 */
function periodFor(year: YearId): PeriodDefinition {
  const period: PeriodDefinition = {
    year,
    label: year,
    name: `Fixture era ${year}`,
    summary: 'Composition fixture for the hotspot inspection suite.',
    palette: {
      background: '#101010',
      floor: '#2b2b2b',
      wall: '#333333',
      ceiling: '#3d3d3d',
      accent: '#7a5c3a',
      lamp: '#ffd9a0',
    },
    lighting: {
      ambientColor: '#808080',
      ambientIntensity: 0.5,
      keyColor: '#ffffff',
      keyIntensity: 1.2,
      fillColor: '#bfbfbf',
      fillIntensity: 0.3,
      lampColor: '#ffd9a0',
      lampIntensity: 6,
      fogDensity: 0,
    },
    details: ['fixture'],
  };
  if (!isPeriodDefinition(period)) throw new Error(`fixture era ${year} is not a period`);
  return period;
}

function countNodes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => {
    count += 1;
  });
  return count;
}

interface Harness {
  readonly kernel: Kernel;
  readonly environment: EnvironmentModule;
  readonly registry: HotspotRegistry;
  readonly navigation: NavigationController;
  /** World node count before the shell was built, for teardown assertions. */
  readonly baselineNodes: number;
}

function setup(): Harness {
  const kernel = createKernel(null, {
    forceHeadless: true,
    bounds: CAFE_ROOM_BOUNDS,
    autoResize: false,
    width: 1440,
    height: 900,
  });
  openKernels.push(kernel);
  const baselineNodes = countNodes(kernel.scene);

  const environment = createEnvironmentModule({ canvasFactory: () => null });
  openEnvironments.push(environment);
  environment.build(kernel.createBuildContext(periodFor(DEFAULT_YEAR_ID)));

  const registry = createHotspotRegistry();
  openRegistries.push(registry);
  registerDefaultAnchors(registry, environment.bounds);

  const navigation = createNavigationController({
    camera: kernel.camera,
    rig: kernel.cameraRig,
    bounds: environment.bounds,
    frameSource: kernel,
    element: null,
    ownerDocument: null,
    reducedMotion: true,
    damping: 0,
    headBob: null,
  });
  openNavigations.push(navigation);
  navigation.attach();

  return { kernel, environment, registry, navigation, baselineNodes };
}

function anchorFor(registry: HotspotRegistry, subject: string): HotspotRecord {
  const record = registry.list().find((entry) => entry.tags.includes(subject));
  if (!record) throw new Error(`the default anchor set must cover ${subject}`);
  return record;
}

function expectPointCloseTo(
  actual: { readonly x: number; readonly y: number; readonly z: number },
  expected: { readonly x: number; readonly y: number; readonly z: number },
  precision = 6,
): void {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
  expect(actual.z).toBeCloseTo(expected.z, precision);
}

function queryPart(part: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-part="${part}"]`);
}

/* -------------------------------------------------------------------------- */
/* Default anchors from the live room                                         */
/* -------------------------------------------------------------------------- */

describe('default anchors from the environment shell', () => {
  it('places the six viewing subjects inside the room the shell actually built', () => {
    const { kernel, environment, registry } = setup();

    expect(kernel.headless).toBe(true);
    expect(environment.root).toBeDefined();
    // The shell is real geometry, and its measured envelope matches the bounds
    // the anchors were derived from.
    expect(countNodes(environment.root as THREE.Object3D)).toBeGreaterThan(20);
    const measured = measureShellEnvelope(environment.root as THREE.Object3D);
    if (!measured) throw new Error('the environment shell must expose its envelope');
    expect(roomBoundsEqual(measured, environment.bounds, 1e-6)).toBe(true);

    const anchors = registry.list();
    expect(anchors).toHaveLength(DEFAULT_ANCHOR_SUBJECTS.length);
    expect(registry.publisherIds).toEqual(['default-anchors']);
    for (const id of Object.values(DEFAULT_ANCHOR_IDS)) expect(registry.has(id)).toBe(true);

    for (const subject of DEFAULT_ANCHOR_SUBJECTS) {
      const anchor = anchorFor(registry, subject);
      expect(anchor.tags).toContain(DEFAULT_ANCHOR_TAG);
      expect(anchor.framingDistance).toBeGreaterThan(0);
      expect(anchor.focus.x).toBeGreaterThanOrEqual(-environment.bounds.width / 2);
      expect(anchor.focus.x).toBeLessThanOrEqual(environment.bounds.width / 2);
      expect(anchor.focus.z).toBeGreaterThanOrEqual(-environment.bounds.depth / 2);
      expect(anchor.focus.z).toBeLessThanOrEqual(environment.bounds.depth / 2);
      expect(anchor.focus.y).toBeGreaterThan(0);
      expect(anchor.focus.y).toBeLessThan(environment.bounds.height);
    }

    // Anchors are era agnostic: no era content is authored by this task.
    for (const anchor of anchors) {
      expect(anchor.eraNotes).toEqual({});
      for (const year of YEAR_IDS) {
        expect(registry.resolveEraCaption(anchor.id, year).source).toBe('description');
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Framing through the real navigation controller                             */
/* -------------------------------------------------------------------------- */

describe('framing through the navigation controller', () => {
  it('frames every default anchor at its declared distance and looks at its focus point', () => {
    const { kernel, environment, registry, navigation } = setup();
    expect(navigation.attached).toBe(true);

    for (const subject of DEFAULT_ANCHOR_SUBJECTS) {
      const anchor = anchorFor(registry, subject);
      const before = navigation.snapshot();
      const focus = anchor.focus.clone();

      const distance = registry.frame(navigation, anchor.id);

      // Declared framing distance, and the camera looks straight at the focus.
      expect(distance).toBeCloseTo(anchor.framingDistance, 2);
      expect(navigation.focusDistance).toBeCloseTo(anchor.framingDistance, 2);
      expect(navigation.inspecting).toBe(true);
      expect(navigation.camera.position.distanceTo(focus)).toBeCloseTo(anchor.framingDistance, 2);
      const forward = navigation.camera.getWorldDirection(new THREE.Vector3());
      const towardsFocus = focus.clone().sub(navigation.camera.position).normalize();
      expect(forward.dot(towardsFocus)).toBeGreaterThan(0.999);
      expectPointCloseTo(kernel.camera.position, navigation.position);

      // The framing pose stays inside the room shell.
      expect(Math.abs(kernel.camera.position.x)).toBeLessThanOrEqual(environment.bounds.width / 2);
      expect(Math.abs(kernel.camera.position.z)).toBeLessThanOrEqual(environment.bounds.depth / 2);
      expect(kernel.camera.position.y).toBeGreaterThan(0);
      expect(kernel.camera.position.y).toBeLessThan(environment.bounds.height);

      // Idempotent: re-framing the already focused hotspot changes nothing.
      const settled = kernel.camera.position.clone();
      const again = registry.frame(navigation, anchor.id);
      expect(again).toBeCloseTo(distance, 9);
      expect(kernel.camera.position.distanceTo(settled)).toBeCloseTo(0, 9);
      expectPointCloseTo(navigation.snapshot().target, focus);

      // Stepping the frame loop keeps the close-up stable (no drift).
      for (let step = 0; step < 30; step += 1) navigation.update(1 / 60);
      expect(kernel.camera.position.distanceTo(settled)).toBeCloseTo(0, 6);
      expect(navigation.camera.position.distanceTo(focus)).toBeCloseTo(anchor.framingDistance, 2);

      // Releasing restores the exact pre-inspect viewpoint, mode included.
      expect(navigation.exitInspect()).toBe(true);
      const after = navigation.snapshot();
      expect(after.inspecting).toBe(false);
      expect(after.focusDistance).toBeNull();
      expect(after.mode).toBe(before.mode);
      expectPointCloseTo(after.position, before.position);
      expectPointCloseTo(after.target, before.target);
      expect(after.distance).toBeCloseTo(before.distance, 9);
      expectPointCloseTo(kernel.camera.position, before.position);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Overlay, era captions and the return control                               */
/* -------------------------------------------------------------------------- */

describe('inspect overlay', () => {
  it('presents the label, the selected era caption and a reachable return control', () => {
    const { registry, navigation } = setup();
    const overlay = createInspectOverlay({ ownerDocument: document });
    openOverlays.push(overlay);
    const mode = createInspectMode({ registry, navigation, overlay, year: '1965' });
    openModes.push(mode);

    const domainRecord = registry.publish('menuboard', {
      id: 'menuboard-lettering',
      label: 'Menu board lettering',
      description: 'The lettered board above the counter.',
      focus: { x: 3.2, y: 1.62, z: -1.2 },
      framingDistance: 1.5,
      approach: { x: -1, y: 0.05, z: 0.2 },
      eraNotes: {
        '1945': 'Hand-painted price cards wired to the board.',
        '1965': 'Bold plastic letters clipped into a felt rail.',
        '1985': 'Vinyl lettering under a strip light.',
        '2005': 'Printed panels with a chalkboard insert.',
        '2025': 'A backlit panel with digital pricing.',
      },
    });

    expect(overlay.mounted).toBe(true);
    expect(overlay.visible).toBe(false);

    const state = mode.open(domainRecord.id);
    expect(mode.isOpen).toBe(true);
    expect(state.hotspotId).toBe(domainRecord.id);
    expect(state.caption).toBe('Bold plastic letters clipped into a felt rail.');
    expect(state.captionSource).toBe('era-note');
    expect(state.framingDistance).toBeCloseTo(domainRecord.framingDistance, 2);
    expect(navigation.inspecting).toBe(true);

    // Markup: label, era line, caption, description and the return control.
    expect(overlay.visible).toBe(true);
    expect(queryPart(INSPECT_OVERLAY_PARTS.label)?.textContent).toBe('Menu board lettering');
    expect(queryPart(INSPECT_OVERLAY_PARTS.era)?.textContent).toBe('1965');
    expect(queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.textContent).toBe(
      'Bold plastic letters clipped into a felt rail.',
    );
    expect(queryPart(INSPECT_OVERLAY_PARTS.description)?.textContent).toBe(
      'The lettered board above the counter.',
    );
    expect(queryPart(INSPECT_OVERLAY_PARTS.returnButton)?.textContent).toContain(INSPECT_RETURN_LABEL);
    expect(overlay.panel.getAttribute('data-year')).toBe('1965');
    expect(overlay.panel.getAttribute('data-caption-source')).toBe('era-note');
    expect(overlay.element.getAttribute('data-hotspot-id')).toBe('menuboard-lettering');

    // Screen-reader labelling.
    expect(overlay.panel.getAttribute('role')).toBe('region');
    const labelId = overlay.panel.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(labelId).toBe(queryPart(INSPECT_OVERLAY_PARTS.label)?.id);
    expect(document.getElementById(labelId as string)?.textContent).toBe('Menu board lettering');
    expect(queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.getAttribute('aria-live')).toBe('polite');
    const describedBy = overlay.panel.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain(queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.id);
    expect(describedBy).toContain(queryPart(INSPECT_OVERLAY_PARTS.era)?.id);
    expect(overlay.returnButton.getAttribute('aria-label')).toBe(INSPECT_RETURN_LABEL);
    expect(overlay.returnButton.getAttribute('aria-keyshortcuts')).toBe('Escape');

    // Keyboard reachable: focus lands on the return control.
    expect(document.activeElement).toBe(overlay.returnButton);
    expect(overlay.returnButton.tabIndex).toBe(0);

    // Clear of the top timeline slider: reserved top band, bottom-anchored panel.
    expect(overlay.element.getAttribute('data-timeline-clearance-px')).toBe(
      String(INSPECT_TIMELINE_CLEARANCE_PX),
    );
    expect(overlay.element.style.getPropertyValue('--cafe-inspect-timeline-clearance')).toBe(
      `${INSPECT_TIMELINE_CLEARANCE_PX}px`,
    );
    expect(overlay.panel.style.top).toBe('');
    expect(INSPECT_OVERLAY_CSS).toContain('padding-top: var(--cafe-inspect-timeline-clearance');
    expect(INSPECT_OVERLAY_CSS).toContain('bottom: 24px');
    // The layer never intercepts pointer input; only the panel does.
    expect(INSPECT_OVERLAY_CSS).toContain('pointer-events: none');
    expect(INSPECT_OVERLAY_CSS).toContain('pointer-events: auto');
    expect(document.querySelector(`style[data-inspect-styles="cafe-inspect-overlay"]`)).not.toBeNull();

    // Reduced motion: the rise/fade flourish is suppressed both ways round.
    overlay.setReducedMotion(true);
    expect(overlay.element.getAttribute('data-reduced-motion')).toBe('true');
    expect(overlay.reducedMotion).toBe(true);
    expect(INSPECT_OVERLAY_CSS).toContain("[data-part='inspect-overlay'][data-reduced-motion='true']");
    expect(INSPECT_OVERLAY_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    overlay.setReducedMotion(false);
    expect(overlay.element.getAttribute('data-reduced-motion')).toBe('false');
  });

  it('keeps the top timeline slider clear and follows its era selection', () => {
    const { registry, navigation } = setup();
    const overlay = createInspectOverlay({ ownerDocument: document });
    openOverlays.push(overlay);
    const mode = createInspectMode({ registry, navigation, overlay, year: DEFAULT_YEAR_ID });
    openModes.push(mode);

    // The real slider chrome shares the document with the overlay.
    const slider = createTimelineSlider({
      ownerDocument: document,
      container: document.body,
      initialYear: DEFAULT_YEAR_ID,
      reducedMotion: true,
    });
    openSliders.push(slider);
    const unsubscribe = slider.onYearChange((year) => mode.setYear(year));

    const notes: Record<YearId, string> = {
      '1945': 'A wireless set on the shelf above the counter.',
      '1965': 'A transistor radio beside the till.',
      '1985': 'A cassette deck wired into the ceiling speakers.',
      '2005': 'A wall-mounted CD changer with a remote.',
      '2025': 'A streaming puck feeding hidden speakers.',
    };
    const device = registry.publish('music', {
      id: 'music-source-shelf',
      label: 'Music source',
      description: 'The shelf the room’s music plays from.',
      focus: { x: -4.0, y: 1.3, z: 4.4 },
      framingDistance: 1.6,
      approach: { x: 1, y: 0.1, z: 0.15 },
      eraNotes: notes,
    });

    mode.open(device.id, slider.year);
    expect(queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.textContent).toBe(notes['1945']);

    slider.select('1965');
    expect(slider.year).toBe('1965');
    expect(mode.year).toBe('1965');
    expect(queryPart(INSPECT_OVERLAY_PARTS.era)?.textContent).toBe('1965');
    expect(queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.textContent).toBe(notes['1965']);

    slider.select('2025');
    expect(mode.state.caption).toBe(notes['2025']);
    expect(mode.state.captionSource).toBe('era-note');
    expect(queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.textContent).toBe(notes['2025']);
    expect(overlay.panel.getAttribute('data-year')).toBe('2025');

    // Layout contract the overlay promises the slider: it reserves a band
    // comfortably taller than the slider's top chrome before any of its own
    // content may appear, its panel is bottom-anchored, and the layer never
    // captures pointer input — the top of the screen always belongs to the slider.
    expect(slider.element.isConnected).toBe(true);
    expect(INSPECT_TIMELINE_CLEARANCE_PX).toBeGreaterThanOrEqual(128);
    expect(overlay.element.getAttribute('data-timeline-clearance-px')).toBe(
      String(INSPECT_TIMELINE_CLEARANCE_PX),
    );
    expect(overlay.element.style.getPropertyValue('--cafe-inspect-timeline-clearance')).toBe(
      `${INSPECT_TIMELINE_CLEARANCE_PX}px`,
    );
    expect(overlay.panel.style.top).toBe('');
    expect(INSPECT_OVERLAY_CSS).toContain('pointer-events: none');
    expect(overlay.contains(slider.element)).toBe(false);
    expect(overlay.panel.contains(slider.element)).toBe(false);

    unsubscribe();
    slider.dispose();
  });

  it('resolves a different caption for each of the five eras and falls back when a note is missing', () => {
    const { registry, navigation } = setup();
    const overlay = createInspectOverlay({ ownerDocument: document });
    openOverlays.push(overlay);
    const mode = createInspectMode({ registry, navigation, overlay, year: '1945' });
    openModes.push(mode);

    const notes: Record<YearId, string> = {
      '1945': 'A hand-cranked grinder bolted to the counter.',
      '1965': 'A chrome grinder with a glass hopper.',
      '1985': 'A doser grinder with a dark plastic body.',
      '2005': 'A flat-burr grinder with a digital timer.',
      '2025': 'A single-dose grinder with an automated scale.',
    };
    const grinder = registry.publish('machines', {
      id: 'grinder-bay',
      label: 'Grinder bay',
      description: 'The grinder position on the counter pass.',
      focus: { x: -2.3, y: 1.08, z: -5.0 },
      framingDistance: 1.45,
      approach: { x: 0, y: 0.12, z: 1 },
      eraNotes: notes,
    });

    mode.open(grinder.id, '1945');
    const captions: string[] = [];
    for (const year of YEAR_IDS) {
      const state = mode.setYear(year);
      expect(state.year).toBe(year);
      expect(state.captionSource).toBe('era-note');
      expect(state.caption).toBe(notes[year]);
      expect(overlay.panel.getAttribute('data-year')).toBe(year);
      expect(queryPart(INSPECT_OVERLAY_PARTS.era)?.textContent).toBe(year);
      expect(queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.textContent).toBe(notes[year]);
      captions.push(state.caption ?? '');
    }
    expect(new Set(captions).size).toBe(YEAR_IDS.length);

    // A default anchor has no era notes: it falls back to its neutral description.
    const anchor = anchorFor(registry, 'service-counter');
    mode.open(anchor.id);
    for (const year of YEAR_IDS) {
      const state = mode.setYear(year);
      expect(state.captionSource).toBe('description');
      expect(state.caption).toBe(anchor.description);
      expect(queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.textContent).toBe(anchor.description);
    }

    // Even a hotspot with no description renders neutral text, never an empty caption.
    const bare = registry.publish('environment', {
      id: 'bare-anchor',
      label: 'Bare anchor',
      focus: { x: 0, y: 1.1, z: 1.5 },
    });
    mode.open(bare.id, '2025');
    expect(mode.state.caption).toBe(NEUTRAL_CAPTION_FALLBACK);
    expect(queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.textContent).toBe(NEUTRAL_CAPTION_FALLBACK);
    expect((queryPart(INSPECT_OVERLAY_PARTS.eraCaption)?.textContent ?? '').trim().length).toBeGreaterThan(0);
    expect(queryPart(INSPECT_OVERLAY_PARTS.description)?.hidden).toBe(true);
  });

  it('returns to the previous viewpoint from the control, Escape and close()', () => {
    const { kernel, registry, navigation } = setup();
    const overlay = createInspectOverlay({ ownerDocument: document });
    openOverlays.push(overlay);
    const mode = createInspectMode({ registry, navigation, overlay });
    openModes.push(mode);

    const anchor = anchorFor(registry, 'seating');
    const before = navigation.snapshot();

    // 1. The on-screen return control.
    mode.open(anchor.id);
    overlay.returnButton.click();
    expect(mode.isOpen).toBe(false);
    expect(overlay.visible).toBe(false);
    expect(overlay.element.getAttribute('data-visible')).toBe('false');
    expect(navigation.inspecting).toBe(false);
    expectPointCloseTo(navigation.snapshot().position, before.position);
    expectPointCloseTo(kernel.camera.position, before.position);

    // 2. Escape, from anywhere in the document.
    mode.open(anchor.id);
    expect(overlay.getListenerStats().document).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(mode.isOpen).toBe(false);
    expect(overlay.visible).toBe(false);
    expect(overlay.getListenerStats().document).toBe(0);
    expectPointCloseTo(kernel.camera.position, before.position);

    // 3. Programmatic close, and toggling the same hotspot twice.
    mode.open(anchor.id);
    expect(mode.close()).toBe(true);
    expect(mode.close()).toBe(false);
    mode.toggle(anchor.id);
    expect(mode.isOpen).toBe(true);
    expect(navigation.inspecting).toBe(true);
    expectPointCloseTo(navigation.snapshot().target, anchor.focus);
    expect(kernel.camera.position.distanceTo(anchor.focus)).toBeCloseTo(anchor.framingDistance, 2);
    expect(document.activeElement).toBe(overlay.returnButton);
    mode.toggle(anchor.id);
    expect(mode.isOpen).toBe(false);
    expectPointCloseTo(navigation.snapshot().position, before.position);

    // Focus never stays trapped inside the hidden overlay.
    expect(overlay.contains(document.activeElement)).toBe(false);
    expect(overlay.getListenerStats()).toEqual({ button: 1, document: 0, return: 1, total: 2 });
  });

  it('leaves no DOM, listeners or hotspots behind on dispose', () => {
    const { environment, kernel, registry, navigation, baselineNodes } = setup();
    const overlay = createInspectOverlay({ ownerDocument: document });
    openOverlays.push(overlay);
    const mode = createInspectMode({ registry, navigation, overlay });
    openModes.push(mode);

    const anchor = anchorFor(registry, 'entrance');
    mode.open(anchor.id);
    expect(overlay.visible).toBe(true);
    expect(registry.size).toBe(DEFAULT_ANCHOR_SUBJECTS.length);

    mode.dispose();
    expect(mode.isOpen).toBe(false);
    expect(navigation.inspecting).toBe(false);
    expect(() => mode.open(anchor.id)).toThrow(/disposed/);

    overlay.dispose();
    expect(overlay.disposed).toBe(true);
    expect(overlay.mounted).toBe(false);
    expect(queryPart(INSPECT_OVERLAY_PARTS.root)).toBeNull();
    expect(document.querySelector('style[data-inspect-styles="cafe-inspect-overlay"]')).toBeNull();
    // The Escape handler is gone with the DOM.
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    ).not.toThrow();
    expect(overlay.getListenerStats().total).toBe(0);
    // dispose is idempotent, as app-composition may tear down unconditionally.
    expect(() => overlay.dispose()).not.toThrow();

    // Disposal empties the registry, and the shell returns to the bare world.
    registry.dispose();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
    expect(() => registry.publish('environment', { id: 'x', label: 'x', focus: { x: 0, y: 0, z: 0 } })).toThrow(
      /disposed/,
    );

    environment.dispose();
    expect(countNodes(kernel.scene)).toBe(baselineNodes);

    navigation.dispose();
    expect(navigation.getListenerStats().total).toBe(0);
    expect(navigation.attached).toBe(false);
  });
});
