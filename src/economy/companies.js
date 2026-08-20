/**
 * Company registry.
 *
 * Every workplace, shop, restaurant, and entertainment venue building hosts a
 * Company with a full operating ledger: identity, industry, employee roster,
 * wage bill, revenue, expenses, profit, and cash reserve. Company objects are
 * created here from the building list and later driven by the hourly economy
 * tick (src/economy/tick.js).
 */

import { RNG } from '../core/rng.js';
import { ECONOMY_CONST } from './config.js';

const STEMS = [
  'Meridian', 'Summit', 'Atlas', 'Orbit', 'Crest', 'Nova', 'Vertex', 'Axis',
  'Lumen', 'Pinnacle', 'Harbor', 'Aurora', 'Cobalt', 'Vantage', 'Corvus',
];
const SUFFIXES = ['Inc.', 'Ltd.', 'Group', 'Holdings', 'Partners', 'Co.', 'Works'];

/** Map a building to the industry of the company that operates from it. */
export function industryFor(building) {
  if (building.zone === 'service') {
    if (building.subType === 'restaurant') return 'food';
    if (building.subType === 'shop') return 'retail';
    return 'entertainment'; // park
  }
  if (building.zone === 'entertainment') return 'entertainment';
  return 'office'; // workplace
}

/** Sector label (matches the documented Company type) for an industry. */
export function sectorForIndustry(industry) {
  if (industry === 'retail' || industry === 'food') return industry;
  if (industry === 'entertainment') return 'entertainment';
  return 'office';
}

/**
 * Create one Company per workplace / shop / restaurant / entertainment venue.
 * @param {object} city  CityState ({ buildings }).
 * @param {RNG} rng  Deterministic PRNG.
 * @returns {object[]} Array of Company objects.
 */
export function createCompanies(city, rng) {
  const companies = [];
  let id = 1;
  for (const b of city.buildings) {
    if (b.zone !== 'workplace' && b.zone !== 'service' && b.zone !== 'entertainment') {
      continue;
    }
    const industry = industryFor(b);
    companies.push({
      id: id++,
      name: `${rng.pick(STEMS)} ${rng.pick(SUFFIXES)}`,
      buildingId: b.id,
      building: b,
      industry,
      sector: sectorForIndustry(industry),
      employeeIds: [],
      employeeRoster: [],
      wageBill: 0,
      wages: 0,
      revenue: 0,
      expenses: 0,
      rent: 0,
      supplies: 0,
      profit: 0,
      cash: rng.int(ECONOMY_CONST.STARTING_CASH_MIN, ECONOMY_CONST.STARTING_CASH_MAX),
      visits: 0,
      spend: 0,
      customers: [],
      reputation: rng.int(50, 95),
      detailSeed: rng.int(1, 1000000000),
    });
  }
  return companies;
}