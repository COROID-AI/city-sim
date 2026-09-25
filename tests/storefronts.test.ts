import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ERAS,
  ERA_IDS,
  resolveEraWeights,
  type EraId,
  type EraUpdateContext,
} from "../src/era/eraTypes";
import { BUILDING_LOTS, CITY_LAYOUT, type BuildingLot, type CardinalSide } from "../src/scene/layout";
import {
  ERA_FACADE_STYLE,
  ERA_SHOP_PROGRAMMES,
  REQUIRED_ERA_SHOP_LABELS,
  STOREFRONT_GLOW_GAIN,
  STOREFRONT_SYSTEM_ID,
  STOREFRONT_WEAR_OVERLAY_OPACITY,
  StorefrontSystem,
  lerpMorphChannels,
  planFingerprint,
  planStorefronts,
  shopProgrammesFor,
  validateStorefrontCatalogue,
  weightedInteriorGlow,
  type StorefrontPlan,
  type StorefrontSystemOptions,
  type StorefrontUnit,
} from "../src/scene/storefronts";
import {
  ERA_TYPOGRAPHY,
  SIGN_STRUCTURE_GLOW,
  TEXTURE_SLOT_SIZES,
  paintSignageRecipe,
  signStructureFor,
  type CanvasSurface,
  type CanvasSurfaceFactory,
  type SignStructure,
} from "../src/scene/storefrontTextures";

/**
 * Composition tests for the era storefront system.
 *
 * Everything is driven from the *real* contracts: `ERA_IDS`/`ERAS` supply the
 * era dataset, `CITY_LAYOUT` supplies the block lots, and the storefront system
 * is asked to generate and morph its units exactly as scene assembly will. The
 * assertions cover the four acceptance criteria end to end: era-specific shop
 * mixes, one fully detailed storefront per frontage, high facade detail density,
 * and a continuous 0..1 morph with geometry/texture disposal on swap.
 *
 * Canvas textures are verified through a recording 2D context: the painters run
 * for real, so the glyph, font, decoration and disposal evidence is produced by
 * the production code path rather than approximated by the test.
 */

/* -------------------------------------------------------------------------- */
/* Test doubles                                                               */
/* -------------------------------------------------------------------------- */

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** Recording stand-in for a 2D context; the painters only touch this subset. */
function createRecordingContext(calls: RecordedCall[]): CanvasRenderingContext2D {
  const record = (method: string) => (...args: unknown[]): void => {
    calls.push({ method, args });
  };
  const gradient = {
    addColorStop: (offset: number, color: string): void => {
      calls.push({ method: "addColorStop", args: [offset, color] });
    },
  };
  const stub = {
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arc: record("arc"),
    rect: record("rect"),
    fill: record("fill"),
    stroke: record("stroke"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    fillText: record("fillText"),
    strokeText: record("strokeText"),
    setLineDash: record("setLineDash"),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: (text: string): { width: number } => ({ width: Array.from(text).length * 6 }),
  };
  return stub as unknown as CanvasRenderingContext2D;
}

/** Canvas factory that hands every texture a real canvas image and a recording context. */
function createTestCanvasFactory(): CanvasSurfaceFactory {
  return (width: number, height: number): CanvasSurface => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return { image: canvas, width, height, getContext: () => createRecordingContext([]) };
  };
}

function createSystem(overrides: Partial<StorefrontSystemOptions> = {}): StorefrontSystem {
  return new StorefrontSystem({ canvasFactory: createTestCanvasFactory(), ...overrides });
}

function updateContext(era: EraId, from: EraId, blend: number, elapsed = 3): EraUpdateContext {
  return { era, from, blend, weights: resolveEraWeights(from, era, blend), delta: 1 / 60, elapsed };
}

function planFor(system: StorefrontSystem, era: EraId): readonly StorefrontPlan[] {
  return system.units.map((unit) => unit.planFor(era));
}

function rolesOf(unit: StorefrontUnit): readonly string[] {
  const roles: string[] = [];
  unit.group.traverse((child) => {
    const role = child.userData.role;
    if (typeof role === "string") {
      roles.push(role);
    }
  });
  return roles;
}

/** Tangent axis of a frontage ring: north/south lots run along X, east/west along Z. */
function tangentAxis(side: CardinalSide): "x" | "z" {
  return side === "north" || side === "south" ? "x" : "z";
}

function tangentInterval(lot: BuildingLot): readonly [number, number] {
  const axis = tangentAxis(lot.streetSide);
  const centre = lot.center[axis];
  return [centre - lot.frontageWidth / 2, centre + lot.frontageWidth / 2];
}

function overlaps(left: readonly [number, number], right: readonly [number, number]): boolean {
  return left[0] < right[1] - 1e-9 && left[1] > right[0] + 1e-9;
}

