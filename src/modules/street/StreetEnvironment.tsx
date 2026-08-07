import { useMemo } from 'react';
import * as THREE from 'three';
import type { EraId } from '../../contracts';
import { getEraDescriptor } from '../../contracts';
import { STREET_BY_ERA } from './eraConfig';
import type { EraSkyConfig } from './eraConfig';
import { SkyDome } from './sky';
import { createRoadTexture } from './textures';
import {
  Bollard,
  ConcreteBench,
  LampPost,
  Planter,
  SensorPole,
  TrafficSignal,
  Wire,
} from './parts';

/**
 * Era-variant street & environment module.
 *
 * A self-contained R3F module keyed off the foundation era registry. It
 * authors the road surface, street furniture, era-correct sky, and lighting
 * mood for every era:
 *
 * - 1945  cobblestone / worn asphalt, period lamp posts, telegraph wires,
 *         sepia-warm sky, softer lighting
 * - 1965  smoother asphalt, mid-century lamps, overhead power lines,
 *         clearer blue sky, balanced daylight
 * - 1985  asphalt with painted lines, concrete street furniture, early
 *         signals, hazy / smoggy sky
 * - 2005  marked asphalt, modern signals, emerging bike lanes, planters,
 *         clearer-but-bright sky
 * - 2025  smooth smart-road surface, LED street lighting, sensors/cameras,
 *         greenery, clear modern sky
 *
 * The module owns its lighting and sky by default so it renders standalone;
 * pass `includeLighting={false}` and render your own `<SkyDome>` when
 * embedding it into a scene that already provides them.
 */

export interface StreetEnvironmentProps {
  /** The era to render. */
  era: EraId;
  /** Night-time mode — boosts lamp/signal emissive and darkens the sky. */
  isNight?: boolean;
  /** Include the module's own lights + fog + sky so it renders standalone. */
  includeLighting?: boolean;
  /** World position of the module origin. */
  position?: [number, number, number];
}

/** Street geometry: runs along X, road width along Z. */
const ROAD_LENGTH = 24;
const ROAD_WIDTH = 6;
const SIDEWALK_WIDTH = 1.4;

/** Lamp posts are spaced along each curb. */
const POLE_XS = [-8, -4, 0, 4, 8];
const POLE_Z = ROAD_WIDTH / 2 + 0.55;

/** Night override: darken the sky, drop sun, boost lamp glow. */
function nightSky(sky: EraSkyConfig): EraSkyConfig {
  const darken = (hex: string, f: number) =>
    new THREE.Color(hex)
      .multiplyScalar(f)
      .getStyle();
  return {
    ...sky,
    topColor: darken(sky.topColor, 0.1),
    horizonColor: darken(sky.horizonColor, 0.14),
    bottomColor: darken(sky.bottomColor, 0.12),
    sunIntensity: 0.18,
    sunColor: '#cfe0ff',
    haze: 0.1,
    fogColor: '#05070c',
    fogDensity: 0.02,
  };
}

