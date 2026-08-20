/**
 * Shared type contracts for the city simulation.
 *
 * These are documentation-only JSDoc typedefs. Later modules import this
 * file (it is a valid, empty ES module) so the shapes are co-located with
 * the code that consumes them, without any runtime cost or circular imports.
 */

/**
 * @typedef {Object} SimTime
 * @property {number} simHour   Current hour of the day, 0-23.
 * @property {number} simDay    1-based day number.
 * @property {number} dayPhase  Normalized day/night phase 0-1 (0 = midnight,
 *                              0.5 = noon). Drives the visual day/night cycle.
 */

/**
 * A building footprint in tile coordinates (inclusive of the occupied tiles).
 * @typedef {Object} Footprint
 * @property {number} x  Left tile column.
 * @property {number} y  Top tile row.
 * @property {number} w  Width in tiles.
 * @property {number} h  Height in tiles.
 */

/**
 * @typedef {Object} Building
 * @property {number} id          Unique building id.
 * @property {string} zone        'residential' | 'workplace' | 'entertainment' | 'service'.
 * @property {?string} subType    Service subtype ('shop' | 'restaurant' | 'park')
 *                                when zone === 'service', else null.
 * @property {Footprint} footprint Building footprint in tile coordinates.
 * @property {{x:number, y:number}} door  Door tile (edge adjacent to a road).
 * @property {number} capacity    Max occupants (residents or workers/patrons).
 * @property {string} name        Display name.
 * @property {number} detailSeed  Deterministic seed for detail generation.
 * @property {number} [residents] Current residents (residential only).
 * @property {number} [workers]   Current assigned workers (workplace/service).
 * @property {number} [revenue]   Hourly revenue (workplace/service).
 */

/**
 * @typedef {Object} Citizen
 * @property {number} id            Unique citizen id.
 * @property {string} name          Display name.
 * @property {number} homeId        Id of home building.
 * @property {?number} workplaceId  Id of workplace building, or null.
 * @property {string} state         'home' | 'travel' | 'work' | 'entertain' | 'shopping'.
 * @property {{x:number, y:number}} tile  Current tile position.
 * @property {number} energy        Daily energy budget (0-100).
 * @property {number} hunger        Hunger level (0-100).
 * @property {number} mood          Mood level (0-100).
 * @property {number} money         Personal funds.
 * @property {number} detailSeed    Seed for appearance/detail generation.
 * @property {number} scheduleIdx   Position in today's schedule plan.
 * @property {Array<{state:string, target:number, startHour:number}>} schedule
 *                                   Today's plan (home -> work -> entertainment -> home).
 */

/**
 * @typedef {Object} Vehicle
 * @property {number} id            Unique vehicle id.
 * @property {string} kind          'car' | 'bus' | 'truck' | 'bike'.
 * @property {?number} ownerId      Id of owning citizen, or null (public transit).
 * @property {string} state         'idle' | 'travel' | 'parked'.
 * @property {number} route         Index of current road segment on its route.
 * @property {number} speed         Current speed in tiles per sim-hour.
 * @property {{x:number, y:number}} tile  Current tile position.
 * @property {number} detailSeed    Seed for detail generation.
 * @property {boolean} onRoad       Whether the vehicle is on a road tile.
 */

/**
 * @typedef {Object} Company
 * @property {number} id             Unique company id.
 * @property {string} name           Display name.
 * @property {string} sector         'office' | 'retail' | 'food' | 'entertainment'.
 * @property {number} buildingId     Id of the building it operates from.
 * @property {number[]} employeeIds  Ids of employed citizens.
 * @property {number} revenue        Current revenue (updated each sim-hour).
 * @property {number} expenses       Current expenses (wages, upkeep).
 * @property {number} cash           Cash reserves.
 * @property {number} reputation     Public reputation 0-100.
 * @property {number} detailSeed     Seed for detail generation.
 * @property {number[]} customerIds    Ids of citizens currently patronizing it.
 */

/**
 * @typedef {Object} RoadTile
 * @property {number} x       Tile column.
 * @property {number} y       Tile row.
 * @property {string} type    'road'.
 * @property {string[]} [connections]  Cardinal directions with road neighbors:
 *                                     'n' | 'e' | 's' | 'w'.
 */

/**
 * @typedef {Object} CityState
 * @property {number} gridSize    World grid size in tiles (square).
 * @property {number} tileSize    Pixel size of a single tile.
 * @property {number} seed        Deterministic generation seed.
 * @property {Building[]} buildings  All buildings in the city.
 * @property {Citizen[]} citizens    All citizens in the city.
 * @property {Vehicle[]} vehicles    All vehicles in the city.
 * @property {Company[]} companies   All companies in the city.
 * @property {RoadTile[]} roads      All road tiles.
 * @property {EconomyState} economy  Live economy state.
 * @property {SimTime} time          Current simulation time.
 */

/**
 * @typedef {Object} EconomyState
 * @property {number} budget      City treasury balance.
 * @property {number} revenue     Income this hour (taxes, fees).
 * @property {number} expenses    Spend this hour (services, upkeep).
 * @property {number} population  Current citizen count.
 * @property {number} employed    Count of employed citizens.
 * @property {number} employmentRate  employed / population (0-1).
 * @property {number} lastUpdatedHour  Sim-hour of the last economy update.
 */

/**
 * @typedef {Object} SimConfig
 * @property {number} seed                 Deterministic world seed.
 * @property {number} gridSize             World grid size in tiles.
 * @property {number} tileSize             Pixel size per tile.
 * @property {number} roadSpacing          Roads every N tiles.
 * @property {number} secondsPerSimHour    Real seconds per sim-hour.
 * @property {number} simHoursPerDay       Sim hours per day.
 * @property {number} minBuildings         Minimum building count.
 * @property {number} minCitizens          Minimum citizen count.
 * @property {number} minVehicles          Minimum vehicle count.
 * @property {Object<string,number>} zones Zone weight table for generation.
 * @property {number} startingBudget       Initial city budget.
 */