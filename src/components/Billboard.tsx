/**
 * Billboard
 *
 * Renders a raised billboard with two support posts and a board face that
 * displays era-specific ad copy via drei `Text`. The board background and
 * text colors swap per era.
 */
import { Text } from '@react-three/drei';
import type { FC } from 'react';
import type { BillboardConfig } from '@/config/storefronts';

export interface BillboardProps {
  /** World position of the billboard base. */
  readonly position: [number, number, number];
  /** Era-specific ad data. */
  readonly config: BillboardConfig;
  /** Optional rotation (radians) around Y. */
  readonly rotationY?: number;
}

/** Small offset above the ground to avoid z-fighting. */
const GROUND_OFFSET = 0.02;

/**
 * A single billboard: two posts + board face with headline and subline text.
 */
const Billboard: FC<BillboardProps> = ({
  position,
  config,
  rotationY = 0,
}) => {
  const [x, y, z] = position;

  return (
    <group position={[x, y + GROUND_OFFSET, z]} rotation={[0, rotationY, 0]}>
      {/* Support posts */}
      <mesh position={[-2.5, 4, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, 8, 8]} />
        <meshStandardMaterial color="#4a4a4a" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[2.5, 4, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, 8, 8]} />
        <meshStandardMaterial color="#4a4a4a" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Board face */}
      <mesh position={[0, 8, 0]} castShadow>
        <boxGeometry args={[6, 3, 0.2]} />
        <meshStandardMaterial
          color={config.boardColor}
          emissive={config.boardColor}
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* Headline text */}
      <Text
        position={[0, 8.4, 0.15]}
        fontSize={0.7}
        color={config.textColor}
        anchorX="center"
        anchorY="middle"
        maxWidth={5.6}
        textAlign="center"
      >
        {config.headline}
      </Text>

      {/* Subline text */}
      {config.subline.length > 0 && (
        <Text
          position={[0, 7.5, 0.15]}
          fontSize={0.45}
          color={config.textColor}
          anchorX="center"
          anchorY="middle"
          maxWidth={5.6}
          textAlign="center"
        >
          {config.subline}
        </Text>
      )}
    </group>
  );
};

export default Billboard;
