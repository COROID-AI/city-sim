/**
 * Single storefront unit.
 *
 * Renders one era-specific storefront parcel: facade wall, store window with
 * an in-window advertisement poster, door, and the era's signage treatment
 * (hand-painted, mid-century enamel, backlit plastic, light box, or dynamic
 * digital screen). Signage and lighting use emissive materials whose
 * intensity scales with time-of-day so the lit signage reads clearly at
 * night and recedes during the day.
 */
import { useMemo } from 'react';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EraStorefrontConfig, StorefrontSpec } from './storefrontTypes';
import {
  SIGN_H,
  SIGN_W,
  canvasToTexture,
  buildSignCanvas,
  buildPosterCanvas,
  drawDigitalAdFrame,
} from './signage';

/** Time-of-day driving the emissive response of signage. */
export type TimeOfDay = 'day' | 'night';

interface StorefrontProps {
  config: EraStorefrontConfig;
  spec: StorefrontSpec;
  timeOfDay: TimeOfDay;
}

/** A small neon "OPEN" sign used by the neon eras (1945/1965/1985). */
function NeonOpenSign({
  color,
  intensity,
}: {
  color: string;
  intensity: number;
}) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 128, 64);
    ctx.font = '700 40px "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 6; i > 0; i--) {
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = color;
      ctx.lineWidth = i * 2;
      ctx.strokeText('OPEN', 64, 32);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('OPEN', 64, 32);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.strokeText('OPEN', 64, 32);
    const tex = canvasToTexture(c);
    return tex;
  }, [color]);

  return (
    <mesh position={[0, 0.9, 0.24]} castShadow>
      <planeGeometry args={[0.9, 0.45]} />
      <meshStandardMaterial
        map={texture}
        emissive={color}
        emissiveMap={texture}
        emissiveIntensity={intensity}
        transparent
        toneMapped={false}
      />
    </mesh>
  );
}

/** Awning over the storefront window (striped for 1945, solid for 1965). */
function Awning({
  config,
  spec,
}: {
  config: EraStorefrontConfig;
  spec: StorefrontSpec;
}) {
  if (config.awning === 'none') return null;
  const stripes = config.awning === 'striped';
  const depth = 0.85;
  return (
    <group position={[0, 3.05, 0.3]} rotation={[-0.08, 0, 0]}>
      <mesh position={[0, 0, depth / 2]} castShadow>
        <boxGeometry args={[spec.width * 1.02, 0.06, depth]} />
        <meshStandardMaterial color={spec.awningColors[0]} roughness={0.85} />
      </mesh>
      {stripes &&
        Array.from({ length: 7 }, (_, i) => {
          const x = ((i - 3) / 3) * (spec.width * 0.9);
          return (
            <mesh key={i} position={[x, 0, depth / 2]} castShadow>
              <boxGeometry args={[spec.width * 0.13, 0.07, depth]} />
              <meshStandardMaterial color={spec.awningColors[1]} roughness={0.85} />
            </mesh>
          );
        })}
      {/* Scalloped leading edge */}
      <mesh position={[0, -0.02, depth]}>
        <boxGeometry args={[spec.width * 1.02, 0.05, 0.06]} />
        <meshStandardMaterial color={spec.awningColors[0]} roughness={0.85} />
      </mesh>
    </group>
  );
}

