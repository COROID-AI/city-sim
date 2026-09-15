/**
 * Era poster inventory — what hangs on the café wall in each year.
 *
 * One {@link PosterYearSpec} per selectable year describes the era's artwork
 * programme: its typography (which faces the era's art department had), its
 * printing plant (ink spread, register drift, fade and colour cast), the wall
 * colour the decals are tinted against, the mounting practice of the period, and
 * the {@link PosterSpec}s themselves — headline, layout, illustration, palette,
 * mount style, frame finish, physical size, wear and the note the overlay reads
 * out when the artwork is inspected up close.
 *
 * The specs are pure data: colours are CSS strings, layouts and motifs name
 * procedural painters from `../textures`, and frames name finishes from
 * `../frames`. Applying an era therefore never touches the network.
 *
 * {@link POSTER_SPECS} is the map the period registry reads, keyed by
 * {@link YearId}; {@link POSTER_INVENTORY} is the flat table later
 * scene-verification work asserts against without reading into poster
 * internals, and {@link posterSpecProblems} / {@link eraConflicts} are the
 * self-checks that keep the five eras distinct.
 */

import { YEAR_IDS, type DomainSpecBase, type YearId } from '../../../contracts/period';
import { FRAME_STYLES, type FrameStyleId, type PosterMount } from '../frames';
import {
  LAYOUT_PAINTERS,
  MOTIF_PAINTERS,
  type PosterArtwork,
  type PosterLayoutId,
  type PosterMotifId,
  type PosterPrintRecipe,
  type PosterTypography,
} from '../textures';
import { SPEC_1945 } from './1945';
import { SPEC_1965 } from './1965';
import { SPEC_1985 } from './1985';
import { SPEC_2005 } from './2005';
import { SPEC_2025 } from './2025';

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a poster is advertising. Each era must cover the categories recorded in
 * {@link REQUIRED_POSTER_CATEGORIES}.
 */
export type PosterCategory =
  | 'rationing'
  | 'civic-notice'
  | 'utility'
  | 'soda'
  | 'tobacco'
  | 'travel'
  | 'brand'
  | 'cinema'
  | 'film'
  | 'telecom'
  | 'early-web'
  | 'social'
  | 'sustainability'
  | 'local-art';

/** One poster of one era: the artwork plus how it is printed and mounted. */
export interface PosterSpec extends PosterArtwork {
  readonly year: YearId;
  readonly category: PosterCategory;
  readonly mount: PosterMount;
  readonly frame: FrameStyleId;
  /** Physical paper size in metres (width, height). */
  readonly size: readonly [number, number];
  /** Era note the overlay reads when the poster is inspected up close. */
  readonly note: string;
  /** Placement order; `0` claims the era's best wall position. */
  readonly priority: number;
}

/** The mounting practice of one era. */
export interface PosterMountingSpec {
  readonly primary: PosterMount;
  /** Fittings the era's handyman had in the drawer. */
  readonly hardware: readonly string[];
  readonly notes: readonly string[];
}

/** One era of café wall artwork. */
export interface PosterYearSpec extends DomainSpecBase {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly summary: string;
  readonly paletteName: string;
  readonly typography: PosterTypography;
  readonly print: PosterPrintRecipe;
  /** Era wall paint the wear decals are tinted against. */
  readonly wallColour: string;
  readonly mounting: PosterMountingSpec;
  /** Frame finishes this era's posters use. */
  readonly styles: readonly FrameStyleId[];
  readonly posters: readonly PosterSpec[];
}

/* -------------------------------------------------------------------------- */
/* Era map                                                                    */
/* -------------------------------------------------------------------------- */

/** Per-year poster specs, keyed by {@link YearId}. */
export const POSTER_SPECS: Readonly<Record<YearId, PosterYearSpec>> = Object.freeze({
  '1945': SPEC_1945,
  '1965': SPEC_1965,
  '1985': SPEC_1985,
  '2005': SPEC_2005,
  '2025': SPEC_2025,
});

/** Looks up one era's poster spec. */
export function posterSpec(year: YearId): PosterYearSpec {
  return POSTER_SPECS[year];
}

/** The artwork categories each era must cover. */
export const REQUIRED_POSTER_CATEGORIES: Readonly<Record<YearId, readonly PosterCategory[]>> = Object.freeze({
  '1945': Object.freeze(['rationing', 'civic-notice'] as const),
  '1965': Object.freeze(['soda', 'tobacco', 'travel'] as const),
  '1985': Object.freeze(['brand', 'cinema'] as const),
  '2005': Object.freeze(['film', 'telecom', 'early-web'] as const),
  '2025': Object.freeze(['social', 'sustainability', 'local-art'] as const),
});

/** Posters of one era in one category. */
export function postersOfCategory(spec: PosterYearSpec, category: PosterCategory): readonly PosterSpec[] {
  return spec.posters.filter((poster) => poster.category === category);
}

