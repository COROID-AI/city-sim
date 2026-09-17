/**
 * The deterministic city world.
 *
 * `CityWorld` generates the whole playable map from a single seed: the
 * 160x120 tile grid (5120x3840 world units at 32 units per tile), the road
 * graph later vehicles and pedestrians route over, nine named districts, and
 * every building citizens live in, work at or visit.
 *
 * The module is pure simulation. It imports nothing but `./types` and `./rng`,
 * so it stays importable from plain Node and from headless tooling (the
 * DOM-free guard test in `tests/sim/world.test.ts` enforces that). It also
 * never spawns population: citizens, companies and vehicles are owned by the
 * systems that create them. What the world provides is *places* and *routes*:
 *
 * - `buildingsOfKind`, `buildingsWithinRadius`, `nearestBuildingOfKind`,
 *   `nearestRoadNode` and `leisureVenues` answer the spatial questions that
 *   schedules, the detail inspector and the renderer ask;
 * - `routeBetweenBuildings`, `routeBetweenPoints` and `routeBetweenNodes`
 *   answer the routing questions that traffic asks, returning distances in
 *   domain tile units (`distancePx` is the same distance in world pixels).
 *
 * Everything is derived from `src/sim/rng.ts`, so two worlds built from the
 * same seed serialise byte-identically (see {@link CityWorld.serialize}).
 *
 * `CityWorld` structurally implements {@link WorldMap}, so it can be handed to
 * any system that expects the shared domain contract.
 */

import { createRng } from './rng';
import type { Rng } from './rng';
import { BUILDING_KINDS, tileIndex } from './types';
import type {
  Building,
  BuildingKind,
  Citizen,
  Company,
  EntityId,
  Household,
  RoadNode,
  RoadSegment,
  TerrainKind,
  Tile,
  TileRect,
  Vec2,
  Vehicle,
  WorldMap,
} from './types';

/* ------------------------------------------------------------ dimensions -- */

/** Width of the generated city in tiles. */
export const WORLD_WIDTH_IN_TILES = 160;
/** Height of the generated city in tiles. */
export const WORLD_HEIGHT_IN_TILES = 120;
/** Logical world units (pixels at zoom 1) per tile. */
export const WORLD_TILE_SIZE = 32;
/** Total world width in pixels. */
export const WORLD_WIDTH_PX = WORLD_WIDTH_IN_TILES * WORLD_TILE_SIZE;
/** Total world height in pixels. */
export const WORLD_HEIGHT_PX = WORLD_HEIGHT_IN_TILES * WORLD_TILE_SIZE;
/** Seed used when the caller does not provide one. */
export const DEFAULT_WORLD_SEED = 20_260_917;

/** Tile offset of the first north/south avenue. */
const AVENUE_FIRST_X = 8;
/** Tile distance between two north/south avenues. */
const AVENUE_SPACING = 16;
/** Tile offset of the first east/west street. */
const STREET_FIRST_Y = 8;
/** Tile distance between two east/west streets. */
const STREET_SPACING = 15;

const STREET_SPEED_LIMIT = 0.45;
const AVENUE_SPEED_LIMIT = 0.6;
const NODE_SPEED_LIMIT = 0.5;

function spacedCoordinates(first: number, spacing: number, limit: number): number[] {
  const coordinates: number[] = [];
  for (let coordinate = first; coordinate < limit; coordinate += spacing) {
    coordinates.push(coordinate);
  }
  return coordinates;
}

/** Avenue centre columns for the default world size. */
export const AVENUE_XS: readonly number[] = spacedCoordinates(
  AVENUE_FIRST_X,
  AVENUE_SPACING,
  WORLD_WIDTH_IN_TILES,
);
/** Street centre rows for the default world size. */
export const STREET_YS: readonly number[] = spacedCoordinates(
  STREET_FIRST_Y,
  STREET_SPACING,
  WORLD_HEIGHT_IN_TILES,
);

/* --------------------------------------------------------------- districts -- */

/** Character of a district; it shapes which buildings generation places. */
export type DistrictKind =
  | 'residential'
  | 'commercial'
  | 'office'
  | 'industrial'
  | 'civic'
  | 'leisure';

/** Every district kind. */
export const DISTRICT_KINDS: readonly DistrictKind[] = [
  'residential',
  'commercial',
  'office',
  'industrial',
  'civic',
  'leisure',
];

/** A named quarter of the city with its own building mix and street name. */
export interface District {
  id: EntityId;
  name: string;
  kind: DistrictKind;
  /** Street every address inside the district is numbered on. */
  streetName: string;
  /** Area the district covers, in tile coordinates. */
  bounds: TileRect;
  /** Centre of {@link District.bounds}, in tile coordinates. */
  center: Vec2;
  color: string;
  /** Buildings placed inside the district, in generation order. */
  buildingIds: EntityId[];
  /** Road nodes whose centre falls inside the district. */
  roadNodeIds: EntityId[];
}

interface DistrictSeed {
  name: string;
  streetName: string;
  kind: DistrictKind;
  color: string;
}

const DISTRICT_COLUMNS = 3;
const DISTRICT_ROWS = 3;

/**
 * District boundaries are fractions of the map so custom-sized worlds still get
 * a full 3x3 coverage. For the default 160x120 world they resolve to
 * x = 0 / 54 / 108 / 160 and y = 0 / 40 / 80 / 120.
 */
const DISTRICT_COLUMN_FRACTIONS: readonly number[] = [0, 0.3375, 0.675, 1];
const DISTRICT_ROW_FRACTIONS: readonly number[] = [0, 1 / 3, 2 / 3, 1];

/** Nine quarters, laid out row by row (north to south). */
const DISTRICT_SEEDS: readonly DistrictSeed[] = [
  { name: 'Alder Heights', streetName: 'Alder Way', kind: 'residential', color: '#8fb7d8' },
  { name: 'Birchwood', streetName: 'Birch Row', kind: 'residential', color: '#7fa9c9' },
  { name: 'Northgate Park', streetName: 'Northgate Avenue', kind: 'office', color: '#a9b6d6' },
  { name: 'Market Row', streetName: 'Market Street', kind: 'commercial', color: '#d8a25f' },
  { name: 'Central Exchange', streetName: 'Exchange Boulevard', kind: 'office', color: '#9aa7c8' },
  { name: 'Civic Quarter', streetName: 'Civic Promenade', kind: 'civic', color: '#c8b6e2' },
  { name: 'Riverside Green', streetName: 'Greenway', kind: 'leisure', color: '#7dbb6a' },
  { name: 'South Market', streetName: 'South Market Lane', kind: 'commercial', color: '#d0a24d' },
  { name: 'Foundry Flats', streetName: 'Foundry Road', kind: 'industrial', color: '#b08968' },
];

function districtBoundaries(fractions: readonly number[], size: number): number[] {
  return fractions.map((fraction, index) =>
    index === fractions.length - 1 ? size : Math.round(fraction * size),
  );
}

/**
 * Row-major district index (row * 3 + column) covering a tile coordinate.
 * Values outside the map clamp to the nearest edge district.
 */
