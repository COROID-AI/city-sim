/**
 * Hourly economy tick.
 *
 * Subscribed to the SimClock (via src/economy/index.js). Every sim-hour it
 * recomputes each company's revenue (customer visits x spend, or office
 * output), expenses (wages + rent + supplies), profit, and rolls the result
 * into company cash. It also aggregates city-level economy metrics. The tick
 * is idempotent per sim-hour and independent of frame rate.
 */

import { ECONOMY_CONST } from './config.js';
import { countVisits } from './labor.js';

function officeOpen(hour) {
  return hour >= ECONOMY_CONST.OFFICE_OPEN_START && hour < ECONOMY_CONST.OFFICE_OPEN_END;
}

/**
 * Recomputed per-company books and city aggregates for one sim-hour.
 * @param {object} city  CityState ({ companies, citizens, economy }).
 * @param {object} clock  SimClock ({ simHour }).
 */
export function updateHourlyEconomy(city, clock) {
  const hour = clock.simHour;
  const SPEND = ECONOMY_CONST.SPEND_PER_VISIT;
  let totalRevenue = 0;
  let totalExpenses = 0;
  let totalProfit = 0;

  for (const co of city.companies) {
    const wages = co.wageBill / ECONOMY_CONST.WAGE_HOURS_PER_DAY;
    let revenue = 0;
    let visits = 0;
    let spend = 0;

    if (co.industry === 'office') {
      revenue = officeOpen(hour)
        ? co.employeeRoster.length * ECONOMY_CONST.OFFICE_OUTPUT_PER_WORKER
        : 0;
    } else {
      const visit = countVisits(co, city);
      visits = visit.visits;
      revenue = visits * SPEND[co.industry] * visit.demandFactor;
      spend = revenue;
    }

    const rent = ECONOMY_CONST.RENT_PER_HOUR[co.industry] || 0;
    const supplies =
      visits * ECONOMY_CONST.SUPPLIES_PER_VISIT +
      co.employeeRoster.length * ECONOMY_CONST.SUPPLIES_PER_WORKER_HOUR;
    const expenses = wages + rent + supplies;
    const profit = revenue - expenses;

    co.visits = visits;
    co.spend = spend;
    co.wages = wages;
    co.rent = rent;
    co.supplies = supplies;
    co.revenue = revenue;
    co.expenses = expenses;
    co.profit = profit;
    co.cash += profit;

    totalRevenue += revenue;
    totalExpenses += expenses;
    totalProfit += profit;
  }

  city.economy.revenue = totalRevenue;
  city.economy.expenses = totalExpenses;
  city.economy.profit = totalProfit;
}