/**
 * Population generation.
 *
 * Creates the city's living population at world boot: 50+ citizens, each with
 * full personal detail (first + last name, age, gender), a home building, an
 * employer (workplace building + placeholder company that the economy task
 * will formalize), a job title and salary, personal funds, hunger/energy/fun
 * needs, happiness, and an initial sleeping schedule. Employment is tracked
 * per citizen and rolled up into the economy's employment rate so the HUD can
 * display it.
 */

import { CONFIG } from '../core/config.js';
import { RNG } from '../core/rng.js';

const FIRST_NAMES = [
  'Ada', 'Ben', 'Chloe', 'Diego', 'Elena', 'Felix', 'Grace', 'Hugo', 'Isla',
  'Jonas', 'Kira', 'Liam', 'Maya', 'Noah', 'Olive', 'Pablo', 'Quinn', 'Rosa',
  'Sam', 'Tara', 'Uma', 'Viktor', 'Wren', 'Xander', 'Yara', 'Zoe',
];

const LAST_NAMES = [
  'Ashton', 'Barlow', 'Crane', 'Dupont', 'Elliot', 'Farrell', 'Grant', 'Hale',
  'Idris', 'Jensen', 'Kane', 'Lopez', 'Mercer', 'Novak', 'Ortiz', 'Patel',
  'Quinn', 'Reyes', 'Stone', 'Tanaka', 'Voss', 'Walsh', 'Yamada', 'Zeller',
];

const JOB_TITLES = {
  office: [
    'Analyst', 'Developer', 'Manager', 'Clerk', 'Director', 'Planner',
    'Engineer', 'Coordinator',
  ],
  retail: [
    'Cashier', 'Sales Associate', 'Stock Clerk', 'Floor Manager',
    'Customer Service',
  ],
  food: [
    'Chef', 'Server', 'Line Cook', 'Restaurant Manager', 'Barista',
  ],
  entertainment: [
    'Usher', 'Technician', 'Ticket Manager', 'Stagehand', 'Concessions',
  ],
};

const COMPANY_STEMS = [
  'Meridian', 'Summit', 'Atlas', 'Orbit', 'Crest', 'Nova', 'Vertex', 'Axis',
  'Lumen', 'Pinnacle',
];
const COMPANY_SUFFIXES = ['Inc.', 'Ltd.', 'Group', 'Holdings', 'Partners', 'Co.'];

/** Sector label for a workplace/service building, used to pick job titles. */
function sectorFor(b) {
  if (b.zone === 'service') {
    if (b.subType === 'restaurant') return 'food';
    if (b.subType === 'shop') return 'retail';
    return 'entertainment'; // park
  }
  return 'office';
}

/**
 * Build one placeholder company per workplace/service building. The economy
 * task later formalizes these into real company entities; for now they give
 * citizens an employer to report to.
 */
function buildCompanies(world, rng) {
  const companies = [];
  let id = 1;
  for (const b of world.buildings) {
    if (b.zone === 'workplace' || b.zone === 'service') {
      companies.push({
        id: id++,
        name: `${rng.pick(COMPANY_STEMS)} ${rng.pick(COMPANY_SUFFIXES)}`,
        sector: sectorFor(b),
        buildingId: b.id,
        employeeIds: [],
        revenue: 0,
        expenses: 0,
        cash: rng.int(10000, 120000),
        reputation: rng.int(50, 95),
        detailSeed: rng.int(1, 1000000000),
      });
    }
  }
  return companies;
}

/** Build a single fully-detailed citizen starting the day asleep at home. */
function makeCitizen(id, home, rng) {
  const gender = rng.pick(['female', 'male', 'nonbinary']);
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  const age = rng.int(18, 65);
  const door = home.door;
  const tile = { x: door.x + 0.5, y: door.y + 0.5 };

  return {
    id: id + 1,
    firstName: first,
    lastName: last,
    name: `${first} ${last}`,
    age,
    gender,
    homeId: home.id,
    homeName: home.name,
    workplaceId: null,
    workplaceName: null,
    companyId: null,
    companyName: null,
    jobTitle: 'Unemployed',
    salary: 0,
    employed: false,
    wallet: rng.int(400, 22000),
    needs: {
      hunger: rng.int(55, 100),
      energy: rng.int(55, 100),
      fun: rng.int(45, 100),
    },
    happiness: rng.int(55, 100),
    mood: rng.int(55, 100),
    tile,
    target: { x: door.x, y: door.y },
    path: [],
    pathIndex: 0,
    speed: 13,
    jitter: rng.int(-1, 1),
    phase: 'sleep',
    animation: 'asleep',
    facing: 's',
    scheduleIdx: 0,
    detailSeed: rng.int(1, 1000000000),
  };
}

/** Assign citizens to placeholder companies round-robin, respecting unemployment. */
function assignEmployment(citizens, companies, buildingById, rng) {
  if (!companies.length) return;
  let ci = 0;
  for (const c of citizens) {
    if (rng.chance(0.12)) continue; // a little unemployment for realism
    const company = companies[ci % companies.length];
    ci++;
    const b = buildingById.get(company.buildingId);
    c.employed = true;
    c.companyId = company.id;
    c.companyName = company.name;
    c.workplaceId = company.buildingId;
    c.workplaceName = b ? b.name : company.name;
    c.jobTitle = rng.pick(JOB_TITLES[company.sector] || JOB_TITLES.office);
    c.salary = rng.int(1500, 9000);
    company.employeeIds.push(c.id);
  }
}

/**
 * Populate the city with citizens and build the shared CityState.
 * @param {object} world  Generated world ({ buildings, roads, gridSize, ... }).
 * @param {object} config  Tunables config.
 * @returns {{ city: object, citizens: object[] }} CityState + citizens list.
 */
export function populateCitizens(world, config) {
  const rng = new RNG(config.SEED + 7);
  const residential = world.buildings.filter((b) => b.zone === 'residential');
  const count = Math.max(config.MIN_CITIZENS, 50);
  const companies = buildCompanies(world, rng);
  const buildingById = new Map(world.buildings.map((b) => [b.id, b]));

  const citizens = [];
  for (let i = 0; i < count; i++) {
    const home = residential.length
      ? residential[i % residential.length]
      : world.buildings[0];
    citizens.push(makeCitizen(i, home, rng));
  }

  assignEmployment(citizens, companies, buildingById, rng);

  const employed = citizens.filter((c) => c.employed).length;
  const city = {
    ...world,
    citizens,
    companies,
    buildingById,
    economy: {
      budget: config.STARTING_BUDGET,
      revenue: 0,
      expenses: 0,
      population: citizens.length,
      employed,
      employmentRate: citizens.length ? employed / citizens.length : 0,
      lastUpdatedHour: 0,
    },
  };

  return { city, citizens };
}