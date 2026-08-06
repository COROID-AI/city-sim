/**
 * Standalone advertisement billboard.
 *
 * A roadside advertisement panel (post + frame + poster face). The poster art
 * is era-specific; backlit eras (1985/2005/2025) emit so the ad reads at
 * night, while earlier eras keep a matte painted face.
 */
import { useMemo } from 'react';
import type { EraStorefrontConfig, BillboardSpec } from './storefrontTypes';
import type { TimeOfDay } from './Storefront';
import { canvasToTexture, buildPosterCanvas } from './signage';

interface BillboardProps {
  config: EraStorefrontConfig;
  spec: BillboardSpec;
  timeOfDay: TimeOfDay;
}

export function Billboard({ config, spec, timeOfDay }: BillboardProps) {
  const isNight = timeOfDay === 'night';
  const lit = isNight ? config.emissiveIntensity : 0.12;

  const posterTexture = useMemo(
    () => canvasToTexture(buildPosterCanvas(config, spec)),
    [config, spec],
  );

  const backlit = config.adStyle === 'eighties' || config.adStyle === 'corporate';

  return (
    <group position={[spec.x, 0, spec.z]} rotation={[0, spec.rotationY, 0]}>
      {/* Post */}
      <mesh position={[0, 1.6, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.12, 3.2, 8]} />
        <meshStandardMaterial color="#3a3f45" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Frame */}
      <mesh position={[0, 3.3, 0]} castShadow>
        <boxGeometry args={[2.6, 1.8, 0.12]} />
        <meshStandardMaterial color="#2a2c30" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Poster face */}
      <mesh position={[0, 3.3, 0.08]}>
        <planeGeometry args={[2.4, 1.6]} />
        <meshStandardMaterial
          map={posterTexture}
          emissive={backlit ? '#ffffff' : '#000000'}
          emissiveMap={backlit ? posterTexture : undefined}
          emissiveIntensity={backlit ? lit : 0}
          toneMapped={false}
        />
      </mesh>
      {/* Top light bar for backlit ads */}
      {backlit && (
        <mesh position={[0, 4.2, 0.08]}>
          <boxGeometry args={[2.4, 0.08, 0.1]} />
          <meshStandardMaterial
            color="#ffffff"
            emissive="#ffffff"
            emissiveIntensity={lit}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}