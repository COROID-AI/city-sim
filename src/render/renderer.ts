/**
 * The city renderer: one canvas 2D frame pipeline for the live city.
 *
 * {@link CityRenderer} turns the current simulation state into exactly one
 * ordered pass over an injected 2D drawing context. It owns no state the rest
 * of the app needs to know about and never touches a browser global: the
 * context is handed in (a real `CanvasRenderingContext2D` in the browser, the
 * recording fake in tests), the world is read through the domain contracts, and
 * the camera supplies both the transform and the culling rectangle.
 *
 * ## Layer order
 *
 * One frame draws the layers of {@link RENDER_LAYERS} in this order, each only
 * when it has something to draw:
 *
 * 1. `sky` — vertical gradient from {@link LightingSample.sky}, cleared across
 *    the whole surface;
 * 2. `terrain` — the tile grid, run-length batched per terrain kind;
 * 3. `districts` — translucent quarter washes with their names;
 * 4. `roads` — the road network as casing + surface strokes per lane class;
 * 5. `lane-markings` — dashed centre lines on multi-lane segments;
 * 6. `crossings` — zebra stripes at signalised nodes;
 * 7. `shadows` — building silhouettes and agent pucks, offset by the lighting
 *    sample's shadow direction and length;
 * 8. `buildings` — footprint, lifted roof, facade, door and a kind-specific
 *    silhouette (pitched roof, balconies, glass strip, awning, chimneys, roller
 *    door, flagpole, red cross, dome);
 * 9. `windows` — lit window grids, alpha driven by {@link LightingSample.windowGlow};
 * 10. `streetlights` — lamp glow pools, poles and heads, driven by
 *     {@link LightingSample.streetlightIntensity};
 * 11. `citizens` — body tinted by activity, head, mood ring and activity badge,
 *     with a dashed ring for citizens currently travelling;
 * 12. `vehicles` — kind-specific bodies, an occupancy bar/pips and night
 *     headlight wedges;
 * 13. `ambient` — the day/night colour veil from {@link LightingSample.ambient};
 * 14. `haze` — the air haze veil from {@link LightingSample.haze}.
 *
 * The order is asserted by `tests/render/renderer.test.ts` from both
 * {@link FrameStats.layers} and the recorded context calls, so the pipeline
 * cannot silently re-order.
 *
 * ## Culling
 *
 * Every layer filters against {@link ViewportCamera.visibleWorldBounds} before
 * emitting anything: tiles by visible range, districts/roads/buildings by
 * rectangle intersection, citizens/vehicles/street lamps by a puck test. A
 * frame whose camera looks at empty ground therefore issues no terrain-grid,
 * building, agent or lamp draw at all, and {@link FrameStats.culled} reports how
 * many entities each layer skipped.
 *
 * ## Frame budget
 *
 * {@link FRAME_BUDGET_MS} is one 60 fps frame. The pipeline is written to stay
 * inside it for the shipped city scale (>=24 buildings, >=50 citizens, >=10
 * vehicles, see `README.md`) by batching: terrain runs collapse into a handful
 * of fills, road segments into one stroke per lane class, citizens into one path
 * per activity/mood bucket, and all lit windows of the city into a single fill.
 * Per-frame allocations are confined to the returned {@link FrameStats} summary;
 * the internal run lists, agent snapshots and counters are reused. The headless
 * benchmark in `tests/render/renderer.test.ts` renders the full fixture frame
 * (141 buildings, 72 citizens, live fleet) against the budget.
 *
 * ## Consumption
 *
 * The renderer reads three narrow views of the earlier phases, so it stays
 * decoupled from their implementations while still being wired to the real
 * systems:
 *
 * - the world through the `WorldMap` contract plus an optional `districts`
 *   array ({@link RendererWorld});
 * - the citizen roster through {@link CitizenSource} (`CitizensSystem` matches);
 * - the traffic fleet through {@link VehicleSource} (`VehiclesSystem` matches);
 * - the palette through {@link LightingSource} (`DayNightLighting` matches).
 *
 * ## Lifecycle
 *
 * `new CityRenderer({ world, camera, context, ... })` →
 * {@link CityRenderer.attach} (bind/re-bind surface and camera, size the backing
 * store) → {@link CityRenderer.frame} once per animation frame →
 * {@link CityRenderer.dispose}. `frame()` throws while no context is bound, and
 * both `attach()` and `frame()` throw after disposal, so a torn-down renderer is
 * never silently reused.
 */

import type {
  ActivityKind,
  Building,
  BuildingKind,
  Citizen,
  EntityId,
  RoadNode,
  TerrainKind,
  TileRect,
  Vec2,
  Vehicle,
  VehicleKind,
  WorldMap,
} from '../sim/types';
import { ACTIVITY_KINDS, BUILDING_KINDS, TERRAIN_KINDS, VEHICLE_KINDS } from '../sim/types';
import type { CameraTransform, ViewportCamera } from './camera';
import type { AmbientTint, LightingPhase, LightingSample, RgbColor } from './daynight';
import { colorToCss, colorToCssWithAlpha, sampleLighting } from './daynight';

/* ---------------------------------------------------------------- layers -- */

/**
 * The frame pipeline, in draw order. {@link CityRenderer.frame} reports the
 * subset it actually emitted as {@link FrameStats.layers}, so a caller can
 * assert exactly what one frame painted and in which order.
 */
export const RENDER_LAYERS = [
  'sky',
  'terrain',
  'districts',
  'roads',
  'lane-markings',
  'crossings',
  'shadows',
  'buildings',
  'windows',
  'streetlights',
  'citizens',
  'vehicles',
  'ambient',
  'haze',
] as const;

/** One layer name of {@link RENDER_LAYERS}. */
export type RenderLayer = (typeof RENDER_LAYERS)[number];

/* --------------------------------------------------------------- tuning -- */

/** One 60 fps frame in milliseconds; the headless benchmark's budget. */
export const FRAME_BUDGET_MS = 1000 / 60;

/** Hour a frame falls back to when no lighting sample is available. */
export const DEFAULT_FRAME_HOUR = 12;

const TAU = Math.PI * 2;

/** Width of one traffic lane, in world tiles. */
const LANE_WIDTH_TILES = 0.5;
/** Extra width the darker casing stroke adds around the road surface. */
const ROAD_CASING_TILES = 0.34;
/** Dash pattern of the centre line, in world tiles. */
const LANE_DASH: readonly number[] = [0.8, 0.7];
/** Centre-line stroke width, in world tiles. */
const LANE_MARKING_WIDTH_TILES = 0.09;
/** Highest lane count the renderer distinguishes when batching segments. */
const MAX_ROAD_LANES = 4;
/** Zebra stripes per signalised node. */
const CROSSWALK_STRIPES = 3;
const CROSSWALK_STRIPE_LENGTH = 0.6;
const CROSSWALK_STRIPE_WIDTH = 0.16;
const CROSSWALK_STRIPE_SPACING = 0.26;

/** World tiles of shadow per unit of {@link LightingSample.shadowLengthFactor}. */
const SHADOW_TILES_PER_FACTOR = 0.9;
const SHADOW_MIN_ALPHA = 0.1;
const SHADOW_MAX_ALPHA = 0.34;

/** Roof inset: the visible facade band of a building, in world tiles. */
const BUILDING_INSET_TILES = 0.16;
/** How far the roof lifts per floor, in world tiles (fake 2.5D height). */
const BUILDING_ROOF_LIFT_PER_FLOOR = 0.13;
/** Floors past which the roof stops lifting (skyline stays readable). */
const BUILDING_MAX_ROOF_LIFT_FLOORS = 8;
const BUILDING_DOOR_WIDTH_TILES = 0.42;
const BUILDING_DOOR_DEPTH_TILES = 0.24;

const WINDOW_COLUMNS_MAX = 4;
const WINDOW_ROWS_MAX = 3;
const WINDOW_COLUMN_SPACING_TILES = 0.5;
const WINDOW_WIDTH_TILES = 0.18;
const WINDOW_HEIGHT_TILES = 0.12;
/** Below this {@link LightingSample.windowGlow} the window layer is skipped. */
const WINDOW_GLOW_THRESHOLD = 0.02;
const WINDOW_GLOW_ALPHA = 0.92;
/**
 * How fast the lit-window share ramps up with {@link LightingSample.windowGlow}:
 * at full glow the whole per-kind mask is lit, while the first windows come on
 * early in the evening and the skyline fills up as night falls.
 */
const WINDOW_GLOW_RAMP = 1.25;

/** Below this {@link LightingSample.streetlightIntensity} lamps are skipped. */
const STREETLIGHT_GLOW_THRESHOLD = 0.05;
const STREETLIGHT_POLE_OFFSET = 0.34;
const STREETLIGHT_POLE_HEIGHT = 0.72;
const STREETLIGHT_POLE_WIDTH_TILES = 0.1;
const STREETLIGHT_GLOW_RADIUS = 1.5;
const STREETLIGHT_GLOW_ALPHA = 0.5;
const STREETLIGHT_HEAD_RADIUS = 0.11;

const CITIZEN_BODY_RADIUS = 0.22;
const CITIZEN_HEAD_RADIUS = 0.1;
const CITIZEN_HEAD_OFFSET = 0.3;
const CITIZEN_RING_RADIUS = 0.31;
const CITIZEN_RING_WIDTH_TILES = 0.07;
const CITIZEN_PIP_SIZE = 0.14;
const CITIZEN_PIP_OFFSET_X = 0.24;
const CITIZEN_PIP_OFFSET_Y = 0.34;
const CITIZEN_INDOOR_ALPHA = 0.55;
const CITIZEN_TRAVEL_DASH: readonly number[] = [0.16, 0.14];
/** Side margin kept when an indoor citizen is placed along their frontage. */
const CITIZEN_FRONTAGE_MARGIN = 0.25;
/** How far south of a footprint its residents/workers stand, in world tiles. */
const CITIZEN_FRONTAGE_OFFSET = 0.22;
/** Mood buckets used to batch the mood ring paths. */
const MOOD_BUCKETS = 5;

/** Puck radius used when culling citizens, vehicles and lamps. */
const AGENT_CULL_RADIUS = 0.45;

const DISTRICT_WASH_ALPHA = 0.22;
const DISTRICT_BORDER_ALPHA = 0.35;
/** A district name is only drawn when the quarter is at least this wide on screen. */
const DISTRICT_LABEL_MIN_PX = 96;
const DISTRICT_LABEL_FONT = '600 1.4px system-ui, sans-serif';
const DISTRICT_LABEL_INSET_TILES = 2.2;

const HAZE_THRESHOLD = 0.05;
const HAZE_MAX_ALPHA = 0.4;

