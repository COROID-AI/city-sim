import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type {
  EraStreetConfig,
  FurnitureConfig,
  LampStyle,
  SignalStyle,
} from './eraConfig';

const LAMP_XS = [-12, -6, 0, 6, 12];
const LAMP_Z = 4.0;

/** A sagging overhead wire modelled as a thin tube along a quadratic bezier. */
function SaggingWire({
  start,
  end,
  sag,
  radius,
  color,
}: {
  start: [number, number, number];
  end: [number, number, number];
  sag: number;
  radius: number;
  color: string;
}) {
  const geometry = useMemo(() => {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    return new THREE.TubeGeometry(curve, 16, radius, 4, false);
  }, [start, end, sag, radius]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} metalness={0.7} roughness={0.4} />
    </mesh>
  );
}

/** Era-variant lamp post: pole + base + period-specific head. */
function LampPost({
  style,
  color,
  emissive,
  x,
  z,
}: {
  style: LampStyle;
  color: string;
  emissive: string;
  x: number;
  z: number;
}) {
  const poleHeight = style === 'led' ? 4.8 : 3.6;
  const poleRadius = style === 'period' ? 0.045 : 0.06;

  const head = (() => {
    if (style === 'period') {
      return (
        <group position={[0, poleHeight - 0.2, 0]}>
          {/* Ornate curved arm */}
          <mesh position={[0.28, 0.06, 0]} rotation={[0, 0, -0.35]}>
            <cylinderGeometry args={[0.03, 0.03, 0.7, 8]} />
            <meshStandardMaterial color={color} metalness={0.5} roughness={0.5} />
          </mesh>
          {/* Warm glass lantern */}
          <mesh position={[0.55, 0, 0]} castShadow>
            <sphereGeometry args={[0.22, 14, 14]} />
            <meshStandardMaterial
              color="#ffd9a0"
              emissive={emissive}
              emissiveIntensity={1.2}
              roughness={0.3}
            />
          </mesh>
        </group>
      );
    }
    if (style === 'midcentury') {
      return (
        <group position={[0, poleHeight - 0.25, 0]}>
          {/* Streamlined teardrop housing */}
          <mesh position={[0.2, 0, 0]} rotation={[0, 0, -0.25]}>
            <cylinderGeometry args={[0.05, 0.05, 0.8, 10]} />
            <meshStandardMaterial color={color} metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh position={[0.42, -0.1, 0]}>
            <cylinderGeometry args={[0.17, 0.1, 0.28, 12]} />
            <meshStandardMaterial
              color="#fff2cf"
              emissive={emissive}
              emissiveIntensity={1.1}
            />
          </mesh>
        </group>
      );
    }
    if (style === 'modern') {
      return (
        <group position={[0, poleHeight - 0.15, 0]}>
          <mesh position={[0.35, 0, 0]}>
            <boxGeometry args={[0.75, 0.12, 0.24]} />
            <meshStandardMaterial color={color} metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0.35, -0.09, 0]}>
            <boxGeometry args={[0.62, 0.03, 0.2]} />
            <meshStandardMaterial color="#ffffff" emissive={emissive} emissiveIntensity={1.4} />
          </mesh>
        </group>
      );
    }
    // led
    return (
      <group position={[0, poleHeight - 0.2, 0]}>
        <mesh position={[0.5, -0.05, 0]} rotation={[0, 0, -0.45]}>
          <cylinderGeometry args={[0.02, 0.02, 1.0, 6]} />
          <meshStandardMaterial color="#cfd6dc" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0.92, -0.16, 0]}>
          <boxGeometry args={[0.5, 0.08, 0.12]} />
          <meshStandardMaterial color={emissive} emissive={emissive} emissiveIntensity={1.6} />
        </mesh>
      </group>
    );
  })();

  return (
    <group position={[x, 0, z]}>
      {/* Base */}
      <mesh position={[0, 0.09, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.24, 0.18, 12]} />
        <meshStandardMaterial color={color} metalness={0.4} roughness={0.6} />
      </mesh>
      {/* Pole */}
      <mesh position={[0, poleHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[poleRadius, poleRadius, poleHeight, 10]} />
        <meshStandardMaterial color={color} metalness={0.5} roughness={0.5} />
      </mesh>
      {head}
    </group>
  );
}

