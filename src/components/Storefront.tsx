/**
 * Storefront
 *
 * Renders a single storefront: a low building mass with an awning and a
 * sign plate whose business name and color scheme swap per era. Uses drei
 * `Text` for the label so no external font assets are required.
 */
import { Text } from '@react-three/drei';
import type { FC } from 'react';
import type { Vector3 } from 'three';
import type { StorefrontConfig } from '@/config/storefronts';

export interface StorefrontProps {
  /** World position of the storefront base. */
  readonly position: [number, number, number];
  /** Era-specific sign data. */
  readonly config: StorefrontConfig;
  /** Optional rotation (radians) around Y. */
  readonly rotationY?: number;
}

/**
 * Small offset above the ground plane to avoid z-fighting with the ground
 * mesh (drei-compatible sidewalk offset).
 */
const GROUND_OFFSET = 0.02;

/**
 * A single storefront facade: building mass + awning + sign plate with text.
 */
const Storefront: FC<StorefrontProps> = ({
  position,
  config,
  rotationY = 0,
}) => {
  const [x, y, z] = position;

  return (
    <group position={[x, y + GROUND_OFFSET, z]} rotation={[0, rotationY, 0]}>
      {/* Building mass behind the storefront */}
      <mesh position={[0, 3, -1.5]} castShadow receiveShadow>
        <boxGeometry args={[5, 6, 3]} />
        <meshStandardMaterial color="#6b6b6b" />
      </mesh>

      {/* Awning above the storefront entrance */}
      <mesh position={[0, 3.2, 0.4]} castShadow>
        <boxGeometry args={[5, 0.3, 1.2]} />
        <meshStandardMaterial color={config.awningColor} />
      </mesh>

      {/* Sign plate */}
      <mesh position={[0, 4.4, 0.1]} castShadow>
        <boxGeometry args={[4.6, 1.1, 0.15]} />
        <meshStandardMaterial
          color={config.signColor}
          emissive={config.signColor}
          emissiveIntensity={0.25}
        />
      </mesh>

      {/* Sign text — drei Text avoids external font dependencies */}
      <Text
        position={[0, 4.4, 0.22]}
        fontSize={0.55}
        color={config.textColor}
        anchorX="center"
        anchorY="middle"
        maxWidth={4.4}
        textAlign="center"
      >
        {config.name}
      </Text>

      {/* Storefront window / entrance */}
      <mesh position={[0, 1.5, 0.05]}>
        <boxGeometry args={[4, 2.6, 0.1]} />
        <meshStandardMaterial
          color="#2a3a4a"
          emissive="#1a2a3a"
          emissiveIntensity={0.15}
          metalness={0.3}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
};

export default Storefront;

/** Re-export the Vector3 tuple type for downstream consumers. */
export type PositionTuple = [number, number, number];

/** Helper to coerce a Vector3-like into a tuple (kept for API symmetry). */
export function toPositionTuple(v: Vector3): PositionTuple {
  return [v.x, v.y, v.z];
}
