/**
 * Interaction suite — the timeline, the transition, navigation and the audio gate,
 * driven through the real controls of the assembled café (jsdom, no GPU, no audio
 * device).
 *
 * What this suite proves, mapped to the acceptance criteria:
 *
 *  - the top timeline slider exposes **exactly** the five stops 1945, 1965, 1985,
 *    2005 and 2025, and selecting any stop (by click or by API) drives the scene
 *    to that year through the period transition,
 *  - a year change runs a **finite, staggered** choreography that reports
 *    completion through the real completion signal,
 *  - a new selection issued **mid-transition** interrupts, cancels and re-targets
 *    with no stale module state, orphaned geometry or duplicate audio source,
 *  - orbit, zoom, first-person walk with bounds clamping, hotspot focus and
 *    inspect-plus-return all work through the navigation interface,
 *  - audio stays locked before the enter-café gesture, starts after the gesture,
 *    and exposes the music, ambience and machine-SFX buses with a period program,
 *    a patron-density-driven murmur and triggerable hiss/clatter one-shots that
 *    crossfade on a period change.
 *
 * jsdom has no layout engine, so positions are asserted against the controller's
 * own solved geometry (limits, interior margins, framing distances) rather than
 * measured pixels.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { YEAR_IDS, type YearId } from '../../src/contracts/period';
import { DEFAULT_ANCHOR_IDS } from '../../src/core/hotspots';
import { TIMELINE_SLIDER_PARTS } from '../../src/ui/timeline/TimelineSlider';
import { ENTER_GATE_PARTS } from '../../src/app/hud';
import { INSPECT_OVERLAY_PARTS, INSPECT_RETURN_LABEL } from '../../src/ui/inspect/InspectOverlay';
import {
  ERA_EXPECTATIONS,
  allNodeNames,
  createHarness,
  createMountPoint,
  liveSpec,
  musicDeviceNodes,
  pressKey,
  removeMountPoint,
  sceneCounts,
  sceneInventory,
  type CafeHarness,
} from './harness';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const open: CafeHarness[] = [];
let mount: HTMLElement | null = null;

afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
  if (mount !== null) {
    removeMountPoint(mount);
    mount = null;
  }
});

/** Boots the composed page with its real DOM chrome inside a fresh `#app`. */
function bootWithChrome(
  options: { readonly reducedMotion?: boolean } = {},
): { harness: CafeHarness; container: HTMLElement } {
  const container = createMountPoint();
  mount = container;
  const harness = createHarness({ ui: true, container, reducedMotion: options.reducedMotion ?? true });
  open.push(harness);
  return { harness, container };
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`No element matches ${selector}.`);
  return element;
}

function part(container: HTMLElement, name: string): HTMLElement {
  return query<HTMLElement>(container, `[data-part="${name}"]`);
}

/**
 * Chrome parts that are allowed to mount outside the app container (the inspect
 * overlay and the enter gate keep their own layers) are looked up document-wide.
 */
function documentPart(name: string): HTMLElement {
  return query<HTMLElement>(document, `[data-part="${name}"]`);
}

/** The stop button of one era, as rendered by the timeline control. */
function stopButton(container: HTMLElement, year: YearId): HTMLButtonElement {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>(`[data-part="${TIMELINE_SLIDER_PARTS.stop}"]`),
  );
  const match = buttons.find((button) => button.textContent?.trim().startsWith(year));
  if (match === undefined) throw new Error(`The timeline has no ${year} stop button.`);
  return match;
}

/** Waits (microtasks and frames) until `predicate` holds, or throws. */
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

/** Expected audio machine archetype per era, from the music domain's mode tables. */
const AUDIO_ARCHETYPE: Readonly<Record<YearId, string>> = Object.freeze({
  '1945': 'percolator',
  '1965': 'lever',
  '1985': 'semi-automatic',
  '2005': 'super-automatic',
  '2025': 'multi-group',
});

/* -------------------------------------------------------------------------- */
/* Timeline slider                                                            */
/* -------------------------------------------------------------------------- */

