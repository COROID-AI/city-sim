import { createCity, recordTick } from './domain/city.js';

function formatSummary(city: ReturnType<typeof createCity>): string {
  return [
    'CITY_SIM_SUMMARY',
    `seed=${city.seed}`,
    `size=${city.width}x${city.height}`,
    `startHour=${city.startHour}`,
    `tick=${city.tick}`,
    `hour=${city.hour}`,
    `population=${city.population}`
  ].join('\n');
}

function main(): void {
  const city0 = createCity({ seed: 42, width: 12, height: 8, startHour: 9 });
  const city1 = recordTick(city0);
  const city2 = recordTick(city1);
  const city3 = recordTick(city2);
  // eslint-disable-next-line no-console
  console.log(formatSummary(city3));
}

main();
