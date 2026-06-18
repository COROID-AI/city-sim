import { acceptOpportunity, addOpportunity, createCity, recordTick, AppError } from '../city.js';

import { describe, expect, it } from 'vitest';


describe('city domain state machine', () => {
  it('createCity defaults and deterministic population', () => {
    const city = createCity({ seed: 1, width: 10, height: 5, startHour: 8 });
    expect(city.population).toBeGreaterThan(0);
    expect(city.tick).toBe(0);
    expect(city.hour).toBe(8);
    expect(city.opportunities).toHaveLength(0);
  });

  it('recordTick immutability and hour progression', () => {
    const city = createCity({ seed: 2, width: 6, height: 6, startHour: 23 });
    const city1 = recordTick(city);
    expect(city.tick).toBe(0);
    expect(city1.tick).toBe(1);
    expect(city1.hour).toBe(0);
  });

  it('addOpportunity + acceptOpportunity transitions', () => {
    const city = createCity({ seed: 3, width: 4, height: 3, startHour: 10 });
    const withOpp = addOpportunity(city, { kind: 'transport', description: 'New tram line' });
    expect(withOpp.opportunities).toHaveLength(1);

    const opp = withOpp.opportunities[0];
    expect(opp).toBeDefined();
    if (!opp) throw new Error('expected opportunity');

    expect(opp.status).toBe('active');

    const accepted = acceptOpportunity(withOpp, opp.id);
    expect(accepted.opportunities[0]?.status).toBe('accepted');

    expect(withOpp.opportunities[0]?.status).toBe('active');
  });

  it('throws AppError for invalid opportunity input', () => {
    const city = createCity({ seed: 4, width: 3, height: 3, startHour: 1 });
    const fn = () => addOpportunity(city, { kind: 'housing', description: '   ' });
    expect(fn).toThrow(AppError);
  });
});