export function districtIndexForTile(x: number, y: number, width: number, height: number): number {
  const columnBoundaries = districtBoundaries(DISTRICT_COLUMN_FRACTIONS, width);
  const rowBoundaries = districtBoundaries(DISTRICT_ROW_FRACTIONS, height);
  const column = Math.min(columnAt(columnBoundaries, x), DISTRICT_COLUMNS - 1);
  const row = Math.min(rowAt(rowBoundaries, y), DISTRICT_ROWS - 1);
  return row * DISTRICT_COLUMNS + column;
}

function columnAt(boundaries: readonly number[], x: number): number {
  let column = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    if (x >= boundaries[index]) {
      column = index;
    }
  }
  return column;
}

function rowAt(boundaries: readonly number[], y: number): number {
  let row = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    if (y >= boundaries[index]) {
      row = index;
    }
  }
  return row;
}

function createDistricts(width: number, height: number): District[] {
  const columnBoundaries = districtBoundaries(DISTRICT_COLUMN_FRACTIONS, width);
  const rowBoundaries = districtBoundaries(DISTRICT_ROW_FRACTIONS, height);
  const districts: District[] = [];
  for (let row = 0; row < DISTRICT_ROWS; row += 1) {
    for (let column = 0; column < DISTRICT_COLUMNS; column += 1) {
      const index = row * DISTRICT_COLUMNS + column;
      const seed = DISTRICT_SEEDS[index];
      const bounds: TileRect = {
        x: columnBoundaries[column],
        y: rowBoundaries[row],
        width: columnBoundaries[column + 1] - columnBoundaries[column],
        height: rowBoundaries[row + 1] - rowBoundaries[row],
      };
      districts.push({
        id: `district-${index}-${slugify(seed.name)}`,
        name: seed.name,
        kind: seed.kind,
        streetName: seed.streetName,
        bounds,
        center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        color: seed.color,
        buildingIds: [],
        roadNodeIds: [],
      });
    }
  }
  return districts;
}

/* ------------------------------------------------------ building catalogue -- */

/** Kinds whose capacity houses residents. */
export const RESIDENTIAL_BUILDING_KINDS: readonly BuildingKind[] = ['house', 'apartment'];

/** The world's own building record: the shared contract plus world metadata. */
export interface WorldBuilding extends Building {
  /** Human readable street address, e.g. `"14 Alder Way"`. */
  address: string;
  /** Job slots the building offers; 0 for housing and parks. */
  jobSlots: number;
  /** Whether the venue serves citizens during their entertainment hours. */
  leisure: boolean;
  /** Civic / institutional landmark, highlighted by renderers and inspectors. */
  landmark: boolean;
  /** District the building belongs to. */
  districtId: EntityId;
}

interface BuildingKindSpec {
  kind: BuildingKind;
  /** Allowed footprint widths, in tiles (a plot may shrink the choice). */
  widths: readonly number[];
  /** Allowed footprint heights, in tiles. */
  heights: readonly number[];
  /** Allowed floor counts. */
  floors: readonly number[];
  capacityPerFloorTile: number;
  jobsPerFloorTile: number;
  leisure: boolean;
  landmark: boolean;
  colors: readonly string[];
  /** Name pool; entries repeat with a numeric suffix once exhausted. */
  names: readonly string[];
}

const BUILDING_KIND_SPECS: Record<BuildingKind, BuildingKindSpec> = {
  house: {
    kind: 'house',
    widths: [2, 3],
    heights: [2],
    floors: [1, 2],
    capacityPerFloorTile: 1,
    jobsPerFloorTile: 0,
    leisure: false,
    landmark: false,
    colors: ['#8fb7d8', '#9ec3a8', '#d8b48a', '#c9a0a0'],
    names: [
      'Rosewood Cottage',
      'Fern Hollow',
      'Maple Rest',
      'Alder Nook',
      'Willow Perch',
      'Cedar Corner',
      'Lark Rise',
      'Hazel Den',
    ],
  },
  apartment: {
    kind: 'apartment',
    widths: [3, 4],
    heights: [2, 3],
    floors: [4, 5, 6],
    capacityPerFloorTile: 1,
    jobsPerFloorTile: 0,
    leisure: false,
    landmark: false,
    colors: ['#a9b6d6', '#b8a9d6', '#8fb7d8', '#93b8c9'],
    names: [
      'Stonegate Apartments',
      'Harbour View Lofts',
      'Union Court',
      'Beacon Residences',
      'Parkline Flats',
      'Quarry House',
    ],
  },
  office: {
    kind: 'office',
    widths: [3, 4, 5],
    heights: [3, 4],
    floors: [3, 4, 5, 6],
    capacityPerFloorTile: 1.5,
    jobsPerFloorTile: 1.2,
    leisure: false,
    landmark: false,
    colors: ['#9aa7c8', '#7f8fae', '#aab6c4', '#8f9dbd'],
    names: [
      'Northgate Tower',
      'Ledger House',
      'Meridian Offices',
      'Kestrel Plaza',
      'Bramble Business Centre',
      'Aurora Chambers',
    ],
  },
  shop: {
    kind: 'shop',
    widths: [2, 3, 4],
    heights: [2, 3],
    floors: [1, 2],
    capacityPerFloorTile: 2,
    jobsPerFloorTile: 0.8,
    leisure: true,
    landmark: false,
    colors: ['#d8a25f', '#e0b26a', '#c98f5a', '#dbb98a'],
    names: [
      'Bramble Bakery',
      'Copper Kettle',
      'Nook Books',
      'Green Grocer',
      'Corner Pharmacy',
      'Thread & Needle',
      'Night Owl Cafe',
      'Lantern Deli',
    ],
  },
  factory: {
    kind: 'factory',
    widths: [4, 5],
    heights: [3, 4],
    floors: [1, 2],
    capacityPerFloorTile: 1.2,
    jobsPerFloorTile: 0.9,
    leisure: false,
    landmark: false,
    colors: ['#b08968', '#a0734f', '#c09a76', '#8f7a63'],
    names: ['Ironworks Plant', 'Fairfield Assembly', 'Bright Foundry', 'Kettle Works'],
  },
  warehouse: {
    kind: 'warehouse',
    widths: [4, 5],
    heights: [3, 4],
    floors: [1, 2],
    capacityPerFloorTile: 0.8,
    jobsPerFloorTile: 0.5,
    leisure: false,
    landmark: false,
    colors: ['#8f7a63', '#a08a70', '#7d6d5c', '#b09a80'],
    names: ['Dock 7 Warehouse', 'North Depot', 'Redline Storage', 'Quayside Depot'],
  },
  school: {
    kind: 'school',
    widths: [4, 5],
    heights: [3, 4],
    floors: [2, 3],
    capacityPerFloorTile: 2,
    jobsPerFloorTile: 0.3,
    leisure: false,
    landmark: true,
    colors: ['#c8b6e2', '#b6c8e2', '#d6c0b0'],
    names: ['Union School', 'Birchwood Academy', 'Riverside Primary'],
  },
  hospital: {
    kind: 'hospital',
    widths: [4, 5],
    heights: [3, 4],
    floors: [3, 4],
    capacityPerFloorTile: 2,
    jobsPerFloorTile: 0.5,
    leisure: false,
    landmark: true,
    colors: ['#dfe3ee', '#cdd6e6', '#e6dfe3'],
    names: ['Central Hospital', 'Riverside Clinic', 'Northgate Medical Centre'],
  },
  park: {
    kind: 'park',
    widths: [4, 5],
    heights: [3, 4],
    floors: [1],
    capacityPerFloorTile: 1,
    jobsPerFloorTile: 0,
    leisure: true,
    landmark: false,
    colors: ['#7dbb6a', '#8cc778', '#6fae5f'],
    names: [
      'Riverside Green',
      'Willow Park',
      'Alder Common',
      'Central Plaza',
      'Foundry Gardens',
      'Linden Square',
    ],
  },
  civic: {
    kind: 'civic',
    widths: [3, 4, 5],
    heights: [3, 4],
    floors: [2, 3, 4],
    capacityPerFloorTile: 2,
    jobsPerFloorTile: 0.3,
    leisure: true,
    landmark: true,
    colors: ['#c8b6e2', '#ddc7a8', '#b9c7dd', '#e0d2b8'],
    names: [
      'City Hall',
      'Grand Museum',
      'Star Cinema',
      'Public Library',
      'Union Station',
      'Assembly Rooms',
    ],
  },
};

