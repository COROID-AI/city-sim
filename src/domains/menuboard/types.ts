/**
 * Menu board vocabulary — period menu data, period currency and the procedural
 * draw-run set the board face is painted from.
 *
 * Everything here is plain data and tiny pure guards, so the era specs in
 * `./data`, the lettering engine in `./lettering`, the geometry planner in
 * `./boardGeometry` and the scene module all share one vocabulary without
 * importing three.js or the DOM:
 *
 *  - {@link MenuSectionId} / {@link MenuLineItem} — the menu itself: era
 *    appropriate drinks and food with a price in the era's own currency.
 *  - {@link CurrencyId} / {@link CurrencySpec} / {@link menuPrice} — period
 *    money. 1945 and 1965 are pre-decimal (twelve pence to the shilling, written
 *    `6d`, `1/3` or `2/6`), 1985 onwards uses decimal sterling (`45p`, `£1.05`).
 *    {@link MenuPrice.pence} normalises every price to decimal pence so
 *    verification can compare eras without parsing money.
 *  - {@link MenuBoardKind} / {@link LetteringStyle} — the board *form* and the
 *    period lettering technique each era uses.
 *  - {@link BoardDrawRun} and friends — the output of the procedural lettering
 *    layout: chalk strokes, chalk smudges, applied vinyl letters, fluorescent
 *    letter-board tiles, the 1985 promo strip, backlit acrylic sections,
 *    rotating digital panel entries, price rules and era wear.
 *
 * Draw runs use *face space*: an origin-at-bottom-left coordinate system measured
 * in board heights, where `x` runs from `0` to the board's aspect ratio
 * (`width / height`) and `y` runs from `0` to `1`. Measuring both axes in the
 * same unit keeps glyphs from being stretched on wide boards, and one run set
 * serves every texture resolution and every board size without a second layout
 * pass.
 */

import type { DomainSpecBase, YearId } from '../../contracts/period';

/* -------------------------------------------------------------------------- */
/* Menu sections                                                              */
/* -------------------------------------------------------------------------- */

/** The four parts every era's menu is organised in. */
export type MenuSectionId = 'hot-drinks' | 'cold-drinks' | 'savoury' | 'sweet';

/** One heading on the board, grouping drinks or food. */
export interface MenuSection {
  readonly id: MenuSectionId;
  readonly label: string;
  /** Era note printed under the heading (`'Served all day'`). */
  readonly note?: string;
}

/* -------------------------------------------------------------------------- */
/* Period money                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Money used on the board. `gbp-predecimal` is sterling before decimalisation
 * (1945, 1965); `gbp-decimal` is sterling from 1971 on (1985, 2005, 2025).
 */
export type CurrencyId = 'gbp-predecimal' | 'gbp-decimal';

/** How an era writes money, and what its writing must look like. */
export interface CurrencySpec {
  readonly id: CurrencyId;
  readonly name: string;
  /** Currency symbol, empty for pre-decimal boards that write `1/3`. */
  readonly symbol: string;
  /** Subunit suffix (`'d'` for pre-decimal pence, `'p'` for decimal pence). */
  readonly subunit: string;
  /** True once the currency is decimal (100 subunits to the pound). */
  readonly decimal: boolean;
  /** Every display price of this currency must match this pattern. */
  readonly pattern: RegExp;
  readonly note: string;
}

/** The two period currencies, with the format rule each board obeys. */
export const CURRENCIES: Readonly<Record<CurrencyId, CurrencySpec>> = Object.freeze({
  'gbp-predecimal': Object.freeze({
    id: 'gbp-predecimal' as const,
    name: 'Sterling, pre-decimal',
    symbol: '',
    subunit: 'd',
    decimal: false,
    pattern: /^(?:\d+d|\d+\/\d+|\d+\/-)$/,
    note: 'Twelve pence to the shilling: a price reads 6d, 1/3 or 2/6.',
  }),
  'gbp-decimal': Object.freeze({
    id: 'gbp-decimal' as const,
    name: 'Sterling, decimal',
    symbol: '£',
    subunit: 'p',
    decimal: true,
    pattern: /^(?:\d+p|£\d+\.\d{2})$/,
    note: 'One hundred pence to the pound: a price reads 45p or £1.05.',
  }),
});

