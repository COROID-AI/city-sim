/**
 * Buildings group component.
 *
 * Reads the current era from the year store, generates a deterministic layout
 * via `useBuildingLayout`, and renders one `Building` per placement. Supports
 * transition cross-fade by reading `transitionProgress` and `targetYear`.
 */
'use client';

import { useMemo } from 'react';
import type { FC } from 'react';
import { useYearStore } from '@/store/yearStore';
import { getYearConfig, type YearConfig } from '@/config/years';
import Building from './Building';
import { useBuildingLayout, type BuildingPlacement } from './useBuildingLayout';

/**
 * Render a single building from a placement descriptor.
 */
const BuildingFromPlacement: FC<{
  readonly placement: BuildingPlacement;
  readonly style: YearConfig['buildingStyle'];
  readonly transitionColor?: string;
  readonly transitionProgress: number;
}> = ({ placement, style, transitionColor, transitionProgress }) => {
  const { styleConfig, position, width, depth, height } = placement;
  return (
    <Building
      style={style}
      height={height}
      facadeColor={styleConfig.facadeColor}
      windowPattern={styleConfig.windowPattern}
      roof={styleConfig.roof}
      signage={styleConfig.signage}
      transitionColor={transitionColor}
      transitionProgress={transitionProgress}
      width={width}
      depth={depth}
      position={position}
    />
  );
};

/**
 * Buildings group. Renders the full city block for the current era.
 */
const Buildings: FC = () => {
  const selectedYear = useYearStore((s) => s.selectedYear);
  const targetYear = useYearStore((s) => s.targetYear);
  const transitionProgress = useYearStore((s) => s.transitionProgress);

  const currentConfig = useMemo<YearConfig | undefined>(
    () => getYearConfig(selectedYear),
    [selectedYear],
  );

  const targetConfig = useMemo<YearConfig | undefined>(
    () => getYearConfig(targetYear),
    [targetYear],
  );

  const resolvedConfig = currentConfig ?? getYearConfig('present')!;
  const placements = useBuildingLayout(resolvedConfig);

  // During transition, cross-fade toward the target era's palette color.
  const isTransitioning = transitionProgress > 0 && transitionProgress < 1;
  const transitionColor = isTransitioning
    ? targetConfig?.palette
    : undefined;

  return (
    <group>
      {placements.map((placement) => (
        <BuildingFromPlacement
          key={placement.id}
          placement={placement}
          style={resolvedConfig.buildingStyle}
          transitionColor={transitionColor}
          transitionProgress={isTransitioning ? transitionProgress : 0}
        />
      ))}
    </group>
  );
};

export default Buildings;