/** Above this glow/streetlight reading the frame counts as night, in favour of headlights. */
const NIGHT_SIGNAL = 0.25;
const MAX_OCCUPANCY_PIPS = 4;
const HEADLIGHT_BEAM_TILES = 1.1;

/** Sky used only if a sample somehow carries no gradient stops. */
const FALLBACK_SKY: RgbColor = [12, 16, 30];

/** Deterministic 0..1 hash of three small integers; no allocation, no state. */
function hashUnit(a: number, b: number, c: number): number {
  let hash = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  hash = (hash ^ (hash >>> 13)) * 1274126177;
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  return value > max ? max : value;
}

function clamp01(value: number): number {
  return clampNumber(value, 0, 1);
}

/** Mood bucket index, 0 = miserable..4 = delighted. */
function moodBucket(mood: number): number {
  return clampNumber(Math.round(clamp01(mood) * (MOOD_BUCKETS - 1)), 0, MOOD_BUCKETS - 1);
}

/** Half-open rectangle overlap: touching edges do not count as visible. */
function rectIntersects(left: TileRect, right: TileRect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

/* --------------------------------------------------------------- palette -- */

/** Wall, roof and trim colours of one building kind. */
export interface BuildingPalette {
  /** Fallback wall colour, used when a building carries no colour of its own. */
  readonly wall: string;
  /** Roof (top face) colour. */
  readonly roof: string;
  /** Shading/detail colour: facade band, awnings, doors' surrounds, chimneys. */
  readonly trim: string;
}

/**
 * The complete render palette. Every colour a frame paints from lives here, so
 * one frame's look is deterministic and a test can find a layer by its colour.
 * Entity `color` fields from the domain contracts are still honoured for the
 * building wall and the vehicle body, which keeps the sim's own colour data
 * meaningful; every derived shade comes from this palette.
 */
export interface RendererPalette {
  readonly terrain: Readonly<Record<TerrainKind, string>>;
  readonly roadCasing: string;
  readonly roadSurface: string;
  readonly laneMarking: string;
  readonly crosswalk: string;
  readonly shadow: string;
  readonly building: Readonly<Record<BuildingKind, BuildingPalette>>;
  readonly buildingDoor: string;
  readonly windowGlow: string;
  readonly streetlightLamp: string;
  readonly streetlightGlow: string;
  readonly citizen: Readonly<Record<ActivityKind, string>>;
  readonly citizenHead: string;
  /** Mood ring ramp, index 0 = miserable .. index {@link MOOD_BUCKETS}-1 = delighted. */
  readonly citizenRing: readonly string[];
  readonly citizenIndoorAlpha: number;
  readonly vehicle: Readonly<Record<VehicleKind, string>>;
  readonly vehicleGlass: string;
  readonly vehicleWheel: string;
  readonly vehicleHeadlight: string;
  readonly occupancyLow: string;
  readonly occupancyHigh: string;
  readonly haze: RgbColor;
}

/** Palette overrides accepted by {@link createRendererPalette}. */
export interface RendererPaletteOverrides
  extends Omit<
    Partial<RendererPalette>,
    'terrain' | 'building' | 'citizen' | 'vehicle' | 'citizenRing'
  > {
  readonly terrain?: Partial<Record<TerrainKind, string>>;
  readonly building?: Partial<Record<BuildingKind, BuildingPalette>>;
  readonly citizen?: Partial<Record<ActivityKind, string>>;
  readonly vehicle?: Partial<Record<VehicleKind, string>>;
  readonly citizenRing?: readonly string[];
}

/** The shipped palette: muted city asphalt, brick, glass and night lights. */
export const DEFAULT_RENDERER_PALETTE: RendererPalette = {
  terrain: {
    grass: '#4d6a3f',
    road: '#3b3e44',
    water: '#2f5f8f',
    park: '#4c8546',
    plaza: '#9a958a',
  },
  roadCasing: '#2b2e33',
  roadSurface: '#474b52',
  laneMarking: '#e6dcae',
  crosswalk: '#e8e8e4',
  shadow: '#161b2a',
  building: {
    house: { wall: '#c8a48a', roof: '#8d5b46', trim: '#7a4a38' },
    apartment: { wall: '#bda58f', roof: '#7c6650', trim: '#6a5340' },
    office: { wall: '#9aa7c8', roof: '#5d6b8f', trim: '#485575' },
    shop: { wall: '#d8a25f', roof: '#8f6230', trim: '#b7793d' },
    factory: { wall: '#a8a29a', roof: '#6c6760', trim: '#55514c' },
    warehouse: { wall: '#b0a08c', roof: '#6f6355', trim: '#584e42' },
    school: { wall: '#c8b6e2', roof: '#7f6ea0', trim: '#665687' },
    hospital: { wall: '#e2e8ee', roof: '#9fb2c0', trim: '#7f93a3' },
    park: { wall: '#7dbb6a', roof: '#3f6f39', trim: '#2f5730' },
    civic: { wall: '#cbbfa6', roof: '#8b8069', trim: '#6f6553' },
  },
  buildingDoor: '#3c332f',
  windowGlow: '#ffd98a',
  streetlightLamp: '#ffe0a3',
  streetlightGlow: '#ffcf7a',
  citizen: {
    home: '#8fb7d8',
    work: '#e0b45f',
    errand: '#8fd39a',
    entertainment: '#c3a0e0',
  },
  citizenHead: '#f0d2b4',
  citizenRing: ['#d95f5f', '#e08a52', '#e0c060', '#9ccf72', '#5fb96f'],
  citizenIndoorAlpha: CITIZEN_INDOOR_ALPHA,
  vehicle: {
    car: '#e0e6f2',
    taxi: '#f2c14e',
    bus: '#d2603f',
    truck: '#8fa4c0',
    bicycle: '#63c6d6',
    tram: '#7f9bd6',
  },
  vehicleGlass: '#26303d',
  vehicleWheel: '#1b1f26',
  vehicleHeadlight: '#fff3c4',
  occupancyLow: '#7f8fa8',
  occupancyHigh: '#e0c060',
  haze: [214, 224, 236],
};

/** Builds a palette from the defaults, overriding only what the caller names. */
export function createRendererPalette(overrides: RendererPaletteOverrides = {}): RendererPalette {
  const terrain = { ...DEFAULT_RENDERER_PALETTE.terrain, ...overrides.terrain };
  const citizen = { ...DEFAULT_RENDERER_PALETTE.citizen, ...overrides.citizen };
  const vehicle = { ...DEFAULT_RENDERER_PALETTE.vehicle, ...overrides.vehicle };
  const building = { ...DEFAULT_RENDERER_PALETTE.building };
  for (const kind of BUILDING_KINDS) {
    const override = overrides.building?.[kind];
    building[kind] = override ? { ...building[kind], ...override } : building[kind];
  }
  return {
    ...DEFAULT_RENDERER_PALETTE,
    ...overrides,
    terrain,
    citizen,
    vehicle,
    building,
    citizenRing: overrides.citizenRing ?? DEFAULT_RENDERER_PALETTE.citizenRing,
  };
}

/* -------------------------------------------------- consumed contracts -- */

/**
 * The district fields the renderer reads. Structurally satisfied by the world
 * module's `District`, so the renderer never has to import it.
 */
export interface RendererDistrict {
  readonly id: EntityId;
  readonly name: string;
  readonly bounds: TileRect;
  readonly color: string;
}

/**
 * The world contract plus the optional district list. `CityWorld` and the test
 * fixtures both satisfy this, and a plain `WorldMap` without districts simply
 * renders without the district wash layer.
 */
export interface RendererWorld extends WorldMap {
  readonly districts?: readonly RendererDistrict[];
}

/** The live fields the renderer reads per citizen; `CitizenLiveState` matches. */
export interface CitizenView {
  readonly citizenId: EntityId;
  readonly activity: ActivityKind;
  readonly travelling: boolean;
  readonly position: Vec2;
  readonly insideBuildingId: EntityId | null;
}

/** The citizen roster view the renderer consumes (`CitizensSystem` matches). */
export interface CitizenSource {
  readonly citizens: readonly Citizen[];
  liveStateFor(citizenId: EntityId): CitizenView | null;
}

/** The traffic view the renderer consumes (`VehiclesSystem` matches). */
export interface VehicleSource {
  activeVehicles(): readonly Vehicle[];
}

/** The lighting view the renderer consumes (`DayNightLighting` matches). */
export interface LightingSource {
  readonly sample: LightingSample;
  update(): LightingSample;
}

/** Lighting for one frame: a raw hour, an explicit sample, or the bound source. */
export type FrameInput = number | LightingSample | undefined;

/* ----------------------------------------------------------------- stats -- */

/** Per-layer entity counts of one frame. */
export interface FrameCounters {
  /** Terrain tiles covered by the frame (visible tiles, not emitted rects). */
  terrainTiles: number;
  /** Batched terrain rectangles actually emitted. */
  terrainRects: number;
  /** Terrain fills issued (one per terrain kind present). */
  terrainBatches: number;
  districts: number;
  districtLabels: number;
  roadSegments: number;
  laneMarkings: number;
  crossings: number;
  shadows: number;
  buildings: number;
  buildingDoors: number;
  buildingDetails: number;
  windowsLit: number;
  streetlights: number;
  citizens: number;
  /** Citizens drawn while travelling (dashed ring). */
  citizenTrails: number;
  moodIndicators: number;
  activityIndicators: number;
  vehicles: number;
  occupantCues: number;
  occupancyPips: number;
  headlights: number;
  ambientTint: number;
  haze: number;
}

/** Entities each layer skipped because they were outside the camera bounds. */
export interface CullStats {
  tiles: number;
  districts: number;
  roadSegments: number;
  roadNodes: number;
  buildings: number;
  citizens: number;
  vehicles: number;
}

/** Everything one {@link CityRenderer.frame} call did, ready to assert. */
export interface FrameStats extends FrameCounters {
  /** 1-based frame index since the last attach. */
  readonly frame: number;
  readonly hour: number;
  readonly phase: LightingPhase;
  /** Device pixels per world tile this frame drew at. */
  readonly scale: number;
  readonly pixelRatio: number;
  /** Backing-store size in device pixels. */
  readonly surface: { readonly width: number; readonly height: number };
  /** Visible world rectangle the frame culled against, in tiles. */
  readonly bounds: TileRect;
  /** Layers emitted this frame, in draw order. */
  readonly layers: readonly RenderLayer[];
  readonly buildingsByKind: Readonly<Record<BuildingKind, number>>;
  readonly citizensByActivity: Readonly<Record<ActivityKind, number>>;
  readonly vehiclesByKind: Readonly<Record<VehicleKind, number>>;
  readonly citizensTravelling: number;
  readonly citizensIndoors: number;
  /** World-space shadow offset the frame drew. */
  readonly shadowOffset: Vec2;
  readonly shadowAlpha: number;
  readonly shadowLengthFactor: number;
  readonly windowGlow: number;
  readonly streetlightIntensity: number;
  readonly sunElevation: number;
  readonly ambient: AmbientTint;
  /** Buildings + citizens + vehicles + lamps + districts drawn this frame. */
  readonly entitiesDrawn: number;
  /** Canvas method calls the renderer issued (`fillStyle` writes are not counted). */
  readonly contextCalls: number;
  readonly culled: CullStats;
}

/* --------------------------------------------------------------- options -- */

/** Constructor options for {@link CityRenderer}. */
export interface CityRendererOptions {
  /** The city to draw: the `WorldMap` contract, plus `districts` when available. */
  readonly world: RendererWorld;
  /** The authoritative world <-> screen transform and culling rectangle. */
  readonly camera: ViewportCamera;
  /** Injected 2D context; may also be supplied later through `attach()`. */
  readonly context?: CanvasRenderingContext2D | null;
  /** Live citizen roster; frames omit the citizen layer without it. */
  readonly citizens?: CitizenSource | null;
  /** Live fleet; frames omit the vehicle layer without it. */
  readonly vehicles?: VehicleSource | null;
  /** Lighting source sampled when `frame()` gets no explicit sample. */
  readonly lighting?: LightingSource | null;
  /** Palette overrides merged over {@link DEFAULT_RENDERER_PALETTE}. */
  readonly palette?: RendererPaletteOverrides;
  /** Device pixel ratio of the backing store. Defaults to 1. */
  readonly pixelRatio?: number;
}

/* --------------------------------------------------------------- helpers -- */

const EMPTY_CITIZENS: readonly Citizen[] = [];
const EMPTY_VEHICLES: readonly Vehicle[] = [];
const EMPTY_DASH: readonly number[] = [];

/** Per-activity coordinate lists, split by whether the citizen is indoors. */
interface CitizenGroup {
  readonly out: number[];
  readonly in: number[];
}

function createCitizenGroups(): Record<ActivityKind, CitizenGroup> {
  const groups = {} as Record<ActivityKind, CitizenGroup>;
  for (const kind of ACTIVITY_KINDS) {
    groups[kind] = { out: [], in: [] };
  }
  return groups;
}

function createActivityPaths(): Record<ActivityKind, number[]> {
  const paths = {} as Record<ActivityKind, number[]>;
  for (const kind of ACTIVITY_KINDS) {
    paths[kind] = [];
  }
  return paths;
}

function createTerrainRuns(): Record<TerrainKind, number[]> {
  const runs = {} as Record<TerrainKind, number[]>;
  for (const kind of TERRAIN_KINDS) {
    runs[kind] = [];
  }
  return runs;
}

function createZeroCounts<T extends string>(values: readonly T[]): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const value of values) {
    counts[value] = 0;
  }
  return counts;
}

