/**
 * Menu board unit suite (headless, node).
 *
 * Proves the five eras of the café's menu board, the way the timeline drives
 * them:
 *
 *  - every year 1945 / 1965 / 1985 / 2005 / 2025 has its own line items with
 *    drinks and food priced in the period's own currency, and the benchmark
 *    item gets dearer every decade (pre-decimal `6d`, `1/3` through to `£3.60`),
 *  - each year builds a materially different board (hand-chalked slate, painted
 *    panel with applied vinyl, fluorescent letter board with a promo strip,
 *    backlit acrylic panels, emissive digital screen with rotating panels),
 *  - the procedural lettering layout is pure and deterministic and emits the
 *    era's own technique: chalk strokes and smudges, vinyl letters, fluorescent
 *    tiles, backlit panel sections, rotating digital panels, plus each era's
 *    wear and the 1945 substitute-price annotation,
 *  - the painter turns those runs into real pixels (a colour map and an
 *    emissive map) without fetching a font, an image or the network,
 *  - the module implements the frozen SceneModule lifecycle headlessly: built
 *    and disposed five times, it retains no geometry, material or texture.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { YEAR_IDS, type PeriodDefinition, type RoomBounds, type YearId } from '../../../contracts/period';
import { createKernel, type Kernel } from '../../../core/kernel';
import { CAFE_ROOM_BOUNDS, STRUCTURAL_LAYOUT } from '../../environment/EnvironmentModule';
import {
  BOARD_FORMS,
  boardForm,
  boardFormForSpec,
  boardGeometrySignature,
  boardMembers,
  boardPanelRegions,
  boardPlacement,
  boardPlacementProblems,
  boardWallFrame,
  clampFormToCapacity,
  menuMountOf,
  resolveBoardAnchor,
} from '../boardGeometry';
import { MENU_BOARD_SPECS, describeMenuBoardSpec, menuBoardInventory, menuBoardSpec, menuBoardSpecConflicts, menuBoardSpecProblems } from '../data/index';
import {
  boardLayoutReport,
  createMenuBoardTexture,
  layoutMenuBoard,
  layoutRunBounds,
  MENU_BOARD_TEXTURE_HEIGHT,
  measureBoardText,
  normaliseBoardText,
  paintBoardFace,
  runBounds,
  type BoardLayout,
} from '../lettering';
import { currencySpec, isPeriodPrice, runsOfKind } from '../types';
import { BOARD_TEXT_ALPHABET, glyphStrokes } from '../lettering';
import { MENU_BOARD_INVENTORY, menuBoardEmphasis, menuBoardSpecsHealthy } from '../data/index';
import {
  MENU_BOARD_MODULE_ID,
  MENU_BOARD_SPECS as MODULE_SPECS,
  createMenuBoardModule,
  type MenuBoardModule,
} from '../MenuBoardModule';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

/** Minimal era definition: the board only reads `year`, `period` and the room. */
function periodFor(year: YearId): PeriodDefinition {
  const spec = menuBoardSpec(year);
  return {
    year,
    label: spec.label,
    name: spec.name,
    summary: spec.summary,
    palette: {
      background: '#141410',
      floor: '#3a2f26',
      wall: '#d8d0c0',
      ceiling: '#efeae0',
      accent: spec.surface.faceAccent,
      lamp: spec.surface.glow,
    },
    lighting: {
      ambientColor: '#ffffff',
      ambientIntensity: 0.45,
      keyColor: '#ffd9a0',
      keyIntensity: 1.3,
      fillColor: '#cfe0ff',
      fillIntensity: 0.32,
      lampColor: spec.surface.glow,
      lampIntensity: 14,
      fogDensity: 0,
    },
    details: spec.tags,
  };
}

interface Scene {
  kernel: Kernel;
  board: MenuBoardModule;
}

function createScene(options: { bounds?: RoomBounds; seed?: number; textureHeight?: number } = {}): Scene {
  const bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
  const kernel = createKernel(null, {
    forceHeadless: true,
    bounds,
    autoResize: false,
    seed: options.seed ?? 0x1945,
  });
  openKernels.push(kernel);
  const board = createMenuBoardModule({
    bounds,
    layout: STRUCTURAL_LAYOUT,
    // Small maps keep the lifecycle suites quick; the painting suite uses the
    // full default resolution.
    textureHeight: options.textureHeight ?? 128,
  });
  return { kernel, board };
}

function applyYear(scene: Scene, year: YearId): void {
  scene.kernel.setYear(year);
  const period = periodFor(year);
  const context = scene.kernel.createBuildContext(period);
  scene.board.applyPeriod(period, context);
  scene.board.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
}

function layoutFor(year: YearId): BoardLayout {
  const spec = menuBoardSpec(year);
  return layoutMenuBoard(spec, boardFormForSpec(spec));
}

/** Item ids that make each era's menu unmistakably its own. */
const ERA_ITEMS: Readonly<Record<YearId, readonly string[]>> = {
  '1945': ['tea', 'coffee', 'cocoa', 'lemonade', 'meat-pie', 'jam-tart'],
  '1965': ['instant-coffee', 'coca-cola', 'ham-roll', 'knickerbocker'],
  '1985': ['cappuccino', 'bacon-bap', 'jacket-potato', 'doughnut'],
  '2005': ['latte', 'panini', 'smoothie', 'muffin'],
  '2025': ['matcha-latte', 'cold-brew', 'kimchi-toastie', 'pistachio-croissant'],
};

