import type { LightingConfig } from './streetConfig';

/**
 * Era-variant lighting mood: ambient + hemisphere fill + a directional sun.
 * All values (color, intensity, direction) come from the era config.
 */
export function StreetLighting({ config }: { config: LightingConfig }) {
  return (
    <>
      <ambientLight intensity={config.ambientIntensity} />
      <hemisphereLight
        args={[config.hemisphereSky, config.hemisphereGround, 0.5]}
      />
      <directionalLight
        position={config.sunPosition}
        color={config.sunColor}
        intensity={config.sunIntensity}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
    </>
  );
}
