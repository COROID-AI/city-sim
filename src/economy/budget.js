/**
 * City budget simulation.
 *
 * Each sim-hour the treasury collects taxes (a share of company profits plus
 * citizen income tax) and pays public spending (services, streetlights,
 * transit subsidy). The balance updates the treasury and publishes the HUD
 * contract: population, employment rate, city time, and budget.
 */

import { ECONOMY_CONST } from './config.js';

/**
 * Recompute the city treasury and HUD-facing economy metrics for the hour.
 * @param {object} city  City state { citizens, companies, economy }.
 * @param {object} economy  Live economy/treasury object.
 * @param {object} clock  SimClock ({ simHour, simDay }).
 */
export function updateBudget(city, economy, clock) {
  const population = city.citizens.length;
  const employed = city.citizens.filter((c) => c.employed).length;
  const employmentRate = population ? employed / population : 0;

  // Income: corporate profit share + citizen income tax (hourly).
  const totalProfit = city.economy.profit;
  const companyTax = totalProfit > 0 ? totalProfit * ECONOMY_CONST.COMPANY_TAX_RATE : 0;
  const wageTotal = city.companies.reduce((sum, co) => sum + co.wageBill, 0);
  const incomeTax =
    (wageTotal / ECONOMY_CONST.WAGE_HOURS_PER_DAY) * ECONOMY_CONST.INCOME_TAX_RATE;
  const taxIncome = companyTax + incomeTax;

  // Public spending: services, streetlights, transit subsidy.
  const publicSpending =
    population * ECONOMY_CONST.SERVICES_PER_CITIZEN +
    ECONOMY_CONST.STREETLIGHTS_PER_HOUR +
    ECONOMY_CONST.TRANSIT_SUBSIDY_PER_HOUR;

  const net = taxIncome - publicSpending;

  economy.budget += net;
  economy.taxIncome = taxIncome;
  economy.publicSpending = publicSpending;
  economy.net = net;
  economy.revenue = city.economy.revenue;
  economy.expenses = city.economy.expenses;

  // Publish the HUD contract.
  economy.population = population;
  economy.employmentRate = employmentRate;
  economy.simHour = clock.simHour;
  economy.simDay = clock.simDay;
  economy.employed = employed;

  city.economy.budget = economy.budget;
  city.economy.population = population;
  city.economy.employed = employed;
  city.economy.employmentRate = employmentRate;
}