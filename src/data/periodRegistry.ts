/**
 * Period registry — the single shared source of era truth for the café
 * timelapse.
 *
 * Ten detail domains (room shell, furniture, brewing machines, menu board,
 * posters, tableware, signage and lighting, counter technology, patrons and
 * music) each own a per-year spec map keyed by {@link YearId} plus a
 * {@link SceneModule} factory. This module is the one place that aggregates
 * them: it imports each domain's spec map and factory, proves at *assembly
 * time* that every domain supplies all five eras (1945, 1965, 1985, 2005 and
 * 2025), and exposes a resolved {@link EraDefinition} per {@link YearId}.
 *
 * The registry is deliberately thin about era content:
 *
 *  - the detailed per-era data stays in the owning domain modules — the
 *    registry never re-authors it, it only references the imported spec maps,
 *  - `PeriodDefinition` prose/palette/lighting is *derived* from the
 *    environment domain's era spec (the room owner holds the finishes, bounce
 *    colours and signage lamp colour) and the music domain's programme set,
 *  - `roomDefaults` are geometry facts derived from the environment shell's
 *    {@link CAFE_ROOM_BOUNDS}, not hand-written era content.
 *
 * Importing this module is side-effect free: it builds frozen plain-data
 * records only. It creates no renderer, no `AudioContext`, no timers and no
 * DOM listeners, so the composition root decides when modules are created.
 * Consumers that want instances use {@link createEraModules}; consumers that
 * only need definitions use {@link resolvePeriod} / {@link PERIOD_REGISTRY}.
 */

import {
  YEAR_IDS,
  type DomainSpecBase,
  type PeriodDefinition,
  type RoomBounds,
  type SceneModule,
  type YearId,
} from '../contracts/period';
import {
  CAFE_ROOM_BOUNDS,
  ENVIRONMENT_MODULE_ID,
  ENVIRONMENT_SPECS,
  createEnvironmentModule,
  environmentSpec,
} from '../domains/environment/EnvironmentModule';
import type { StructuralLayout } from '../domains/environment/roomBounds';
import {
  FURNITURE_MODULE_ID,
  FURNITURE_SPECS,
  createFurnitureModule,
} from '../domains/furniture/FurnitureModule';
import {
  BREWING_MODULE_ID,
  BREWING_SPECS,
  createBrewingModule,
} from '../domains/machines/BrewingModule';
import {
  MENU_BOARD_MODULE_ID,
  MENU_BOARD_SPECS,
  createMenuBoardModule,
} from '../domains/menuboard/MenuBoardModule';
import {
  POSTER_MODULE_ID,
  POSTER_SPECS,
  createPosterModule,
} from '../domains/posters/PosterModule';
import {
  TABLEWARE_MODULE_ID,
  TABLEWARE_SPECS,
  createTablewareModule,
} from '../domains/tableware/TablewareModule';
import {
  SIGNAGE_LIGHTING_MODULE_ID,
  SIGNAGE_LIGHTING_SPECS,
  createSignageLightingModule,
} from '../domains/signage/SignageLightingModule';
import {
  COUNTER_TECH_MODULE_ID,
  COUNTER_TECH_SPECS,
  createCounterTechModule,
} from '../domains/counter/CounterTechModule';
import {
  PATRON_MODULE_ID,
  PATRON_SPECS,
  createPatronModule,
} from '../domains/patrons/PatronModule';
import {
  MUSIC_MODULE_ID,
  MUSIC_SOURCE_SPECS,
  createMusicSourceModule,
  eraMusicMix,
  musicProgram,
} from '../domains/music/MusicSourceModule';

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Stable identifier of the registry module, used by diagnostics and by the
 * composition root when it reports which era source it bound.
 */
export const PERIOD_REGISTRY_ID = 'cafe-period-registry';

/**
 * Outline shared interface this module publishes (`cafe-period-registry`).
 *
 * Later consumers (the transition engine, the composition root) resolve eras
 * through this module without reaching into a domain module directly; the
 * constant names that contract so it can be asserted at the seam.
 */
export const PERIOD_REGISTRY_INTERFACE = 'cafe-period-registry';

