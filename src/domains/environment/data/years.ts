/**
 * Era data for the café's interior architecture.
 *
 * One {@link EnvironmentSpec} per selectable year describes *every* surface the
 * environment domain owns: floor finish, wall treatment, wainscot profile,
 * ceiling type, paint and tile palettes, storefront glazing style, window
 * dressing, counter shell, back room doorway, the street sliver beyond the
 * glass and the exterior signage bracket — plus the colour temperature and the
 * wall/ceiling light-bounce colour the period lighting is tuned against.
 *
 * The specs are pure data: colours are CSS strings and every textured surface
 * names a procedural painter from `./textures`, so applying an era never
 * touches the network. {@link ENVIRONMENT_SPECS} is the map other domains (and
 * the period registry's diagnostics) read, keyed by {@link YearId}.
 *
 * Era reference (generated from {@link describeEnvironmentSpec}, asserted by
 * `EnvironmentModule.test.ts`; the wall/ceiling columns are the light-bounce
 * colours the period lighting is tuned against):
 *
 * | Year | Palette name | Material set | Window dressing | Wall / ceiling bounce |
 * | ---- | ------------ | ------------ | --------------- | --------------------- |
 * | 1945 | Ration cream and oxblood | `material-set:1945-distemper-and-linoleum` | Lace nets with a shallow pelmet | `#d9c3a0` / `#efe6d2` |
 * | 1965 | Formica turquoise and custard | `material-set:1965-formica-terrazzo-and-neon` | Striped venetian blinds two thirds down | `#e4d5b4` / `#f4efe0` |
 * | 1985 | Chrome, laminate and dusty rose | `material-set:1985-chrome-laminate-and-neon` | Half-raised blinds with a neon window sign | `#d6c8b4` / `#e7e2d8` |
 * | 2005 | Espresso brown and brushed steel | `material-set:2005-espresso-micro-cement-and-steel` | Frosted manifestation film with a printed logo band | `#cfc6b8` / `#dcd7cd` |
 * | 2025 | Limewash, oak and cool concrete | `material-set:2025-limewash-oak-and-brass` | Sheer linen scrim with a paper-cut vinyl decal | `#ded8cb` / `#cdcac3` |
 *
 * Floor finish, wainscot profile, ceiling type, glazing style, tile palette,
 * signage and colour temperature differ for every row as well; {@link eraConflicts}
 * reports any field two eras happen to share.
 */

import { YEAR_IDS, type DomainSpecBase, type YearId } from '../../../contracts/period';
import type { GridVariant, TextureKind, TexturePalette, TextureStyle } from '../textures';
import { SPEC_1945 } from './1945';
import { SPEC_1965 } from './1965';
import { SPEC_1985 } from './1985';
import { SPEC_2005 } from './2005';
import { SPEC_2025 } from './2025';

/* -------------------------------------------------------------------------- */
/* Surface vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/** One finished surface: how it is painted and how it shades light. */
export interface SurfaceFinish {
  /** Period description of the finish (shown by diagnostics and the overlay). */
  readonly finish: string;
  /** Procedural painter used for the surface map. */
  readonly texture: TextureKind;
  readonly palette: TexturePalette;
  /** UV repetition of the finished texture across the surface. */
  readonly repeat: readonly [number, number];
  /** Pattern repetitions inside one texture tile. */
  readonly scale: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly contrast?: number;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly variant?: GridVariant;
  readonly size?: number;
  readonly transparency?: 'none' | 'pattern';
}

/** Era paint palette: the colours the walls and trim were painted in. */
export interface PaintPalette {
  readonly name: string;
  readonly wallBase: string;
  readonly wallAccent: string;
  readonly trimBase: string;
  readonly trimAccent: string;
}

/** Era tile palette: the colours of the tiled surfaces (splashbacks, dados). */
export interface TilePalette {
  readonly name: string;
  readonly base: string;
  readonly accent: string;
  readonly grout: string;
}

/** How the ceiling is closed above the room. */
export type CeilingDetailKind =
  | 'cornice'
  | 'tile-grid'
  | 'acoustic-tracks'
  | 'exposed-services'
  | 'concrete-soffit';