function expectGlow(unit: StorefrontUnit, weightedGlow: number, tolerance = 0.07): void {
  const expected = STOREFRONT_GLOW_GAIN * weightedGlow;
  expect(unit.glowIntensity).toBeGreaterThan(expected * (1 - tolerance));
  expect(unit.glowIntensity).toBeLessThan(expected * (1 + tolerance));
}

/* -------------------------------------------------------------------------- */
/* Catalogue and planning (read-only against a shared system)                  */
/* -------------------------------------------------------------------------- */

describe("era storefront system", () => {
  let system: StorefrontSystem;

  beforeAll(() => {
    system = createSystem();
  });

  afterAll(() => {
    system.dispose();
  });

  it("covers every ground-floor lot frontage with exactly one storefront aligned to its street", () => {
    expect(system.units).toHaveLength(BUILDING_LOTS.length);
    expect(new Set(system.units.map((unit) => unit.id)).size).toBe(system.units.length);
    expect(system.units.map((unit) => unit.lot.id).sort()).toEqual(BUILDING_LOTS.map((lot) => lot.id).sort());

    const localNormal = new THREE.Vector3();
    for (const unit of system.units) {
      const lot = unit.lot;
      const halfExtent = Math.abs(lot.facing.x) * lot.footprint.width / 2
        + Math.abs(lot.facing.z) * lot.footprint.depth / 2;
      expect(unit.group.position.x).toBeCloseTo(lot.center.x + lot.facing.x * halfExtent, 9);
      expect(unit.group.position.z).toBeCloseTo(lot.center.z + lot.facing.z * halfExtent, 9);

      // Local +Z is the streetward normal, so the facade plane faces its street.
      localNormal.set(0, 0, 1).applyQuaternion(unit.group.quaternion);
      expect(localNormal.x).toBeCloseTo(lot.facing.x, 9);
      expect(localNormal.z).toBeCloseTo(lot.facing.z, 9);

      // The unit spans the whole frontage: exactly one storefront per frontage.
      expect(unit.plan.facade.width).toBeCloseTo(lot.frontageWidth, 9);
      expect(unit.plan.id).toBe(`${lot.id}-storefront`);
      expect(unit.group.parent).toBe(system.group);
    }

    // Frontages on the same street ring never overlap. Outer and inner parcels
    // sit at different depths, so rings are compared separately.
    for (const side of ["north", "east", "south", "west"] as const) {
      for (const frontage of ["inner", "outer"] as const) {
        const ringUnits = system.units.filter(
          (unit) => unit.lot.streetSide === side && unit.lot.frontage === frontage,
        );
        expect(ringUnits.length).toBeGreaterThan(0);
        for (let left = 0; left < ringUnits.length; left += 1) {
          for (let right = left + 1; right < ringUnits.length; right += 1) {
            expect(
              overlaps(tangentInterval(ringUnits[left]!.lot), tangentInterval(ringUnits[right]!.lot)),
              `${ringUnits[left]!.lot.id} overlaps ${ringUnits[right]!.lot.id}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it("uses an era-specific shop mix grounded in the real era descriptors", () => {
    expect(validateStorefrontCatalogue()).toEqual([]);

    const labelSets = new Map<EraId, ReadonlySet<string>>();
    for (const era of ERA_IDS) {
      const config = ERAS.find((candidate) => candidate.id === era)!;
      const plans = planFor(system, era);
      const labels = new Set(plans.map((plan) => plan.programme.label));
      labelSets.set(era, labels);

      // Every programme the era declares actually trades on the block…
      for (const programme of shopProgrammesFor(era)) {
        expect(labels.has(programme.label), `${era} is missing ${programme.label}`).toBe(true);
      }
      // …and it is the programme the brief requires for that period.
      for (const required of REQUIRED_ERA_SHOP_LABELS[era]) {
        expect(labels.has(required), `${era} is missing required programme ${required}`).toBe(true);
      }

      const kinds = new Set(config.storefronts.kinds);
      const signStyles = new Set(config.storefronts.signStyles);
      const structures = new Set(config.storefronts.signStyles.map(signStructureFor));
      for (const plan of plans) {
        expect(plan.era).toBe(era);
        expect(kinds.has(plan.programme.kind)).toBe(true);
        expect(signStyles.has(plan.programme.signStyle)).toBe(true);
        expect(structures.has(plan.signage.structure)).toBe(true);
        expect(plan.programme.brand.length).toBeGreaterThan(0);
      }
    }

    // The mix is period-specific rather than a shared menu.
    expect(labelSets.get("1945")!.has("diner")).toBe(true);
    expect(labelSets.get("1945")!.has("barber")).toBe(true);
    expect(labelSets.get("1945")!.has("tobacconist")).toBe(true);
    expect(labelSets.get("1945")!.has("grocer")).toBe(true);
    expect(labelSets.get("1965")!.has("soda-fountain")).toBe(true);
    expect(labelSets.get("1965")!.has("clothing-boutique")).toBe(true);
    expect(labelSets.get("1985")!.has("video-rental")).toBe(true);
    expect(labelSets.get("2005")!.has("phone-store")).toBe(true);
    expect(labelSets.get("2025")!.has("robotics-lab")).toBe(true);
    expect(labelSets.get("2025")!.has("vertical-farm-grocer")).toBe(true);
    for (const label of labelSets.get("2025")!) {
      expect(labelSets.get("1945")!.has(label), `${label} leaked into 1945`).toBe(false);
    }
    for (const label of labelSets.get("1985")!) {
      expect(labelSets.get("1945")!.has(label), `${label} leaked into 1945`).toBe(false);
    }
    // Brands are invented and unique.
    const brands = ERA_IDS.flatMap((era) => ERA_SHOP_PROGRAMMES[era].map((programme) => programme.brand));
    expect(new Set(brands).size).toBe(brands.length);
  });

  it("plans awnings, window displays, decals, entrance doors, transom signs and interior glow per frontage", () => {
    for (const era of ERA_IDS) {
      const config = ERAS.find((candidate) => candidate.id === era)!;
      const style = ERA_FACADE_STYLE[era];
      const plans = planFor(system, era);
      const tradeCount = Math.max(1, Math.round(config.storefronts.occupancy * BUILDING_LOTS.length));

      for (const plan of plans) {
        // Glazing, mullions and kick plate.
        expect(plan.glazing.width).toBeLessThan(plan.facade.width);
        expect(plan.glazing.height).toBeGreaterThan(1);
        expect(plan.glazing.mullionCount).toBeGreaterThanOrEqual(3);
        expect(plan.facade.kickPlateHeight).toBeGreaterThan(0);

        // Awning structure follows the era: fabric with scallops, or the era's rigid canopy.
        expect(plan.awning.kind).toBe(config.storefronts.awning ? "fabric-striped" : era === "1985" ? "marquee-blade" : "rigid-canopy");
        expect(plan.awning.valanceKind).toBe(plan.awning.kind === "fabric-striped" ? "scalloped" : plan.awning.kind === "marquee-blade" ? "tube-lit" : "flush-led");
        expect(plan.awning.depth).toBeGreaterThan(0.5);
        expect(plan.awning.drop).toBeGreaterThan(0.2);
        if (plan.awning.valanceKind === "scalloped") {
          expect(plan.awning.scallopCount).toBeGreaterThanOrEqual(4);
          expect(plan.awning.scallopRadius).toBeGreaterThan(0);
          expect(config.storefronts.awning).toBe(true);
        } else {
          expect(plan.awning.scallopCount).toBe(0);
          expect(config.storefronts.awning).toBe(false);
        }

        // Signage: transom + hanging sign always, blade only where the technique asks.
        expect(plan.signage.transom.lines.length).toBeGreaterThan(0);
        expect(plan.signage.transom.brand).toBe(plan.programme.brand);
        expect(plan.signage.letterCount).toBeGreaterThan(3);
        expect(plan.signage.hasBlade).toBe(plan.signage.blade !== null);
        expect(plan.signage.hasBlade).toBe(plan.signage.structure === "blade-marquee" || plan.signage.structure === "projected-scrim");
        expect(plan.signage.channelLetterCount > 0).toBe(plan.signage.structure === "channel-letters");

        // Entrance door, price board, decals, display goods and glow.
        expect(plan.door.width).toBeGreaterThan(0.8);
        expect(plan.door.height).toBeGreaterThan(1.8);
        expect(plan.priceBoard.recipe.lines.length).toBeGreaterThanOrEqual(2);
        expect(plan.decals.length).toBeGreaterThanOrEqual(3);
        expect(new Set(plan.decals.map((decal) => decal.kind)).size).toBe(plan.decals.length);
        expect(plan.displayGoods.length).toBeGreaterThanOrEqual(2);
        expect(plan.interior.fixtures.length).toBeGreaterThanOrEqual(2);
        expect(plan.interior.glowIntensity).toBe(config.storefronts.interiorGlow);
        expect(plan.interior.glowColor).toBe(config.palette.windowGlow);
        expect(plan.wear.level).toBe(style.wear);
        expect(plan.channels.glazingFraction).toBe(config.storefronts.glassArea);
        expect(plan.channels.signEmissive).toBeCloseTo(
          SIGN_STRUCTURE_GLOW[plan.signage.structure] * (0.55 + 0.45 * (1 - style.wear)),
          9,
        );

        // Signed and lit details stay on the frontage no matter the trading state.
        expect(plan.priceBoard.x).toBeLessThan(0);
        expect(plan.priceBoard.mountHeight).toBeGreaterThan(1);
      }

      // Occupancy decides how many frontages trade; the rest are boarded, never bare.
      const trading = plans.filter((plan) => plan.trading);
      expect(trading.length).toBe(tradeCount);
      for (const plan of plans) {
        expect(plan.detailCounts.boardPlanks).toBe(plan.trading ? 0 : 3);
        if (!plan.trading) {
          expect(plan.decals.length).toBeGreaterThanOrEqual(3);
          expect(plan.displayGoods.length).toBeGreaterThanOrEqual(2);
          expect(plan.signage.letterCount).toBeGreaterThan(3);
          expect(plan.awning.depth).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it("varies facade geometry, material age and shopfront height per era", () => {
    const heights = ERA_IDS.map((era) => ERA_FACADE_STYLE[era].facadeHeight);
    const wears = ERA_IDS.map((era) => ERA_FACADE_STYLE[era].wear);
    const depths = ERA_IDS.map((era) => ERA_FACADE_STYLE[era].awningDepth);
    expect(new Set(wears).size).toBe(ERA_IDS.length);
    expect(new Set(depths).size).toBe(ERA_IDS.length);
    // Storefronts get taller through the century, with a grungy 1985 material age.
    for (let index = 1; index < heights.length; index += 1) {
      expect(heights[index]!).toBeGreaterThan(heights[index - 1]!);
    }
    const wear = Object.fromEntries(ERA_IDS.map((era) => [era, ERA_FACADE_STYLE[era].wear])) as Record<EraId, number>;
    expect(wear["1945"]).toBeGreaterThan(wear["1965"]!);
    expect(wear["1985"]).toBeGreaterThan(wear["2005"]!);
    expect(wear["2005"]).toBeGreaterThan(wear["2025"]!);

    const lot = BUILDING_LOTS[0]!;
    const perEra = ERA_IDS.map((era) => planStorefronts(CITY_LAYOUT, ERAS.find((candidate) => candidate.id === era)!)
      .find((plan) => plan.lotId === lot.id)!);
    for (const [index, plan] of perEra.entries()) {
      const era = ERA_IDS[index]!;
      const config = ERAS.find((candidate) => candidate.id === era)!;
      expect(plan.channels.wear).toBe(ERA_FACADE_STYLE[era].wear);
      expect(plan.facade.height).toBe(ERA_FACADE_STYLE[era].facadeHeight);
      expect(plan.windowGlass.glow).toBe(config.storefronts.interiorGlow);
      // Material age drives worn-vs-new accents: chipped paint where the era is old.
      const expectedChips = Math.round(Math.max(0, ERA_FACADE_STYLE[era].wear - 0.25) * 18);
      expect(plan.wear.chips).toBe(expectedChips);
      if (era === "1945") {
        expect(plan.wear.label).toBe("soot-stained");
      }
      if (era === "2025") {
        expect(plan.wear.label).toBe("pristine");
        expect(plan.wear.chips).toBe(0);
        expect(plan.wear.gloss).toBeGreaterThan(0.8);
      }
    }
    expect(perEra[0]!.channels.facadeTint).not.toBe(perEra[4]!.channels.facadeTint);
  });

  it("plans deterministically from the real era and layout contracts", () => {
    for (const era of ERA_IDS) {
      const config = ERAS.find((candidate) => candidate.id === era)!;
      const first = planStorefronts(CITY_LAYOUT, config).map(planFingerprint);
      const second = planStorefronts(CITY_LAYOUT, config).map(planFingerprint);
      expect(first).toEqual(second);
      expect(first).toHaveLength(CITY_LAYOUT.lots.length);
      // Same lot, different era: the plan must change.
      const other = era === "1945" ? "2025" : "1945";
      const otherPlans = planStorefronts(CITY_LAYOUT, ERAS.find((candidate) => candidate.id === other)!);
      expect(first[0]).not.toBe(otherPlans.map(planFingerprint)[0]);
    }
  });

  it("generates canvas texture recipes per era: typography, awning stripes, price boards and decals", () => {
    const requiredSlots = ["transom-sign", "hanging-sign", "awning", "price-board", "window-glass", "window-poster", "wear"];
    for (const era of ERA_IDS) {
      const typography = ERA_TYPOGRAPHY[era];
      const config = ERAS.find((candidate) => candidate.id === era)!;
      const plans = planFor(system, era);
      for (const plan of plans) {
        const slots = plan.textures.map((texture) => texture.slot);
        for (const slot of requiredSlots) {
          expect(slots, `${plan.id} (${era}) is missing ${slot}`).toContain(slot);
        }
        expect(new Set(plan.textures.map((texture) => texture.recipeId)).size).toBe(plan.textures.length);
        for (const texture of plan.textures) {
          // Logical canvas size per slot, so textures stay shareable across lots.
          expect(texture.width).toBe(TEXTURE_SLOT_SIZES[texture.slot].width);
          expect(texture.height).toBe(TEXTURE_SLOT_SIZES[texture.slot].height);
          expect(texture.recipeId.startsWith(`${era}:`)).toBe(true);
        }

        // Era typography reaches the signage recipes.
        expect(plan.signage.transom.typographyId).toBe(typography.id);
        expect(plan.signage.transom.font).toContain(typography.family);
        expect(plan.signage.transom.font).toContain(String(typography.weight));
        const expectedTracking = typography.tracking * plan.signage.transom.fontSizePx;
        expect(Math.abs(plan.signage.transom.tracking - expectedTracking)).toBeLessThan(0.01);
        expect(plan.signage.transom.lines.join(" ")).toBe(
          typography.uppercase ? plan.programme.brand.toUpperCase() : plan.programme.brand,
        );
        expect(plan.signage.hanging.typographyId).toBe(typography.id);
        expect(plan.priceBoard.recipe.typographyId).toBe(typography.id);
        expect(plan.windowGlass.typographyId).toBe(typography.id);
        expect(plan.poster.typographyId).toBe(typography.id);
        for (const decal of plan.decals) {
          expect(decal.recipe.typographyId).toBe(typography.id);
          expect(decal.recipe.text.length).toBeGreaterThan(0);
          expect(decal.recipe.wear).toBe(ERA_FACADE_STYLE[era].wear);
        }

        // Awning stripes come from the era's own awning palette.
        const awning = plan.awning.recipe;
        expect(awning.era).toBe(era);
        expect(config.storefronts.awningColors).toContain(awning.baseHex);
        expect(config.storefronts.awningColors).toContain(awning.stripeHex);
        expect(awning.stripeCount).toBeGreaterThan(1);
        expect(awning.text.length).toBeGreaterThan(0);
        expect(awning.valanceKind).toBe(plan.awning.valanceKind);

        // Price boards carry the era's own price tier and price list.
        expect(plan.priceBoard.recipe.priceTier).toBe(config.storefronts.priceTier);
        expect(plan.priceBoard.recipe.lines).toEqual(
          plan.programme.priceBoard.lines.map(([label, price]) => ({ label, price })),
        );
        expect(plan.priceBoard.recipe.chalk).toBe(era === "1945" || era === "1965");

        // Painted signage fits its canvas.
        for (const recipe of [plan.signage.transom, plan.signage.hanging, ...(plan.signage.blade ? [plan.signage.blade] : [])]) {
          const longest = recipe.lines.reduce((best, line) => (line.length > best.length ? line : best), "");
          const estimated = longest.length * recipe.fontSizePx * 0.58 + Math.max(0, longest.length - 1) * recipe.tracking;
          expect(estimated).toBeLessThan(recipe.canvas.width * 1.02);
        }
      }
    }

    // Hand-painted period lettering tracks wide; the 2025 e-ink panel does not.
    expect(ERA_TYPOGRAPHY["1945"].tracking).toBeGreaterThan(0.1);
    expect(ERA_TYPOGRAPHY["2025"].tracking).toBe(0);
    expect(ERA_TYPOGRAPHY["1945"].finish).toBe("painted");
    expect(ERA_TYPOGRAPHY["1985"].finish).toBe("neon");
    expect(ERA_TYPOGRAPHY["2025"].finish).toBe("e-ink");
  });

  it("rasterizes signage glyph by glyph and glows per era", () => {
    // A representative frontage per era, preferring one whose sign technique is
    // characteristic of the period (hand-painted 1945, neon/backlit 1985).
    const preferred: Record<EraId, string> = {
      "1945": "diner",
      "1965": "record-shop",
      "1985": "arcade",
      "2005": "coffee-chain",
      "2025": "specialty-coffee",
    };
    const plansByEra = new Map<EraId, StorefrontPlan>();
    for (const era of ERA_IDS) {
      const plans = planFor(system, era);
      const candidate = plans.find((plan) => plan.programme.label === preferred[era]) ?? plans[0]!;
      plansByEra.set(era, candidate);
    }

    const calls: RecordedCall[] = [];
    const context = createRecordingContext(calls);
    const recipe = plansByEra.get("1945")!.signage.transom;
    const report = paintSignageRecipe(context, recipe);
    const expectedGlyphs = recipe.lines.join("").length + recipe.tagline.length;

    expect(report.recipeId).toBe(recipe.id);
    expect(report.glyphs).toBe(expectedGlyphs);
    expect(report.labels).toEqual(expect.arrayContaining([...recipe.lines, recipe.tagline]));
    expect(report.fonts).toContain(recipe.font);
    expect(report.shapes).toBeGreaterThan(0);
    expect(calls.filter((call) => call.method === "fillText")).toHaveLength(expectedGlyphs);
    expect(recipe.tracking).toBeGreaterThan(0);

    // Structure glow is era-driven: 1985 neon/backlit signs out-glow painted 1945 boards.
    const glowByEra = ERA_IDS.map((era) => plansByEra.get(era)!.signage.transom.glow);
    expect(glowByEra[2]!).toBeGreaterThan(glowByEra[0]!);
    expect(plansByEra.get("1985")!.signage.transom.structure).not.toBe(plansByEra.get("1945")!.signage.transom.structure);
    const structures: readonly SignStructure[] = [
      "painted-panel",
      "backlit-box",
      "channel-letters",
      "neon-tube-outline",
      "blade-marquee",
      "banner-flag",
      "vinyl-band",
      "e-ink-panel",
      "projected-scrim",
    ];
    for (const structure of structures) {
      expect(SIGN_STRUCTURE_GLOW[structure]).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Built scene: detail density, morphing, glow and lifecycle                   */
/* -------------------------------------------------------------------------- */

describe("era storefront system built scene", () => {
  it("builds exactly the facade detail its plans declare, read back off the three.js objects", () => {
    const system = createSystem();
    try {
      const requiredRoles = [
        "kick-plate",
        "transom-sign",
        "sign-lightbox",
        "hanging-sign",
        "awning-valance",
        "price-board",
        "push-plate",
        "threshold",
        "interior-glow",
        "window-backdrop",
        "wear-overlay",
      ];

      for (const era of ERA_IDS) {
        system.applyEra(era, 1);
        expect(system.stats.morphing).toBe(0);
        expect(system.stats.liveVariants).toBe(system.units.length);
        const fabric = ERAS.find((candidate) => candidate.id === era)!.storefronts.awning;

        for (const unit of system.units) {
          const plan = unit.plan;
          const stats = unit.stats;
          expect(plan.era).toBe(era);
          expect(stats).not.toBeNull();
          if (!stats) {
            continue;
          }

          // Every planned count is realized in the built variant.
          expect(stats.mullions).toBe(plan.detailCounts.mullions);
          expect(stats.scallops).toBe(plan.detailCounts.scallops);
          expect(stats.decals).toBe(plan.detailCounts.decals);
          expect(stats.displayGoods).toBe(plan.detailCounts.displayGoods);
          expect(stats.displayInstances).toBe(plan.detailCounts.displayInstances);
          expect(stats.fixtureInstances).toBe(plan.detailCounts.fixtureInstances);
          expect(stats.boardPlanks).toBe(plan.detailCounts.boardPlanks);
          expect(stats.channelLetters).toBe(plan.detailCounts.channelLetters);
          expect(stats.signMarks).toBe(plan.detailCounts.signMarks);
          expect(stats.textures).toBe(plan.textures.length);
          expect(stats.awningKind).toBe(plan.awning.kind);
          expect(stats.structure).toBe(plan.signage.structure);

          // High detail density on every frontage.
          expect(stats.meshes).toBeGreaterThanOrEqual(25);
          expect(stats.mullions).toBeGreaterThanOrEqual(3);
          expect(stats.decals).toBeGreaterThanOrEqual(3);
          expect(stats.displayGoods).toBeGreaterThanOrEqual(2);
          expect(stats.fixtureInstances).toBeGreaterThanOrEqual(1);
          expect(stats.geometries).toBeGreaterThanOrEqual(stats.meshes);
          expect(stats.materials).toBeGreaterThan(8);

          const roles = rolesOf(unit);
          for (const role of requiredRoles) {
            expect(roles, `${plan.id} is missing the ${role} feature`).toContain(role);
          }
          expect(roles.filter((role) => role.startsWith("decal:")).length).toBe(plan.decals.length);
          expect(roles.includes("canopy-light")).toBe(plan.awning.kind !== "fabric-striped");

          // Scalloped awnings only exist where the era allows a fabric awning.
          expect(stats.scallops > 0).toBe(fabric);

          // Textures are real canvas textures with painted evidence.
          expect(unit.textures.length).toBe(plan.textures.length);
          for (const record of unit.textures) {
            expect(record.rasterized).toBe(true);
            expect(record.texture).toBeInstanceOf(THREE.CanvasTexture);
            expect(record.texture.image).toBeInstanceOf(HTMLCanvasElement);
            expect(record.texture.colorSpace).toBe(THREE.SRGBColorSpace);
            expect((record.texture.image as HTMLCanvasElement).width).toBe(record.width);
            expect(record.texture.repeat.x).toBe(record.repeat[0]);
          }
          const transomRecord = unit.textures.find((record) => record.slot === "transom-sign");
          expect(transomRecord?.paint.glyphs).toBeGreaterThan(0);
          expect(transomRecord?.paint.fonts).toContain(plan.signage.transom.font);
          expect(transomRecord?.paint.labels.some((label) => label.length > 0)).toBe(true);
        }
      }
    } finally {
      system.dispose();
    }
  });

  it("cross-morphs shop identities, signage and displays continuously across 0..1", () => {
    const system = createSystem({ era: "1945" });
    try {
      const unit = system.units[0]!;
      const fromPlan = unit.planFor("1945");
      const toPlan = unit.planFor("2025");
      expect(fromPlan.programme.brand).not.toBe(toPlan.programme.brand);
      // The shop identity morphs signage and window goods too, not just the tint.
      expect(fromPlan.signage.structure).not.toBe(toPlan.signage.structure);
      expect(fromPlan.displayGoods.map((good) => good.form)).not.toEqual(toPlan.displayGoods.map((good) => good.form));
      expect(fromPlan.wear.level).not.toBe(toPlan.wear.level);

      const samples = [0, 0.2, 0.5, 0.75, 1];
      const depthScales: number[] = [];
      const dropScales: number[] = [];
      const glazingScales: number[] = [];

      for (const blend of samples) {
        system.applyEra("2025", blend);
        const morph = unit.morph;
        const channels = lerpMorphChannels(fromPlan.channels, toPlan.channels, blend);
        expect(morph.era).toBe("2025");
        expect(morph.blend).toBeCloseTo(blend, 9);
        expect(morph.channels).toMatchObject(channels);
        for (const key of Object.keys(channels) as (keyof typeof channels)[]) {
          expect(morph.channels[key]).toBeCloseTo(channels[key], 9);
        }

        const fade = blend < 1 ? blend : 1;
        expect(morph.wearOpacity).toBeCloseTo(STOREFRONT_WEAR_OVERLAY_OPACITY * channels.wear * fade, 9);
        expect(morph.awningDepthScale).toBeCloseTo(channels.awningDepth / toPlan.awning.depth, 9);
        expect(morph.awningDropScale).toBeCloseTo(channels.awningDrop / toPlan.awning.drop, 9);
        expect(morph.glazingScale).toBeCloseTo(channels.glazingFraction / toPlan.channels.glazingFraction, 9);
        depthScales.push(morph.awningDepthScale);
        dropScales.push(morph.awningDropScale);
        glazingScales.push(morph.glazingScale);

        if (blend < 1) {
          expect(morph.variants).toBe(2);
          expect(morph.fromEra).toBe("1945");
          expect(morph.fromWeight).toBeCloseTo(1 - blend, 9);
          expect(morph.toWeight).toBeCloseTo(blend, 9);
          expect(morph.fromBrand).toBe(fromPlan.programme.brand);
          expect(morph.brand).toBe(toPlan.programme.brand);
        } else {
          // The swap is finished: the outgoing shop identity is gone.
          expect(morph.variants).toBe(1);
          expect(morph.fromEra).toBeNull();
          expect(morph.toWeight).toBe(1);
        }
      }

      for (let index = 1; index < samples.length; index += 1) {
        expect(depthScales[index]!).toBeGreaterThanOrEqual(depthScales[index - 1]!);
        expect(glazingScales[index]!).toBeGreaterThanOrEqual(glazingScales[index - 1]!);
        expect(dropScales[index]!).toBeLessThanOrEqual(dropScales[index - 1]!);
      }
      expect(depthScales.every((value) => Number.isFinite(value))).toBe(true);
      // The morph moves the geometry and the tint, not just opacity.
      expect(depthScales[4]!).toBeGreaterThan(depthScales[0]!);
      expect(glazingScales[4]!).toBeGreaterThan(glazingScales[0]!);
      expect(dropScales[4]!).toBeLessThan(dropScales[0]!);

      // Idempotent for the same (era, blend): no extra variants, no new textures.
      const createdBefore = system.stats.textures.created;
      system.applyEra("2025", 1);
      expect(system.stats.textures.created).toBe(createdBefore);
      expect(unit.variantCount).toBe(1);

      // Out-of-range input is clamped, exactly as the EraAware contract requires.
      system.applyEra("2025", 7);
      expect(system.blend).toBe(1);
      system.applyEra("2025", -3);
      expect(system.blend).toBe(0);
      system.applyEra("2025", Number.NaN);
      expect(system.blend).toBe(0);

      // Dragging the timeline backwards swaps roles instead of rebuilding blind.
      system.applyEra("2025", 1);
      system.applyEra("1945", 0.4);
      const reversed = unit.morph;
      expect(reversed.era).toBe("1945");
      expect(reversed.fromEra).toBe("2025");
      expect(reversed.fromWeight).toBeCloseTo(0.6, 9);
      expect(reversed.toWeight).toBeCloseTo(0.4, 9);
      expect(reversed.brand).toBe(fromPlan.programme.brand);
      expect(reversed.fromBrand).toBe(toPlan.programme.brand);
    } finally {
      system.dispose();
    }
  });

  it("drives interior glow from the shared era weights on update()", () => {
    const system = createSystem();
    try {
      const mid = updateContext("1985", "1945", 0.4);
      system.update(mid);
      expect(system.era).toBe("1985");
      expect(system.blend).toBeCloseTo(0.4, 9);
      expect(system.stats.morphing).toBe(system.units.length);

      const midGlow = weightedInteriorGlow(mid.weights);
      expect(midGlow).toBeCloseTo(0.6 * 0.25 + 0.4 * 0.68, 9);
      for (const unit of system.units) {
        expect(unit.morph.blend).toBeCloseTo(0.4, 9);
        expect(unit.morph.fromEra).toBe("1945");
        expectGlow(unit, midGlow);
      }

      const settled = updateContext("1985", "1985", 1, 12);
      system.update(settled);
      expect(system.stats.morphing).toBe(0);
      const settledGlow = weightedInteriorGlow(settled.weights);
      expect(settledGlow).toBeCloseTo(0.68, 9);
      expect(settledGlow).toBeGreaterThan(midGlow);
      for (const unit of system.units) {
        expectGlow(unit, settledGlow);
      }

      // Glow rises as the timeline moves towards the better-lit era.
      const steps = [0, 0.25, 0.5, 0.75, 1].map((blend) => weightedInteriorGlow(resolveEraWeights("1945", "1985", blend)));
      for (let index = 1; index < steps.length; index += 1) {
        expect(steps[index]!).toBeGreaterThan(steps[index - 1]!);
      }
    } finally {
      system.dispose();
    }
  });

  it("shares programme textures, releases them on swap and disposes everything on teardown", () => {
    const system = createSystem();
    try {
      const units = system.units.length;
      const perPlan = system.units[0]!.plan.textures.length;
      const first = system.stats.textures;
      // Twenty frontages share nine shop programmes, so textures are reused.
      expect(perPlan).toBeGreaterThan(7);
      expect(first.created).toBeLessThan(units * perPlan);
      expect(first.reused).toBeGreaterThan(0);
      expect(first.created).toBe(first.disposed + first.live);

      for (const era of ERA_IDS) {
        system.applyEra(era, 1);
        const stats = system.stats.textures;
        expect(stats.created).toBe(stats.disposed + stats.live);
        expect(system.stats.resources.createdGeometries).toBeGreaterThan(0);
      }

      const afterWalk = system.stats;
      expect(afterWalk.textures.disposed).toBeGreaterThan(0);
      expect(afterWalk.textures.live).toBeGreaterThan(0);
      expect(afterWalk.textures.created).toBe(afterWalk.textures.disposed + afterWalk.textures.live);
      expect(afterWalk.liveVariants).toBe(units);
      // Only the current era's geometry survives the walk.
      expect(afterWalk.resources.disposedGeometries).toBeGreaterThan(0);

      const createdGeometries = afterWalk.resources.createdGeometries;
      const createdMaterials = afterWalk.resources.createdMaterials;
      system.dispose();

      const final = system.stats;
      expect(system.group.children).toHaveLength(0);
      expect(final.textures.live).toBe(0);
      expect(final.textures.created).toBe(final.textures.disposed);
      expect(final.liveVariants).toBe(0);
      expect(final.resources.disposedGeometries).toBe(createdGeometries);
      expect(final.resources.disposedMaterials).toBe(createdMaterials);

      // A disposed system ignores further timeline traffic.
      system.applyEra("2025", 1);
      system.update(updateContext("2025", "1945", 0.5));
      expect(system.group.children).toHaveLength(0);
      expect(system.units.every((unit) => unit.variantCount === 0)).toBe(true);
    } finally {
      system.dispose();
    }
  });

  it("exposes the SceneSystem surface with pickables attributed to lots and brands", () => {
    const system = createSystem({ era: "1985" });
    try {
      expect(system.id).toBe(STOREFRONT_SYSTEM_ID);
      expect(system.group).toBeInstanceOf(THREE.Group);
      expect(system.group.name).toBe(STOREFRONT_SYSTEM_ID);
      expect(typeof system.update).toBe("function");
      expect(typeof system.applyEra).toBe("function");

      const pickables = system.getPickables();
      expect(pickables.length).toBeGreaterThanOrEqual(system.units.length);
      expect(new Set(pickables.map((object) => object.uuid)).size).toBe(pickables.length);
      for (const pickable of pickables) {
        expect(typeof pickable.userData.lotId).toBe("string");
        expect(typeof pickable.userData.brand).toBe("string");
        expect(pickable.userData.era).toBe("1985");
      }

      // The unit root carries the live shop identity for the picking layer.
      const unit = system.units[0]!;
      const pickable = pickables.find((object) => object.userData.lotId === unit.lot.id);
      expect(pickable).toBeDefined();
      expect(pickable?.userData.programme ?? unit.plan.programme.label).toBeTruthy();
      expect(unit.group.userData.brand).toBe(unit.plan.programme.brand);
      expect(unit.group.userData.trading).toBe(unit.plan.trading);
    } finally {
      system.dispose();
    }
  });
});
