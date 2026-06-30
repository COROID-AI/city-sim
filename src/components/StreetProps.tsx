/**
 * StreetProps
 *
 * Renders the era-dependent set of street props: lampposts, benches, trash
 * cans, and phone booths. Each prop type is conditionally included based on
 * the `StreetPropsConfig` for the active era (e.g. phone booths appear in
 * 1965/1985 but disappear by 2005/2025).
 *
 * All props are positioned on the sidewalk band with a small Y offset to
 * avoid z-fighting with the ground plane.
 */
import type { FC } from 'react';
import type { StreetPropsConfig } from '@/config/storefronts';

/** Small offset above the ground to avoid z-fighting. */
const GROUND_OFFSET = 0.02;

export interface StreetPropsComponentProps {
  /** Era-specific prop availability flags. */
  readonly config: StreetPropsConfig;
}

/* -------------------------------------------------------------------------- */
/* Individual prop components                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A classic street lamppost: a tall pole topped with a glowing lamp head.
 */
const Lamppost: FC<{ position: [number, number, number] }> = ({ position }) => {
  const [x, y, z] = position;
  return (
    <group position={[x, y + GROUND_OFFSET, z]}>
      {/* Pole */}
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 5, 8]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Lamp head */}
      <mesh position={[0, 5, 0]} castShadow>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshStandardMaterial
          color="#fff5e1"
          emissive="#ffd700"
          emissiveIntensity={0.8}
        />
      </mesh>
      {/* Base plate */}
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.3, 0.1, 12]} />
        <meshStandardMaterial color="#3a3a3a" />
      </mesh>
    </group>
  );
};

/**
 * A simple park bench: seat + backrest + legs.
 */
const Bench: FC<{ position: [number, number, number] }> = ({ position }) => {
  const [x, y, z] = position;
  return (
    <group position={[x, y + GROUND_OFFSET, z]}>
      {/* Seat */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1.8, 0.1, 0.5]} />
        <meshStandardMaterial color="#6b4a2a" />
      </mesh>
      {/* Backrest */}
      <mesh position={[0, 0.85, -0.22]} castShadow>
        <boxGeometry args={[1.8, 0.6, 0.08]} />
        <meshStandardMaterial color="#6b4a2a" />
      </mesh>
      {/* Legs */}
      <mesh position={[-0.75, 0.25, 0]} castShadow>
        <boxGeometry args={[0.1, 0.5, 0.45]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0.75, 0.25, 0]} castShadow>
        <boxGeometry args={[0.1, 0.5, 0.45]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
};

/**
 * A cylindrical trash can with a lid.
 */
const TrashCan: FC<{ position: [number, number, number] }> = ({ position }) => {
  const [x, y, z] = position;
  return (
    <group position={[x, y + GROUND_OFFSET, z]}>
      {/* Body */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.28, 1, 12]} />
        <meshStandardMaterial color="#4a5a4a" metalness={0.4} roughness={0.6} />
      </mesh>
      {/* Lid */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.32, 0.1, 12]} />
        <meshStandardMaterial color="#3a4a3a" metalness={0.4} roughness={0.6} />
      </mesh>
    </group>
  );
};

/**
 * A classic red telephone booth (UK-style), present only in mid-century eras.
 */
const PhoneBooth: FC<{ position: [number, number, number] }> = ({
  position,
}) => {
  const [x, y, z] = position;
  return (
    <group position={[x, y + GROUND_OFFSET, z]}>
      {/* Body */}
      <mesh position={[0, 1.3, 0]} castShadow>
        <boxGeometry args={[0.9, 2.6, 0.9]} />
        <meshStandardMaterial color="#8b1a1a" />
      </mesh>
      {/* Roof */}
      <mesh position={[0, 2.7, 0]} castShadow>
        <boxGeometry args={[1, 0.15, 1]} />
        <meshStandardMaterial color="#5a0a0a" />
      </mesh>
      {/* Window panes (front) */}
      <mesh position={[0, 1.5, 0.46]}>
        <boxGeometry args={[0.7, 1.8, 0.02]} />
        <meshStandardMaterial
          color="#aabbcc"
          emissive="#445566"
          emissiveIntensity={0.1}
          metalness={0.5}
          roughness={0.1}
        />
      </mesh>
    </group>
  );
};

/* -------------------------------------------------------------------------- */
/* Aggregate component                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Fixed prop positions along the sidewalk band. These are placed clear of the
 * building footprints so they never clip or obstruct procedural buildings,
 * vehicles, or pedestrians.
 */
const PROP_POSITIONS = {
  lampposts: [
    [-9, 0, 7],
    [9, 0, 7],
    [-9, 0, -7],
    [9, 0, -7],
  ] as readonly [number, number, number][],
  benches: [
    [-6, 0, 7],
    [6, 0, -7],
  ] as readonly [number, number, number][],
  trashCans: [
    [-6, 0, -7],
    [6, 0, 7],
  ] as readonly [number, number, number][],
  phoneBooths: [
    [-3, 0, 7],
  ] as readonly [number, number, number][],
};

/**
 * Renders the full era-dependent set of street props. Props that are disabled
 * for the current era are simply omitted from the scene.
 */
const StreetProps: FC<StreetPropsComponentProps> = ({ config }) => {
  return (
    <group>
      {config.lamppost &&
        PROP_POSITIONS.lampposts.map((pos, i) => (
          <Lamppost key={`lamp-${i}`} position={pos} />
        ))}
      {config.bench &&
        PROP_POSITIONS.benches.map((pos, i) => (
          <Bench key={`bench-${i}`} position={pos} />
        ))}
      {config.trashCan &&
        PROP_POSITIONS.trashCans.map((pos, i) => (
          <TrashCan key={`trash-${i}`} position={pos} />
        ))}
      {config.phoneBooth &&
        PROP_POSITIONS.phoneBooths.map((pos, i) => (
          <PhoneBooth key={`phone-${i}`} position={pos} />
        ))}
    </group>
  );
};

export default StreetProps;
