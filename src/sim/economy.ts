/**
 * Per-sim-hour economy tick: taxes, expenses, and city budget.
 *
 * The economy advances once per new integer sim-hour.  When a new hour
 * is detected (i.e. `floor(simTime.elapsedHours)` has changed since the
 * last tick), the system:
 *
 *   1. Computes the per-hour revenue delta (current total company revenue
 *      minus the baseline recorded at the previous tick).
 *   2. Applies the city income-tax rate to that hourly revenue to obtain
 *      tax income.
 *   3. Subtracts city expenses (civic building upkeep + welfare for the
 *      unemployed).
 *   4. Updates {@link World.budget} (treasury balance).
 *   5. Recomputes {@link World.derivedStats} for the HUD overlay.
 *
 * Derived HUD fields exposed via {@link aggregateStats}:
 *   - `population`
 *   - `employmentRate`
 *   - `lastHourTaxIncome`
 *   - `lastHourExpenses`
 */

import {
  BUILDING_MAINTENANCE,
  INCOME_TAX_RATE,
  WELFARE_PER_CITIZEN,
} from './constants';
import type { DerivedStats, World } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The integer sim-hour for a given elapsed-hours value.
 *
 * Uses `Math.floor` so the hour increments exactly once per whole hour.
 */
function integerHour(elapsedHours: number): number {
  return Math.floor(elapsedHours);
}

/**
 * Sum cumulative revenue across all companies.
 *
 * This is the running total; the per-hour delta is computed by
 * subtracting the previously-recorded baseline.
 */
function totalCompanyRevenue(world: World): number {
  let total = 0;
  for (const company of world.companies.values()) {
    total += company.revenue;
  }
  return total;
}

/**
 * Compute the total upkeep cost of all civic buildings for one sim-hour.
 */
function sumCivicUpkeep(world: World): number {
  let upkeep = 0;
  for (const building of world.buildings.values()) {
    if (building.kind === 'CIVIC') {
      upkeep += BUILDING_MAINTENANCE;
    }
  }
  return upkeep;
}

/**
 * Count the number of employed citizens (those with a non-null workplace).
 */
function countEmployed(world: World): number {
  let employed = 0;
  for (const citizen of world.citizens.values()) {
    if (citizen.work !== null) {
      employed++;
    }
  }
  return employed;
}

/**
 * Count the number of unemployed citizens (those with a null workplace).
 */
function countUnemployed(world: World): number {
  let unemployed = 0;
  for (const citizen of world.citizens.values()) {
    if (citizen.work === null) {
      unemployed++;
    }
  }
  return unemployed;
}

// ─── Public API: aggregateStats ──────────────────────────────────────────────

/**
 * Compute aggregated HUD statistics for the given world.
 *
 * Returns population, employment rate, and the most recent hour's tax
 * income and expenses.  This is a pure read — it does not mutate the
 * world.  `aggregateStats` is called by {@link tickEconomy} to refresh
 * {@link World.derivedStats}, but can also be invoked independently.
 *
 * @param world The world to inspect.
 * @returns A snapshot of the four derived HUD statistics.
 */
export function aggregateStats(world: World): DerivedStats {
  const population = world.citizens.size;
  const employed = countEmployed(world);
  const employmentRate = population > 0 ? employed / population : 0;

  return {
    population,
    employmentRate,
    lastHourTaxIncome: world.derivedStats.lastHourTaxIncome,
    lastHourExpenses: world.derivedStats.lastHourExpenses,
  };
}

// ─── Public API: tickEconomy ─────────────────────────────────────────────────

/**
 * Advance the city economy by one step.
 *
 * This function is **idempotent within a single sim-hour**: it runs the
 * full tax/expense/budget computation only when the integer sim-hour has
 * advanced past `world.lastEconomyHour`.  Multiple calls within the same
 * hour are no-ops, so it is safe to call from the main loop on every
 * fixed-step frame.
 *
 * On a new sim-hour:
 *   - **Hourly revenue** = current total company revenue − previous
 *     baseline (the amount companies earned since the last tick).
 *   - **Tax income**     = hourly revenue × {@link INCOME_TAX_RATE}.
 *   - **Expenses**       = civic building upkeep + welfare for unemployed
 *                          citizens.
 *   - **Budget**        += tax income − expenses.
 *   - **Derived stats**  are refreshed for the HUD.
 *
 * @param world The world to mutate (budget, derivedStats, lastEconomyHour,
 *              lastRevenueBaseline).
 */
export function tickEconomy(world: World): void {
  const currentHour = integerHour(world.simTime.elapsedHours);

  // Only run the economy once per new integer sim-hour.
  if (currentHour <= world.lastEconomyHour) {
    return;
  }

  // ── Tax income ──────────────────────────────────────────────────────────
  // Per-hour revenue = current cumulative company revenue minus the total
  // at the previous tick.  The city taxes this hourly gain.
  const revenueNow = totalCompanyRevenue(world);
  const hourlyRevenue = Math.max(0, revenueNow - world.lastRevenueBaseline);
  const taxIncome = hourlyRevenue * INCOME_TAX_RATE;

  // ── City expenses ───────────────────────────────────────────────────────
  const civicUpkeep = sumCivicUpkeep(world);
  const unemployed = countUnemployed(world);
  const welfare = unemployed * WELFARE_PER_CITIZEN;
  const expenses = civicUpkeep + welfare;

  // ── Budget update ───────────────────────────────────────────────────────
  world.budget += taxIncome - expenses;

  // ── Derived stats refresh ───────────────────────────────────────────────
  const population = world.citizens.size;
  const employed = countEmployed(world);
  world.derivedStats.lastHourTaxIncome = taxIncome;
  world.derivedStats.lastHourExpenses = expenses;
  world.derivedStats.population = population;
  world.derivedStats.employmentRate =
    population > 0 ? employed / population : 0;

  // Record state so the next tick computes a fresh hourly delta.
  world.lastRevenueBaseline = revenueNow;
  world.lastEconomyHour = currentHour;
}
