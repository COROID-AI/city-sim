import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ERAS } from "../src/era/eraTypes";
import { CITY_LAYOUT } from "../src/scene/layout";
import { createAdvertisingSystem, getAdvertisingMediumType, type AdvertisingMedium } from "../src/scene/advertising";

const ERA_MEDIA: Readonly<Record<string, AdvertisingMedium>> = {
  "1945": "painted",
  "1965": "neon",
  "1985": "backlit",
  "2005": "led",
  "2025": "holographic",
};

function makeCanvasContext(): CanvasRenderingContext2D {
  return {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 12 }) as TextMetrics),
  } as unknown as CanvasRenderingContext2D;
}

function getAdPanels(root: THREE.Object3D): THREE.Mesh[] {
  const panels: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.startsWith("ad-panel-")) panels.push(object);
  });
  return panels;
}

describe("slot-anchored era advertising", () => {
  let context: CanvasRenderingContext2D;

  beforeEach(() => {
    context = makeCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => context as CanvasRenderingContext2D,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("generates an ad on every real advertisement slot at the declared anchor transform", () => {
    const system = createAdvertisingSystem(CITY_LAYOUT);
    const expectedSlots = CITY_LAYOUT.propSlots.filter(
      (slot) => slot.type === "signage" && slot.signageKind === "advertisement",
    );

    expect(system.placements).toHaveLength(expectedSlots.length);
    expect(system.placements.length).toBeGreaterThanOrEqual(12);
    expect(system.placements.map(({ slot }) => slot.id)).toEqual(expectedSlots.map(({ id }) => id));
    expect(new Set(system.placements.map(({ format }) => format)).size).toBeGreaterThanOrEqual(5);

    for (const placement of system.placements) {
      expect(placement.group.position.toArray()).toEqual([
        placement.slot.anchor.position.x,
        placement.slot.anchor.position.y,
        placement.slot.anchor.position.z,
      ]);
      expect(placement.group.rotation.toArray().slice(0, 3)).toEqual([
        placement.slot.anchor.rotation.x,
        placement.slot.anchor.rotation.y,
        placement.slot.anchor.rotation.z,
      ]);
      expect(placement.group.scale.toArray()).toEqual([
        placement.slot.anchor.scale.x,
        placement.slot.anchor.scale.y,
        placement.slot.anchor.scale.z,
      ]);
      expect(placement.group.parent).toBe(system.group);
    }
    system.dispose?.();
  });

  it("uses each era's real advertising descriptor for period-appropriate media and texture art", () => {
    const system = createAdvertisingSystem();
    expect(getAdPanels(system.group)).toHaveLength(system.placements.length);

    for (const era of ERAS) {
      const expectedMedium = ERA_MEDIA[era.id]!;
      for (const placement of system.placements) {
        system.applyEra(era.id, 1);
        expect(placement.mediaTo).toBe(expectedMedium);
        expect(era.advertising.media).toContain(getAdvertisingMediumType(era.id, placement.format));
      }
      expect(context.fillText).toHaveBeenCalled();
      expect(context.fillRect).toHaveBeenCalled();
    }

    for (const era of ERAS) {
      const systemForEra = createAdvertisingSystem();
      systemForEra.applyEra(era.id, 1);
      const panels = getAdPanels(systemForEra.group).filter((panel) => panel.name === `ad-panel-${era.id}`);
      expect(panels).toHaveLength(systemForEra.placements.length);
      for (const panel of panels) {
        const material = panel.material as THREE.MeshStandardMaterial;
        if (era.id === "1945") expect(material.emissiveIntensity).toBe(0);
        else {
          expect(material.emissiveIntensity).toBeGreaterThan(0);
          expect(material.emissiveIntensity).toBeLessThanOrEqual(0.34);
        }
        expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
      }
      expect(systemForEra.placements.every(({ spill }) => spill.intensity === 0)).toBe(era.id === "1945");
      if (era.id !== "1945") {
        expect(systemForEra.placements.every(({ spill }) => spill.intensity > 0 && spill.intensity <= 0.29)).toBe(true);
      }
      systemForEra.dispose?.();
    }
    system.dispose?.();
  });

  it("crossfades creatives continuously, clamps blend, animates UVs cheaply, and disposes old GPU assets", () => {
    const textureDispose = vi.spyOn(THREE.Texture.prototype, "dispose");
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const system = createAdvertisingSystem();
    const first = system.placements[0]!;
    const startingGeometryDisposals = geometryDispose.mock.calls.length;

    system.applyEra("1965", 0.4);
    expect(first.mediaFrom).toBe("painted");
    expect(first.mediaTo).toBe("neon");
    expect(first.blend).toBeCloseTo(0.4);
    expect(getAdPanels(first.group)).toHaveLength(2);
    const sourcePanel = getAdPanels(first.group).find((panel) => panel.name === "ad-panel-1945")!;
    const targetPanel = getAdPanels(first.group).find((panel) => panel.name === "ad-panel-1965")!;
    expect((sourcePanel.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.6);
    expect((targetPanel.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.4);
    expect(textureDispose.mock.calls.length).toBe(0);
    expect(geometryDispose).toHaveBeenCalledTimes(startingGeometryDisposals);

    const textureDisposalsBeforeSwap = textureDispose.mock.calls.length;
    const geometryDisposalsBeforeSwap = geometryDispose.mock.calls.length;
    system.applyEra("1965", 1);
    expect(first.mediaFrom).toBe("neon");
    expect(first.mediaTo).toBe("neon");
    expect(getAdPanels(first.group)).toHaveLength(1);
    expect(textureDispose.mock.calls.length).toBe(textureDisposalsBeforeSwap + system.placements.length);
    expect(geometryDispose.mock.calls.length).toBeGreaterThan(geometryDisposalsBeforeSwap);

    system.applyEra("2005", -5);
    expect(first.blend).toBe(0);
    expect(first.mediaFrom).toBe("neon");
    expect(first.mediaTo).toBe("led");
    system.applyEra("2005", 4);
    expect(first.blend).toBe(1);

    system.applyEra("2025", 1);
    const animated = system.placements.find((placement) => placement.animated);
    if (animated) {
      const panel = getAdPanels(animated.group).find((object) => object.name === "ad-panel-2025")!;
      const texture = (panel.material as THREE.MeshStandardMaterial).map!;
      const originalOffset = texture.offset.x;
      system.update({ era: "2025", from: "2005", blend: 1, weights: { "1945": 0, "1965": 0, "1985": 0, "2005": 0, "2025": 1 }, delta: 0.1, elapsed: 20 });
      expect(texture.offset.x).not.toBe(originalOffset);
    }
    system.dispose?.();
  });
});
