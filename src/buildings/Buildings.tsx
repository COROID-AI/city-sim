import { useEffect, useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';
import type { EraId } from '../contracts';
import {
  getBuildingsConfig,
  generateBuildings,
  type PlacedBuilding,
  type BuildingsEraConfig,
  type MaterialPalette,
} from './buildingsConfig';

/** Shared THREE materials created once per era from the shared palette. */
interface EraMaterials {
  facade: THREE.MeshStandardMaterial;
  facadeAlt: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  storefront: THREE.MeshStandardMaterial;
  sign: THREE.MeshStandardMaterial;
  led: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
  mullion: THREE.MeshStandardMaterial;
}

/**
 * Build the shared PBR material set for an era. Every building in the block
 * reuses these exact material instances, keeping the whole composition on a
 * small, shared material family while still being era-distinct.
 */
function createEraMaterials(p: MaterialPalette): EraMaterials {
  return {
    facade: new THREE.MeshStandardMaterial({
      color: p.facade,
      roughness: p.facadeRoughness,
      metalness: p.facadeMetalness,
    }),
    facadeAlt: new THREE.MeshStandardMaterial({
      color: p.facadeAlt,
      roughness: 0.8,
      metalness: 0.15,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: p.trim,
      roughness: 0.6,
      metalness: 0.2,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: p.glass,
      roughness: p.glassRoughness,
      metalness: p.glassMetalness,
      emissive: p.glassEmissive ?? '#000000',
      emissiveIntensity: p.glassEmissiveIntensity,
    }),
    roof: new THREE.MeshStandardMaterial({
      color: p.roof,
      roughness: 0.9,
      metalness: 0.05,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: p.metal,
      roughness: 0.4,
      metalness: 0.8,
    }),
    storefront: new THREE.MeshStandardMaterial({
      color: p.storefront,
      roughness: 0.2,
      metalness: 0.4,
      emissive: p.storefrontEmissive ?? '#000000',
      emissiveIntensity: p.storefrontEmissiveIntensity,
    }),
    sign: new THREE.MeshStandardMaterial({
      color: p.signColor,
      roughness: 0.3,
      metalness: 0.2,
      emissive: p.signColor,
      emissiveIntensity: p.signEmissiveIntensity,
    }),
    led: new THREE.MeshStandardMaterial({
      color: p.ledColor,
      roughness: 0.3,
      emissive: p.ledColor,
      emissiveIntensity: p.ledIntensity,
    }),
    green: new THREE.MeshStandardMaterial({
      color: p.green,
      roughness: 0.95,
      metalness: 0,
    }),
    mullion: new THREE.MeshStandardMaterial({
      color: p.mullion,
      roughness: 0.5,
      metalness: 0.5,
    }),
  };
}

/** A single window cell placed on a street-facing facade. */
interface WindowCell {
  x: number;
  y: number;
  z: number;
}

/**
 * Compute the instanced window grid for a building's two street-facing
 * facades (front + back). Returns glass pane positions and, for 1945 sash
 * windows, the center mullion bar positions.
 */
function computeWindows(
  b: PlacedBuilding,
  cfg: BuildingsEraConfig,
): { glass: WindowCell[]; mullions: WindowCell[] } {
  const s = cfg.style;
  const padX = 0.35;
  const padBottom = 0.6;
  const padTop = 0.5;
  const cols = Math.max(
    1,
    Math.floor((b.width - padX * 2) / (s.windowWidth + s.windowGapX)),
  );
  const glass: WindowCell[] = [];
  const mullions: WindowCell[] = [];

  for (const sign of [1, -1] as const) {
    const faceX = sign * (b.depth / 2 + 0.07);
    for (let r = 0; r < b.floors; r++) {
      const y = padBottom + r * (s.windowHeight + s.windowGapY);
      if (y + s.windowHeight > b.height - padTop) break;
      for (let c = 0; c < cols; c++) {
        const z = -b.width / 2 + padX + s.windowWidth / 2 + c * (s.windowWidth + s.windowGapX);
        glass.push({ x: faceX, y, z });
        if (s.hasSashBar) {
          mullions.push({ x: faceX, y, z });
        }
      }
    }
  }

  return { glass, mullions };
}

/** Roof / crown geometry per era style. */
function Roof({
  b,
  cfg,
  mats,
}: {
  b: PlacedBuilding;
  cfg: BuildingsEraConfig;
  mats: EraMaterials;
}) {
  const s = cfg.style;

  if (s.roofStyle === 'pitched') {
    // Gable / ridge roof approximated by a box rotated 45° about the depth
    // axis, so the ridge runs along the building width.
    const span = b.depth + 0.9;
    const thick = 2.4;
    return (
      <group position={[0, b.height, 0]}>
        <mesh position={[0, thick / 2 - 0.2, 0]} rotation={[0, 0, Math.PI / 4]} castShadow material={mats.roof}>
          <boxGeometry args={[span, thick, b.width + 0.4]} />
        </mesh>
      </group>
    );
  }

  return (
    <group position={[0, b.height, 0]}>
      {/* Flat slab */}
      <mesh position={[0, 0.05, 0]} castShadow material={mats.roof}>
        <boxGeometry args={[b.depth + 0.1, 0.1, b.width + 0.1]} />
      </mesh>

      {/* Parapet lip (1965) */}
      {s.roofStyle === 'parapet' && (
        <mesh position={[0, 0.45, 0]} material={mats.trim}>
          <boxGeometry args={[b.depth + 0.3, 0.7, b.width + 0.3]} />
        </mesh>
      )}

      {/* Mechanical penthouse (1985) */}
      {s.roofStyle === 'mechanical' && (
        <mesh position={[0, 0.7, 0]} castShadow material={mats.metal}>
          <boxGeometry args={[b.depth * 0.35, 1.3, b.width * 0.4]} />
        </mesh>
      )}

      {/* Green terraced roof (2025) */}
      {s.roofStyle === 'green' && (
        <>
          <mesh position={[-b.depth * 0.2, 0.35, 0]} material={mats.green}>
            <boxGeometry args={[b.depth * 0.35, 0.55, b.width * 0.85]} />
          </mesh>
          <mesh position={[b.depth * 0.2, 0.35, 0]} material={mats.green}>
            <boxGeometry args={[b.depth * 0.3, 0.55, b.width * 0.85]} />
          </mesh>
        </>
      )}
    </group>
  );
}

/** 1945 external fire escape: dark metal ladder lattice on the street facade. */
function FireEscape({
  b,
  mats,
}: {
  b: PlacedBuilding;
  mats: EraMaterials;
}) {
  const frontSign = b.x > 0 ? -1 : 1;
  const fx = frontSign * (b.depth / 2 + 0.14);
  const rungs: WindowCell[] = [];
  for (let r = 0; r < b.floors; r++) {
    const y = 1.0 + r * 2.2;
    if (y > b.height - 0.5) break;
    rungs.push({ x: fx, y, z: 0 });
  }
  const rails: WindowCell[] = [-b.width * 0.2, b.width * 0.2].map((z) => ({
    x: fx,
    y: b.height * 0.5,
    z,
  }));

  return (
    <group>
      <Instances limit={rungs.length} range={rungs.length} material={mats.metal} castShadow>
        <boxGeometry args={[0.06, 0.08, b.width * 0.55]} />
        {rungs.map((r, i) => (
          <Instance key={i} position={[r.x, r.y, r.z]} />
        ))}
      </Instances>
      <Instances limit={rails.length} range={rails.length} material={mats.metal} castShadow>
        <boxGeometry args={[0.06, b.height * 0.9, 0.08]} />
        {rails.map((r, i) => (
          <Instance key={i} position={[r.x, r.y, r.z]} />
        ))}
      </Instances>
    </group>
  );
}

/** 2005+ ground-floor storefront glazing band. */
function Storefront({
  b,
  mats,
}: {
  b: PlacedBuilding;
  mats: EraMaterials;
}) {
  const frontSign = b.x > 0 ? -1 : 1;
  const fx = frontSign * (b.depth / 2 + 0.1);
  return (
    <group>
      <mesh position={[fx, 1.3, 0]} material={mats.storefront}>
        <boxGeometry args={[0.12, 2.2, b.width - 0.6]} />
      </mesh>
      <mesh position={[fx, 2.5, 0]} material={mats.metal}>
        <boxGeometry args={[0.14, 0.12, b.width - 0.4]} />
      </mesh>
    </group>
  );
}

/** 2005 vertical cladding panels placed in the gaps between window columns. */
function CladdingPanels({
  b,
  cfg,
  mats,
}: {
  b: PlacedBuilding;
  cfg: BuildingsEraConfig;
  mats: EraMaterials;
}) {
  const s = cfg.style;
  const frontSign = b.x > 0 ? -1 : 1;
  const fx = frontSign * (b.depth / 2 + 0.1);
  const cols = Math.max(
    1,
    Math.floor((b.width - 0.7) / (s.windowWidth + s.windowGapX)),
  );
  const panels: WindowCell[] = [];
  for (let c = 0; c < cols - 1; c++) {
    const z =
      -b.width / 2 + 0.35 + s.windowWidth + c * (s.windowWidth + s.windowGapX) + s.windowGapX / 2;
    panels.push({ x: fx, y: b.height * 0.55, z });
  }
  return (
    <Instances limit={panels.length} range={panels.length} material={mats.facadeAlt} castShadow>
      <boxGeometry args={[0.1, b.height * 0.8, s.windowGapX + 0.05]} />
      {panels.map((p, i) => (
        <Instance key={i} position={[p.x, p.y, p.z]} />
      ))}
    </Instances>
  );
}

/** 2025 horizontal LED media bands across the street facade. */
function LedFacade({
  b,
  mats,
}: {
  b: PlacedBuilding;
  mats: EraMaterials;
}) {
  const frontSign = b.x > 0 ? -1 : 1;
  const fx = frontSign * (b.depth / 2 + 0.12);
  const bands: WindowCell[] = [];
  for (let r = 0; r < b.floors; r++) {
    const y = 0.8 + r * 2.4;
    if (y > b.height - 0.4) break;
    bands.push({ x: fx, y, z: 0 });
  }
  return (
    <Instances limit={bands.length} range={bands.length} material={mats.led}>
      <boxGeometry args={[0.06, 0.08, b.width - 0.4]} />
      {bands.map((p, i) => (
        <Instance key={i} position={[p.x, p.y, p.z]} />
      ))}
    </Instances>
  );
}

/** 2025 green terrace balcony planters protruding from the facade. */
function GreenTerraces({
  b,
  mats,
}: {
  b: PlacedBuilding;
  mats: EraMaterials;
}) {
  const frontSign = b.x > 0 ? -1 : 1;
  const fx = frontSign * (b.depth / 2 + 0.35);
  const terraces: WindowCell[] = [];
  for (let r = 1; r < b.floors; r += 2) {
    const y = 0.8 + r * 2.4;
    if (y > b.height - 0.5) break;
    terraces.push({ x: fx, y, z: 0 });
  }
  return (
    <Instances limit={terraces.length} range={terraces.length} material={mats.green} castShadow>
      <boxGeometry args={[0.5, 0.18, b.width * 0.7]} />
      {terraces.map((p, i) => (
        <Instance key={i} position={[p.x, p.y, p.z]} />
      ))}
    </Instances>
  );
}

/** Era-appropriate building-mounted signage (neon / LED / painted). */
function BuildingSign({
  b,
  cfg,
  mats,
}: {
  b: PlacedBuilding;
  cfg: BuildingsEraConfig;
  mats: EraMaterials;
}) {
  const frontSign = b.x > 0 ? -1 : 1;
  const fx = frontSign * (b.depth / 2 + 0.1);
  const signY = cfg.style.hasStorefront ? 3.1 : 2.7;
  return (
    <mesh position={[fx, signY, 0]} material={mats.sign}>
      <boxGeometry args={[0.1, 0.5, Math.min(2.4, b.width - 0.8)]} />
    </mesh>
  );
}

/** A single procedurally authored building. */
function Building({
  b,
  cfg,
  mats,
}: {
  b: PlacedBuilding;
  cfg: BuildingsEraConfig;
  mats: EraMaterials;
}) {
  const s = cfg.style;
  const { glass, mullions } = useMemo(() => computeWindows(b, cfg), [b, cfg]);
  const bodyY = b.height / 2;

  return (
    <group position={[b.x, 0, b.z]}>
      {/* Body */}
      <mesh position={[0, bodyY, 0]} castShadow receiveShadow material={mats.facade}>
        <boxGeometry args={[b.depth, b.height, b.width]} />
      </mesh>

      {/* Instanced window glass */}
      <Instances limit={glass.length} range={glass.length} material={mats.glass} castShadow>
        <boxGeometry args={[0.14, s.windowHeight, s.windowWidth]} />
        {glass.map((g, i) => (
          <Instance key={i} position={[g.x, g.y, g.z]} />
        ))}
      </Instances>

      {/* Instanced sash mullion bars (1945) */}
      {mullions.length > 0 && (
        <Instances limit={mullions.length} range={mullions.length} material={mats.mullion}>
          <boxGeometry args={[0.18, s.windowHeight, 0.08]} />
          {mullions.map((m, i) => (
            <Instance key={i} position={[m.x, m.y, m.z]} />
          ))}
        </Instances>
      )}

      <Roof b={b} cfg={cfg} mats={mats} />
      <BuildingSign b={b} cfg={cfg} mats={mats} />
      {b.fireEscape && <FireEscape b={b} mats={mats} />}
      {b.storefront && <Storefront b={b} mats={mats} />}
      {b.cladding && <CladdingPanels b={b} cfg={cfg} mats={mats} />}
      {b.led && <LedFacade b={b} mats={mats} />}
      {b.greenTerraces && <GreenTerraces b={b} mats={mats} />}
    </group>
  );
}

/**
 * The buildings layer of the city block.
 *
 * Accepts the current era and renders the era-correct block composition:
 * procedural building geometry with era-appropriate form, height, materials,
 * and window patterns. Repeated windows / facade units are instanced and all
 * materials are shared per era for performance.
 *
 * This component is fully self-contained and can be dropped into any R3F
 * canvas. Integration into the main scene happens in Phase 4.
 */
export function Buildings({ era }: { era: EraId }) {
  const cfg = useMemo(() => getBuildingsConfig(era), [era]);
  const buildings = useMemo(() => generateBuildings(era), [era]);
  const mats = useMemo(() => createEraMaterials(cfg.palette), [cfg]);

  // Dispose the shared materials when the era changes.
  useEffect(() => {
    const current = mats;
    return () => {
      Object.values(current).forEach((m) => m.dispose());
    };
  }, [mats]);

  return (
    <group>
      {buildings.map((b, i) => (
        <Building key={i} b={b} cfg={cfg} mats={mats} />
      ))}
    </group>
  );
}
