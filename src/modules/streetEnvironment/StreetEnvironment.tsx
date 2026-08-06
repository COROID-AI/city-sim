import { useMemo } from 'react';
import type { EraId } from '../../contracts/era';
import { STREET_CONFIG } from './eraConfig';
import { ProceduralSky } from './sky';
import { createRoadTexture } from './roadTexture';
import { RoadMarkings } from './markings';
import { Furniture } from './furniture';

export interface StreetEnvironmentProps {
  /** The era whose road, furniture, sky and lighting mood to render. */
  era: EraId;
}

/**
 * Self-contained street + environment layer.
 *
 * Renders, for the given era:
 *  - the road surface (cobblestone / asphalt / smart road) with markings,
 *  - sidewalks and kerbs,
 *  - era-variant street furniture (lamp posts, wires, signals, planters,
 *    sensors, drone),
 *  - a procedural era-correct sky,
 *  - era-specific sun direction / intensity / colour and ambient fill.
 *
 * Designed to be mounted inside a `<Canvas>`; Phase 4 owns wiring it into
 * the shared scene.
 */
export function StreetEnvironment({ era }: StreetEnvironmentProps) {
  const config = STREET_CONFIG[era];
  const roadTexture = useMemo(() => createRoadTexture(config.road), [config]);

  return (
    <group>
      {/* Era-correct sky + lighting mood. */}
      <ProceduralSky config={config} />
      <ambientLight
        intensity={config.lighting.ambientIntensity}
        color={config.lighting.ambientColor}
      />
      <hemisphereLight
        args={[
          config.lighting.hemisphereSky,
          config.lighting.hemisphereGround,
          0.5,
        ]}
      />
      <directionalLight
        position={config.sun.position}
        intensity={config.sun.intensity}
        color={config.sun.color}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* Road surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[30, 7]} />
        <meshStandardMaterial
          map={roadTexture}
          roughness={config.road.roughness}
          metalness={config.road.metalness}
        />
      </mesh>
      <RoadMarkings config={config} />

      {/* Sidewalks + kerbs */}
      <mesh position={[0, 0.0, 4.25]} receiveShadow>
        <boxGeometry args={[30, 0.1, 1.5]} />
        <meshStandardMaterial color="#8a8578" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.0, -4.25]} receiveShadow>
        <boxGeometry args={[30, 0.1, 1.5]} />
        <meshStandardMaterial color="#8a8578" roughness={0.95} />
      </mesh>

      {/* Street furniture */}
      <Furniture config={config} />
    </group>
  );
}