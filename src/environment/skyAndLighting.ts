/**
 * Chrono City — era sky, fog, lighting rig and ambient particles.
 *
 * Owns everything *above* the street: the gradient sky dome with its sun and
 * moon, the directional/ambient/hemisphere lighting rig, the scene fog and the
 * render exposure, plus the budgeted particle beds that carry a period's mood —
 * 1945 coal-steam and dust, 1965 diesel haze, 1985 neon bloom, 2005 cool
 * daylight motes and 2025 delivery-drone lights.
 *
 * Two inputs drive it, both already era-aware:
 *   * the interpolated `EraTimelineDescriptor` (sky palette, fog, lighting mood,
 *     exposure and contrast) which makes colour, fog and light morph continuously
 *     across a `TimelineRuntime` tween, and
 *   * this module's own `ATMOSPHERE_DESCRIPTORS`, which decide how strong each
 *     particle bed is in each year.
 *
 * The rig never lets a consumer mutate a light directly: it publishes the
 * resolved state through `snapshot()` (and the `EnvironmentApi`) so the later
 * post-processing/colour-grading task can grade against a stable read-only
 * contract.
 *
 * Particle cost is bounded by construction: every bed is a pre-allocated
 * `THREE.Points` pool (`PARTICLE_BUDGETS`) with a fixed capacity, a free-list and
 * a spawn rate derived from its era presence — never more points than the budget,
 * which is what keeps the beds inside the 60 fps target.
 *
 * Lifecycle:
 *   create    → `createSkyLighting({ context, parent? })` builds the dome, the
 *               lights, the discs and the particle pools.
 *   consume   → `applyBlend(from, to, progress, descriptor)` per tween frame,
 *               `applyEra(era)` to snap, `tick(frame)` each render frame,
 *               `snapshot()` to observe, `gradeState()` for the grader.
 *   integrate → the `EnvironmentApi` owns the root and the render exposure.
 */

import * as THREE from 'three';

import {
  BLOCK_HALF_DEPTH,
  BLOCK_HALF_WIDTH,
  ROAD_OUTER_X,
  ROAD_OUTER_Z,
  type Vec2,
} from '../core/blockLayout';
import { ERA_IDS, assertEraId, clamp01, type EraId } from '../core/eraContracts';
import {
  ERA_DESCRIPTORS,
  getEraDescriptor,
  type EraTimelineDescriptor,
} from '../era/eraDescriptors';
import type { FrameInfo, RandomSource, SceneContext } from '../core/sceneContext';

export const SKY_LIGHTING_VERSION = 1;

/** Group name the sky dome and celestial discs are parented to. */
export const SKY_ROOT_NAME = 'chrono-sky-lighting';
/** Name of the shadow-casting daylight directional light. */
export const SUN_LIGHT_NAME = 'chrono-sun';
/** Name of the cool fill light that appears as the sun drops. */
export const MOON_LIGHT_NAME = 'chrono-moon';
/** Radius of the sky dome, in metres. */
export const SKY_DOME_RADIUS = 900;
/** Distance the sun/moon discs and directional lights sit from the origin. */
export const CELESTIAL_DISTANCE = 420;
/** Sun elevation below which the moon light starts to appear, in degrees. */
export const MOON_RISE_ELEVATION_DEG = 14;

/* ------------------------------------------------------------------------- *
 * Particles
 * ------------------------------------------------------------------------- */

export type ParticleKind = 'steam' | 'dust' | 'neonHaze' | 'droneLights';

export const PARTICLE_KINDS: readonly ParticleKind[] = Object.freeze([
  'steam',
  'dust',
  'neonHaze',
  'droneLights',
]);

/** Hard per-bed capacities. The sum is the whole particle budget for the block. */
export const PARTICLE_BUDGETS: Readonly<Record<ParticleKind, number>> = Object.freeze({
  steam: 96,
  dust: 128,
  neonHaze: 72,
  droneLights: 24,
});

/** Total pooled point sprites the block may ever draw. */
export const TOTAL_PARTICLE_BUDGET = Object.freeze(
  PARTICLE_KINDS.reduce((total, kind) => total + PARTICLE_BUDGETS[kind], 0),
);

export type ParticleBlending = 'additive' | 'normal';

/** Static configuration of one particle bed. */
export interface ParticleBedConfig {
  readonly kind: ParticleKind;
  readonly capacity: number;
  readonly color: number;
  readonly size: number;
  /** Base opacity at full era presence. */
  readonly opacity: number;
  /** Upward speed in m/s (negative drifts down). */
  readonly rise: number;
  /** Lateral wander amplitude in metres. */
  readonly wander: number;
  /** Half-extent of the emission area in metres. */
  readonly spread: number;
  /** Emission height in metres. */
  readonly baseY: number;
  /** Mean particle lifetime in seconds. */
  readonly lifeSeconds: number;
  readonly blending: ParticleBlending;
  /** Emission clusters the bed spawns from. */
  readonly emitters: readonly Vec2[];
  /** Whether this bed's colour follows the era emissive tint. */
  readonly tintedByEra: boolean;
}