interface DistrictMixEntry {
  kind: BuildingKind;
  weight: number;
}

/** Building mix per district character. */
const DISTRICT_MIX: Record<DistrictKind, readonly DistrictMixEntry[]> = {
  residential: [
    { kind: 'house', weight: 5 },
    { kind: 'apartment', weight: 3 },
    { kind: 'shop', weight: 1 },
  ],
  commercial: [
    { kind: 'shop', weight: 6 },
    { kind: 'office', weight: 2 },
    { kind: 'apartment', weight: 2 },
    { kind: 'civic', weight: 1 },
  ],
  office: [
    { kind: 'office', weight: 6 },
    { kind: 'shop', weight: 2 },
    { kind: 'apartment', weight: 1 },
    { kind: 'hospital', weight: 0.5 },
  ],
  industrial: [
    { kind: 'factory', weight: 4 },
    { kind: 'warehouse', weight: 4 },
    { kind: 'office', weight: 1 },
  ],
  civic: [
    { kind: 'civic', weight: 4 },
    { kind: 'school', weight: 2 },
    { kind: 'hospital', weight: 1 },
    { kind: 'shop', weight: 1 },
  ],
  leisure: [
    { kind: 'park', weight: 5 },
    { kind: 'shop', weight: 2 },
    { kind: 'civic', weight: 1 },
  ],
};

/** Buildings placed on the first block of each district, for landmarks. */
interface DistrictAnchor {
  kind: BuildingKind;
  name: string;
}

const DISTRICT_ANCHORS: Record<DistrictKind, readonly DistrictAnchor[]> = {
  residential: [{ kind: 'school', name: 'Birchwood Academy' }],
  commercial: [{ kind: 'shop', name: 'Market Hall' }],
  office: [{ kind: 'office', name: 'Central Exchange Tower' }],
  industrial: [{ kind: 'warehouse', name: 'Dock 7 Warehouse' }],
  civic: [
    { kind: 'civic', name: 'City Hall' },
    { kind: 'civic', name: 'Grand Museum' },
    { kind: 'hospital', name: 'Central Hospital' },
  ],
  leisure: [],
};

const DISTRICT_FILL: Record<DistrictKind, { min: number; max: number }> = {
  residential: { min: 1, max: 3 },
  commercial: { min: 2, max: 3 },
  office: { min: 2, max: 3 },
  industrial: { min: 1, max: 2 },
  civic: { min: 1, max: 2 },
  leisure: { min: 1, max: 2 },
};

/* ------------------------------------------------------------- generation -- */

interface AdjacencyEntry {
  nodeIndex: number;
  segmentIndex: number;
}

interface Block {
  column: number;
  row: number;
  /** Interior of the block: every tile strictly between its four roads. */
  interior: TileRect;
}

interface RoadNetwork {
  nodes: RoadNode[];
  segments: RoadSegment[];
  adjacency: AdjacencyEntry[][];
  nodeIndexById: Map<EntityId, number>;
  segmentIndexById: Map<EntityId, number>;
  avenueXs: number[];
  streetYs: number[];
}

interface GenerationState {
  rng: Rng;
  widthInTiles: number;
  tiles: Tile[];
  nodes: RoadNode[];
  buildings: WorldBuilding[];
  districts: District[];
  nameCounters: Map<BuildingKind, number>;
  buildingCounters: Map<BuildingKind, number>;
  addressCounters: Map<EntityId, number>;
}

interface GeneratedCity {
  seed: number;
  tiles: Tile[];
  nodes: RoadNode[];
  segments: RoadSegment[];
  buildings: WorldBuilding[];
  districts: District[];
  adjacency: AdjacencyEntry[][];
  nodeIndexById: Map<EntityId, number>;
  segmentIndexById: Map<EntityId, number>;
  buildingIndexById: Map<EntityId, WorldBuilding>;
  buildingsByKind: Map<BuildingKind, WorldBuilding[]>;
  avenueXs: readonly number[];
  streetYs: readonly number[];
  spawnNodeId: EntityId;
  roadNetworkConnected: boolean;
  buildingsAccessible: boolean;
}

