import type { EraId } from '../contracts';
import { getStreetConfig } from './streetConfig';
import { StreetSky } from './StreetSky';
import { StreetLighting } from './StreetLighting';
import { Road } from './Road';
import { StreetFurniture } from './StreetFurniture';

/**
 * The complete street & environment layer for a single era.
 *
 * Composes the era-variant road surface, street furniture, procedural sky, and
 * lighting mood. Accepts the current era id and looks up all per-era visuals
 * from the shared street config registry.
 *
 * This component is fully self-contained and can be dropped into any R3F
 * canvas. Integration into the main scene happens in Phase 4.
 */
export function StreetEnvironment({ era }: { era: EraId }) {
  const config = getStreetConfig(era);

  return (
    <group>
      <StreetSky config={config.sky} />
      <StreetLighting config={config.lighting} />
      <Road config={config.road} />
      <StreetFurniture config={config.furniture} />
    </group>
  );
}
