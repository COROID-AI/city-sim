import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATEGORY_ORDER, YEARS, type SceneCategory, type Year } from '../src/config/types';
import { ERAS } from '../src/config/eras';
import { EraTransitionController, type TransitionEvent, type TransitionLayerLike } from '../src/era/transition';

function makeLayer(year: Year): TransitionLayerLike {
  const group = new THREE.Group();
  group.name = `era-${year}`;
  const categories = {} as Record<SceneCategory, THREE.Group>;
  for (const category of CATEGORY_ORDER) {
    const categoryGroup = new THREE.Group();
    categoryGroup.name = `${year}-${category}`;
    categoryGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    group.add(categoryGroup);
    categories[category] = categoryGroup;
  }
  return { year, definition: ERAS[year], group, categories, emissives: [] };
}

function makeController(options: { reducedMotion?: boolean; duration?: number } = {}) {
  const layers = new Map<Year, TransitionLayerLike>(YEARS.map((year) => [year, makeLayer(year)]));
  const events: TransitionEvent[] = [];
  const controller = new EraTransitionController({
    layers,
    onEvent: (event) => events.push(event),
    reducedMotion: options.reducedMotion,
    duration: options.duration,
  });
  return { controller, layers, events };
}

function runToCompletion(controller: EraTransitionController, step = 0.05, maxSteps = 200) {
  let steps = 0;
  while (controller.state.active && steps < maxSteps) {
    controller.update(step);
    steps += 1;
  }
  return steps * step;
}

