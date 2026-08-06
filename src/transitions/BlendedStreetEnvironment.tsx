import { EraCrossfade } from './EraCrossfade';
import { useSceneTransition } from './SceneTransitionContext';
import { lerp, lerpColor, lerpVector3 } from './blend';
import { getStreetConfig } from '../street/streetConfig';
import type { LightingConfig, RoadConfig, SkyConfig } from '../street/streetConfig';
import { StreetSky } from '../street/StreetSky';
import { StreetLighting } from '../street/StreetLighting';
import { Road } from '../street/Road';
import { StreetFurniture } from '../street/StreetFurniture';

/** Interpolate two sky configs into a single morphing sky dome. */
function blendSky(from: SkyConfig, to: SkyConfig, t: number): SkyConfig {
  return {
    topColor: lerpColor(from.topColor, to.topColor, t),
    horizonColor: lerpColor(from.horizonColor, to.horizonColor, t),
    sunColor: lerpColor(from.sunColor, to.sunColor, t),
    sunDirection: lerpVector3(from.sunDirection, to.sunDirection, t),
    sunIntensity: lerp(from.sunIntensity, to.sunIntensity, t),
    haze: lerp(from.haze, to.haze, t),
  };
}

/** Interpolate two lighting moods into one blended light rig. */
function blendLighting(from: LightingConfig, to: LightingConfig, t: number): LightingConfig {
  return {
    ambientIntensity: lerp(from.ambientIntensity, to.ambientIntensity, t),
    hemisphereSky: lerpColor(from.hemisphereSky, to.hemisphereSky, t),
    hemisphereGround: lerpColor(from.hemisphereGround, to.hemisphereGround, t),
    sunColor: lerpColor(from.sunColor, to.sunColor, t),
    sunPosition: lerpVector3(from.sunPosition, to.sunPosition, t),
    sunIntensity: lerp(from.sunIntensity, to.sunIntensity, t),
  };
}

/**
 * Interpolate two road configs. Numeric fields lerp; feature flags are OR'd so
 * markings only one era wants never pop in or out mid-morph (mirrors the
 * effects-config blending policy).
 */
function blendRoad(from: RoadConfig, to: RoadConfig, t: number): RoadConfig {
  return {
    surfaceColor: lerpColor(from.surfaceColor, to.surfaceColor, t),
    roughness: lerp(from.roughness, to.roughness, t),
    cobblestone: from.cobblestone || to.cobblestone,
    paintedCenterLine: from.paintedCenterLine || to.paintedCenterLine,
    laneMarkings: from.laneMarkings || to.laneMarkings,
    bikeLanes: from.bikeLanes || to.bikeLanes,
    smartRoad: from.smartRoad || to.smartRoad,
    sensors: from.sensors || to.sensors,
  };
}

/**
 * The street & environment layer, morphed between eras.
 *
 * The sky dome, lighting rig and road surface are blended continuously
 * (colors/intensities interpolate) so the whole mood transforms in place,
 * while era-specific street furniture (lamp posts, wires, cameras, greenery)
 * is crossfaded between the two eras.
 */
export function BlendedStreetEnvironment() {
  const { transition, progress, fromEra, toEra } = useSceneTransition();
  const fromConfig = getStreetConfig(fromEra);
  const toConfig = getStreetConfig(toEra);
  const t = progress;

  return (
    <group>
      <StreetSky config={blendSky(fromConfig.sky, toConfig.sky, t)} />
      <StreetLighting config={blendLighting(fromConfig.lighting, toConfig.lighting, t)} />
      <Road config={blendRoad(fromConfig.road, toConfig.road, t)} />
      <EraCrossfade
        progress={t}
        from={transition ? <StreetFurniture config={fromConfig.furniture} /> : null}
        to={<StreetFurniture config={toConfig.furniture} />}
      />
    </group>
  );
}