function emitterRing(radius: number, count: number): Vec2[] {
  const emitters: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    emitters.push(
      Object.freeze({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius * 0.7 }),
    );
  }
  return emitters;
}

/** The four authored beds: two street-level and two atmospheric. */
export const PARTICLE_BEDS: readonly ParticleBedConfig[] = Object.freeze([
  Object.freeze({
    kind: 'steam',
    capacity: PARTICLE_BUDGETS.steam,
    color: 0xe4ebef,
    size: 3.4,
    opacity: 0.5,
    rise: 1.7,
    wander: 0.35,
    spread: 1.1,
    baseY: 0.15,
    lifeSeconds: 5.5,
    blending: 'normal',
    emitters: Object.freeze([
      Object.freeze({ x: ROAD_OUTER_X * 0.55, z: ROAD_OUTER_Z * 0.4 }),
      Object.freeze({ x: -ROAD_OUTER_X * 0.5, z: -ROAD_OUTER_Z * 0.45 }),
      Object.freeze({ x: 0.6, z: ROAD_OUTER_Z * 0.62 }),
    ]),
    tintedByEra: false,
  }),
  Object.freeze({
    kind: 'dust',
    capacity: PARTICLE_BUDGETS.dust,
    color: 0xd8cdb6,
    size: 1.1,
    opacity: 0.34,
    rise: 0.22,
    wander: 1.5,
    spread: BLOCK_HALF_WIDTH,
    baseY: 6,
    lifeSeconds: 9,
    blending: 'normal',
    emitters: Object.freeze([
      Object.freeze({ x: 0, z: 0 }),
      Object.freeze({ x: BLOCK_HALF_WIDTH * 0.5, z: BLOCK_HALF_DEPTH * 0.5 }),
    ]),
    tintedByEra: true,
  }),
  Object.freeze({
    kind: 'neonHaze',
    capacity: PARTICLE_BUDGETS.neonHaze,
    color: 0xff64b8,
    size: 5.2,
    opacity: 0.3,
    rise: 0.12,
    wander: 0.9,
    spread: ROAD_OUTER_X + 6,
    baseY: 2.4,
    lifeSeconds: 7.5,
    blending: 'additive',
    emitters: emitterRing(ROAD_OUTER_X * 0.85, 4),
    tintedByEra: true,
  }),
  Object.freeze({
    kind: 'droneLights',
    capacity: PARTICLE_BUDGETS.droneLights,
    color: 0xd9f2ff,
    size: 2.4,
    opacity: 0.85,
    rise: 0.05,
    wander: 2.2,
    spread: ROAD_OUTER_X * 0.6,
    baseY: 24,
    lifeSeconds: 12,
    blending: 'additive',
    emitters: emitterRing(ROAD_OUTER_X * 0.45, 3),
    tintedByEra: false,
  }),
]);

/** Per-year strength of each particle bed, in `[0, 1]`. */
export interface EraAtmosphereDescriptor {
  readonly era: EraId;
  readonly steam: number;
  readonly dust: number;
  readonly neonHaze: number;
  readonly droneLights: number;
  /** Strength of the horizon haze band in the sky shader. */
  readonly horizonHaze: number;
  /** Scale multiplier on the sun/moon disc. */
  readonly discScale: number;
  /** Cool-moon fill intensity; 0 keeps the night light off entirely. */
  readonly moonIntensity: number;
  readonly notes: string;
}

export const ATMOSPHERE_DESCRIPTORS: Readonly<Record<EraId, EraAtmosphereDescriptor>> =
  Object.freeze({
    '1945': Object.freeze({
      era: '1945',
      steam: 0.95,
      dust: 0.5,
      neonHaze: 0.04,
      droneLights: 0,
      horizonHaze: 0.8,
      discScale: 1,
      moonIntensity: 0.1,
      notes: 'Chimney and vent steam, coal soot and a heavy overcast haze band.',
    }),
    '1965': Object.freeze({
      era: '1965',
      steam: 0.6,
      dust: 0.62,
      neonHaze: 0.22,
      droneLights: 0,
      horizonHaze: 0.55,
      discScale: 1.05,
      moonIntensity: 0.08,
      notes: 'Diesel dust, thinning steam and the first faint neon after dusk.',
    }),
    '1985': Object.freeze({
      era: '1985',
      steam: 0.42,
      dust: 0.34,
      neonHaze: 1,
      droneLights: 0,
      horizonHaze: 0.7,
      discScale: 1.2,
      moonIntensity: 0.6,
      notes: 'Dense neon bloom and wet dust under an amber sodium sky at dusk.',
    }),
    '2005': Object.freeze({
      era: '2005',
      steam: 0.3,
      dust: 0.44,
      neonHaze: 0.58,
      droneLights: 0,
      horizonHaze: 0.4,
      discScale: 1,
      moonIntensity: 0.25,
      notes: 'Clear cool daylight motes and a modest backlit-advertising glow.',
    }),
    '2025': Object.freeze({
      era: '2025',
      steam: 0.24,
      dust: 0.5,
      neonHaze: 0.4,
      droneLights: 1,
      horizonHaze: 0.3,
      discScale: 0.95,
      moonIntensity: 0.15,
      notes: 'Clean air, soft dust and delivery-drone lights tracking above the block.',
    }),
  });