export function StreetEnvironment({
  era,
  isNight = false,
  includeLighting = true,
  position = [0, 0, 0],
}: StreetEnvironmentProps) {
  const desc = getEraDescriptor(era);
  const config = STREET_BY_ERA[era];
  const sky = useMemo(
    () => (isNight ? nightSky(config.sky) : config.sky),
    [config, isNight],
  );
  const roadTexture = useMemo(() => createRoadTexture(config.road), [config]);
  const lampEmissive = isNight
    ? config.furniture.lampNightIntensity
    : config.furniture.lampDayIntensity;

  const telegraphWires = useMemo(() => {
    if (!config.furniture.telegraphWires) return [];
    const from: Array<[number, number, number]> = [];
    for (let i = 0; i < POLE_XS.length - 1; i++) {
      from.push([POLE_XS[i], 4.4, POLE_Z]);
      from.push([POLE_XS[i], 4.4, -POLE_Z]);
    }
    return from;
  }, [config]);

  const powerLines = useMemo(() => {
    if (!config.furniture.overheadPowerLines) return [];
    const from: Array<[number, number, number]> = [];
    for (let i = 0; i < POLE_XS.length - 1; i++) {
      from.push([POLE_XS[i], 4.5, POLE_Z]);
    }
    return from;
  }, [config]);

  return (
    <group position={position}>
      {includeLighting && (
        <>
          <ambientLight intensity={isNight ? 0.12 : sky.ambientIntensity} />
          <directionalLight
            position={sky.sunDirection.map((v) => v * 2) as [number, number, number]}
            intensity={isNight ? 0.25 : sky.sunIntensity}
            color={sky.sunColor}
            castShadow
          />
          <fog attach="fog" args={[sky.fogColor, 8, 55]} />
        </>
      )}

      {/* era-correct sky dome */}
      {includeLighting && <SkyDome config={sky} />}

      {/* ground plane */}
      <mesh receiveShadow position={[0, -0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[60, 40]} />
        <meshStandardMaterial
          color={isNight ? '#14161a' : '#565a60'}
          roughness={1}
        />
      </mesh>

      {/* road surface */}
      <mesh
        receiveShadow
        position={[0, 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[ROAD_LENGTH, ROAD_WIDTH]} />
        <meshStandardMaterial
          map={roadTexture}
          color={isNight ? '#2a2c30' : '#ffffff'}
          roughness={config.road.roughness}
          metalness={0}
        />
      </mesh>

      {/* sidewalks */}
      <mesh receiveShadow position={[0, 0.02, ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2]}>
        <boxGeometry args={[ROAD_LENGTH, 0.08, SIDEWALK_WIDTH]} />
        <meshStandardMaterial
          color={isNight ? '#222429' : '#8f9297'}
          roughness={0.95}
        />
      </mesh>
      <mesh receiveShadow position={[0, 0.02, -(ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2)]}>
        <boxGeometry args={[ROAD_LENGTH, 0.08, SIDEWALK_WIDTH]} />
        <meshStandardMaterial
          color={isNight ? '#222429' : '#8f9297'}
          roughness={0.95}
        />
      </mesh>

      {/* lamp posts along both curbs */}
      {POLE_XS.map((x) => (
        <group key={`p${x}`}>
          <LampPost
            style={config.furniture.lampStyle}
            color={config.furniture.lampColor}
            emissive={config.furniture.lampEmissive}
            emissiveIntensity={lampEmissive}
            position={[x, 0, POLE_Z]}
          />
          <LampPost
            style={config.furniture.lampStyle}
            color={config.furniture.lampColor}
            emissive={config.furniture.lampEmissive}
            emissiveIntensity={lampEmissive}
            position={[x, 0, -POLE_Z]}
          />
        </group>
      ))}

      {/* telegraph wires (1945) */}
      {telegraphWires.map((from, i) => (
        <Wire
          key={`tw${i}`}
          from={from}
          to={[from[0] + 4, 4.4, from[2]]}
          sag={0.5}
          radius={0.015}
        />
      ))}

      {/* overhead power lines (1965) */}
      {powerLines.map((from, i) => (
        <Wire
          key={`pl${i}`}
          from={from}
          to={[from[0] + 4, 4.5, from[2]]}
          sag={0.35}
          radius={0.02}
        />
      ))}

      {/* traffic signals */}
      {config.furniture.signalStyle !== 'none' && (
        <>
          <TrafficSignal
            style={config.furniture.signalStyle}
            position={[-5, 0, ROAD_WIDTH / 2 + 0.5]}
          />
          <TrafficSignal
            style={config.furniture.signalStyle}
            position={[5, 0, -(ROAD_WIDTH / 2 + 0.5)]}
          />
        </>
      )}

      {/* concrete street furniture (1985) */}
      {config.furniture.concreteFurniture && (
        <>
          <ConcreteBench position={[-7, 0, ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2]} />
          <ConcreteBench position={[7, 0, -(ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2)]} />
          <Bollard position={[-9, 0, ROAD_WIDTH / 2 + 0.3]} />
          <Bollard position={[9, 0, -(ROAD_WIDTH / 2 + 0.3)]} />
        </>
      )}

      {/* planters (2005 / 2025) */}
      {config.furniture.planters && (
        <>
          <Planter position={[-6, 0, ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2]} />
          <Planter position={[6, 0, -(ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2)]} />
        </>
      )}

      {/* dense greenery + trees (2025) */}
      {config.furniture.greenery && (
        <>
          <Planter
            position={[-6, 0, -(ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2)]}
            hasTree
          />
          <Planter
            position={[6, 0, ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2]}
            hasTree
          />
        </>
      )}

      {/* smart sensors / cameras (2025) */}
      {config.furniture.sensors && (
        <>
          <SensorPole position={[-3, 0, ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2]} />
          <SensorPole
            position={[3, 0, -(ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2)]}
            camera={config.furniture.cameras}
          />
        </>
      )}
    </group>
  );
}