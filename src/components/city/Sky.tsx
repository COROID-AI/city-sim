import { useMemo, type FC } from 'react';
import { getEraTheme, type SkyPalette } from '@/config/eraTheme';
import { lerpColor } from '@/utils/color';
import type { EraId } from '@/config/years';

/**
 * Sky / background.
 *
 * Interpolates between the current era's sky palette and the target era's
 * palette using the transition progress from the year store, producing a smooth
 * cross-fade as the user scrubs the timeline.
 */
interface SkyProps {
  /** Era currently settled. */
  fromEra: EraId;
  /** Era being transitioned towards. */
  toEra: EraId;
  /** Transition progress [0, 1]; 1 = fully at `toEra`. */
  progress: number;
}

const Sky: FC<SkyProps> = ({ fromEra, toEra, progress }) => {
  const { top, bottom } = useMemo(() => {
    const from: SkyPalette = getEraTheme(fromEra).sky;
    const to: SkyPalette = getEraTheme(toEra).sky;
    return {
      top: lerpColor(from.top, to.top, progress),
      bottom: lerpColor(from.bottom, to.bottom, progress),
    };
  }, [fromEra, toEra, progress]);

  return (
    <>
      {/* Large backdrop sphere with a vertical gradient via two hemispheres */}
      <mesh scale={[500, 500, 500]}>
        <sphereGeometry args={[1, 32, 16]} />
        <meshBasicMaterial color={top} side={1} /* BackSide */ fog={false} />
      </mesh>
      {/* Horizon glow dome */}
      <mesh position={[0, -20, 0]} scale={[500, 250, 500]}>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
        <meshBasicMaterial color={bottom} side={1} fog={false} transparent opacity={0.85} />
      </mesh>
    </>
  );
};

export default Sky;