function zeroCounts<T extends string>(counts: Record<T, number>, values: readonly T[]): void {
  for (const value of values) {
    counts[value] = 0;
  }
}

function resetCounters(counters: FrameCounters): void {
  counters.terrainTiles = 0;
  counters.terrainRects = 0;
  counters.terrainBatches = 0;
  counters.districts = 0;
  counters.districtLabels = 0;
  counters.roadSegments = 0;
  counters.laneMarkings = 0;
  counters.crossings = 0;
  counters.shadows = 0;
  counters.buildings = 0;
  counters.buildingDoors = 0;
  counters.buildingDetails = 0;
  counters.windowsLit = 0;
  counters.streetlights = 0;
  counters.citizens = 0;
  counters.citizenTrails = 0;
  counters.moodIndicators = 0;
  counters.activityIndicators = 0;
  counters.vehicles = 0;
  counters.occupantCues = 0;
  counters.occupancyPips = 0;
  counters.headlights = 0;
  counters.ambientTint = 0;
  counters.haze = 0;
}

function resetCulled(culled: CullStats): void {
  culled.tiles = 0;
  culled.districts = 0;
  culled.roadSegments = 0;
  culled.roadNodes = 0;
  culled.buildings = 0;
  culled.citizens = 0;
  culled.vehicles = 0;
}

function isStreetlightNode(node: RoadNode): boolean {
  return node.hasTrafficLight || node.kind === 'intersection';
}

/* -------------------------------------------------------------- renderer -- */

export class CityRenderer {
  /** The city being drawn. */
  readonly world: RendererWorld;
  /** The palette every layer paints from. */
  readonly palette: RendererPalette;
  /** Device pixels per logical pixel of the backing store. */
  readonly pixelRatio: number;

  private cameraRef: ViewportCamera | null;
  private contextRef: CanvasRenderingContext2D | null;
  private readonly citizensRef: CitizenSource | null;
  private readonly vehiclesRef: VehicleSource | null;
  private readonly lightingRef: LightingSource | null;

  private readonly buildingIndex = new Map<EntityId, Building>();
  private readonly nodeIndex = new Map<EntityId, RoadNode>();
  private readonly laneBuckets = new Map<number, number[]>();
  private readonly counters: FrameCounters = {
    terrainTiles: 0,
    terrainRects: 0,
    terrainBatches: 0,
    districts: 0,
    districtLabels: 0,
    roadSegments: 0,
    laneMarkings: 0,
    crossings: 0,
    shadows: 0,
    buildings: 0,
    buildingDoors: 0,
    buildingDetails: 0,
    windowsLit: 0,
    streetlights: 0,
    citizens: 0,
    citizenTrails: 0,
    moodIndicators: 0,
    activityIndicators: 0,
    vehicles: 0,
    occupantCues: 0,
    occupancyPips: 0,
    headlights: 0,
    ambientTint: 0,
    haze: 0,
  };
  private readonly culled: CullStats = {
    tiles: 0,
    districts: 0,
    roadSegments: 0,
    roadNodes: 0,
    buildings: 0,
    citizens: 0,
    vehicles: 0,
  };
  private readonly buildingKindCounts = createZeroCounts(BUILDING_KINDS);
  private readonly citizenActivityCounts = createZeroCounts(ACTIVITY_KINDS);
  private readonly vehicleKindCounts = createZeroCounts(VEHICLE_KINDS);

  /* Reused frame buffers: nothing below allocates per entity, per frame. */
  private readonly layerBuffer: RenderLayer[] = [];
  private readonly tileRange = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly pointBox: TileRect = { x: 0, y: 0, width: 0, height: 0 };
  private readonly terrainRuns = createTerrainRuns();
  private readonly citizenAnchorX: number[] = [];
  private readonly citizenAnchorY: number[] = [];
  private readonly citizenActivity: ActivityKind[] = [];
  private readonly citizenMood: number[] = [];
  private readonly citizenVisible: boolean[] = [];
  private readonly citizenTravellingFlag: boolean[] = [];
  private readonly citizenIndoorFlag: boolean[] = [];
  private readonly citizenGroups = createCitizenGroups();
  private readonly citizenHeads: number[] = [];
  /** Anchors of the citizens drawn with the travelling ring, as x,y pairs. */
  private readonly citizenTrails: number[] = [];
  private readonly citizenPips = createActivityPaths();
  private readonly moodRings: number[][] = [
    [],
    [],
    [],
    [],
    [],
  ];
  private readonly vehicleList: Vehicle[] = [];
  private readonly vehicleVisible: boolean[] = [];

  private citizenCount = 0;
  private citizenIndoorCount = 0;
  private surfaceWidthValue = 0;
  private surfaceHeightValue = 0;
  private frameScale = 1;
  private shadowOffsetX = 0;
  private shadowOffsetY = 0;
  private shadowAlphaValue = 0;
  private frameCountValue = 0;
  private commandCount = 0;
  private lastFrameValue: FrameStats | null = null;
  private disposedFlag = false;

  constructor(options: CityRendererOptions) {
    if (!options || !options.world) {
      throw new TypeError('CityRenderer requires a world');
    }
    if (!options.camera) {
      throw new TypeError('CityRenderer requires a ViewportCamera');
    }
    this.world = options.world;
    this.palette = createRendererPalette(options.palette ?? {});
    this.pixelRatio = clampNumber(options.pixelRatio ?? 1, 0.1, 8);
    this.cameraRef = options.camera;
    this.contextRef = options.context ?? null;
    this.citizensRef = options.citizens ?? null;
    this.vehiclesRef = options.vehicles ?? null;
    this.lightingRef = options.lighting ?? null;
    for (const building of options.world.buildings) {
      this.buildingIndex.set(building.id, building);
    }
    for (const node of options.world.nodes) {
      this.nodeIndex.set(node.id, node);
    }
    if (this.contextRef) {
      this.syncSurface();
    }
  }

  /* -------------------------------------------------------------- reading -- */

  /** The camera frames are transformed and culled with; `null` once disposed. */
  get camera(): ViewportCamera | null {
    return this.cameraRef;
  }

  /** True while a context and a camera are bound. */
  get attached(): boolean {
    return this.contextRef !== null && this.cameraRef !== null;
  }

  /** True once {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposedFlag;
  }

  /** Frames drawn since the last `attach()`. */
  get frameCount(): number {
    return this.frameCountValue;
  }

  /** Backing-store size in device pixels, as last synced. */
  get surfaceSize(): { readonly width: number; readonly height: number } {
    return { width: this.surfaceWidthValue, height: this.surfaceHeightValue };
  }

