import { useMemo } from 'react';
import * as THREE from 'three';
import type { LampStyle, SignalStyle } from './eraConfig';

/**
 * Procedural street-furniture geometry.
 *
 * Each part is era-appropriate and authored from primitives so the module
 * stays fully self-contained (no external assets). Lamp heads, signal
 * lenses, and sensor lights use emissive materials whose intensity scales
 * with day/night so the street reads correctly in both modes.
 */

/* ---------------------------------------------------------------------------
 * Sagging wire (telegraph / overhead power line)
 * ------------------------------------------------------------------------- */

export interface WireProps {
  from: [number, number, number];
  to: [number, number, number];
  sag?: number;
  color?: string;
  radius?: number;
}

/** A wire that sags between two anchor points (quadratic bezier tube). */
export function Wire({
  from,
  to,
  sag = 0.4,
  color = '#1b1b1f',
  radius = 0.02,
}: WireProps) {
  const geometry = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    return new THREE.TubeGeometry(curve, 14, radius, 4, false);
  }, [from, to, sag, radius]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} roughness={0.7} metalness={0.3} />
    </mesh>
  );
}

/* ---------------------------------------------------------------------------
 * Lamp post
 * ------------------------------------------------------------------------- */

export interface LampPostProps {
  style: LampStyle;
  color: string;
  emissive: string;
  emissiveIntensity: number;
  position: [number, number, number];
}