describe('era transition controller', () => {
  it('boots into a single era with everything else hidden', () => {
    const { controller, layers } = makeController();
    controller.applyImmediate(1985);
    expect(controller.state.active).toBe(false);
    expect(controller.state.committed).toBe(1985);
    expect(controller.visibleYears).toEqual([1985]);
    expect(layers.get(1945)?.group.visible).toBe(false);
    for (const category of CATEGORY_ORDER) {
      expect(layers.get(1985)?.categories[category].visible).toBe(true);
      expect(layers.get(1985)?.categories[category].scale.x).toBe(1);
    }
  });

  it('transforms progressively over roughly one second and settles on the new era', () => {
    const { controller } = makeController();
    controller.applyImmediate(1945);

    controller.selectYear(1985);
    const start = controller.state;
    expect(start.active).toBe(true);
    expect(start.from).toBe(1945);
    expect(start.to).toBe(1985);
    expect(start.progress).toBe(0);
    expect(controller.visibleYears.sort()).toEqual([1945, 1985]);

    const elapsed = runToCompletion(controller);
    expect(elapsed).toBeGreaterThanOrEqual(0.9);
    expect(elapsed).toBeLessThanOrEqual(1.4);

    const end = controller.state;
    expect(end.active).toBe(false);
    expect(end.committed).toBe(1985);
    expect(end.progress).toBe(1);
    expect(end.weights[1985]).toBeCloseTo(1, 6);
    expect(end.weights[1945]).toBeCloseTo(0, 6);
    expect(controller.visibleYears).toEqual([1985]);
    expect(controller.currentGrade).toEqual(ERAS[1985].grade);
    expect(controller.currentFog.density).toBeCloseTo(ERAS[1985].palette.fogDensity, 8);
    expect(controller.currentFog.color.getHexString()).toBe(ERAS[1985].palette.fog.replace('#', '').toLowerCase());
    expect(controller.currentPalette.skyTop.toLowerCase()).toBe(ERAS[1985].palette.skyTop.toLowerCase());
  });

  it('reports blend weights inside (0,1) with both layers referenced mid-change', () => {
    const { controller, layers } = makeController();
    controller.applyImmediate(1945);
    controller.selectYear(2025);
    controller.update(0.5);

    const mid = controller.state;
    expect(mid.active).toBe(true);
    expect(mid.progress).toBeGreaterThan(0.1);
    expect(mid.progress).toBeLessThan(0.9);
    expect(mid.weights[1945]).toBeGreaterThan(0);
    expect(mid.weights[1945]).toBeLessThan(1);
    expect(mid.weights[2025]).toBeGreaterThan(0);
    expect(mid.weights[2025]).toBeLessThan(1);
    expect(mid.weights[1965]).toBe(0);
    expect(layers.get(1945)?.group.visible).toBe(true);
    expect(layers.get(2025)?.group.visible).toBe(true);

    // The staged swap means at least one category is mid-handover and never
    // more than a couple of categories are blended at once.
    const blends = CATEGORY_ORDER.map((category) => controller.categoryBlend(category));
    const midSwap = blends.filter((blend) => blend.incoming > 0.001 && blend.incoming < 0.999);
    expect(midSwap.length).toBeGreaterThan(0);
    // Staged per-category swap: never more than two categories mid-hand-over.
    expect(midSwap.length).toBeLessThanOrEqual(2);
    for (const blend of midSwap) {
      expect(blend.incomingVisible).toBe(true);
      expect(blend.outgoingVisible).toBe(true);
    }

    // The grade is genuinely between the two eras while changing.
    const grade = controller.currentGrade;
    expect(grade.saturation).toBeGreaterThan(Math.min(ERAS[1945].grade.saturation, ERAS[2025].grade.saturation));
    expect(grade.saturation).toBeLessThan(Math.max(ERAS[1945].grade.saturation, ERAS[2025].grade.saturation));
    expect(grade.grain).toBeGreaterThan(ERAS[2025].grade.grain);
    expect(grade.grain).toBeLessThan(ERAS[1945].grade.grain);
  });

  it('scrubs a live preview between neighbours without committing', () => {
    const { controller, layers } = makeController();
    controller.applyImmediate(1945);
    controller.preview(2.5);

    const state = controller.state;
    expect(state.previewing).toBe(true);
    expect(state.active).toBe(false);
    expect(state.committed).toBe(1945);
    expect(state.from).toBe(1985);
    expect(state.to).toBe(2005);
    expect(state.weights[1985]).toBeCloseTo(0.5, 6);
    expect(state.weights[2005]).toBeCloseTo(0.5, 6);
    expect(state.weights[1945]).toBe(0);
    expect(controller.visibleYears.sort()).toEqual([1985, 2005]);
    expect(layers.get(1945)?.group.visible).toBe(false);

    // Previewing near a stop biases towards that stop.
    controller.preview(1.15);
    expect(controller.state.weights[1965]).toBeCloseTo(0.85, 6);
    expect(controller.state.weights[1985]).toBeCloseTo(0.15, 6);
  });

  it('snaps to the nearest stop when the drag is released', () => {
    const { controller } = makeController();
    controller.applyImmediate(1945);
    controller.preview(2.4);
    controller.commitPreview(2.4);
    expect(controller.state.previewing).toBe(false);
    expect(controller.state.committed).toBe(1985);
    expect(controller.visibleYears).toEqual([1985]);

    controller.preview(3.6);
    controller.commitPreview(3.6);
    expect(controller.state.committed).toBe(2025);
    expect(controller.visibleYears).toEqual([2025]);
  });

  it('fires exactly one start and one complete event per selection', () => {
    const { events, controller } = makeController();
    controller.applyImmediate(1945);
    events.length = 0;

    controller.selectYear(1985);
    runToCompletion(controller);
    expect(events.filter((event) => event.type === 'start')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(1);
    expect(events.find((event) => event.type === 'start')).toMatchObject({ from: 1945, to: 1985 });
    expect(events.find((event) => event.type === 'complete')).toMatchObject({ from: 1945, to: 1985 });

    // Selecting the era that is already on screen is a no-op beyond the settle.
    controller.selectYear(1985);
    expect(events.filter((event) => event.type === 'start')).toHaveLength(1);

    // A second selection fires its own single pair of events.
    controller.selectYear(2025);
    runToCompletion(controller);
    expect(events.filter((event) => event.type === 'start')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(2);
  });

  it('resolves quickly when prefers-reduced-motion is on', () => {
    const { controller } = makeController({ reducedMotion: true });
    controller.applyImmediate(1945);
    expect(controller.duration).toBeLessThan(0.3);
    controller.selectYear(2025);
    const elapsed = runToCompletion(controller, 0.05, 20);
    expect(elapsed).toBeLessThanOrEqual(0.2);
    expect(controller.state.committed).toBe(2025);
    expect(controller.currentGrade).toEqual(ERAS[2025].grade);
  });

  it('lerps the sky palette between eras', () => {
    const { controller } = makeController();
    controller.applyImmediate(1945);
    controller.selectYear(2025);
    controller.update(0.5);
    const palette = controller.currentPalette;
    expect(palette.skyTop.toLowerCase()).not.toBe(ERAS[1945].palette.skyTop.toLowerCase());
    expect(palette.skyTop.toLowerCase()).not.toBe(ERAS[2025].palette.skyTop.toLowerCase());
    expect(palette.fogDensity).toBeGreaterThan(Math.min(ERAS[1945].palette.fogDensity, ERAS[2025].palette.fogDensity));
    expect(palette.fogDensity).toBeLessThan(Math.max(ERAS[1945].palette.fogDensity, ERAS[2025].palette.fogDensity));
  });

  it('never shows more than two layers at once while scrubbing the whole timeline', () => {
    const { controller } = makeController();
    controller.applyImmediate(1945);
    for (let index = 0; index <= 4; index += 0.1) {
      controller.preview(index);
      expect(controller.visibleYears.length).toBeLessThanOrEqual(2);
      expect(controller.visibleYears.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('never blanks the block when the chosen era is already the dominant one', () => {
    const { controller, layers } = makeController();
    controller.applyImmediate(1945);

    // A pointer press used to start a scrub that made 1985 the visible era;
    // committing that same stop then handed 1985 over to itself, hid every
    // category and left the viewport showing nothing but fog. The scene must
    // always end up with a single, fully visible era.
    controller.preview(2);
    controller.selectYear(1985);
    expect(controller.state.active).toBe(false);
    expect(controller.visibleYears).toEqual([1985]);
    expect(layers.get(1985)?.group.visible).toBe(true);
    for (const category of CATEGORY_ORDER) {
      expect(layers.get(1985)?.categories[category].visible, category).toBe(true);
    }

    // Selecting the era the change is already heading to must settle it there
    // rather than re-targeting it onto itself.
    controller.selectYear(2025);
    for (let step = 0; step < 3; step += 1) controller.update(0.25);
    expect(controller.state.active).toBe(true);
    expect(controller.state.progress).toBeGreaterThan(0.5);
    expect(controller.state.to).toBe(2025);
    controller.selectYear(2025);
    expect(controller.state.active).toBe(false);
    expect(controller.visibleYears).toEqual([2025]);
    for (const category of CATEGORY_ORDER) {
      expect(layers.get(2025)?.categories[category].visible, category).toBe(true);
    }

    // Retargeting mid-change keeps both layers alive and settles on the new era.
    controller.selectYear(1945);
    controller.update(0.3);
    expect(controller.visibleYears.slice().sort()).toEqual([1945, 2025]);
    runToCompletion(controller);
    expect(controller.visibleYears).toEqual([1945]);
  });

  it('leaves one complete era on screen after every selection', () => {
    const { controller, layers } = makeController();
    for (const year of YEARS) {
      controller.applyImmediate(1945);
      controller.selectYear(year);
      runToCompletion(controller);
      expect(controller.visibleYears, `selecting ${year}`).toEqual([year]);
      const layer = layers.get(year);
      expect(layer?.group.visible).toBe(true);
      for (const category of CATEGORY_ORDER) {
        expect(layer?.categories[category].visible, `${year} ${category}`).toBe(true);
        expect(layer?.categories[category].scale.x).toBeCloseTo(1, 6);
        expect(layer?.categories[category].position.y).toBeCloseTo(0, 6);
      }
      expect(controller.state.progress).toBe(1);
      expect(controller.state.committed).toBe(year);
    }
  });

  it('settles a released scrub on the era that was on screen', () => {
    const { controller } = makeController();
    controller.applyImmediate(1945);

    controller.preview(1.15);
    expect(controller.state.previewing).toBe(true);
    controller.cancelPreview();
    expect(controller.state.previewing).toBe(false);
    expect(controller.state.committed).toBe(1965);
    expect(controller.visibleYears).toEqual([1965]);

    controller.preview(3.6);
    controller.cancelPreview();
    expect(controller.state.committed).toBe(2025);
    expect(controller.visibleYears).toEqual([2025]);
  });
});
