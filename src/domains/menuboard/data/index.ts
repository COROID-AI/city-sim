/**
 * Era menu-board inventory — the board, its menu and its money, year by year.
 *
 * One {@link MenuBoardSpec} per selectable year describes the era's board form,
 * its heading, the sections and line items with prices in the period's own
 * currency, the columns the menu is set in, the promo the era runs, the
 * lettering technique and the colours and wear of the board face.
 *
 * The specs are pure data: colours are CSS strings and prices are written the
 * way the period wrote them (`6d`, `1/3`, `45p`, `£3.60`), with
 * {@link menuPrice} deriving the cross-era comparable amount. Applying an era
 * therefore never touches the network.
 *
 * {@link MENU_BOARD_SPECS} is the map the period registry reads, keyed by
 * {@link YearId}; {@link MENU_BOARD_INVENTORY} is the flat row table later
 * scene-verification work asserts against without reading into module
 * internals; {@link menuBoardSpecProblems} and {@link menuBoardSpecConflicts}
 * are the self-checks that keep the five eras honest and distinct.
 */

import { YEAR_IDS, type YearId } from '../../../contracts/period';
import {
  currencySpec,
  isPeriodPrice,
  type BoardPanelEmphasis,
  type CurrencyId,
  type LetteringStyle,
  type MenuBoardInventoryEntry,
  type MenuBoardKind,
  type MenuBoardSpec,
  type MenuBoardSpecSummary,
  type MenuSectionId,
} from '../types';
import { SPEC_1945 } from './1945';
import { SPEC_1965 } from './1965';
import { SPEC_1985 } from './1985';
import { SPEC_2005 } from './2005';
import { SPEC_2025 } from './2025';

export { SPEC_1945, SPEC_1965, SPEC_1985, SPEC_2005, SPEC_2025 };

/* -------------------------------------------------------------------------- */
/* Era map                                                                    */
/* -------------------------------------------------------------------------- */

/** Per-year menu board specs, keyed by {@link YearId}. */
export const MENU_BOARD_SPECS: Readonly<Record<YearId, MenuBoardSpec>> = Object.freeze({
  '1945': SPEC_1945,
  '1965': SPEC_1965,
  '1985': SPEC_1985,
  '2005': SPEC_2005,
  '2025': SPEC_2025,
});

/** Looks up one era's menu board spec. */
export function menuBoardSpec(year: YearId): MenuBoardSpec {
  const spec = MENU_BOARD_SPECS[year];
  if (!spec) throw new Error(`No menu board spec for ${year}.`);
  return spec;
}

/** Which currency each era writes its prices in. */
const ERA_CURRENCY: Readonly<Record<YearId, CurrencyId>> = Object.freeze({
  '1945': 'gbp-predecimal',
  '1965': 'gbp-predecimal',
  '1985': 'gbp-decimal',
  '2005': 'gbp-decimal',
  '2025': 'gbp-decimal',
});

/** Which board form each era builds, and the lettering technique that implies. */
const ERA_FORM: Readonly<Record<YearId, { kind: MenuBoardKind; lettering: LetteringStyle }>> =
  Object.freeze({
    '1945': { kind: 'chalk-slate', lettering: 'hand-chalk' },
    '1965': { kind: 'painted-vinyl', lettering: 'applied-vinyl' },
    '1985': { kind: 'fluorescent-letterboard', lettering: 'fluorescent-tiles' },
    '2005': { kind: 'backlit-acrylic', lettering: 'backlit-print' },
    '2025': { kind: 'digital-screen', lettering: 'emissive-digital' },
  });

/* -------------------------------------------------------------------------- */
/* Summary and inventory                                                     */
/* -------------------------------------------------------------------------- */

/** Digest of an era spec for overlays, diagnostics and assertions. */
export function describeMenuBoardSpec(spec: MenuBoardSpec): MenuBoardSpecSummary {
  const benchmark = spec.items.find((item) => item.id === spec.benchmarkItemId);
  return Object.freeze({
    year: spec.year,
    boardKind: spec.boardKind,
    boardName: spec.boardName,
    lettering: spec.lettering,
    currency: spec.currency,
    currencyName: currencySpec(spec.currency).name,
    heading: spec.heading,
    itemCount: spec.items.length,
    sectionCount: spec.sections.length,
    panelCount: spec.panels.length,
    wantsPromo: spec.promo !== undefined,
    rotates: spec.panels.some((panel) => (panel.rotationSeconds ?? 0) > 0),
    benchmarkPrice: benchmark?.price.display ?? '',
    benchmarkPence: benchmark?.price.pence ?? 0,
  });
}

