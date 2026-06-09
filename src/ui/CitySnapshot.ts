/**
 * CitySnapshot — derived, frozen view of engine state for the UI.
 *
 * Spec reference: §6.4 Dashboard Layout.
 *
 * The dashboard, log, and mini-map all want a tiny, JSON-serializable
 * slice of the simulation that can be diffed cheaply. Rather than pass
 * the live systems + entities through props, we derive a `CitySnapshot`
 * on a fixed cadence (2 Hz) inside `CityView` and hand the frozen
 * value down. This keeps the React layer ignorant of system lifetimes
 * and the snapshot testable as a pure function.
 *
 * Layer rule: this file is `src/ui/` and may import from entities,
 * types, and constants, but never from `src/systems/` (systems must
 * stay framework-agnostic).
 */
import type { Citizen, Company, Needs, Vector2 } from '@/entities';
import type { BuildingId, CitizenId, CompanyId } from '@/types/common';

/**
 * Average of the four citizen needs. NaN-safe: when there are no
 * citizens we return 0 so the dashboard never shows a blank tile.
 */
export type NeedKey = keyof Needs;

export interface CitySnapshot {
  /** In-game day counter, monotonically increasing. */
  day: number;
  /** Hour of day 0..23. */
  hour: number;
  /** Minute of hour 0..59. */
  minute: number;
  /** Live citizen count (excludes in-transit commuters). */
  population: number;
  /** Mean of energy/hunger/fun/social across the active citizens. */
  avgNeeds: number;
  /** Current city treasury. */
  budget: number;
  /** Open vs total companies for the KPI bar. */
  openCompanies: number;
  totalCompanies: number;
  /** In-flight vehicle count. */
  vehicleCount: number;
  /** Frozen list of points used by the mini-map (citizens, vehicles,
   *  and the world bounds). */
  citizens: ReadonlyArray<{ id: CitizenId; position: Vector2; color: string }>;
  vehicles: ReadonlyArray<{ id: string; position: Vector2; color: string }>;
  buildings: ReadonlyArray<{ id: BuildingId; position: Vector2; color: string }>;
  /** The world bounds (min/max x/y in tile space). */
  worldBounds: { min: Vector2; max: Vector2 };
}

/** Marker color used for citizen pins on the mini-map. Matches the
 *  Tailwind v4 `text-citizen` token. */
export const CITIZEN_COLOR = '#bfe4ee';
/** Marker color used for vehicle pins. Matches `text-accent`. */
export const VEHICLE_COLOR = '#8be0b5';
/** Fallback for buildings when no per-type color is available. */
export const BUILDING_COLOR_FALLBACK = '#9aa3b2';

/** Inputs the snapshot builder needs. All fields are optional so
 *  the integration test can pass a hand-rolled subset. */
export interface BuildCitySnapshotInput {
  day: number;
  hour: number;
  minute: number;
  budget: number;
  openCompanies: number;
  totalCompanies: number;
  /** Live citizens (post-commute-handoff). Optional so the test can
   *  omit them. */
  citizens?: readonly Citizen[];
  /** Active vehicles. */
  vehicles?: ReadonlyArray<{ id: string; position: Vector2; status?: string }>;
  /** Open + closed companies for the mini-map. */
  companies?: readonly Company[];
  /** Optional building color resolver; used for the mini-map. */
  resolveBuildingColor?: (buildingTypeId: string) => string | undefined;
  /** World bounds. Defaults to a 256x256 square centred on (0,0). */
  worldBounds?: { min: Vector2; max: Vector2 };
  /** Color override for citizens (used by tests). */
  citizenColor?: string;
  /** Color override for vehicles (used by tests). */
  vehicleColor?: string;
}

/** Compute the world bounds for a list of points, padded by `pad`. */
function computeBounds(
  points: ReadonlyArray<Vector2>,
  fallback: { min: Vector2; max: Vector2 },
  pad: number,
): { min: Vector2; max: Vector2 } {
  if (points.length === 0) return fallback;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    min: { x: minX - pad, y: minY - pad },
    max: { x: maxX + pad, y: maxY + pad },
  };
}

/**
 * Build a frozen `CitySnapshot` from the provided inputs.
 *
 * Pure function: never mutates its inputs. The output is frozen so
 * React.memo equality checks are reference-only (cheap) and so a
 * downstream consumer can't accidentally rewrite history.
 */
export function buildCitySnapshot(input: BuildCitySnapshotInput): CitySnapshot {
  const citizens = input.citizens ?? [];
  const vehicles = input.vehicles ?? [];
  const companies = input.companies ?? [];

  const population = citizens.length;

  let avgNeeds = 0;
  if (population > 0) {
    let total = 0;
    for (const c of citizens) {
      total +=
        c.needs.energy + c.needs.hunger + c.needs.fun + c.needs.social;
    }
    avgNeeds = total / (population * 4);
  }

  const citizenColor = input.citizenColor ?? CITIZEN_COLOR;
  const vehicleColor = input.vehicleColor ?? VEHICLE_COLOR;

  const citizenMarkers = citizens.map((c) => ({
    id: c.id,
    position: c.position,
    color: citizenColor,
  }));

  const vehicleMarkers = vehicles.map((v) => ({
    id: v.id,
    position: v.position,
    color: vehicleColor,
  }));

  const buildingMarkers = companies.map((company) => {
    const id: CompanyId = company.id;
    return {
      id: id as unknown as BuildingId,
      position: company.position,
      color:
        input.resolveBuildingColor?.(company.buildingTypeId) ??
        BUILDING_COLOR_FALLBACK,
    };
  });

  const fallbackBounds = { min: { x: -32, y: -32 }, max: { x: 224, y: 224 } };
  const worldBounds = input.worldBounds ?? {
    ...computeBounds(
      [
        ...citizenMarkers.map((c) => c.position),
        ...vehicleMarkers.map((v) => v.position),
        ...buildingMarkers.map((b) => b.position),
      ],
      fallbackBounds,
      4,
    ),
  };

  return Object.freeze({
    day: input.day,
    hour: input.hour,
    minute: input.minute,
    population,
    avgNeeds,
    budget: input.budget,
    openCompanies: input.openCompanies,
    totalCompanies: input.totalCompanies,
    vehicleCount: vehicleMarkers.length,
    citizens: Object.freeze(citizenMarkers) as ReadonlyArray<{
      id: CitizenId;
      position: Vector2;
      color: string;
    }>,
    vehicles: Object.freeze(vehicleMarkers) as ReadonlyArray<{
      id: string;
      position: Vector2;
      color: string;
    }>,
    buildings: Object.freeze(buildingMarkers) as ReadonlyArray<{
      id: BuildingId;
      position: Vector2;
      color: string;
    }>,
    worldBounds: Object.freeze({
      min: Object.freeze(worldBounds.min),
      max: Object.freeze(worldBounds.max),
    }) as { min: Vector2; max: Vector2 },
  });
}

/** Default snapshot used while the engine is still warming up. */
export function emptyCitySnapshot(): CitySnapshot {
  return buildCitySnapshot({
    day: 0,
    hour: 0,
    minute: 0,
    budget: 0,
    openCompanies: 0,
    totalCompanies: 0,
  });
}
