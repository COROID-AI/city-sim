/**
 * Global tunables for the city simulation.
 *
 * Every later module imports from this single source of truth. Keeping all
 * knobs here means the simulation can be retuned without touching logic.
 */

export const CONFIG = {
  /** Deterministic seed used by all generation so cities are reproducible. */
  SEED: 20260819,

  /** World grid size in tiles (square). 64x64 -> ~2048px at 32px/tile. */
  GRID_SIZE: 64,

  /** Pixel size of a single tile. */
  TILE_SIZE: 32,

  /** Road network spacing: a road runs every N tiles, both axes. */
  ROAD_SPACING: 8,

  /**
   * Real-time clock rate. One sim-hour elapses every N real seconds, so a
   * full day takes SIM_HOURS_PER_DAY * SECONDS_PER_SIM_HOUR real seconds.
   */
  SECONDS_PER_SIM_HOUR: 2,

  /** Number of sim-hours in a day. */
  SIM_HOURS_PER_DAY: 24,

  /** Informational: approx render ticks (frames) per sim-hour at 60fps. */
  TICKS_PER_SIM_HOUR: 120,

  /** Minimum entity counts the simulation must sustain. */
  MIN_BUILDINGS: 20,
  MIN_CITIZENS: 50,
  MIN_VEHICLES: 10,

  /** Weighted probabilities used to pick a building's zone during generation. */
  ZONES: {
    residential: 0.4,
    workplace: 0.25,
    entertainment: 0.15,
    service: 0.2,
  },

  /** Starting city budget (in sim-dollars). */
  STARTING_BUDGET: 1000000,
};