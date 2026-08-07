import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FONTS } from './fonts';
import type { AdConfig, StorefrontConfig } from './eraConfig';
import {
  createAwningTexture,
  createNeonTexture,
  createPosterTexture,
  createSignTexture,
  drawLedFrame,
  fontForSignStyle,
} from './canvas';
import type { PosterTextureConfig } from './canvas';

/**
 * Procedural 3D parts that make up storefronts and advertisements.
 * Every part is composed from simple geometry + canvas textures and uses
 * emissive materials whose intensity is driven by day/night.
 */

export interface SignageProps {
  texture: THREE.Texture;
  emissiveColor: string;
  emissiveIntensity: number;
  width: number;
  height: number;
  position?: [number, number, number];
}

/** A flat canvas-textured sign whose emissive glows at night. */
export function Signage({
  texture,
  emissiveColor,
  emissiveIntensity,
  width,
  height,
  position,
}: SignageProps) {
  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={texture}
        emissive={emissiveColor}
        emissiveMap={texture}
        emissiveIntensity={emissiveIntensity}
        toneMapped={false}
      />
    </mesh>
  );
}

export interface AwningProps {
  texture: THREE.Texture;
  width: number;
  radius: number;
  position?: [number, number, number];
}

/** A striped canvas awning — a half-cylinder arcing over a display window. */
export function Awning({ texture, width, radius, position }: AwningProps) {
  return (
    <mesh position={position} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry
        args={[radius, radius, width, 24, 1, false, 0, Math.PI]}
      />
      <meshStandardMaterial
        map={texture}
        side={THREE.DoubleSide}
        roughness={0.85}
      />
    </mesh>
  );
}

export interface NeonSignProps {
  text: string;
  color: string;
  emissive: number;
  position?: [number, number, number];
}

/** A neon sign with a subtle animated flicker. */
export function NeonSign({ text, color, emissive, position }: NeonSignProps) {
  const texture = useMemo(() => createNeonTexture(text, color), [text, color]);
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const t = clock.getElapsedTime();
    const flicker =
      0.92 + Math.sin(t * 30) * 0.05 + (Math.sin(t * 47) > 0.985 ? -0.35 : 0);
    mat.emissiveIntensity = emissive * flicker;
  });

  return (
    <mesh ref={ref} position={position}>
      <planeGeometry args={[1.4, 0.5]} />
      <meshStandardMaterial
        map={texture}
        transparent
        emissive={color}
        emissiveMap={texture}
        emissiveIntensity={emissive}
        toneMapped={false}
      />
    </mesh>
  );
}

export interface LightBoxProps {
  texture: THREE.Texture;
  emissiveColor: string;
  emissiveIntensity: number;
  width: number;
  height: number;
  position?: [number, number, number];
}

/** A backlit plastic sign cabinet (1980s). */
export function LightBox({
  texture,
  emissiveColor,
  emissiveIntensity,
  width,
  height,
  position,
}: LightBoxProps) {
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[width + 0.1, height + 0.1, 0.16]} />
        <meshStandardMaterial color="#14161c" roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.085]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={texture}
          emissive={emissiveColor}
          emissiveMap={texture}
          emissiveIntensity={emissiveIntensity}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export interface LedScreenProps {
  frames: Array<[string, string, string]>;
  accent: string;
  secondary: string;
  width: number;
  height: number;
  emissive: number;
  position?: [number, number, number];
}

/** An animated digital screen cycling through ad frames (2025 media facade). */
export function LedScreen({
  frames,
  accent,
  secondary,
  width,
  height,
  emissive,
  position,
}: LedScreenProps) {
  const [canvas, texture] = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 288;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return [c, t] as const;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const idx = Math.floor(t / 2.4) % frames.length;
    drawLedFrame(canvas, frames[idx], accent, secondary);
    texture.needsUpdate = true;
  });

  return (
    <mesh position={position} castShadow>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={texture}
        emissive={accent}
        emissiveMap={texture}
        emissiveIntensity={emissive}
        toneMapped={false}
      />
    </mesh>
  );
}

