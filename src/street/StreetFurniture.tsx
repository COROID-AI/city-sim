import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import type { FurnitureConfig, LampStyle } from './streetConfig';
import { ROAD_GEOMETRY } from './Road';

const LAMP_X = 3.9;
const LAMP_SPACING = 7;
const LAMP_COUNT = 6;
const LAMP_Z0 = -((LAMP_COUNT - 1) * LAMP_SPACING) / 2;

/** A single lamp post. Shape/color varies by era style. */
function LampPost({
  style,
  color,
  intensity,
  x,
  z,
}: {
  style: LampStyle;
  color: string;
  intensity: number;
  x: number;
  z: number;
}) {
  const poleColor =
    style === 'period' ? '#2a2a2a' : style === 'concrete' ? '#8a8a8a' : '#3a3f45';
  const poleHeight = style === 'led' ? 7.5 : 6.4;
  const arm = style === 'modern' || style === 'led' ? 0.9 : 1.2;

  return (
    <group position={[x, 0, z]}>
      {/* Pole */}
      <mesh position={[0, poleHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.13, poleHeight, 10]} />
        <meshStandardMaterial color={poleColor} roughness={0.6} metalness={0.3} />
      </mesh>

      {/* Ornate base for period lamps */}
      {style === 'period' && (
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.2, 0.26, 0.44, 10]} />
          <meshStandardMaterial color="#232323" roughness={0.5} metalness={0.4} />
        </mesh>
      )}

      {/* Arm + lamp head */}
      <group position={[0, poleHeight, 0]}>
        <mesh position={[arm / 2, -0.15, 0]}>
          <boxGeometry args={[arm, 0.07, 0.07]} />
          <meshStandardMaterial color={poleColor} roughness={0.5} metalness={0.4} />
        </mesh>

        {style === 'period' ? (
          // Classic glass lantern
          <mesh position={[arm, -0.55, 0]} castShadow>
            <octahedronGeometry args={[0.28, 0]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={intensity}
              roughness={0.2}
            />
          </mesh>
        ) : style === 'midcentury' ? (
          // Globe lamp
          <mesh position={[arm, -0.4, 0]} castShadow>
            <sphereGeometry args={[0.22, 12, 12]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={intensity}
              roughness={0.25}
            />
          </mesh>
        ) : style === 'led' ? (
          // Slim LED head
          <mesh position={[arm, -0.35, 0]} castShadow>
            <boxGeometry args={[0.62, 0.1, 0.24]} />
            <meshStandardMaterial
              color="#eaf6ff"
              emissive={color}
              emissiveIntensity={intensity}
              roughness={0.2}
            />
          </mesh>
        ) : (
          // Modern / concrete rectangular head
          <mesh position={[arm, -0.4, 0]} castShadow>
            <boxGeometry args={[0.5, 0.14, 0.22]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={intensity}
              roughness={0.3}
            />
          </mesh>
        )}
      </group>
    </group>
  );
}

/** A row of lamp posts down one side of the street. */
function LampRow(props: { style: LampStyle; color: string; intensity: number; x: number }) {
  const posts = useMemo(
    () =>
      Array.from({ length: LAMP_COUNT }, (_, i) => ({
        z: LAMP_Z0 + i * LAMP_SPACING,
      })),
    [],
  );
  return (
    <group>
      {posts.map((p, i) => (
        <LampPost
          key={i}
          style={props.style}
          color={props.color}
          intensity={props.intensity}
          x={props.x}
          z={p.z}
        />
      ))}
    </group>
  );
}

/** Sagging wire between two points approximated with a quadratic curve. */
function SaggingWire({
  from,
  to,
  sag,
  color,
}: {
  from: [number, number, number];
  to: [number, number, number];
  sag: number;
  color: string;
}) {
  const points = useMemo(() => {
    const midX = (from[0] + to[0]) / 2;
    const midZ = (from[2] + to[2]) / 2;
    const midY = Math.min(from[1], to[1]) - sag;
    const segments = 12;
    const out: [number, number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const inv = 1 - t;
      const x = inv * inv * from[0] + 2 * inv * t * midX + t * t * to[0];
      const y = inv * inv * from[1] + 2 * inv * t * midY + t * t * to[1];
      const z = inv * inv * from[2] + 2 * inv * t * midZ + t * t * to[2];
      out.push([x, y, z]);
    }
    return out;
  }, [from, to, sag]);

  return <Line points={points} color={color} lineWidth={1} transparent opacity={0.85} />;
}

/** 1945 telegraph poles with sagging wires between them. */
function TelegraphWires() {
  const poleHeight = 7.5;
  const zs = Array.from({ length: 5 }, (_, i) => -18 + i * 9);
  return (
    <group>
      {zs.map((z) => (
        <group key={`pole-${z}`} position={[LAMP_X + 0.5, 0, z]}>
          <mesh position={[0, poleHeight / 2, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.1, poleHeight, 8]} />
            <meshStandardMaterial color="#2b2b2b" roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[0, poleHeight, 0]}>
            <boxGeometry args={[0.9, 0.08, 0.08]} />
            <meshStandardMaterial color="#2b2b2b" roughness={0.6} />
          </mesh>
        </group>
      ))}
      {zs.slice(0, -1).map((z, i) => (
        <SaggingWire
          key={`wire-${i}`}
          from={[LAMP_X + 0.5, poleHeight, z]}
          to={[LAMP_X + 0.5, poleHeight, zs[i + 1]]}
          sag={0.7}
          color="#1c1c1c"
        />
      ))}
    </group>
  );
}