/** Looks up a currency by id. */
export function currencySpec(id: CurrencyId): CurrencySpec {
  return CURRENCIES[id];
}

/** True when `display` is written the way `currency` writes money. */
export function isPeriodPrice(currency: CurrencyId, display: string): boolean {
  return currencySpec(currency).pattern.test(display.trim());
}

/**
 * One price on the board: exactly as it is lettered, plus the same amount
 * normalised to decimal pence so prices can be compared across the decades
 * (1945 `1/3` = 15, 1985 `45p` = 45, 2025 `£3.60` = 360).
 */
export interface MenuPrice {
  readonly currency: CurrencyId;
  /** Price exactly as it is painted or set on the board (`'1/3'`, `'£3.60'`). */
  readonly display: string;
  /** Decimal pence, the cross-era comparable amount. */
  readonly pence: number;
}

/**
 * Parses a display price into a {@link MenuPrice}, deriving both the period
 * currency and the comparable pence amount. Throws for text that is not a
 * period price, so a typo in an era spec fails loudly instead of silently
 * producing a `NaN` on the board.
 */
export function menuPrice(display: string): MenuPrice {
  const text = display.trim();
  if (/^\d+d$/.test(text)) {
    return { currency: 'gbp-predecimal', display: text, pence: Number.parseInt(text, 10) };
  }
  const solidus = /^(\d+)\/(\d+)$/.exec(text);
  if (solidus) {
    return {
      currency: 'gbp-predecimal',
      display: text,
      pence: Number.parseInt(solidus[1] ?? '0', 10) * 12 + Number.parseInt(solidus[2] ?? '0', 10),
    };
  }
  if (/^\d+\/-$/.test(text)) {
    return { currency: 'gbp-predecimal', display: text, pence: Number.parseInt(text, 10) * 12 };
  }
  if (/^\d+p$/.test(text)) {
    return { currency: 'gbp-decimal', display: text, pence: Number.parseInt(text, 10) };
  }
  const pounds = /^£(\d+)\.(\d{2})$/.exec(text);
  if (pounds) {
    return {
      currency: 'gbp-decimal',
      display: text,
      pence: Number.parseInt(pounds[1] ?? '0', 10) * 100 + Number.parseInt(pounds[2] ?? '0', 10),
    };
  }
  throw new TypeError(
    `"${display}" is not a period price. Expected "6d", "1/3", "2/-", "45p" or "£1.05".`,
  );
}

/** A wartime stand-in: what the kitchen offers instead, and at what price. */
export interface MenuSubstitute {
  readonly name: string;
  readonly price: MenuPrice;
  readonly note: string;
}

