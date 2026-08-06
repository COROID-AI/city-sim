import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import type { EraBuildingConfig, BuildingSpec } from './eraConfig';
import type { EraMaterials } from './materials';

/** A single window pane instance in local building space. */
interface WindowInstance {
  x: number;
  y: number;
  z: number;
}

/**
 * Compute the instanced window panes for the two street-framing faces
 * (front and back in z). Returns pane centres offset just proud of each
 * facade so the glass reads against the wall.
 */
function computeWindowInstances(
  config: EraBuildingConfig,
  spec: BuildingSpec,
): WindowInstance[] {
  const w = config.window;
  const faceWidth = spec.width;
  const faceHeight = spec.height;

  const cols = Math.max(
    1,
    Math.floor((faceWidth - 2 * w.inset + w.gapX) / (w.width + w.gapX)),
  );
  const rows = Math.max(
    1,
    Math.floor((faceHeight - w.sillInset + w.gapY) / (w.height + w.gapY)),
  );

  const startX = -faceWidth / 2 + w.inset + w.width / 2;
  const startY = w.sillInset + w.height / 2;

  const instances: WindowInstance[] = [];
  const addFace = (zFace: number) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        instances.push({
          x: startX + c * (w.width + w.gapX),
          y: startY + r * (w.height + w.gapY),
          z: zFace,
        });
      }
    }
  };
  // Front (+z) and back (-z) faces.
  addFace(spec.depth / 2 + 0.06);
  addFace(-spec.depth / 2 - 0.06);
  return instances;
}

/**
 * Instanced window glass + frame. Both panes share per-era materials and are
 * written into InstancedMesh buffers once, so a whole facade is a single
 * draw call regardless of how many windows it has.
 */
function WindowInstances({
  config,
  spec,
  materials,
}: {
  config: EraBuildingConfig;
  spec: BuildingSpec;
  materials: EraMaterials;
}) {
  const glassRef = useRef<THREE.InstancedMesh>(null);
  const frameRef = useRef<THREE.InstancedMesh>(null);

  const instances = useMemo(
    () => computeWindowInstances(config, spec),
    [config, spec],
  );
  const count = instances.length;

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    instances.forEach((inst, i) => {
      p.set(inst.x, inst.y, inst.z);
      m.compose(p, q, s);
      glassRef.current?.setMatrixAt(i, m);
      frameRef.current?.setMatrixAt(i, m);
    });
    if (glassRef.current) {
      glassRef.current.instanceMatrix.needsUpdate = true;
    }
    if (frameRef.current) {
      frameRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [instances]);

  const { width, height } = config.window;

  return (
    <group>
      <instancedMesh
        ref={glassRef}
        args={[undefined, undefined, count]}
        material={materials.glass}
        castShadow
      >
        <boxGeometry args={[width, height, 0.05]} />
      </instancedMesh>
      {/* Frame is a slightly larger box behind the glass → framed window look. */}
      <instancedMesh
        ref={frameRef}
        args={[undefined, undefined, count]}
        material={materials.frame}
      >
        <boxGeometry args={[width + 0.14, height + 0.14, 0.07]} />
      </instancedMesh>
    </group>
  );
}

/** Pitched gable roof (1945 walk-ups): triangular prism extruded along depth. */
function PitchedRoof({
  spec,
  materials,
}: {
  spec: BuildingSpec;
  materials: EraMaterials;
}) {
  const geometry = useMemo(() => {
    const halfW = spec.width / 2 + 0.1;
    const ridgeH = spec.depth * 0.45;
    const shape = new THREE.Shape();
    shape.moveTo(-halfW, 0);
    shape.lineTo(0, ridgeH);
    shape.lineTo(halfW, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: spec.depth + 0.2,
      bevelEnabled: false,
    });
    geo.translate(0, 0, -(spec.depth + 0.2) / 2);
    return geo;
  }, [spec.width, spec.depth]);

  return (
    <mesh
      geometry={geometry}
      position={[0, spec.height, 0]}
      material={materials.roof}
      castShadow
    />
  );
}

/** Flat / parapet / crown roofs share a thin cap box above the wall. */
function FlatRoof({
  spec,
  materials,
}: {
  spec: BuildingSpec;
  materials: EraMaterials;
}) {
  return (
    <mesh
      position={[0, spec.height, 0]}
      material={materials.roof}
      castShadow
    >
      <boxGeometry
        args={[spec.width + 0.12, 0.18, spec.depth + 0.12]}
      />
    </mesh>
  );
}

/** Cast-iron fire escape on the street-facing facade (1945). */
function FireEscape({
  spec,
  streetZ,
  materials,
}: {
  spec: BuildingSpec;
  streetZ: number;
  materials: EraMaterials;
}) {
  const xPos = -spec.width / 4;
  const out = streetZ >= 0 ? 0.05 : -0.05;
  const z = streetZ + out;
  const elements: ReactNode[] = [];

  // Vertical rails.
  for (const rx of [-0.32, 0.32]) {
    elements.push(
      <mesh
        key={`rail-${rx}`}
        position={[xPos + rx, spec.height / 2, z]}
        material={materials.frame}
      >
        <boxGeometry args={[0.04, spec.height, 0.04]} />
      </mesh>,
    );
  }
  // Landing platforms at each floor.
  for (let f = 1; f <= spec.floors; f++) {
    const y = f * 3 - 0.5;
    elements.push(
      <mesh key={`plat-${f}`} position={[xPos, y, z]} material={materials.frame}>
        <boxGeometry args={[0.72, 0.05, 0.3]} />
      </mesh>,
    );
  }
  // Diagonal stair runs between landings.
  for (let f = 1; f < spec.floors; f++) {
    const y0 = f * 3 - 0.5;
    const y1 = (f + 1) * 3 - 0.5;
    elements.push(
      <mesh
        key={`stair-${f}`}
        position={[xPos + 0.32, (y0 + y1) / 2, z]}
        rotation={[0, 0, Math.atan2(y1 - y0, 0.64)]}
        material={materials.frame}
      >
        <boxGeometry args={[0.72, 0.04, 0.3]} />
      </mesh>,
    );
  }

  return <group>{elements}</group>;
}