describe('timeline slider', () => {
  it('exposes exactly the five era stops, in the top of the page', () => {
    const { harness, container } = bootWithChrome();
    const slider = harness.composition.slider;
    expect(slider, 'the composed page should mount the timeline control').not.toBeNull();
    if (slider === null) return;

    expect(slider.years).toEqual(YEAR_IDS);
    expect(slider.stops).toHaveLength(5);
    expect(slider.stops.map((handle) => handle.label)).toEqual([...YEAR_IDS]);
    expect(slider.attached).toBe(true);

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(`[data-part="${TIMELINE_SLIDER_PARTS.stop}"]`),
    );
    expect(buttons).toHaveLength(5);
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([...YEAR_IDS]);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([...YEAR_IDS]);
    expect(buttons.every((button) => button.getAttribute('role') === 'radio')).toBe(true);
    expect(part(container, TIMELINE_SLIDER_PARTS.stops).getAttribute('role')).toBe('radiogroup');

    /* The rail is the slider affordance and the readout names the active era. */
    expect(part(container, TIMELINE_SLIDER_PARTS.rail).getAttribute('role')).toBe('slider');
    expect(part(container, TIMELINE_SLIDER_PARTS.activeYearValue).textContent?.trim()).toBe('1945');

    /* It is the top-level chrome of the composed page, not a nested widget. */
    const root = part(container, TIMELINE_SLIDER_PARTS.root);
    expect(container.contains(root)).toBe(true);
    expect(root.parentElement?.closest('[data-part]')).toBeNull();
  }, 60_000);

  it('drives the whole scene to a year when a stop is clicked', async () => {
    const { harness, container } = bootWithChrome({ reducedMotion: false });
    const { composition } = harness;
    expect(composition.year).toBe('1945');

    stopButton(container, '1985').click();
    expect(composition.transition.targetYear).toBe('1985');
    expect(composition.slider?.year).toBe('1985');

    const report = await harness.settle('1985');
    expect(report.signals.map((signal) => signal.outcome)).toContain('arrived');
    expect(composition.year).toBe('1985');
    expect(composition.kernel.year).toBe('1985');
    expect(composition.transition.caption?.year).toBe('1985');
    for (const module of composition.sceneModules) {
      expect(module.spec?.year, `${module.id} did not follow the slider to 1985`).toBe('1985');
    }
    expect(musicDeviceNodes(composition)).toEqual(['music:1985:boombox-1985']);
    expect(part(container, TIMELINE_SLIDER_PARTS.activeYearValue).textContent?.trim()).toBe('1985');
  }, 60_000);

  it('selects every stop through the control API and keeps the readout in step', async () => {
    const { harness, container } = bootWithChrome();
    const slider = harness.composition.slider;
    if (slider === null) throw new Error('the composed page should mount the timeline control');
    let previousYear: YearId = '1945';

    for (const year of YEAR_IDS) {
      const changed = slider.select(year);
      expect(slider.year).toBe(year);
      /* `select` reports whether the slider actually moved; re-selecting the
       * active year is a no-op that still emits its change event. */
      expect(changed).toBe(year !== previousYear);
      previousYear = year;
      await harness.settle(year);
      if (changed) {
        const arrived = harness.signals
          .filter((signal) => signal.requestedYear === year && signal.outcome === 'arrived')
          .at(-1);
        expect(arrived?.settledYear).toBe(year);
      }
      expect(harness.composition.year).toBe(year);
      expect(part(container, TIMELINE_SLIDER_PARTS.activeYearValue).textContent?.trim()).toBe(year);
      expect(liveSpec(harness.composition, 'menuboard').year).toBe(year);
    }
  }, 120_000);
});

/* -------------------------------------------------------------------------- */
/* Transition                                                                */
/* -------------------------------------------------------------------------- */