/** Deterministic snapshot of the world's static geometry. */
export interface WorldSnapshot {
  seed: number;
  widthInTiles: number;
  heightInTiles: number;
  tileSize: number;
  districts: District[];
  nodes: RoadNode[];
  segments: RoadSegment[];
  buildings: WorldBuilding[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function compareIds(left: EntityId, right: EntityId): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function createTileGrid(widthInTiles: number, heightInTiles: number): Tile[] {
  const tiles: Tile[] = new Array<Tile>(widthInTiles * heightInTiles);
  for (let y = 0; y < heightInTiles; y += 1) {
    for (let x = 0; x < widthInTiles; x += 1) {
      tiles[tileIndex(widthInTiles, x, y)] = {
        x,
        y,
        terrain: 'grass',
        buildingId: null,
        segmentId: null,
      };
    }
  }
  return tiles;
}

function stampRoadTile(
  tiles: Tile[],
  width: number,
  x: number,
  y: number,
  segmentId: EntityId,
): void {
  const tile = tiles[tileIndex(width, x, y)];
  tile.terrain = 'road';
  tile.segmentId = segmentId;
}

function createRoadNetwork(width: number, height: number, tiles: Tile[]): RoadNetwork {
  const avenueXs = spacedCoordinates(AVENUE_FIRST_X, AVENUE_SPACING, width);
  const streetYs = spacedCoordinates(STREET_FIRST_Y, STREET_SPACING, height);
  const nodes: RoadNode[] = [];
  const segments: RoadSegment[] = [];
  const adjacency: AdjacencyEntry[][] = [];
  const neighborIndices: number[][] = [];
  const nodeIndexById = new Map<EntityId, number>();
  const segmentIndexById = new Map<EntityId, number>();

  const addNode = (x: number, y: number): void => {
    const index = nodes.length;
    const id = `node-${x}-${y}`;
    nodes.push({
      id,
      kind: 'junction',
      x,
      y,
      neighborIds: [],
      speedLimit: NODE_SPEED_LIMIT,
      hasTrafficLight: false,
    });
    adjacency.push([]);
    neighborIndices.push([]);
    nodeIndexById.set(id, index);
  };

  const addSegment = (
    fromIndex: number,
    toIndex: number,
    id: EntityId,
    lanes: number,
    speedLimit: number,
  ): void => {
    const from = nodes[fromIndex];
    const to = nodes[toIndex];
    const segmentIndex = segments.length;
    segments.push({
      id,
      fromNodeId: from.id,
      toNodeId: to.id,
      length: Math.hypot(to.x - from.x, to.y - from.y),
      lanes,
      speedLimit,
    });
    segmentIndexById.set(id, segmentIndex);
    neighborIndices[fromIndex].push(toIndex);
    neighborIndices[toIndex].push(fromIndex);
    adjacency[fromIndex].push({ nodeIndex: toIndex, segmentIndex });
    adjacency[toIndex].push({ nodeIndex: fromIndex, segmentIndex });
  };

  for (let row = 0; row < streetYs.length; row += 1) {
    for (let column = 0; column < avenueXs.length; column += 1) {
      addNode(avenueXs[column], streetYs[row]);
    }
  }
  const nodeIndexAt = (column: number, row: number): number => row * avenueXs.length + column;

  // Streets first, avenues second: intersection tiles are then owned by the
  // avenue segment running north/south through them.
  for (let row = 0; row < streetYs.length; row += 1) {
    for (let column = 0; column < avenueXs.length - 1; column += 1) {
      const id = `segment-h-${row}-${column}`;
      addSegment(nodeIndexAt(column, row), nodeIndexAt(column + 1, row), id, 2, STREET_SPEED_LIMIT);
      for (let x = avenueXs[column]; x <= avenueXs[column + 1]; x += 1) {
        stampRoadTile(tiles, width, x, streetYs[row], id);
      }
    }
  }
  for (let column = 0; column < avenueXs.length; column += 1) {
    for (let row = 0; row < streetYs.length - 1; row += 1) {
      const id = `segment-v-${column}-${row}`;
      const lanes = column % 3 === 1 ? 4 : 2;
      addSegment(
        nodeIndexAt(column, row),
        nodeIndexAt(column, row + 1),
        id,
        lanes,
        lanes === 4 ? AVENUE_SPEED_LIMIT : STREET_SPEED_LIMIT,
      );
      for (let y = streetYs[row]; y <= streetYs[row + 1]; y += 1) {
        stampRoadTile(tiles, width, avenueXs[column], y, id);
      }
    }
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const neighbors = neighborIndices[index].slice().sort((left, right) => left - right);
    node.neighborIds = neighbors.map((neighbor) => nodes[neighbor].id);
    node.kind = neighbors.length >= 4 ? 'intersection' : neighbors.length >= 2 ? 'junction' : 'dead-end';
    node.hasTrafficLight = neighbors.length >= 3;
    adjacency[index].sort(
      (left, right) => left.nodeIndex - right.nodeIndex || left.segmentIndex - right.segmentIndex,
    );
    let slowest = Number.POSITIVE_INFINITY;
    for (const entry of adjacency[index]) {
      slowest = Math.min(slowest, segments[entry.segmentIndex].speedLimit);
    }
    node.speedLimit = Number.isFinite(slowest) ? slowest : NODE_SPEED_LIMIT;
  }

  return {
    nodes,
    segments,
    adjacency,
    nodeIndexById,
    segmentIndexById,
    avenueXs,
    streetYs,
  };
}

/** Blocks are every cell of grass enclosed by four roads. */
function createBlocks(avenueXs: readonly number[], streetYs: readonly number[]): Block[] {
  const blocks: Block[] = [];
  for (let row = 0; row < streetYs.length - 1; row += 1) {
    for (let column = 0; column < avenueXs.length - 1; column += 1) {
      blocks.push({
        column,
        row,
        interior: {
          x: avenueXs[column] + 1,
          y: streetYs[row] + 1,
          width: avenueXs[column + 1] - avenueXs[column] - 1,
          height: streetYs[row + 1] - streetYs[row] - 1,
        },
      });
    }
  }
  return blocks;
}

/** Splits a block interior into up to four building plots with shared gaps. */
function splitIntoPlots(interior: TileRect): TileRect[] {
  const columns = interior.width >= 12 ? 2 : 1;
  const rows = interior.height >= 10 ? 2 : 1;
  const plotWidth = Math.floor(interior.width / columns);
  const plotHeight = Math.floor(interior.height / rows);
  const plots: TileRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      plots.push({
        x: interior.x + column * plotWidth + 1,
        y: interior.y + row * plotHeight + 1,
        width: Math.max(2, plotWidth - 2),
        height: Math.max(2, plotHeight - 2),
      });
    }
  }
  return plots;
}

function pickDimension(rng: Rng, sizes: readonly number[], maxSize: number): number {
  const fitting = sizes.filter((size) => size <= maxSize);
  return fitting.length > 0 ? rng.pick(fitting) : maxSize;
}

function terrainForBuildingKind(kind: BuildingKind): TerrainKind {
  if (kind === 'park') {
    return 'park';
  }
  if (kind === 'civic' || kind === 'school' || kind === 'hospital') {
    return 'plaza';
  }
  return 'grass';
}

function nextBuildingName(state: GenerationState, kind: BuildingKind): string {
  const spec = BUILDING_KIND_SPECS[kind];
  const index = state.nameCounters.get(kind) ?? 0;
  state.nameCounters.set(kind, index + 1);
  const name = spec.names[index % spec.names.length];
  const round = Math.floor(index / spec.names.length);
  return round === 0 ? name : `${name} ${round + 1}`;
}

function stampBuildingTiles(
  state: GenerationState,
  footprint: TileRect,
  buildingId: EntityId,
  terrain: TerrainKind,
): void {
  for (let y = footprint.y; y < footprint.y + footprint.height; y += 1) {
    for (let x = footprint.x; x < footprint.x + footprint.width; x += 1) {
      const tile = state.tiles[tileIndex(state.widthInTiles, x, y)];
      if (tile.buildingId !== null || tile.terrain === 'road') {
        throw new Error(`City generation tried to place ${buildingId} on an occupied tile at ${x},${y}`);
      }
      tile.buildingId = buildingId;
      tile.terrain = terrain;
    }
  }
}

