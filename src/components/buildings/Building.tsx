/**
 * Procedural building component.
 *
 * Renders a single building as a box mesh with `meshStandardMaterial`, at
 * least one window row (emissive quads on the front facade), and an optional
 * roof detail mesh. All visual properties are driven by props so the same
 * component can render any era's architecture.
 *
 * Transition support: `transitionColor` and `transitionProgress` allow the
 * downstream animation task to cross-fade between eras. When
 * `transitionProgress` is 0 the building shows `facadeColor`; at 1 it shows
 * `transitionColor`.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { BuildingStyle } from '@/config/years';
import type { WindowPattern, RoofDetail, SignageConfig } from './buildingStyles';

/** Props accepted by the `Building` component. */
export interface BuildingProps {
  /** Architectural style key. */
  readonly style: BuildingStyle;
  /** Building height in world units. */
  readonly height: number;
  /** Facade base color (hex string). */
  readonly facadeColor: string;
  /** Window grid pattern descriptor. */
  readonly windowPattern: WindowPattern;
  /** Optional roof detail. */
  readonly roof: RoofDetail;
  /** Commercial signage descriptor. */
  readonly signage: SignageConfig;
  /** Target color during era transition (hex string). */
  readonly transitionColor?: string;
  /** Transition progress [0..1]; 0 = facadeColor, 1 = transitionColor. */
  readonly transitionProgress?: number;
  /** Footprint width (x axis). Defaults to 5. */
  readonly width?: number;
  /** Footprint depth (z axis). Defaults to 5. */
  readonly depth?: number;
  /** World position [x, y, z]. Defaults to origin. */
  readonly position?: [number, number, number];
}

/** Default footprint dimensions. */
const DEFAULT_WIDTH = 5;
const DEFAULT_DEPTH = 5;

/**
 * Compute the interpolated facade color between two hex colors at a given
 * progress. Returns the base color when no transition is active.
 */
function interpolateColor(
  base: string,
  target: string | undefined,
  progress: number | undefined,
): THREE.Color {
  const baseColor = new THREE.Color(base);
  if (!target || progress === undefined || progress <= 0) {
    return baseColor;
  }
  if (progress >= 1) {
    return new THREE.Color(target);
  }
  return baseColor.lerp(new THREE.Color(target), progress);
}

/**
 * Generate window instance data for the front facade. Each window is a small
 * emissive quad offset slightly in front of the facade to avoid z-fighting.
 */
function useWindowInstances(
  windowPattern: WindowPattern,
  width: number,
  height: number,
): Array<{ position: [number, number, number]; scale: [number, number, number] }>
{
  return useMemo(() => {
    const { rows, columns } = windowPattern;
    const instances: Array<{
      position: [number, number, number];
      scale: [number, number, number];
    }> = [];

    const windowWidth = (width * 0.7) / columns;
    const windowHeight = (height * 0.7) / rows;
    const startX = -((columns - 1) * windowWidth * 1.3) / 2;
    const startY = height * 0.15;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        instances.push({
          position: [
            startX + col * windowWidth * 1.3,
            startY + row * windowHeight * 1.3,
            width * 0.01 + 0.05, // slight offset from facade
          ],
          scale: [windowWidth, windowHeight, 1],
        });
      }
    }
    return instances;
  }, [windowPattern, width, height]);
}

/**
 * Render the roof detail mesh based on `roof.type`.
 */
function RoofMesh({
  roof,
  width,
  depth,
}: {
  readonly roof: RoofDetail;
  readonly width: number;
  readonly depth: number;
}): JSX.Element | null {
  const roofY = roof.height / 2;

  switch (roof.type) {
    case 'flat':
      return (
        <mesh position={[0, roofY, 0]} castShadow>
          <boxGeometry args={[width * 0.95, roof.height, depth * 0.95]} />
          <meshStandardMaterial color={roof.color} />
        </mesh>
      );
    case 'setback':
      return (
        <group>
          <mesh position={[0, roofY, 0]} castShadow>
            <boxGeometry
              args={[width * 0.7, roof.height, depth * 0.7]}
            />
            <meshStandardMaterial color={roof.color} />
          </mesh>
        </group>
      );
    case 'spire':
      return (
        <mesh position={[0, roofY, 0]} castShadow>
          <coneGeometry
            args={[Math.min(width, depth) * 0.2, roof.height, 4]}
          />
          <meshStandardMaterial color={roof.color} />
        </mesh>
      );
    case 'antenna':
      return (
        <mesh position={[0, roofY, 0]} castShadow>
          <cylinderGeometry
            args={[0.1, 0.1, roof.height, 6]}
          />
          <meshStandardMaterial color={roof.color} />
        </mesh>
      );
    case 'dome':
      return (
        <mesh position={[0, roofY, 0]} castShadow>
          <sphereGeometry
            args={[Math.min(width, depth) * 0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]}
          />
          <meshStandardMaterial color={roof.color} />
        </mesh>
      );
    case 'none':
    default:
      return null;
  }
}

/**
 * Procedural building component.
 *
 * @example
 * <Building
 *   style="artDeco"
 *   height={12}
 *   facadeColor="#8a7a6a"
 *   windowPattern={{ rows: 4, columns: 3, color: '#ffd9a0', intensity: 0.6 }}
 *   roof={{ type: 'setback', height: 2, color: '#6b5b4a' }}
 *   signage={{ enabled: false, text: '', color: '#000000' }}
 * />
 */
const Building = ({
  style,
  height,
  facadeColor,
  windowPattern,
  roof,
  signage,
  transitionColor,
  transitionProgress = 0,
  width = DEFAULT_WIDTH,
  depth = DEFAULT_DEPTH,
  position = [0, 0, 0],
}: BuildingProps): JSX.Element => {
  const groupRef = useRef<Group>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  // Pre-compute the resolved facade color for the current transition state.
  const resolvedColor = useMemo(
    () => interpolateColor(facadeColor, transitionColor, transitionProgress),
    [facadeColor, transitionColor, transitionProgress],
  );

  // Generate window positions deterministically.
  const windows = useWindowInstances(windowPattern, width, height);

  // Animate color interpolation via useFrame for smooth transitions.
  useFrame(() => {
    if (materialRef.current && transitionColor) {
      const target = interpolateColor(
        facadeColor,
        transitionColor,
        transitionProgress,
      );
      materialRef.current.color.lerp(target, 0.1);
    }
  });

  return (
    <group ref={groupRef} position={position} data-style={style}>
      {/* Main building body */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          ref={materialRef}
          color={resolvedColor}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>

      {/* Window rows on the front facade (z+) */}
      <group position={[0, 0, depth / 2]}>
        {windows.map((win, i) => (
          <mesh
            key={`window-${i}`}
            position={win.position}
            scale={win.scale}
          >
            <planeGeometry args={[1, 1]} />
            <meshStandardMaterial
              color={windowPattern.color}
              emissive={windowPattern.color}
              emissiveIntensity={windowPattern.intensity}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* Roof detail */}
      {roof.type !== 'none' && (
        <group position={[0, height, 0]}>
          <RoofMesh roof={roof} width={width} depth={depth} />
        </group>
      )}

      {/* Signage billboard (if enabled) */}
      {signage.enabled && (
        <mesh position={[0, height * 0.3, depth / 2 + 0.1]}>
          <planeGeometry args={[width * 0.6, 1]} />
          <meshStandardMaterial
            color={signage.color}
            emissive={signage.color}
            emissiveIntensity={0.7}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
};

export default Building;
