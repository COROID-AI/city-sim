/**
 * buildCitySnapshot — pure-function unit tests.
 *
 * Spec reference: §6.4 Dashboard Layout.
 *
 * The builder is a pure function; we mock NeedSystem + EconomySystem
 * + CommuteManager outputs by hand-rolling the input object. Tests
 * assert that:
 *   - population is derived from the citizen list;
 *   - avgNeeds is the mean across all four need fields;
 *   - budget is forwarded verbatim;
 *   - the inputs are NOT mutated.
 */
import { buildCitySnapshot, emptyCitySnapshot } from '@/ui/CitySnapshot';
import type { Citizen, Needs } from '@/entities';
import type { BuildingId, CitizenId, CompanyId } from '@/types/common';

function makeNeeds(values: Partial<Needs> = {}): Needs {
  return {
    energy: values.energy ?? 50,
    hunger: values.hunger ?? 50,
    fun: values.fun ?? 50,
    social: values.social ?? 50,
  };
}

function makeCitizen(id: string, needs: Partial<Needs> = {}): Citizen {
  const fullNeeds = makeNeeds(needs);
  return {
    id: id as CitizenId,
    position: { x: Number(id) * 10, y: 0 },
    name: `c-${id}`,
    needs: fullNeeds,
    currentActivity: 'sleep',
    workplaceId: null,
    homeId: 'home' as BuildingId,
    schedule: Array.from({ length: 24 }, () => 'sleep' as const),
  };
}

describe('buildCitySnapshot', () => {
  it('returns an empty snapshot when called with no citizens or vehicles', () => {
    const snap = buildCitySnapshot({
      day: 0,
      hour: 0,
      minute: 0,
      budget: 0,
      openCompanies: 0,
      totalCompanies: 0,
    });
    expect(snap.population).toBe(0);
    expect(snap.avgNeeds).toBe(0);
    expect(snap.citizens).toHaveLength(0);
    expect(snap.vehicles).toHaveLength(0);
    expect(snap.buildings).toHaveLength(0);
  });

  it('derives population, avgNeeds, and budget from the inputs', () => {
    const citizens: Citizen[] = [
      makeCitizen('1', { energy: 80, hunger: 60, fun: 40, social: 20 }),
      makeCitizen('2', { energy: 20, hunger: 40, fun: 60, social: 80 }),
    ];
    const snap = buildCitySnapshot({
      day: 3,
      hour: 10,
      minute: 30,
      budget: 12_345,
      openCompanies: 4,
      totalCompanies: 5,
      citizens,
    });
    // Population.
    expect(snap.population).toBe(2);
    // (200 + 200) / (2 * 4) = 50
    expect(snap.avgNeeds).toBe(50);
    expect(snap.budget).toBe(12_345);
    expect(snap.day).toBe(3);
    expect(snap.hour).toBe(10);
    expect(snap.minute).toBe(30);
    expect(snap.openCompanies).toBe(4);
    expect(snap.totalCompanies).toBe(5);
  });

  it('does not mutate the input citizens or companies arrays', () => {
    const citizens: Citizen[] = [
      makeCitizen('1', { energy: 70, hunger: 70, fun: 70, social: 70 }),
    ];
    const companies = [
      {
        id: 'co-1' as CompanyId,
        buildingTypeId: 'office',
        position: { x: 50, y: 50 },
        status: 'open' as const,
        employees: [],
        totalRevenue: 0,
        totalWages: 0,
        totalTax: 0,
        ledger: [],
        openedOnDay: 0,
      },
    ];
    const beforeCitizens = JSON.stringify(citizens);
    const beforeCompanies = JSON.stringify(companies);
    buildCitySnapshot({
      day: 0,
      hour: 0,
      minute: 0,
      budget: 100,
      openCompanies: 1,
      totalCompanies: 1,
      citizens,
      companies,
    });
    expect(JSON.stringify(citizens)).toBe(beforeCitizens);
    expect(JSON.stringify(companies)).toBe(beforeCompanies);
  });

  it('emits a frozen output that downstream consumers cannot mutate', () => {
    const snap = buildCitySnapshot({
      day: 0,
      hour: 0,
      minute: 0,
      budget: 0,
      openCompanies: 0,
      totalCompanies: 0,
    });
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.citizens)).toBe(true);
    expect(Object.isFrozen(snap.worldBounds)).toBe(true);
  });

  it('emptyCitySnapshot returns a zeroed snapshot', () => {
    const snap = emptyCitySnapshot();
    expect(snap.day).toBe(0);
    expect(snap.population).toBe(0);
    expect(snap.budget).toBe(0);
  });
});