/** Flat rows for one era: every priced line on that year's board. */
export function menuBoardInventory(year: YearId): readonly MenuBoardInventoryEntry[] {
  const spec = menuBoardSpec(year);
  return Object.freeze(
    spec.items.map((item) =>
      Object.freeze({
        year,
        boardKind: spec.boardKind,
        itemId: item.id,
        name: item.name,
        section: item.section,
        price: item.price.display,
        pence: item.price.pence,
        substitute: item.substitute ? item.substitute.name : null,
        substitutePence: item.substitute ? item.substitute.price.pence : null,
      }),
    ),
  );
}

/** Every era's rows, in timeline order. */
export const MENU_BOARD_INVENTORY: readonly MenuBoardInventoryEntry[] = Object.freeze(
  YEAR_IDS.flatMap((year) => [...menuBoardInventory(year)]),
);

/** Panel emphasis of a spec's columns, exposed for overlays and tests. */
export function menuBoardEmphasis(spec: MenuBoardSpec, panelId: string): BoardPanelEmphasis {
  return spec.panels.find((panel) => panel.id === panelId)?.emphasis ?? 'standard';
}

/* -------------------------------------------------------------------------- */
/* Self-checks                                                               */
/* -------------------------------------------------------------------------- */

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Object.freeze([...duplicates]);
}

/**
 * Everything that must hold inside one era's spec: a non-empty, unique menu in
 * the era's own currency, a benchmark item to compare decades by, columns that
 * cover every section, and a promo only where the form carries one. Returns an
 * empty list when the spec is sound.
 */
export function menuBoardSpecProblems(spec: MenuBoardSpec): readonly string[] {
  const problems: string[] = [];
  const form = ERA_FORM[spec.year];
  const expectedCurrency = ERA_CURRENCY[spec.year];

  if (spec.sections.length === 0) problems.push(`${spec.year}: the menu has no sections`);
  if (spec.items.length === 0) problems.push(`${spec.year}: the menu has no line items`);
  for (const duplicate of duplicateValues(spec.sections.map((section) => section.id))) {
    problems.push(`${spec.year}: duplicate menu section "${duplicate}"`);
  }
  for (const duplicate of duplicateValues(spec.items.map((item) => item.id))) {
    problems.push(`${spec.year}: duplicate menu item id "${duplicate}"`);
  }
  for (const duplicate of duplicateValues(spec.panels.map((panel) => panel.id))) {
    problems.push(`${spec.year}: duplicate panel id "${duplicate}"`);
  }

  if (form && spec.boardKind !== form.kind) {
    problems.push(`${spec.year}: board form ${spec.boardKind} does not match the era's ${form.kind}`);
  }
  if (form && spec.lettering !== form.lettering) {
    problems.push(`${spec.year}: lettering ${spec.lettering} does not match ${form.lettering}`);
  }
  if (spec.currency !== expectedCurrency) {
    problems.push(`${spec.year}: currency ${spec.currency} should be ${expectedCurrency}`);
  }
  if (spec.heading.trim().length === 0) problems.push(`${spec.year}: the board has no heading`);
  if (spec.subheading.trim().length === 0) problems.push(`${spec.year}: the board has no subheading`);
  if (spec.boardNote.trim().length === 0) problems.push(`${spec.year}: the board has no small print`);
  if (spec.tags.length === 0) problems.push(`${spec.year}: the spec carries no era tags`);
  if (spec.notes.length === 0) problems.push(`${spec.year}: the spec carries no era notes`);

  const sectionIds = new Set<MenuSectionId>(spec.sections.map((section) => section.id));
  for (const item of spec.items) {
    if (!sectionIds.has(item.section)) {
      problems.push(`${spec.year}/${item.id}: unknown menu section "${item.section}"`);
    }
    if (item.name.trim().length === 0) problems.push(`${spec.year}/${item.id}: the item has no name`);
    if (item.description.trim().length === 0) {
      problems.push(`${spec.year}/${item.id}: the item has no description`);
    }
    if (item.price.currency !== spec.currency) {
      problems.push(`${spec.year}/${item.id}: price currency ${item.price.currency} is not ${spec.currency}`);
    }
    if (!isPeriodPrice(spec.currency, item.price.display)) {
      problems.push(`${spec.year}/${item.id}: "${item.price.display}" is not a ${spec.currency} price`);
    }
    if (!(item.price.pence > 0) || !Number.isFinite(item.price.pence)) {
      problems.push(`${spec.year}/${item.id}: price "${item.price.display}" has no comparable amount`);
    }
    if (item.price.pence > (spec.year === '1945' ? 35 : spec.year === '1965' ? 42 : 2000)) {
      problems.push(`${spec.year}/${item.id}: "${item.price.display}" is too dear for the era`);
    }
    if (item.substitute) {
      if (item.substitute.price.currency !== spec.currency) {
        problems.push(`${spec.year}/${item.id}: the substitute price is in the wrong currency`);
      }
      if (item.substitute.price.pence >= item.price.pence) {
        problems.push(`${spec.year}/${item.id}: the substitute is not cheaper than the dish`);
      }
      if (item.substitute.note.trim().length === 0) {
        problems.push(`${spec.year}/${item.id}: the substitute carries no note`);
      }
    }
  }

  if (!spec.items.some((item) => item.id === spec.benchmarkItemId)) {
    problems.push(`${spec.year}: benchmark item "${spec.benchmarkItemId}" is not on the menu`);
  }

  if (spec.panels.length === 0) problems.push(`${spec.year}: the board is not split into panels`);
  const covered = new Set<MenuSectionId>();
  for (const panel of spec.panels) {
    if (panel.sectionIds.length === 0) {
      problems.push(`${spec.year}/${panel.id}: the panel carries no sections`);
    }
    for (const sectionId of panel.sectionIds) {
      if (!sectionIds.has(sectionId)) {
        problems.push(`${spec.year}/${panel.id}: unknown section "${sectionId}"`);
      }
      covered.add(sectionId);
    }
    const rotates = (panel.rotationSeconds ?? 0) > 0;
    if (rotates && spec.boardKind !== 'digital-screen') {
      problems.push(`${spec.year}/${panel.id}: only the digital screen rotates its panels`);
    }
  }
  for (const section of spec.sections) {
    if (!covered.has(section.id)) {
      problems.push(`${spec.year}: section "${section.id}" is not set on any panel`);
    }
  }
  if (spec.boardKind === 'digital-screen' && !spec.panels.some((panel) => (panel.rotationSeconds ?? 0) > 0)) {
    problems.push(`${spec.year}: the digital screen never rotates its panels`);
  }
  if (spec.boardKind !== 'digital-screen' && spec.promo && spec.boardKind !== 'fluorescent-letterboard') {
    problems.push(`${spec.year}: this board form carries no promo`);
  }
  if (spec.promo) {
    if (spec.promo.headline.trim().length === 0) {
      problems.push(`${spec.year}: the promo has no headline`);
    }
    if (spec.promo.detail.trim().length === 0) {
      problems.push(`${spec.year}: the promo has no detail`);
    }
    if (spec.promo.price && spec.promo.price.currency !== spec.currency) {
      problems.push(`${spec.year}: the promo price is in the wrong currency`);
    }
  }

  return Object.freeze(problems);
}