describe('period transition', () => {
  it('runs a finite, staggered choreography that reports completion', async () => {
    const { harness } = bootWithChrome({ reducedMotion: false });
    const { composition } = harness;

    composition.selectYear('1965');
    expect(composition.transition.isTransitioning).toBe(true);
    expect(composition.transition.status).toBe('transitioning');
    expect(composition.transition.fromYear).toBe('1945');
    expect(composition.transition.targetYear).toBe('1965');

    const plan = composition.transition.getSnapshot().modules.filter((state) => state.needsSwap);
    expect(plan).toHaveLength(10);
    const swapTimes = [...new Set(plan.map((state) => Number(state.swapAtSeconds.toFixed(3))))].sort(
      (left, right) => left - right,
    );
    expect(swapTimes.length, 'the choreography should stagger its module swaps').toBeGreaterThan(1);
    expect(swapTimes[0] ?? -1).toBeGreaterThanOrEqual(0);
    const spread = (swapTimes[swapTimes.length - 1] ?? 0) - (swapTimes[0] ?? 0);
    expect(spread, 'the module swaps should be spread over the choreography').toBeGreaterThan(0.5);
    expect(plan.every((state) => state.windowSeconds > 0)).toBe(true);

    /* Progress advances monotonically while the choreography is in flight. */
    const progress: number[] = [];
    for (let frame = 0; frame < 600 && composition.transition.isTransitioning; frame += 1) {
      composition.tick(1 / 60);
      progress.push(composition.transition.progress);
    }
    expect(progress.length).toBeGreaterThan(30);
    for (let index = 1; index < progress.length; index += 1) {
      const previous = progress[index - 1] ?? 0;
      const current = progress[index] ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
    }
    expect(Math.max(...progress)).toBeGreaterThan(0.99);

    const report = await harness.settle('1965');
    const signal = report.signals.at(-1) ?? harness.signals.at(-1);
    expect(signal?.outcome).toBe('arrived');
    expect(signal?.requestedYear).toBe('1965');
    expect(signal?.fromYear).toBe('1945');
    expect(signal?.settledYear).toBe('1965');
    expect(signal?.elapsedSeconds).toBeGreaterThan(1);
    expect(signal?.elapsedSeconds, 'the switch must stay inside its documented budget').toBeLessThan(6);
    expect(composition.transition.isTransitioning).toBe(false);
    expect(composition.transition.status).toBe('settled');
    expect(composition.navigation.attached).toBe(true);
    expect(composition.transition.caption?.year).toBe('1965');
  }, 60_000);

  it('interrupts, cancels and re-targets a mid-transition selection with no stale state', async () => {
    const { harness } = bootWithChrome({ reducedMotion: false });
    const { composition } = harness;
    const slider = composition.slider;
    if (slider === null) throw new Error('the composed page should mount the timeline control');

    slider.select('1985');
    harness.advance(0.4);
    expect(composition.transition.isTransitioning).toBe(true);
    expect(composition.transition.targetYear).toBe('1985');

    slider.select('2025');
    expect(composition.transition.targetYear).toBe('2025');

    await harness.settle('2025');
    const superseded = harness.signals.find((signal) => signal.requestedYear === '1985');
    expect(superseded?.outcome, 'the interrupted switch must report that it was superseded').toBe(
      'superseded',
    );
    expect(superseded?.supersededBy).toBe('2025');
    expect(superseded?.settledYear).toBeNull();
    const arrived = harness.signals.find((signal) => signal.requestedYear === '2025');
    expect(arrived?.outcome).toBe('arrived');
    expect(arrived?.settledYear).toBe('2025');

    /* No stale module state and no orphaned geometry after the re-target. */
    expect(composition.year).toBe('2025');
    for (const module of composition.sceneModules) {
      expect(module.spec?.year, `${module.id} kept a stale era`).toBe('2025');
    }
    expect(composition.transition.modules.every((state) => state.reportedYear === '2025')).toBe(true);
    expect(musicDeviceNodes(composition)).toEqual(['music:2025:phone-speaker-2025']);
    expect(
      allNodeNames(composition.kernel.world).filter(
        (name) => /^music:/.test(name) && !name.includes('phone-speaker-2025'),
      ),
    ).toEqual([]);
    expect(
      allNodeNames(composition.kernel.world).filter((name) =>
        /jukebox-1965|boombox-1985|wireless-1945|ipod-dock-2005/.test(name),
      ),
    ).toEqual([]);

    /* Duplicate audio sources: one programme, one bed, one machine trigger hook. */
    const mix = composition.audio.getMixState();
    expect(mix.programId).toBe(ERA_EXPECTATIONS['2025'].musicProgramId);
    expect(mix.year).toBe('2025');
    expect(composition.transition.getSnapshot().audio.listeners).toBeLessThanOrEqual(1);

    /* The interrupted path settles on exactly the same scene as a clean 2025:
     * the visibility-independent inventory must match to the mesh, while the
     * visible draw-call count may differ by a mesh or two because the era's cue
     * animation (the contactless tap target) hides and shows on its own cycle. */
    const interrupted = sceneInventory(composition.kernel.world);
    const interruptedVisible = sceneCounts(composition.kernel.world);
    const interruptedNames = allNodeNames(composition.kernel.world).slice().sort();
    await harness.switchTo('1945');
    await harness.switchTo('2025');
    expect(sceneInventory(composition.kernel.world)).toEqual(interrupted);
    expect(allNodeNames(composition.kernel.world).slice().sort()).toEqual(interruptedNames);
    expect(
      Math.abs(sceneCounts(composition.kernel.world).drawCalls - interruptedVisible.drawCalls),
      'the re-targeted scene draws the same scene, modulo one animated cue',
    ).toBeLessThanOrEqual(8);
  }, 120_000);
});

