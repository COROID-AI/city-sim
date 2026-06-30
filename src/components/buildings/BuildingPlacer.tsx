/**
 * BuildingPlacer component.
 *
 * A thin wrapper around `Buildings` that exposes the layout data for testing
 * and debugging. In production it simply renders the `Buildings` group.
 */
'use client';

import type { FC } from 'react';
import Buildings from './Buildings';

/**
 * Places buildings on the city block. Delegates to `Buildings` for rendering.
 */
const BuildingPlacer: FC = () => {
  return <Buildings />;
};

export default BuildingPlacer;