/** Looks an atmosphere set up; throws a `RangeError` for unknown eras. */
export function getAtmosphereDescriptor(era: EraId | string): EraAtmosphereDescriptor {
  return ATMOSPHERE_DESCRIPTORS[assertEraId(era)];
}

/** A resolved (already blended) atmosphere set. */
export interface ResolvedAtmosphereDescriptor {
  readonly steam: number;
  readonly dust: number;
  readonly neonHaze: number;
  readonly droneLights: number;
  readonly horizonHaze: number;
  readonly discScale: number;
  readonly moonIntensity: number;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Blends two atmosphere sets; every field is continuous. */
export function blendAtmosphereDescriptors(
  from: EraId,
  to: EraId,
  progress: number,
): ResolvedAtmosphereDescriptor {
  const t = clamp01(progress);
  const source = getAtmosphereDescriptor(from);
  const target = getAtmosphereDescriptor(to);
  if (from === to || t >= 1) return resolveAtmosphere(target);
  if (t <= 0) return resolveAtmosphere(source);
  return {
    steam: lerp(source.steam, target.steam, t),
    dust: lerp(source.dust, target.dust, t),
    neonHaze: lerp(source.neonHaze, target.neonHaze, t),
    droneLights: lerp(source.droneLights, target.droneLights, t),
    horizonHaze: lerp(source.horizonHaze, target.horizonHaze, t),
    discScale: lerp(source.discScale, target.discScale, t),
    moonIntensity: lerp(source.moonIntensity, target.moonIntensity, t),
  };
}

function resolveAtmosphere(
  descriptor: EraAtmosphereDescriptor,
): ResolvedAtmosphereDescriptor {
  return {
    steam: descriptor.steam,
    dust: descriptor.dust,
    neonHaze: descriptor.neonHaze,
    droneLights: descriptor.droneLights,
    horizonHaze: descriptor.horizonHaze,
    discScale: descriptor.discScale,
    moonIntensity: descriptor.moonIntensity,
  };
}

/** Freezes a direction into a JSON-safe readonly tuple. */
function freezeDirection(vector: THREE.Vector3): readonly [number, number, number] {
  const tuple: [number, number, number] = [vector.x, vector.y, vector.z];
  return Object.freeze(tuple);
}

/** Read-out of one particle bed. */
export interface ParticleBedSnapshot {
  readonly kind: ParticleKind;
  readonly capacity: number;
  readonly active: number;
  readonly presence: number;
  readonly opacity: number;
  readonly color: number;
  readonly size: number;
  readonly blending: ParticleBlending;
  readonly emitterCount: number;
}

/* ------------------------------------------------------------------------- *
 * Sprite texture
 * ------------------------------------------------------------------------- */

let spriteTexture: THREE.Texture | null = null;
let spriteAttempted = false;

/** A soft round sprite, generated once and shared by every bed. */
function getSpriteTexture(): THREE.Texture | null {
  if (spriteAttempted) return spriteTexture;
  spriteAttempted = true;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context2d = canvas.getContext('2d');
  if (!context2d) return null;
  const gradient = context2d.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context2d.fillStyle = gradient;
  context2d.fillRect(0, 0, 64, 64);
  spriteTexture = new THREE.CanvasTexture(canvas);
  spriteTexture.name = 'chrono-particle-sprite';
  return spriteTexture;
}

/* ------------------------------------------------------------------------- *
 * Particle pool
 * ------------------------------------------------------------------------- */

const HIDDEN_Y = -400;

class ParticlePool {
  readonly config: ParticleBedConfig;
  readonly points: THREE.Points;

  private readonly random: RandomSource;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly remaining: Float32Array;
  private readonly cursor: Uint8Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  private cursorIndex = 0;
  private spawnCarry = 0;
  private elapsed = 0;
  private presenceState = 1;
  private activeState = 0;