/** A single storefront parcel (facade + window + door + signage). */
export function Storefront({ config, spec, timeOfDay }: StorefrontProps) {
  const isNight = timeOfDay === 'night';
  const lit = isNight ? config.emissiveIntensity : 0.15;
  const width = spec.width;
  const height = spec.height;

  // Signage texture + material.
  const signTexture = useMemo(
    () => canvasToTexture(buildSignCanvas(config, spec)),
    [config, spec],
  );
  const signWidth = width * 0.86;
  const signHeight = 0.95;

  // In-window poster texture.
  const posterTexture = useMemo(
    () => canvasToTexture(buildPosterCanvas(config, spec)),
    [config, spec],
  );

  // Live digital screen (2025): a ref to the canvas redrawn each frame.
  const digitalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const digitalTextureRef = useRef<THREE.CanvasTexture | null>(null);

  const isDigital = config.signStyle === 'digital';
  const initDigital = useMemo(() => {
    if (!isDigital) return false;
    const c = document.createElement('canvas');
    c.width = SIGN_W;
    c.height = SIGN_H;
    digitalCanvasRef.current = c;
    const tex = canvasToTexture(c);
    digitalTextureRef.current = tex;
    return true;
  }, [isDigital]);

  useFrame((state) => {
    if (!initDigital || !digitalCanvasRef.current || !digitalTextureRef.current) return;
    const t = state.clock.elapsedTime * 1000;
    // Reuse the sign spec to draw a fresh animated frame.
    const base = {
      width: SIGN_W,
      height: SIGN_H,
      text: spec.name,
      subtext: spec.subtext,
      fontFamily: config.signFontFamily,
      fontWeight: config.signFontWeight,
      fontSize: 62,
      textColor: spec.signColor,
      backgroundColor: spec.facadeColor,
      accentColor: spec.neonColor,
      letterSpacing: 2,
      seed: spec.seed,
    };
    const canvas = drawDigitalAdFrame(spec.posterVariant, t, base);
    digitalCanvasRef.current.getContext('2d')!.clearRect(0, 0, SIGN_W, SIGN_H);
    digitalCanvasRef.current.getContext('2d')!.drawImage(canvas, 0, 0);
    digitalTextureRef.current.needsUpdate = true;
  });

  const windowW = width * 0.6;
  const windowH = 1.9;
  const windowBottom = 1.1;

  return (
    <group position={[spec.x, 0, spec.z]} rotation={[0, spec.rotationY, 0]}>
      {/* Facade wall */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, 0.4]} />
        <meshStandardMaterial
          color={spec.facadeColor}
          roughness={0.75}
          metalness={config.metalness}
        />
      </mesh>

      {/* Trim band above the window */}
      <mesh position={[0, 3.42, 0.21]}>
        <boxGeometry args={[width, 0.16, 0.05]} />
        <meshStandardMaterial color={config.trimColor} roughness={0.5} metalness={0.3} />
      </mesh>

      {/* Store window + in-window poster */}
      <group position={[0, windowBottom + windowH / 2, 0.21]}>
        {/* Window frame */}
        <mesh position={[0, 0, -0.01]} castShadow>
          <boxGeometry args={[windowW + 0.1, windowH + 0.1, 0.06]} />
          <meshStandardMaterial color={config.trimColor} roughness={0.5} metalness={0.3} />
        </mesh>
        {/* Poster display */}
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[windowW * 0.86, windowH * 0.82]} />
          <meshBasicMaterial map={posterTexture} />
        </mesh>
        {/* Glass */}
        <mesh position={[0, 0, 0.055]}>
          <planeGeometry args={[windowW, windowH]} />
          <meshStandardMaterial
            color={config.windowTint}
            transparent
            opacity={0.42}
            roughness={0.05}
            metalness={0.2}
          />
        </mesh>
      </group>

      {/* Door on the right side */}
      <group position={[width * 0.34, 1.05, 0.2]}>
        <mesh position={[0, 0, -0.01]} castShadow>
          <boxGeometry args={[0.85, 2.1, 0.06]} />
          <meshStandardMaterial color={config.trimColor} roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[0.78, 2.0]} />
          <meshStandardMaterial color={spec.facadeColor} roughness={0.6} />
        </mesh>
        <mesh position={[0.3, 0, 0.05]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#d8b94a" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>

      {/* Main signage */}
      <mesh position={[0, 3.9, 0.22]} castShadow>
        <planeGeometry args={[signWidth, signHeight]} />
        <meshStandardMaterial
          map={signTexture}
          emissive="#ffffff"
          emissiveMap={signTexture}
          emissiveIntensity={lit}
          toneMapped={false}
        />
      </mesh>

      {/* Neon accents */}
      {config.neon && (
        <>
          <NeonOpenSign color={spec.neonColor} intensity={lit} />
          {(config.signStyle === 'midCentury' || config.signStyle === 'backlit') && (
            <mesh position={[0, 3.42, 0.24]}>
              <boxGeometry args={[signWidth + 0.1, 0.06, 0.03]} />
              <meshStandardMaterial
                color={spec.neonColor}
                emissive={spec.neonColor}
                emissiveIntensity={lit}
                toneMapped={false}
              />
            </mesh>
          )}
        </>
      )}

      {/* Early LED accent strip (2005) */}
      {config.signStyle === 'lightBox' && (
        <mesh position={[0, 2.0, 0.24]}>
          <boxGeometry args={[width * 0.5, 0.05, 0.03]} />
          <meshStandardMaterial
            color={spec.neonColor}
            emissive={spec.neonColor}
            emissiveIntensity={lit}
            toneMapped={false}
          />
        </mesh>
      )}

      <Awning config={config} spec={spec} />
    </group>
  );
}