/** Every category present in an era's set, in first-appearance order. */
export function categoriesOf(spec: PosterYearSpec): readonly PosterCategory[] {
  const seen: PosterCategory[] = [];
  for (const poster of spec.posters) {
    if (!seen.includes(poster.category)) seen.push(poster.category);
  }
  return seen;
}

/** Every mount style an era uses, in first-appearance order. */
export function mountsOf(spec: PosterYearSpec): readonly PosterMount[] {
  const seen: PosterMount[] = [];
  for (const poster of spec.posters) {
    if (!seen.includes(poster.mount)) seen.push(poster.mount);
  }
  return seen;
}

/* -------------------------------------------------------------------------- */
/* Self-checks                                                                */
/* -------------------------------------------------------------------------- */

/** Structural problems with one era's poster spec (empty array = sound). */
export function posterSpecProblems(spec: PosterYearSpec): readonly string[] {
  const problems: string[] = [];
  if (spec.posters.length < 6) {
    problems.push(`${spec.year}: expected at least six posters, got ${spec.posters.length}`);
  }
  const ids = new Set<string>();
  spec.posters.forEach((poster) => {
    if (poster.year !== spec.year) {
      problems.push(`${poster.id}: year ${poster.year} does not match its era spec ${spec.year}`);
    }
    if (ids.has(poster.id)) problems.push(`${poster.id}: duplicate poster id`);
    ids.add(poster.id);
    if (!(poster.size[0] > 0 && poster.size[1] > 0)) {
      problems.push(`${poster.id}: size must be positive`);
    }
    if (poster.wear < 0 || poster.wear > 1) problems.push(`${poster.id}: wear must be within 0..1`);
    if (poster.fade < 0 || poster.fade > 1) problems.push(`${poster.id}: fade must be within 0..1`);
    if (!(poster.layout in LAYOUT_PAINTERS)) problems.push(`${poster.id}: unknown layout ${poster.layout}`);
    if (!(poster.motif in MOTIF_PAINTERS)) problems.push(`${poster.id}: unknown motif ${poster.motif}`);
    if (!(poster.frame in FRAME_STYLES)) problems.push(`${poster.id}: unknown frame ${poster.frame}`);
    if (!FRAME_STYLES[poster.frame].mounts.includes(poster.mount)) {
      problems.push(`${poster.id}: frame ${poster.frame} cannot serve mount ${poster.mount}`);
    }
    if (poster.mount === 'framed' && poster.frame === 'none') {
      problems.push(`${poster.id}: a framed poster needs a frame finish`);
    }
    if (poster.mount !== 'framed' && poster.frame !== 'none' && FRAME_STYLES[poster.frame].rail > 0) {
      problems.push(`${poster.id}: a ${poster.mount} poster cannot carry a ${poster.frame} frame`);
    }
    if (poster.headline.trim().length === 0) problems.push(`${poster.id}: headline must not be empty`);
    if (poster.note.trim().length === 0) problems.push(`${poster.id}: every poster needs an era note`);
  });
  for (const category of REQUIRED_POSTER_CATEGORIES[spec.year]) {
    if (!spec.posters.some((poster) => poster.category === category)) {
      problems.push(`${spec.year}: no poster covers the ${category} category`);
    }
  }
  for (const mount of ['framed', 'pinned', 'taped', 'unframed'] as const) {
    if (!spec.posters.some((poster) => poster.mount === mount)) {
      problems.push(`${spec.year}: the set never uses the ${mount} mount`);
    }
  }
  for (const style of spec.styles) {
    if (!(style in FRAME_STYLES)) problems.push(`${spec.year}: unknown frame style ${style}`);
  }
  spec.posters.forEach((poster) => {
    if (!spec.styles.includes(poster.frame)) {
      problems.push(`${poster.id}: frame ${poster.frame} is not listed in ${spec.year}'s styles`);
    }
  });
  return problems;
}

/** Problems across every era (empty array = every era is sound). */
export function posterDatasetProblems(): readonly string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  for (const year of YEAR_IDS) {
    const spec = POSTER_SPECS[year];
    if (spec.year !== year) problems.push(`POSTER_SPECS['${year}'] describes ${spec.year}`);
    problems.push(...posterSpecProblems(spec));
    for (const poster of spec.posters) {
      if (seenIds.has(poster.id)) problems.push(`${poster.id}: poster id reused across eras`);
      seenIds.add(poster.id);
    }
  }
  problems.push(...eraConflicts());
  return problems;
}

/**
 * Checks that the five eras really are five distinct art programmes: two eras
 * sharing a category set, headline list, mount practice, frame set, typography
 * or printing recipe would make the wall look identical across the timeline.
 */