/* -------------------------------------------------------------------------- */
/* Navigation                                                                */
/* -------------------------------------------------------------------------- */

describe('navigation and close-up inspection', () => {
  it('orbits, zooms within limits and walks with clamped bounds', async () => {
    const { harness } = bootWithChrome();
    const nav = harness.composition.navigation;

    const before = nav.snapshot();
    expect(before.mode).toBe('orbit');
    nav.orbit(0.4, -0.12);
    harness.advance(2);
    const orbited = nav.snapshot();
    expect(Math.abs(orbited.azimuth - before.azimuth)).toBeGreaterThan(0.05);
    expect(Math.abs(orbited.polar - before.polar)).toBeGreaterThan(0.02);
    expect(orbited.position.x !== before.position.x || orbited.position.z !== before.position.z).toBe(
      true,
    );

    nav.setDistance(0.001);
    harness.advance(1);
    expect(nav.distance).toBeCloseTo(nav.limits.minDistance, 4);
    nav.setDistance(500);
    harness.advance(1);
    expect(nav.distance).toBeCloseTo(nav.limits.maxDistance, 4);
    nav.zoomBy(-0.4);
    harness.advance(1);
    expect(nav.distance).toBeLessThan(nav.limits.maxDistance);
    expect(nav.distance).toBeGreaterThanOrEqual(nav.limits.minDistance);

    /* First-person walk: the same keys the page advertises move the viewer. */
    nav.setMode('walk');
    expect(nav.mode).toBe('walk');
    const start = nav.snapshot().position;
    pressKey('keydown', 'KeyW');
    harness.advance(1);
    pressKey('keyup', 'KeyW');
    const walked = nav.snapshot();
    const travelled = Math.hypot(walked.position.x - start.x, walked.position.z - start.z);
    expect(travelled, 'holding W should move the viewer forward').toBeGreaterThan(0.1);
    expect(travelled).toBeLessThanOrEqual(nav.limits.walkSpeed * 1.4);

    /* Hold forward until the far wall: the walk solve must clamp, never tunnel. */
    pressKey('keydown', 'KeyW');
    harness.advance(30);
    pressKey('keyup', 'KeyW');
    const clamped = nav.snapshot();
    const bounds = harness.composition.kernel.bounds;
    const limits = nav.limits;
    expect(Math.abs(clamped.position.x)).toBeLessThanOrEqual(bounds.width / 2);
    expect(Math.abs(clamped.position.z)).toBeLessThanOrEqual(bounds.depth / 2);
    expect(clamped.eyeHeight).toBeGreaterThanOrEqual(limits.minEyeHeight);
    expect(clamped.eyeHeight).toBeLessThanOrEqual(limits.maxEyeHeight);

    nav.setMode('orbit');
    expect(nav.mode).toBe('orbit');
  }, 120_000);

  it('frames a period detail up close and returns the viewer to the room', async () => {
    const { harness } = bootWithChrome();
    const { navigation, hotspots } = harness.composition;
    const record = hotspots.require(DEFAULT_ANCHOR_IDS.menuBoard);

    const pose = navigation.savePose();
    const roomDistance = Math.hypot(
      pose.position.x - record.position.x,
      pose.position.y - record.position.y,
      pose.position.z - record.position.z,
    );

    const framingDistance = navigation.inspect(record);
    expect(navigation.inspecting).toBe(true);
    expect(framingDistance).toBeGreaterThan(0.2);
    expect(framingDistance, 'inspecting should move closer than the room view').toBeLessThan(
      roomDistance,
    );

    harness.advance(3);
    const closeUp = navigation.snapshot();
    expect(closeUp.inspecting).toBe(true);
    expect(navigation.focusDistance).not.toBeNull();
    expect(navigation.focusDistance ?? 0).toBeCloseTo(framingDistance, 1);
    const target = navigation.target;
    const toPosition = target.distanceTo(record.position);
    const toFocus = target.distanceTo(record.focus);
    expect(
      Math.min(toPosition, toFocus),
      'the camera should look at the framed hotspot',
    ).toBeLessThan(0.35);

    expect(navigation.exitInspect()).toBe(true);
    expect(navigation.inspecting).toBe(false);
    harness.advance(3);
    expect(navigation.position.distanceTo(pose.position)).toBeLessThan(0.1);
    expect(navigation.mode).toBe(pose.mode);
  }, 60_000);

  it('opens a hotspot from the affordance list and closes it with the return control', async () => {
    const { harness } = bootWithChrome();
    const { inspectMode, inspectOverlay, hotspots } = harness.composition;
    expect(inspectMode).not.toBeNull();
    expect(inspectOverlay).not.toBeNull();
    if (inspectMode === null || inspectOverlay === null) return;

    const id = DEFAULT_ANCHOR_IDS.serviceCounter;
    const record = hotspots.require(id);
    const pose = harness.composition.navigation.savePose();

    inspectMode.open(id, '1945');
    expect(inspectMode.isOpen).toBe(true);
    expect(inspectMode.hotspotId).toBe(id);
    expect(inspectOverlay.visible).toBe(true);

    const panel = documentPart(INSPECT_OVERLAY_PARTS.panel);
    expect(panel.textContent).toContain(record.label);
    const returnButton = query<HTMLButtonElement>(
      document,
      `[data-part="${INSPECT_OVERLAY_PARTS.returnButton}"]`,
    );
    expect(returnButton.textContent).toContain(INSPECT_RETURN_LABEL);

    returnButton.click();
    expect(inspectMode.isOpen).toBe(false);
    expect(inspectOverlay.visible).toBe(false);
    harness.advance(3);
    expect(
      harness.composition.navigation.position.distanceTo(pose.position),
      'closing the inspect overlay returns the viewer to the room pose',
    ).toBeLessThan(0.1);
  }, 60_000);

  it('keeps the era caption of the inspect overlay in step with the timeline', async () => {
    const { harness } = bootWithChrome();
    const { inspectMode } = harness.composition;
    if (inspectMode === null) throw new Error('the composed page should create inspect mode');

    await harness.switchTo('2005');
    inspectMode.open(DEFAULT_ANCHOR_IDS.musicSource, '2005');
    const panel = documentPart(INSPECT_OVERLAY_PARTS.panel);
    expect(panel.textContent).toContain(String(ERA_EXPECTATIONS['2005'].year));
    expect(inspectMode.year).toBe('2005');

    await harness.switchTo('2025');
    expect(inspectMode.year, 'the overlay follows the era the scene reports').toBe('2025');
    expect(documentPart(INSPECT_OVERLAY_PARTS.panel).textContent).toContain('2025');
  }, 120_000);
});