/**
 * Cross-era checks: the five boards must not be the same board five times. The
 * item lists differ pairwise, the forms and lettering differ pairwise, and the
 * benchmark item gets dearer every decade.
 */
export function menuBoardSpecConflicts(
  specs: readonly MenuBoardSpec[] = YEAR_IDS.map((year) => MENU_BOARD_SPECS[year]),
): readonly string[] {
  const problems: string[] = [];
  for (let a = 0; a < specs.length; a += 1) {
    for (let b = a + 1; b < specs.length; b += 1) {
      const left = specs[a];
      const right = specs[b];
      if (!left || !right) continue;
      const leftItems = left.items.map((item) => item.id).sort().join(',');
      const rightItems = right.items.map((item) => item.id).sort().join(',');
      if (leftItems === rightItems) {
        problems.push(`${left.year} and ${right.year} have identical item lists`);
      }
      if (left.boardKind === right.boardKind) {
        problems.push(`${left.year} and ${right.year} build the same board form`);
      }
      if (left.lettering === right.lettering) {
        problems.push(`${left.year} and ${right.year} use the same lettering technique`);
      }
      if (left.currency === right.currency) {
        const crossesDecimalisation =
          ERA_CURRENCY[left.year] !== ERA_CURRENCY[right.year] ||
          (left.year === '1965' && right.year === '1985');
        if (crossesDecimalisation) {
          problems.push(`${left.year} and ${right.year} share a currency across decimalisation`);
        }
      }
    }
  }

  const benchmark = YEAR_IDS.map((year) => {
    const spec = MENU_BOARD_SPECS[year];
    const item = spec.items.find((entry) => entry.id === spec.benchmarkItemId);
    return { year, pence: item?.price.pence ?? 0 };
  });
  for (let index = 1; index < benchmark.length; index += 1) {
    const previous = benchmark[index - 1];
    const current = benchmark[index];
    if (!previous || !current) continue;
    if (current.pence <= previous.pence) {
      problems.push(
        `${current.year}: the benchmark item (${current.pence}p) is not dearer than ${previous.year} (${previous.pence}p)`,
      );
    }
  }
  return Object.freeze(problems);
}

/** True when the whole era map is sound: used by the module's own tests. */
export function menuBoardSpecsHealthy(): boolean {
  return (
    YEAR_IDS.every((year) => menuBoardSpecProblems(MENU_BOARD_SPECS[year]).length === 0) &&
    menuBoardSpecConflicts().length === 0
  );
}

