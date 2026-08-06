import type { ReactNode } from 'react';
import type { EraStreetConfig } from './eraConfig';

/**
 * Era-variant painted road markings, drawn as thin planes on top of the
 * road surface so they stay crisp regardless of the road texture tiling.
 */
export function RoadMarkings({ config }: { config: EraStreetConfig }) {
  const markings: ReactNode[] = [];
  const { road } = config;

  if (road.paintedLines) {
    // Dashed yellow centre line.
    for (let x = -14; x <= 14; x += 2) {
      markings.push(
        <mesh key={`centre-${x}`} position={[x, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.1, 0.12]} />
          <meshStandardMaterial color="#e8c84a" />
        </mesh>,
      );
    }
    // White lane divider lines.
    for (const z of [-1.75, 1.75]) {
      markings.push(
        <mesh key={`lane-${z}`} position={[0, 0.015, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[30, 0.08]} />
          <meshStandardMaterial color="#e8e8e8" roughness={0.9} />
        </mesh>,
      );
    }
  }

  if (road.bikeLanes) {
    // Coloured bike-lane bands along each kerb.
    for (const z of [-3.0, 3.0]) {
      markings.push(
        <mesh key={`bike-${z}`} position={[0, 0.014, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[30, 0.7]} />
          <meshStandardMaterial color="#3fae6a" transparent opacity={0.7} />
        </mesh>,
      );
    }
  }

  if (road.smartMarkers) {
    // Glowing embedded smart-road markers along the lane lines.
    for (let x = -14; x <= 14; x += 2) {
      for (const z of [-1.75, 1.75]) {
        markings.push(
          <mesh key={`led-${x}-${z}`} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.06, 12]} />
            <meshStandardMaterial
              color="#9be8ff"
              emissive="#9be8ff"
              emissiveIntensity={1.5}
            />
          </mesh>,
        );
      }
    }
  }

  return <group>{markings}</group>;
}