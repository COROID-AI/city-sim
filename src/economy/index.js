/**
 * Economy entrypoint.
 *
 * Composes the company registry, labor market, hourly tick, and city budget
 * into one object the game loop subscribes to the SimClock. Exposes
 * createEconomy() to boot the economy and tickEconomy() as the idempotent
 * per-sim-hour update that keeps the ledger, treasury, and HUD metrics live.
 */

import { CONFIG } from '../core/config.js';
import { RNG } from '../core/rng.js';
import { createCompanies } from './companies.js';
import { assignJobs } from './labor.js';
import { updateHourlyEconomy } from './tick.js';
import { updateBudget } from './budget.js';

/**
 * Boot the economy: create companies, hire the workforce, and initialize the
 * treasury + HUD metrics on the CityState.
 * @param {object} city  CityState ({ buildings, citizens }).
 * @param {object} config  SimConfig.
 * @returns {object} Economy/treasury handle ({ budget, ... }).
 */
export function createEconomy(city, config = CONFIG) {
  const rng = new RNG(config.SEED + 13);
  city.companies = createCompanies(city, rng);
  assignJobs(city, rng);

  const employed = city.citizens.filter((c) => c.employed).length;
  city.economy = {
    budget: config.STARTING_BUDGET,
    revenue: 0,
    expenses: 0,
    profit: 0,
    population: city.citizens.length,
    employed,
    employmentRate: city.citizens.length ? employed / city.citizens.length : 0,
    lastUpdatedHour: -1,
  };

  return {
    budget: config.STARTING_BUDGET,
    taxIncome: 0,
    publicSpending: 0,
    net: 0,
    revenue: 0,
    expenses: 0,
    population: city.citizens.length,
    employed,
    employmentRate: city.economy.employmentRate,
    simHour: 0,
    simDay: 1,
  };
}

/**
 * Idempotent per-sim-hour economy update. Safe to call every frame; it only
 * advances the ledger once per sim-hour boundary, independent of frame rate.
 */
export function tickEconomy(city, economy, clock) {
  if (city.economy.lastUpdatedHour === clock.simHour) return;
  updateHourlyEconomy(city, clock);
  updateBudget(city, economy, clock);
  city.economy.lastUpdatedHour = clock.simHour;
  logEconomy(city, economy, clock);
}

/** Emit a compact hourly snapshot so the economy is observably live. */
function logEconomy(city, economy, clock) {
  const top = city.companies
    .slice()
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 3)
    .map((co) => `${co.name} ${Math.round(co.profit)}`)
    .join(', ');
  console.log(
    `[economy] day ${clock.simDay} hour ${String(clock.simHour).padStart(2, '0')} ` +
      `budget $${economy.budget.toLocaleString()} ` +
      `tax $${Math.round(economy.taxIncome)} spend $${Math.round(economy.publicSpending)} ` +
      `companies ${city.companies.length} employed ${city.economy.employed}/${city.economy.population} ` +
      `| top: ${top}`,
  );
}