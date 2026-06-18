import { acceptOpportunity, addOpportunity, createCity, recordTick } from '../city.js';

import { describe, expect, it } from 'vitest';


describe('city smoke - public surface', () => {
  it('create city -> 3 ticks -> add+accept opportunity -> final state shape', () => {
    const city0 = createCity({ seed: 42, width: 8, height: 6, startHour: 9 });
    const city1 = recordTick(city0);
    const city2 = recordTick(city1);
    const city3 = recordTick(city2);

    expect(city3.tick).toBe(3);
    expect(city3.hour).toBe(12);

    const city4 = addOpportunity(city3, {
      kind: 'safety',
      description: 'Better street lighting'
    });

    expect(city4.opportunities).toHaveLength(1);

    const opp = city4.opportunities[0];
    expect(opp).toBeDefined();
    if (!opp) throw new Error('expected opportunity');

    expect(opp).toMatchObject({
      kind: 'safety',
      status: 'active',
      createdAtTick: 3
    });

    const accepted = acceptOpportunity(city4, opp.id);
    const acceptedOpp = accepted.opportunities[0];
    expect(acceptedOpp?.status).toBe('accepted');
    expect(accepted).toMatchObject({
      seed: 42,
      width: 8,
      height: 6,
      population: accepted.population
    });
  });
});
