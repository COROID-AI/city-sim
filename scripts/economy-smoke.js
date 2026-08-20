/**
 * Headless smoke test for the economy layer.
 * Verifies the acceptance criteria without a browser:
 *   - Every workplace / shop / restaurant / entertainment building hosts a Company
 *   - Company detail: name, industry, employees, wage bill, revenue, expenses, profit, cash
 *   - >= 50 citizens assigned to jobs
 *   - Economy runs once per sim-hour (idempotent), treasury moves, no NaN/Infinity
 */
import { CONFIG } from '../src/core/config.js';
import { generateCity } from '../src/world/generate.js';
import { populateCitizens } from '../src/citizens/populate.js';
import { advanceSchedules } from '../src/citizens/schedule.js';
import { updateCitizens } from '../src/citizens/update.js';
import { SimClock } from '../src/core/clock.js';
import { createEconomy, tickEconomy } from '../src/economy/index.js';

const world = generateCity(CONFIG.SEED, CONFIG);
const { city } = populateCitizens(world, CONFIG);
const economy = createEconomy(city, CONFIG);

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

// 1. Every workplace / shop / restaurant / entertainment building hosts a company.
const hostZones = new Set(['workplace', 'service', 'entertainment']);
const hostBuildings = city.buildings.filter((b) => hostZones.has(b.zone));
const hostedIds = new Set(city.companies.map((co) => co.buildingId));
check(
  'every workplace/shop/entertainment building hosts a company',
  hostBuildings.every((b) => hostedIds.has(b.id)),
  `hosted=${hostedIds.size}/${hostBuildings.length}`,
);

// 2. Company detail fields present.
const co = city.companies[0];
check(
  'company has full detail fields',
  co && co.id && co.name && co.buildingId && co.building && co.industry &&
    Array.isArray(co.employeeRoster) && Array.isArray(co.employeeIds) &&
    Number.isFinite(co.wageBill) && Number.isFinite(co.revenue) &&
    Number.isFinite(co.expenses) && Number.isFinite(co.profit) &&
    Number.isFinite(co.cash),
  co ? `${co.name} [${co.industry}]` : 'none',
);

// 3. >= 50 citizens assigned to jobs.
check('>=50 citizens employed', city.economy.employed >= 50, `employed=${city.economy.employed}`);
const worker = city.citizens.find((c) => c.employed);
check(
  'employed citizen has job/salary/employer',
  worker && worker.jobTitle !== 'Unemployed' && worker.salary > 0 &&
    worker.workplaceId && worker.companyId,
  worker ? `${worker.jobTitle} @ ${worker.companyName}` : 'none',
);

// 4. Run a simulated day: clock + schedules + hourly economy.
const clock = new SimClock(CONFIG, 6);
clock.start(0);
clock.subscribe((c) => {
  advanceSchedules(city, c);
  tickEconomy(city, economy, c);
});
let now = 0;
for (let h = 0; h < 28; h++) {
  now += CONFIG.SECONDS_PER_SIM_HOUR * 1000;
  clock.tick(now);
  updateCitizens(city, clock, 0.05);
}

// 5. Economy is live: budget moved, metrics published.
check('city treasury budget moved', economy.budget !== CONFIG.STARTING_BUDGET,
  `budget=${Math.round(economy.budget).toLocaleString()}`);
check('employment rate published (0-1)', economy.employmentRate > 0 && economy.employmentRate <= 1,
  `rate=${economy.employmentRate.toFixed(2)}`);
check('population + city time published',
  economy.population === city.citizens.length &&
    Number.isFinite(economy.simHour) && Number.isFinite(economy.simDay),
  `pop=${economy.population} hour=${economy.simHour}`);

// 6. No NaN/Infinity across company books and treasury.
const allFinite = city.companies.every((c2) =>
  Number.isFinite(c2.revenue) && Number.isFinite(c2.expenses) &&
  Number.isFinite(c2.profit) && Number.isFinite(c2.cash) &&
  Number.isFinite(c2.wageBill));
check('no NaN/Infinity in company books', allFinite);
check('no NaN/Infinity in treasury',
  Number.isFinite(economy.budget) && Number.isFinite(economy.taxIncome) &&
    Number.isFinite(economy.publicSpending) && Number.isFinite(economy.net));

// 7. Idempotency: calling tickEconomy again at the same hour does not double-apply.
const budgetBefore = economy.budget;
tickEconomy(city, economy, { simHour: clock.simHour, simDay: clock.simDay });
check('idempotent per sim-hour (no double apply)', economy.budget === budgetBefore);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);