const PREDECIMAL = /^(?:\d+d|\d+\/\d+|\d+\/-)$/;
const DECIMAL = /^(?:\d+p|£\d+\.\d{2})$/;

/* -------------------------------------------------------------------------- */
/* Menu data and period money                                                */
/* -------------------------------------------------------------------------- */

describe('menu data and period money', () => {
  it('gives every year its own priced menu with drinks and food', () => {
    for (const year of YEAR_IDS) {
      const spec = MENU_BOARD_SPECS[year];
      expect(spec.year).toBe(year);
      expect(spec.items.length).toBeGreaterThan(8);
      expect(spec.sections.length).toBeGreaterThanOrEqual(4);
      expect(new Set(spec.items.map((item) => item.id)).size).toBe(spec.items.length);
      expect(spec.boardNote.length).toBeGreaterThan(10);

      // Drinks and food, in the sections that name them.
      const sections = new Set(spec.items.map((item) => item.section));
      expect(sections.has('hot-drinks')).toBe(true);
      expect(sections.has('cold-drinks')).toBe(true);
      expect(sections.has('savoury')).toBe(true);
      expect(sections.has('sweet')).toBe(true);

      // Prices are written the way the era wrote money.
      const pattern = spec.currency === 'gbp-predecimal' ? PREDECIMAL : DECIMAL;
      for (const item of spec.items) {
        expect(item.price.display).toMatch(pattern);
        expect(item.price.currency).toBe(spec.currency);
        expect(item.price.pence).toBeGreaterThan(0);
        expect(Number.isFinite(item.price.pence)).toBe(true);
      }

      for (const itemId of ERA_ITEMS[year]) {
        expect(spec.items.some((item) => item.id === itemId)).toBe(true);
      }
      expect(menuBoardSpecProblems(spec)).toEqual([]);
    }

    // No two eras list the same menu, and the spec self-checks agree.
    expect(menuBoardSpecConflicts()).toEqual([]);
    for (const a of YEAR_IDS) {
      for (const b of YEAR_IDS) {
        if (a >= b) continue;
        const left = MENU_BOARD_SPECS[a].items.map((item) => item.id).sort().join(',');
        const right = MENU_BOARD_SPECS[b].items.map((item) => item.id).sort().join(',');
        expect(left).not.toBe(right);
      }
    }
  });

  it('prices the benchmark item higher every decade and keeps 1945 substitutes cheaper', () => {
    const prices = YEAR_IDS.map((year) => {
      const spec = MENU_BOARD_SPECS[year];
      const benchmark = spec.items.find((item) => item.id === spec.benchmarkItemId);
      expect(benchmark).toBeDefined();
      return benchmark?.price.pence ?? 0;
    });
    for (let index = 1; index < prices.length; index += 1) {
      expect(prices[index] ?? 0).toBeGreaterThan(prices[index - 1] ?? 0);
    }
    // 2d in 1945, 6d in 1965, then decimal: 45p, £1.85, £3.60.
    expect(prices[0]).toBe(2);
    expect(prices[1]).toBe(6);
    expect(prices[2]).toBe(45);
    expect(prices[3]).toBe(185);
    expect(prices[4]).toBe(360);

    const wartime = MENU_BOARD_SPECS['1945'];
    const substituted = wartime.items.filter((item) => item.substitute !== undefined);
    expect(substituted.length).toBeGreaterThan(0);
    for (const item of substituted) {
      expect(item.substitute?.price.pence).toBeLessThan(item.price.pence);
      expect(item.substitute?.price.display).toMatch(PREDECIMAL);
      expect(item.substitute?.note.length).toBeGreaterThan(5);
    }
    for (const year of YEAR_IDS) {
      if (year === '1945') continue;
      expect(MENU_BOARD_SPECS[year].items.some((item) => item.substitute !== undefined)).toBe(false);
    }

    const inventory = menuBoardInventory('1945');
    expect(inventory).toHaveLength(wartime.items.length);
    expect(inventory.some((row) => row.substitute !== null && (row.substitutePence ?? 0) > 0)).toBe(true);

    // The flat inventory covers every era, and the whole spec map is healthy.
    expect(MENU_BOARD_INVENTORY).toHaveLength(
      YEAR_IDS.reduce((total, year) => total + MENU_BOARD_SPECS[year].items.length, 0),
    );
    expect(new Set(MENU_BOARD_INVENTORY.map((row) => row.year))).toEqual(new Set(YEAR_IDS));
    expect(menuBoardSpecsHealthy()).toBe(true);
    expect(menuBoardEmphasis(MENU_BOARD_SPECS['1985'], 'food')).toBe('standard');
  });

  it('names each era’s signature item and keeps the columns readable', () => {
    for (const year of YEAR_IDS) {
      const spec = MENU_BOARD_SPECS[year];
      const layout = layoutFor(year);
      // Prices are never the smallest thing on the board: they are the point.
      for (const column of layout.columns) {
        const prices = column.lines.filter((line) => line.kind === 'price');
        const names = column.lines.filter((line) => line.kind === 'item');
        if (prices.length === 0 || names.length === 0) continue;
        const smallestPrice = Math.min(...prices.map((line) => line.size));
        const largestName = Math.max(...names.map((line) => line.size));
        expect(smallestPrice).toBeGreaterThan(largestName * 0.5);
      }
      expect(spec.benchmarkItemId.length).toBeGreaterThan(0);
    }
  });

  it('writes the menu in the period currency format', () => {
    const predecimal = currencySpec('gbp-predecimal');
    expect(predecimal.decimal).toBe(false);
    expect(predecimal.pattern.test('1/3')).toBe(true);
    expect(predecimal.pattern.test('6d')).toBe(true);
    expect(predecimal.pattern.test('£1.05')).toBe(false);
    const decimal = currencySpec('gbp-decimal');
    expect(decimal.decimal).toBe(true);
    expect(decimal.pattern.test('45p')).toBe(true);
    expect(decimal.pattern.test('£1.05')).toBe(true);
    expect(decimal.pattern.test('6d')).toBe(false);
    expect(isPeriodPrice('gbp-predecimal', '2/6')).toBe(true);
    expect(isPeriodPrice('gbp-decimal', '2/6')).toBe(false);
    expect(describeMenuBoardSpec(MENU_BOARD_SPECS['1985']).currencyName).toMatch(/decimal/i);
    expect(describeMenuBoardSpec(MENU_BOARD_SPECS['1945']).currencyName).toMatch(/pre-decimal/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Board forms and carcass                                                   */
/* -------------------------------------------------------------------------- */

describe('board forms', () => {
  it('builds five materially different boards', () => {
    const kinds = YEAR_IDS.map((year) => MENU_BOARD_SPECS[year].boardKind);
    expect(new Set(kinds).size).toBe(YEAR_IDS.length);
    expect(kinds).toEqual([
      'chalk-slate',
      'painted-vinyl',
      'fluorescent-letterboard',
      'backlit-acrylic',
      'digital-screen',
    ]);

    const slate = boardForm('chalk-slate');
    expect(slate.stone).toBe(true);
    expect(slate.hasChalkLedge).toBe(true);
    expect(slate.emissive).toBe(false);
    expect(slate.width).toBeLessThan(slate.height);

    const vinyl = boardForm('painted-vinyl');
    expect(vinyl.stone).toBe(false);
    expect(vinyl.backlit).toBe(false);
    expect(vinyl.width).toBeGreaterThan(vinyl.height);

    const letterboard = boardForm('fluorescent-letterboard');
    expect(letterboard.hasLightBox).toBe(true);
    expect(letterboard.hasPromoStrip).toBe(true);
    expect(letterboard.depth).toBeGreaterThan(slate.depth);

    const acrylic = boardForm('backlit-acrylic');
    expect(acrylic.backlit).toBe(true);
    expect(acrylic.emissive).toBe(true);
    expect(acrylic.panelCount).toBe(3);

    const screen = boardForm('digital-screen');
    expect(screen.emissive).toBe(true);
    expect(screen.tilt).toBeLessThan(0);
    expect(screen.panelCount).toBe(4);

    const signatures = BOARD_FORMS.map((form) => boardGeometrySignature(form));
    expect(new Set(signatures).size).toBe(BOARD_FORMS.length);
    expect(BOARD_FORMS).toHaveLength(YEAR_IDS.length);
  });

  it('decomposes each board into members that fit the face and the carcass depth', () => {
    const shapes = new Set<string>();
    for (const year of YEAR_IDS) {
      const form = boardFormForSpec(MENU_BOARD_SPECS[year]);
      const aspect = form.width / form.height;
      const members = boardMembers(form);
      expect(members.length).toBeGreaterThanOrEqual(8);
      expect(new Set(members.map((member) => member.id)).size).toBe(members.length);
      shapes.add([...new Set(members.map((member) => member.role))].sort().join(','));
      for (const member of members) {
        expect(member.rect.x).toBeGreaterThanOrEqual(-1e-9);
        expect(member.rect.y).toBeGreaterThanOrEqual(-1e-9);
        expect(member.rect.x + member.rect.width).toBeLessThanOrEqual(aspect + 1e-9);
        expect(member.rect.y + member.rect.height).toBeLessThanOrEqual(1 + 1e-9);
        expect(member.offset - member.depth / 2).toBeGreaterThanOrEqual(-1e-9);
        expect(member.offset + member.depth / 2).toBeLessThanOrEqual(form.depth + 1e-9);
        expect(member.details.length).toBeGreaterThan(5);
      }
    }
    // The five carcasses are structurally distinct, not one box five times.
    expect(shapes.size).toBeGreaterThanOrEqual(4);
  });

  it('derives the board from the shell and keeps it inside the room', () => {
    const mount = menuMountOf(STRUCTURAL_LAYOUT);
    expect(mount).toBeDefined();
    for (const year of YEAR_IDS) {
      const spec = MENU_BOARD_SPECS[year];
      const form = boardFormForSpec(spec);
      const anchor = resolveBoardAnchor(STRUCTURAL_LAYOUT, form);
      expect(anchor.source).toBe('wall-mount');
      expect(anchor.id).toBe(mount?.id);
      expect(anchor.wall).toBe(mount?.wall);

      const placement = boardPlacement(anchor, form);
      expect(boardPlacementProblems(placement, STRUCTURAL_LAYOUT, CAFE_ROOM_BOUNDS)).toEqual([]);
      expect(placement.width).toBeGreaterThan(0.5);
      // Hung on the wall plane, facing the room.
      const frame = boardWallFrame(placement.wall);
      expect(frame.normal).toEqual(placement.normal);
      expect(placement.box.min.x).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.width / 2 - 1e-6);
      expect(placement.box.max.x).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2 + 1e-6);
      expect(placement.box.min.z).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.depth / 2 - 1e-6);
    }
  });

  it('shrinks a form that is too big for the anchor it is hung on', () => {
    const form = boardForm('chalk-slate');
    const clamped = clampFormToCapacity(form, { width: 0.5, height: 0.5 });
    expect(clamped.width).toBeLessThan(form.width);
    expect(clamped.height).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(clampFormToCapacity(form, { width: 4, height: 4 })).toBe(form);
  });
});

/* -------------------------------------------------------------------------- */
/* Procedural lettering                                                      */
/* -------------------------------------------------------------------------- */

describe('procedural lettering and era layout', () => {
  it('lays every item onto the board inside the face', () => {
    for (const year of YEAR_IDS) {
      const spec = MENU_BOARD_SPECS[year];
      const layout = layoutFor(year);
      const itemIds = spec.items.map((item) => item.id);
      expect([...layout.itemIds].sort()).toEqual([...itemIds].sort());
      expect(layout.scale).toBeGreaterThan(0.2);
      expect(layout.scale).toBeLessThanOrEqual(1);
      expect(layout.kind).toBe(spec.boardKind);
      expect(layout.lettering).toBe(spec.lettering);

      // Every item is lettered with a name and a price.
      const lines = layout.columns.flatMap((column) => column.lines);
      for (const item of spec.items) {
        expect(lines.some((line) => line.kind === 'item' && line.itemId === item.id)).toBe(true);
        expect(lines.some((line) => line.kind === 'price' && line.itemId === item.id)).toBe(true);
      }

      // Nothing leaves the board face.
      const bounds = layoutRunBounds(layout);
      expect(bounds.x).toBeGreaterThanOrEqual(-0.005);
      expect(bounds.y).toBeGreaterThanOrEqual(-0.005);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.aspect + 0.005);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(1.005);
      for (const run of layout.runs) {
        const runBox = runBounds(run);
        expect(Number.isFinite(runBox.x)).toBe(true);
        expect(Number.isFinite(runBox.width)).toBe(true);
        expect(runBox.x + runBox.width).toBeLessThanOrEqual(layout.aspect + 0.005);
        expect(runBox.y + runBox.height).toBeLessThanOrEqual(1.005);
      }

      // Panels and the promo band.
      const regions = boardPanelRegions(layout);
      expect(regions.length).toBeGreaterThanOrEqual(spec.panels.length);
      expect(regions.every((region) => region.rect.width > 0 && region.rect.height > 0)).toBe(true);
      if (spec.promo && spec.boardKind === 'fluorescent-letterboard') {
        const promo = regions.find((region) => region.kind === 'promo-strip');
        expect(promo).toBeDefined();
      }
      if (spec.promo && spec.boardKind === 'digital-screen') {
        const promo = regions.find((region) => region.emphasis === 'promo');
        expect(promo).toBeDefined();
      }
    }
  });

  it('emits the era’s own drawing technique and nothing else', () => {
    const counts = (layout: BoardLayout, kind: Parameters<typeof runsOfKind>[1]): number =>
      runsOfKind(layout.runs, kind).length;

    const chalk = layoutFor('1945');
    expect(counts(chalk, 'chalk-stroke')).toBeGreaterThan(200);
    expect(counts(chalk, 'chalk-smudge')).toBeGreaterThan(2);
    expect(counts(chalk, 'menu-rule')).toBeGreaterThan(0);
    expect(counts(chalk, 'vinyl-letter')).toBe(0);
    expect(counts(chalk, 'fluorescent-tile')).toBe(0);
    expect(counts(chalk, 'backlit-panel')).toBe(0);
    expect(counts(chalk, 'digital-panel')).toBe(0);
    // Hand-chalk strokes carry wobble, and a smudged slate is never clean.
    const stroke = runsOfKind(chalk.runs, 'chalk-stroke')[0];
    expect(stroke?.wobble).toBeGreaterThan(0);
    expect(stroke?.points.length).toBeGreaterThan(1);

    const vinyl = layoutFor('1965');
    expect(counts(vinyl, 'vinyl-letter')).toBeGreaterThan(200);
    expect(counts(vinyl, 'menu-rule')).toBeGreaterThan(0);
    expect(counts(vinyl, 'chalk-stroke')).toBe(0);
    expect(counts(vinyl, 'chalk-smudge')).toBe(0);
    const letter = runsOfKind(vinyl.runs, 'vinyl-letter')[0];
    expect(letter?.bleed).toBeGreaterThan(0);
    expect(letter?.shadow).toBeGreaterThan(0);

    const tiles = layoutFor('1985');
    expect(counts(tiles, 'fluorescent-tile')).toBeGreaterThan(200);
    expect(counts(tiles, 'promo-strip')).toBe(1);
    expect(counts(tiles, 'chalk-stroke')).toBe(0);
    expect(counts(tiles, 'vinyl-letter')).toBe(0);
    const strip = runsOfKind(tiles.runs, 'promo-strip')[0];
    expect(strip?.lines.length).toBeGreaterThan(0);
    expect(strip?.glow).toBeGreaterThan(0.5);
    expect(strip?.stripes).toHaveLength(2);
    const stripText = (strip?.lines ?? []).map((line) => line.text).join(' ');
    expect(stripText).toContain(MENU_BOARD_SPECS['1985'].promo?.price?.display ?? '£2.20');
    expect(stripText).toContain('TODAY');
    expect(strip?.bounds.height).toBeGreaterThan(0);
    const tilesMissing = runsOfKind(tiles.runs, 'fluorescent-tile').filter((tile) => tile.missing);
    expect(tilesMissing.length).toBeGreaterThan(0);
    // Tiles sit on the board's rails, not at arbitrary positions.
    const firstTile = runsOfKind(tiles.runs, 'fluorescent-tile')[0];
    expect(firstTile?.row).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(firstTile?.row)).toBe(true);

    const acrylic = layoutFor('2005');
    expect(counts(acrylic, 'backlit-panel')).toBeGreaterThan(MENU_BOARD_SPECS['2005'].panels.length);
    expect(acrylic.panels).toHaveLength(MENU_BOARD_SPECS['2005'].panels.length);
    expect(counts(acrylic, 'digital-panel')).toBe(0);
    expect(counts(acrylic, 'chalk-stroke')).toBe(0);
    const panel = runsOfKind(acrylic.runs, 'backlit-panel').find((run) => run.index === 0);
    expect(panel?.lines.length).toBeGreaterThan(0);
    expect(panel?.glow).toBeGreaterThan(0.5);
    expect(panel?.sheen).toBeGreaterThan(0);
    expect(panel?.bounds.width).toBeGreaterThan(0);

    const screen = layoutFor('2025');
    expect(screen.panels).toHaveLength(MENU_BOARD_SPECS['2025'].panels.length + 1);
    expect(counts(screen, 'digital-panel')).toBeGreaterThan(screen.panels.length);
    expect(counts(screen, 'backlit-panel')).toBe(0);
    const screenPanels = runsOfKind(screen.runs, 'digital-panel').filter((run) => run.index >= 0);
    expect(screenPanels).toHaveLength(MENU_BOARD_SPECS['2025'].panels.length + 1);
    for (const panel of screenPanels) {
      expect(panel.phase).toBeGreaterThanOrEqual(0);
      expect(panel.phase).toBeLessThan(1);
      expect(panel.rotationSeconds).toBeGreaterThan(0);
      expect(panel.luminance).toBeGreaterThan(0.5);
      expect(panel.scanlines).toBeGreaterThan(0);
    }
    expect(new Set(screenPanels.map((panel) => panel.rotationSeconds)).size).toBeGreaterThan(1);
  });

  it('records era wear and the 1945 substitute-price annotation', () => {
    const wearOf = (year: YearId): readonly string[] =>
      runsOfKind(layoutFor(year).runs, 'wear').map((run) => run.wear);

    expect(wearOf('1945')).toContain('chalk-dust');
    expect(wearOf('1945')).toContain('coffee-ring');
    expect(wearOf('1965')).toContain('paint-loss');
    expect(wearOf('1965')).toContain('sun-bleach');
    expect(wearOf('1985')).toContain('missing-tile');
    expect(wearOf('2005')).toContain('dead-led');
    expect(wearOf('2025')).toContain('screen-ghost');

    const chalk = layoutFor('1945');
    const substitute = chalk.columns
      .flatMap((column) => column.lines)
      .filter((line) => line.substitute);
    expect(substitute.length).toBeGreaterThan(0);
    const substituteText = substitute.map((line) => line.text).join(' ');
    expect(substituteText).toMatch(/OR /);
    expect(substituteText).toMatch(/2D/);
    for (const year of YEAR_IDS) {
      if (year === '1945') continue;
      const others = layoutFor(year).columns.flatMap((column) => column.lines);
      expect(others.some((line) => line.substitute)).toBe(false);
    }

    // The printed eras keep their small print; the crowded boards drop
    // descriptions but never the notes.
    const chalkNotes = chalk.columns.flatMap((column) => column.lines).filter((line) => line.kind === 'note');
    expect(chalkNotes.length).toBeGreaterThan(0);

    // Every board carries its own era detail — a note, a substitute or the
    // promo — so the menu reads as the period's, not just a price list.
    for (const year of YEAR_IDS) {
      const layout = layoutFor(year);
      const lines = layout.columns.flatMap((column) => column.lines);
      const detail =
        lines.filter((line) => line.kind === 'note' || line.substitute).length +
        (layout.promo ? layout.promo.lines.length : 0);
      expect(detail).toBeGreaterThan(0);
    }
  });

  it('is deterministic: the same board always lays out the same way', () => {
    for (const year of YEAR_IDS) {
      const spec = MENU_BOARD_SPECS[year];
      const form = boardFormForSpec(spec);
      const first = layoutMenuBoard(spec, form);
      const second = layoutMenuBoard(spec, form);
      expect(second.signature).toBe(first.signature);
      expect(second.runs.length).toBe(first.runs.length);

      const other = layoutFor(year === '1945' ? '2025' : '1945');
      expect(other.signature).not.toBe(first.signature);
    }

    // The five eras never share a run set.
    const signatures = YEAR_IDS.map((year) => layoutFor(year).signature);
    expect(new Set(signatures).size).toBe(YEAR_IDS.length);
  });

  it('prints the review snapshot for each era’s board', () => {
    const reports = YEAR_IDS.map((year) => boardLayoutReport(layoutFor(year)));
    for (const [index, report] of reports.entries()) {
      const year = YEAR_IDS[index];
      expect(report).toContain(`${year} -`);
      expect(report).toContain('menu:');
      expect(report).toContain('wear:');
      expect(report).toContain('signature:');
      // eslint-disable-next-line no-console
      console.log(`\n${report}`);
    }
    const [chalk, vinyl, tiles, acrylic, screen] = reports;
    expect(chalk).toContain('hand-chalk');
    expect(chalk).toContain('chalk-smudge');
    expect(chalk).toContain('substitute annotations');
    expect(chalk).toContain('chalk-dust');
    expect(vinyl).toContain('applied-vinyl');
    expect(vinyl).toContain('vinyl-letter');
    expect(vinyl).toContain('paint-loss');
    expect(tiles).toContain('fluorescent-tiles');
    expect(tiles).toContain('promo band: LUNCHTIME SPECIAL');
    expect(tiles).toContain('missing-tile');
    expect(acrylic).toContain('backlit-print');
    expect(acrylic).toContain('backlit');
    expect(acrylic).toContain('dead-led');
    expect(screen).toContain('emissive-digital');
    expect(screen).toContain('@9s');
    expect(screen).toContain('screen-ghost');
  });

  it('sets every character from its own stroke font', () => {
    expect(normaliseBoardText('  Tea & cake — 1/3  ')).toBe('TEA & CAKE - 1/3');
    expect(measureBoardText('COFFEE', 0.1, 0)).toBeGreaterThan(0.3);
    const glyphs = layoutMenuBoard(MENU_BOARD_SPECS['1945'], boardForm('chalk-slate'));
    const heading = glyphs.heading;
    expect(heading.text).toBe('THE CORNER CAFE');
    expect(heading.align).toBe('center');
    expect(heading.size).toBeGreaterThan(0.02);

    // Every character the five boards letter is really in the stroke font: no
    // mouthful of an item name falls back to the missing-glyph box.
    const alphabet = new Set(BOARD_TEXT_ALPHABET);
    for (const year of YEAR_IDS) {
      const spec = MENU_BOARD_SPECS[year];
      const texts = [
        spec.heading,
        spec.subheading,
        spec.boardNote,
        spec.promo?.headline ?? '',
        spec.promo?.detail ?? '',
        spec.promo?.badge ?? '',
        ...spec.items.map((item) => `${item.name} ${item.description} ${item.note ?? ''} ${item.price.display}`),
        ...spec.sections.map((section) => section.label),
      ];
      for (const text of texts) {
        for (const character of normaliseBoardText(text)) {
          expect(alphabet.has(character)).toBe(true);
        }
      }
    }
    expect(glyphStrokes('A').length).toBeGreaterThan(0);
    expect(glyphStrokes('£').length).toBeGreaterThan(0);
    expect(glyphStrokes('\u2603').length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Painting                                                                  */
/* -------------------------------------------------------------------------- */

describe('procedural painting', () => {
  it('paints era-specific pixels into the board maps', () => {
    const glowLuminance: Record<string, number> = {};
    for (const year of YEAR_IDS) {
      const spec = MENU_BOARD_SPECS[year];
      const form = boardFormForSpec(spec);
      const layout = layoutFor(year);
      const size = 192;
      const face = paintBoardFace({ layout, surface: spec.surface, form, layer: 'face', width: size, height: size });
      const glow = paintBoardFace({ layout, surface: spec.surface, form, layer: 'glow', width: size, height: size });
      expect(face.width).toBe(size);
      expect(face.data.length).toBe(size * size * 4);
      // Ink, frames, panels and wear really are painted, not a flat fill.
      expect(face.differingFraction(face.sample(1, 1), 10)).toBeGreaterThan(0.1);
      glowLuminance[year] = glow.meanLuminance();
      // The two maps are different maps.
      expect(face.meanLuminance()).not.toBeCloseTo(glow.meanLuminance(), 3);
    }
    // Chalk and paint barely emit; the lit decades do.
    expect(glowLuminance['1945'] ?? 1).toBeLessThan(0.06);
    expect(glowLuminance['1965'] ?? 1).toBeLessThan(0.06);
    expect(glowLuminance['1985'] ?? 0).toBeGreaterThan(0.05);
    expect(glowLuminance['2005'] ?? 0).toBeGreaterThan(0.05);
    expect(glowLuminance['2025'] ?? 0).toBeGreaterThan(0.05);
    expect(glowLuminance['2025'] ?? 0).toBeGreaterThan(glowLuminance['1945'] ?? 0);
  });

  it('materialises a data texture headlessly and a canvas texture when a canvas exists', () => {
    const spec = MENU_BOARD_SPECS['1985'];
    const form = boardFormForSpec(spec);
    const layout = layoutFor('1985');
    const height = 96;
    const headless = createMenuBoardTexture({
      layout,
      surface: spec.surface,
      form,
      layer: 'face',
      height,
    });
    expect(headless.source).toBe('data');
    expect(headless.texture).toBeInstanceOf(THREE.DataTexture);
    expect(headless.width).toBeGreaterThan(height);
    expect(headless.key).toBe('face');
    const pixels = headless.texture.image as { data: Uint8ClampedArray };
    expect(pixels.data.some((value) => value > 0)).toBe(true);
    headless.texture.dispose();

    const canvases: { width: number; height: number }[] = [];
    const canvasFactory = (width: number, canvasHeight: number): HTMLCanvasElement | null => {
      canvases.push({ width, height: canvasHeight });
      const data = new Uint8ClampedArray(width * canvasHeight * 4);
      const context = {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (image: { data: Uint8ClampedArray }) => {
          data.set(image.data);
        },
      };
      return {
        width,
        height: canvasHeight,
        getContext: () => context,
      } as unknown as HTMLCanvasElement;
    };
    const withCanvas = createMenuBoardTexture({
      layout,
      surface: spec.surface,
      form,
      layer: 'glow',
      height,
      canvasFactory,
    });
    expect(canvases).toHaveLength(1);
    expect(withCanvas.source).toBe('canvas');
    expect(withCanvas.texture).toBeInstanceOf(THREE.CanvasTexture);
    withCanvas.texture.dispose();
  });

  it('keeps the default texture resolution legible for small print', () => {
    expect(MENU_BOARD_TEXTURE_HEIGHT).toBeGreaterThanOrEqual(512);
  });
});

/* -------------------------------------------------------------------------- */
/* SceneModule lifecycle                                                     */
/* -------------------------------------------------------------------------- */

describe('menu board scene module', () => {
  it('builds and applies all five eras inside the room', () => {
    const scene = createScene();
    expect(scene.board.id).toBe(MENU_BOARD_MODULE_ID);
    expect(scene.board.built).toBe(false);
    expect(scene.board.getHotspots()).toEqual([]);

    applyYear(scene, '1945');
    expect(scene.board.built).toBe(true);
    expect(scene.kernel.world.children).toHaveLength(1);
    const firstSignature = scene.board.boardLayout?.signature;
    const signatures = new Set<string>();
    const placementSignatures = new Set<string>();

    for (let round = 0; round < 3; round += 1) {
      for (const year of YEAR_IDS) {
        applyYear(scene, year);
        const spec = MENU_BOARD_SPECS[year];
        const description = scene.board.describe();
        expect(description.year).toBe(year);
        expect(description.built).toBe(true);
        expect(description.boardKind).toBe(spec.boardKind);
        expect(description.lettering).toBe(spec.lettering);
        expect(description.itemCount).toBe(spec.items.length);
        expect(description.placementProblems).toEqual([]);
        expect(description.anchorSource).toBe('wall-mount');
        expect(description.wall).toBe('right');
        expect(description.mountId).toBe('wall-mount-right-2');
        expect(description.benchmarkPrice).toBe(
          spec.items.find((item) => item.id === spec.benchmarkItemId)?.price.display,
        );
        expect(description.geometrySignature).toBe(boardGeometrySignature(boardFormForSpec(spec)));
        expect(description.textureCount).toBe(2);
        expect(description.materialCount).toBeGreaterThan(3);
        expect(description.geometryCount).toBeGreaterThan(5);
        expect(description.nodeCount).toBeGreaterThan(8);
        expect(description.summary.heading).toBe(spec.heading);
        expect(description.resources.retainedTextures).toBe(2);
        expect(description.resources.disposedTextures).toBe(
          description.resources.createdTextures - 2,
        );
        expect(scene.board.textureSource).toBe('data');
        // Only the boards that light themselves are lit: chalk and paint are not.
        const lightsUp = year === '1985' || year === '2005' || year === '2025';
        expect(description.lit).toBe(lightsUp);
        if (lightsUp) {
          expect(description.faceEmissiveIntensity).toBeGreaterThan(0.2);
          expect(description.glowOpacity).toBeGreaterThan(0.5);
        } else {
          expect(description.faceEmissiveIntensity).toBeLessThan(0.2);
          expect(description.glowOpacity).toBeLessThan(0.5);
        }
        signatures.add(description.layoutSignature ?? '');
        placementSignatures.add(description.placementSignature ?? '');
        expect(scene.kernel.world.children).toHaveLength(1);
      }
    }

    // Three passes over five years: one signature per era, and the board moves
    // with the form, so the placement fingerprints differ too.
    expect(signatures.size).toBe(YEAR_IDS.length);
    expect(signatures.has(firstSignature ?? '')).toBe(true);
    expect(placementSignatures.size).toBe(YEAR_IDS.length);

    // The board is anchored inside the environment room bounds.
    const placement = scene.board.placement;
    expect(placement).toBeDefined();
    if (placement) {
      expect(placement.box.min.y).toBeGreaterThan(0);
      expect(placement.box.max.y).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.height);
      expect(Math.abs(placement.position.x)).toBeLessThan(CAFE_ROOM_BOUNDS.width / 2);
    }

    // Hotspots: the board plus one per panel, anchored in the module's group.
    const hotspots = scene.board.getHotspots();
    const root = scene.board.root as THREE.Object3D;
    expect(hotspots.length).toBeGreaterThan(3);
    expect(hotspots[0]?.id).toBe(`${MENU_BOARD_MODULE_ID}:board`);
    for (const hotspot of hotspots) {
      expect(hotspot.year).toBe('2025');
      expect(hotspot.moduleId).toBe(MENU_BOARD_MODULE_ID);
      expect(hotspot.position.x).toBeGreaterThan(-10);
      expect(hotspot.anchor).toBeInstanceOf(THREE.Object3D);
      let owner: THREE.Object3D | undefined = hotspot.anchor as THREE.Object3D | undefined;
      while (owner && owner !== root) owner = owner.parent ?? undefined;
      expect(owner).toBe(root);
    }

    // Inspect framing is finite and looks at the board from the room side.
    const focus = scene.board.focus();
    expect(focus).not.toBeNull();
    expect(focus?.year).toBe('2025');
    expect(Number.isFinite(focus?.position.x ?? Number.NaN)).toBe(true);
    expect(focus?.distance).toBeGreaterThan(0.3);
    expect(scene.board.focus('kitchen')).not.toBeNull();
    expect(scene.board.members.length).toBeGreaterThan(5);
    expect(scene.board.updateCount).toBeGreaterThan(0);
    expect(scene.board.panels.length).toBeGreaterThan(3);
    expect(scene.board.mountId).toBe('wall-mount-right-2');

    applyYear(scene, '1945');
    scene.board.dispose();
    expect(scene.kernel.world.children).toHaveLength(0);
    expect(scene.board.built).toBe(false);
    expect(scene.board.getHotspots()).toEqual([]);
  }, 30_000);

  it('rotates the 2025 panels and leaves the other decades still', () => {
    const scene = createScene();
    applyYear(scene, '2025');
    const expectedCycle = scene.board.cycleSeconds;
    expect(expectedCycle).toBeGreaterThan(9);
    expect(scene.board.panels).toHaveLength(4);

    const seen = new Set<number>();
    for (let step = 0; step < 40; step += 1) {
      scene.board.update(1, { year: '2025', elapsedSeconds: step, frame: step });
      seen.add(scene.board.activePanelIndex);
    }
    expect(seen.size).toBe(scene.board.panels.length);
    expect([...seen].every((index) => index >= 0)).toBe(true);

    for (const year of YEAR_IDS) {
      if (year === '2025') continue;
      applyYear(scene, year);
      expect(scene.board.cycleSeconds).toBe(0);
      scene.board.update(2, { year, elapsedSeconds: 2, frame: 2 });
      expect(scene.board.activePanelIndex).toBe(-1);
    }

    scene.board.dispose();
  }, 30_000);

  it('builds and disposes five times without retaining a single resource', () => {
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const scene = createScene();
      for (const year of YEAR_IDS) {
        applyYear(scene, year);
      }
      const beforeDispose = scene.board.resourceReport();
      expect(beforeDispose.createdGeometries).toBeGreaterThan(0);
      expect(beforeDispose.createdMaterials).toBeGreaterThan(0);
      expect(beforeDispose.createdTextures).toBeGreaterThan(0);

      scene.board.dispose();
      const after = scene.board.resourceReport();
      expect(after.retainedGeometries).toBe(0);
      expect(after.retainedMaterials).toBe(0);
      expect(after.retainedTextures).toBe(0);
      expect(after.disposedGeometries).toBe(after.createdGeometries);
      expect(after.disposedMaterials).toBe(after.createdMaterials);
      expect(after.disposedTextures).toBe(after.createdTextures);
      expect(after.nodes).toBe(0);
      expect(scene.board.nodeCount).toBe(0);
      expect(scene.kernel.world.children).toHaveLength(0);

      // Disposing twice is safe, and the module can be rebuilt afterwards.
      scene.board.dispose();
      expect(scene.board.resourceReport().retainedGeometries).toBe(0);
      scene.board.build(scene.kernel.createBuildContext(periodFor('1945')));
      expect(scene.board.built).toBe(true);
      expect(scene.board.resourceReport().retainedTextures).toBe(2);
      scene.board.dispose();
      expect(scene.board.resourceReport().retainedTextures).toBe(0);
    }
  }, 60_000);

  it('reports diagnostics before the first build', () => {
    const board = createMenuBoardModule({ initialYear: '1985' });
    const description = board.describe();
    expect(description.built).toBe(false);
    expect(description.year).toBe('1985');
    expect(description.boardKind).toBe('fluorescent-letterboard');
    expect(description.mountId).toBeNull();
    expect(description.anchorSource).toBe('none');
    expect(description.layoutSignature).toBeNull();
    expect(description.textureCount).toBe(0);
    expect(description.placementProblems).toEqual([]);
    expect(MODULE_SPECS['1985']).toBe(MENU_BOARD_SPECS['1985']);
    expect(board.focus()).toBeNull();
  });
});