/* -------------------------------------------------------------------------- */
/* Domains                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The ten period detail domains aggregated by the registry, in composition
 * order (the room shell first, so later domains can anchor to it).
 *
 * Ids match each domain module's own `SceneModule.id`, so a registration's id
 * doubles as its registry key and hotspot owner id.
 */
export const DOMAIN_IDS = [
  'environment',
  'furniture',
  'machines',
  'menuboard',
  'posters',
  'tableware',
  'signage-lighting',
  'counter',
  'patrons',
  'music',
] as const;

/** Identifier of one aggregated detail domain. */
export type DomainId = (typeof DOMAIN_IDS)[number];

/**
 * The common slice of options every domain factory accepts. It is intentionally
 * narrow: the registry only forwards the room geometry, the structural anchors
 * and the deterministic seed, leaving platform services (audio, canvas) to the
 * composition root.
 */
export interface DomainModuleOptions {
  /** Interior volume the module lays its objects out in. */
  readonly bounds?: RoomBounds;
  /** Structural anchor set published by the environment shell. */
  readonly layout?: StructuralLayout;
  /** Seed of the module's deterministic placement/variation source. */
  readonly seed?: number;
  /** Era the module reports before its first build (used by `getHotspots`). */
  readonly initialYear?: YearId;
}

/**
 * One aggregated domain: its registry id, its module identity, the imported
 * per-year spec map and the factory the composition root instantiates.
 */
export interface DomainRegistration<TSpec extends DomainSpecBase = DomainSpecBase> {
  /** Registry key / module id of the domain. */
  readonly id: DomainId;
  /** Human readable name, used by diagnostics and the registry artifact. */
  readonly label: string;
  /** `SceneModule.id` the factory stamps on its instances. */
  readonly moduleId: string;
  /** The domain's per-year era data, keyed by {@link YearId}. */
  readonly specs: Readonly<Record<YearId, TSpec>>;
  /** Factory creating one era's instance of the domain module. */
  readonly createModule: (options?: DomainModuleOptions) => SceneModule<TSpec>;
}

/**
 * The ten domain registrations, exactly one per {@link DomainId}. Every entry
 * points at the owning module's *exported* factory and spec map — no data is
 * copied or transformed here.
 */
export const DOMAIN_REGISTRATIONS: readonly DomainRegistration[] = Object.freeze([
  {
    id: 'environment',
    label: 'Room shell, finishes and storefront',
    moduleId: ENVIRONMENT_MODULE_ID,
    specs: ENVIRONMENT_SPECS,
    createModule: createEnvironmentModule,
  },
  {
    id: 'furniture',
    label: 'Furniture, seating, counters and soft decor',
    moduleId: FURNITURE_MODULE_ID,
    specs: FURNITURE_SPECS,
    createModule: createFurnitureModule,
  },
  {
    id: 'machines',
    label: 'Coffee machines and brewing equipment',
    moduleId: BREWING_MODULE_ID,
    specs: BREWING_SPECS,
    createModule: createBrewingModule,
  },
  {
    id: 'menuboard',
    label: 'Menu board surfaces, typography and prices',
    moduleId: MENU_BOARD_MODULE_ID,
    specs: MENU_BOARD_SPECS,
    createModule: createMenuBoardModule,
  },
  {
    id: 'posters',
    label: 'Wall posters and advertising artwork',
    moduleId: POSTER_MODULE_ID,
    specs: POSTER_SPECS,
    createModule: createPosterModule,
  },
  {
    id: 'tableware',
    label: 'Tableware and service-ware',
    moduleId: TABLEWARE_MODULE_ID,
    specs: TABLEWARE_SPECS,
    createModule: createTablewareModule,
  },
  {
    id: 'signage-lighting',
    label: 'Signage, lamps and era lighting',
    moduleId: SIGNAGE_LIGHTING_MODULE_ID,
    specs: SIGNAGE_LIGHTING_SPECS,
    createModule: createSignageLightingModule,
  },
  {
    id: 'counter',
    label: 'Counter technology and payment',
    moduleId: COUNTER_TECH_MODULE_ID,
    specs: COUNTER_TECH_SPECS,
    createModule: createCounterTechModule,
  },
  {
    id: 'patrons',
    label: 'Barista and patron figures',
    moduleId: PATRON_MODULE_ID,
    specs: PATRON_SPECS,
    createModule: createPatronModule,
  },
  {
    id: 'music',
    label: 'Music playback devices and programmes',
    moduleId: MUSIC_MODULE_ID,
    specs: MUSIC_SOURCE_SPECS,
    createModule: createMusicSourceModule,
  },
]);

