import { useCallback, useMemo, type FC } from 'react';
import { BLOCK_LAYOUT } from '@/config/blockLayout';
import { getEraTheme, type PropKind } from '@/config/eraTheme';
import type { EraId } from '@/config/years';
import {
  useHoverHandlers,
  propHoverInfo,
} from '@/utils/hoverHandlers';
import { useYearStore } from '@/store/yearStore';

/**
 * Sidewalk props: lamps, benches, trees, hydrants, signs, holograms.
 *
 * The prop *kinds* change with the era (e.g. holograms only appear in the
 * present), giving each period distinct street furniture.
 */

/** A single procedural prop instance. */
const Prop: FC<{ kind: PropKind; x: number; z: number; id: string }> = ({
  kind,
  x,
  z,
  id,
}) => {
  // Hover handlers — resolve era lazily for year-specific tooltip text.
  const infoFactory = useCallback(
    () =>
      propHoverInfo(
        id,
        useYearStore.getState().targetYear,
        kind.charAt(0).toUpperCase() + kind.slice(1),
      ),
    [id, kind],
  );
  const { onPointerOver, onPointerOut, onPointerMove } =
    useHoverHandlers(infoFactory);

  // Shared hover props spread onto the primary mesh of each prop variant.
  const hoverProps = { onPointerOver, onPointerOut, onPointerMove };

  switch (kind) {
    case 'lamp':
      return (
        <group position={[x, 0, z]}>
          {/* Pole */}
          <mesh position={[0, 2, 0]} castShadow {...hoverProps}>
            <cylinderGeometry args={[0.08, 0.1, 4, 8]} />
            <meshStandardMaterial color="#3a3a3a" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Arm */}
          <mesh position={[0.4, 3.9, 0]} castShadow>
            <boxGeometry args={[0.8, 0.1, 0.1]} />
            <meshStandardMaterial color="#3a3a3a" />
          </mesh>
          {/* Lamp head */}
          <mesh position={[0.7, 3.85, 0]}>
            <sphereGeometry args={[0.18, 8, 8]} />
            <meshStandardMaterial color="#fff5c0" emissive="#ffd27a" emissiveIntensity={0.8} />
          </mesh>
        </group>
      );
    case 'bench':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]} castShadow {...hoverProps}>
            <boxGeometry args={[1.6, 0.1, 0.5]} />
            <meshStandardMaterial color="#6a4a2a" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.9, -0.2]} castShadow>
            <boxGeometry args={[1.6, 0.5, 0.1]} />
            <meshStandardMaterial color="#6a4a2a" roughness={0.8} />
          </mesh>
        </group>
      );
    case 'tree':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 1, 0]} castShadow {...hoverProps}>
            <cylinderGeometry args={[0.15, 0.2, 2, 8]} />
            <meshStandardMaterial color="#5a3a2a" roughness={0.9} />
          </mesh>
          <mesh position={[0, 2.6, 0]} castShadow>
            <sphereGeometry args={[1.1, 10, 10]} />
            <meshStandardMaterial color="#3a6a3a" roughness={0.9} />
          </mesh>
        </group>
      );
    case 'hydrant':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]} castShadow {...hoverProps}>
            <cylinderGeometry args={[0.18, 0.22, 1, 8]} />
            <meshStandardMaterial color="#c0392b" roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.05, 0]}>
            <sphereGeometry args={[0.22, 8, 8]} />
            <meshStandardMaterial color="#c0392b" roughness={0.6} />
          </mesh>
        </group>
      );
    case 'sign':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 1.5, 0]} castShadow {...hoverProps}>
            <cylinderGeometry args={[0.05, 0.05, 3, 6]} />
            <meshStandardMaterial color="#555" />
          </mesh>
          <mesh position={[0, 2.8, 0]}>
            <boxGeometry args={[0.8, 0.5, 0.05]} />
            <meshStandardMaterial color="#2a6a8a" emissive="#2a6a8a" emissiveIntensity={0.2} />
          </mesh>
        </group>
      );
    case 'hologram':
      return (
        <group position={[x, 0, z]}>
          {/* Base ring */}
          <mesh position={[0, 0.1, 0]} {...hoverProps}>
            <torusGeometry args={[0.4, 0.05, 8, 16]} />
            <meshStandardMaterial color="#1a3a4a" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Holo beam */}
          <mesh position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.3, 0.35, 3, 12, 1, true]} />
            <meshStandardMaterial
              color="#00ccff"
              emissive="#00ccff"
              emissiveIntensity={0.7}
              transparent
              opacity={0.4}
            />
          </mesh>
        </group>
      );
    default:
      return null;
  }
};

interface PropsProps {
  era: EraId;
}

/**
 * Scatters era-appropriate props along the sidewalks.
 */
const Props: FC<PropsProps> = ({ era }) => {
  const placements = useMemo(() => {
    const theme = getEraTheme(era);
    const kinds = theme.props;
    // Walk the sidewalk segments and place a prop every few units.
    const items: Array<{ id: string; kind: PropKind; x: number; z: number }> = [];
    let counter = 0;
    for (const sw of BLOCK_LAYOUT.sidewalks) {
      const isHorizontal = sw.width >= sw.depth;
      const span = isHorizontal ? sw.width : sw.depth;
      const count = Math.max(1, Math.floor(span / 10));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const offset = -span / 2 + span * t;
        const kind = kinds[counter % kinds.length];
        if (!kind) continue;
        items.push({
          id: `prop-${era}-${counter}`,
          kind,
          x: isHorizontal ? sw.x + offset : sw.x,
          z: isHorizontal ? sw.z : sw.z + offset,
        });
        counter++;
      }
    }
    return items;
  }, [era]);

  return (
    <group>
      {placements.map((p) => (
        <Prop key={p.id} id={p.id} kind={p.kind} x={p.x} z={p.z} />
      ))}
    </group>
  );
};

export default Props;
