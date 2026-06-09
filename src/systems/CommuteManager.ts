/**
 * CommuteManager — citizen ⇄ vehicle handoff.
 *
 * Spec reference: §7.4 Traffic (commute handoff), §7.2 Citizen Behaviour.
 *
 * When a citizen's `currentActivity` becomes 'commute' and the route
 * is long enough to warrant a vehicle, we remove the citizen from the
 * active set and emit a Vehicle that follows the same path. When the
 * vehicle arrives (or hits a 60-tick safety timeout, in case it gets
 * stuck on a red light forever), we restore the citizen at the path's
 * last tile with the destination activity ('work', 'leisure', etc.)
 * and re-append them to the active list.
 *
 * Layer rule: this file lives in `src/systems/`, which is
 * framework-agnostic. No React, no DOM, no engine imports. The only
 * allowed dependencies are `@/entities` and `@/types/common`.
 */
import {
  type Citizen,
  type Vehicle,
  advanceVehicle,
  createVehicle,
} from '@/entities';
import type { ActivityId, Vector2, VehicleId } from '@/types/common';
import type { CityEventMap, EventBus } from './EventBus';

/** Minimum path length required to spin up a vehicle. */
export const COMMUTE_MIN_PATH_LENGTH = 2;

/** Hard cap (in ticks) for a vehicle to reach 'arrived' before we force-arrived it. */
export const COMMUTE_VEHICLE_TIMEOUT_TICKS = 60;

/** Stable id generator. Tests can inject a deterministic factory. */
export type IdFactory = () => string;

const defaultIdFactory: IdFactory = (): string => {
  // crypto.randomUUID is available in both Node 20+ and modern browsers.
  // Fall back to a Math.random-based id only if the environment lacks it.
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
};

/** The destination activity implied by a commute. Today: 'work'. */
const COMMUTE_DESTINATION_ACTIVITY: ActivityId = 'work';

/** Internal record of a citizen that's currently in-vehicle. */
interface InFlight {
  citizen: Citizen;
  vehicleId: VehicleId;
  /** Ticks elapsed since the handoff. Used for the 60-tick timeout. */
  ticks: number;
}

export interface CommuteManagerOptions {
  /**
   * Set of `x,y` keys for tiles that are currently red. The handoff
   * machinery forwards this to `advanceVehicle` so the vehicle freezes
   * on red lights the same way it does in the bare entity layer.
   */
  getRedLightTiles?: () => ReadonlySet<string>;
  /**
   * Destination activity assigned to a citizen when their vehicle
   * arrives. Defaults to 'work'. Callers can override to support
   * commute -> leisure, commute -> errand, etc.
   */
  destinationActivity?: ActivityId;
  /**
   * Vehicle id factory. Defaults to a UUID v4 fallback. Tests inject
   * a counter here for deterministic snapshots.
   */
  idFactory?: IdFactory;
  /** Vehicle speed override (defaults to 1). */
  vehicleSpeed?: number;
  /** Optional bus for emitting commute_arrived events. */
  bus?: EventBus<CityEventMap>;
}

export interface CommuteTickResult {
  /** Citizens that are still active in the world. */
  activeCitizens: readonly Citizen[];
  /** Vehicles that remain on the road (still driving or waiting on red). */
  activeVehicles: readonly Vehicle[];
  /** Citizens whose vehicles arrived (or timed out) on this tick. */
  restoredCitizens: readonly Citizen[];
}

/**
 * The handoff state machine. Pure-TS, no engine imports. Holds
 * transient in-flight records and is driven by `tick` from the
 * engine / CityCanvas.
 *
 * Idempotency:
 *   - `beginCommute` for a citizen that is already in-flight is a
 *     no-op (no second vehicle is emitted).
 *   - `tick` is safe to call repeatedly; expired vehicles are restored
 *     once and removed from the in-flight set.
 */
export class CommuteManager {
  private readonly getRedLightTiles: () => ReadonlySet<string>;
  private readonly destinationActivity: ActivityId;
  private readonly idFactory: IdFactory;
  private readonly vehicleSpeed: number;
  private bus: EventBus<CityEventMap> | null;
  private readonly inFlight: Map<string, InFlight> = new Map();
  private vehicles: Vehicle[] = [];

  constructor(options: CommuteManagerOptions = {}) {
    this.getRedLightTiles = options.getRedLightTiles ?? ((): ReadonlySet<string> => new Set<string>());
    this.destinationActivity = options.destinationActivity ?? COMMUTE_DESTINATION_ACTIVITY;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.vehicleSpeed = options.vehicleSpeed ?? 1;
    this.bus = options.bus ?? null;
  }

