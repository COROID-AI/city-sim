/**
 * Economy tunables.
 *
 * Single source of truth for the economy layer (src/economy/*). Kept separate
 * from the core CONFIG so the economy can be retuned without touching the
 * world/citizen layers.
 */

export const ECONOMY_CONST = {
  /** Share of company profit collected as corporate tax each hour. */
  COMPANY_TAX_RATE: 0.22,

  /** Share of citizen wages collected as income tax each hour. */
  INCOME_TAX_RATE: 0.14,

  /** Public services cost per citizen per sim-hour. */
  SERVICES_PER_CITIZEN: 24,

  /** Street lighting cost per sim-hour. */
  STREETLIGHTS_PER_HOUR: 160,

  /** Transit subsidy paid per sim-hour. */
  TRANSIT_SUBSIDY_PER_HOUR: 200,

  /** Office output value generated per working employee per sim-hour. */
  OFFICE_OUTPUT_PER_WORKER: 380,

  /** Office buildings only produce while open (work hours). */
  OFFICE_OPEN_START: 8,
  OFFICE_OPEN_END: 17,

  /** Average customer spend per visit, by industry. */
  SPEND_PER_VISIT: {
    office: 0,
    retail: 150,
    food: 200,
    entertainment: 160,
  },

  /** Hourly rent a company pays, by industry. */
  RENT_PER_HOUR: {
    office: 300,
    retail: 180,
    food: 160,
    entertainment: 200,
  },

  /** Supplies cost per customer visit and per worker, per hour. */
  SUPPLIES_PER_VISIT: 9,
  SUPPLIES_PER_WORKER_HOUR: 6,

  /** Salary is a daily figure; split across this many sim-hours for hourly cost. */
  WAGE_HOURS_PER_DAY: 24,

  /** Starting cash reserve range for a newly founded company. */
  STARTING_CASH_MIN: 80000,
  STARTING_CASH_MAX: 180000,
};