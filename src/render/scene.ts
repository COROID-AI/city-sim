/**
 * The neon holographic factory floor: the world the rest of Coroid stands on.
 *
 * `createWorld` builds one procedural set — no textures, models or fonts are
 * fetched, and nothing touches the network:
 *
 *  - **Backdrop.** `scene.background` becomes an in-memory vertical gradient from
 *    `#0b1026` at the horizon to `#05060f` at the zenith, and `scene.fog` becomes
 *    an exponential depth fog in the same indigo family, so distant geometry
 *    dissolves instead of stopping at a hard edge.
 *  - **Emissive grid.** One shader plane carries the floor: minor and major
 *    lines, travelling energy bands and a radial pulse ring, all anchored in
 *    *world* space so they parallax with the camera. The shader fades the grid
 *    into the fog itself, which keeps the floor readable out to the horizon.
 *  - **Lighting.** A cool hemisphere fill, one key direction light and three
 *    point lights (holo core, magenta service bay, cyan far bay).
 *  - **Factory frame.** Corner towers with emissive strips and a ring of service
 *    machines. Every instance reuses one shared geometry, as the resource rules
 *    require.
 *  - **State-driven actors.** One pylon per agent lane in `state.lanes` and one
 *    beacon per gate in `state.verification`, coloured by the mandatory palettes
 *    in this module. `applyState` re-codes them in place; only a change in the
 *    *shape* of the plan rebuilds the actor groups.
 *  - **Post chain.** `./effects` supplies the bloom halos, the god rays and the
 *    camera-locked screen pass; the world registers the floor's emissive anchors
 *    with it and keeps them live, so halos follow lane load and gate status.
 *
 * The world owns nothing outside its own subtree except the two scene properties
 * it borrows (`background` and `fog`), which `dispose()` restores — so a world
 * can be torn down without disturbing another module's scene state.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RGBAFormat,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';

import { createRng } from '../game/loop';
import type { GameSystem, SystemContext, SystemUpdate } from '../game/systems';
import {
  collectEmissiveAnchors,
  createPostChain,
  type EmissiveAnchor,
  type PostChain,
  type PostQualityPreset,
  DEFAULT_POST_QUALITY,
} from './effects';
import type { RenderAdapter } from './renderer';
import type { DeepReadonly, GameState, LaneKind, TaskStatus } from '../sim/state';

/* -------------------------------------------------------------------------- */
/* Art direction constants                                                    */
/* -------------------------------------------------------------------------- */

/** Object names the world exposes, so tests, tools and picking can address it. */
export const WORLD_NAMES = {
  root: 'world',
  floor: 'factory-floor-plate',
  grid: 'factory-grid',
  horizon: 'factory-horizon-rings',
  core: 'factory-core',
  coreColumn: 'factory-core-column',
  coreDisc: 'factory-core-disc',
  frame: 'factory-frame',
  towers: 'factory-towers',
  machines: 'factory-machines',
  landmarks: 'factory-landmarks',
  lights: 'factory-lights',
  lanes: 'factory-lane-pylons',
  gates: 'factory-gate-beacons',
} as const;

/** Side length of the factory floor, world units. */
export const FLOOR_SIZE = 88;
/** Minor grid spacing, world units. */
export const GRID_CELL = 4;
/** Every Nth line is a major line. */
export const GRID_MAJOR_EVERY = 4;

/** Backdrop gradient, per the mandatory art direction. */
export const WORLD_BACKDROP = {
  /** `#0b1026` — the horizon band. */
  horizon: 0x0b1026,
  /** `#05060f` — the near-black zenith. */
  zenith: 0x05060f,
} as const;

/** Depth fog: same indigo family, dense enough to read as real atmosphere. */
export const WORLD_FOG = {
  color: 0x070c1c,
  density: 0.0165,
} as const;

/** Default seed for the (deterministic) frame prop placement. */
export const WORLD_SEED = 20260918;

/** Deterministic anchors that make the grid itself bloom, one per quadrant. */
export const GRID_GLOW_RADIUS = 3.4;

/** Lane palette: one colour per lane kind, used by the pylons and the legend. */
export const LANE_COLORS: Readonly<Record<LaneKind, number>> = {
  discovery: 0x8fd4ff,
  build: 0x35f0ff,
  verify: 0xffc15c,
  integrate: 0xff4fd8,
  observe: 0x59ff9b,
};