/** Ceiling finish and the secondary structure hanging under it. */
export interface CeilingSpec {
  readonly type: string;
  readonly detail: CeilingDetailKind;
  readonly finish: SurfaceFinish;
  readonly corniceDepth: number;
  readonly detailColor: string;
  readonly detailMetalness: number;
  /** Emissive fixtures hung from the ceiling (pendants / battens). */
  readonly fixtureCount: number;
}

/** Wainscot run below the dado: profile, height and painted cap. */
export interface WainscotSpec {
  readonly profile: string;
  readonly height: number;
  readonly capHeight: number;
  readonly capDepth: number;
  /** Panel pitch; `0` lets the texture carry the pattern instead of geometry. */
  readonly panelWidth: number;
  /** Additional horizontal rails stacked on the run (steel kick rails, chair rails). */
  readonly railCount: number;
  readonly finish: SurfaceFinish;
  readonly capColor: string;
  readonly capMetalness: number;
}

/** Dressing family hung inside the storefront glazing. */
export type DressingKind =
  | 'lace-net'
  | 'venetian-blinds'
  | 'valance-and-blinds'
  | 'frost-film'
  | 'linen-scrim';

/** Period window dressing. */
export interface WindowDressingSpec {
  readonly id: string;
  readonly style: string;
  readonly kind: DressingKind;
  readonly texture: TextureKind;
  readonly palette: TexturePalette;
  /** Fraction of the glazing height the dressing covers, 0..1. */
  readonly coverage: number;
  /** Fraction of the bay width the dressing spans, 0..1. */
  readonly span: number;
  /** Slats drawn for the blind styles. */
  readonly slatCount: number;
  readonly repeat: readonly [number, number];
  readonly scale: number;
  readonly roughness: number;
  readonly opacity: number;
  /** Whether the storefront carries a fabric awning above the glazing. */
  readonly awning: boolean;
}

/** Storefront glazing construction. */
export interface GlazingSpec {
  readonly style: string;
  /** Vertical panes inside one bay. */
  readonly paneColumns: number;
  /** Horizontal panes inside one bay (2 means a transom light above). */
  readonly paneRows: number;
  readonly transom: boolean;
  readonly mullionWidth: number;
  readonly frameColor: string;
  readonly frameRoughness: number;
  readonly frameMetalness: number;
  readonly tint: string;
  readonly tintOpacity: number;
  readonly glassRoughness: number;
  readonly sillColor: string;
}

/** Exterior signage bracket construction. */
export type SignageArmStyle =
  | 'wrought-iron-scroll'
  | 'painted-steel-bracket'
  | 'chrome-arm'
  | 'steel-channel'
  | 'brass-rod';

export interface SignageSpec {
  readonly blade: string;
  readonly lettering: string;
  readonly bladeColor: string;
  readonly letteringColor: string;
  readonly rimColor: string;
  readonly lampColor: string;
  readonly lampIntensity: number;
  /** Whether the blade carries a light tube / backlight. */
  readonly illuminated: boolean;
  readonly armStyle: SignageArmStyle;
  readonly bladeHeight: number;
  /** How far the bracket projects from the facade, in metres. */
  readonly projection: number;
}

/** Service counter shell. */
export interface CounterSpec {
  readonly shell: string;
  readonly frontPanel: SurfaceFinish;
  readonly top: SurfaceFinish;
  readonly trimColor: string;
  readonly trimMetalness: number;
  readonly metalColor: string;
  readonly metalRoughness: number;
  readonly splashback: TilePalette;
  readonly backBar: string;
  /** How far the top slab overhangs the shell, in metres. */
  readonly topOverhang: number;
}

/** Back room doorway. */
export interface DoorwaySpec {
  readonly frameColor: string;
  readonly doorColor: string;
  readonly doorStyle: string;
  /** Opening angle of the leaf in radians (`0` = closed). */
  readonly openAngle: number;
  readonly thresholdColor: string;
  readonly glazed: boolean;
}