/** Human readable name per domain, derived from {@link DOMAIN_REGISTRATIONS}. */
export const DOMAIN_LABELS: Readonly<Record<DomainId, string>> = Object.freeze(
  Object.fromEntries(DOMAIN_REGISTRATIONS.map((entry) => [entry.id, entry.label])) as Record<
    DomainId,
    string
  >,
);

/* -------------------------------------------------------------------------- */
/* Assembly-time validation                                                   */
/* -------------------------------------------------------------------------- */

/** Thrown when an era cannot be assembled from the registered domain data. */
export class EraRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EraRegistryError';
  }
}

function missingEraMessage(domainId: string, year: YearId): string {
  return (
    `Period registry: domain "${domainId}" is missing its "${year}" era spec; ` +
    `every domain must supply all five eras (${YEAR_IDS.join(', ')}).`
  );
}

function lookupSpec<TSpec extends DomainSpecBase>(
  registration: DomainRegistration<TSpec>,
  year: YearId,
): TSpec | null {
  const specs = registration.specs as Readonly<Record<YearId, TSpec | null | undefined>>;
  const spec = specs[year];
  return spec ?? null;
}

/**
 * Validates that one domain supplies a well formed spec for every era in the
 * timeline. Throws an {@link EraRegistryError} naming the domain and the
 * missing (or mismatched) year — never a silent fallback to an empty era.
 */
export function validateDomainCoverage(registration: DomainRegistration): void {
  for (const year of YEAR_IDS) {
    const spec = lookupSpec(registration, year);
    if (spec === null || typeof spec !== 'object') {
      throw new EraRegistryError(missingEraMessage(registration.id, year));
    }
    const declared = (spec as DomainSpecBase).year;
    if (declared !== year) {
      throw new EraRegistryError(
        `Period registry: domain "${registration.id}" spec keyed "${year}" declares year ` +
          `"${String(declared)}"; the spec map keys and the spec's own year must agree.`,
      );
    }
  }
}

/**
 * Validates the whole registration list: exactly the ten known domains, each
 * registered once, each supplying all five eras. This is the assembly-time gate
 * the acceptance criteria require, so an incomplete era can never reach the
 * transition engine.
 */