function headFor(
  style: LampStyle,
  color: string,
  emissive: string,
  intensity: number,
) {
  switch (style) {
    case 'period': {
      // Ornate cast-iron head with a warm globe.
      return (
        <group position={[0, 4.35, 0]}>
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 0.5, 8]} />
            <meshStandardMaterial color={color} roughness={0.6} metalness={0.5} />
          </mesh>
          <mesh position={[0, 0.42, 0]}>
            <sphereGeometry args={[0.16, 12, 12]} />
            <meshStandardMaterial
              color={emissive}
              emissive={emissive}
              emissiveIntensity={intensity}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 0.56, 0]}>
            <coneGeometry args={[0.1, 0.14, 8]} />
            <meshStandardMaterial color={color} roughness={0.6} metalness={0.5} />
          </mesh>
        </group>
      );
    }
    case 'midCentury': {
      // Simple tapered pole with a single globe.
      return (
        <group position={[0, 4.2, 0]}>
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.04, 0.06, 0.4, 8]} />
            <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0.32, 0]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial
              color={emissive}
              emissive={emissive}
              emissiveIntensity={intensity}
              toneMapped={false}
            />
          </mesh>
        </group>
      );
    }
    case 'concrete': {
      // Chunky sodium-vapor cobra head.
      return (
        <group position={[0, 4.3, 0]}>
          <mesh position={[0.15, 0.05, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
            <meshStandardMaterial color={color} roughness={0.9} />
          </mesh>
          <mesh position={[0.38, 0.02, 0]}>
            <boxGeometry args={[0.3, 0.16, 0.22]} />
            <meshStandardMaterial color={color} roughness={0.9} />
          </mesh>
          <mesh position={[0.38, -0.04, 0]}>
            <planeGeometry args={[0.26, 0.12]} />
            <meshStandardMaterial
              color={emissive}
              emissive={emissive}
              emissiveIntensity={intensity}
              toneMapped={false}
            />
          </mesh>
        </group>
      );
    }
    case 'modern': {
      // Sleek cobra-head metal fixture.
      return (
        <group position={[0, 4.25, 0]}>
          <mesh position={[0.12, 0.1, 0]} rotation={[0, 0, -Math.PI / 2.4]}>
            <cylinderGeometry args={[0.04, 0.04, 0.42, 8]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[0.34, 0.02, 0]}>
            <boxGeometry args={[0.26, 0.12, 0.16]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[0.34, -0.03, 0]}>
            <planeGeometry args={[0.22, 0.08]} />
            <meshStandardMaterial
              color={emissive}
              emissive={emissive}
              emissiveIntensity={intensity}
              toneMapped={false}
            />
          </mesh>
        </group>
      );
    }
    case 'led':
    default: {
      // Slim pole with a flat LED panel head.
      return (
        <group position={[0, 4.3, 0]}>
          <mesh position={[0.1, 0.12, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <cylinderGeometry args={[0.035, 0.035, 0.5, 8]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[0.36, 0.04, 0]}>
            <boxGeometry args={[0.3, 0.1, 0.12]} />
            <meshStandardMaterial color={color} roughness={0.3} metalness={0.7} />
          </mesh>
          <mesh position={[0.36, -0.02, 0]}>
            <planeGeometry args={[0.28, 0.06]} />
            <meshStandardMaterial
              color={emissive}
              emissive={emissive}
              emissiveIntensity={intensity}
              toneMapped={false}
            />
          </mesh>
        </group>
      );
    }
  }
}

export function LampPost({
  style,
  color,
  emissive,
  emissiveIntensity,
  position,
}: LampPostProps) {
  const poleTop = 4.2;
  return (
    <group position={position}>
      {/* base */}
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.18, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.4} />
      </mesh>
      {/* pole */}
      <mesh position={[0, poleTop / 2 + 0.09, 0]}>
        <cylinderGeometry
          args={[0.05, 0.11, poleTop, 8]}
          openEnded
        />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.4} />
      </mesh>
      {headFor(style, color, emissive, emissiveIntensity)}
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * Traffic signal
 * ------------------------------------------------------------------------- */

export interface TrafficSignalProps {
  style: Extract<SignalStyle, 'early' | 'modern' | 'led'>;
  position: [number, number, number];
}

const LENS_COLORS = ['#e03131', '#f5c518', '#2fae5a'];

export function TrafficSignal({ style, position }: TrafficSignalProps) {
  const housing =
    style === 'early'
      ? { w: 0.42, h: 1.15, color: '#3a3f47', radius: 0.1 }
      : { w: 0.38, h: 1.05, color: '#2b2f36', radius: 0.08 };

  return (
    <group position={position}>
      {/* pole */}
      <mesh position={[0, 2.4, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 4.8, 8]} />
        <meshStandardMaterial color="#2b2f36" roughness={0.5} metalness={0.5} />
      </mesh>
      {/* housing */}
      <mesh position={[0, 4.9, 0]}>
        <boxGeometry args={[housing.w, housing.h, housing.w]} />
        <meshStandardMaterial color={housing.color} roughness={0.6} metalness={0.4} />
      </mesh>
      {/* lenses */}
      {LENS_COLORS.map((c, i) => {
        const y = 4.9 + (1 - i) * (housing.h / 3) - housing.h / 3;
        return (
          <mesh key={c} position={[0, y, housing.w / 2 + 0.01]}>
            <circleGeometry args={[0.09, 16]} />
            <meshStandardMaterial
              color={c}
              emissive={c}
              emissiveIntensity={style === 'led' ? 2.2 : 1.0}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * Planter / greenery
 * ------------------------------------------------------------------------- */

export interface PlanterProps {
  position: [number, number, number];
  color?: string;
  hasTree?: boolean;
}

export function Planter({ position, color = '#8a7a5c', hasTree = false }: PlanterProps) {
  return (
    <group position={position}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[1.2, 0.6, 0.8]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <sphereGeometry args={[0.5, 12, 10]} />
        <meshStandardMaterial color="#3f7a3a" roughness={1} />
      </mesh>
      {hasTree && (
        <group position={[0, 1.1, 0]}>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.06, 0.08, 1.0, 6]} />
            <meshStandardMaterial color="#5a4632" roughness={1} />
          </mesh>
          <mesh position={[0, 1.2, 0]}>
            <sphereGeometry args={[0.8, 10, 8]} />
            <meshStandardMaterial color="#2f6b3a" roughness={1} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * Smart sensor / camera pole (2025)
 * ------------------------------------------------------------------------- */

export interface SensorPoleProps {
  position: [number, number, number];
  camera?: boolean;
}

export function SensorPole({ position, camera = false }: SensorPoleProps) {
  return (
    <group position={position}>
      <mesh position={[0, 2, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 4, 8]} />
        <meshStandardMaterial color="#1f2226" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* sensor housing */}
      <mesh position={[0, 4, 0]}>
        <boxGeometry args={[0.32, 0.18, 0.3]} />
        <meshStandardMaterial color="#14161c" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* sensor lens */}
      <mesh position={[0.18, 4, 0]}>
        <sphereGeometry args={[0.06, 10, 10]} />
        <meshStandardMaterial
          color="#0a0c10"
          emissive="#7fd1ff"
          emissiveIntensity={0.6}
          toneMapped={false}
        />
      </mesh>
      {/* antenna */}
      <mesh position={[0, 4.18, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 0.3, 4]} />
        <meshStandardMaterial color="#1f2226" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* traffic camera on a bracket */}
      {camera && (
        <group position={[0.2, 3.6, 0]}>
          <mesh position={[0.15, 0, 0]}>
            <boxGeometry args={[0.28, 0.1, 0.1]} />
            <meshStandardMaterial color="#14161c" roughness={0.5} metalness={0.5} />
          </mesh>
          <mesh position={[0.28, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.08, 10]} />
            <meshStandardMaterial color="#0a0c10" roughness={0.2} metalness={0.8} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * Concrete street furniture (1985)
 * ------------------------------------------------------------------------- */

export interface ConcreteBenchProps {
  position: [number, number, number];
}

export function ConcreteBench({ position }: ConcreteBenchProps) {
  return (
    <group position={position}>
      {/* legs */}
      <mesh position={[-0.4, 0.2, 0]}>
        <boxGeometry args={[0.08, 0.5, 0.5]} />
        <meshStandardMaterial color="#6a6a68" roughness={0.95} />
      </mesh>
      <mesh position={[0.4, 0.2, 0]}>
        <boxGeometry args={[0.08, 0.5, 0.5]} />
        <meshStandardMaterial color="#6a6a68" roughness={0.95} />
      </mesh>
      {/* seat + back */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1.0, 0.08, 0.5]} />
        <meshStandardMaterial color="#7a7a78" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.78, -0.22]}>
        <boxGeometry args={[1.0, 0.5, 0.06]} />
        <meshStandardMaterial color="#7a7a78" roughness={0.95} />
      </mesh>
    </group>
  );
}

export interface BollardProps {
  position: [number, number, number];
}

export function Bollard({ position }: BollardProps) {
  return (
    <mesh position={position}>
      <cylinderGeometry args={[0.07, 0.09, 0.6, 10]} />
      <meshStandardMaterial color="#8a8a88" roughness={0.95} />
    </mesh>
  );
}