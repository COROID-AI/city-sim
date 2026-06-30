/**
 * StreetLife — orchestrates pedestrians and vehicles for the active era.
 *
 * Reads the selected era from the year store and renders the
 * {@link Pedestrians} and {@link Vehicles} components with the appropriate
 * props. This is the single entry point consumed by the scene.
 */
'use client';

import { useMemo, type FC } from 'react';
import { useYearStore } from '@/store/yearStore';
import Pedestrians from './Pedestrians';
import Vehicles from './Vehicles';

/**
 * Street-life container.
 *
 * Subscribes to `selectedYear` so the crowd and traffic update whenever the
 * timeline settles on a new era. During a transition the settled era is
 * shown; the transition-animation task will handle cross-fading.
 */
const StreetLife: FC = () => {
  const era = useYearStore((s) => s.selectedYear);

  // Stable key forces remount when era changes so instanced meshes
  // re-initialise colours cleanly.
  const key = useMemo(() => `streetlife-${era}`, [era]);

  return (
    <group key={key}>
      <Pedestrians era={era} />
      <Vehicles era={era} />
    </group>
  );
};

export default StreetLife;