  /** Stats of the most recent frame, or `null` before the first one. */
  get lastFrame(): FrameStats | null {
    return this.lastFrameValue;
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /**
   * Binds (or re-binds) the drawing surface and the camera, sizes the canvas
   * backing store to `camera.viewportSize * pixelRatio`, and resets the frame
   * counter. Passing no arguments re-attaches the constructor's pair, which is
   * how the app composition re-binds after a canvas swap.
   */
  attach(context?: CanvasRenderingContext2D | null, camera?: ViewportCamera | null): void {
    this.assertUsable('attach');
    const nextContext = context ?? this.contextRef;
    if (!nextContext) {
      throw new TypeError('CityRenderer.attach(context, camera) needs a 2D context');
    }
    const nextCamera = camera ?? this.cameraRef;
    if (!nextCamera) {
      throw new TypeError('CityRenderer.attach(context, camera) needs a ViewportCamera');
    }
    if (nextCamera.isDisposed) {
      throw new Error('CityRenderer.attach() received a disposed ViewportCamera');
    }
    this.contextRef = nextContext;
    this.cameraRef = nextCamera;
    this.frameCountValue = 0;
    this.lastFrameValue = null;
    this.syncSurface();
  }

  /**
   * Draws one frame and returns what it did.
   *
   * `input` selects the lighting: an hour (`frame(6.5)`), an explicit
   * {@link LightingSample} (replay, tests), or nothing to sample the bound
   * {@link LightingSource} at the current sim time, falling back to
   * {@link DEFAULT_FRAME_HOUR} when no source is bound.
   */
  frame(input?: FrameInput): FrameStats {
    this.assertUsable('frame');
    const context = this.contextRef;
    const camera = this.cameraRef;
    if (!context || !camera) {
      throw new Error('CityRenderer.frame() requires attach(context, camera) first');
    }

    const sample = this.resolveLighting(input);
    const transform = camera.transform;
    const bounds = camera.visibleWorldBounds();
    resetCounters(this.counters);
    resetCulled(this.culled);
    zeroCounts(this.buildingKindCounts, BUILDING_KINDS);
    zeroCounts(this.citizenActivityCounts, ACTIVITY_KINDS);
    zeroCounts(this.vehicleKindCounts, VEHICLE_KINDS);
    this.commandCount = 0;
    this.shadowOffsetX = 0;
    this.shadowOffsetY = 0;
    this.shadowAlphaValue = 0;
    this.syncSurface();
    this.frameScale = transform.scale * this.pixelRatio;

    const layers = this.layerBuffer;
    layers.length = 0;

    // Snapshot the live agents once so every layer of this frame agrees on where
    // citizens and vehicles are.
    this.prepareCitizens(bounds);
    this.prepareVehicles(bounds);

    this.save();
    this.drawSky(sample, layers);
    this.applyWorldTransform(transform);
    this.drawTerrain(bounds, layers);
    this.drawDistricts(bounds, layers);
    this.drawRoads(bounds, layers);
    this.drawCrossings(bounds, layers);
    this.drawShadows(bounds, sample, layers);
    this.drawBuildings(bounds, layers);
    this.drawWindows(bounds, sample, layers);
    this.drawStreetlights(bounds, sample, layers);
    this.drawCitizens(layers);
    this.drawVehicles(sample, layers);
    this.drawAmbient(sample, layers);
    this.drawHaze(sample, layers);
    this.restore();

    const counters = this.counters;
    this.frameCountValue += 1;
    const stats: FrameStats = {
      ...counters,
      frame: this.frameCountValue,
      hour: sample.hour,
      phase: sample.phase,
      scale: this.frameScale,
      pixelRatio: this.pixelRatio,
      surface: { width: this.surfaceWidthValue, height: this.surfaceHeightValue },
      bounds,
      layers: [...layers],
      buildingsByKind: { ...this.buildingKindCounts },
      citizensByActivity: { ...this.citizenActivityCounts },
      vehiclesByKind: { ...this.vehicleKindCounts },
      citizensTravelling: counters.citizenTrails,
      citizensIndoors: this.citizenIndoorCount,
      shadowOffset: { x: this.shadowOffsetX, y: this.shadowOffsetY },
      shadowAlpha: this.shadowAlphaValue,
      shadowLengthFactor: sample.shadowLengthFactor,
      windowGlow: sample.windowGlow,
      streetlightIntensity: sample.streetlightIntensity,
      sunElevation: sample.sunElevation,
      ambient: sample.ambient,
      entitiesDrawn:
        counters.buildings +
        counters.citizens +
        counters.vehicles +
        counters.streetlights +
        counters.districts,
      contextCalls: this.commandCount,
      culled: { ...this.culled },
    };
    this.lastFrameValue = stats;
    return stats;
  }

  /** Idempotent teardown. `attach()` and `frame()` throw afterwards. */
  dispose(): void {
    if (this.disposedFlag) {
      return;
    }
    this.disposedFlag = true;
    this.contextRef = null;
    this.cameraRef = null;
    this.lastFrameValue = null;
    this.layerBuffer.length = 0;
    this.buildingIndex.clear();
    this.nodeIndex.clear();
    this.laneBuckets.clear();
  }

  /* ---------------------------------------------------------------- input -- */

  private resolveLighting(input: FrameInput): LightingSample {
    if (input === undefined) {
      return this.lightingRef ? this.lightingRef.update() : sampleLighting(DEFAULT_FRAME_HOUR);
    }
    if (typeof input === 'number') {
      return sampleLighting(input);
    }
    return input;
  }

  /**
   * Snaps the backing store to the camera's viewport size (times the pixel
   * ratio) and keeps the CSS box in logical pixels. Cheap to re-check every
   * frame, so a `camera.resize()` needs no extra wiring.
   */
  private syncSurface(): void {
    const camera = this.cameraRef;
    const context = this.contextRef;
    if (!camera || !context) {
      return;
    }
    const viewport = camera.viewportSize;
    const width = Math.max(1, Math.round(viewport.width * this.pixelRatio));
    const height = Math.max(1, Math.round(viewport.height * this.pixelRatio));
    this.surfaceWidthValue = width;
    this.surfaceHeightValue = height;

    // Recording doubles may expose no canvas at all; a real context always has one.
    const canvas = (context as { canvas?: HTMLCanvasElement | null }).canvas ?? null;
    if (!canvas) {
      return;
    }
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    const style = canvas.style;
    if (style && typeof style === 'object') {
      const cssWidth = `${viewport.width}px`;
      const cssHeight = `${viewport.height}px`;
      if (style.width !== cssWidth) {
        style.width = cssWidth;
      }
      if (style.height !== cssHeight) {
        style.height = cssHeight;
      }
    }
  }

  private prepareCitizens(bounds: TileRect): void {
    const source = this.citizensRef;
    const citizens = source ? source.citizens : EMPTY_CITIZENS;
    const count = citizens.length;
    this.citizenCount = count;
    this.citizenIndoorCount = 0;

    for (let index = 0; index < count; index += 1) {
      const citizen = citizens[index];
      const live = source ? source.liveStateFor(citizen.id) : null;
      let x = live ? live.position.x : citizen.position.x;
      let y = live ? live.position.y : citizen.position.y;
      let indoors = false;
      let travelling = false;
      let activity = citizen.currentActivity;

      if (live) {
        travelling = live.travelling;
        activity = live.activity;
        if (!travelling && live.insideBuildingId) {
          const building = this.buildingIndex.get(live.insideBuildingId);
          if (building) {
            // Residents and workers show along their building's street frontage,
            // spaced by a stable hash so the crowd does not stack up.
            const footprint = building.footprint;
            const span = Math.max(0, footprint.width - CITIZEN_FRONTAGE_MARGIN * 2);
            const slot = hashUnit(index + 1, footprint.width * 7 + 3, footprint.height * 11 + 5);
            x = footprint.x + CITIZEN_FRONTAGE_MARGIN + slot * span;
            y = footprint.y + footprint.height + CITIZEN_FRONTAGE_OFFSET;
            indoors = true;
            this.citizenIndoorCount += 1;
          }
        }
      }

      this.citizenAnchorX[index] = x;
      this.citizenAnchorY[index] = y;
      this.citizenActivity[index] = activity;
      this.citizenMood[index] = clamp01(citizen.mood);
      this.citizenTravellingFlag[index] = travelling;
      this.citizenIndoorFlag[index] = indoors;
      const visible = this.pointIntersects(x, y, AGENT_CULL_RADIUS, bounds);
      this.citizenVisible[index] = visible;
      if (!visible) {
        this.culled.citizens += 1;
      }
    }
  }

  private prepareVehicles(bounds: TileRect): void {
    const source = this.vehiclesRef;
    const vehicles = source ? source.activeVehicles() : EMPTY_VEHICLES;
    const list = this.vehicleList;
    const visible = this.vehicleVisible;
    list.length = 0;
    visible.length = 0;
    for (const vehicle of vehicles) {
      const size = VEHICLE_SIZE[vehicle.kind];
      const radius = Math.max(size.length, size.width) / 2 + AGENT_CULL_RADIUS;
      const inView = this.pointIntersects(vehicle.position.x, vehicle.position.y, radius, bounds);
      list.push(vehicle);
      visible.push(inView);
      if (!inView) {
        this.culled.vehicles += 1;
      }
    }
  }

  /* ----------------------------------------------------------- transforms -- */

  private applyWorldTransform(transform: CameraTransform): void {
    const ratio = this.pixelRatio;
    this.setTransform(
      transform.scale * ratio,
      0,
      0,
      transform.scale * ratio,
      transform.offsetX * ratio,
      transform.offsetY * ratio,
    );
  }

  private applyScreenTransform(): void {
    this.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  /* ------------------------------------------------------------- pipeline -- */

  private drawSky(sample: LightingSample, layers: RenderLayer[]): void {
    const context = this.ctx;
    const width = this.surfaceWidthValue;
    const height = this.surfaceHeightValue;
    this.applyScreenTransform();
    this.clearRect(0, 0, width, height);
    const gradient = context.createLinearGradient(0, 0, 0, height);
    this.commandCount += 1;
    if (sample.sky.length > 0) {
      for (const stop of sample.sky) {
        gradient.addColorStop(clamp01(stop.offset), colorToCss(stop.color));
        this.commandCount += 1;
      }
    } else {
      gradient.addColorStop(0, colorToCss(FALLBACK_SKY));
      this.commandCount += 1;
    }
    context.fillStyle = gradient;
    this.fillRect(0, 0, width, height);
    layers.push('sky');
  }

  /**
   * Tile grid, run-length merged per row and then batched into one path per
   * terrain kind: a full 160x120 city collapses into a handful of fills instead
   * of 19 200 rectangles.
   */
  private drawTerrain(bounds: TileRect, layers: RenderLayer[]): void {
    const world = this.world;
    const range = this.visibleTileRange(bounds);
    const columns = range.x1 - range.x0;
    const rows = range.y1 - range.y0;
    if (columns <= 0 || rows <= 0) {
      this.culled.tiles = world.tiles.length;
      return;
    }
    this.culled.tiles = Math.max(0, world.tiles.length - columns * rows);

    const runs = this.terrainRuns;
    for (const kind of TERRAIN_KINDS) {
      runs[kind].length = 0;
    }
    const tiles = world.tiles;
    const width = world.widthInTiles;
    for (let y = range.y0; y < range.y1; y += 1) {
      const rowStart = y * width;
      let runStart = range.x0;
      let runKind = tiles[rowStart + range.x0].terrain;
      for (let x = range.x0 + 1; x < range.x1; x += 1) {
        const kind = tiles[rowStart + x].terrain;
        if (kind === runKind) {
          continue;
        }
        runs[runKind].push(runStart, y, x - runStart, 1);
        runStart = x;
        runKind = kind;
      }
      runs[runKind].push(runStart, y, range.x1 - runStart, 1);
    }

    const counters = this.counters;
    for (const kind of TERRAIN_KINDS) {
      const entries = runs[kind];
      if (entries.length === 0) {
        continue;
      }
      this.beginPath();
      for (let index = 0; index < entries.length; index += 4) {
        this.rect(entries[index], entries[index + 1], entries[index + 2], entries[index + 3]);
      }
      this.ctx.fillStyle = this.palette.terrain[kind];
      this.fill();
      counters.terrainBatches += 1;
      counters.terrainRects += entries.length / 4;
    }
    counters.terrainTiles = columns * rows;
    if (counters.terrainBatches > 0) {
      layers.push('terrain');
    }
  }

  private drawDistricts(bounds: TileRect, layers: RenderLayer[]): void {
    const districts = this.world.districts;
    if (!districts || districts.length === 0) {
      return;
    }
    const context = this.ctx;
    const counters = this.counters;
    let drawn = 0;
    let labels = 0;
    let fontReady = false;

    for (const district of districts) {
      const rect = district.bounds;
      if (!rectIntersects(rect, bounds)) {
        this.culled.districts += 1;
        continue;
      }
      drawn += 1;
      context.globalAlpha = DISTRICT_WASH_ALPHA;
      context.fillStyle = district.color;
      this.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.globalAlpha = DISTRICT_BORDER_ALPHA;
      context.strokeStyle = district.color;
      context.lineWidth = 0.12;
      this.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.globalAlpha = 1;

      if (rect.width * this.frameScale >= DISTRICT_LABEL_MIN_PX && district.name.length > 0) {
        if (!fontReady) {
          context.font = DISTRICT_LABEL_FONT;
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          fontReady = true;
        }
        this.fillText(
          district.name,
          rect.x + rect.width / 2,
          rect.y + Math.min(DISTRICT_LABEL_INSET_TILES, rect.height / 2),
        );
        labels += 1;
      }
    }

    counters.districts = drawn;
    counters.districtLabels = labels;
    if (drawn > 0) {
      layers.push('districts');
    }
  }

  /** Road network: casing + surface per lane class, dashed centre lines, crossings. */
  private drawRoads(bounds: TileRect, layers: RenderLayer[]): void {
    const context = this.ctx;
    const counters = this.counters;
    const buckets = this.laneBuckets;
    buckets.clear();
    let drawn = 0;

    for (const segment of this.world.segments) {
      const from = this.nodeIndex.get(segment.fromNodeId);
      const to = this.nodeIndex.get(segment.toNodeId);
      if (!from || !to) {
        continue;
      }
      const minX = Math.min(from.x, to.x);
      const minY = Math.min(from.y, to.y);
      const spanRect = this.pointBox;
      spanRect.x = minX;
      spanRect.y = minY;
      spanRect.width = Math.abs(to.x - from.x);
      spanRect.height = Math.abs(to.y - from.y);
      if (!rectIntersects(spanRect, bounds)) {
        this.culled.roadSegments += 1;
        continue;
      }
      const lanes = clampNumber(Math.round(segment.lanes) || 1, 1, MAX_ROAD_LANES);
      let coordinates = buckets.get(lanes);
      if (!coordinates) {
        coordinates = [];
        buckets.set(lanes, coordinates);
      }
      coordinates.push(from.x, from.y, to.x, to.y);
      drawn += 1;
    }

    counters.roadSegments = drawn;
    if (drawn === 0) {
      return;
    }

    context.lineCap = 'round';
    for (const [lanes, coordinates] of buckets) {
      this.beginPath();
      for (let index = 0; index < coordinates.length; index += 4) {
        this.moveTo(coordinates[index], coordinates[index + 1]);
        this.lineTo(coordinates[index + 2], coordinates[index + 3]);
      }
      context.strokeStyle = this.palette.roadCasing;
      context.lineWidth = lanes * LANE_WIDTH_TILES + ROAD_CASING_TILES;
      this.stroke();
      context.strokeStyle = this.palette.roadSurface;
      context.lineWidth = lanes * LANE_WIDTH_TILES;
      this.stroke();
    }
    layers.push('roads');

    let markings = 0;
    this.setDash(LANE_DASH);
    context.strokeStyle = this.palette.laneMarking;
    context.lineWidth = LANE_MARKING_WIDTH_TILES;
    this.beginPath();
    for (const [lanes, coordinates] of buckets) {
      if (lanes < 2) {
        continue;
      }
      for (let index = 0; index < coordinates.length; index += 4) {
        this.moveTo(coordinates[index], coordinates[index + 1]);
        this.lineTo(coordinates[index + 2], coordinates[index + 3]);
        markings += 1;
      }
    }
    if (markings > 0) {
      this.stroke();
      layers.push('lane-markings');
    }
    this.setDash(EMPTY_DASH);
    counters.laneMarkings = markings;
  }

  /** Zebra crossings at signalised nodes. */
  private drawCrossings(bounds: TileRect, layers: RenderLayer[]): void {
    let crossings = 0;
    this.beginPath();
    for (const node of this.world.nodes) {
      if (!node.hasTrafficLight) {
        continue;
      }
      if (!this.pointIntersects(node.x, node.y, CROSSWALK_STRIPE_LENGTH, bounds)) {
        continue;
      }
      for (let stripe = 0; stripe < CROSSWALK_STRIPES; stripe += 1) {
        const offset = (stripe - (CROSSWALK_STRIPES - 1) / 2) * CROSSWALK_STRIPE_SPACING;
        this.rect(
          node.x - CROSSWALK_STRIPE_LENGTH / 2,
          node.y + offset - CROSSWALK_STRIPE_WIDTH / 2,
          CROSSWALK_STRIPE_LENGTH,
          CROSSWALK_STRIPE_WIDTH,
        );
      }
      crossings += 1;
    }
    if (crossings > 0) {
      const context = this.ctx;
      context.globalAlpha = 0.75;
      context.fillStyle = this.palette.crosswalk;
      this.fill();
      context.globalAlpha = 1;
      layers.push('crossings');
    }
    this.counters.crossings = crossings;
  }

  /**
   * Shadows from the lighting sample: building silhouettes as offset footprints,
   * agents as pucks. Direction and length come straight from
   * {@link LightingSample.shadowDirection} / `shadowLengthFactor`, so dawn and
   * dusk cast long shadows and noon casts short ones.
   */
  private drawShadows(bounds: TileRect, sample: LightingSample, layers: RenderLayer[]): void {
    const offsetX = sample.shadowDirection.x * sample.shadowLengthFactor * SHADOW_TILES_PER_FACTOR;
    const offsetY = sample.shadowDirection.y * sample.shadowLengthFactor * SHADOW_TILES_PER_FACTOR;
    const alpha = clampNumber(
      SHADOW_MIN_ALPHA + (1 - clamp01(sample.sunElevation)) * (SHADOW_MAX_ALPHA - SHADOW_MIN_ALPHA),
      SHADOW_MIN_ALPHA,
      SHADOW_MAX_ALPHA,
    );
    this.shadowOffsetX = offsetX;
    this.shadowOffsetY = offsetY;
    this.shadowAlphaValue = alpha;

    const context = this.ctx;
    const counters = this.counters;
    let silhouettes = 0;

    this.beginPath();
    for (const building of this.world.buildings) {
      const footprint = building.footprint;
      if (!rectIntersects(footprint, bounds)) {
        continue;
      }
      this.moveTo(footprint.x + offsetX, footprint.y + offsetY);
      this.lineTo(footprint.x + footprint.width + offsetX, footprint.y + offsetY);
      this.lineTo(footprint.x + footprint.width, footprint.y + footprint.height);
      this.lineTo(footprint.x, footprint.y + footprint.height);
      this.closePath();
      silhouettes += 1;
    }
    if (silhouettes > 0) {
      context.globalAlpha = alpha;
      context.fillStyle = this.palette.shadow;
      this.fill();
      context.globalAlpha = 1;
    }

    let agents = 0;
    this.beginPath();
    for (let index = 0; index < this.citizenCount; index += 1) {
      if (!this.citizenVisible[index]) {
        continue;
      }
      this.arc(
        this.citizenAnchorX[index] + offsetX,
        this.citizenAnchorY[index] + offsetY,
        CITIZEN_BODY_RADIUS * 0.8,
        0,
        TAU,
      );
      agents += 1;
    }
    for (let index = 0; index < this.vehicleList.length; index += 1) {
      if (!this.vehicleVisible[index]) {
        continue;
      }
      const position = this.vehicleList[index].position;
      this.arc(position.x + offsetX, position.y + offsetY, AGENT_CULL_RADIUS, 0, TAU);
      agents += 1;
    }
    if (agents > 0) {
      context.globalAlpha = alpha * 0.9;
      context.fillStyle = this.palette.shadow;
      this.fill();
      context.globalAlpha = 1;
    }

    counters.shadows = silhouettes + agents;
    if (counters.shadows > 0) {
      layers.push('shadows');
    }
  }

  private drawBuildings(bounds: TileRect, layers: RenderLayer[]): void {
    const counters = this.counters;
    const counts = this.buildingKindCounts;
    let drawn = 0;
    for (const building of this.world.buildings) {
      if (!rectIntersects(building.footprint, bounds)) {
        this.culled.buildings += 1;
        continue;
      }
      this.drawBuilding(building);
      counts[building.kind] += 1;
      drawn += 1;
    }
    counters.buildings = drawn;
    if (drawn > 0) {
      layers.push('buildings');
    }
  }

  /**
   * One building: ground footprint, shaded facade band, lifted roof, door, then
   * a kind-specific silhouette so an office tower, a house and a factory never
   * read as the same block.
   */
  private drawBuilding(building: Building): void {
    const context = this.ctx;
    const palette = this.palette.building[building.kind];
    const footprint = building.footprint;
    const wall = building.color && building.color.length > 0 ? building.color : palette.wall;
    const lift = clampNumber(
      (building.floors - 1) * BUILDING_ROOF_LIFT_PER_FLOOR,
      0,
      BUILDING_MAX_ROOF_LIFT_FLOORS * BUILDING_ROOF_LIFT_PER_FLOOR,
    );
    const inset = Math.min(BUILDING_INSET_TILES, Math.min(footprint.width, footprint.height) / 3);
    const facadeTop = footprint.y + footprint.height - (inset + lift);
    const facadeHeight = inset + lift;
    const roofX = footprint.x + inset;
    const roofY = footprint.y + inset - lift;
    const roofWidth = Math.max(0.05, footprint.width - inset * 2);
    const roofHeight = Math.max(0.05, footprint.height - inset * 2);

    if (building.kind === 'park') {
      this.drawPark(building, palette);
      return;
    }

    context.fillStyle = wall;
    this.fillRect(footprint.x, footprint.y, footprint.width, footprint.height);
    context.fillStyle = palette.trim;
    this.fillRect(footprint.x, facadeTop, footprint.width, facadeHeight);
    context.fillStyle = palette.roof;
    this.fillRect(roofX, roofY, roofWidth, roofHeight);

    const doorWidth = Math.min(BUILDING_DOOR_WIDTH_TILES, footprint.width * 0.6);
    const doorDepth = Math.min(BUILDING_DOOR_DEPTH_TILES, facadeHeight);
    context.fillStyle = this.palette.buildingDoor;
    this.fillRect(
      footprint.x + (footprint.width - doorWidth) / 2,
      footprint.y + footprint.height - doorDepth,
      doorWidth,
      doorDepth,
    );
    this.counters.buildingDoors += 1;

    this.drawBuildingDetails(building, palette, {
      facadeTop,
      facadeHeight,
      roofX,
      roofY,
      roofWidth,
      roofHeight,
      doorWidth,
      doorDepth,
    });
  }

  /** Kind-specific silhouette details, drawn on top of the block above. */
  private drawBuildingDetails(
    building: Building,
    palette: BuildingPalette,
    shape: {
      readonly facadeTop: number;
      readonly facadeHeight: number;
      readonly roofX: number;
      readonly roofY: number;
      readonly roofWidth: number;
      readonly roofHeight: number;
      readonly doorWidth: number;
      readonly doorDepth: number;
    },
  ): void {
    const context = this.ctx;
    const footprint = building.footprint;
    const centreX = footprint.x + footprint.width / 2;
    const counters = this.counters;

    switch (building.kind) {
      case 'house': {
        // Pitched roof: a gable above the lifted roof plate.
        const ridge = shape.roofY - Math.min(0.4, shape.roofWidth * 0.35);
        context.fillStyle = palette.trim;
        this.beginPath();
        this.moveTo(shape.roofX, shape.roofY);
        this.lineTo(centreX, ridge);
        this.lineTo(shape.roofX + shape.roofWidth, shape.roofY);
        this.closePath();
        this.fill();
        counters.buildingDetails += 1;
        break;
      }
      case 'apartment': {
        // Two balcony bars across the facade plus a roof railing.
        context.fillStyle = palette.trim;
        const barWidth = footprint.width - 0.2;
        this.fillRect(footprint.x + 0.1, shape.facadeTop + shape.facadeHeight * 0.25, barWidth, 0.06);
        this.fillRect(footprint.x + 0.1, shape.facadeTop + shape.facadeHeight * 0.6, barWidth, 0.06);
        context.strokeStyle = palette.roof;
        context.lineWidth = 0.06;
        this.beginPath();
        this.moveTo(shape.roofX, shape.roofY);
        this.lineTo(shape.roofX + shape.roofWidth, shape.roofY);
        this.stroke();
        counters.buildingDetails += 3;
        break;
      }
      case 'office': {
        // Glass core running up the block plus a roof antenna.
        context.fillStyle = palette.trim;
        this.fillRect(centreX - 0.16, shape.roofY, 0.32, shape.roofHeight + shape.facadeHeight);
        context.strokeStyle = palette.trim;
        context.lineWidth = 0.05;
        this.beginPath();
        this.moveTo(centreX, shape.roofY);
        this.lineTo(centreX, shape.roofY - 0.5);
        this.stroke();
        counters.buildingDetails += 2;
        break;
      }
      case 'shop': {
        // Awning stripes over the door plus a sign board.
        const awningWidth = Math.min(footprint.width * 0.8, shape.doorWidth * 2.4);
        context.fillStyle = palette.trim;
        this.fillRect(centreX - awningWidth / 2, shape.facadeTop + shape.facadeHeight * 0.15, awningWidth, 0.12);
        context.fillStyle = palette.roof;
        this.fillRect(centreX - awningWidth / 2, shape.facadeTop + shape.facadeHeight * 0.34, awningWidth, 0.1);
        counters.buildingDetails += 2;
        break;
      }
      case 'factory': {
        // Sawtooth roof line plus two chimneys.
        context.fillStyle = palette.trim;
        this.fillRect(shape.roofX + 0.1, shape.roofY - 0.42, 0.14, 0.42);
        this.fillRect(shape.roofX + shape.roofWidth * 0.62, shape.roofY - 0.52, 0.16, 0.52);
        context.strokeStyle = palette.roof;
        context.lineWidth = 0.05;
        this.beginPath();
        this.moveTo(shape.roofX, shape.roofY);
        this.lineTo(shape.roofX + shape.roofWidth * 0.34, shape.roofY - 0.22);
        this.lineTo(shape.roofX + shape.roofWidth * 0.68, shape.roofY);
        this.lineTo(shape.roofX + shape.roofWidth, shape.roofY - 0.22);
        this.stroke();
        counters.buildingDetails += 3;
        break;
      }
      case 'warehouse': {
        // Wide roller door and a flat ridge line.
        context.fillStyle = palette.trim;
        this.fillRect(footprint.x + footprint.width * 0.2, shape.facadeTop, footprint.width * 0.6, shape.facadeHeight);
        context.strokeStyle = palette.roof;
        context.lineWidth = 0.06;
        this.beginPath();
        this.moveTo(shape.roofX, shape.roofY + shape.roofHeight);
        this.lineTo(shape.roofX + shape.roofWidth, shape.roofY + shape.roofHeight);
        this.stroke();
        counters.buildingDetails += 2;
        break;
      }
      case 'school': {
        // Flagpole and an entrance step.
        context.fillStyle = palette.trim;
        this.fillRect(centreX - 0.22, shape.roofY - 0.6, 0.06, 0.6);
        this.fillRect(
          centreX - shape.doorWidth,
          footprint.y + footprint.height - shape.doorDepth,
          shape.doorWidth * 2,
          shape.doorDepth * 0.4,
        );
        counters.buildingDetails += 2;
        break;
      }
      case 'hospital': {
        // Red cross on the roof plate.
        context.fillStyle = '#e05c5c';
        this.fillRect(centreX - 0.06, shape.roofY + shape.roofHeight * 0.15, 0.12, shape.roofHeight * 0.7);
        this.fillRect(shape.roofX + shape.roofWidth * 0.2, shape.roofY + shape.roofHeight * 0.45, shape.roofWidth * 0.6, 0.12);
        counters.buildingDetails += 2;
        break;
      }
      case 'civic': {
        // Dome plus three columns.
        context.fillStyle = palette.roof;
        this.beginPath();
        this.arc(centreX, shape.roofY + shape.roofHeight * 0.1, Math.min(0.4, shape.roofWidth * 0.4), Math.PI, TAU);
        this.fill();
        context.strokeStyle = palette.trim;
        context.lineWidth = 0.06;
        this.beginPath();
        for (let column = 0; column < 3; column += 1) {
          const columnX = footprint.x + (footprint.width * (column + 1)) / 4;
          this.moveTo(columnX, shape.facadeTop);
          this.lineTo(columnX, footprint.y + footprint.height);
        }
        this.stroke();
        counters.buildingDetails += 2;
        break;
      }
      case 'park': {
        break;
      }
    }
  }

  /**
   * Parks are lawn, path and trees rather than a built block. Like built
   * buildings, the lawn honours the entity's own colour when it has one.
   */
  private drawPark(building: Building, palette: BuildingPalette): void {
    const context = this.ctx;
    const footprint = building.footprint;
    const centreX = footprint.x + footprint.width / 2;
    const centreY = footprint.y + footprint.height / 2;
    context.fillStyle = building.color && building.color.length > 0 ? building.color : palette.wall;
    this.fillRect(footprint.x, footprint.y, footprint.width, footprint.height);
    context.fillStyle = palette.roof;
    this.ellipse(centreX, centreY, footprint.width * 0.32, footprint.height * 0.32, 0, 0, TAU);
    this.fill();
    this.beginPath();
    this.ellipse(centreX - footprint.width * 0.28, centreY + footprint.height * 0.2, 0.28, 0.28, 0, 0, TAU);
    this.fill();
    this.beginPath();
    this.ellipse(centreX + footprint.width * 0.3, centreY - footprint.height * 0.18, 0.24, 0.24, 0, 0, TAU);
    this.fill();
    context.strokeStyle = palette.trim;
    context.lineWidth = 0.12;
    this.beginPath();
    this.moveTo(footprint.x + 0.1, footprint.y + footprint.height - 0.2);
    this.lineTo(centreX, centreY - footprint.height * 0.1);
    this.lineTo(footprint.x + footprint.width - 0.1, footprint.y + 0.2);
    this.stroke();
    this.counters.buildingDetails += 4;
  }

  /**
   * Lit windows: one batched fill for the whole skyline, alpha driven by
   * {@link LightingSample.windowGlow}. At noon the layer is skipped entirely, so
   * a daylight frame issues no window draw at all.
   */
  private drawWindows(bounds: TileRect, sample: LightingSample, layers: RenderLayer[]): void {
    const glow = clamp01(sample.windowGlow);
    if (glow <= WINDOW_GLOW_THRESHOLD) {
      this.counters.windowsLit = 0;
      return;
    }
    const context = this.ctx;
    const counters = this.counters;
    const buildings = this.world.buildings;
    let lit = 0;

    this.beginPath();
    for (let index = 0; index < buildings.length; index += 1) {
      const building = buildings[index];
      if (building.kind === 'park') {
        continue;
      }
      const footprint = building.footprint;
      if (!rectIntersects(footprint, bounds)) {
        continue;
      }
      const lift = clampNumber(
        (building.floors - 1) * BUILDING_ROOF_LIFT_PER_FLOOR,
        0,
        BUILDING_MAX_ROOF_LIFT_FLOORS * BUILDING_ROOF_LIFT_PER_FLOOR,
      );
      const inset = Math.min(BUILDING_INSET_TILES, Math.min(footprint.width, footprint.height) / 3);
      const bandTop = footprint.y + footprint.height - (inset + lift);
      const bandHeight = inset + lift;
      const columns = clampNumber(
        Math.floor((footprint.width - 0.2) / WINDOW_COLUMN_SPACING_TILES),
        1,
        WINDOW_COLUMNS_MAX,
      );
      const rows = clampNumber(
        Math.min(building.floors, WINDOW_ROWS_MAX, Math.floor(bandHeight / WINDOW_HEIGHT_TILES)),
        1,
        WINDOW_ROWS_MAX,
      );
      const chance = WINDOW_LIT_CHANCE[building.kind] * clamp01(glow * WINDOW_GLOW_RAMP);
      for (let column = 0; column < columns; column += 1) {
        const x = footprint.x + ((column + 0.5) * footprint.width) / columns - WINDOW_WIDTH_TILES / 2;
        for (let row = 0; row < rows; row += 1) {
          const y = bandTop + ((row + 0.5) * bandHeight) / rows - WINDOW_HEIGHT_TILES / 2;
          if (hashUnit(index + 1, column + 1, row + 1) > chance) {
            continue;
          }
          this.rect(x, y, WINDOW_WIDTH_TILES, WINDOW_HEIGHT_TILES);
          lit += 1;
        }
      }
    }

    if (lit > 0) {
      context.globalAlpha = glow * WINDOW_GLOW_ALPHA;
      context.fillStyle = this.palette.windowGlow;
      this.fill();
      context.globalAlpha = 1;
      layers.push('windows');
    }
    counters.windowsLit = lit;
  }

  /**
   * Street lamps at signalised nodes: glow pools first, then poles and heads.
   * The whole layer is skipped when {@link LightingSample.streetlightIntensity}
   * is dark, which is what makes noon frames differ from night frames.
   */
  private drawStreetlights(bounds: TileRect, sample: LightingSample, layers: RenderLayer[]): void {
    const intensity = clamp01(sample.streetlightIntensity);
    if (intensity <= STREETLIGHT_GLOW_THRESHOLD) {
      this.counters.streetlights = 0;
      return;
    }
    const context = this.ctx;
    const nodes = this.world.nodes;
    let lamps = 0;
    let culled = 0;

    this.beginPath();
    for (const node of nodes) {
      if (!isStreetlightNode(node)) {
        continue;
      }
      if (!this.pointIntersects(node.x, node.y, STREETLIGHT_GLOW_RADIUS, bounds)) {
        culled += 1;
        continue;
      }
      this.arc(
        node.x + STREETLIGHT_POLE_OFFSET,
        node.y - STREETLIGHT_POLE_HEIGHT,
        STREETLIGHT_GLOW_RADIUS * (0.6 + intensity * 0.4),
        0,
        TAU,
      );
      lamps += 1;
    }
    this.culled.roadNodes = culled;
    if (lamps === 0) {
      this.counters.streetlights = 0;
      return;
    }

    context.globalAlpha = intensity * STREETLIGHT_GLOW_ALPHA;
    context.fillStyle = this.palette.streetlightGlow;
    this.fill();
    context.globalAlpha = 1;

    context.strokeStyle = this.palette.streetlightLamp;
    context.lineWidth = STREETLIGHT_POLE_WIDTH_TILES;
    this.beginPath();
    for (const node of nodes) {
      if (!isStreetlightNode(node)) {
        continue;
      }
      if (!this.pointIntersects(node.x, node.y, STREETLIGHT_GLOW_RADIUS, bounds)) {
        continue;
      }
      this.moveTo(node.x, node.y);
      this.lineTo(node.x + STREETLIGHT_POLE_OFFSET, node.y - STREETLIGHT_POLE_HEIGHT);
    }
    this.stroke();

    this.beginPath();
    for (const node of nodes) {
      if (!isStreetlightNode(node)) {
        continue;
      }
      if (!this.pointIntersects(node.x, node.y, STREETLIGHT_GLOW_RADIUS, bounds)) {
        continue;
      }
      this.arc(
        node.x + STREETLIGHT_POLE_OFFSET,
        node.y - STREETLIGHT_POLE_HEIGHT,
        STREETLIGHT_HEAD_RADIUS,
        0,
        TAU,
      );
    }
    this.fill();

    this.counters.streetlights = lamps;
    layers.push('streetlights');
  }

  /**
   * Citizens: body tinted by activity, head, mood ring and activity badge, with
   * a dashed ring while travelling. Citizens inside a building stand along its
   * street frontage at a reduced alpha, so the whole population stays visible in
   * the city view at every hour.
   */
  private drawCitizens(layers: RenderLayer[]): void {
    if (this.citizenCount === 0) {
      return;
    }
    const context = this.ctx;
    const counters = this.counters;
    const groups = this.citizenGroups;
    const pips = this.citizenPips;
    for (const kind of ACTIVITY_KINDS) {
      groups[kind].out.length = 0;
      groups[kind].in.length = 0;
      pips[kind].length = 0;
    }
    this.citizenHeads.length = 0;
    this.citizenTrails.length = 0;
    for (const ring of this.moodRings) {
      ring.length = 0;
    }

    let drawn = 0;
    let travelling = 0;
    for (let index = 0; index < this.citizenCount; index += 1) {
      if (!this.citizenVisible[index]) {
        continue;
      }
      const x = this.citizenAnchorX[index];
      const y = this.citizenAnchorY[index];
      const activity = this.citizenActivity[index];
      const indoors = this.citizenIndoorFlag[index];
      (indoors ? groups[activity].in : groups[activity].out).push(x, y);
      this.citizenHeads.push(x, y - CITIZEN_HEAD_OFFSET);
      pips[activity].push(x + CITIZEN_PIP_OFFSET_X, y - CITIZEN_PIP_OFFSET_Y);
      this.moodRings[moodBucket(this.citizenMood[index])].push(x, y);
      if (this.citizenTravellingFlag[index]) {
        this.citizenTrails.push(x, y);
        travelling += 1;
      }
      this.citizenActivityCounts[activity] += 1;
      drawn += 1;
    }

    if (drawn === 0) {
      counters.citizens = 0;
      return;
    }

    // Bodies, batched per activity and per indoor/outdoor alpha.
    for (const kind of ACTIVITY_KINDS) {
      const group = groups[kind];
      context.fillStyle = this.palette.citizen[kind];
      for (let pass = 0; pass < 2; pass += 1) {
        const coordinates = pass === 0 ? group.out : group.in;
        if (coordinates.length === 0) {
          continue;
        }
        context.globalAlpha = pass === 0 ? 1 : this.palette.citizenIndoorAlpha;
        this.beginPath();
        for (let index = 0; index < coordinates.length; index += 2) {
          this.arc(coordinates[index], coordinates[index + 1], CITIZEN_BODY_RADIUS, 0, TAU);
        }
        this.fill();
        context.globalAlpha = 1;
      }
    }

    // Mood rings, batched per mood bucket.
    context.lineWidth = CITIZEN_RING_WIDTH_TILES;
    for (let bucket = 0; bucket < this.moodRings.length; bucket += 1) {
      const ring = this.moodRings[bucket];
      if (ring.length === 0) {
        continue;
      }
      context.strokeStyle = this.palette.citizenRing[bucket];
      this.beginPath();
      for (let index = 0; index < ring.length; index += 2) {
        this.arc(ring[index], ring[index + 1], CITIZEN_RING_RADIUS, 0, TAU);
      }
      this.stroke();
    }

    // Travelling citizens get a dashed ring, the "on the move" cue.
    if (this.citizenTrails.length > 0) {
      this.setDash(CITIZEN_TRAVEL_DASH);
      context.strokeStyle = this.palette.citizenHead;
      context.lineWidth = CITIZEN_RING_WIDTH_TILES;
      this.beginPath();
      for (let index = 0; index < this.citizenTrails.length; index += 2) {
        this.arc(
          this.citizenTrails[index],
          this.citizenTrails[index + 1],
          CITIZEN_RING_RADIUS * 1.6,
          0,
          TAU,
        );
      }
      this.stroke();
      this.setDash(EMPTY_DASH);
    }

    // Heads, then the activity badge.
    context.fillStyle = this.palette.citizenHead;
    this.beginPath();
    for (let index = 0; index < this.citizenHeads.length; index += 2) {
      this.arc(this.citizenHeads[index], this.citizenHeads[index + 1], CITIZEN_HEAD_RADIUS, 0, TAU);
    }
    this.fill();

    for (const kind of ACTIVITY_KINDS) {
      const coordinates = pips[kind];
      if (coordinates.length === 0) {
        continue;
      }
      context.fillStyle = this.palette.citizen[kind];
      this.beginPath();
      for (let index = 0; index < coordinates.length; index += 2) {
        this.rect(
          coordinates[index] - CITIZEN_PIP_SIZE / 2,
          coordinates[index + 1] - CITIZEN_PIP_SIZE / 2,
          CITIZEN_PIP_SIZE,
          CITIZEN_PIP_SIZE,
        );
      }
      this.fill();
    }

    counters.citizens = drawn;
    counters.citizenTrails = travelling;
    counters.moodIndicators = drawn;
    counters.activityIndicators = drawn;
    layers.push('citizens');
  }

  /** Vehicles: kind-specific bodies, occupancy cue and night headlights. */
  private drawVehicles(sample: LightingSample, layers: RenderLayer[]): void {
    const count = this.vehicleList.length;
    if (count === 0) {
      this.counters.vehicles = 0;
      return;
    }
    const context = this.ctx;
    const counters = this.counters;
    const kinds = this.vehicleKindCounts;
    const night = sample.windowGlow > NIGHT_SIGNAL || sample.streetlightIntensity > NIGHT_SIGNAL;
    let drawn = 0;
    let cues = 0;
    let pips = 0;
    let headlights = 0;

    for (let index = 0; index < count; index += 1) {
      if (!this.vehicleVisible[index]) {
        continue;
      }
      const vehicle = this.vehicleList[index];
      const size = VEHICLE_SIZE[vehicle.kind];
      context.save();
      this.commandCount += 1;
      this.translate(vehicle.position.x, vehicle.position.y);
      this.rotate(vehicle.headingRadians);
      this.drawVehicleBody(vehicle, size);
      if (vehicle.occupancy > 0) {
        cues += 1;
        pips += this.drawOccupancyCue(vehicle, size);
      }
      if (night) {
        this.drawHeadlights(size);
        headlights += 1;
      }
      context.restore();
      this.commandCount += 1;
      kinds[vehicle.kind] += 1;
      drawn += 1;
    }

    counters.vehicles = drawn;
    counters.occupantCues = cues;
    counters.occupancyPips = pips;
    counters.headlights = headlights;
    if (drawn > 0) {
      layers.push('vehicles');
    }
  }

  private drawVehicleBody(vehicle: Vehicle, size: VehicleSize): void {
    const context = this.ctx;
    const halfLength = size.length / 2;
    const halfWidth = size.width / 2;
    const body =
      vehicle.color && vehicle.color.length > 0 ? vehicle.color : this.palette.vehicle[vehicle.kind];

    context.fillStyle = body;
    this.fillRect(-halfLength, -halfWidth, size.length, size.width);
    context.fillStyle = this.palette.vehicleGlass;

    switch (vehicle.kind) {
      case 'car': {
        this.fillRect(-halfLength * 0.25, -halfWidth * 0.75, size.length * 0.5, size.width * 0.75);
        this.drawWheels(size);
        break;
      }
      case 'taxi': {
        this.fillRect(-halfLength * 0.25, -halfWidth * 0.75, size.length * 0.5, size.width * 0.75);
        context.fillStyle = this.palette.occupancyHigh;
        this.fillRect(-0.1, -halfWidth - 0.09, 0.2, 0.09);
        this.drawWheels(size);
        break;
      }
      case 'bus': {
        this.fillRect(-halfLength + 0.12, -halfWidth * 0.8, size.length - 0.24, size.width * 0.8);
        context.fillStyle = this.palette.vehicleWheel;
        this.fillRect(halfLength - 0.18, -halfWidth, 0.06, size.width);
        this.drawWheels(size);
        break;
      }
      case 'truck': {
        this.fillRect(halfLength - size.length * 0.3, -halfWidth * 0.8, size.length * 0.24, size.width * 0.8);
        context.fillStyle = this.palette.vehicleWheel;
        this.fillRect(-halfLength, -halfWidth, size.length * 0.62, size.width);
        this.drawWheels(size);
        break;
      }
      case 'tram': {
        this.fillRect(-halfLength + 0.1, -halfWidth * 0.8, size.length - 0.2, size.width * 0.8);
        context.strokeStyle = this.palette.vehicleWheel;
        context.lineWidth = 0.04;
        this.beginPath();
        this.moveTo(0, -halfWidth);
        this.lineTo(0, -halfWidth - 0.3);
        this.stroke();
        this.drawWheels(size);
        break;
      }
      case 'bicycle': {
        context.strokeStyle = this.palette.vehicleWheel;
        context.lineWidth = 0.05;
        this.beginPath();
        this.arc(-halfLength * 0.6, 0, halfWidth, 0, TAU);
        this.arc(halfLength * 0.6, 0, halfWidth, 0, TAU);
        this.stroke();
        context.strokeStyle = body;
        this.beginPath();
        this.moveTo(-halfLength * 0.6, 0);
        this.lineTo(halfLength * 0.6, 0);
        this.stroke();
        break;
      }
    }
  }

  private drawWheels(size: VehicleSize): void {
    const context = this.ctx;
    context.fillStyle = this.palette.vehicleWheel;
    const halfLength = size.length / 2;
    const halfWidth = size.width / 2;
    const wheelWidth = Math.min(0.22, size.length * 0.18);
    this.fillRect(-halfLength * 0.7, -halfWidth - 0.04, wheelWidth, 0.07);
    this.fillRect(halfLength * 0.5, -halfWidth - 0.04, wheelWidth, 0.07);
    this.fillRect(-halfLength * 0.7, halfWidth - 0.03, wheelWidth, 0.07);
    this.fillRect(halfLength * 0.5, halfWidth - 0.03, wheelWidth, 0.07);
  }

  /** Occupancy cue: a bar scaled by load plus up to four rider pips. */
  private drawOccupancyCue(vehicle: Vehicle, size: VehicleSize): number {
    const context = this.ctx;
    const ratio = clamp01(vehicle.occupancy / Math.max(1, vehicle.capacity));
    const halfLength = size.length / 2;
    const halfWidth = size.width / 2;
    context.fillStyle = ratio <= 0.5 ? this.palette.occupancyLow : this.palette.occupancyHigh;
    this.fillRect(
      -halfLength + size.length * 0.1,
      -halfWidth + size.width * 0.2,
      Math.max(0.06, size.length * 0.8 * ratio),
      Math.max(0.04, size.width * 0.22),
    );
    const pips = Math.min(vehicle.occupancy, MAX_OCCUPANCY_PIPS);
    for (let pip = 0; pip < pips; pip += 1) {
      this.rect(-0.12 + pip * 0.08, -halfWidth - 0.08, 0.05, 0.05);
    }
    if (pips > 0) {
      this.fill();
    }
    return pips;
  }

  private drawHeadlights(size: VehicleSize): void {
    const context = this.ctx;
    const halfWidth = size.width / 2;
    const nose = size.length / 2;
    context.globalAlpha = 0.32;
    context.fillStyle = this.palette.vehicleHeadlight;
    this.beginPath();
    this.moveTo(nose, -halfWidth * 0.6);
    this.lineTo(nose + HEADLIGHT_BEAM_TILES, -halfWidth * 2.1);
    this.lineTo(nose + HEADLIGHT_BEAM_TILES, halfWidth * 2.1);
    this.lineTo(nose, halfWidth * 0.6);
    this.closePath();
    this.fill();
    context.globalAlpha = 1;
  }

  /** Ambient veil from {@link LightingSample.ambient}, drawn over everything. */
  private drawAmbient(sample: LightingSample, layers: RenderLayer[]): void {
    const strength = clamp01(sample.ambient.strength);
    if (strength <= 0) {
      return;
    }
    this.applyScreenTransform();
    const context = this.ctx;
    context.fillStyle = colorToCssWithAlpha(sample.ambient.color, strength);
    this.fillRect(0, 0, this.surfaceWidthValue, this.surfaceHeightValue);
    this.counters.ambientTint = 1;
    layers.push('ambient');
  }

  /** Air haze from {@link LightingSample.haze}, the last layer of a frame. */
  private drawHaze(sample: LightingSample, layers: RenderLayer[]): void {
    const haze = clamp01(sample.haze);
    if (haze <= HAZE_THRESHOLD) {
      return;
    }
    this.applyScreenTransform();
    const context = this.ctx;
    context.fillStyle = colorToCssWithAlpha(this.palette.haze, haze * HAZE_MAX_ALPHA);
    this.fillRect(0, 0, this.surfaceWidthValue, this.surfaceHeightValue);
    this.counters.haze = 1;
    layers.push('haze');
  }

  /* -------------------------------------------------------------- private -- */

  private get ctx(): CanvasRenderingContext2D {
    return this.contextRef as CanvasRenderingContext2D;
  }

  private visibleTileRange(bounds: TileRect): { x0: number; y0: number; x1: number; y1: number } {
    const world = this.world;
    const range = this.tileRange;
    range.x0 = clampNumber(Math.floor(bounds.x), 0, world.widthInTiles);
    range.y0 = clampNumber(Math.floor(bounds.y), 0, world.heightInTiles);
    range.x1 = clampNumber(Math.ceil(bounds.x + bounds.width), 0, world.widthInTiles);
    range.y1 = clampNumber(Math.ceil(bounds.y + bounds.height), 0, world.heightInTiles);
    return range;
  }

  /** Puck test used for citizens, vehicles and street lamps. */
  private pointIntersects(x: number, y: number, radius: number, bounds: TileRect): boolean {
    const box = this.pointBox;
    box.x = x - radius;
    box.y = y - radius;
    box.width = radius * 2;
    box.height = radius * 2;
    return rectIntersects(box, bounds);
  }

  private assertUsable(operation: string): void {
    if (this.disposedFlag) {
      throw new Error(`CityRenderer.${operation}() called after dispose()`);
    }
  }

  /* Recording-friendly canvas primitives: each one is exactly one call. */

  private save(): void {
    this.ctx.save();
    this.commandCount += 1;
  }

  private restore(): void {
    this.ctx.restore();
    this.commandCount += 1;
  }

  private beginPath(): void {
    this.ctx.beginPath();
    this.commandCount += 1;
  }

  private closePath(): void {
    this.ctx.closePath();
    this.commandCount += 1;
  }

  private rect(x: number, y: number, width: number, height: number): void {
    this.ctx.rect(x, y, width, height);
    this.commandCount += 1;
  }

  private fillRect(x: number, y: number, width: number, height: number): void {
    this.ctx.fillRect(x, y, width, height);
    this.commandCount += 1;
  }

  private strokeRect(x: number, y: number, width: number, height: number): void {
    this.ctx.strokeRect(x, y, width, height);
    this.commandCount += 1;
  }

  private clearRect(x: number, y: number, width: number, height: number): void {
    this.ctx.clearRect(x, y, width, height);
    this.commandCount += 1;
  }

  private moveTo(x: number, y: number): void {
    this.ctx.moveTo(x, y);
    this.commandCount += 1;
  }

  private lineTo(x: number, y: number): void {
    this.ctx.lineTo(x, y);
    this.commandCount += 1;
  }

  private arc(x: number, y: number, radius: number, start: number, end: number): void {
    this.ctx.arc(x, y, radius, start, end);
    this.commandCount += 1;
  }

  private ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    start: number,
    end: number,
  ): void {
    this.ctx.ellipse(x, y, radiusX, radiusY, rotation, start, end);
    this.commandCount += 1;
  }

  private fill(): void {
    this.ctx.fill();
    this.commandCount += 1;
  }

  private stroke(): void {
    this.ctx.stroke();
    this.commandCount += 1;
  }

  private fillText(text: string, x: number, y: number): void {
    this.ctx.fillText(text, x, y);
    this.commandCount += 1;
  }

  private setDash(segments: readonly number[]): void {
    this.ctx.setLineDash(segments);
    this.commandCount += 1;
  }

  private translate(x: number, y: number): void {
    this.ctx.translate(x, y);
    this.commandCount += 1;
  }

  private rotate(angle: number): void {
    this.ctx.rotate(angle);
    this.commandCount += 1;
  }

  private setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ctx.setTransform(a, b, c, d, e, f);
    this.commandCount += 1;
  }
}

