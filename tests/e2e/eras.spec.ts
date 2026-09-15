// @vitest-environment node
/**
 * Era snapshot suite — the five-year inventory proof, booted headlessly.
 *
 * Every assertion here runs against the **assembled** application: the real
 * composition root builds the ten registered domain modules, the real kernel
 * runs without a GPU, and era changes go through the composition's own selection
 * path (the same path the timeline slider calls). Nothing is asserted against a
 * static data table: the suite reads the live per-era spec each module has
 * applied to the scene graph, counts the nodes the era's music domain published,
 * and walks the composed scene for era-exclusive names.
 *
 * Coverage maps to the acceptance criteria one for one:
 *
 *  - a smoke pass over all five years with no renderer, canvas or audio device,
 *  - the era inventory of every requested detail domain (furniture, machines,
 *    menu board, music, posters, tableware, signage/lighting, counter, patrons,
 *    environment),
 *  - era-exclusive tiers: no jukebox, boombox, iPod or contactless reader in
 *    1945; a lever espresso tier in 1965; a boombox and electronic register in
 *    1985; an iPod dock and POS terminal in 2005; a phone-paired speaker, tablet
 *    POS and contactless reader in 2025,
 *  - exactly one era-correct music playback device per year,
 *  - per-era menu content with prices that differ in era-appropriate order and a
 *    board surface that steps through chalk, paint, letter-board, backlit panel
 *    and digital screen,
 *  - patron gadgets that are historically legible for their era,
 *  - a full 1945 -> 2025 -> 1945 cycle that leaves no era object behind.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  ERA_EXPECTATIONS,
  ERA_YEARS,
  allNodeNames,
  createHarness,
  liveSpec,
  liveSpecs,
  menuPricing,
  musicDeviceNodes,
  nodeNamesMatching,
  sceneCounts,
  type CafeHarness,
  type MenuPricing,
  type SceneCounts,
} from './harness';
import type { YearId } from '../../src/contracts/period';
import { GADGETS } from '../../src/domains/patrons/figures/GadgetProps';

const open: CafeHarness[] = [];

afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): CafeHarness {
  const created = createHarness(options);
  open.push(created);
  return created;
}

/** The device tier name of an era's music domain, for the exclusivity matrix. */
function musicTier(year: YearId): string {
  return ERA_EXPECTATIONS[year].musicKind;
}