function nearestNodeIndexOf(nodes: readonly RoadNode[], point: Vec2): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const distance = Math.hypot(node.x - point.x, node.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

interface PlaceBuildingOptions {
  name?: string;
  landmark?: boolean;
  leisure?: boolean;
}

function placeBuilding(
  state: GenerationState,
  spec: BuildingKindSpec,
  footprint: TileRect,
  options: PlaceBuildingOptions,
): WorldBuilding {
  const kind = spec.kind;
  const ordinal = (state.buildingCounters.get(kind) ?? 0) + 1;
  state.buildingCounters.set(kind, ordinal);
  const id = `building-${kind}-${ordinal}`;
  const floors = state.rng.pick(spec.floors);
  const area = footprint.width * footprint.height;
  const center: Vec2 = {
    x: footprint.x + footprint.width / 2,
    y: footprint.y + footprint.height / 2,
  };
  // Blocks can straddle a district boundary, so a building belongs to the
  // district that actually contains its centre — not to the block's district,
  // whose character still shapes what gets planned there.
  const district =
    state.districts[
      districtIndexForTile(
        center.x,
        center.y,
        state.widthInTiles,
        state.tiles.length / state.widthInTiles,
      )
    ];
  const addressNumber = 2 + 4 * (state.addressCounters.get(district.id) ?? 0);
  state.addressCounters.set(district.id, (state.addressCounters.get(district.id) ?? 0) + 1);

  const building: WorldBuilding = {
    id,
    kind,
    name: options.name ?? nextBuildingName(state, kind),
    footprint: { ...footprint },
    floors,
    capacity: Math.max(1, Math.round(area * floors * spec.capacityPerFloorTile)),
    occupantIds: [],
    residentHouseholdIds: [],
    companyId: null,
    entranceNodeId: state.nodes[nearestNodeIndexOf(state.nodes, center)].id,
    color: state.rng.pick(spec.colors),
    address: `${addressNumber} ${district.streetName}`,
    jobSlots: Math.max(0, Math.round(area * floors * spec.jobsPerFloorTile)),
    leisure: options.leisure ?? spec.leisure,
    landmark: options.landmark ?? spec.landmark,
    districtId: district.id,
  };

  state.buildings.push(building);
  district.buildingIds.push(id);
  stampBuildingTiles(state, building.footprint, id, terrainForBuildingKind(kind));
  return building;
}

function placeBuildingInPlot(
  state: GenerationState,
  spec: BuildingKindSpec,
  plot: TileRect,
  options: PlaceBuildingOptions,
): void {
  const width = pickDimension(state.rng, spec.widths, plot.width);
  const height = pickDimension(state.rng, spec.heights, plot.height);
  placeBuilding(
    state,
    spec,
    {
      x: plot.x + state.rng.int(0, Math.max(1, plot.width - width + 1)),
      y: plot.y + state.rng.int(0, Math.max(1, plot.height - height + 1)),
      width,
      height,
    },
    options,
  );
}

/** Leisure districts devote every other block to one large park. */
function placeParkBlock(state: GenerationState, block: Block): void {
  const width = Math.max(4, Math.min(block.interior.width - 2, 11));
  const height = Math.max(4, Math.min(block.interior.height - 2, 9));
  placeBuilding(
    state,
    BUILDING_KIND_SPECS.park,
    {
      x: block.interior.x + Math.floor((block.interior.width - width) / 2),
      y: block.interior.y + Math.floor((block.interior.height - height) / 2),
      width,
      height,
    },
    {},
  );
}

function fillBlock(
  state: GenerationState,
  block: Block,
  district: District,
  indexInDistrict: number,
): void {
  if (district.kind === 'leisure' && indexInDistrict % 2 === 0) {
    placeParkBlock(state, block);
    return;
  }

  const plots = splitIntoPlots(block.interior);
  const order = state.rng.shuffle(plots.map((_plot, index) => index));
  let cursor = 0;

  if (indexInDistrict === 0) {
    for (const anchor of DISTRICT_ANCHORS[district.kind]) {
      if (cursor >= order.length) {
        break;
      }
      placeBuildingInPlot(state, BUILDING_KIND_SPECS[anchor.kind], plots[order[cursor]], {
        name: anchor.name,
        landmark: true,
      });
      cursor += 1;
    }
  }

  const mix = DISTRICT_MIX[district.kind];
  const mixKinds = mix.map((entry) => entry.kind);
  const mixWeights = mix.map((entry) => entry.weight);
  const fill = DISTRICT_FILL[district.kind];
  const count = state.rng.int(fill.min, fill.max + 1);
  for (let placed = 0; placed < count && cursor < order.length; placed += 1) {
    const kind = state.rng.pickWeighted(mixKinds, mixWeights);
    placeBuildingInPlot(state, BUILDING_KIND_SPECS[kind], plots[order[cursor]], {});
    cursor += 1;
  }
}

function createBuildings(state: GenerationState, blocks: readonly Block[]): void {
  const districtIndexById = new Map<EntityId, number>();
  for (let index = 0; index < state.districts.length; index += 1) {
    districtIndexById.set(state.districts[index].id, index);
  }
  const blocksSeenInDistrict = new Map<EntityId, number>();
  for (const block of blocks) {
    const center: Vec2 = {
      x: block.interior.x + block.interior.width / 2,
      y: block.interior.y + block.interior.height / 2,
    };
    const districtIndex = districtIndexForTile(
      center.x,
      center.y,
      state.widthInTiles,
      state.tiles.length / state.widthInTiles,
    );
    const district = state.districts[districtIndex];
    const seen = blocksSeenInDistrict.get(district.id) ?? 0;
    blocksSeenInDistrict.set(district.id, seen + 1);
    fillBlock(state, block, district, seen);
  }
}

function reachableNodeCount(adjacency: readonly AdjacencyEntry[][], start: number): number {
  const visited = new Array<boolean>(adjacency.length).fill(false);
  const queue: number[] = [start];
  visited[start] = true;
  let reached = 1;
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const entry of adjacency[current]) {
      if (!visited[entry.nodeIndex]) {
        visited[entry.nodeIndex] = true;
        reached += 1;
        queue.push(entry.nodeIndex);
      }
    }
  }
  return reached;
}

function generateCity(
  seed: number | string,
  widthInTiles: number,
  heightInTiles: number,
): GeneratedCity {
  const rng = createRng(seed);
  const normalizedSeed = rng.seed;
  const tiles = createTileGrid(widthInTiles, heightInTiles);
  const roads = createRoadNetwork(widthInTiles, heightInTiles, tiles);
  const districts = createDistricts(widthInTiles, heightInTiles);

  const state: GenerationState = {
    rng,
    widthInTiles,
    tiles,
    nodes: roads.nodes,
    buildings: [],
    districts,
    nameCounters: new Map<BuildingKind, number>(),
    buildingCounters: new Map<BuildingKind, number>(),
    addressCounters: new Map<EntityId, number>(),
  };
  createBuildings(state, createBlocks(roads.avenueXs, roads.streetYs));

  const buildingIndexById = new Map<EntityId, WorldBuilding>();
  const buildingsByKind = new Map<BuildingKind, WorldBuilding[]>();
  for (const kind of BUILDING_KINDS) {
    buildingsByKind.set(kind, []);
  }
  for (const building of state.buildings) {
    buildingIndexById.set(building.id, building);
    buildingsByKind.get(building.kind)?.push(building);
  }

  for (const node of roads.nodes) {
    const district = districts[
      districtIndexForTile(node.x, node.y, widthInTiles, heightInTiles)
    ];
    district.roadNodeIds.push(node.id);
  }
  for (const district of districts) {
    district.buildingIds.sort(compareIds);
    district.roadNodeIds.sort(compareIds);
  }

  const spawnNode = roads.nodes[nearestNodeIndexOf(roads.nodes, {
    x: widthInTiles / 2,
    y: heightInTiles / 2,
  })];

  const roadNetworkConnected =
    roads.nodes.length > 0 && reachableNodeCount(roads.adjacency, 0) === roads.nodes.length;
  const buildingsAccessible =
    roadNetworkConnected &&
    state.buildings.every(
      (building) => building.entranceNodeId !== null && roads.nodeIndexById.has(building.entranceNodeId),
    );

  return {
    seed: normalizedSeed,
    tiles,
    nodes: roads.nodes,
    segments: roads.segments,
    buildings: state.buildings,
    districts,
    adjacency: roads.adjacency,
    nodeIndexById: roads.nodeIndexById,
    segmentIndexById: roads.segmentIndexById,
    buildingIndexById,
    buildingsByKind,
    avenueXs: roads.avenueXs,
    streetYs: roads.streetYs,
    spawnNodeId: spawnNode.id,
    roadNetworkConnected,
    buildingsAccessible,
  };
}