/** 1965 overhead power lines on cross-arm poles. */
function OverheadPowerLines() {
  const poleHeight = 8;
  const zs = Array.from({ length: 4 }, (_, i) => -16 + i * 10);
  return (
    <group>
      {zs.map((z) => (
        <group key={`pole-${z}`} position={[LAMP_X + 0.4, 0, z]}>
          <mesh position={[0, poleHeight / 2, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.12, poleHeight, 8]} />
            <meshStandardMaterial color="#3a3f45" roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[0, poleHeight, 0]}>
            <boxGeometry args={[1.4, 0.09, 0.09]} />
            <meshStandardMaterial color="#3a3f45" roughness={0.5} />
          </mesh>
        </group>
      ))}
      {zs.slice(0, -1).map((z, i) => (
        <group key={`lines-${i}`}>
          {[-0.5, 0, 0.5].map((ox) => (
            <SaggingWire
              key={ox}
              from={[LAMP_X + 0.4 + ox, poleHeight, z]}
              to={[LAMP_X + 0.4 + ox, poleHeight, zs[i + 1]]}
              sag={0.25}
              color="#2c2c2c"
            />
          ))}
        </group>
      ))}
    </group>
  );
}

/** Traffic signal head with red/yellow/green lamps. */
function TrafficSignal({ early }: { early: boolean }) {
  const colors = early ? ['#c0392b', '#d4a017', '#2e8b57'] : ['#e74c3c', '#f1c40f', '#2ecc71'];
  return (
    <group>
      <mesh position={[0, 3.2, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 3.2, 8]} />
        <meshStandardMaterial color="#33373d" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 4.4, 0]} castShadow>
        <boxGeometry args={[0.55, early ? 1.1 : 1.5, 0.4]} />
        <meshStandardMaterial color="#22262c" roughness={0.4} metalness={0.3} />
      </mesh>
      {colors.map((c, i) => (
        <mesh key={c} position={[0, 4.4 + (early ? 0.36 - i * 0.36 : 0.5 - i * 0.5), 0.22]}>
          <sphereGeometry args={[early ? 0.13 : 0.16, 10, 10]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.6} />
        </mesh>
      ))}
    </group>
  );
}

/** Concrete bench (1985). */
function ConcreteBench({ x, z, flip }: { x: number; z: number; flip?: boolean }) {
  return (
    <group position={[x, 0, z]} rotation={[0, flip ? Math.PI : 0, 0]}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[1.4, 0.1, 0.45]} />
        <meshStandardMaterial color="#9a9a9e" roughness={0.9} />
      </mesh>
      {[-0.55, 0.55].map((sx) => (
        <mesh key={sx} position={[sx, 0.11, 0]} castShadow>
          <boxGeometry args={[0.12, 0.22, 0.4]} />
          <meshStandardMaterial color="#8a8a8e" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Concrete bollard (1985). */
function Bollard({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 0.25, z]} castShadow>
      <cylinderGeometry args={[0.09, 0.12, 0.5, 8]} />
      <meshStandardMaterial color="#a0a0a4" roughness={0.85} />
    </mesh>
  );
}

/** Planter box with greenery (2005+). */
function Planter({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[1.1, 0.44, 0.7]} />
        <meshStandardMaterial color="#7a7a7e" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.52, 0]}>
        <sphereGeometry args={[0.42, 10, 8]} />
        <meshStandardMaterial color="#3d7a3f" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Surveillance camera mounted on a pole (2025). */
function Camera({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 4.6, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 4.6, 8]} />
        <meshStandardMaterial color="#3a3f45" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 5, 0]} rotation={[0, 0, 0.3]} castShadow>
        <boxGeometry args={[0.5, 0.18, 0.22]} />
        <meshStandardMaterial color="#22262c" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0.28, 4.96, 0]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshStandardMaterial color="#9bdcff" emissive="#4fc3f7" emissiveIntensity={1.5} />
      </mesh>
    </group>
  );
}