/** Street sliver visible through the storefront. */
export interface StreetSpec {
  readonly pavement: SurfaceFinish;
  readonly road: SurfaceFinish;
  readonly facade: SurfaceFinish;
  readonly kerbColor: string;
  readonly lampColor: string;
  readonly traffic: string;
}

/** Wall and ceiling light-bounce colours the period lighting is tuned against. */
export interface LightBounce {
  readonly wall: string;
  readonly ceiling: string;
  readonly note: string;
}

/** Summary of one era, used for diagnostics and the task evidence table. */
export interface EnvironmentSpecSummary {
  readonly year: YearId;
  readonly name: string;
  readonly paletteName: string;
  readonly materialSetId: string;
  readonly floorFinish: string;
  readonly wallTreatment: string;
  readonly wainscotProfile: string;
  readonly ceilingType: string;
  readonly tilePalette: string;
  readonly glazingStyle: string;
  readonly windowDressing: string;
  readonly signage: string;
  readonly bounceWall: string;
  readonly bounceCeiling: string;
  readonly colorTemperatureK: number;
}

/** Everything the environment domain knows about one era. */
export interface EnvironmentSpec extends DomainSpecBase {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly summary: string;
  /** Name of the era's surface palette, e.g. `'Ration cream and oxblood'`. */
  readonly paletteName: string;
  /** Identifier of the material set `applyPeriod` swaps in. */
  readonly materialSetId: string;
  readonly tags: readonly string[];
  readonly notes: readonly string[];
  readonly floor: SurfaceFinish;
  readonly wall: SurfaceFinish;
  readonly wainscot: WainscotSpec;
  readonly ceiling: CeilingSpec;
  readonly paint: PaintPalette;
  readonly tile: TilePalette;
  readonly glazing: GlazingSpec;
  readonly windowDressing: WindowDressingSpec;
  readonly signage: SignageSpec;
  readonly counter: CounterSpec;
  readonly doorway: DoorwaySpec;
  readonly street: StreetSpec;
  /** Accent used for trims, awnings and small props. */
  readonly accentColor: string;
  readonly colorTemperatureK: number;
  readonly lightBounce: LightBounce;
}

/* -------------------------------------------------------------------------- */
/* Spec map                                                                   */
/* -------------------------------------------------------------------------- */

const SOURCES: Readonly<Record<YearId, EnvironmentSpec>> = {
  '1945': SPEC_1945,
  '1965': SPEC_1965,
  '1985': SPEC_1985,
  '2005': SPEC_2005,
  '2025': SPEC_2025,
};

function buildSpecMap(): Readonly<Record<YearId, EnvironmentSpec>> {
  const map = {} as Record<YearId, EnvironmentSpec>;
  for (const year of YEAR_IDS) {
    const spec = SOURCES[year];
    if (!spec) throw new Error(`Missing environment spec for ${year}.`);
    if (spec.year !== year) {
      throw new Error(`Environment spec keyed ${year} declares year ${spec.year}.`);
    }
    map[year] = spec;
  }
  return Object.freeze(map);
}

/** Per-year environment specs, keyed by {@link YearId}. */
export const ENVIRONMENT_SPECS: Readonly<Record<YearId, EnvironmentSpec>> = buildSpecMap();

/** The five eras the environment domain has data for, in chronological order. */
export const ENVIRONMENT_SPEC_YEARS: readonly YearId[] = Object.freeze([...YEAR_IDS]);

/** Looks up an era spec, throwing for an unsupported year. */
export function environmentSpec(year: YearId): EnvironmentSpec {
  const spec = ENVIRONMENT_SPECS[year];
  if (!spec) throw new Error(`No environment spec for ${year}.`);
  return spec;
}

/** Every era spec, in chronological order. */
export function environmentSpecs(): readonly EnvironmentSpec[] {
  return ENVIRONMENT_SPEC_YEARS.map((year) => environmentSpec(year));
}

/* -------------------------------------------------------------------------- */
/* Texture style derivation                                                   */
/* -------------------------------------------------------------------------- */

