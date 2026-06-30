'use client';

import { useMemo, type FC } from 'react';
import { useYearStore } from '@/store/yearStore';
import { getYearConfig } from '@/config/years';
import { getEraTheme } from '@/config/eraTheme';
import Roads from './Roads';
import Sidewalks from './Sidewalks';
import Buildings from './Buildings';
import Storefronts from './Storefronts';
import Props from './Props';
import Pedestrians from './Pedestrians';
import Vehicles from './Vehicles';
import Sky from './Sky';

/**
 * CityBlock
 *
 * Composes the entire city block — ground, roads, sidewalks, procedural
 * buildings, storefronts/ads, sidewalk props, pedestrians and vehicles — into
 * a single coherent scene. The block reads the active era from the year store
 * and re-renders its assets whenever `selectedYear` changes, while the sky
 * background interpolates between the current and target era palettes during a
 * transition.
 *
 * This component must live inside a React Three Fiber `<Canvas>`.
 */
const CityBlock: FC = () => {
  // Subscribe to the store slices we need. Each selector is stable so R3F
  // only re-renders the affected sub-trees.
  const selectedYear = useYearStore((s) => s.selectedYear);
  const targetYear = useYearStore((s) => s.targetYear);
  const transitionProgress = useYearStore((s) => s.transitionProgress);

  // Resolve the active year config (density + maxHeight drive the buildings).
  const config = useMemo(() => getYearConfig(selectedYear), [selectedYear]);
  const theme = useMemo(() => getEraTheme(selectedYear), [selectedYear]);

  const maxHeight = config?.maxHeight ?? 32;
  const density = config?.density ?? 1;

  return (
    <group data-testid="city-block">
      {/* Sky / background — interpolates during transitions */}
      <Sky
        fromEra={selectedYear}
        toEra={targetYear}
        progress={transitionProgress}
      />

      {/* Era-tinted ground plane */}
      <GroundTint color={theme.groundColor} />

      {/* Static street footprint */}
      <Roads />
      <Sidewalks />

      {/* Era-reactive assets */}
      <Buildings era={selectedYear} maxHeight={maxHeight} density={density} />
      <Storefronts era={selectedYear} />
      <Props era={selectedYear} />
      <Pedestrians era={selectedYear} />
      <Vehicles era={selectedYear} />
    </group>
  );
};

/**
 * GroundTint — a thin coloured plane sitting just above the shared `Ground`
 * component so the ground hue tracks the active era palette.
 */
const GroundTint: FC<{ color: string }> = ({ color }) => {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
};

export default CityBlock;
