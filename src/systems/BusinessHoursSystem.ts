/**
 * BusinessHoursSystem — emits company_opened / company_closed events when
 * the simulation hour crosses the operating-hours boundaries (spec §5.3).
 *
 * Operating hours: COMPANY_OPEN_HOUR (8) … COMPANY_CLOSE_HOUR (18).
 * Only commercial and industrial buildings participate; residential and
 * entertainment venues are ignored.
 *
 * The system is stateful: it remembers the last processed hour so that it
 * emits each transition exactly once per day (not once per simulation step).
 */
import type { Building, BuildingType, CityTime } from '@/engine/types';
import type { World } from '@/engine/World';
import type { EventBus } from '@/systems/EventBus';

/** Hour at which commercial/industrial buildings open for business. */
export const COMPANY_OPEN_HOUR = 8;

/** Hour at which commercial/industrial buildings close for business. */
export const COMPANY_CLOSE_HOUR = 18;

/** Building types that participate in business-hours transitions. */
const BUSINESS_BUILDING_TYPES: ReadonlySet<BuildingType> = new Set([
  'shop',
  'office',
  'factory',
]);

export interface BusinessHoursSystemOptions {
  /** EventBus used to publish company_opened / company_closed events. */
  eventBus: EventBus;
}

export class BusinessHoursSystem {
  private readonly world: World;
  private readonly eventBus: EventBus;
  /** Last hour processed, to detect transitions. -1 = not yet processed. */
  private lastHour = -1;

  constructor(world: World, options: BusinessHoursSystemOptions) {
    this.world = world;
    this.eventBus = options.eventBus;
  }

  /**
   * Evaluate operating-hours transitions for the current simulation hour.
   *
   * Emits `company_opened` for every commercial/industrial building when the
   * hour transitions to {@link COMPANY_OPEN_HOUR}, and `company_closed` when
   * it transitions to {@link COMPANY_CLOSE_HOUR}.
   *
   * @param time Current simulation time snapshot.
   */
  update(time: CityTime): void {
    const hour = time.hour;
    if (hour === this.lastHour) return;

    if (hour === COMPANY_OPEN_HOUR) {
      for (const building of this.businessBuildings()) {
        this.eventBus.emit({
          type: 'company_opened',
          time,
          data: {
            buildingId: building.id,
            buildingType: building.type,
          },
        });
      }
    } else if (hour === COMPANY_CLOSE_HOUR) {
      for (const building of this.businessBuildings()) {
        this.eventBus.emit({
          type: 'company_closed',
          time,
          data: {
            buildingId: building.id,
            buildingType: building.type,
          },
        });
      }
    }

    this.lastHour = hour;
  }

  /** Iterate commercial/industrial buildings in the world. */
  private *businessBuildings(): IterableIterator<Building> {
    for (const building of this.world.buildings.values()) {
      if (BUSINESS_BUILDING_TYPES.has(building.type)) {
        yield building;
      }
    }
  }
}