/** Traffic signal on a pole spanning the road, with era-specific head. */
function TrafficSignal({ style, x }: { style: SignalStyle; x: number }) {
  const lenses: [string, number][] = [
    ['#e23b3b', 0.42],
    ['#f0c33c', 0],
    ['#3fae4a', -0.42],
  ];

  return (
    <group position={[x, 0, 0]}>
      {/* Pole on the south kerb */}
      <mesh position={[0, 2.2, LAMP_Z]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 4.4, 8]} />
        <meshStandardMaterial color="#3a3f45" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Arm over the road */}
      <mesh position={[0, 4.2, 2.0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 4.0, 6]} />
        <meshStandardMaterial color="#3a3f45" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Signal head */}
      <group position={[0, 3.4, 0]}>
        <mesh>
          <boxGeometry args={[0.62, 1.5, 0.34]} />
          <meshStandardMaterial color="#20242a" roughness={0.6} />
        </mesh>
        {lenses.map(([lensColor, y], i) => (
          <mesh key={i} position={[0, y, 0.18]}>
            <circleGeometry args={[0.13, 16]} />
            <meshStandardMaterial
              color={lensColor}
              emissive={lensColor}
              emissiveIntensity={i === 0 ? 0.9 : 0.35}
            />
          </mesh>
        ))}
        {style === 'smart' && (
          <group position={[0, 0.95, 0.18]}>
            {/* Sensor / camera on top of the smart head */}
            <mesh>
              <boxGeometry args={[0.24, 0.12, 0.18]} />
              <meshStandardMaterial color="#d8dde2" metalness={0.7} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.02, 0.1]}>
              <sphereGeometry args={[0.05, 10, 10]} />
              <meshStandardMaterial color="#1f2a33" roughness={0.2} metalness={0.6} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}

/** Overhead telegraph wires (1945) and/or power lines (1965+). */
function OverheadWires({ furniture }: { furniture: FurnitureConfig }) {
  const wires: ReactNode[] = [];

  if (furniture.telegraphWires) {
    for (const x of LAMP_XS) {
      for (const h of [3.1, 2.9, 2.7]) {
        wires.push(
          <SaggingWire
            key={`telegraph-${x}-${h}`}
            start={[x, h, LAMP_Z]}
            end={[x, h, -LAMP_Z]}
            sag={0.25}
            radius={0.006}
            color="#1a1a1a"
          />,
        );
      }
    }
  }

  if (furniture.powerLines) {
    for (const x of LAMP_XS) {
      for (const h of [3.4, 3.2]) {
        wires.push(
          <SaggingWire
            key={`power-${x}-${h}`}
            start={[x, h, LAMP_Z - 0.1]}
            end={[x, h, -(LAMP_Z - 0.1)]}
            sag={0.3}
            radius={0.018}
            color="#2b2b2b"
          />,
        );
      }
    }
  }

  return <group>{wires}</group>;
}

/** A street planter (bollard-style concrete box with foliage). */
function Planter({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.7, 0.36, 0.7]} />
        <meshStandardMaterial color="#8a8578" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <sphereGeometry args={[0.3, 10, 10]} />
        <meshStandardMaterial color="#3f8f4a" roughness={0.9} />
      </mesh>
      <mesh position={[-0.12, 0.5, 0.05]}>
        <coneGeometry args={[0.12, 0.28, 8]} />
        <meshStandardMaterial color="#4aa35a" roughness={0.9} />
      </mesh>
      <mesh position={[0.13, 0.52, -0.06]}>
        <coneGeometry args={[0.1, 0.24, 8]} />
        <meshStandardMaterial color="#377f42" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Plain concrete street furniture (1985): bollards + a bench. */