/** One line of the menu: what it is, what it costs and how the era annotates it. */
export interface MenuLineItem {
  readonly id: string;
  readonly section: MenuSectionId;
  readonly name: string;
  readonly description: string;
  readonly price: MenuPrice;
  /** Availability or preparation detail lettered under the line. */
  readonly note?: string;
  /** Era substitute with its own price (1945 rationing). */
  readonly substitute?: MenuSubstitute;
  readonly tags?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Board form                                                                 */
/* -------------------------------------------------------------------------- */

/** The five board forms, one per era. */
export type MenuBoardKind =
  | 'chalk-slate'
  | 'painted-vinyl'
  | 'fluorescent-letterboard'
  | 'backlit-acrylic'
  | 'digital-screen';

/** The lettering technique the era's board is set in. */
export type LetteringStyle =
  | 'hand-chalk'
  | 'applied-vinyl'
  | 'fluorescent-tiles'
  | 'backlit-print'
  | 'emissive-digital';

/** How prominently a panel is treated. */
export type BoardPanelEmphasis = 'standard' | 'feature' | 'promo';

/**
 * One panel of the board: a column of the menu (1985 letter board, 2005 acrylic
 * panel, 2025 rotating screen panel) or a chalked column (1945, 1965).
 */
export interface MenuPanelSpec {
  readonly id: string;
  readonly title: string;
  readonly sectionIds: readonly MenuSectionId[];
  readonly emphasis?: BoardPanelEmphasis;
  /** Seconds this panel stays up before the screen rotates (2025 only). */
  readonly rotationSeconds?: number;
}

/** The era's promotion: the 1985 promo strip, or the 2025 rotating feature panel. */
export interface MenuPromo {
  readonly id: string;
  readonly headline: string;
  readonly detail: string;
  readonly price?: MenuPrice;
  /** Short badge printed on the promo band (`'TODAY'`). */
  readonly badge?: string;
  /** Two stripe colours for the promo band. */
  readonly stripes?: readonly [string, string];
}

/** Colours and surface response of the era's board. */
export interface BoardSurfaceSpec {
  /** Board face colour (slate, painted panel, letter-board felt, acrylic, glass). */
  readonly face: string;
  /** Secondary face colour for frames and panel borders. */
  readonly faceAccent: string;
  /** Shadowed face colour for recesses and tile holes. */
  readonly faceShadow: string;
  /** Lettering colour (chalk, vinyl, tile, print, emissive). */
  readonly ink: string;
  /** Secondary lettering colour for prices and headings. */
  readonly inkAccent: string;
  /** Frame / carcass colour. */
  readonly frame: string;
  /** Metal trim applied on top of the frame. */
  readonly trim: string;
  /** Emissive colour of the era's light source. */
  readonly glow: string;
  readonly roughness: number;
  readonly metalness: number;
  /** How worn the era's board is, `0..1`. */
  readonly wear: number;
}

/** One era's menu board: the form, the menu, the money and the wear. */
export interface MenuBoardSpec extends DomainSpecBase {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly summary: string;
  readonly boardKind: MenuBoardKind;
  /** Display name of the board form (`'Hand-chalked slate'`). */
  readonly boardName: string;
  /** Painted or set heading at the top of the board. */
  readonly heading: string;
  readonly subheading: string;
  readonly currency: CurrencyId;
  readonly sections: readonly MenuSection[];
  readonly panels: readonly MenuPanelSpec[];
  readonly items: readonly MenuLineItem[];
  readonly promo?: MenuPromo;
  /** Small print along the foot of the board. */
  readonly boardNote: string;
  readonly lettering: LetteringStyle;
  readonly surface: BoardSurfaceSpec;
  /** Item used to compare prices across the decades. */
  readonly benchmarkItemId: string;
  readonly tags: readonly string[];
  readonly notes: readonly string[];
}

/** Digest of an era spec for overlays and diagnostics. */
export interface MenuBoardSpecSummary {
  readonly year: YearId;
  readonly boardKind: MenuBoardKind;
  readonly boardName: string;
  readonly lettering: LetteringStyle;
  readonly currency: CurrencyId;
  readonly currencyName: string;
  readonly heading: string;
  readonly itemCount: number;
  readonly sectionCount: number;
  readonly panelCount: number;
  readonly wantsPromo: boolean;
  readonly rotates: boolean;
  readonly benchmarkPrice: string;
  readonly benchmarkPence: number;
}

/** Flat menu row later verification work can assert against without reading specs. */
export interface MenuBoardInventoryEntry {
  readonly year: YearId;
  readonly boardKind: MenuBoardKind;
  readonly itemId: string;
  readonly name: string;
  readonly section: MenuSectionId;
  readonly price: string;
  readonly pence: number;
  readonly substitute: string | null;
  readonly substitutePence: number | null;
}

/* -------------------------------------------------------------------------- */
/* Face space                                                                 */
/* -------------------------------------------------------------------------- */

/** A point in face space: `x` in `0..aspect`, `y` in `0..1` (board heights). */
export interface FacePoint {
  readonly x: number;
  readonly y: number;
}

/** An axis aligned rectangle in face space (board heights). */
export interface FaceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Horizontal alignment of a run of lettering about {@link MenuTextLine.x}. */
export type FaceAlign = 'left' | 'center' | 'right';

/** What a line of lettering is for, which decides its size and colour. */
export type MenuTextKind = 'heading' | 'subheading' | 'section' | 'item' | 'price' | 'note' | 'promo' | 'substitute' | 'footer';

/** How a line of lettering is executed on the era's board. */
export type TextTone = 'chalk' | 'vinyl' | 'tile' | 'print' | 'emissive' | 'promo';

/** One line of lettering on the board face, in face space. */
export interface MenuTextLine {
  readonly id: string;
  readonly text: string;
  readonly tone: TextTone;
  readonly kind: MenuTextKind;
  /** Cap height in face units. */
  readonly size: number;
  /** Baseline anchor: left, centre or right end, according to `align`. */
  readonly x: number;
  /** Baseline height in face space. */
  readonly y: number;
  readonly align: FaceAlign;
  /** Extra letter spacing, as a multiple of cap height. */
  readonly tracking: number;
  /** Stroke width, as a multiple of cap height. */
  readonly weight: number;
  readonly opacity: number;
  /** Menu line this text belongs to, when it lettering an item. */
  readonly itemId?: string;
  readonly panelId?: string;
  /** True for the substitute-price annotation (1945 rationing). */
  readonly substitute: boolean;
}

/* -------------------------------------------------------------------------- */
/* Draw runs                                                                  */
/* -------------------------------------------------------------------------- */

/** Every kind of mark the procedural layout can emit. */
export type BoardRunKind =
  | 'chalk-stroke'
  | 'chalk-smudge'
  | 'vinyl-letter'
  | 'fluorescent-tile'
  | 'promo-strip'
  | 'backlit-panel'
  | 'digital-panel'
  | 'menu-rule'
  | 'wear';

/** Surface damage the layout records so the painter can age the board. */
export type WearKind =
  | 'chalk-dust'
  | 'chalk-ghost'
  | 'coffee-ring'
  | 'paint-loss'
  | 'sun-bleach'
  | 'missing-tile'
  | 'dead-led'
  | 'screen-ghost';

/** One hand-chalk stroke: a single movement of the chalk. */
export interface ChalkStrokeRun {
  readonly kind: 'chalk-stroke';
  readonly id: string;
  readonly lineId: string;
  readonly char: string;
  readonly charIndex: number;
  readonly strokeIndex: number;
  readonly points: readonly FacePoint[];
  readonly weight: number;
  /** Hand wobble applied to the stroke, in face units. */
  readonly wobble: number;
  readonly opacity: number;
}

/** A smudged or dragged area of chalk, from a sleeve, cloth or wet thumb. */
export interface ChalkSmudgeRun {
  readonly kind: 'chalk-smudge';
  readonly id: string;
  readonly center: FacePoint;
  readonly radiusX: number;
  readonly radiusY: number;
  /** Rotation of the smudge, in radians. */
  readonly angle: number;
  readonly strength: number;
  /** Directional drag applied to the smudge, in face units. */
  readonly drag: number;
}

/** One letter of applied vinyl, set by hand at the sign shop. */
export interface VinylLetterRun {
  readonly kind: 'vinyl-letter';
  readonly id: string;
  readonly lineId: string;
  readonly char: string;
  readonly charIndex: number;
  /** Centre of the letter's em box. */
  readonly center: FacePoint;
  readonly size: number;
  /** Rotation of the applied letter, in radians (hand-set imperfection). */
  readonly rotation: number;
  readonly tracking: number;
  /** Paint bleed around the letter's edge, in face units. */
  readonly bleed: number;
  /** Drop shadow offset, in face units. */
  readonly shadow: number;
  readonly opacity: number;
}

/** One fluorescent character tile pushed into the letter board's rails. */
export interface FluorescentTileRun {
  readonly kind: 'fluorescent-tile';
  readonly id: string;
  readonly lineId: string;
  readonly char: string;
  readonly charIndex: number;
  /** Centre of the tile. */
  readonly center: FacePoint;
  readonly size: number;
  /** Tile brightness, `0..1`. */
  readonly glow: number;
  /** Rail row and grid column the tile sits in. */
  readonly row: number;
  readonly column: number;
  /** True when the tile has fallen out of the board and left a hole. */
  readonly missing: boolean;
}

/** The 1985 promo strip running along the foot of the letter board. */
export interface PromoStripRun {
  readonly kind: 'promo-strip';
  readonly id: string;
  readonly bounds: FaceRect;
  readonly headline: string;
  readonly badge: string | null;
  readonly stripes: readonly [string, string];
  readonly lines: readonly MenuTextLine[];
  /** Emissive strength of the strip, `0..1`. */
  readonly glow: number;
}

/** One backlit acrylic panel of the 2005 board. */
export interface BacklitPanelRun {
  readonly kind: 'backlit-panel';
  readonly id: string;
  readonly panelId: string;
  readonly index: number;
  readonly title: string;
  readonly emphasis: BoardPanelEmphasis;
  readonly bounds: FaceRect;
  readonly lines: readonly MenuTextLine[];
  readonly itemIds: readonly string[];
  /** Even backlight strength across the panel, `0..1`. */
  readonly glow: number;
  /** Acrylic sheen gradient strength, `0..1`. */
  readonly sheen: number;
}

/** One rotating panel of the 2025 digital screen. */
export interface DigitalPanelRun {
  readonly kind: 'digital-panel';
  readonly id: string;
  readonly panelId: string;
  readonly index: number;
  readonly title: string;
  readonly emphasis: BoardPanelEmphasis;
  readonly bounds: FaceRect;
  readonly lines: readonly MenuTextLine[];
  readonly itemIds: readonly string[];
  /** Rotation phase in `[0, 1)`: where the panel is in its cycle. */
  readonly phase: number;
  /** Seconds the panel stays up before the screen rotates. */
  readonly rotationSeconds: number;
  /** Panel luminance, `0..1`. */
  readonly luminance: number;
  /** Scan line count drawn over the panel. */
  readonly scanlines: number;
}

/** A leader or section rule, chalked, painted or printed under a price. */
export interface MenuRuleRun {
  readonly kind: 'menu-rule';
  readonly id: string;
  readonly from: FacePoint;
  readonly to: FacePoint;
  readonly weight: number;
  readonly tone: TextTone;
  readonly dotted: boolean;
  readonly opacity: number;
}

/** Era wear and damage recorded on the face. */
export interface WearRun {
  readonly kind: 'wear';
  readonly id: string;
  readonly wear: WearKind;
  readonly center: FacePoint;
  readonly radius: number;
  readonly angle: number;
  readonly strength: number;
  /** Optional area the wear covers (paint loss, sun bleach, ghost frames). */
  readonly bounds?: FaceRect;
}

/** Every mark the procedural layout emits for one era's board. */
export type BoardDrawRun =
  | ChalkStrokeRun
  | ChalkSmudgeRun
  | VinylLetterRun
  | FluorescentTileRun
  | PromoStripRun
  | BacklitPanelRun
  | DigitalPanelRun
  | MenuRuleRun
  | WearRun;

/** Narrow `runs` to one run kind, with the type narrowed for the caller. */
export function runsOfKind<K extends BoardRunKind>(
  runs: readonly BoardDrawRun[],
  kind: K,
): readonly Extract<BoardDrawRun, { readonly kind: K }>[] {
  return runs.filter(
    (run): run is Extract<BoardDrawRun, { readonly kind: K }> => run.kind === kind,
  );
}

/* -------------------------------------------------------------------------- */
/* Board form and placement                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The physical form of one era's board, in metres. Forms differ per era on
 * purpose: a 1945 slate is a small portrait slab with a chalk ledge, the 1985
 * letter board is a deep light box carrying a promo strip, the 2025 screen is a
 * wide bezelled panel split into rotating sections.
 */
export interface BoardForm {
  readonly kind: MenuBoardKind;
  readonly name: string;
  /** Face width along the wall, in metres. */
  readonly width: number;
  /** Face height, in metres. */
  readonly height: number;
  /** How far the board stands proud of the wall, in metres. */
  readonly depth: number;
  /** Thickness of the board carcass, in metres. */
  readonly thickness: number;
  /** Width of the frame / bezel, in metres; `0` for a frameless panel. */
  readonly frameWidth: number;
  /** Number of menu columns the form is divided into. */
  readonly panelCount: number;
  /** Slight forward tilt of the board, in radians. */
  readonly tilt: number;
  /** True when the form carries the era's glowing promo band. */
  readonly hasPromoStrip: boolean;
  /** True for the deep light box that fluoresces from behind the letters. */
  readonly hasLightBox: boolean;
  /** True when the letters are lit from behind (1985, 2005, 2025). */
  readonly backlit: boolean;
  /** True when part of the face emits its own light. */
  readonly emissive: boolean;
  /** True for the chalk ledge under the slate. */
  readonly hasChalkLedge: boolean;
  /** True when the face is stone rather than a manufactured panel. */
  readonly stone: boolean;
}

/** Where the board hangs: the shell's menu mount, or the counter wall. */
export type BoardAnchorSource = 'wall-mount' | 'counter-wall';

/** The wall surface the board is derived from, plus the room it must fit in. */
export interface BoardAnchor {
  /** Wall mount id the anchor came from, or `'counter-wall'` for the fallback. */
  readonly id: string;
  readonly source: BoardAnchorSource;
  readonly wall: 'back' | 'front' | 'left' | 'right';
  /** Centre of the anchor on the wall plane, in world space. */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** Inward wall normal (points into the room). */
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  /** Rotation about Y that turns a `+Z` facing board into the wall's inward normal. */
  readonly rotationY: number;
  /** Largest board the anchor can carry, in metres. */
  readonly capacity: { readonly width: number; readonly height: number };
}

/** Axis aligned world box, in metres. */
export interface BoardBox {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

/** Where one era's board hangs and how big it is, derived from an anchor. */
export interface BoardPlacement {
  readonly anchorId: string;
  readonly source: BoardAnchorSource;
  readonly wall: 'back' | 'front' | 'left' | 'right';
  /** Centre of the board face, in world space. */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotationY: number;
  readonly tilt: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Board carcass plus anything it carries. */
  readonly box: BoardBox;
  readonly form: BoardForm;
}

/** What a structural member of the board is for. */
export type BoardMemberRole =
  | 'slab'
  | 'frame-bar'
  | 'backing'
  | 'chalk-ledge'
  | 'bracket'
  | 'light-box'
  | 'panel'
  | 'grid-rail'
  | 'bezel'
  | 'standoff'
  | 'header-plate'
  | 'promo-band'
  | 'screen-glass';

/** Material slot a member is built from. */
export type BoardMaterialRole =
  | 'face'
  | 'frame'
  | 'trim'
  | 'metal'
  | 'glass'
  | 'emissive'
  | 'felt'
  | 'stone';

/**
 * One member of the board carcass, in face space. The module scales `rect` onto
 * the board's metre size and extrudes it by `depth`, so the same decomposition
 * builds a slate slab, a light box or a bezelled screen.
 */
export interface BoardMember {
  readonly id: string;
  readonly role: BoardMemberRole;
  readonly material: BoardMaterialRole;
  readonly rect: FaceRect;
  /** Extrusion / offset from the face plane, in metres. */
  readonly depth: number;
  /** Distance of the member's face from the wall, in metres. */
  readonly offset: number;
  readonly details: string;
}

/** One addressable region of the board face (menu column or promo band). */
export interface PanelRegion {
  readonly id: string;
  readonly panelId: string;
  readonly index: number;
  readonly title: string;
  readonly emphasis: BoardPanelEmphasis;
  readonly kind: 'column' | 'backlit-panel' | 'digital-panel' | 'promo-strip';
  readonly rect: FaceRect;
  readonly itemIds: readonly string[];
  readonly rotationSeconds: number;
}