/* ------------------------------------------------------------------ routes -- */

/** One node of a resolved route, with the distance travelled to reach it. */
export interface RouteStep {
  nodeId: EntityId;
  /** Segment travelled to reach this node; `null` for the origin. */
  segmentId: EntityId | null;
  /** Distance from the origin when standing on this node, in tiles. */
  distanceTiles: number;
}

/** A resolved route across the road graph. */
export interface RoutePath {
  fromNodeId: EntityId;
  toNodeId: EntityId;
  /** Road nodes from origin to destination, inclusive. */
  nodeIds: EntityId[];
  /** Segments between those nodes; `nodeIds.length - 1` entries. */
  segmentIds: EntityId[];
  steps: RouteStep[];
  /** Total driven distance, in domain tile units. */
  distanceTiles: number;
  /** Same distance expressed in world pixels (tiles * tileSize). */
  distancePx: number;
  /** Time the trip takes at each segment's speed limit, in sim-minutes. */
  travelMinutes: number;
  /** `distanceTiles / travelMinutes`, in tiles per sim-minute. */
  averageSpeedLimit: number;
}

/* ---------------------------------------------------------------- options -- */

/** Construction options for {@link CityWorld}. */
export interface CityWorldOptions {
  /** Numeric or string seed; the same seed always builds the same city. */
  seed?: number | string;
  /** Grid width in tiles. Defaults to {@link WORLD_WIDTH_IN_TILES}. */
  widthInTiles?: number;
  /** Grid height in tiles. Defaults to {@link WORLD_HEIGHT_IN_TILES}. */
  heightInTiles?: number;
  /** World units per tile. Defaults to {@link WORLD_TILE_SIZE}. */
  tileSize?: number;
}

/** Aggregate figures over the generated geometry. */
export interface WorldStats {
  districtCount: number;
  buildingCount: number;
  nodeCount: number;
  segmentCount: number;
  residentialBuildingCount: number;
  /** Sum of `capacity` over house and apartment buildings. */
  residentialCapacity: number;
  /** Non-residential buildings offering at least one job slot. */
  jobBuildingCount: number;
  /** Sum of `jobSlots` over every building. */
  jobSlotCount: number;
  leisureVenueCount: number;
  landmarkCount: number;
  roadNetworkConnected: boolean;
}

/** Filter accepted by {@link CityWorld.nearestBuilding}. */
export interface NearestBuildingFilter {
  kind?: BuildingKind;
  leisureOnly?: boolean;
  landmarkOnly?: boolean;
}

const MIN_WORLD_WIDTH_IN_TILES = 40;
const MIN_WORLD_HEIGHT_IN_TILES = 32;

function assertPositiveInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, received ${value}`);
  }
}

/**
 * The city: a deterministic tile grid, road graph, districts and buildings.
 *
 * Build one with {@link createCityWorld} or `new CityWorld({ seed })`. The
 * constructor does all generation work; {@link CityWorld.update} only advances
 * the world clock, because the geometry itself is immutable once generated.
 */
export class CityWorld implements WorldMap {
  /** Stable id derived from the seed. */
  readonly id: EntityId;
  readonly widthInTiles: number;
  readonly heightInTiles: number;
  readonly tileSize: number;
  /** Normalised numeric seed the city was generated from. */
  readonly seed: number;
  /** Row-major tiles; length is `widthInTiles * heightInTiles`. */
  readonly tiles: Tile[];
  readonly nodes: RoadNode[];
  readonly segments: RoadSegment[];
  readonly buildings: WorldBuilding[];
  /** Population is spawned by later systems, so these collections start empty. */
  readonly households: Household[] = [];
  readonly citizens: Citizen[] = [];
  readonly companies: Company[] = [];
  readonly vehicles: Vehicle[] = [];
  /** Road node where new vehicles enter the network (the city centre). */
  readonly spawnNodeId: EntityId;
  /** The nine named quarters, in row-major order. */
  readonly districts: District[];
  /** Avenue centre columns of this world. */
  readonly avenueXs: readonly number[];
  /** Street centre rows of this world. */
  readonly streetYs: readonly number[];

  private readonly adjacency: AdjacencyEntry[][];
  private readonly nodeIndexById: Map<EntityId, number>;
  private readonly segmentIndexById: Map<EntityId, number>;
  private readonly buildingIndexById: Map<EntityId, WorldBuilding>;
  private readonly buildingsByKind: Map<BuildingKind, WorldBuilding[]>;
  private readonly roadNetworkConnected: boolean;
  private readonly buildingsAccessible: boolean;
  private elapsed = 0;

  constructor(options: CityWorldOptions = {}) {
    const widthInTiles = options.widthInTiles ?? WORLD_WIDTH_IN_TILES;
    const heightInTiles = options.heightInTiles ?? WORLD_HEIGHT_IN_TILES;
    const tileSize = options.tileSize ?? WORLD_TILE_SIZE;
    assertPositiveInteger(widthInTiles, 'CityWorld widthInTiles', MIN_WORLD_WIDTH_IN_TILES);
    assertPositiveInteger(heightInTiles, 'CityWorld heightInTiles', MIN_WORLD_HEIGHT_IN_TILES);
    assertPositiveInteger(tileSize, 'CityWorld tileSize', 1);

    const generated = generateCity(options.seed ?? DEFAULT_WORLD_SEED, widthInTiles, heightInTiles);

    this.seed = generated.seed;
    this.id = `city-world-${generated.seed}`;
    this.widthInTiles = widthInTiles;
    this.heightInTiles = heightInTiles;
    this.tileSize = tileSize;
    this.tiles = generated.tiles;
    this.nodes = generated.nodes;
    this.segments = generated.segments;
    this.buildings = generated.buildings;
    this.spawnNodeId = generated.spawnNodeId;
    this.districts = generated.districts;
    this.avenueXs = generated.avenueXs;
    this.streetYs = generated.streetYs;
    this.adjacency = generated.adjacency;
    this.nodeIndexById = generated.nodeIndexById;
    this.segmentIndexById = generated.segmentIndexById;
    this.buildingIndexById = generated.buildingIndexById;
    this.buildingsByKind = generated.buildingsByKind;
    this.roadNetworkConnected = generated.roadNetworkConnected;
    this.buildingsAccessible = generated.buildingsAccessible;
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /** Sim-minutes the world clock has advanced since construction. */
  get elapsedMinutes(): number {
    return this.elapsed;
  }

  /**
   * Advances the world clock and returns the current {@link WorldStats}.
   *
   * The generated geometry is immutable, so this is a cheap idempotent hook:
   * systems that drive the world each tick can call it without paying for
   * regeneration, and the returned stats are always derived from the live
   * arrays.
   */
  update(deltaMinutes = 1): WorldStats {
    if (!Number.isFinite(deltaMinutes) || deltaMinutes < 0) {
      throw new RangeError(
        `CityWorld.update(deltaMinutes) expects a finite non-negative value, received ${deltaMinutes}`,
      );
    }
    this.elapsed += deltaMinutes;
    return this.stats();
  }

  /* --------------------------------------------------------------- stats -- */

  /** Aggregate counts over the generated city. */
  stats(): WorldStats {
    let residentialCapacity = 0;
    let residentialBuildingCount = 0;
    let jobBuildingCount = 0;
    let jobSlotCount = 0;
    let leisureVenueCount = 0;
    let landmarkCount = 0;
    for (const building of this.buildings) {
      jobSlotCount += building.jobSlots;
      if (isResidential(building.kind)) {
        residentialBuildingCount += 1;
        residentialCapacity += building.capacity;
      } else if (building.jobSlots > 0) {
        jobBuildingCount += 1;
      }
      if (building.leisure) {
        leisureVenueCount += 1;
      }
      if (building.landmark) {
        landmarkCount += 1;
      }
    }
    return {
      districtCount: this.districts.length,
      buildingCount: this.buildings.length,
      nodeCount: this.nodes.length,
      segmentCount: this.segments.length,
      residentialBuildingCount,
      residentialCapacity,
      jobBuildingCount,
      jobSlotCount,
      leisureVenueCount,
      landmarkCount,
      roadNetworkConnected: this.roadNetworkConnected,
    };
  }

  /** Whether every road node is reachable from every other one. */
  isRoadNetworkConnected(): boolean {
    return this.roadNetworkConnected;
  }

  /** Whether every building has an entrance node inside the connected graph. */
  areAllBuildingsAccessible(): boolean {
    return this.buildingsAccessible;
  }

  /* ------------------------------------------------------------- lookups -- */

  buildingById(buildingId: EntityId): WorldBuilding | null {
    return this.buildingIndexById.get(buildingId) ?? null;
  }

  roadNodeById(nodeId: EntityId): RoadNode | null {
    const index = this.nodeIndexById.get(nodeId);
    return index === undefined ? null : this.nodes[index];
  }

  roadSegmentById(segmentId: EntityId): RoadSegment | null {
    const index = this.segmentIndexById.get(segmentId);
    return index === undefined ? null : this.segments[index];
  }

  /** Every building of a kind, ordered by id. */
  buildingsOfKind(kind: BuildingKind): readonly WorldBuilding[] {
    return (this.buildingsByKind.get(kind) ?? []).slice().sort((left, right) => compareIds(left.id, right.id));
  }

  /** Every leisure-capable venue, ordered by id. */
  leisureVenues(): readonly WorldBuilding[] {
    return this.buildings
      .filter((building) => building.leisure)
      .slice()
      .sort((left, right) => compareIds(left.id, right.id));
  }

  /** Every landmark building, ordered by id. */
  landmarks(): readonly WorldBuilding[] {
    return this.buildings
      .filter((building) => building.landmark)
      .slice()
      .sort((left, right) => compareIds(left.id, right.id));
  }

  /** Buildings whose centre lies within `radiusTiles`, nearest first. */
  buildingsWithinRadius(point: Vec2, radiusTiles: number): readonly WorldBuilding[] {
    if (!Number.isFinite(radiusTiles) || radiusTiles < 0) {
      throw new RangeError(
        `buildingsWithinRadius(point, radiusTiles) expects a finite non-negative radius, received ${radiusTiles}`,
      );
    }
    const matches: { building: WorldBuilding; distance: number }[] = [];
    for (const building of this.buildings) {
      const distance = distanceBetweenPoints(buildingCenter(building), point);
      if (distance <= radiusTiles) {
        matches.push({ building, distance });
      }
    }
    matches.sort(
      (left, right) => left.distance - right.distance || compareIds(left.building.id, right.building.id),
    );
    return matches.map((match) => match.building);
  }

  /** Nearest building matching the filter, or `null` when none matches. */
  nearestBuilding(point: Vec2, filter: NearestBuildingFilter = {}): WorldBuilding | null {
    let best: WorldBuilding | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const building of this.buildings) {
      if (filter.kind !== undefined && building.kind !== filter.kind) {
        continue;
      }
      if (filter.leisureOnly === true && !building.leisure) {
        continue;
      }
      if (filter.landmarkOnly === true && !building.landmark) {
        continue;
      }
      const distance = distanceBetweenPoints(buildingCenter(building), point);
      if (
        distance < bestDistance ||
        (distance === bestDistance && best !== null && compareIds(building.id, best.id) < 0)
      ) {
        best = building;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Nearest building of a kind, or `null` when the city has none. */
  nearestBuildingOfKind(point: Vec2, kind: BuildingKind): WorldBuilding | null {
    return this.nearestBuilding(point, { kind });
  }

  /** Road node closest to any world coordinate. */
  nearestRoadNode(point: Vec2): RoadNode {
    const index = nearestNodeIndexOf(this.nodes, point);
    return this.nodes[index];
  }

  /** District covering a world coordinate (edge values clamp to the border). */
  districtAt(point: Vec2): District {
    return this.districts[
      districtIndexForTile(point.x, point.y, this.widthInTiles, this.heightInTiles)
    ];
  }

  /** Buildings of a district, ordered by id. */
  buildingsInDistrict(districtId: EntityId): readonly WorldBuilding[] {
    const district = this.districts.find((entry) => entry.id === districtId);
    if (!district) {
      return [];
    }
    const buildings: WorldBuilding[] = [];
    for (const buildingId of district.buildingIds) {
      const building = this.buildingById(buildingId);
      if (building) {
        buildings.push(building);
      }
    }
    return buildings;
  }

  /** Centre of a building's footprint, or `null` for an unknown id. */
  accessPointForBuilding(buildingId: EntityId): Vec2 | null {
    const building = this.buildingById(buildingId);
    return building ? buildingCenter(building) : null;
  }

  /** Road node a building's occupants enter the network at. */
  accessNodeForBuilding(buildingId: EntityId): RoadNode | null {
    const building = this.buildingById(buildingId);
    if (!building || building.entranceNodeId === null) {
      return null;
    }
    return this.roadNodeById(building.entranceNodeId);
  }

  /* -------------------------------------------------------------- routing -- */

  /**
   * Shortest route between two road nodes, or `null` when either id is unknown
   * or no path exists. Distances are tiles; ties break towards the lower node
   * index, so the result is stable for a given world.
   */
  routeBetweenNodes(fromNodeId: EntityId, toNodeId: EntityId): RoutePath | null {
    const fromIndex = this.nodeIndexById.get(fromNodeId);
    const toIndex = this.nodeIndexById.get(toNodeId);
    if (fromIndex === undefined || toIndex === undefined) {
      return null;
    }
    return this.routeBetweenNodeIndices(fromIndex, toIndex);
  }

  /** Shortest route between two buildings' entrance nodes. */
  routeBetweenBuildings(fromBuildingId: EntityId, toBuildingId: EntityId): RoutePath | null {
    const from = this.buildingById(fromBuildingId);
    const to = this.buildingById(toBuildingId);
    if (!from?.entranceNodeId || !to?.entranceNodeId) {
      return null;
    }
    return this.routeBetweenNodes(from.entranceNodeId, to.entranceNodeId);
  }

  /**
   * Shortest route between two arbitrary world coordinates. The coordinates are
   * snapped onto the road network first, which is what pedestrians and vehicles
   * do when they leave a building.
   */
  routeBetweenPoints(from: Vec2, to: Vec2): RoutePath | null {
    return this.routeBetweenNodes(this.nearestRoadNode(from).id, this.nearestRoadNode(to).id);
  }

  /* --------------------------------------------------------- world units -- */

  /** Converts a tile coordinate to world pixels. */
  tileToPixel(point: Vec2): Vec2 {
    return { x: point.x * this.tileSize, y: point.y * this.tileSize };
  }

  /** Converts a world pixel coordinate back to tiles. */
  pixelToTile(point: Vec2): Vec2 {
    return { x: point.x / this.tileSize, y: point.y / this.tileSize };
  }

  /* -------------------------------------------------------- serialisation -- */

  /** Deep copy of the static geometry: districts, roads and buildings. */
  snapshot(): WorldSnapshot {
    return {
      seed: this.seed,
      widthInTiles: this.widthInTiles,
      heightInTiles: this.heightInTiles,
      tileSize: this.tileSize,
      districts: this.districts.map(cloneDistrict),
      nodes: this.nodes.map(cloneNode),
      segments: this.segments.map(cloneSegment),
      buildings: this.buildings.map(cloneBuilding),
    };
  }

  /** Canonical JSON for the geometry; byte-stable for a given seed. */
  serialize(): string {
    return JSON.stringify(this.snapshot());
  }

  /** Lets `JSON.stringify(world)` emit the same payload as {@link serialize}. */
  toJSON(): WorldSnapshot {
    return this.snapshot();
  }

  /* ------------------------------------------------------------ internals -- */

  private routeBetweenNodeIndices(fromIndex: number, toIndex: number): RoutePath | null {
    const nodeCount = this.nodes.length;
    const bestDistance = new Array<number>(nodeCount).fill(Number.POSITIVE_INFINITY);
    const previousNode = new Array<number>(nodeCount).fill(-1);
    const previousSegment = new Array<number>(nodeCount).fill(-1);
    const settled = new Array<boolean>(nodeCount).fill(false);
    bestDistance[fromIndex] = 0;

    for (let step = 0; step < nodeCount; step += 1) {
      let current = -1;
      let currentDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < nodeCount; index += 1) {
        if (!settled[index] && bestDistance[index] < currentDistance) {
          current = index;
          currentDistance = bestDistance[index];
        }
      }
      if (current === -1) {
        break;
      }
      settled[current] = true;
      if (current === toIndex) {
        break;
      }
      for (const entry of this.adjacency[current]) {
        const segment = this.segments[entry.segmentIndex];
        const candidate = currentDistance + segment.length;
        if (candidate < bestDistance[entry.nodeIndex]) {
          bestDistance[entry.nodeIndex] = candidate;
          previousNode[entry.nodeIndex] = current;
          previousSegment[entry.nodeIndex] = entry.segmentIndex;
        }
      }
    }

    if (!settled[toIndex]) {
      return null;
    }

    const nodeIndices: number[] = [];
    const segmentIndices: number[] = [];
    let cursor = toIndex;
    while (cursor !== -1) {
      nodeIndices.push(cursor);
      if (previousSegment[cursor] >= 0) {
        segmentIndices.push(previousSegment[cursor]);
      }
      cursor = previousNode[cursor];
    }
    nodeIndices.reverse();
    segmentIndices.reverse();

    const steps: RouteStep[] = [];
    let distanceTiles = 0;
    let travelMinutes = 0;
    for (let index = 0; index < nodeIndices.length; index += 1) {
      const segmentIndex = index === 0 ? -1 : segmentIndices[index - 1];
      if (segmentIndex >= 0) {
        const segment = this.segments[segmentIndex];
        distanceTiles += segment.length;
        if (segment.speedLimit > 0) {
          travelMinutes += segment.length / segment.speedLimit;
        }
      }
      steps.push({
        nodeId: this.nodes[nodeIndices[index]].id,
        segmentId: segmentIndex >= 0 ? this.segments[segmentIndex].id : null,
        distanceTiles,
      });
    }

    return {
      fromNodeId: this.nodes[fromIndex].id,
      toNodeId: this.nodes[toIndex].id,
      nodeIds: nodeIndices.map((index) => this.nodes[index].id),
      segmentIds: segmentIndices.map((index) => this.segments[index].id),
      steps,
      distanceTiles,
      distancePx: distanceTiles * this.tileSize,
      travelMinutes,
      averageSpeedLimit: travelMinutes > 0 ? distanceTiles / travelMinutes : 0,
    };
  }
}

/* ----------------------------------------------------------------- helpers -- */

function isResidential(kind: BuildingKind): boolean {
  return kind === 'house' || kind === 'apartment';
}

/** Centre of a building footprint in tile units. */
export function buildingCenter(building: Building): Vec2 {
  return {
    x: building.footprint.x + building.footprint.width / 2,
    y: building.footprint.y + building.footprint.height / 2,
  };
}

/** Euclidean distance between two points, in tile units. */
export function distanceBetweenPoints(left: Vec2, right: Vec2): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function cloneNode(node: RoadNode): RoadNode {
  return { ...node, neighborIds: [...node.neighborIds] };
}

function cloneSegment(segment: RoadSegment): RoadSegment {
  return { ...segment };
}

function cloneBuilding(building: WorldBuilding): WorldBuilding {
  return {
    ...building,
    footprint: { ...building.footprint },
    occupantIds: [...building.occupantIds],
    residentHouseholdIds: [...building.residentHouseholdIds],
  };
}

function cloneDistrict(district: District): District {
  return {
    ...district,
    bounds: { ...district.bounds },
    center: { ...district.center },
    buildingIds: [...district.buildingIds],
    roadNodeIds: [...district.roadNodeIds],
  };
}

/**
 * Builds the city for a seed (or a full options object).
 *
 * `createCityWorld(7)`, `createCityWorld('demo-org')` and
 * `createCityWorld({ seed: 7, widthInTiles: 80 })` are all valid.
 */
export function createCityWorld(options: CityWorldOptions | number | string = {}): CityWorld {
  if (typeof options === 'number' || typeof options === 'string') {
    return new CityWorld({ seed: options });
  }
  return new CityWorld(options);
}
