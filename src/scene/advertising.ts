/** Era-aware advertising, hosted only on the layout's dedicated ad anchors. */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";

import {
  clampBlend,
  getEraConfig,
  type AdMedium,
  type EraConfig,
  type EraId,
  type EraSceneSystem,
  type EraUpdateContext,
} from "../era/eraTypes";
import { CITY_LAYOUT, type CityLayout, type PropSlot } from "./layout";
import { createAdTexture } from "./adTextures";

/** Distinct ad treatments distributed across the contract's generic signage slots. */
export type AdFormat = "billboard" | "painted-wall" | "pole-banner" | "shelter-poster" | "window-poster" | "led-ticker";
export type AdvertisingMedium = "painted" | "neon" | "backlit" | "led" | "holographic";

export interface AdvertisingPlacement {
  readonly slot: PropSlot;
  readonly format: AdFormat;
  readonly group: Group;
  readonly spill: PointLight;
  /** Current transition endpoints, available for scene diagnostics and tests. */
  mediaFrom: AdvertisingMedium;
  mediaTo: AdvertisingMedium;
  blend: number;
  animated: boolean;
}

interface CreativeVariant {
  readonly era: EraId;
  readonly medium: AdvertisingMedium;
  readonly group: Group;
  readonly texture: CanvasTexture;
  readonly materials: readonly Material[];
  readonly geometries: readonly BufferGeometry[];
  readonly width: number;
  readonly animated: boolean;
}

const AD_FORMATS: readonly AdFormat[] = ["billboard", "painted-wall", "pole-banner", "shelter-poster", "window-poster"];
const NEUTRAL_SPILL = new Color(0x000000);