/** Low-poly street tree (2025 greenery). */
function Tree({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 3, 7]} />
        <meshStandardMaterial color="#6b4f35" roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.4, 0]} castShadow>
        <sphereGeometry args={[0.9, 8, 6]} />
        <meshStandardMaterial color="#3f8f45" roughness={0.9} />
      </mesh>
      <mesh position={[0.5, 3.1, 0.2]}>
        <sphereGeometry args={[0.5, 7, 5]} />
        <meshStandardMaterial color="#4ba04f" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Autonomous patrol drone (2025), gently hovering. */
function Drone() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.position.y = 6.5 + Math.sin(t * 1.4) * 0.35;
    ref.current.rotation.y = t * 0.4;
  });
  return (
    <group ref={ref} position={[0, 6.5, 0]}>
      {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((r) => (
        <group key={r} rotation={[0, r, 0]}>
          <mesh position={[0.55, 0, 0]} castShadow>
            <boxGeometry args={[0.7, 0.08, 0.14]} />
            <meshStandardMaterial color="#2c2f36" roughness={0.4} metalness={0.4} />
          </mesh>
          <mesh position={[1.05, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.02, 10]} />
            <meshStandardMaterial color="#cfd6de" roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -0.05, 0]} castShadow>
        <boxGeometry args={[0.42, 0.16, 0.42]} />
        <meshStandardMaterial color="#3a3f45" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, -0.05, 0.22]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshStandardMaterial color="#e74c3c" emissive="#ff4d4d" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

/**
 * Era-variant street furniture: lamp posts, wires, signals, benches, planters,
 * cameras, trees, and a drone — all driven by the era config.
 */
export function StreetFurniture({ config }: { config: FurnitureConfig }) {
  return (
    <group>
      {/* Lamp posts along both sides */}
      <LampRow
        style={config.lampStyle}
        color={config.lampColor}
        intensity={config.lampIntensity}
        x={-LAMP_X}
      />
      <LampRow
        style={config.lampStyle}
        color={config.lampColor}
        intensity={config.lampIntensity}
        x={LAMP_X}
      />

      {config.telegraphWires && <TelegraphWires />}
      {config.overheadPowerLines && <OverheadPowerLines />}

      {config.signalStyle !== 'none' && (
        <>
          <group position={[-3.4, 0, -2]}>
            <TrafficSignal early={config.signalStyle === 'early'} />
          </group>
          <group position={[3.4, 0, 2]} rotation={[0, Math.PI, 0]}>
            <TrafficSignal early={config.signalStyle === 'early'} />
          </group>
        </>
      )}

      {config.concreteFurniture && (
        <>
          <ConcreteBench x={ROAD_GEOMETRY.sidewalkOffset} z={-4} />
          <ConcreteBench x={-ROAD_GEOMETRY.sidewalkOffset} z={2} flip />
          <Bollard x={ROAD_GEOMETRY.sidewalkOffset} z={-8} />
          <Bollard x={-ROAD_GEOMETRY.sidewalkOffset} z={6} />
        </>
      )}

      {config.planters && (
        <>
          <Planter x={ROAD_GEOMETRY.sidewalkOffset} z={-6} />
          <Planter x={-ROAD_GEOMETRY.sidewalkOffset} z={4} />
          <Planter x={ROAD_GEOMETRY.sidewalkOffset} z={10} />
        </>
      )}

      {config.cameras && (
        <>
          <Camera x={ROAD_GEOMETRY.sidewalkOffset} z={-2} />
          <Camera x={-ROAD_GEOMETRY.sidewalkOffset} z={8} />
        </>
      )}

      {config.greenery && (
        <>
          <Tree x={ROAD_GEOMETRY.sidewalkOffset + 1.4} z={-9} />
          <Tree x={-ROAD_GEOMETRY.sidewalkOffset - 1.4} z={-1} />
          <Tree x={ROAD_GEOMETRY.sidewalkOffset + 1.4} z={7} />
        </>
      )}

      {config.drone && <Drone />}
    </group>
  );
}