/* -------------------------------------------------------------------------- */
/* Audio                                                                     */
/* -------------------------------------------------------------------------- */

describe('audio gesture gate and buses', () => {
  it('stays locked until the enter-café gesture and then plays the era programme', async () => {
    const { harness, container } = bootWithChrome({ reducedMotion: true });
    const { composition } = harness;
    const { audio } = composition;

    expect(audio.state).toBe('locked');
    expect(audio.isLocked).toBe(true);
    expect(audio.context).toBeNull();
    expect(composition.entered).toBe(false);

    const gate = query<HTMLButtonElement>(container, `[data-part="${ENTER_GATE_PARTS.button}"]`);
    gate.click();
    await until(() => audio.state === 'running', 'the audio engine to unlock after the gesture');

    expect(composition.entered).toBe(true);
    expect(audio.isRunning).toBe(true);
    expect(audio.context).not.toBeNull();

    /* Three independently controlled buses, plus a master and a room reverb. */
    for (const bus of ['music', 'ambience', 'machine'] as const) {
      const strip = audio.getBus(bus);
      expect(strip, `${bus} bus should exist`).not.toBeNull();
      expect(strip?.muted).toBe(false);
      expect(strip?.gainValue ?? 0).toBeGreaterThan(0);
    }
    expect(audio.getMaster()).not.toBeNull();
    expect(audio.getReverb()).not.toBeNull();

    /* One era programme, one murmur bed, and both are actually running. */
    const mix = audio.getMixState();
    expect(mix.year).toBe('1945');
    expect(mix.programId).toBe(ERA_EXPECTATIONS['1945'].musicProgramId);
    expect(mix.ambienceId).not.toBeNull();
    expect(mix.machineCharacterId).not.toBeNull();
    expect(mix.machineArchetype).toBe(AUDIO_ARCHETYPE['1945']);
    expect(mix.musicLevel).toBeGreaterThan(0);
    expect(mix.ambienceLevel).toBeGreaterThan(0);
    expect(mix.machineLevel).toBeGreaterThan(0);

    const bed = audio.getMurmurBed();
    expect(bed).not.toBeNull();
    expect(bed?.intensity ?? 0).toBeGreaterThan(0);
    harness.advance(1.5);
    const scheduled = audio.getMixState();
    expect(scheduled.scheduledNotes, 'the period programme should schedule notes').toBeGreaterThan(0);
    expect(scheduled.activeMusicVoices).toBeGreaterThan(0);
    expect(scheduled.murmurBlips, 'the murmur bed should schedule conversation blips').toBeGreaterThan(
      0,
    );

    /* Machine SFX: the hiss and the clatter the brief asks for are triggerable. */
    const heard: string[] = [];
    const off = audio.onMachineTrigger((record) => heard.push(record.kind));
    const triggersBefore = audio.getMixState().machineTriggers;
    const hiss = audio.triggerMachine('extraction');
    const clatter = audio.triggerMachine('cupClatter');
    expect(hiss.emitted).toBe(true);
    expect(clatter.emitted).toBe(true);
    expect(hiss.archetype).toBe('percolator');
    expect(audio.getMixState().machineTriggers).toBe(triggersBefore + 2);
    expect(heard).toEqual(['extraction', 'cupClatter']);
    off();

    await audio.suspend();
    expect(audio.state).toBe('suspended');
    expect(audio.isRunning).toBe(false);
  }, 120_000);

  it('drives the murmur from patron density and crossfades the era mix on each period change', async () => {
    const { harness } = bootWithChrome({ reducedMotion: true });
    const { composition } = harness;
    const { audio } = composition;
    await composition.enter();
    await until(() => audio.state === 'running', 'the audio engine to unlock');

    /* Observe the density the patrons module sends the ambience bus. */
    const pushed: number[] = [];
    const original = audio.setAmbienceIntensity.bind(audio);
    audio.setAmbienceIntensity = (value: number, seconds?: number) => {
      pushed.push(value);
      return original(value, seconds);
    };

    const programs = new Set<string>();
    const mixEventsBefore = audio.getEventLog().filter((event) => event.kind === 'mix').length;

    for (const year of YEAR_IDS) {
      pushed.length = 0;
      await harness.switchTo(year);
      const mix = audio.getMixState();
      const patrons = liveSpec(composition, 'patrons');
      const expected = ERA_EXPECTATIONS[year];

      expect(mix.year).toBe(year);
      expect(mix.programId).toBe(expected.musicProgramId);
      expect(mix.machineArchetype).toBe(AUDIO_ARCHETYPE[year]);
      programs.add(mix.programId ?? '');
      expect(mix.ambienceLevel).toBeGreaterThan(0);
      expect(mix.musicLevel).toBeGreaterThan(0);

      const bed = audio.getMurmurBed();
      expect(bed, `the ${year} ambience should run one murmur bed`).not.toBeNull();
      expect(bed?.disposed).toBe(false);

      if (year !== '1945') {
        expect(
          pushed.at(-1),
          `the patrons module should drive the ambience intensity from the ${year} density`,
        ).toBeCloseTo(patrons.density, 5);
      }

      /* Density -> intensity -> murmur: raising the density lifts the bed. */
      const quiet = bed?.intensity ?? 0;
      audio.setAmbienceIntensity(1, 0.2);
      harness.advance(0.4);
      const loud = audio.getMurmurBed()?.intensity ?? 0;
      expect(loud).toBeGreaterThan(quiet);
      expect(audio.getMurmurBed()?.densityGain.gain.value ?? 0).toBeGreaterThanOrEqual(0);
      audio.setAmbienceIntensity(patrons.density, 0.2);
      harness.advance(0.4);
      expect(audio.getMurmurBed()?.intensity ?? 0).toBeCloseTo(patrons.density, 2);
      harness.advance(1.5);
      expect(audio.getMixState().murmurBlips).toBeGreaterThan(0);
    }

    /* Five distinct programmes, crossfaded one era at a time. */
    expect(programs.size).toBe(YEAR_IDS.length);
    const mixEventsAfter = audio.getEventLog().filter((event) => event.kind === 'mix').length;
    expect(mixEventsAfter).toBeGreaterThan(mixEventsBefore + YEAR_IDS.length - 1);
    const state = audio.getMixState();
    expect(state.activeMusicVoices).toBeLessThan(64);
    expect(state.limiterReduction).toBeLessThanOrEqual(1);
  }, 180_000);
});
