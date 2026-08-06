import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { StoreConfig } from './eraConfig';
import {
  createSignTexture,
  createPosterTexture,
  createLogoTexture,
  createAwningTexture,
} from './textures';

export type Environment = 'day' | 'night';

export interface StorefrontProps {
  /** World x position of the building. */
  x: number;
  /** Index within the row — selects the facade colour. */
  index: number;
  /** Store name drawn on the sign. */
  storeName: string;
  /** Advertisement copy drawn on the poster / screen. */
  ad: string;
  /** The era storefront configuration. */
  config: StoreConfig;
  /** Day or night — night boosts emissive intensity so signage glows. */
  environment: Environment;
}

/**
 * One storefront building with era-correct signage, awnings, posters and
 * neon/digital accents. Signage is canvas-texture + emissive material so it
 * self-illuminates and reads clearly in both day and night.
 */
export function Storefront({
  x,
  index,
  storeName,
  ad,
  config,
  environment,
}: StorefrontProps) {
  const facadeColor = config.facadeColors[index % config.facadeColors.length];
  const emissive = environment === 'night' ? config.emissiveIntensity * 1.7 : config.emissiveIntensity;

  const signTexture = useMemo(
    () =>
      createSignTexture(storeName, {
        background: config.signBackground,
        textColor: config.signTextColor,
        font: config.signFont,
        borderColor: config.signageStyle === 'backlit' ? config.neonColor : undefined,
        neon: config.signageStyle === 'neon',
        neonColor: config.neonColor,
        backlit: config.signageStyle === 'backlit',
        digital: config.signageStyle === 'digital' || config.signageStyle === 'led',
      }),
    [config, storeName],
  );

  const posterTexture = useMemo(
    () => createPosterTexture(ad, config.posterStyle),
    [config, ad],
  );

  const logoTexture = useMemo(
    () =>
      createLogoTexture(storeName, {
        textColor: config.signTextColor,
        font: config.signFont,
        accent: config.neonColor,
        background: config.signBackground,
      }),
    [config, storeName],
  );

  const awningTexture = useMemo(() => createAwningTexture(), []);

  const isScreen = config.posterEmissive;
  const showLogo = config.showLogo;
  const isNeonTube = config.signageStyle === 'neon' || config.signageStyle === 'backlit';

  return (
    <group position={[x, 0, 5.4]}>
      {/* Building wall */}
      <mesh position={[0, 1.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 3.4, 1.2]} />
        <meshStandardMaterial color={facadeColor} roughness={0.92} />
      </mesh>

      {/* Storefront window */}
      <mesh position={[0, 0.75, 0.61]}>
        <boxGeometry args={[1.7, 1.0, 0.06]} />
        <meshStandardMaterial
          color={config.windowTint}
          transparent
          opacity={0.5}
          roughness={0.1}
          metalness={0.3}
        />
      </mesh>

      {/* Door */}
      <mesh position={[0, 0.45, 0.62]}>
        <boxGeometry args={[0.55, 1.0, 0.06]} />
        <meshStandardMaterial color="#4a3a28" roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0.18, 0.45, 0.66]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshStandardMaterial color="#d8c9a0" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Signage band above the storefront */}
      <mesh position={[0, 1.95, 0.61]}>
        <boxGeometry args={[2.0, 0.5, 0.1]} />
        <meshStandardMaterial
          map={signTexture}
          emissiveMap={signTexture}
          emissive="#ffffff"
          emissiveIntensity={emissive}
          roughness={0.4}
        />
      </mesh>

      {/* Logo disc beside the signage (1965+) */}
      {showLogo && (
        <mesh position={[0.98, 1.95, 0.62]}>
          <planeGeometry args={[0.42, 0.42]} />
          <meshStandardMaterial
            map={logoTexture}
            emissiveMap={logoTexture}
            emissive="#ffffff"
            emissiveIntensity={emissive * 0.8}
            transparent
          />
        </mesh>
      )}

      {/* Striped canvas awning (1945) */}
      {config.awning === 'striped' && (
        <group position={[0, 1.52, 0.78]} rotation={[-0.4, 0, 0]}>
          <mesh>
            <boxGeometry args={[1.9, 0.06, 0.55]} />
            <meshStandardMaterial map={awningTexture} roughness={0.85} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}

      {/* Neon accent tube (1965 / 1985) */}
      {isNeonTube && (
        <mesh position={[0, 1.7, 0.67]}>
          <boxGeometry args={[2.0, 0.04, 0.04]} />
          <meshStandardMaterial
            color={config.neonColor}
            emissive={config.neonColor}
            emissiveIntensity={emissive}
          />
        </mesh>
      )}

      {/* Advertisement poster / digital screen on the upper facade */}
      <DigitalPoster
        config={config}
        posterTexture={posterTexture}
        isScreen={isScreen}
        emissive={emissive}
      />
    </group>
  );
}

/**
 * The upper-facade advertisement panel. In 2005/2025 this is an emissive
 * digital screen; in 2025 it cycles its ad copy (digital ad loop) and pulses
 * like an animated media facade.
 */
function DigitalPoster({
  config,
  posterTexture,
  isScreen,
  emissive,
}: {
  config: StoreConfig;
  posterTexture: THREE.CanvasTexture;
  isScreen: boolean;
  emissive: number;
}) {
  const [adIndex, setAdIndex] = useState(0);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const clock = useRef(0);

  // 2025 digital ad loop — cycle through the era's ad copy.
  useEffect(() => {
    if (!config.animated) {
      setAdIndex(0);
      return;
    }
    const id = window.setInterval(() => {
      setAdIndex((i) => (i + 1) % config.ads.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [config]);

  // Regenerate the poster texture whenever the loop advances.
  const liveTexture = useMemo(
    () => createPosterTexture(config.ads[adIndex % config.ads.length], config.posterStyle),
    [config, adIndex],
  );
  const currentTexture = config.animated && isScreen ? liveTexture : posterTexture;

  // Animated media facade — gentle emissive pulse for the 2025 screen.
  useFrame((_, delta) => {
    clock.current += delta;
    if (materialRef.current && config.animated) {
      const pulse = 0.85 + 0.25 * Math.sin(clock.current * 2.4);
      materialRef.current.emissiveIntensity = emissive * pulse;
    }
  });

  return (
    <mesh position={[0, 2.55, 0.62]}>
      <planeGeometry args={[1.5, 1.15]} />
      <meshStandardMaterial
        ref={materialRef}
        map={currentTexture}
        emissiveMap={isScreen ? currentTexture : undefined}
        emissive={isScreen ? '#ffffff' : '#000000'}
        emissiveIntensity={isScreen ? emissive : 0}
        roughness={0.3}
        metalness={isScreen ? 0.1 : 0}
      />
    </mesh>
  );
}