function ConcreteFurniture({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* Bench */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[1.3, 0.08, 0.5]} />
        <meshStandardMaterial color="#7d7a72" roughness={0.95} />
      </mesh>
      <mesh position={[-0.5, 0.16, 0]}>
        <boxGeometry args={[0.08, 0.32, 0.4]} />
        <meshStandardMaterial color="#6f6c64" roughness={0.95} />
      </mesh>
      <mesh position={[0.5, 0.16, 0]}>
        <boxGeometry args={[0.08, 0.32, 0.4]} />
        <meshStandardMaterial color="#6f6c64" roughness={0.95} />
      </mesh>
      {/* Bollards */}
      {[-1.0, 1.0].map((bx) => (
        <mesh key={bx} position={[bx, 0.3, 0.9]} castShadow>
          <cylinderGeometry args={[0.09, 0.11, 0.6, 10]} />
          <meshStandardMaterial color="#8a867c" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Smart sensor / camera pod mounted beside a lamp post (2025). */
function Sensor({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 2.4, z + 0.35]}>
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.26, 0.16, 0.14]} />
        <meshStandardMaterial color="#d8dde2" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.01, 0.1]}>
        <sphereGeometry args={[0.055, 10, 10]} />
        <meshStandardMaterial color="#1f2a33" roughness={0.2} metalness={0.6} />
      </mesh>
      <mesh position={[0.16, 0, 0]}>
        <boxGeometry args={[0.05, 0.05, 0.05]} />
        <meshStandardMaterial color="#9be8ff" emissive="#9be8ff" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

/** Small hovering quadcopter drone (2025). */
function Drone() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = 5 + Math.sin(clock.elapsedTime * 1.2) * 0.15;
      ref.current.rotation.y = clock.elapsedTime * 0.6;
    }
  });

  const arms: [number, number, number][] = [
    [-0.3, 0, -0.3],
    [0.3, 0, -0.3],
    [-0.3, 0, 0.3],
    [0.3, 0, 0.3],
  ];

  return (
    <group ref={ref} position={[5, 5, 2]}>
      <mesh>
        <boxGeometry args={[0.4, 0.1, 0.4]} />
        <meshStandardMaterial color="#e8e8e8" metalness={0.7} roughness={0.3} />
      </mesh>
      {arms.map((p, i) => (
        <mesh key={i} position={p}>
          <cylinderGeometry args={[0.02, 0.02, 0.5, 6]} />
          <meshStandardMaterial color="#555555" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {arms.map((p, i) => (
        <mesh key={`rotor-${i}`} position={[p[0], 0.08, p[2]]}>
          <boxGeometry args={[0.3, 0.01, 0.05]} />
          <meshStandardMaterial color="#dddddd" />
        </mesh>
      ))}
    </group>
  );
}

/** Era-variant street furniture, placed along both kerbs. */
export function Furniture({ config }: { config: EraStreetConfig }) {
  const { furniture } = config;
  const elements: ReactNode[] = [];

  // Lamp posts (and optional smart sensors on a subset in 2025).
  LAMP_XS.forEach((x, i) => {
    elements.push(
      <LampPost
        key={`lamp-n-${x}`}
        style={furniture.lampStyle}
        color={furniture.lampColor}
        emissive={furniture.lampEmissive}
        x={x}
        z={LAMP_Z}
      />,
    );
    elements.push(
      <LampPost
        key={`lamp-s-${x}`}
        style={furniture.lampStyle}
        color={furniture.lampColor}
        emissive={furniture.lampEmissive}
        x={x}
        z={-LAMP_Z}
      />,
    );
    if (furniture.sensors && i % 2 === 0) {
      elements.push(<Sensor key={`sensor-n-${x}`} x={x} z={LAMP_Z} />);
      elements.push(<Sensor key={`sensor-s-${x}`} x={x} z={-LAMP_Z} />);
    }
  });

  // Traffic signals at intersections.
  if (furniture.signalStyle) {
    for (const x of [-8, 0, 8]) {
      elements.push(
        <TrafficSignal key={`signal-${x}`} style={furniture.signalStyle} x={x} />,
      );
    }
  }

  // Planters (2005, 2025).
  if (furniture.planters) {
    for (const x of [-10, -2, 4, 10]) {
      elements.push(<Planter key={`planter-n-${x}`} x={x} z={4.9} />);
      elements.push(<Planter key={`planter-s-${x}`} x={x} z={-4.9} />);
    }
  }

  // Concrete street furniture (1985).
  if (furniture.concreteFurniture) {
    for (const x of [-9, 3, 9]) {
      elements.push(<ConcreteFurniture key={`concrete-n-${x}`} x={x} z={4.9} />);
      elements.push(<ConcreteFurniture key={`concrete-s-${x}`} x={x} z={-4.9} />);
    }
  }

  return (
    <group>
      <OverheadWires furniture={furniture} />
      {elements}
      {furniture.drone && <Drone />}
    </group>
  );
}