export interface AdBillboardProps {
  config: AdConfig;
  emissive: number;
  isNight: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

/** A roadside advertisement billboard with a poster texture. */
export function AdBillboard({
  config,
  emissive,
  isNight,
  position,
  rotation,
}: AdBillboardProps) {
  const texture = useMemo(
    () => createPosterTexture({ ...config, width: 384, height: 480 }),
    [config],
  );
  const glows = config.style === 'digital' || config.style === 'neon80s';
  const posterEmissive = isNight ? (glows ? emissive : emissive * 0.3) : 0;
  const w = 2.6;
  const h = 3.3;

  return (
    <group position={position} rotation={rotation}>
      <mesh position={[-w / 2 + 0.25, h / 2, 0]} castShadow>
        <boxGeometry args={[0.12, h, 0.12]} />
        <meshStandardMaterial color="#3a3f47" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[w / 2 - 0.25, h / 2, 0]} castShadow>
        <boxGeometry args={[0.12, h, 0.12]} />
        <meshStandardMaterial color="#3a3f47" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, h / 2 + 0.08, 0]}>
        <boxGeometry args={[w + 0.12, h + 0.12, 0.1]} />
        <meshStandardMaterial color="#14161c" roughness={0.6} />
      </mesh>
      <mesh position={[0, h / 2 + 0.08, 0.06]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial
          map={texture}
          emissive="#ffffff"
          emissiveMap={texture}
          emissiveIntensity={posterEmissive}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export interface BannerProps {
  text: string;
  accent: string;
  signStyle: 'digitalPrint' | 'led';
  emissive: number;
  isNight: boolean;
  position?: [number, number, number];
}

/** A wide street banner (2005 / 2025). */
export function Banner({
  text,
  accent,
  signStyle,
  emissive,
  isNight,
  position,
}: BannerProps) {
  const texture = useMemo(
    () =>
      createSignTexture({
        text,
        backgroundColor: signStyle === 'led' ? '#05070a' : '#1f3a4a',
        textColor: '#ffffff',
        accentColor: accent,
        borderColor: accent,
        fontFamily: signStyle === 'led' ? FONTS.lightSans : FONTS.cleanSans,
        fontWeight: signStyle === 'led' ? '300' : '700',
        style: signStyle,
        width: 1024,
        height: 128,
      }),
    [text, accent, signStyle],
  );

  return (
    <mesh position={position} castShadow>
      <planeGeometry args={[8.5, 0.95]} />
      <meshStandardMaterial
        map={texture}
        emissive={accent}
        emissiveMap={texture}
        emissiveIntensity={isNight ? emissive : 0.25}
        toneMapped={false}
      />
    </mesh>
  );
}

export interface StorefrontProps {
  config: StorefrontConfig;
  emissive: number;
  isNight: boolean;
  width?: number;
  height?: number;
  position?: [number, number, number];
}

/** A single storefront facade: wall, sign, display window, door, awning, neon. */
export function Storefront({
  config,
  emissive,
  isNight,
  width = 2.4,
  height = 4.4,
  position,
}: StorefrontProps) {
  const signTexture = useMemo(
    () =>
      createSignTexture({
        text: config.name,
        subtext: config.type,
        backgroundColor: config.signBg,
        textColor: config.signFg,
        accentColor: config.signAccent,
        borderColor: config.trimColor,
        fontFamily: fontForSignStyle(config.signStyle).family,
        fontWeight: fontForSignStyle(config.signStyle).weight,
        style: config.signStyle,
        logo: config.logo,
      }),
    [config],
  );

  const awningTexture = useMemo(
    () =>
      config.awning
        ? createAwningTexture(config.awningColors ?? ['#a03a2f', '#e8dcc0'])
        : null,
    [config],
  );

  const posterTextures = useMemo(
    () =>
      Array.from({ length: config.windowPosters ?? 0 }, (_, i) =>
        createPosterTexture(posterConfigFor(config, i)),
      ),
    [config],
  );

  const signW = width * 0.86;
  const signH = 0.74;
  const signY = height - 0.62;
  const windowW = width * 0.56;
  const windowH = 1.6;
  const windowY = 1.7;
  const windowCx = -width / 2 + windowW / 2;
  const doorW = 0.78;
  const doorH = 2.1;
  const doorCx = width / 2 - doorW / 2;

  return (
    <group position={position}>
      {/* wall */}
      <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, 0.5]} />
        <meshStandardMaterial color={config.wallColor} roughness={0.9} />
      </mesh>

      {/* sign */}
      <Signage
        texture={signTexture}
        emissiveColor={config.signEmissive}
        emissiveIntensity={emissive}
        width={signW}
        height={signH}
        position={[0, signY, 0.26]}
      />

      {/* display window frame + glass */}
      <mesh castShadow position={[windowCx, windowY, 0.26]}>
        <boxGeometry args={[windowW + 0.12, windowH + 0.12, 0.06]} />
        <meshStandardMaterial
          color={config.trimColor}
          roughness={0.5}
          metalness={0.3}
        />
      </mesh>
      <mesh position={[windowCx, windowY, 0.3]}>
        <planeGeometry args={[windowW, windowH]} />
        <meshStandardMaterial
          color="#0d1317"
          metalness={0.6}
          roughness={0.1}
          transparent
          opacity={0.85}
          emissive={isNight ? '#2a3a44' : '#000000'}
          emissiveIntensity={isNight ? 0.5 : 0}
        />
      </mesh>

      {/* window posters */}
      {posterTextures.map((tex, i) => {
        const n = posterTextures.length;
        const pw = windowW * 0.3;
        const ph = windowH * 0.62;
        const px = windowCx - windowW / 2 + ((i + 1) * windowW) / (n + 1);
        return (
          <mesh key={i} position={[px, windowY, 0.32]}>
            <planeGeometry args={[pw, ph]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
          </mesh>
        );
      })}

      {/* door */}
      <mesh castShadow position={[doorCx, doorH / 2, 0.26]}>
        <boxGeometry args={[doorW, doorH, 0.06]} />
        <meshStandardMaterial
          color={config.trimColor}
          roughness={0.5}
          metalness={0.3}
        />
      </mesh>
      <mesh position={[doorCx, doorH / 2, 0.32]}>
        <planeGeometry args={[doorW * 0.9, doorH * 0.9]} />
        <meshStandardMaterial
          color="#0d1317"
          metalness={0.6}
          roughness={0.1}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* awning */}
      {awningTexture && (
        <Awning
          texture={awningTexture}
          width={windowW + 0.25}
          radius={windowH / 2 + 0.1}
          position={[windowCx, windowY, 0.3]}
        />
      )}

      {/* neon sign */}
      {config.neonText && config.neonColor && (
        <NeonSign
          text={config.neonText}
          color={config.neonColor}
          emissive={emissive}
          position={[width / 2 - 0.7, signY - 0.1, 0.28]}
        />
      )}
    </group>
  );
}

function posterConfigFor(
  config: StorefrontConfig,
  i: number,
): PosterTextureConfig {
  return {
    headline: config.name,
    subhead: config.type,
    cta: i % 2 === 0 ? 'SPECIAL TODAY' : 'VISIT US',
    style: posterStyleFor(config.signStyle),
    bg: config.signBg,
    fg: config.signFg,
    accent: config.signAccent,
    width: 256,
    height: 320,
  };
}

function posterStyleFor(
  style: StorefrontConfig['signStyle'],
): PosterTextureConfig['style'] {
  switch (style) {
    case 'handPainted':
      return 'sepia';
    case 'midCentury':
      return 'popart';
    case 'backlit':
      return 'neon80s';
    case 'digitalPrint':
      return 'corporate';
    case 'led':
      return 'digital';
  }
}