  constructor(config: ParticleBedConfig, random: RandomSource) {
    this.config = config;
    this.random = random;
    const capacity = config.capacity;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.remaining = new Float32Array(capacity);
    this.cursor = new Uint8Array(capacity);

    for (let index = 0; index < capacity; index += 1) {
      this.positions[index * 3 + 1] = HIDDEN_Y;
      this.cursor[index] = 0;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);

    this.material = new THREE.PointsMaterial({
      name: `chrono-particles-${config.kind}`,
      color: config.color,
      size: config.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      map: getSpriteTexture(),
      blending: config.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = `chrono-particles-${config.kind}`;
    this.points.frustumCulled = false;
    this.points.userData.chronoParticleKind = config.kind;
  }

  get capacity(): number {
    return this.config.capacity;
  }

  get active(): number {
    return this.activeState;
  }

  get presence(): number {
    return this.presenceState;
  }

  /** Sets the era presence in `[0, 1]`: drives opacity and emission rate. */
  setPresence(presence: number): void {
    this.presenceState = clamp01(presence);
    this.material.opacity = this.config.opacity * this.presenceState;
    this.points.visible = this.presenceState > 0.02;
    if (!this.points.visible) this.clear();
  }

  /** Tints the bed with the era emissive colour where the bed asks for it. */
  setTint(color: number): void {
    if (!this.config.tintedByEra) return;
    this.material.color.setHex(color);
  }

  update(delta: number): void {
    const step = Number.isFinite(delta) && delta > 0 ? Math.min(delta, 0.25) : 0;
    this.elapsed += step;

    for (let index = 0; index < this.config.capacity; index += 1) {
      if (this.cursor[index] !== 1) continue;
      this.remaining[index] -= step;
      if (this.remaining[index] <= 0) {
        this.deactivate(index);
        continue;
      }
      const offset = index * 3;
      const wander =
        Math.sin(this.elapsed * (0.6 + (index % 7) * 0.07) + index) * this.config.wander;
      this.positions[offset] += (this.velocities[offset] + wander) * step;
      this.positions[offset + 1] += this.velocities[offset + 1] * step;
      this.positions[offset + 2] += (this.velocities[offset + 2] + wander * 0.4) * step;
      // Fade the oldest particles by easing them upwards faster, a cheap
      // substitute for a per-vertex alpha attribute.
      if (this.remaining[index] < 0.6) this.positions[offset + 1] += step * 0.6;
    }

    this.emit(step);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (let index = 0; index < this.config.capacity; index += 1) {
      if (this.cursor[index] === 1) this.deactivate(index);
    }
  }

  snapshot(): ParticleBedSnapshot {
    return Object.freeze({
      kind: this.config.kind,
      capacity: this.config.capacity,
      active: this.activeState,
      presence: this.presenceState,
      opacity: this.material.opacity,
      color: this.material.color.getHex(),
      size: this.config.size,
      blending: this.config.blending,
      emitterCount: this.config.emitters.length,
    });
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }

  /* ---------------- internals ---------------- */

  private emit(delta: number): void {
    if (delta <= 0 || this.presenceState <= 0.02) return;
    const rate = (this.config.capacity / this.config.lifeSeconds) * this.presenceState;
    this.spawnCarry += rate * delta;
    // Emit the whole particles the accumulator has earned: a low-presence bed
    // (1945's neon haze) therefore spawns a few points a second, not one a frame.
    let budget = Math.floor(this.spawnCarry);
    this.spawnCarry -= budget;
    while (budget > 0) {
      this.spawn();
      budget -= 1;
    }
  }

  private spawn(): void {
    const capacity = this.config.capacity;
    let index = -1;
    for (let probe = 0; probe < capacity; probe += 1) {
      const candidate = (this.cursorIndex + probe) % capacity;
      if (this.cursor[candidate] === 0) {
        index = candidate;
        this.cursorIndex = (candidate + 1) % capacity;
        break;
      }
    }
    if (index < 0) return;

    const emitter = this.config.emitters[this.random.int(0, this.config.emitters.length - 1)];
    const offset = index * 3;
    this.positions[offset] = emitter.x + this.random.float(-this.config.spread, this.config.spread);
    this.positions[offset + 1] = this.config.baseY + this.random.float(0, 1.2);
    this.positions[offset + 2] =
      emitter.z + this.random.float(-this.config.spread, this.config.spread);
    this.velocities[offset] = this.random.float(-0.18, 0.18);
    this.velocities[offset + 1] = this.config.rise * this.random.float(0.6, 1.35);
    this.velocities[offset + 2] = this.random.float(-0.18, 0.18);
    const life = this.config.lifeSeconds * this.random.float(0.7, 1.3);
    this.remaining[index] = life;
    this.cursor[index] = 1;
    this.activeState += 1;
  }

  private deactivate(index: number): void {
    if (this.cursor[index] !== 1) return;
    this.cursor[index] = 0;
    this.remaining[index] = 0;
    this.positions[index * 3 + 1] = HIDDEN_Y;
    this.activeState = Math.max(0, this.activeState - 1);
  }
}

/* ------------------------------------------------------------------------- *
 * Sky + lighting rig
 * ------------------------------------------------------------------------- */

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldDirection = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uMoonColor;
  uniform float uSunIntensity;
  uniform float uMoonVisibility;
  uniform float uHaze;
  varying vec3 vWorldDirection;

  float chronoHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  void main() {
    vec3 direction = normalize(vWorldDirection);
    float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uTop, smoothstep(0.52, 0.96, height));
    sky = mix(uGround, sky, smoothstep(0.44, 0.54, height));

    vec3 sunDirection = normalize(uSunDirection);
    float sunDot = max(dot(direction, sunDirection), 0.0);
    sky += uSunColor * pow(sunDot, 240.0) * (0.9 + uSunIntensity);
    sky += uSunColor * pow(sunDot, 9.0) * 0.16 * uHaze;

    float moonDot = max(dot(direction, -sunDirection), 0.0);
    sky += uMoonColor * pow(moonDot, 320.0) * uMoonVisibility;

    float star = step(0.9984, chronoHash(floor(direction * 420.0)));
    sky += vec3(star) * uMoonVisibility * smoothstep(0.5, 0.86, height);

    gl_FragColor = vec4(sky, 1.0);
  }
`;

/** Read-only state of the sky, light rig, fog and particles. */
export interface SkyLightingSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly from: EraId;
  readonly to: EraId;
  readonly progress: number;
  readonly transitioning: boolean;
  readonly sky: Readonly<{
    topColor: number;
    horizonColor: number;
    groundColor: number;
    radius: number;
    sunDirection: readonly [number, number, number];
    sunAboveHorizon: boolean;
  }>;
  readonly fog: Readonly<{
    color: number;
    mode: 'linear' | 'exponential';
    near: number;
    far: number;
    density: number;
  }>;
  readonly exposure: number;
  readonly contrast: number;
  readonly ambient: Readonly<{ color: number; intensity: number }>;
  readonly hemisphere: Readonly<{ skyColor: number; groundColor: number; intensity: number }>;
  readonly lighting: Readonly<{
    mood: string;
    sunColor: number;
    sunIntensity: number;
    sunElevationDeg: number;
    sunAzimuthDeg: number;
    moonVisible: boolean;
    moonIntensity: number;
    lightCount: number;
  }>;
  readonly particles: readonly ParticleBedSnapshot[];
  readonly particleCapacity: number;
  readonly particleActive: number;
  readonly particleBudgetShare: number;
  readonly tickCount: number;
}

/** The read-only surface the later post-processing / grading task consumes. */
export interface EnvironmentGradeState {
  readonly exposure: number;
  readonly contrast: number;
  readonly skyTopColor: number;
  readonly skyHorizonColor: number;
  readonly fogColor: number;
  readonly fogMode: 'linear' | 'exponential';
  readonly fogNear: number;
  readonly fogFar: number;
  readonly fogDensity: number;
  readonly ambientColor: number;
  readonly ambientIntensity: number;
  readonly neonIntensity: number;
  readonly sourceEra: EraId;
}

export interface SkyLightingOptions {
  readonly context: SceneContext;
  readonly parent?: THREE.Object3D | null;
  readonly initialEra?: EraId;
}

export class SkyLightingRig {
  readonly version = SKY_LIGHTING_VERSION;

  /** Root of the dome and the celestial discs. */
  readonly root: THREE.Group;

  readonly sun: THREE.DirectionalLight;
  readonly moon: THREE.DirectionalLight;
  readonly ambient: THREE.AmbientLight;
  readonly hemisphere: THREE.HemisphereLight;

  private readonly context: SceneContext;
  private readonly parent: THREE.Object3D;
  private readonly scene: THREE.Scene;
  private readonly dome: THREE.Mesh;
  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly sunDisc: THREE.Mesh;
  private readonly moonDisc: THREE.Mesh;
  private readonly linearFog = new THREE.Fog(0xb8b3a6, 40, 320);
  private readonly exponentialFog = new THREE.FogExp2(0xb8b3a6, 0.005);
  private readonly pools = new Map<ParticleKind, ParticlePool>();

  private fromEra: EraId;
  private toEra: EraId;
  private progressState = 1;
  private descriptorState: EraTimelineDescriptor;
  private atmosphereState: ResolvedAtmosphereDescriptor;
  private sunDirection = new THREE.Vector3(0, 1, 0);
  private moonVisibleState = false;
  private moonIntensityState = 0;
  private exposureState = 1;
  private tickCountState = 0;
  private disposedState = false;

  constructor(options: SkyLightingOptions) {
    if (!options?.context) throw new TypeError('SkyLightingRig needs a SceneContext.');
    this.context = options.context;
    this.parent = options.parent ?? options.context.scene;
    this.scene = options.context.scene;

    this.root = new THREE.Group();
    this.root.name = SKY_ROOT_NAME;

    this.domeMaterial = new THREE.ShaderMaterial({
      name: 'chrono-sky-material',
      uniforms: {
        uTop: { value: new THREE.Color(0x9fb3c8) },
        uHorizon: { value: new THREE.Color(0xcdbfa8) },
        uGround: { value: new THREE.Color(0x4a4238) },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffe6c2) },
        uMoonColor: { value: new THREE.Color(0x9fb6d8) },
        uSunIntensity: { value: 1 },
        uMoonVisibility: { value: 0 },
        uHaze: { value: 0.4 },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_DOME_RADIUS, 32, 20),
      this.domeMaterial,
    );
    this.dome.name = 'chrono-sky-dome';
    this.dome.frustumCulled = false;
    this.root.add(this.dome);

    this.sunDisc = this.buildDisc(0xfff2d0, 'chrono-sun-disc');
    this.moonDisc = this.buildDisc(0xdbe6f6, 'chrono-moon-disc');
    this.sunDisc.visible = false;
    this.moonDisc.visible = false;
    this.root.add(this.sunDisc);
    this.root.add(this.moonDisc);

    this.sun = new THREE.DirectionalLight(0xffe6c2, 1);
    this.sun.name = SUN_LIGHT_NAME;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = CELESTIAL_DISTANCE * 2;
    this.sun.shadow.camera.left = -ROAD_OUTER_X - 8;
    this.sun.shadow.camera.right = ROAD_OUTER_X + 8;
    this.sun.shadow.camera.top = ROAD_OUTER_Z + 8;
    this.sun.shadow.camera.bottom = -ROAD_OUTER_Z - 8;
    this.sun.shadow.bias = -0.0006;
    this.root.add(this.sun);
    this.root.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x9fb6d8, 0);
    this.moon.name = MOON_LIGHT_NAME;
    this.moon.castShadow = false;
    this.root.add(this.moon);
    this.root.add(this.moon.target);

    this.ambient = new THREE.AmbientLight(0x5a6472, 0.55);
    this.ambient.name = 'chrono-ambient';
    this.root.add(this.ambient);

    this.hemisphere = new THREE.HemisphereLight(0x9fb3c8, 0x4a4238, 0.6);
    this.hemisphere.name = 'chrono-hemisphere';
    this.root.add(this.hemisphere);

    for (const config of PARTICLE_BEDS) {
      const pool = new ParticlePool(config, options.context.random.fork(`particles-${config.kind}`));
      this.pools.set(config.kind, pool);
      this.root.add(pool.points);
    }

    this.parent.add(this.root);

    const initial = assertEraId(options.initialEra ?? '2025');
    this.fromEra = initial;
    this.toEra = initial;
    this.descriptorState = getEraDescriptor(initial);
    this.atmosphereState = blendAtmosphereDescriptors(initial, initial, 1);
    this.applyBlend(initial, initial, 1, this.descriptorState);
  }

  /* ---------------- state ---------------- */

  get era(): EraId {
    return this.toEra;
  }

  get from(): EraId {
    return this.fromEra;
  }

  get progress(): number {
    return this.progressState;
  }

  get isTransitioning(): boolean {
    return this.fromEra !== this.toEra;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** Snaps sky, fog, lights and particles to an era. */
  applyEra(era: EraId): void {
    const target = assertEraId(era);
    this.applyBlend(target, target, 1, getEraDescriptor(target));
  }

  /**
   * Applies one frame of the era tween. The descriptor is the era-blended
   * `EraTimelineDescriptor` (sky/fog/lighting/exposure already interpolated);
   * this rig adds its own particle strengths on top.
   */
  applyBlend(
    from: EraId,
    to: EraId,
    progress: number,
    descriptor: EraTimelineDescriptor,
  ): void {
    if (this.disposedState) return;
    const source = assertEraId(from);
    const target = assertEraId(to);
    const t = clamp01(progress);
    this.fromEra = source;
    this.toEra = target;
    this.progressState = t;
    this.descriptorState = descriptor;
    this.atmosphereState = blendAtmosphereDescriptors(source, target, t);

    const { palette, fog, lighting } = descriptor;

    const uniforms = this.domeMaterial.uniforms;
    (uniforms.uTop.value as THREE.Color).setHex(palette.sky);
    (uniforms.uHorizon.value as THREE.Color).setHex(palette.skyHorizon);
    (uniforms.uGround.value as THREE.Color).setHex(palette.ground);
    (uniforms.uSunColor.value as THREE.Color).setHex(lighting.sunColor);
    uniforms.uSunIntensity.value = lighting.sunIntensity;
    uniforms.uHaze.value = this.atmosphereState.horizonHaze;

    this.applySun(lighting.sunElevationDeg, lighting.sunAzimuthDeg);
    this.applyMoon(lighting.sunElevationDeg, lighting.sunAzimuthDeg);
    this.applyFog(fog);
    this.applyLights(lighting);

    for (const kind of PARTICLE_KINDS) {
      const pool = this.pools.get(kind);
      if (!pool) continue;
      pool.setPresence(this.atmosphereState[kind]);
      if (kind === 'neonHaze' || kind === 'dust') pool.setTint(palette.emissive);
    }

    this.publishExposure(lighting.exposure);
    this.scene.background = null;
  }

  /** One render frame: advances particles and keeps the dome centred. */
  tick(frame: FrameInfo): void {
    if (this.disposedState) return;
    this.tickCountState += 1;
    const delta = frame?.delta ?? 0;
    for (const pool of this.pools.values()) pool.update(delta);

    const camera = this.context.camera;
    if (camera) {
      this.dome.position.copy(camera.position);
      this.sunDisc.position.copy(camera.position).addScaledVector(this.sunDirection, 320);
      this.moonDisc.position
        .copy(camera.position)
        .addScaledVector(this.sunDirection, -320);
    }
  }

  /* ---------------- observation ---------------- */

  snapshot(): SkyLightingSnapshot {
    const { palette, fog, lighting } = this.descriptorState;
    const particles: ParticleBedSnapshot[] = [];
    let capacity = 0;
    let active = 0;
    for (const kind of PARTICLE_KINDS) {
      const pool = this.pools.get(kind);
      if (!pool) continue;
      const bed = pool.snapshot();
      particles.push(bed);
      capacity += bed.capacity;
      active += bed.active;
    }

    return Object.freeze({
      version: SKY_LIGHTING_VERSION,
      era: this.toEra,
      from: this.fromEra,
      to: this.toEra,
      progress: this.progressState,
      transitioning: this.fromEra !== this.toEra,
      sky: Object.freeze({
        topColor: palette.sky,
        horizonColor: palette.skyHorizon,
        groundColor: palette.ground,
        radius: SKY_DOME_RADIUS,
        sunDirection: freezeDirection(this.sunDirection),
        sunAboveHorizon: this.sunDirection.y > 0,
      }),
      fog: Object.freeze({
        color: fog.color,
        mode: fog.mode,
        near: fog.near,
        far: fog.far,
        density: fog.density,
      }),
      exposure: lighting.exposure,
      contrast: lighting.contrast,
      ambient: Object.freeze({ color: lighting.ambientColor, intensity: lighting.ambientIntensity }),
      hemisphere: Object.freeze({
        skyColor: lighting.hemisphereSkyColor,
        groundColor: lighting.hemisphereGroundColor,
        intensity: lighting.ambientIntensity,
      }),
      lighting: Object.freeze({
        mood: lighting.mood,
        sunColor: lighting.sunColor,
        sunIntensity: lighting.sunIntensity,
        sunElevationDeg: lighting.sunElevationDeg,
        sunAzimuthDeg: lighting.sunAzimuthDeg,
        moonVisible: this.moonVisibleState,
        moonIntensity: this.moonIntensityState,
        lightCount: 4,
      }),
      particles: Object.freeze(particles),
      particleCapacity: capacity,
      particleActive: active,
      particleBudgetShare: capacity === 0 ? 0 : active / capacity,
      tickCount: this.tickCountState,
    });
  }

  /** Read-only grade inputs for the post-processing task. Pure and cheap. */
  gradeState(): EnvironmentGradeState {
    const { palette, fog, lighting } = this.descriptorState;
    return Object.freeze({
      exposure: lighting.exposure,
      contrast: lighting.contrast,
      skyTopColor: palette.sky,
      skyHorizonColor: palette.skyHorizon,
      fogColor: fog.color,
      fogMode: fog.mode,
      fogNear: fog.near,
      fogFar: fog.far,
      fogDensity: fog.density,
      ambientColor: lighting.ambientColor,
      ambientIntensity: lighting.ambientIntensity,
      neonIntensity: this.atmosphereState.neonHaze,
      sourceEra: this.toEra,
    });
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.dome.geometry.dispose();
    this.domeMaterial.dispose();
    this.sunDisc.geometry.dispose();
    (this.sunDisc.material as THREE.Material).dispose();
    this.moonDisc.geometry.dispose();
    (this.moonDisc.material as THREE.Material).dispose();
    this.scene.fog = null;
    this.root.removeFromParent();
    this.root.clear();
  }

  /* ---------------- internals ---------------- */

  private buildDisc(color: number, name: string): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(18, 18, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false }),
    );
    mesh.name = name;
    mesh.frustumCulled = false;
    return mesh;
  }

  private applySun(elevationDeg: number, azimuthDeg: number): void {
    const elevation = THREE.MathUtils.degToRad(elevationDeg);
    const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
    const horizontal = Math.cos(elevation);
    this.sunDirection.set(
      horizontal * Math.sin(azimuth),
      Math.sin(elevation),
      -horizontal * Math.cos(azimuth),
    );
    (this.domeMaterial.uniforms.uSunDirection.value as THREE.Vector3).copy(this.sunDirection);
    this.sunDisc.visible = true;
    this.sun.position.copy(this.sunDirection).multiplyScalar(CELESTIAL_DISTANCE);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
  }

  private applyMoon(elevationDeg: number, azimuthDeg: number): void {
    const nightness = clamp01((MOON_RISE_ELEVATION_DEG - elevationDeg) / MOON_RISE_ELEVATION_DEG);
    const intensity = this.atmosphereState.moonIntensity * nightness;
    this.moonVisibleState = intensity > 0.02;
    this.moonIntensityState = intensity;
    this.moon.intensity = intensity;
    (this.domeMaterial.uniforms.uMoonVisibility.value as number) = this.moonVisibleState
      ? Math.max(0.15, intensity)
      : 0;

    const moonAzimuth = THREE.MathUtils.degToRad(azimuthDeg + 180);
    const moonElevation = THREE.MathUtils.degToRad(Math.max(18, elevationDeg + 40));
    const horizontal = Math.cos(moonElevation);
    const direction = new THREE.Vector3(
      horizontal * Math.sin(moonAzimuth),
      Math.sin(moonElevation),
      -horizontal * Math.cos(moonAzimuth),
    );
    this.moon.position.copy(direction).multiplyScalar(CELESTIAL_DISTANCE);
    this.moon.target.position.set(0, 0, 0);
    this.moon.target.updateMatrixWorld();
    this.moonVisibleState = this.moonVisibleState && this.moon.intensity > 0.02;

    const discOpacity = this.moonVisibleState ? 0.85 : 0;
    (this.moonDisc.material as THREE.MeshBasicMaterial).opacity = discOpacity;
    const sunOpacity = elevationDeg > -6 ? 0.95 : 0;
    (this.sunDisc.material as THREE.MeshBasicMaterial).opacity = sunOpacity;
    const scale = this.atmosphereState.discScale;
    this.sunDisc.scale.setScalar(scale);
    this.moonDisc.scale.setScalar(scale * 0.78);
  }

  private applyFog(fog: EraTimelineDescriptor['fog']): void {
    if (fog.mode === 'exponential') {
      this.exponentialFog.color.setHex(fog.color);
      this.exponentialFog.density = fog.density;
      this.scene.fog = this.exponentialFog;
    } else {
      this.linearFog.color.setHex(fog.color);
      this.linearFog.near = fog.near;
      this.linearFog.far = fog.far;
      this.scene.fog = this.linearFog;
    }
    // Keep the far plane comfortably beyond the fog so the horizon never clips.
    this.context.camera.far = Math.max(
      this.context.camera.far,
      fog.mode === 'linear' ? fog.far * 4 : 1600,
    );
    this.context.camera.updateProjectionMatrix();
  }

  private applyLights(lighting: EraTimelineDescriptor['lighting']): void {
    this.sun.color.setHex(lighting.sunColor);
    this.sun.intensity = lighting.sunIntensity;
    this.ambient.color.setHex(lighting.ambientColor);
    this.ambient.intensity = lighting.ambientIntensity;
    this.hemisphere.color.setHex(lighting.hemisphereSkyColor);
    this.hemisphere.groundColor.setHex(lighting.hemisphereGroundColor);
    this.hemisphere.intensity = 0.55;
  }

  private publishExposure(exposure: number): void {
    const renderer = this.context.renderer as THREE.WebGLRenderer & {
      toneMappingExposure?: number;
    };
    if (renderer && typeof renderer === 'object') {
      renderer.toneMappingExposure = exposure;
    }
    this.exposureState = exposure;
  }

  /** The last exposure this rig pushed into the renderer. */
  get exposure(): number {
    return this.exposureState;
  }
}

/** Creates the sky, lighting rig and particle beds (the `create` half). */
export function createSkyLighting(options: SkyLightingOptions): SkyLightingRig {
  return new SkyLightingRig(options);
}

/** Eras this module authors an atmosphere for, in timeline order. */
export const ATMOSPHERE_ERAS: readonly EraId[] = ERA_IDS;

/** The authored descriptor of one era, re-exported for content probes. */
export function eraSkyDescriptor(era: EraId): EraTimelineDescriptor {
  return ERA_DESCRIPTORS[assertEraId(era)];
}