/** Ground-floor storefront glazing + sign band (2005 mixed-use). */
function Storefront({
  spec,
  streetZ,
  materials,
}: {
  spec: BuildingSpec;
  streetZ: number;
  materials: EraMaterials;
}) {
  const out = streetZ >= 0 ? 0.06 : -0.06;
  const z = streetZ + out;
  const width = spec.width * 0.86;
  return (
    <group>
      <mesh position={[0, 1.3, z]} material={materials.glass}>
        <boxGeometry args={[width, 2.0, 0.05]} />
      </mesh>
      <mesh position={[0, 2.5, z]} material={materials.accent}>
        <boxGeometry args={[width, 0.35, 0.06]} />
      </mesh>
      <mesh position={[0, 1.0, z]} material={materials.frame}>
        <boxGeometry args={[0.9, 2.0, 0.06]} />
      </mesh>
    </group>
  );
}

/** Horizontal cladding panels between floors on both long faces (2005). */
function CladdingPanels({
  spec,
  materials,
}: {
  spec: BuildingSpec;
  materials: EraMaterials;
}) {
  const elements: ReactNode[] = [];
  for (let f = 1; f < spec.floors; f++) {
    const y = f * 3;
    for (const zz of [spec.depth / 2 + 0.03, -spec.depth / 2 - 0.03]) {
      elements.push(
        <mesh key={`${f}-${zz}`} position={[0, y, zz]} material={materials.accent}>
          <boxGeometry args={[spec.width, 0.18, 0.06]} />
        </mesh>,
      );
    }
  }
  return <group>{elements}</group>;
}

/** Roof garden + balcony planters (2025). */
function Greenery({
  spec,
  streetZ,
  materials,
}: {
  spec: BuildingSpec;
  streetZ: number;
  materials: EraMaterials;
}) {
  const out = streetZ >= 0 ? 0.07 : -0.07;
  const z = streetZ + out;
  const elements: ReactNode[] = [];

  // Roof garden pad.
  elements.push(
    <mesh
      key="roof-garden"
      position={[0, spec.height + 0.1, 0]}
      material={materials.green}
    >
      <boxGeometry args={[spec.width * 0.8, 0.12, spec.depth * 0.8]} />
    </mesh>,
  );

  // Balcony planters on alternating floors.
  for (let f = 2; f < Math.min(spec.floors, 8); f += 2) {
    for (const bx of [-0.4, 0.4]) {
      elements.push(
        <mesh
          key={`planter-${f}-${bx}`}
          position={[bx * spec.width * 0.3, f * 3, z]}
          material={materials.green}
        >
          <boxGeometry args={[0.5, 0.4, 0.5]} />
        </mesh>,
      );
    }
  }
  return <group>{elements}</group>;
}

/** Emissive LED media panel on the street facade (2025). */
function LedMedia({
  spec,
  streetZ,
  materials,
}: {
  spec: BuildingSpec;
  streetZ: number;
  materials: EraMaterials;
}) {
  const out = streetZ >= 0 ? 0.08 : -0.08;
  const z = streetZ + out;
  return (
    <mesh
      position={[spec.width * 0.2, spec.height * 0.55, z]}
      material={materials.led}
    >
      <boxGeometry args={[spec.width * 0.5, spec.height * 0.35, 0.08]} />
    </mesh>
  );
}

/** Render one building: wall mass, roof, instanced windows, era features. */
export function Building({
  spec,
  config,
  materials,
}: {
  spec: BuildingSpec;
  config: EraBuildingConfig;
  materials: EraMaterials;
}) {
  const { width, depth, height } = spec;
  // Local z of the street-facing facade.
  const streetZ = spec.z >= 0 ? -depth / 2 : depth / 2;

  return (
    <group position={[spec.x, 0, spec.z]} rotation={[0, spec.rotationY, 0]}>
      {/* Main wall mass */}
      <mesh
        position={[0, height / 2, 0]}
        material={materials.wall}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width, height, depth]} />
      </mesh>

      {/* Roof */}
      {config.building.roof === 'pitched' ? (
        <PitchedRoof spec={spec} materials={materials} />
      ) : (
        <FlatRoof spec={spec} materials={materials} />
      )}

      {/* Instanced windows */}
      <WindowInstances config={config} spec={spec} materials={materials} />

      {/* Era features */}
      {config.features.fireEscapes && (
        <FireEscape spec={spec} streetZ={streetZ} materials={materials} />
      )}
      {config.features.storefrontGlazing && (
        <Storefront spec={spec} streetZ={streetZ} materials={materials} />
      )}
      {config.features.claddingPanels && (
        <CladdingPanels spec={spec} materials={materials} />
      )}
      {config.features.greenery && (
        <Greenery spec={spec} streetZ={streetZ} materials={materials} />
      )}
      {config.features.ledMedia && spec.id % 2 === 1 && (
        <LedMedia spec={spec} streetZ={streetZ} materials={materials} />
      )}
    </group>
  );
}
