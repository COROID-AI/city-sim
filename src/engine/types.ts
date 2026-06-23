/**
 * Core engine type definitions for the city simulation.
 *
 * These interfaces form the shared contract for ALL downstream systems
 * (Grid, Renderer, Camera, Economy, Citizens, Vehicles). Field names match
 * spec §5.3 exactly and must not be renamed without spec authority.
 */

/** A 2D vector / point in world or screen space. */
export interface Vector2 {
  x: number;
  y: number;
}

/**
 * Tile categories on the city grid.
 * - `grass`: empty buildable land
 * - `road`: transit tile
 * - `residential`: housing
 * - `commercial`: shops / offices
 * - `industrial`: factories
 * - `water`: impassable terrain
 */
export type TileType =
  | 'grass'
  | 'road'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'entertainment'
  | 'park'
  | 'water';

/**
 * Building categories. Mirrors the buildable structure set.
 */
export type BuildingType =
  | 'house'
  | 'apartment'
  | 'shop'
  | 'office'
  | 'factory'
  | 'cinema'
  | 'park'
  | 'road';

/** A single cell on the simulation grid. */
export interface Tile {
  /** Grid coordinate (column). */
 x: number;
  /** Grid coordinate (row). */
  y: number;
  /** Category of this tile. */
  type: TileType;
  /** Unique id of the building occupying this tile, or null if empty. */
  buildingId: string | null;
  /** Whether the tile can currently be built upon. */
  buildable: boolean;
}

/** Static definition of a buildable structure. */
export interface BuildingDef {
  /** Unique identifier (e.g. "house", "shop"). */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Building category. */
  type: BuildingType;
  /** Footprint in grid cells (width x height). */
  width: number;
  height: number;
  /** Construction cost in currency units. */
  cost: number;
  /** Monthly upkeep cost in currency units. */
  upkeep: number;
  /** Maximum number of occupants / workers. */
  capacity: number;
  /** Render color (hex) used by the Renderer. */
  color: string;
}

/**
 * Movement / activity state of a citizen (spec §6.3).
 *
 * The six canonical activities that drive the need-based AI:
 *  - `sleeping`:       at home restoring energy (night)
 *  - `commuting`:      travelling between home and work
 *  - `working`:        at the workplace earning income
 *  - `eating`:         at a restaurant/home restoring hunger
 *  - `entertaining`:   at a cinema/park restoring fun
 *  - `wandering`:      idle leisure movement (no fixed destination)
 */
export type CitizenState =
  | 'sleeping'
  | 'commuting'
  | 'working'
  | 'eating'
  | 'entertaining'
  | 'wandering';

/**
 * A single hour-block in a citizen's daily schedule (spec §7.2).
 *
 * Each entry maps one hour of the day to an activity, with a per-citizen
 * jitter offset (in minutes, range [-30, +30]) so that not every citizen
 * starts their commute at exactly 08:00.
 */
export interface ScheduleEntry {
  /** Hour of the day [0..23] this entry applies to. */
  hour: number;
  /** Activity performed during this hour. */
  activity: CitizenState;
  /** Per-citizen jitter in minutes, clamped to [-30, +30]. */
  jitterMinutes: number;
}

/**
 * How a citizen is currently travelling to their target.
 *  - `foot`:  walking (default)
 *  - `vehicle`: driving (set by MovementSystem when distance > 20 tiles)
 *
 * NOTE: `vehicle` is a stub flag only. Phase 5 (TrafficSystem) reads this and
 * spawns the actual Vehicle entity; no Vehicle is created here.
 */
export type CommuteMode = 'foot' | 'vehicle';

/**
 * Citizen-vehicle commute handoff state machine (spec §7.2).
 *  - `none`:      not commuting by vehicle.
 *  - `toRoad`:    walking towards the nearest road tile to board a vehicle.
 *  - `inVehicle`: inside a spawned vehicle (citizen invisible).
 *  - `arrived`:   vehicle reached destination; citizen reappears (transient).
 */
export type CommuteState = 'none' | 'toRoad' | 'inVehicle' | 'arrived';

/** Movement / activity state of a vehicle. */
export type VehicleState =
  | 'driving'
  | 'stopped'
  | 'parked'
  | 'departing';

