/**
 * Deterministic city-block layout.
 *
 * Describes a fixed grid of building plots arranged around a central
 * crossroads. The layout is intentionally deterministic (seeded PRNG) so that
 * every era renders the same street footprint — only the buildings, props and
 * inhabitants change with the selected year.
 */

/** A rectangular building plot anchored at its centre (x, z). */
export interface Plot {
  /** Stable id used as a React key and PRNG seed. */
 readonly id: string;
  /** Centre X in world units. */
 readonly x: number;
  /** Centre Z in world units. */
 readonly z: number;
  /** Plot width (X extent) in world units. */
 readonly width: number;
  /** Plot depth (Z extent) in world units. */
 readonly depth: number;
  /** Which block quadrant the plot sits in. */
 readonly quadrant: 'nw' | 'ne' | 'sw' | 'se';
}

/** A straight road segment running along one axis. */
export interface RoadSegment {
  readonly id: string;
  /** Centre X. */
 readonly x: number;
  /** Centre Z. */
 readonly z: number;
  /** Length along the travel axis. */
 readonly length: number;
  /** Breadth across the travel axis. */
 readonly width: number;
  /** Travel axis. */
 readonly axis: 'x' | 'z';
}

/** A sidewalk slab bordering a road. */
export interface SidewalkSegment {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
}

/** A spawn point for a pedestrian or vehicle. */
export interface SpawnPoint {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Heading in radians (0 = +X, PI/2 = +Z). */
 readonly heading: number;
  readonly kind: 'ped' | 'vehicle';
}

/** Full static description of the city block. */
export interface BlockLayout {
  readonly plots: readonly Plot[];
  readonly roads: readonly RoadSegment[];
  readonly sidewalks: readonly SidewalkSegment[];
  readonly spawnPoints: readonly SpawnPoint[];
  /** Half-extent of the block in world units. */
  readonly half: number;
}

/** Road width (both axes share the same breadth). */
const ROAD_WIDTH = 8;
/** Sidewalk breadth bordering each road edge. */
const SIDEWALK_WIDTH = 2;
/** Gap between plots inside a quadrant. */
const PLOT_GAP = 1.5;

/**
 * Build the canonical city-block layout. Pure function — safe to call once and
 * memoise.
 */
export function createBlockLayout(): BlockLayout {
  const half = 40; // block spans -40..+40 on both axes

  /* ----------------------------- Roads ----------------------------- */
  const roads: RoadSegment[] = [
    {
      id: 'road-x',
      x: 0,
      z: 0,
      length: half * 2,
      width: ROAD_WIDTH,
      axis: 'x',
    },
    {
      id: 'road-z',
      x: 0,
      z: 0,
      length: half * 2,
      width: ROAD_WIDTH,
      axis: 'z',
    },
  ];

  /* --------------------------- Sidewalks --------------------------- */
  const sidewalks: SidewalkSegment[] = [
    // Along the X-axis road (top & bottom edges of the road band)
    { id: 'sw-x-n', x: 0, z: -(ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2), width: half * 2, depth: SIDEWALK_WIDTH },
    { id: 'sw-x-s', x: 0, z: ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2, width: half * 2, depth: SIDEWALK_WIDTH },
    // Along the Z-axis road (left & right edges)
    { id: 'sw-z-w', x: -(ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2), z: 0, width: SIDEWALK_WIDTH, depth: half * 2 },
    { id: 'sw-z-e', x: ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2, z: 0, width: SIDEWALK_WIDTH, depth: half * 2 },
  ];

  /* ----------------------------- Plots ----------------------------- */
  const plots: Plot[] = [];
  const quadrants: Array<Plot['quadrant']> = ['nw', 'ne', 'sw', 'se'];
  const signs: Record<Plot['quadrant'], readonly [number, number]> = {
    nw: [-1, -1],
    ne: [1, -1],
    sw: [-1, 1],
    se: [1, 1],
  };

  // Each quadrant gets a 2x2 arrangement of plots.
  const innerStart = ROAD_WIDTH / 2 + SIDEWALK_WIDTH + 2;
  const plotSize = 14;
  const step = plotSize + PLOT_GAP;

  for (const quadrant of quadrants) {
    const [sx, sz] = signs[quadrant];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const cx = sx * (innerStart + step * col + plotSize / 2);
        const cz = sz * (innerStart + step * row + plotSize / 2);
        plots.push({
          id: `plot-${quadrant}-${row}-${col}`,
          x: cx,
          z: cz,
          width: plotSize,
          depth: plotSize,
          quadrant,
        });
      }
    }
  }

  /* -------------------------- Spawn points ------------------------- */
  const spawnPoints: SpawnPoint[] = [
    // Pedestrians on each sidewalk corner
    { id: 'ped-0', x: -half * 0.7, z: -(ROAD_WIDTH / 2 + SIDEWALK_WIDTH), heading: 0, kind: 'ped' },
    { id: 'ped-1', x: half * 0.3, z: ROAD_WIDTH / 2 + SIDEWALK_WIDTH, heading: Math.PI, kind: 'ped' },
    { id: 'ped-2', x: -(ROAD_WIDTH / 2 + SIDEWALK_WIDTH), z: half * 0.5, heading: Math.PI / 2, kind: 'ped' },
    { id: 'ped-3', x: ROAD_WIDTH / 2 + SIDEWALK_WIDTH, z: -half * 0.2, heading: -Math.PI / 2, kind: 'ped' },
    // Vehicles on the roads
    { id: 'veh-0', x: -half * 0.6, z: -ROAD_WIDTH / 4, heading: 0, kind: 'vehicle' },
    { id: 'veh-1', x: half * 0.5, z: ROAD_WIDTH / 4, heading: Math.PI, kind: 'vehicle' },
  ];

  return { plots, roads, sidewalks, spawnPoints, half };
}

/** Shared singleton layout — deterministic, so one instance is enough. */
export const BLOCK_LAYOUT: BlockLayout = createBlockLayout();