  /** Attach (or replace) the bus used for commute_arrived events. */
  setBus(bus: EventBus<CityEventMap>): void {
    this.bus = bus;
  }

  /**
   * The set of in-flight vehicles. Read-only; mutate via `tick`.
   */
  getVehicles(): readonly Vehicle[] {
    return this.vehicles;
  }

  /**
   * The set of citizens currently in a vehicle. Read-only.
   */
  getInFlightIds(): ReadonlySet<string> {
    return new Set(this.inFlight.keys());
  }

  /**
   * Begin a commute for `citizen` along `path`. Returns the new
   * vehicle if the handoff fired, or `null` if the path was too
   * short, the citizen is already in flight, or the path is empty.
   *
   * - path length must be >= COMMUTE_MIN_PATH_LENGTH
   * - citizen id must not already be in the in-flight map
   */
  beginCommute(citizen: Citizen, path: readonly Vector2[]): Vehicle | null {
    if (path.length < COMMUTE_MIN_PATH_LENGTH) return null;
    if (this.inFlight.has(citizen.id)) return null;

    const start = path[0]!;
    const vehicleId = this.idFactory() as VehicleId;
    const vehicle = createVehicle({
      id: vehicleId,
      position: { x: start.x, y: start.y },
      path,
      pathIndex: 0,
      status: 'driving',
      speed: this.vehicleSpeed,
    });
    this.inFlight.set(citizen.id, { citizen, vehicleId, ticks: 0 });
    this.vehicles = [...this.vehicles, vehicle];
    return vehicle;
  }

  /**
   * Advance every in-flight vehicle by one tick. Vehicles that arrive
   * (or hit the safety timeout) restore their citizen and are removed
   * from the in-flight set.
   *
   * Pure with respect to its inputs: returns new arrays, never mutates
   * the caller's `activeCitizens`.
   */
  tick(activeCitizens: readonly Citizen[]): CommuteTickResult {
    if (this.inFlight.size === 0) {
      return { activeCitizens, activeVehicles: this.vehicles, restoredCitizens: [] };
    }

    const redSet = this.getRedLightTiles();
    const inFlightIds = new Set(this.inFlight.keys());
    const filteredActive = activeCitizens.filter((c) => !inFlightIds.has(c.id));

    const nextVehicles: Vehicle[] = [];
    const restored: Citizen[] = [];
    const stillInFlight = new Map<string, InFlight>();

    for (const [citizenId, record] of this.inFlight) {
      const vehicle = this.vehicles.find((v) => v.id === record.vehicleId);
      if (vehicle === undefined) {
        // Defensive: drop orphaned records. Restore the citizen.
        restored.push({ ...record.citizen, currentActivity: this.destinationActivity });
        continue;
      }
      const advanced = advanceVehicle(vehicle, { redLightTiles: redSet });
      const newTicks = record.ticks + 1;
      const timedOut = newTicks >= COMMUTE_VEHICLE_TIMEOUT_TICKS;
      if (advanced.status === 'arrived' || timedOut) {
        const lastTile = pathLastTile(advanced);
        const restoredCitizen: Citizen = {
          ...record.citizen,
          position: lastTile,
          currentActivity: this.destinationActivity,
        };
        restored.push(restoredCitizen);
        this.bus?.emit('commute_arrived', {
          citizenId: restoredCitizen.id,
          destination: lastTile,
        });
        this.bus?.emit('vehicle_despawned', { vehicleId: advanced.id });
        continue;
      }
      nextVehicles.push(advanced);
      stillInFlight.set(citizenId, { citizen: record.citizen, vehicleId: record.vehicleId, ticks: newTicks });
    }

    this.vehicles = nextVehicles;
    this.inFlight.clear();
    for (const [k, v] of stillInFlight) this.inFlight.set(k, v);

    const finalActive = restored.length > 0 ? [...filteredActive, ...restored] : filteredActive;
    return { activeCitizens: finalActive, activeVehicles: this.vehicles, restoredCitizens: restored };
  }
}

/**
 * The last tile a vehicle ended up on. Used to place the restored
 * citizen. Falls back to the start tile if the path is empty.
 */
function pathLastTile(vehicle: Vehicle): Vector2 {
  if (vehicle.path.length === 0) return { ...vehicle.position };
  const last = vehicle.path[vehicle.path.length - 1]!;
  return { x: last.x, y: last.y };
}