function hashSlot(value: string): number {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function getMedium(era: EraId): AdvertisingMedium {
  switch (era) {
    case "1945": return "painted";
    case "1965": return "neon";
    case "1985": return "backlit";
    case "2005": return "led";
    case "2025": return "holographic";
  }
}

/** The contract has generic ad anchors; varied formats share them deterministically. */
function getFormat(slot: PropSlot, index: number): AdFormat {
  const format = AD_FORMATS[index % AD_FORMATS.length]!;
  // A stable, descriptive slot id marks the few display elements with a ticker treatment.
  return format === "billboard" && /ticker|digital/i.test(slot.id) ? "led-ticker" : format;
}

function getDeclaredMedium(era: EraConfig, format: AdFormat): AdMedium {
  const media = era.advertising.media;
  const requested: Readonly<Record<EraId, readonly AdMedium[]>> = {
    "1945": format === "billboard"
      ? ["war-bond-poster", "billboard-14x48"]
      : ["painted-wall-bulletin", "transit-card", "war-bond-poster"],
    "1965": format === "pole-banner"
      ? ["marquee-blade", "neon-sign"]
      : ["neon-sign", "billboard-14x48"],
    "1985": format === "billboard"
      ? ["billboard-panel", "backlit-plexiglass"]
      : ["backlit-plexiglass", "bus-shelter-poster", "billboard-panel"],
    "2005": format === "led-ticker"
      ? ["street-furniture-lcd", "digital-kiosk"]
      : ["billboard-panel", "street-furniture-lcd", "bus-wrap"],
    "2025": format === "window-poster"
      ? ["augmented-reality-overlay", "programmatic-led-screen"]
      : ["programmatic-led-screen", "carbon-negative-sponsorship-panel", "digital-kiosk"],
  };
  return requested[era.id].find((candidate) => media.includes(candidate)) ?? media[0]!;
}

function getPanelSize(slot: PropSlot, format: AdFormat): { width: number; height: number } {
  const declared = slot.displaySize ?? { width: 2, height: 2.6 };
  switch (format) {
    case "billboard": return { width: declared.width, height: declared.height };
    case "painted-wall": return { width: declared.width * 0.82, height: declared.height * 0.78 };
    case "pole-banner": return { width: declared.width * 0.48, height: declared.height * 0.8 };
    case "shelter-poster": return { width: declared.width * 0.64, height: declared.height * 0.82 };
    case "window-poster": return { width: declared.width * 0.52, height: declared.height * 0.62 };
    case "led-ticker": return { width: declared.width, height: declared.height * 0.44 };
  }
}

function disposeVariant(variant: CreativeVariant): void {
  variant.group.removeFromParent();
  for (const geometry of variant.geometries) geometry.dispose();
  for (const material of variant.materials) material.dispose();
  variant.texture.dispose();
}

function makeCreative(slot: PropSlot, format: AdFormat, era: EraConfig, seed: number): CreativeVariant {
  const group = new Group();
  group.name = `ad-creative-${era.id}-${slot.id}`;
  const { width, height } = getPanelSize(slot, format);
  const texture = createAdTexture(era, format, seed);
  const color = new Color(era.palette.accent);
  const medium = getMedium(era.id);
  const emissive = medium !== "painted";
  const emissiveIntensity = emissive ? Math.min(0.34, Math.max(0.12, era.advertising.brightness * 0.38)) : 0;
  const materials: Material[] = [];
  const geometries: BufferGeometry[] = [];

  const panelGeometry = new PlaneGeometry(width, height);
  const panelMaterial = new MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    roughness: medium === "backlit" ? 0.32 : 0.72,
    metalness: medium === "neon" ? 0.12 : 0,
    emissive: emissive ? color : NEUTRAL_SPILL,
    emissiveMap: emissive ? texture : null,
    emissiveIntensity,
    transparent: true,
    opacity: 1,
    side: DoubleSide,
    toneMapped: true,
  });
  const panel = new Mesh(panelGeometry, panelMaterial);
  panel.name = `ad-panel-${era.id}`;
  panel.userData.media = getDeclaredMedium(era, format);
  group.add(panel);
  geometries.push(panelGeometry);
  materials.push(panelMaterial);

  const trimDepth = Math.max(0.035, width * 0.024);
  const trimColor = medium === "neon" ? 0xff45bd : medium === "holographic" ? 0x74f2ce : era.palette.accent;
  const trimMaterial = new MeshBasicMaterial({
    color: trimColor,
    transparent: true,
    opacity: medium === "painted" ? 0.78 : 0.9,
    toneMapped: medium === "painted",
  });
  materials.push(trimMaterial);
  const trimParts: readonly [number, number, number, number][] = [
    [0, height / 2, width + trimDepth, trimDepth],
    [0, -height / 2, width + trimDepth, trimDepth],
    [-width / 2, 0, trimDepth, height],
    [width / 2, 0, trimDepth, height],
  ];
  for (const [x, y, trimWidth, trimHeight] of trimParts) {
    const geometry = new BoxGeometry(trimWidth, trimHeight, trimDepth);
    const trim = new Mesh(geometry, trimMaterial);
    trim.position.set(x, y, 0.012);
    group.add(trim);
    geometries.push(geometry);
  }

  if (format === "led-ticker" || medium === "led" || medium === "holographic") {
    const indicatorMaterial = new MeshBasicMaterial({
      color: medium === "holographic" ? 0x91ffe1 : 0xffd361,
      transparent: true,
      opacity: 0.8,
      toneMapped: true,
    });
    materials.push(indicatorMaterial);
    const indicatorGeometry = new BoxGeometry(width * 0.72, trimDepth * 0.52, trimDepth * 0.4);
    const indicator = new Mesh(indicatorGeometry, indicatorMaterial);
    indicator.position.set(0, -height * 0.43, 0.025);
    group.add(indicator);
    geometries.push(indicatorGeometry);
  }

  return {
    era: era.id,
    medium,
    group,
    texture,
    materials,
    geometries,
    width,
    animated: hashSlot(slot.id) % 1000 < Math.round(era.advertising.animatedShare * 1000),
  };
}

interface PlacementState extends AdvertisingPlacement {
  active: CreativeVariant;
  source: CreativeVariant | null;
  target: CreativeVariant | null;
  spillColor: Color;
}

function applyOpacity(variant: CreativeVariant, opacity: number, elapsed: number): void {
  const pulse = variant.medium === "holographic" && variant.animated
    ? 0.93 + Math.sin(elapsed * 2.7) * 0.045
    : 1;
  for (const material of variant.materials) {
    if ("opacity" in material && typeof material.opacity === "number") material.opacity = opacity * pulse;
  }
  if (variant.animated && (variant.medium === "led" || variant.medium === "holographic")) {
    variant.texture.wrapS = RepeatWrapping;
    variant.texture.offset.x = (elapsed * (variant.medium === "led" ? 0.018 : 0.01)) % 1;
  }
}