/**
 * In-simulation clock. Time advances in fixed 50ms steps (20 Hz) but is
 * expressed in human-friendly city time units (day, hour, minute).
 */
export interface CityTime {
  /** Day since the city was founded (0-indexed). */
  day: number;
  /** Hour of the day [0..23]. */
  hour: number;
  /** Minute of the hour [0..59]. */
  minute: number;
  /** Total elapsed simulation milliseconds. */
  totalMs: number;
}

/** Aggregated economic snapshot of the city. */
export interface CityEconomy {
  /** Current treasury balance in currency units. */
  money: number;
  /** Net income per simulated minute (can be negative). */
  incomePerMinute: number;
  /** Total population. */
  population: number;
  /** Number of employed citizens. */
  jobs: number;
  /** Overall happiness / approval rating [0..100]. */
  happiness: number;
}

/** Zoning district categories. */
export type ZoneType =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'entertainment'
  | 'park';

/** A rectangular zoning district on the grid. */
export interface Zone {
  /** District category. */
  type: ZoneType;
  /** Top-left column. */
  x: number;
  /** Top-left row. */
  y: number;
  /** Width in tiles. */
  width: number;
  /** Height in tiles. */
  height: number;
}

/** A runtime building instance placed on the grid. */
export interface Building {
  /** Unique instance id. */
  id: string;
  /** Building category. */
  type: BuildingType;
  /** Owning zone type. */
  zone: ZoneType;
  /** Top-left column of the footprint. */
  x: number;
  /** Top-left row of the footprint. */
  y: number;
  /** Footprint width in tiles. */
  width: number;
  /** Footprint height in tiles. */
  height: number;
  /** Static definition backing this instance. */
  def: BuildingDef;
}

/**
 * A node in the sparse road graph (spec §5.6).
 *
 * Nodes are placed ONLY at intersections and building-entrance tiles so the
 * graph stays sparse (~200 nodes on an 80x80 grid) instead of one node per
 * road tile (~6400). Mid-segment road tiles are traversed during edge
 * construction but are not stored as nodes.
 */
export interface RoadNode {
  /** Stable node id (e.g. "x,y"). */
 id: string;
  /** Grid column. */
 x: number;
  /** Grid row. */
 y: number;
  /** Why this node was created. */
 kind: 'intersection' | 'entrance';
}

/**
 * A weighted, undirected edge between two road nodes.
 *
 * The weight is the Manhattan distance between the two endpoints, which for
 * axis-aligned road segments equals the number of tiles spanned.
 */
export interface RoadEdge {
  /** Id of the source node. */
 from: string;
  /** Id of the destination node. */
 to: string;
  /** Edge weight (Manhattan distance between endpoints). */
 weight: number;
}

/**
 * Sparse road network graph extracted from the tile grid.
 *
 * Produced by {@link extractRoadGraph} (src/entities/Road.ts) and consumed by
 * the A* {@link Pathfinder} (src/engine/Pathfinder.ts).
 */
export interface RoadGraph {
  /** All graph nodes keyed by id. */
 nodes: Map<string, RoadNode>;
  /** Adjacency list: nodeId -> outbound edges. */
 edges: Map<string, RoadEdge[]>;
}

/**
 * Traffic light phase applied to a road node during pathfinding.
 *  - `green`:  normal traversal cost.
 *  - `yellow`: high traversal cost (YELLOW_LIGHT_COST_MULTIPLIER applied).
 *  - `red`:    impassable — the node is skipped entirely.
 */
export type TrafficLightState = 'green' | 'yellow' | 'red';

/**
 * Injectable provider of traffic-light state for road nodes.
 *
 * The Pathfinder depends on this interface (not on a concrete TrafficSystem)
 * so it works standalone now and integrates cleanly when TrafficSystem
 * (Phase 5) is implemented. A node with no light should return `null`.
 */
export interface TrafficLightProvider {
  /** Return the current light state at the given node, or null if none. */
 getLight(nodeId: string): TrafficLightState | null;
}

/**
 * A discrete simulation event emitted by systems (e.g. building placed,
 * citizen spawned, economy threshold crossed).
 */
export interface CityEvent {
  /** Unique event type identifier. */
  type: string;
  /** Simulation time at which the event occurred. */
  time: CityTime;
  /** Arbitrary typed payload. */
  data: Record<string, unknown>;
}
