import { useMemo } from 'react';
import type { EraId } from '../../contracts';
import { getEraDescriptor } from '../../contracts';
import { STOREFRONTS_BY_ERA } from './eraConfig';
import { AdBillboard, Banner, LedScreen, Storefront } from './parts';

/**
 * Era-variant storefronts & advertisements module.
 *
 * A self-contained R3F module keyed off the foundation era registry. It
 * renders a street-facing row of era-correct storefronts plus advertisement
 * billboards using procedural geometry and canvas-texture signage. Signage is
 * driven by emissive materials whose intensity scales with day/night so the
 * night-time glow reads clearly.
 *
 * The module owns its lighting by default so it renders standalone; pass
 * `includeLighting={false}` when embedding it into a scene that already
 * provides lights.
 */
export interface StorefrontsAdsProps {
  /** The era to render. */
  era: EraId;
  /** Night-time lighting mode — boosts signage emissive so it reads clearly. */
  isNight?: boolean;
  /** Include the module's own lights so it renders standalone. */
  includeLighting?: boolean;
  /** World position of the module origin. */
  position?: [number, number, number];
}

export function StorefrontsAds({
  era,
  isNight = false,
  includeLighting = true,
  position = [0, 0, 0],
}: StorefrontsAdsProps) {
  const desc = getEraDescriptor(era);
  const config = STOREFRONTS_BY_ERA[era];
  const emissive = isNight ? config.emissive.night : config.emissive.day;

  const storefrontXs = useMemo(() => {
    const n = config.storefronts.length;
    const gap = 2.7;
    const start = -((n - 1) * gap) / 2;
    return config.storefronts.map((_, i) => start + i * gap);
  }, [config]);

  const ledFrames: Array<[string, string, string]> = useMemo(
    () => [
      [config.ads[0].headline, config.ads[0].subhead, 'LIVE • 24/7'],
      [config.ads[1].headline, config.ads[1].subhead, 'NOW SHOWING'],
      [config.ads[2].headline, config.ads[2].subhead, 'FOLLOW US'],
    ],
    [config],
  );

  return (
    <group position={position}>
      {includeLighting && (
        <>
          <ambientLight intensity={isNight ? 0.12 : 0.55} />
          <directionalLight
            position={[6, 10, 6]}
            intensity={isNight ? 0.35 : 1.15}
            color="#fff1de"
          />
        </>
      )}

      {/* sidewalk */}
      <mesh receiveShadow position={[0, -0.03, 0.7]}>
        <boxGeometry args={[13.5, 0.12, 3.4]} />
        <meshStandardMaterial
          color={isNight ? '#26292f' : '#8a8d93'}
          roughness={0.95}
        />
      </mesh>

      {/* storefront row */}
      {config.storefronts.map((s, i) => (
        <Storefront
          key={i}
          config={s}
          emissive={emissive}
          isNight={isNight}
          position={[storefrontXs[i], 0, -1.7]}
        />
      ))}

      {/* advertisement billboards */}
      <AdBillboard
        config={config.ads[0]}
        emissive={emissive}
        isNight={isNight}
        position={[6.4, 0, 1.0]}
        rotation={[0, -Math.PI / 2.6, 0]}
      />
      <AdBillboard
        config={config.ads[1]}
        emissive={emissive}
        isNight={isNight}
        position={[-6.4, 0, 1.0]}
        rotation={[0, Math.PI / 2.6, 0]}
      />

      {/* wide street banner (2005) */}
      {config.banner && (
        <Banner
          text={config.banner}
          accent={desc.palette.accent}
          signStyle={era === 2025 ? 'led' : 'digitalPrint'}
          emissive={emissive}
          isNight={isNight}
          position={[0, 3.6, -1.45]}
        />
      )}

      {/* 2025 animated media facade */}
      {era === 2025 && (
        <group position={[0, 0, -2.2]}>
          <mesh position={[0, 5.5, 0]} castShadow>
            <boxGeometry args={[9.5, 6, 0.4]} />
            <meshStandardMaterial color="#0d1218" roughness={0.85} />
          </mesh>
          <LedScreen
            frames={ledFrames}
            accent="#7fd1ff"
            secondary="#ffffff"
            width={8.6}
            height={2.6}
            emissive={emissive}
            position={[0, 5.6, 0.22]}
          />
        </group>
      )}
    </group>
  );
}
