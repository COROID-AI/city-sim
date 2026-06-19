/**
 * Core simulation constants.
 *
 * Single source of truth for grid dimensions and other tunable spec values.
 * Spec 6.1 mandates an 80x80 tile grid.
 */

/** Number of tiles along each axis of the city grid (80x80). */
export const GRID_SIZE = 80;

/** Total number of tiles in the grid (GRID_SIZE * GRID_SIZE). */
export const TOTAL_TILES = GRID_SIZE * GRID_SIZE;
