/**
 * Global simulation constants.
 *
 * Values are derived from the README specification:
 *   - ≥20 buildings, ≥50 citizens, ≥10 vehicles active simultaneously.
 *   - Economy updates every sim-hour.
 *   - Day/night cycle visible.
 *
 * @see README.md
 */

// ─── Time ────────────────────────────────────────────────────────────────────

/**
 * Real-time milliseconds that represent one simulation hour.
 *
 * A full 24-hour day therefore takes 24 × SIM_HOUR_MS ms
 * = 60 000 ms (1 minute) at the default value, giving a pleasant
 * day/night cycle for the viewer.
 */
export const SIM_HOUR_MS = 2_500;

/** Number of hours in a simulated day. */
export const HOURS_PER_DAY = 24;

// ─── Grid ────────────────────────────────────────────────────────────────────

/** Width of the city grid in cells. */
export const GRID_WIDTH = 100;

/** Height of the city grid in cells. */
export const GRID_HEIGHT = 100;

/** Total number of cells in the grid. */
export const GRID_AREA = GRID_WIDTH * GRID_HEIGHT;

// ─── Minimum Entity Counts ───────────────────────────────────────────────────

/** Minimum number of buildings the city must contain (README: ≥20). */
export const MIN_BUILDINGS = 20;

/** Minimum number of citizens the city must contain (README: ≥50). */
export const MIN_CITIZENS = 50;

/** Minimum number of vehicles active simultaneously (README: ≥10). */
export const MIN_VEHICLES = 10;

// ─── Economy ─────────────────────────────────────────────────────────────────

/** Starting treasury for the city. */
export const STARTING_BUDGET = 100_000;

/** Income tax rate applied to citizen wages (fraction, 0–1). */
export const INCOME_TAX_RATE = 0.1;

/** Hourly wage a company pays each working citizen per sim-hour. */
export const HOURLY_WAGE = 15;

/** Cost a citizen pays for one hour of entertainment. */
export const ENTERTAINMENT_COST = 20;

/** Revenue a company earns per employee per sim-hour. */
export const REVENUE_PER_EMPLOYEE = 25;

/** Hourly maintenance cost per building (deducted from budget). */
export const BUILDING_MAINTENANCE = 5;

/** Hourly welfare payment per unemployed citizen (city expense). */
export const WELFARE_PER_CITIZEN = 5;

// ─── Citizen Schedule ────────────────────────────────────────────────────────

/** Sim-hour when citizens leave home for work. */
export const WORK_START_HOUR = 8;

/** Sim-hour when citizens finish work and head to entertainment. */
export const WORK_END_HOUR = 17;

/** Sim-hour when citizens leave entertainment to return home. */
export const ENTERTAINMENT_END_HOUR = 21;

// ─── Movement ────────────────────────────────────────────────────────────────

/** Average citizen travel speed in grid-cells per sim-hour. */
export const CITIZEN_SPEED = 12;

/** Average vehicle travel speed in grid-cells per sim-hour. */
export const VEHICLE_SPEED = 30;

// ─── Vehicle Behaviour ───────────────────────────────────────────────────────

/**
 * Radius (in tiles) within which a vehicle can detect and pick up a
 * nearby commuting citizen as a passenger.
 */
export const VEHICLE_PICKUP_RADIUS = 3;

/**
 * Probability per tick that an eligible vehicle (with free capacity and
 * a nearby commuter) attempts to pick up that citizen.
 */
export const VEHICLE_PICKUP_CHANCE = 0.08;

/**
 * Radius (in tiles) within which a vehicle is considered to have
 * arrived at a passenger's destination and will drop them off.
 */
export const VEHICLE_DROPOFF_RADIUS = 3;

/** Fuel level of a fully refuelled vehicle, as a percentage `[0, 100]`. */
export const VEHICLE_FUEL_FULL = 100;

/** Fuel consumed per road tile travelled. */
export const VEHICLE_FUEL_PER_TILE = 0.4;

/** Fuel restored per tick while a vehicle is stationary (refuelling). */
export const VEHICLE_FUEL_REFUEL_RATE = 6;