/** Gate palette: the shared task lifecycle, matching the plan graph statuses. */
export const GATE_COLORS: Readonly<Record<TaskStatus, number>> = {
  pending: 0x4f6d8c,
  running: 0xffc15c,
  passed: 0x59ff9b,
  failed: 0xff2d6f,
  blocked: 0xff2d6f,
};

/** Longest delta a single `update` integrates, so a hitch cannot jump the show. */
export const MAX_WORLD_STEP_MS = 100;

/**
 * Release every geometry, material and texture in a subtree **exactly once**.
 *
 * `disposeRenderResources` in the foundation adapter de-duplicates materials but
 * disposes a geometry once per referencing mesh. The floor deliberately shares
 * one geometry across many instances, so this sweep de-duplicates both and
 * therefore reports — and performs — each release once.
 */
function disposeWorldResources(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const material = mesh.material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      materials.add(entry);
      for (const value of Object.values(entry as unknown as Record<string, unknown>)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}

/** Where lane pylons stand (they face the core from the -Z edge). */
const LANE_ROW_Z = -16;
const LANE_SLOT_SPACING = 5.4;
/** Where verification beacons stand. */
const GATE_ROW_Z = 30;
const GATE_SLOT_SPACING = 6.6;

/* -------------------------------------------------------------------------- */
/* Procedural backdrop                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Build the indigo backdrop gradient.
 *
 * A 1 × `height` RGBA texel field, generated in memory and used straight as
 * `scene.background`: no file, no network. The bytes are the authored sRGB
 * channels (so the texture decodes to exactly the art-directed hex values) and
 * rows run bottom-up, so row 0 is the horizon band and the last row is the
 * near-black zenith.
 */
export function createBackdropTexture(height = 256): DataTexture {
  const rows = Math.max(8, Math.floor(height));
  const data = new Uint8Array(rows * 4);
  const horizon = sRGBChannels(WORLD_BACKDROP.horizon);
  const zenith = sRGBChannels(WORLD_BACKDROP.zenith);

  for (let y = 0; y < rows; y += 1) {
    // Ease the ramp so most of the frame stays deep and the glow hugs the horizon.
    const t = Math.pow(y / (rows - 1), 0.72);
    const index = y * 4;
    data[index] = Math.round(horizon[0] + (zenith[0] - horizon[0]) * t);
    data[index + 1] = Math.round(horizon[1] + (zenith[1] - horizon[1]) * t);
    data[index + 2] = Math.round(horizon[2] + (zenith[2] - horizon[2]) * t);
    data[index + 3] = 255;
  }

  const texture = new DataTexture(data, 1, rows, RGBAFormat, UnsignedByteType);
  texture.name = 'world-backdrop';
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Authored sRGB channels of a packed `0xrrggbb` colour, untouched by colour management. */
function sRGBChannels(hex: number): readonly [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/* -------------------------------------------------------------------------- */
/* Floor grid shader                                                          */
/* -------------------------------------------------------------------------- */

const GRID_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * Height-less grid shader: two line weights, three travelling energy pulses and
 * a manual exponential fog fade that matches the scene's `FogExp2` density.
 */
const GRID_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uCell;
  uniform float uMajorEvery;
  uniform float uPulse;
  uniform float uOpacity;
  uniform float uExtent;
  uniform float uFogDensity;
  uniform vec3 uMinorColor;
  uniform vec3 uMajorColor;
  uniform vec3 uPulseColor;
  varying vec3 vWorld;

  float lineMask(vec2 coord, float spacing, float width) {
    vec2 cells = coord / spacing;
    vec2 offset = abs(fract(cells - 0.5) - 0.5) * spacing;
    return 1.0 - smoothstep(0.0, width, min(offset.x, offset.y));
  }

  void main() {
    // World-space coordinates: the pattern (and therefore the parallax) belongs
    // to the floor, not to the screen.
    vec2 p = vWorld.xz;

    float minor = lineMask(p, uCell, 0.055);
    float major = lineMask(p, uCell * uMajorEvery, 0.2);

    float t = uTime * 0.06;
    float bandX = smoothstep(0.86, 1.0, 1.0 - abs(fract(p.x * 0.02 - t) - 0.5) * 2.0);
    float bandZ = smoothstep(0.86, 1.0, 1.0 - abs(fract(p.y * 0.016 - t * 0.7) - 0.5) * 2.0);
    float ripple = exp(-pow((length(p) - mod(uTime * 5.0, 46.0)) * 0.28, 2.0));
    float pulse = clamp(bandX * 0.6 + bandZ * 0.45 + ripple * 0.9, 0.0, 1.0) * uPulse;

    float edgeFade = 1.0 - smoothstep(uExtent * 0.62, uExtent, length(p));
    float fog = 1.0 - exp(-pow(uFogDensity * distance(vWorld, cameraPosition), 2.0));

    vec3 color = uMinorColor * minor * 0.5 + uMajorColor * major * 0.85 + uPulseColor * pulse;
    color *= edgeFade * uOpacity * (1.0 - fog * 0.9);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/* -------------------------------------------------------------------------- */
/* World                                                                      */
/* -------------------------------------------------------------------------- */

export interface WorldOptions {
  /** Adapter the world is built over. Its scene root and camera are reused. */
  adapter: RenderAdapter;
  /** Optional starting state; `applyState` can be called at any time. */
  state?: DeepReadonly<GameState> | null;
  /** Post-processing tier. Defaults to `DEFAULT_POST_QUALITY`. */
  preset?: PostQualityPreset;
  /** Seed for the deterministic frame prop placement. */
  seed?: number;
  /** Viewport size, forwarded to the post chain. */
  width?: number;
  height?: number;
}

/** A lane pylon: the emissive bar is the part that blooms. */
interface LaneActor {
  readonly group: Group;
  readonly bar: Mesh<BoxGeometry, MeshStandardMaterial>;
  readonly material: MeshStandardMaterial;
  /** Live bloom anchor for the bar, when the chain accepted it. */
  anchor: EmissiveAnchor | null;
  /** Unpulsed emissive intensity, so `update` can breathe around it. */
  baseIntensity: number;
}

/** A verification beacon: one translucent column per gate. */
interface GateActor {
  readonly beacon: Mesh<CylinderGeometry, MeshStandardMaterial>;
  readonly material: MeshStandardMaterial;
  anchor: EmissiveAnchor | null;
  /** Unpulsed emissive intensity, so `update` can breathe around it. */
  baseIntensity: number;
  /** Unpulsed column opacity. */
  baseOpacity: number;
}

export interface World {
  /** World subtree, already attached to the adapter scene. */
  readonly root: Group;
  readonly adapter: RenderAdapter;
  readonly post: PostChain;
  readonly preset: PostQualityPreset;
  /** Backdrop gradient the world installed as `scene.background`. */
  readonly backdrop: DataTexture;
  /** Depth fog the world installed as `scene.fog`. */
  readonly fog: FogExp2;
  /** The emissive grid plane. */
  readonly grid: Mesh<PlaneGeometry, ShaderMaterial>;
  /** Lane pylons currently standing on the floor. */
  readonly laneCount: number;
  /** Verification beacons currently standing on the floor. */
  readonly gateCount: number;
  /** Seconds of world time integrated so far. */
  readonly time: number;
  /** Last state snapshot applied, or `null` before the first `applyState`. */
  readonly state: DeepReadonly<GameState> | null;
  readonly disposed: boolean;
  setPreset(preset: PostQualityPreset): void;
  /** Re-code the lane pylons, gate beacons, core and grid from a snapshot. */
  applyState(state: DeepReadonly<GameState>): void;
  /** Track the viewport for the post chain. */
  resize(width: number, height: number, pixelRatio?: number): void;
  /**
   * Advance the floor. Call **after** the camera rig has updated for the frame:
   * the post chain places its screen pass on the camera pose it reads here.
   */
  update(deltaMs: number, elapsedMs?: number): void;
  dispose(): void;
}

/**
 * Build the neon holographic factory floor over a render adapter.
 *
 * Throws when handed a disposed adapter: the world borrows the adapter's scene
 * root, camera and dispose bookkeeping, so it cannot outlive it.
 */
export function createWorld(options: WorldOptions): World {
  const adapter = options.adapter;
  if (adapter.disposed) {
    throw new Error('[coroid] createWorld received an already disposed render adapter');
  }

  const scene = adapter.scene;
  const seed = options.seed ?? WORLD_SEED;
  const rng = createRng(seed);

  const root = new Group();
  root.name = WORLD_NAMES.root;
  scene.add(root);

  /* --------------------------------------------------- backdrop and depth */
  const previousBackground = scene.background;
  const previousFog = scene.fog;
  const backdrop = createBackdropTexture();
  const fog = new FogExp2(new Color(WORLD_FOG.color), WORLD_FOG.density);
  scene.background = backdrop;
  scene.fog = fog;

  /* --------------------------------------------------------- floor + grid */
  const plateGeometry = new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, 1, 1);
  const plateMaterial = new MeshStandardMaterial({
    color: 0x060a14,
    metalness: 0.9,
    roughness: 0.32,
  });
  const plate = new Mesh(plateGeometry, plateMaterial);
  plate.name = WORLD_NAMES.floor;
  plate.rotation.x = -Math.PI / 2;
  root.add(plate);

  const gridUniforms = {
    uTime: { value: 0 },
    uCell: { value: GRID_CELL },
    uMajorEvery: { value: GRID_MAJOR_EVERY },
    uPulse: { value: 0.6 },
    uOpacity: { value: 0.95 },
    uExtent: { value: FLOOR_SIZE / 2 },
    uFogDensity: { value: WORLD_FOG.density },
    uMinorColor: { value: new Color(0x0f6a86) },
    uMajorColor: { value: new Color(0x35f0ff) },
    uPulseColor: { value: new Color(0x9ffbff) },
  };
  const gridMaterial = new ShaderMaterial({
    uniforms: gridUniforms,
    vertexShader: GRID_VERTEX_SHADER,
    fragmentShader: GRID_FRAGMENT_SHADER,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const gridGeometry = new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, 1, 1);
  const grid = new Mesh(gridGeometry, gridMaterial);
  grid.name = WORLD_NAMES.grid;
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.03;
  root.add(grid);

  /* ----------------------------------------------------------- horizon rings */
  const horizon = new Group();
  horizon.name = WORLD_NAMES.horizon;
  const horizonMaterial = new MeshBasicMaterial({
    color: 0x35f0ff,
    transparent: true,
    opacity: 0.24,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const outerRingGeometry = new RingGeometry(FLOOR_SIZE / 2 - 0.7, FLOOR_SIZE / 2, 256);
  const innerRingGeometry = new RingGeometry(FLOOR_SIZE * 0.43 - 0.35, FLOOR_SIZE * 0.43, 256);
  const outerRing = new Mesh(outerRingGeometry, horizonMaterial);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.06;
  const innerRing = new Mesh(innerRingGeometry, horizonMaterial);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.05;
  horizon.add(outerRing, innerRing);
  root.add(horizon);

  /* ---------------------------------------------------------------- core */
  const core = new Group();
  core.name = WORLD_NAMES.core;
  const coreBaseGeometry = new CylinderGeometry(3.6, 4.2, 0.6, 64);
  const coreBaseMaterial = new MeshStandardMaterial({
    color: 0x0b1626,
    metalness: 0.9,
    roughness: 0.22,
    emissive: 0x0d4657,
    emissiveIntensity: 1.1,
  });
  const coreBase = new Mesh(coreBaseGeometry, coreBaseMaterial);
  coreBase.position.y = 0.3;
  const coreColumnGeometry = new CylinderGeometry(2.6, 3.4, 18, 64, 1, true);
  const coreColumnMaterial = new MeshBasicMaterial({
    color: 0x35f0ff,
    transparent: true,
    opacity: 0.075,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const coreColumn = new Mesh(coreColumnGeometry, coreColumnMaterial);
  coreColumn.name = WORLD_NAMES.coreColumn;
  coreColumn.position.y = 9.4;
  const coreDiscGeometry = new CircleGeometry(3.2, 64);
  const coreDiscMaterial = new MeshBasicMaterial({
    color: 0xbff6ff,
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const coreDisc = new Mesh(coreDiscGeometry, coreDiscMaterial);
  coreDisc.name = WORLD_NAMES.coreDisc;
  coreDisc.rotation.x = Math.PI / 2;
  coreDisc.position.y = 17.8;
  core.add(coreBase, coreColumn, coreDisc);
  root.add(core);

  /* ---------------------------------------------------------- factory frame */
  const frame = new Group();
  frame.name = WORLD_NAMES.frame;
  const towers = new Group();
  towers.name = WORLD_NAMES.towers;
  const towerGeometry = new BoxGeometry(2.6, 26, 2.6);
  const stripGeometry = new BoxGeometry(0.45, 23, 0.45);
  const towerMaterial = new MeshStandardMaterial({
    color: 0x0a1220,
    metalness: 0.85,
    roughness: 0.4,
  });
  const stripMaterial = new MeshStandardMaterial({
    color: 0x8ff6ff,
    emissive: 0x35f0ff,
    emissiveIntensity: 1.3,
    metalness: 0.4,
    roughness: 0.3,
  });
  const towerReach = FLOOR_SIZE / 2 - 6;
  const towerCorners: readonly (readonly [number, number])[] = [
    [towerReach, towerReach],
    [-towerReach, towerReach],
    [towerReach, -towerReach],
    [-towerReach, -towerReach],
  ];
  for (const [x, z] of towerCorners) {
    const tower = new Mesh(towerGeometry, towerMaterial);
    tower.position.set(x, 13, z);
    const strip = new Mesh(stripGeometry, stripMaterial);
    strip.name = `factory-tower-strip-${x}-${z}`;
    strip.position.set(x + Math.sign(x) * 1.5, 13, z + Math.sign(z) * 1.5);
    towers.add(tower, strip);
  }
  frame.add(towers);

  const machines = new Group();
  machines.name = WORLD_NAMES.machines;
  const machineGeometry = new BoxGeometry(5.4, 2.1, 2.8);
  const ventGeometry = new BoxGeometry(3.2, 0.25, 0.5);
  const machineMaterial = new MeshStandardMaterial({
    color: 0x0b1424,
    metalness: 0.8,
    roughness: 0.45,
  });
  const ventMaterial = new MeshStandardMaterial({
    color: 0xffc15c,
    emissive: 0xffa63c,
    emissiveIntensity: 0.75,
    metalness: 0.3,
    roughness: 0.4,
  });
  const machineRing = FLOOR_SIZE / 2 - 9;
  for (let index = 0; index < 10; index += 1) {
    const alongNegative = index < 5;
    const slot = index % 5;
    const x = (slot - 2) * 15 + rng.float(-1.1, 1.1);
    const z = alongNegative ? -machineRing + rng.float(-1.2, 1.2) : machineRing + rng.float(-1.2, 1.2);
    const machine = new Mesh(machineGeometry, machineMaterial);
    machine.position.set(x, 1.05, z);
    machine.rotation.y = rng.float(-0.22, 0.22) + (alongNegative ? 0 : Math.PI);
    const vent = new Mesh(ventGeometry, ventMaterial);
    vent.position.set(0, -0.72, 2.55);
    machine.add(vent);
    machines.add(machine);
  }
  frame.add(machines);
  root.add(frame);

  /* -------------------------------------------------------------- lighting */
  const lights = new Group();
  lights.name = WORLD_NAMES.lights;
  const hemisphere = new HemisphereLight(0x6fd8ff, 0x04070f, 0.5);
  const key = new DirectionalLight(0xbfefff, 1.15);
  key.position.set(18, 26, 14);
  const coreLight = new PointLight(0x35f0ff, 120, 130, 2);
  coreLight.position.set(0, 12, 0);
  const serviceLight = new PointLight(0xff4fd8, 55, 95, 2);
  serviceLight.position.set(-24, 8, 16);
  const farBayLight = new PointLight(0x35f0ff, 45, 95, 2);
  farBayLight.position.set(24, 8, -18);
  lights.add(hemisphere, key, coreLight, serviceLight, farBayLight);
  root.add(lights);

  /* -------------------------------------------------- state-driven actors */
  const landmarks = new Group();
  landmarks.name = WORLD_NAMES.landmarks;
  const laneRow = new Group();
  laneRow.name = WORLD_NAMES.lanes;
  const gateRow = new Group();
  gateRow.name = WORLD_NAMES.gates;
  landmarks.add(laneRow, gateRow);
  root.add(landmarks);

  const pylonBodyGeometry = new CylinderGeometry(1.1, 1.5, 4.4, 24);
  const pylonBarGeometry = new BoxGeometry(0.38, 3.4, 0.38);
  const pylonBodyMaterial = new MeshStandardMaterial({
    color: 0x0a1626,
    metalness: 0.85,
    roughness: 0.35,
  });
  const beaconGeometry = new CylinderGeometry(0.55, 0.8, 9, 24, 1, true);

  const laneActors = new Map<string, LaneActor>();
  const gateActors = new Map<string, GateActor>();
  let actorSignature = '';
  let anchorRegistry = new Map<string, EmissiveAnchor>();

  /** Unlink the actor meshes without touching their resources. */
  function removeActorRows(): void {
    for (const actor of laneActors.values()) actor.group.removeFromParent();
    for (const actor of gateActors.values()) actor.beacon.removeFromParent();
    laneActors.clear();
    gateActors.clear();
    laneRow.clear();
    gateRow.clear();
  }

  /** Replace-time teardown: release the per-instance materials, then unlink. */
  function clearActors(): void {
    for (const actor of laneActors.values()) actor.material.dispose();
    for (const actor of gateActors.values()) actor.material.dispose();
    removeActorRows();
  }

  /** Virtual anchors: the grid's own energy pools, one per quadrant. */
  function gridGlowAnchors(): EmissiveAnchor[] {
    const spread = FLOOR_SIZE * 0.24;
    const anchors: EmissiveAnchor[] = [];
    const quadrants: readonly (readonly [number, number])[] = [
      [spread, spread],
      [-spread, spread],
      [spread, -spread],
      [-spread, -spread],
    ];
    quadrants.forEach(([x, z], index) => {
      anchors.push({
        id: `grid-glow-${index}`,
        position: new Vector3(x, 0.05, z),
        color: new Color(0x2fd6f5),
        radius: GRID_GLOW_RADIUS,
        intensity: 0.55,
      });
    });
    return anchors;
  }

  function publishAnchors(): void {
    // `maxRadius` keeps the bloom on *elements*: long structural beams (tower
    // strips, the holo column) are emissive but their midpoint halo would read as
    // a fog blob, so they are left to glow through their own material.
    const collected = collectEmissiveAnchors(root, { maxAnchors: 40, maxRadius: 6.5 });
    anchorRegistry = new Map(collected.map((anchor) => [anchor.id, anchor]));
    post.setAnchors([...collected, ...gridGlowAnchors()]);

    // Actors keep a live handle on their own anchor, so `update` can breathe the
    // halo without re-collecting the whole scene.
    for (const actor of laneActors.values()) {
      actor.anchor = anchorRegistry.get(actor.bar.name) ?? null;
    }
    for (const actor of gateActors.values()) {
      actor.anchor = anchorRegistry.get(actor.beacon.name) ?? null;
    }
  }

  function rebuildActors(state: DeepReadonly<GameState>): void {
    clearActors();

    const laneIds = state.lanes.order;
    laneIds.forEach((laneId, index) => {
      const lane = state.lanes.lanes[laneId];
      const color = new Color(lane ? LANE_COLORS[lane.kind] : LANE_COLORS.build);
      const material = new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.2,
        metalness: 0.5,
        roughness: 0.25,
      });
      const group = new Group();
      group.name = `lane-pylon-${laneId}`;
      const body = new Mesh(pylonBodyGeometry, pylonBodyMaterial);
      body.position.y = 2.2;
      const bar = new Mesh(pylonBarGeometry, material);
      bar.name = `lane-bar-${laneId}`;
      bar.position.y = 5.6;
      group.add(body, bar);
      group.position.set((index - (laneIds.length - 1) / 2) * LANE_SLOT_SPACING, 0, LANE_ROW_Z);
      laneRow.add(group);
      laneActors.set(laneId, { group, bar, material, anchor: null, baseIntensity: 1.2 });
    });

    const gateIds = state.verification.order;
    gateIds.forEach((gateId, index) => {
      const gate = state.verification.gates[gateId];
      const color = new Color(gate ? GATE_COLORS[gate.status] : GATE_COLORS.pending);
      const material = new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.2,
        metalness: 0.3,
        roughness: 0.3,
        transparent: true,
        opacity: 0.9,
        side: DoubleSide,
      });
      const beacon = new Mesh(beaconGeometry, material);
      beacon.name = `gate-beacon-${gateId}`;
      beacon.position.set((index - (gateIds.length - 1) / 2) * GATE_SLOT_SPACING, 4.5, GATE_ROW_Z);
      gateRow.add(beacon);
      gateActors.set(gateId, { beacon, material, anchor: null, baseIntensity: 1.2, baseOpacity: 0.9 });
    });

    actorSignature = `${laneIds.join('|')}::${gateIds.join('|')}`;
    publishAnchors();
  }

  /* ------------------------------------------------------------ post chain */
  const post: PostChain = createPostChain({
    host: root,
    camera: adapter.camera,
    preset: options.preset ?? DEFAULT_POST_QUALITY,
    anchors: gridGlowAnchors(),
    width: options.width ?? adapter.width,
    height: options.height ?? adapter.height,
  });

  /* --------------------------------------------------------------- state */
  let currentState: DeepReadonly<GameState> | null = null;
  let time = 0;
  let viewport = {
    width: Math.max(1, options.width ?? adapter.width),
    height: Math.max(1, options.height ?? adapter.height),
  };
  let disposed = false;

  /** Recode the floor from a snapshot; the actor rows rebuild only on shape changes. */
  function applyState(state: DeepReadonly<GameState>): void {
    if (disposed) return;
    const signature = `${state.lanes.order.join('|')}::${state.verification.order.join('|')}`;
    if (signature !== actorSignature) rebuildActors(state);

    for (const laneId of state.lanes.order) {
      const actor = laneActors.get(laneId);
      const lane = state.lanes.lanes[laneId];
      if (!actor || !lane) continue;
      const color = new Color(LANE_COLORS[lane.kind]);
      actor.material.color.copy(color);
      actor.material.emissive.copy(color);
      // Idle lanes stay readable but dim; loaded lanes carry the light.
      actor.baseIntensity = lane.activeTaskId === null ? 0.2 : 0.75 + lane.utilization * 0.85;
      actor.material.emissiveIntensity = actor.baseIntensity;
      if (actor.anchor) {
        actor.anchor.intensity = clamp(actor.baseIntensity / 0.8, 0.15, 2);
        actor.anchor.color.copy(color);
      }
    }

    for (const gateId of state.verification.order) {
      const actor = gateActors.get(gateId);
      const gate = state.verification.gates[gateId];
      if (!actor || !gate) continue;
      const color = new Color(GATE_COLORS[gate.status]);
      actor.material.color.copy(color);
      actor.material.emissive.copy(color);
      actor.baseIntensity = gate.status === 'passed' ? 1.6 : gate.status === 'running' ? 1.1 : 0.45;
      actor.material.emissiveIntensity = actor.baseIntensity;
      actor.baseOpacity = gate.status === 'pending' ? 0.55 : 0.9;
      actor.material.opacity = actor.baseOpacity;
      if (actor.anchor) {
        actor.anchor.intensity = clamp(actor.baseIntensity / 0.8, 0.15, 2);
        actor.anchor.color.copy(color);
      }
    }

    const progress = clamp(state.mission.progress, 0, 1);
    coreBaseMaterial.emissiveIntensity = 0.5 + progress * 1.6;
    coreDiscMaterial.opacity = 0.35 + progress * 0.4;
    coreLight.intensity = 80 + progress * 140;
    gridUniforms.uPulse.value = 0.35 + progress * 0.85;
    gridUniforms.uOpacity.value = state.mission.status === 'blocked' ? 0.7 : 0.95;

    currentState = state;
  }

  function setPreset(preset: PostQualityPreset): void {
    post.setPreset(preset);
  }

  function resize(width: number, height: number, _pixelRatio?: number): void {
    if (disposed) return;
    viewport = { width: Math.max(1, width), height: Math.max(1, height) };
    post.setSize(viewport.width, viewport.height);
  }

  function update(deltaMs: number, elapsedMs?: number): void {
    if (disposed) return;
    const dt = Math.max(0, Math.min(deltaMs, MAX_WORLD_STEP_MS));
    time = elapsedMs === undefined ? time + dt / 1000 : Math.max(0, elapsedMs) / 1000;

    gridUniforms.uTime.value = time;
    coreBase.position.y = 0.3 + Math.sin(time * 0.8) * 0.03;
    coreColumnMaterial.opacity = 0.075 + Math.sin(time * 0.9) * 0.02;
    innerRing.rotation.z = time * 0.03;
    outerRing.rotation.z = -time * 0.018;

    let index = 0;
    for (const actor of laneActors.values()) {
      const pulse = 1 + 0.14 * Math.sin(time * 2.1 + index * 0.9);
      actor.material.emissiveIntensity = actor.baseIntensity * pulse;
      if (actor.anchor) actor.anchor.intensity = clamp((actor.baseIntensity * pulse) / 0.8, 0.15, 2);
      index += 1;
    }
    index = 0;
    for (const actor of gateActors.values()) {
      const pulse = 1 + 0.12 * Math.sin(time * 1.4 + index * 1.1);
      actor.material.emissiveIntensity = actor.baseIntensity * pulse;
      actor.material.opacity = clamp(actor.baseOpacity * (0.8 + 0.2 * pulse), 0, 1);
      if (actor.anchor) actor.anchor.intensity = clamp((actor.baseIntensity * pulse) / 0.8, 0.15, 2);
      index += 1;
    }

    post.update(dt, elapsedMs);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    post.dispose();

    // The actors are still in the tree here, so one de-duplicated sweep releases
    // every geometry, material and texture the world created — shared ones once.
    disposeWorldResources(root);
    removeActorRows();
    anchorRegistry.clear();

    // The backdrop rides on `scene.background` rather than on a material, so the
    // sweep cannot see it: release it explicitly.
    backdrop.dispose();

    root.removeFromParent();
    root.clear();

    // Restore the scene properties the world borrowed.
    scene.background = previousBackground;
    scene.fog = previousFog;
  }

  // A state handed in at build time frames the floor before the first frame.
  if (options.state) applyState(options.state);

  return {
    root,
    adapter,
    post,
    get preset() {
      return post.preset;
    },
    backdrop,
    fog,
    grid,
    get laneCount() {
      return laneActors.size;
    },
    get gateCount() {
      return gateActors.size;
    },
    get time() {
      return time;
    },
    get state() {
      return currentState;
    },
    get disposed() {
      return disposed;
    },
    setPreset,
    applyState,
    resize,
    update,
    dispose,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/* -------------------------------------------------------------------------- */
/* Game system adapter                                                        */
/* -------------------------------------------------------------------------- */

/** A `GameSystem` that owns the world over the runtime's adapter. */
export interface WorldSystem extends GameSystem {
  readonly id: 'world';
  /** The world, available after `attach` has run. */
  readonly world: World | null;
  setPreset(preset: PostQualityPreset): void;
}

export interface WorldSystemOptions {
  preset?: PostQualityPreset;
  seed?: number;
  /**
   * State to frame the floor with at attach time. Without it the world codes
   * itself from the first snapshot the runtime hands over.
   */
  state?: DeepReadonly<GameState> | null;
}

/**
 * Compose the world as a game system.
 *
 * Re-codes the floor whenever the runtime hands over a new state snapshot and
 * advances the show once per fixed step. Register the camera rig **before** this
 * system: the post chain places its screen pass on the camera pose it reads.
 */
export function createWorldSystem(options: WorldSystemOptions = {}): WorldSystem {
  let world: World | null = null;
  let lastState: DeepReadonly<GameState> | null = options.state ?? null;

  return {
    id: 'world',
    get world() {
      return world;
    },
    setPreset(preset: PostQualityPreset): void {
      world?.setPreset(preset);
    },
    attach(context: SystemContext): void {
      world = createWorld({
        adapter: context.adapter,
        preset: options.preset,
        seed: options.seed ?? context.seed,
        state: options.state ?? null,
        width: context.adapter.width,
        height: context.adapter.height,
      });
    },
    update(update: SystemUpdate): void {
      if (!world) return;
      if (update.state !== lastState) {
        world.applyState(update.state);
        lastState = update.state;
      }
      world.update(update.deltaMs, update.elapsedMs);
    },
    dispose(): void {
      world?.dispose();
      world = null;
      lastState = null;
    },
  };
}
