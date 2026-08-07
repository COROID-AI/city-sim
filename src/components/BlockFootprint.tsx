/**
 * Base block footprint: an empty, lit ground plane with a single placeholder
 * block. Later tasks replace this with the full city block and its buildings.
 */
export function BlockFootprint() {
  return (
    <group>
      {/* Ground plane */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#3a3f44" roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Placeholder building block */}
      <mesh position={[0, 1, 0]} castShadow receiveShadow>
        <boxGeometry args={[4, 2, 4]} />
        <meshStandardMaterial color="#8a8f94" roughness={0.7} metalness={0.2} />
      </mesh>
    </group>
  );
}
