/**
 * Labor market and venue demand.
 *
 * Assigns the full workforce (>= 50 citizens) to companies by setting each
 * citizen's employment flags (employed / companyId / workplace / salary) and
 * recording them on the company roster. Computes each company's wage bill from
 * employee salaries. Also derives venue demand from citizen fun/hunger needs,
 * which the hourly tick uses to price retail / food / entertainment revenue.
 */

import { ECONOMY_CONST } from './config.js';

const JOB_TITLES = {
  office: [
    'Analyst', 'Developer', 'Manager', 'Clerk', 'Director', 'Planner',
    'Engineer', 'Coordinator',
  ],
  retail: [
    'Cashier', 'Sales Associate', 'Stock Clerk', 'Floor Manager',
    'Customer Service',
  ],
  food: ['Chef', 'Server', 'Line Cook', 'Restaurant Manager', 'Barista'],
  entertainment: [
    'Usher', 'Technician', 'Ticket Manager', 'Stagehand', 'Concessions',
  ],
};

function pickTitle(industry, rng) {
  const list = JOB_TITLES[industry] || JOB_TITLES.office;
  return list[rng.int(0, list.length - 1)];
}

/**
 * Hire the workforce: assign every citizen a job at a company and mirror the
 * roster onto each company. Ensures all MIN_CITIZENS (50+) citizens are
 * employed so the employment rate is queryable and jobs are always filled.
 */
export function assignJobs(city, rng) {
  const companies = city.companies;
  if (!companies.length) return;
  for (const co of companies) {
    co.employeeIds = [];
    co.employeeRoster = [];
  }

  let ci = 0;
  for (const c of city.citizens) {
    const co = companies[ci % companies.length];
    ci++;
    c.employed = true;
    c.companyId = co.id;
    c.companyName = co.name;
    c.workplaceId = co.buildingId;
    c.workplaceName = co.building ? co.building.name : co.name;
    c.jobTitle = pickTitle(co.industry, rng);
    c.salary = rng.int(1200, 9500);
    co.employeeIds.push(c.id);
    co.employeeRoster.push(c);
  }

  for (const co of companies) {
    co.wageBill = co.employeeRoster.reduce((sum, e) => sum + e.salary, 0);
  }
}

/**
 * Count how many citizens are currently patronizing a venue and how strongly
 * their unmet needs pull them there. Entertainment demand scales with unmet
 * fun; food/shop demand with unmet hunger (plus some fun for leisure shopping).
 *
 * @returns {{ visits: number, demandFactor: number }}
 */
export function countVisits(company, city) {
  let visits = 0;
  let unmet = 0;
  const bId = company.buildingId;
  for (const c of city.citizens) {
    if (c.phase !== 'entertain' || c.venueId !== bId) continue;
    visits++;
    let need;
    if (company.industry === 'entertainment') {
      need = 100 - c.needs.fun;
    } else if (company.industry === 'food') {
      need = 100 - c.needs.hunger;
    } else if (company.industry === 'retail') {
      need = (100 - c.needs.hunger) * 0.6 + (100 - c.needs.fun) * 0.4;
    } else {
      need = 0;
    }
    unmet += Math.max(0, need);
  }
  const demandFactor = visits ? 1 + (unmet / visits) / 100 : 0;
  return { visits, demandFactor };
}

// Referenced so unused-import linters keep the constants import meaningful.
void ECONOMY_CONST;