describe('era snapshots (assembled café, headless)', () => {
  it('boots the assembled café headlessly and reaches all five years with no GPU or audio device', async () => {
    const cafe = harness({ reducedMotion: true });
    const { composition } = cafe;

    expect(composition.kernel.headless).toBe(true);
    expect(composition.kernel.renderer).toBeNull();
    expect(composition.kernel.canvas).toBeNull();
    expect(composition.modules).toHaveLength(10);
    expect(composition.sceneModules).toHaveLength(10);
    expect(composition.audio.state).toBe('locked');
    expect(composition.navigation.attached).toBe(true);
    expect(composition.hotspots.size).toBeGreaterThanOrEqual(6);

    for (const year of ERA_YEARS) {
      const report = await cafe.switchTo(year);
      expect(report.year).toBe(year);
      expect(composition.year).toBe(year);
      expect(composition.transition.settledYear).toBe(year);
      expect(composition.transition.caption?.year).toBe(year);
      expect(composition.audio.getMixState().year).toBe(year);
      expect(composition.registry[year].year).toBe(year);

      for (const module of composition.sceneModules) {
        expect(module.root, `${module.id} has no scene root`).toBeDefined();
        expect(module.spec?.year, `${module.id} did not apply ${year}`).toBe(year);
      }
      expect(
        composition.transition.modules.every((state) => state.reportedYear === year),
        `a module still reports another era after switching to ${year}`,
      ).toBe(true);

      // A smoke assertion on the scene graph itself, not just on the specs.
      expect(sceneCounts(composition.kernel.world).drawCalls).toBeGreaterThan(50);
    }
  }, 120_000);

  for (const year of ERA_YEARS) {
    it(`reports the ${year} inventory for all ten period detail domains`, async () => {
      const cafe = harness({ reducedMotion: true });
      await cafe.switchTo(year);
      const expected = ERA_EXPECTATIONS[year];
      const specs = liveSpecs(cafe.composition);

      /* furniture and decor */
      expect(specs.furniture.year).toBe(year);
      expect(specs.furniture.materialSetId).toBe(expected.furnitureMaterialSet);
      expect(specs.furniture.seating.chair.kind).toBe(expected.furnitureChairKind);
      expect(specs.furniture.tables.topThickness).toBeGreaterThan(0);

      /* coffee machines and brewing equipment */
      expect(specs.machines.year).toBe(year);
      expect(specs.machines.machine.archetype).toBe(expected.machineArchetype);
      expect(specs.machines.machine.model.length).toBeGreaterThan(0);
      expect(specs.machines.accessories.length).toBeGreaterThan(0);

      /* menu board content */
      expect(specs.menuboard.year).toBe(year);
      expect(specs.menuboard.boardKind).toBe(expected.menuBoardKind);
      expect(specs.menuboard.boardName).toBe(expected.menuBoardName);
      expect(specs.menuboard.currency).toBe(expected.menuCurrency);
      expect(specs.menuboard.items.length).toBeGreaterThanOrEqual(12);
      expect(specs.menuboard.items.map((item) => item.id)).toContain(
        specs.menuboard.benchmarkItemId,
      );

      /* music and its playback device */
      expect(specs.music.year).toBe(year);
      expect(specs.music.kind).toBe(expected.musicKind);
      expect(specs.music.deviceId).toBe(expected.musicDeviceId);
      expect(specs.music.programId).toBe(expected.musicProgramId);

      /* posters and advertising */
      expect(specs.posters.year).toBe(year);
      expect(specs.posters.mounting.primary).toBe(expected.posterMount);
      expect(specs.posters.paletteName).toBe(expected.posterPalette);
      expect(specs.posters.posters.length).toBeGreaterThanOrEqual(4);

      /* tableware and service ware */
      expect(specs.tableware.year).toBe(year);
      expect(specs.tableware.materialSetId).toBe(expected.tablewareMaterialSet);
      expect(specs.tableware.vessels.cup.kind).toBe(expected.tablewareCupKind);
      expect(specs.tableware.tableService.cutlery.length).toBeGreaterThan(0);

      /* signage and lighting */
      expect(specs['signage-lighting'].year).toBe(year);
      expect(specs['signage-lighting'].fixtures[0]?.kind).toBe(expected.signageFixtureKind);
      expect(specs['signage-lighting'].signs.length).toBeGreaterThan(0);
      expect(specs['signage-lighting'].colorTemperatureK).toBeGreaterThanOrEqual(2000);

      /* counter technology */
      expect(specs.counter.year).toBe(year);
      expect(specs.counter.deviceFamily).toBe(expected.counterFamily);
      expect(specs.counter.payment.kind).toBe(expected.counterPaymentKind);
      expect(specs.counter.payment.mode).toBe(expected.counterPaymentMode);

      /* patron outfits, hairstyles and gadgets */
      expect(specs.patrons.year).toBe(year);
      expect(specs.patrons.density).toBeCloseTo(expected.patronDensity, 5);
      expect(specs.patrons.figures.length).toBeGreaterThanOrEqual(4);
      expect(specs.patrons.figures[0]?.hair).toBe(expected.baristaHair);

      /* the room shell the other domains are arranged inside */
      expect(specs.environment.year).toBe(year);
      expect(specs.environment.signage.lettering).toBe(expected.environmentBlade);

      /* and the scene graph agrees with the specs it was built from */
      const names = allNodeNames(cafe.composition.kernel.world);
      for (const pattern of expected.nodesPresent) {
        expect(
          names.some((name) => pattern.test(name)),
          `${year} is missing a node matching ${pattern}`,
        ).toBe(true);
      }
      for (const pattern of expected.nodesAbsent) {
        expect(
          names.filter((name) => pattern.test(name)),
          `${year} leaked a node matching ${pattern}`,
        ).toEqual([]);
      }
    }, 60_000);
  }

  it('keeps each era-exclusive tier out of every other era', async () => {
    const cafe = harness({ reducedMotion: true });

    /* The five music tiers are era-exact and pairwise distinct. */
    const tiers: string[] = [];
    const collect = async (year: YearId) => {
      await cafe.switchTo(year);
      const specs = liveSpecs(cafe.composition);
      tiers.push(specs.music.kind);
      return specs;
    };

    const y1945 = await collect('1945');
    expect(['jukebox', 'boombox', 'ipod-dock', 'smart-speaker']).not.toContain(y1945.music.kind);
    expect(y1945.counter.deviceFamily).toBe('manual-till');
    expect(y1945.counter.payment.kind).not.toBe('contactless-reader');
    expect(nodeNamesMatching(cafe.composition.kernel.world, /jukebox|boombox|ipod|contactless/i)).toEqual(
      [],
    );

    const y1965 = await collect('1965');
    expect(y1965.machines.machine.archetype).toBe('lever-espresso');
    expect(y1965.music.kind).toBe('jukebox');

    const y1985 = await collect('1985');
    expect(y1985.music.kind).toBe('boombox');
    expect(y1985.counter.deviceFamily).toBe('electronic-register');
    expect(y1985.counter.animation.displayKind).toBe('led');

    const y2005 = await collect('2005');
    expect(y2005.music.kind).toBe('ipod-dock');
    expect(y2005.counter.deviceFamily).toBe('pos-terminal');
    expect(y2005.counter.payment.kind).toBe('card-terminal');

    const y2025 = await collect('2025');
    expect(y2025.music.kind).toBe('smart-speaker');
    expect(y2025.music.accessories.map((accessory) => accessory.kind)).toContain('phone-stand');
    expect(y2025.counter.deviceFamily).toBe('tablet-contactless');
    expect(y2025.counter.payment.kind).toBe('contactless-reader');
    expect(y2025.counter.payment.mode).toBe('contactless-first');
    expect(
      nodeNamesMatching(cafe.composition.kernel.world, /contactless/i).length,
      'the 2025 counter build publishes a contactless reader node',
    ).toBeGreaterThan(0);

    expect(new Set(tiers).size).toBe(ERA_YEARS.length);

    /* No earlier era may borrow a later tier, and none may keep the old one. */
    for (const year of ERA_YEARS) {
      const later = ERA_YEARS.slice(ERA_YEARS.indexOf(year) + 1).map(musicTier);
      await cafe.switchTo(year);
      const names = allNodeNames(cafe.composition.kernel.world);
      for (const tier of later) {
        expect(names.some((name) => name.includes(tier)), `${year} contains the ${tier} tier`).toBe(
          false,
        );
      }
      if (year !== '1945') {
        expect(names.some((name) => name.includes('wireless-1945'))).toBe(false);
      }
      if (year !== '2025') {
        expect(names.some((name) => /contactless/i.test(name))).toBe(false);
      }
    }
  }, 120_000);

  it('shows exactly one era-correct music playback device in every era', async () => {
    const cafe = harness({ reducedMotion: true });
    const seen = new Set<string>();

    for (const year of ERA_YEARS) {
      await cafe.switchTo(year);
      const nodes = musicDeviceNodes(cafe.composition);
      expect(nodes, `${year} should show exactly one music device`).toHaveLength(1);
      expect(nodes[0]).toBe(`music:${year}:${ERA_EXPECTATIONS[year].musicDeviceId}`);
      seen.add(nodes[0] ?? '');

      /* The engine plays exactly one programme for that one device. */
      const mix = cafe.composition.audio.getMixState();
      expect(mix.year).toBe(year);
      expect(mix.programId).toBe(ERA_EXPECTATIONS[year].musicProgramId);
      expect(mix.musicLevel).toBeGreaterThan(0);
    }

    expect(seen.size).toBe(ERA_YEARS.length);
  }, 120_000);

  it('steps the menu surface through all five board forms with prices that differ in era order', async () => {
    const cafe = harness({ reducedMotion: true });
    const rows: MenuPricing[] = [];

    for (const year of ERA_YEARS) {
      await cafe.switchTo(year);
      const spec = liveSpec(cafe.composition, 'menuboard');
      expect(spec.year).toBe(year);
      expect(spec.surface.face).toMatch(/^#[0-9a-f]{6}$/i);
      rows.push(menuPricing(spec));
    }

    /* The era menu surface: chalk board -> painted board -> letter-board ->
     * backlit panel -> digital screen. */
    expect(rows.map((row) => row.boardKind)).toEqual([
      'chalk-slate',
      'painted-vinyl',
      'fluorescent-letterboard',
      'backlit-acrylic',
      'digital-screen',
    ]);

    /* Currency follows the century: pre-decimal sterling, then decimal. */
    expect(rows.slice(0, 2).map((row) => row.currency)).toEqual([
      'gbp-predecimal',
      'gbp-predecimal',
    ]);
    expect(rows.slice(2).map((row) => row.currency)).toEqual([
      'gbp-decimal',
      'gbp-decimal',
      'gbp-decimal',
    ]);

    /* Pricing differs in every era and rises with the century. */
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      if (previous === undefined || current === undefined) throw new Error('missing era row');
      expect(current.meanPence, `${current.year} mean price vs ${previous.year}`).toBeGreaterThan(
        previous.meanPence,
      );
      expect(
        current.medianPence,
        `${current.year} median price vs ${previous.year}`,
      ).toBeGreaterThan(previous.medianPence);
      expect(current.minPence, `${current.year} cheapest item`).toBeGreaterThan(previous.minPence);
      expect(current.maxPence, `${current.year} dearest item`).toBeGreaterThan(previous.maxPence);
      expect(current.display.join('|')).not.toBe(previous.display.join('|'));
    }

    /* Every menu is a real, distinct board with a full set of prices. */
    expect(new Set(rows.map((row) => row.display.join('|'))).size).toBe(ERA_YEARS.length);
    for (const row of rows) {
      expect(row.itemCount).toBeGreaterThanOrEqual(12);
      expect(row.minPence).toBeGreaterThan(0);
    }
    expect(rows.map((row) => row.itemCount)).not.toEqual([
      rows[0]?.itemCount,
      rows[0]?.itemCount,
      rows[0]?.itemCount,
      rows[0]?.itemCount,
      rows[0]?.itemCount,
    ]);
  }, 120_000);

  it('keeps patron outfits, hairstyles and gadgets historically legible for their year', async () => {
    const cafe = harness({ reducedMotion: true });

    for (const year of ERA_YEARS) {
      await cafe.switchTo(year);
      const spec = liveSpec(cafe.composition, 'patrons');
      const expected = ERA_EXPECTATIONS[year];
      const carried = new Set(spec.figures.flatMap((figure) => [...figure.gadgets]));

      for (const gadget of expected.gadgets) {
        expect(carried.has(gadget as never), `${year} patrons should carry a ${gadget}`).toBe(true);
      }
      for (const gadget of expected.forbiddenGadgets) {
        expect(carried.has(gadget as never), `${year} patrons must not carry a ${gadget}`).toBe(false);
      }
      for (const gadget of carried) {
        const definition = GADGETS[gadget];
        expect(definition, `${gadget} is not a known gadget`).toBeDefined();
        expect(
          definition.introduced,
          `${gadget} was introduced in ${definition.introduced} but appears in ${year}`,
        ).toBeLessThanOrEqual(Number(year));
      }
      for (const figure of spec.figures) {
        expect(['menswear', 'womenswear', 'unisex']).toContain(figure.presentation);
        expect(figure.garments.length).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  it('returns to the 1945 scene after a full five-year cycle with no leftover era objects', async () => {
    const cafe = harness({ reducedMotion: true });
    const { composition } = cafe;

    await cafe.switchTo('1945');
    const baseline: SceneCounts = sceneCounts(composition.kernel.world);
    const baselineNames = allNodeNames(composition.kernel.world);

    const perEra: { year: YearId; counts: SceneCounts; names: readonly string[] }[] = [];
    for (const year of ERA_YEARS) {
      const report = await cafe.switchTo(year);
      expect(report.year).toBe(year);
      const counts = sceneCounts(composition.kernel.world);
      const names = allNodeNames(composition.kernel.world);
      perEra.push({ year, counts, names });

      /* Exactly the era's own music device, never a stray one from another year. */
      expect(musicDeviceNodes(composition)).toEqual([
        `music:${year}:${ERA_EXPECTATIONS[year].musicDeviceId}`,
      ]);

      const stale = names.filter(
        (name) =>
          /^music:/.test(name) &&
          name !== `music:${year}:${ERA_EXPECTATIONS[year].musicDeviceId}`,
      );
      expect(stale, `${year} kept a stale music device node`).toEqual([]);
      expect(
        composition.transition.modules.every((state) => state.reportedYear === year),
        `a module reports another era in ${year}`,
      ).toBe(true);
    }

    /* Every era really is a different scene. */
    for (let index = 1; index < perEra.length; index += 1) {
      const previous = perEra[index - 1];
      const current = perEra[index];
      if (previous === undefined || current === undefined) throw new Error('missing era row');
      expect(current.names.join('|')).not.toBe(previous.names.join('|'));
      expect(current.counts.drawCalls).toBeGreaterThan(50);
    }

    /* And a second visit to 1945 is the same scene as the first: no orphans.
     * Names are compared as a sorted set because an in-place era rebuild is free
     * to re-append its children in a different order; the geometry, materials and
     * counts below are compared exactly. */
    await cafe.switchTo('1945');
    const returned = sceneCounts(composition.kernel.world);
    const returnedNames = allNodeNames(composition.kernel.world);
    expect(returned).toEqual(baseline);
    expect(returnedNames.slice().sort()).toEqual(baselineNames.slice().sort());
    expect(composition.transition.modules.every((state) => state.reportedYear === '1945')).toBe(true);
    expect(composition.audio.getMixState().programId).toBe(ERA_EXPECTATIONS['1945'].musicProgramId);
  }, 120_000);
});
