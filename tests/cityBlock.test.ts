import { beforeAll, describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { ERAS, allEras } from '../src/config/eras';
import { CATEGORY_ORDER, YEARS, type EraLayer, type Year } from '../src/config/types';
import { buildEraLayer, eraPeriodElements, layerSignature } from '../src/world/cityBlock';
import { createTextureFactory } from '../src/world/textures';

/** Headless texture factory: no canvas, so materials fall back to flat colour. */
function headlessTextures() {
  return createTextureFactory(() => null);
}

const layers = new Map<Year, EraLayer>();

beforeAll(() => {
  for (const year of YEARS) {
    layers.set(year, buildEraLayer(ERAS[year], { textures: headlessTextures() }));
  }
}, 120_000);

function elements(year: Year): string[] {
  return layers.get(year)?.periodElements ?? [];
}

describe('era layer construction (headless three.js scene graphs)', () => {
  it('meets the population thresholds for every era', () => {
    for (const year of YEARS) {
      const layer = layers.get(year);
      expect(layer, `layer ${year}`).toBeDefined();
      if (!layer) continue;
      expect(layer.counts.buildings, `${year} buildings`).toBeGreaterThanOrEqual(24);
      expect(layer.counts.vehicles, `${year} vehicles`).toBeGreaterThanOrEqual(16);
      expect(layer.counts.movingVehicles, `${year} moving vehicles`).toBeGreaterThanOrEqual(1);
      expect(layer.counts.pedestrians, `${year} pedestrians`).toBeGreaterThanOrEqual(40);
      expect(layer.counts.propCategories, `${year} prop categories`).toBeGreaterThanOrEqual(6);
      expect(layer.counts.props, `${year} props`).toBeGreaterThanOrEqual(12);
      expect(layer.counts.storefronts, `${year} storefronts`).toBeGreaterThanOrEqual(4);
      expect(layer.counts.advertisements, `${year} ads`).toBeGreaterThanOrEqual(3);
    }
  });

  it('populates every swap category with real children', () => {
    for (const year of YEARS) {
      const layer = layers.get(year);
      if (!layer) continue;
      for (const category of CATEGORY_ORDER) {
        const group = layer.categories[category];
        expect(group, `${year} ${category}`).toBeDefined();
        expect(group.children.length, `${year} ${category} children`).toBeGreaterThan(0);
      }
      let meshCount = 0;
      layer.group.traverse((object) => {
        if ((object as { isMesh?: boolean }).isMesh) meshCount += 1;
      });
      expect(meshCount, `${year} mesh count`).toBeGreaterThan(400);
      expect(layer.emissives.length, `${year} emissive meshes`).toBeGreaterThan(0);
    }
  });

  it('describes the era soundscape with its ambience layers', () => {
    for (const year of YEARS) {
      const layer = layers.get(year);
      if (!layer) continue;
      expect(layer.ambienceTags.length).toBeGreaterThanOrEqual(4);
      expect(layer.ambienceTags).toEqual(ERAS[year].audio.ambience.map((entry) => entry.id));
    }
  });

  it('contains period-specific elements for each year', () => {
    expect(elements(1945)).toEqual(
      expect.arrayContaining([
        'tram-rails',
        'streetcar',
        'water-towers',
        'painted-ads',
        'telephone-poles',
        'fire-escapes',
        'incandescent-globe-lamps',
      ]),
    );
    expect(elements(1965)).toEqual(
      expect.arrayContaining(['neon-signs', 'neon-diner-signs', 'water-towers', 'roof-billboards', 'swan-neck-lamps']),
    );
    expect(elements(1985)).toEqual(
      expect.arrayContaining(['billboards', 'van', 'neon-signs', 'satellite-dishes', 'sodium-cobra-lamps']),
    );
    expect(elements(2005)).toEqual(
      expect.arrayContaining(['suv', 'digital-billboard', 'bus-stop-shelter', 'led-slim-lamps', 'curtain-wall-glass']),
    );
    expect(elements(2025)).toEqual(
      expect.arrayContaining(['ev', 'scooter', 'led-media-facade', 'bike-lane', 'led-organic-lamps', 'roof-gardens']),
    );

    // 1945 physically has rails in its road group; 2025 has a bike lane.
    expect(layers.get(1945)?.categories.roads.getObjectByName('tram-rails')?.children.length).toBeGreaterThan(0);
    expect(layers.get(2025)?.categories.roads.getObjectByName('bike-lane')?.children.length).toBeGreaterThan(0);
    expect(layers.get(1985)?.categories.roads.getObjectByName('tram-rails')?.children.length).toBe(0);
  });

  it('gives every decade a different set of period elements', () => {
    const sets = YEARS.map((year) => elements(year).slice().sort().join(','));
    expect(new Set(sets).size).toBe(YEARS.length);
  });

  it('tags buildings, vehicles and pedestrians with focus metadata for the info card', () => {
    for (const year of YEARS) {
      const layer = layers.get(year);
      if (!layer) continue;
      const focusables: string[] = [];
      layer.group.traverse((object) => {
        const focus = object.userData?.focus as { kind?: string } | undefined;
        if (focus?.kind) focusables.push(focus.kind);
      });
      expect(focusables).toContain('building');
      expect(focusables).toContain('vehicle');
      expect(focusables).toContain('pedestrian');
      expect(focusables).toContain('prop');
      expect(focusables).toContain('storefront');
      expect(focusables).toContain('advertisement');

      // The info card writes `detail` and `period` straight into two paragraphs,
      // so every focus target must carry period-aware copy for both of them.
      layer.group.traverse((object) => {
        const focus = object.userData?.focus as
          | { kind?: string; detail?: string; period?: string }
          | undefined;
        if (!focus?.kind) return;
        expect(focus.detail ?? '', `${year} ${focus.kind} detail`).not.toBe('');
        expect(focus.period ?? '', `${year} ${focus.kind} period`).not.toBe('');
        expect(focus.period ?? '', `${year} ${focus.kind} period mentions the year`).toContain(String(year));
      });
    }
  });

  it('drives traffic and crowds when the layer is updated', () => {
    const layer = layers.get(1985);
    expect(layer).toBeDefined();
    if (!layer) return;
    const fleet = layer.group.userData.trafficVehicles as
      | { spec: { id: string }; group: THREE.Object3D; moving: boolean }[]
      | undefined;
    expect(fleet && fleet.length).toBeGreaterThanOrEqual(16);
    const moving = (fleet ?? []).filter((entry) => entry.moving);
    expect(moving.length).toBeGreaterThan(0);
    const before = moving.map((entry) => entry.group.position.clone());
    for (let i = 0; i < 30; i += 1) layer.update(1 / 30);
    const after = moving.map((entry) => entry.group.position.clone());
    const moved = before.some((position, index) => position.distanceTo(after[index]) > 0.5);
    expect(moved, 'traffic should move').toBe(true);

    const walkers = layer.categories.pedestrians.children;
    expect(walkers.length).toBeGreaterThanOrEqual(40);
    const walkerBefore = walkers.map((child) => child.position.clone());
    for (let i = 0; i < 30; i += 1) layer.update(1 / 30);
    expect(walkers.some((child, index) => child.position.distanceTo(walkerBefore[index]) > 0.05)).toBe(true);
  });

  it('builds deterministically from the seeded RNG', () => {
    const first = buildEraLayer(ERAS[1945], { textures: headlessTextures() });
    const second = buildEraLayer(ERAS[1945], { textures: headlessTextures() });
    expect(layerSignature(first)).toBe(layerSignature(second));
    expect(first.counts).toEqual(second.counts);
    expect(first.periodElements).toEqual(second.periodElements);
    first.dispose();
    second.dispose();
  });

  it('disposes without throwing', () => {
    const layer = buildEraLayer(ERAS[2025], { textures: headlessTextures() });
    expect(() => layer.dispose()).not.toThrow();
  });

  it('derives period elements purely from era data', () => {
    for (const era of allEras()) {
      const derived = eraPeriodElements(era);
      expect(derived.length).toBeGreaterThan(6);
      expect(new Set(derived).size).toBe(derived.length);
    }
  });
});