export function validateDomainRegistrations(
  registrations: readonly DomainRegistration[] = DOMAIN_REGISTRATIONS,
): void {
  const seen = new Set<DomainId>();
  for (const registration of registrations) {
    if (!DOMAIN_IDS.includes(registration.id)) {
      throw new EraRegistryError(
        `Period registry: "${String(registration.id)}" is not one of the ten detail domains ` +
          `(${DOMAIN_IDS.join(', ')}).`,
      );
    }
    if (seen.has(registration.id)) {
      throw new EraRegistryError(
        `Period registry: domain "${registration.id}" is registered more than once; every ` +
          'detail domain must appear exactly once.',
      );
    }
    seen.add(registration.id);
    validateDomainCoverage(registration);
  }

  const missing = DOMAIN_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new EraRegistryError(
      `Period registry: no module is registered for ${missing.length} detail domain(s): ` +
        `${missing.join(', ')}; the registry must aggregate all ten domains.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Resolved eras                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One era's audio programme, derived from the music domain's own programme set
 * so the registry never re-authors playback content.
 */
export interface EraAudioProgram {
  /** Stable programme id (`'valve-ensemble-1945'`). */
  readonly id: string;
  /** Human readable programme label. */
  readonly label: string;
  /** Playback device id of the era's device spec. */
  readonly deviceId: string;
  /** Playback device display name. */
  readonly deviceName: string;
  /** Playback device kind (`'wireless-set'`, `'jukebox'`, ...). */
  readonly deviceKind: string;
  /** Era mix id the programme is routed through. */
  readonly mixId: string;
}

/**
 * Thin, geometry-only defaults an era's consumer needs before any module has
 * been built. Derived from the environment shell's room bounds.
 */
export interface EraRoomDefaults {
  /** Interior volume of the era's room (metres). */
  readonly bounds: RoomBounds;
  /** Suggested eye height above the floor for the close-up camera. */
  readonly eyeHeight: number;
  /** Suggested orbit radius framing the whole room (metres). */
  readonly cameraDistance: number;
}

/** Per-year domain specs, keyed by {@link DomainId}. */
export type EraDomainSpecs = Readonly<Record<DomainId, DomainSpecBase>>;

/**
 * A fully populated cafe era. It satisfies the frozen {@link PeriodDefinition}
 * contract (so it can be handed to any `SceneModule.applyPeriod` or to
 * `Kernel.createBuildContext`) and adds the aggregation payload: the era audio
 * programme, room defaults and a non-empty spec for all ten detail domains.
 */
export interface EraDefinition extends PeriodDefinition {
  /** Programme id the era's music plays. */
  readonly audioProgramId: string;
  /** Programme descriptor the composition root routes into the audio engine. */
  readonly audioProgram: EraAudioProgram;
  /** Room geometry defaults for the era. */
  readonly roomDefaults: EraRoomDefaults;
  /** Every detail domain's spec for this era. */
  readonly domains: EraDomainSpecs;
}

/**
 * Cross-era colour/intensity tuning. These are tuning constants, not era
 * content: every per-era colour below comes from an owning domain's spec.
 */
const LIGHTING_TUNING = Object.freeze({
  ambientIntensity: 0.5,
  keyIntensity: 1.4,
  fillIntensity: 0.35,
  lampIntensity: 20,
  fogDensity: 0,
});

function specFor<TSpec extends DomainSpecBase>(
  registration: DomainRegistration<TSpec>,
  year: YearId,
): TSpec {
  const spec = lookupSpec(registration, year);
  if (spec === null) {
    // Defensive: the default registry is validated at assembly, but a caller
    // may assemble a custom registration list.
    throw new EraRegistryError(missingEraMessage(registration.id, year));
  }
  return spec;
}

function buildEraDefinition(
  year: YearId,
  registrations: readonly DomainRegistration[],
): EraDefinition {
  const room = environmentSpec(year);
  const program = musicProgram(year);
  const device = MUSIC_SOURCE_SPECS[year];
  const mix = eraMusicMix(year);
  const bounds: RoomBounds = CAFE_ROOM_BOUNDS;

  const domains = {} as Record<DomainId, DomainSpecBase>;
  for (const registration of registrations) {
    domains[registration.id] = specFor(registration, year);
  }

  return Object.freeze({
    year,
    label: room.label,
    name: room.name,
    summary: room.summary,
    palette: Object.freeze({
      background: room.paint.trimBase,
      floor: room.floor.palette.base,
      wall: room.paint.wallBase,
      ceiling: room.ceiling.finish.palette.base,
      accent: room.accentColor,
      lamp: room.signage.lampColor,
    }),
    lighting: Object.freeze({
      ambientColor: room.lightBounce.wall,
      ambientIntensity: LIGHTING_TUNING.ambientIntensity,
      keyColor: room.lightBounce.ceiling,
      keyIntensity: LIGHTING_TUNING.keyIntensity,
      fillColor: room.lightBounce.wall,
      fillIntensity: LIGHTING_TUNING.fillIntensity,
      lampColor: room.signage.lampColor,
      lampIntensity: LIGHTING_TUNING.lampIntensity,
      fogDensity: LIGHTING_TUNING.fogDensity,
    }),
    details: Object.freeze([...room.tags]),
    audioProgramId: program.id,
    audioProgram: Object.freeze({
      id: program.id,
      label: program.label ?? program.id,
      deviceId: device.deviceId,
      deviceName: device.name,
      deviceKind: device.kind,
      mixId: mix.id ?? `music-mix-${year}`,
    }),
    roomDefaults: Object.freeze({
      bounds,
      eyeHeight: bounds.height * 0.55,
      cameraDistance: Math.max(bounds.width, bounds.depth) * 0.9,
    }),
    domains: Object.freeze(domains),
  });
}

/**
 * Assembles five resolved eras from a registration list, validating the list
 * first. Exposed so tests (and tooling) can prove the negative case against the
 * real validation path; production code uses {@link PERIOD_REGISTRY}.
 */
export function assembleEraDefinitions(
  registrations: readonly DomainRegistration[] = DOMAIN_REGISTRATIONS,
): Readonly<Record<YearId, EraDefinition>> {
  validateDomainRegistrations(registrations);
  const entries = YEAR_IDS.map(
    (year) => [year, buildEraDefinition(year, registrations)] as const,
  );
  return Object.freeze(Object.fromEntries(entries) as Record<YearId, EraDefinition>);
}

/** The five eras the registry resolves, in chronological order. */
export const PERIOD_YEARS: readonly YearId[] = Object.freeze([...YEAR_IDS]);

/**
 * The assembled registry: five complete eras keyed by {@link YearId}. Built once
 * at import from the ten registered domains, with no runtime side effects.
 */
export const PERIOD_REGISTRY: Readonly<Record<YearId, EraDefinition>> = assembleEraDefinitions();

/**
 * Resolves one era by {@link YearId}. Throws for a year outside the timeline
 * rather than returning an empty era.
 */
export function resolvePeriod(year: YearId): EraDefinition {
  const era: EraDefinition | undefined = PERIOD_REGISTRY[year];
  if (era === undefined) {
    throw new EraRegistryError(
      `Period registry: no era is registered for "${String(year)}"; expected one of ` +
        `${YEAR_IDS.join(', ')}.`,
    );
  }
  return era;
}

/** Looks up one domain's spec for one era. */
export function domainSpec(year: YearId, domainId: DomainId): DomainSpecBase {
  const domains = resolvePeriod(year).domains as Readonly<
    Record<string, DomainSpecBase | undefined>
  >;
  const spec = domains[domainId];
  if (spec === undefined) {
    throw new EraRegistryError(
      `Period registry: domain "${domainId}" has no spec for "${year}".`,
    );
  }
  return spec;
}

/* -------------------------------------------------------------------------- */
/* Diagnostics and instantiation                                              */
/* -------------------------------------------------------------------------- */

/** Flat summary of one era, used by diagnostics and the composition artifact. */
export interface PeriodSummary {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly domainCount: number;
  readonly audioProgramId: string;
}

/** Summarises one era (year label, era name, domain count, audio program id). */
export function summarizePeriod(year: YearId): PeriodSummary {
  const era = resolvePeriod(year);
  return Object.freeze({
    year: era.year,
    label: era.label,
    name: era.name,
    domainCount: Object.keys(era.domains).length,
    audioProgramId: era.audioProgramId,
  });
}

/** Summarises the whole registry, in timeline order. */
export function summarizeRegistry(): readonly PeriodSummary[] {
  return Object.freeze(PERIOD_YEARS.map((year) => summarizePeriod(year)));
}

/** One instantiated domain module plus the registration metadata it came from. */
export interface EraModuleInstance<TSpec extends DomainSpecBase = DomainSpecBase> {
  readonly id: DomainId;
  readonly moduleId: string;
  readonly spec: TSpec;
  readonly module: SceneModule<TSpec>;
}

/**
 * Instantiates the ten registered modules for `year`, in
 * {@link DOMAIN_IDS} order.
 *
 * This creates the modules only — it never builds, starts audio, or touches the
 * DOM — so the composition root (and the headless composition test) decides
 * when each module is built and disposed. Pass `bounds`/`layout` to share the
 * environment shell, or omit them to use each module's own defaults.
 */
export function createEraModules(
  year: YearId,
  options: DomainModuleOptions = {},
): readonly EraModuleInstance[] {
  const bounds = options.bounds ?? resolvePeriod(year).roomDefaults.bounds;
  return Object.freeze(
    DOMAIN_REGISTRATIONS.map((registration) => {
      const spec = specFor(registration, year);
      const module = registration.createModule({ ...options, bounds, initialYear: year });
      return Object.freeze({
        id: registration.id,
        moduleId: registration.moduleId,
        spec,
        module,
      });
    }),
  );
}