/** Creates the slot-anchored, browser-renderable advertising scene system. */
export function createAdvertisingSystem(layout: CityLayout = CITY_LAYOUT): EraSceneSystem & {
  readonly placements: readonly AdvertisingPlacement[];
} {
  const slots = layout.propSlots.filter((slot) => slot.type === "signage" && slot.signageKind === "advertisement");
  if (slots.length === 0) throw new Error("Advertising requires layout slots marked as advertisement signage.");

  const group = new Group();
  group.name = "era-advertising-system";
  const placements: PlacementState[] = slots.map((slot, index) => {
    const format = getFormat(slot, index);
    const anchor = new Group();
    anchor.name = `ad-placement-${slot.id}`;
    anchor.position.set(slot.anchor.position.x, slot.anchor.position.y, slot.anchor.position.z);
    anchor.rotation.set(slot.anchor.rotation.x, slot.anchor.rotation.y, slot.anchor.rotation.z);
    anchor.scale.set(slot.anchor.scale.x, slot.anchor.scale.y, slot.anchor.scale.z);
    const active = makeCreative(slot, format, getEraConfig("1945"), hashSlot(slot.id));
    anchor.add(active.group);
    group.add(anchor);

    const spill = new PointLight(0xffffff, 0, 5, 2);
    spill.name = `ad-light-spill-${slot.id}`;
    spill.position.set(0, 0, 0.12);
    anchor.add(spill);

    return {
      slot,
      format,
      group: anchor,
      spill,
      mediaFrom: "painted",
      mediaTo: "painted",
      blend: 1,
      animated: active.animated,
      active,
      source: null,
      target: null,
      spillColor: new Color(0xffffff),
    };
  });

  let elapsed = 0;
  let disposed = false;

  const beginTransition = (placement: PlacementState, era: EraConfig): void => {
    const dominant = placement.target && placement.blend >= 0.5 ? placement.target : placement.active;
    if (placement.source) disposeVariant(placement.source);
    if (placement.target && placement.target !== dominant) disposeVariant(placement.target);
    placement.active = dominant;
    placement.active.group.visible = true;
    placement.source = placement.active;
    placement.target = makeCreative(placement.slot, placement.format, era, hashSlot(placement.slot.id));
    placement.group.add(placement.target.group);
    placement.mediaFrom = placement.source.medium;
    placement.mediaTo = placement.target.medium;
    placement.blend = 0;
  };

  const completeTransition = (placement: PlacementState): void => {
    if (!placement.source || !placement.target) return;
    const old = placement.source;
    const next = placement.target;
    placement.active = next;
    placement.source = null;
    placement.target = null;
    placement.active.group.visible = true;
    applyOpacity(placement.active, 1, elapsed);
    disposeVariant(old);
    placement.mediaFrom = placement.active.medium;
    placement.mediaTo = placement.active.medium;
    placement.blend = 1;
    placement.animated = placement.active.animated;
  };

  return {
    id: "advertising",
    group,
    placements,
    applyEra(era: EraId, rawBlend: number): void {
      if (disposed) return;
      const blend = clampBlend(rawBlend);
      const config = getEraConfig(era);
      for (const placement of placements) {
        if (!placement.target && placement.active.era !== era) beginTransition(placement, config);
        else if (placement.target && placement.target.era !== era) beginTransition(placement, config);

        if (placement.target && placement.source) {
          placement.blend = blend;
          applyOpacity(placement.source, 1 - blend, elapsed);
          applyOpacity(placement.target, blend, elapsed);
          const spillLevel = blend * Math.min(0.29, config.advertising.brightness * 0.32);
          placement.spill.color.set(config.palette.accent);
          placement.spill.intensity = spillLevel;
          placement.spill.visible = spillLevel > 0;
          if (blend >= 1) completeTransition(placement);
        } else {
          placement.blend = 1;
          placement.mediaFrom = placement.active.medium;
          placement.mediaTo = placement.active.medium;
          const emissive = placement.active.medium !== "painted";
          placement.spill.color.copy(emissive ? new Color(config.palette.accent) : NEUTRAL_SPILL);
          placement.spill.intensity = emissive ? Math.min(0.29, config.advertising.brightness * 0.32) : 0;
          placement.spill.visible = emissive;
          placement.animated = placement.active.animated;
        }
      }
    },
    update(context: EraUpdateContext): void {
      if (disposed) return;
      elapsed = context.elapsed;
      for (const placement of placements) {
        if (placement.source && placement.target) {
          applyOpacity(placement.source, 1 - placement.blend, elapsed);
          applyOpacity(placement.target, placement.blend, elapsed);
        } else applyOpacity(placement.active, 1, elapsed);
      }
    },
    getPickables(): readonly Object3D[] {
      return placements.map(({ group: placement }) => placement);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const placement of placements) {
        if (placement.source) disposeVariant(placement.source);
        if (placement.target) disposeVariant(placement.target);
        if (!placement.source && !placement.target) disposeVariant(placement.active);
        else if (placement.active !== placement.source && placement.active !== placement.target) disposeVariant(placement.active);
        placement.spill.dispose();
      }
      placements.length = 0;
      group.clear();
    },
  };
}

/** Stable mapping from ad media family to the era descriptor's authored media. */
export function getAdvertisingMediumType(era: EraId, format: AdFormat): AdMedium {
  return getDeclaredMedium(getEraConfig(era), format);
}