/* -------------------------------------------------------------- vehicles -- */

/** Local-space body size of one vehicle kind, in world tiles. */
interface VehicleSize {
  readonly length: number;
  readonly width: number;
}

const VEHICLE_SIZE: Record<VehicleKind, VehicleSize> = {
  car: { length: 1.0, width: 0.5 },
  taxi: { length: 1.0, width: 0.5 },
  bus: { length: 1.9, width: 0.58 },
  truck: { length: 1.8, width: 0.62 },
  bicycle: { length: 0.5, width: 0.24 },
  tram: { length: 2.2, width: 0.6 },
};

/** Chance a window is lit at full {@link LightingSample.windowGlow}, per kind. */
const WINDOW_LIT_CHANCE: Record<BuildingKind, number> = {
  house: 0.45,
  apartment: 0.55,
  office: 0.35,
  shop: 0.75,
  factory: 0.3,
  warehouse: 0.25,
  school: 0.4,
  hospital: 0.8,
  park: 0,
  civic: 0.6,
};

/**
 * Creates a renderer for a world and camera. Pass the live systems and the
 * lighting component to draw the full city:
 *
 * ```ts
 * const renderer = createCityRenderer({ world, camera, context, citizens, vehicles, lighting });
 * renderer.attach();
 * renderer.frame();
 * ```
 */
export function createCityRenderer(options: CityRendererOptions): CityRenderer {
  return new CityRenderer(options);
}