/** Converts a surface finish into the procedural style that paints it. */
export function surfaceStyle(finish: SurfaceFinish, size?: number): TextureStyle {
  return {
    kind: finish.texture,
    palette: finish.palette,
    scale: finish.scale,
    contrast: finish.contrast,
    orientation: finish.orientation,
    variant: finish.variant,
    repeat: finish.repeat,
    size: size ?? finish.size,
    transparency: finish.transparency,
  };
}

/** Converts a window dressing into the procedural style that paints it. */
export function dressingStyle(dressing: WindowDressingSpec, size?: number): TextureStyle {
  return {
    kind: dressing.texture,
    palette: dressing.palette,
    scale: dressing.scale,
    contrast: 0.12,
    repeat: dressing.repeat,
    size,
    transparency: dressing.kind === 'lace-net' ? 'pattern' : 'none',
  };
}

/** Converts a ceiling's secondary structure into its procedural style. */
export function ceilingDetailStyle(ceiling: CeilingSpec, size?: number): TextureStyle {
  const finish = ceiling.finish;
  const palette: TexturePalette = {
    base: finish.palette.base,
    accent: finish.palette.accent,
    detail: ceiling.detailColor,
    highlight: finish.palette.highlight,
  };
  switch (ceiling.detail) {
    case 'tile-grid':
      return { kind: 'grid', palette, scale: 4, contrast: 0.14, variant: 'tiles', repeat: [4, 5], size };
    case 'acoustic-tracks':
      return { kind: 'grid', palette, scale: 3, contrast: 0.18, variant: 'panels', repeat: [4, 5], size };
    case 'exposed-services':
      return { kind: 'plain', palette, scale: 2, contrast: 0.3, repeat: [3, 4], size };
    case 'concrete-soffit':
      return { kind: 'speckle', palette, scale: 2, contrast: 0.34, repeat: [3, 3], size };
    case 'cornice':
    default:
      return { kind: 'plain', palette, scale: 2, contrast: 0.08, repeat: [2, 3], size };
  }
}

/** The stock of colours a ceiling fixture / street lamp glows in. */
export function signagePalette(spec: EnvironmentSpec): TexturePalette {
  return {
    base: spec.signage.bladeColor,
    accent: spec.signage.letteringColor,
    detail: spec.signage.rimColor,
    highlight: spec.signage.lampColor,
  };
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

/** Flattens an era spec into the summary used by diagnostics and the tests. */
export function describeEnvironmentSpec(spec: EnvironmentSpec): EnvironmentSpecSummary {
  return {
    year: spec.year,
    name: spec.name,
    paletteName: spec.paletteName,
    materialSetId: spec.materialSetId,
    floorFinish: spec.floor.finish,
    wallTreatment: spec.wall.finish,
    wainscotProfile: spec.wainscot.profile,
    ceilingType: spec.ceiling.type,
    tilePalette: spec.tile.name,
    glazingStyle: spec.glazing.style,
    windowDressing: spec.windowDressing.id,
    signage: `${spec.signage.blade} — “${spec.signage.lettering}”`,
    bounceWall: spec.lightBounce.wall,
    bounceCeiling: spec.lightBounce.ceiling,
    colorTemperatureK: spec.colorTemperatureK,
  };
}

/** Fields that must differ between eras for the timeline to be visible. */
export const ERA_DISCRIMINATOR_FIELDS = Object.freeze([
  'paletteName',
  'materialSetId',
  'floorFinish',
  'wallTreatment',
  'wainscotProfile',
  'ceilingType',
  'tilePalette',
  'glazingStyle',
  'windowDressing',
  'signage',
  'bounceWall',
  'bounceCeiling',
  'colorTemperatureK',
] as const satisfies readonly (keyof EnvironmentSpecSummary)[]);

/**
 * Returns the discriminator fields that share a value across two eras. An empty
 * array means the two eras are visually distinct on every listed field.
 */
export function eraConflicts(
  a: EnvironmentSpecSummary,
  b: EnvironmentSpecSummary,
): readonly (keyof EnvironmentSpecSummary)[] {
  return ERA_DISCRIMINATOR_FIELDS.filter((field) => a[field] === b[field]);
}