export function eraConflicts(): readonly string[] {
  const problems: string[] = [];
  const signatures = new Map<string, YearId>();
  for (const year of YEAR_IDS) {
    const spec = POSTER_SPECS[year];
    const signature = JSON.stringify({
      categories: [...categoriesOf(spec)].sort(),
      mounts: [...mountsOf(spec)].sort(),
      frames: [...new Set(spec.posters.map((poster) => poster.frame))].sort(),
      headlines: spec.posters.map((poster) => poster.headline),
      layouts: [...new Set(spec.posters.map((poster) => poster.layout))].sort(),
      typography: spec.typography,
      print: spec.print,
      paper: spec.posters[0]?.palette.paper ?? '',
    });
    const previous = signatures.get(signature);
    if (previous) {
      problems.push(`${year} shares its poster programme signature with ${previous}`);
    } else {
      signatures.set(signature, year);
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Inventory table                                                            */
/* -------------------------------------------------------------------------- */

/** One row of the flat inventory later verification tasks assert against. */
export interface PosterInventoryRow {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly summary: string;
  readonly paletteName: string;
  readonly wallColour: string;
  readonly posterCount: number;
  readonly categories: readonly PosterCategory[];
  readonly mounts: readonly PosterMount[];
  readonly frames: readonly FrameStyleId[];
  readonly hardware: readonly string[];
  readonly typography: readonly [PosterTypography['display'], PosterTypography['body']];
  readonly print: PosterPrintRecipe;
  readonly headlines: readonly string[];
  readonly layouts: readonly PosterLayoutId[];
  readonly motifs: readonly PosterMotifId[];
  /** `id -> note`, the text the overlay shows when a poster is selected. */
  readonly notes: Readonly<Record<string, string>>;
  /** True when every poster face, decal and fitting is procedurally painted. */
  readonly proceduralOnly: boolean;
}

function inventoryRow(spec: PosterYearSpec): PosterInventoryRow {
  const frames: FrameStyleId[] = [];
  const layouts: PosterLayoutId[] = [];
  const motifs: PosterMotifId[] = [];
  const notes: Record<string, string> = {};
  for (const poster of spec.posters) {
    if (!frames.includes(poster.frame)) frames.push(poster.frame);
    if (!layouts.includes(poster.layout)) layouts.push(poster.layout);
    if (!motifs.includes(poster.motif)) motifs.push(poster.motif);
    notes[poster.id] = poster.note;
  }
  return Object.freeze({
    year: spec.year,
    label: spec.label,
    name: spec.name,
    summary: spec.summary,
    paletteName: spec.paletteName,
    wallColour: spec.wallColour,
    posterCount: spec.posters.length,
    categories: Object.freeze(categoriesOf(spec)),
    mounts: Object.freeze(mountsOf(spec)),
    frames: Object.freeze(frames),
    hardware: Object.freeze([...spec.mounting.hardware]),
    typography: Object.freeze([spec.typography.display, spec.typography.body] as const),
    print: spec.print,
    headlines: Object.freeze(spec.posters.map((poster) => poster.headline)),
    layouts: Object.freeze(layouts),
    motifs: Object.freeze(motifs),
    notes: Object.freeze(notes),
    proceduralOnly: true,
  });
}

/** Flat per-era inventory of the café's wall artwork. */
export const POSTER_INVENTORY: Readonly<Record<YearId, PosterInventoryRow>> = Object.freeze({
  '1945': inventoryRow(SPEC_1945),
  '1965': inventoryRow(SPEC_1965),
  '1985': inventoryRow(SPEC_1985),
  '2005': inventoryRow(SPEC_2005),
  '2025': inventoryRow(SPEC_2025),
});

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

/** Compact description of one era's poster programme. */
export interface PosterYearSpecSummary {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly paletteName: string;
  readonly posterCount: number;
  readonly categories: readonly PosterCategory[];
  readonly mounts: readonly PosterMount[];
  readonly frames: readonly FrameStyleId[];
  readonly typography: readonly [PosterTypography['display'], PosterTypography['body']];
  readonly notes: readonly string[];
  readonly posters: readonly {
    readonly id: string;
    readonly title: string;
    readonly category: PosterCategory;
    readonly mount: PosterMount;
    readonly frame: FrameStyleId;
    readonly headline: string;
  }[];
}

/** Summarises one era for diagnostics, the HUD and the tests. */
export function describePosterSpec(spec: PosterYearSpec): PosterYearSpecSummary {
  return Object.freeze({
    year: spec.year,
    label: spec.label,
    name: spec.name,
    paletteName: spec.paletteName,
    posterCount: spec.posters.length,
    categories: Object.freeze(categoriesOf(spec)),
    mounts: Object.freeze(mountsOf(spec)),
    frames: Object.freeze([...new Set(spec.posters.map((poster) => poster.frame))]),
    typography: Object.freeze([spec.typography.display, spec.typography.body] as const),
    notes: Object.freeze([...spec.notes ?? []]),
    posters: Object.freeze(
      spec.posters.map((poster) =>
        Object.freeze({
          id: poster.id,
          title: poster.title,
          category: poster.category,
          mount: poster.mount,
          frame: poster.frame,
          headline: poster.headline,
        }),
      ),
    ),
  });
}
