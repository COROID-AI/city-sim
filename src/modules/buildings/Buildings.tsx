import { useMemo } from 'react';
import type { EraId } from '../../contracts';
import { getEraDescriptor } from '../../contracts';
import { BUILDINGS_BY_ERA } from './eraConfig';
import type { EraBuildingsConfig } from './eraConfig';
import {
  BuildingShell,
  BuildingSign,
  CladdingPanels,
  FireEscape,
  Greenery,
  LedFacade,
  Mullions,
  RoofCap,
  StorefrontGlazing,
  WindowGrid,
} from './parts';
import { makeGrid } from './grid';

/**
 * Era-variant buildings module.
 *
 * A self-contained R3F module keyed off the foundation era registry. It
 * authors a small city block of procedurally-generated buildings whose form,
 * height, materials, and window patterns are era-appropriate:
 *
 * - 1945  low-rise brick/stone walk-ups, sash windows, fire escapes
 * - 1965  mid-rise concrete/masonry, larger glass, flat roofs
 * - 1985  reflective glass-and-steel curtain walls
 * - 2005  mixed-use towers with cladding panels and storefront glazing
 * - 2025  contemporary towers with greenery, LED media facades, smart glazing
 *
 * Repeated facade units (windows, cladding bands, greenery, fire-escape
 * landings) are instanced and share one PBR material per era for performance.
 *
 * The module owns its lighting by default so it renders standalone; pass
 * `includeLighting={false}` when embedding it into a scene that already
 * provides lights.
 */

export interface BuildingsProps {
  /** The era to render. */
  era: EraId;
  /** Night-time lighting mode — boosts window/signage emissive. */
  isNight?: boolean;
  /** Include the module's own lights so it renders standalone. */
  includeLighting?: boolean;
  /** World position of the module origin. */
  position?: [number, number, number];
}

/** The fixed building lots that make up the block. */
const LOTS: Array<{ width: number; depth: number; x: number }> = [
  { width: 3.0, depth: 3.2, x: -4.5 },
  { width: 3.2, depth: 3.4, x: -1.4 },
  { width: 3.0, depth: 3.2, x: 1.6 },
  { width: 3.4, depth: 3.6, x: 4.6 },
];

interface BuildingProps {
  lot: { width: number; depth: number; x: number };
  height: number;
  config: EraBuildingsConfig;
  isNight: boolean;
}

/** One procedurally-authored building for the current era. */
function Building({ lot, height, config, isNight }: BuildingProps) {
  const { width, depth, x } = lot;
  const frontZ = depth / 2;
  const sideX = width / 2;
  const floors = Math.max(4, Math.round(height / 3.2));
  const winEmissive = isNight ? config.window.nightIntensity : config.window.dayIntensity;
  const signEmissive = isNight ? config.signage.nightIntensity : config.signage.dayIntensity;

  const windowMaterial = useMemo(
    () => ({
      color: config.window.color,
      emissive: config.window.emissive,
      emissiveIntensity: winEmissive,
      roughness: config.window.roughness,
      metalness: config.window.metalness,
    }),
    [config, winEmissive],
  );

  const frontWindows = useMemo(
    () =>
      makeGrid({
        length: width,
        height,
        windowW: config.windowSize[0],
        windowH: config.windowSize[1],
        spacingX: config.windowSpacing[0],
        spacingY: config.windowSpacing[1],
        baseY: config.windowBaseY,
        inset: config.windowInset,
      }).map(([h, v]) => [x + h, v, frontZ + 0.05] as [number, number, number]),
    [config, width, height, x, frontZ],
  );

  const sideWindows = useMemo(
    () =>
      makeGrid({
        length: depth,
        height,
        windowW: config.windowSize[0],
        windowH: config.windowSize[1],
        spacingX: config.windowSpacing[0],
        spacingY: config.windowSpacing[1],
        baseY: config.windowBaseY,
        inset: config.windowInset,
      }).map(([h, v]) => [sideX + 0.05, v, h] as [number, number, number]),
    [config, depth, height, sideX],
  );

  return (
    <group>
      {/* main wall */}
      <BuildingShell
        width={width}
        depth={depth}
        height={height}
        x={x}
        z={0}
        material={config.wall}
      />
      {/* roof treatment */}
      <RoofCap
        width={width}
        depth={depth}
        height={height}
        x={x}
        z={0}
        style={config.roof}
        color={config.wall.color}
      />
      {/* instanced windows on the front + right facade */}
      <WindowGrid positions={frontWindows} size={config.windowSize} material={windowMaterial} />
      <WindowGrid positions={sideWindows} size={config.windowSize} material={windowMaterial} />

      {/* era-specific facade features */}
      {config.features.fireEscapes && (
        <FireEscape width={width} height={height} floors={floors} x={x} z={frontZ} />
      )}
      {config.features.curtainWall && (
        <Mullions
          width={width}
          height={height}
          depth={depth}
          x={x}
          z={0}
          spacingX={config.windowSpacing[0]}
          spacingY={config.windowSpacing[1]}
        />
      )}
      {config.features.claddingPanels && (
        <CladdingPanels
          width={width}
          height={height}
          floors={floors}
          x={x}
          z={frontZ}
          color="#b6c2cc"
        />
      )}
      {config.features.storefrontGlazing && (
        <StorefrontGlazing width={width} height={height} x={x} z={frontZ} />
      )}
      {config.features.greenery && (
        <Greenery
          width={width}
          height={height}
          floors={floors}
          x={x}
          z={frontZ}
          color="#4c8a4c"
        />
      )}
      {config.features.ledFacade && (
        <LedFacade width={width} height={height} x={x} z={frontZ + 0.1} />
      )}

      {/* building-mounted signage */}
      <BuildingSign
        width={width}
        height={height}
        x={x}
        z={0}
        signage={{
          ...config.signage,
          emissiveIntensity: signEmissive,
        }}
      />
    </group>
  );
}

export function Buildings({
  era,
  isNight = false,
  includeLighting = true,
  position = [0, 0, 0],
}: BuildingsProps) {
  const desc = getEraDescriptor(era);
  const config = BUILDINGS_BY_ERA[era];

  return (
    <group position={position}>
      {includeLighting && (
        <>
          <ambientLight intensity={isNight ? 0.12 : desc.lighting.ambientIntensity} />
          <directionalLight
            position={[8, 14, 8]}
            intensity={isNight ? 0.3 : desc.lighting.sunIntensity}
            color={desc.lighting.sunColor}
            castShadow
          />
        </>
      )}

      {/* block ground plane */}
      <mesh receiveShadow position={[0, -0.05, 0]}>
        <boxGeometry args={[12, 0.1, 12]} />
        <meshStandardMaterial color={isNight ? '#26292f' : '#4a4f57'} roughness={0.95} />
      </mesh>

      {/* era block composition */}
      {LOTS.map((lot, i) => (
        <Building
          key={i}
          lot={lot}
          height={config.heights[i]}
          config={config}
          isNight={isNight}
        />
      ))}
    </group>
  );
}
