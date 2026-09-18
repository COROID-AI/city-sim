/**
 * Post-processing chain for the neon holographic factory floor.
 *
 * Why the chain runs in-scene
 * ---------------------------
 * The shared render adapter (`./renderer`) owns one opaque
 * `renderer.render(scene, camera)` call and deliberately does not expose the
 * `WebGLRenderer` instance, so a render-target composer (`EffectComposer` +
 * `UnrealBloomPass`) cannot be inserted into the frame. The chain therefore
 * implements the same three effects as scene-graph passes that every adapter —
 * WebGL *and* headless — drives through the identical code path:
 *
 *  1. `glow`   — additive halo sprites anchored on **emissive** elements only,
 *                so the bloom threshold is explicit and only glowing geometry
 *                blooms (see `collectEmissiveAnchors`);
 *  2. `rays`   — additive volumetric shafts fanning out of the holo core: the
 *                god-ray pass, deterministic (golden-angle fan, never random);
 *  3. `screen` — one camera-locked overlay quad carrying the vignette, the
 *                restrained chromatic-aberration fringe and the film grain.
 *
 * Quality presets
 * ---------------
 * A preset is a plain record of costs: halo rings per anchor, glow scale and
 * opacity, god-ray count and intensity, aberration, vignette and grain. Every
 * preset is applied by toggling visibility on a fixed pool of resources, so
 * switching quality never allocates, never leaks and never changes the shape of
 * the dispose lifecycle.
 *
 * Everything is procedural: the glow texel field is generated in memory, there
 * are no external assets and no runtime network requests.
 */

import {
  AdditiveBlending,
  Box3,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  UnsignedByteType,
  Vector3,
  type IUniform,
  type Material,
  type Object3D,
  type PerspectiveCamera,
} from 'three';

/* -------------------------------------------------------------------------- */
/* Quality presets                                                            */
/* -------------------------------------------------------------------------- */

/** Cost tiers the renderer, the settings menu and the preview page share. */
export const POST_QUALITY_PRESETS = ['low', 'medium', 'high', 'ultra'] as const;

export type PostQualityPreset = (typeof POST_QUALITY_PRESETS)[number];

/** Tier used when a caller does not name one. */
export const DEFAULT_POST_QUALITY: PostQualityPreset = 'high';

/** Everything a preset decides, in one serialisable record. */
export interface PostQualitySettings {
  readonly preset: PostQualityPreset;
  /** Halo sprites drawn per emissive anchor; the body of the bloom. */
  readonly haloRings: number;
  /** Halo diameter as a multiple of the anchor radius. */
  readonly glowScale: number;
  /** Peak opacity of the innermost halo. */
  readonly glowOpacity: number;
  /** Volumetric shafts in the god-ray fan. */
  readonly rayCount: number;
  /** Multiplier on every shaft's brightness. */
  readonly rayIntensity: number;
  /** Lateral chromatic-aberration weight at the frame edge, in normalized units. */
  readonly aberration: number;
  /** Peak vignette darkening at the frame edge, 0..1. */
  readonly vignette: number;
  /** Film-grain weight, 0..1. */
  readonly grain: number;
}

/**
 * The four cost tiers.
 *
 * `low` keeps the floor readable on integrated GPUs (one halo ring, no
 * aberration), `ultra` is the hero framing used for marketing captures (three
 * halo rings, a 22-shaft god-ray fan). Aberration stays under `0.003` at every
 * tier: the art direction asks for restraint, not a broken lens.
 */
export const POST_QUALITY_SETTINGS: Readonly<Record<PostQualityPreset, PostQualitySettings>> = {
  low: {
    preset: 'low',
    haloRings: 1,
    glowScale: 1.15,
    glowOpacity: 0.16,
    rayCount: 4,
    rayIntensity: 0.55,
    aberration: 0,
    vignette: 0.34,
    grain: 0.01,
  },
  medium: {
    preset: 'medium',
    haloRings: 2,
    glowScale: 1.35,
    glowOpacity: 0.2,
    rayCount: 8,
    rayIntensity: 0.78,
    aberration: 0.0009,
    vignette: 0.42,
    grain: 0.016,
  },
  high: {
    preset: 'high',
    haloRings: 3,
    glowScale: 1.55,
    glowOpacity: 0.24,
    rayCount: 14,
    rayIntensity: 1,
    aberration: 0.0016,
    vignette: 0.5,
    grain: 0.022,
  },
  ultra: {
    preset: 'ultra',
    haloRings: 3,
    glowScale: 1.75,
    glowOpacity: 0.3,
    rayCount: 22,
    rayIntensity: 1.25,
    aberration: 0.0024,
    vignette: 0.58,
    grain: 0.028,
  },
};

/** Halo sprites allocated per anchor: the largest preset that can be applied. */
export const MAX_POST_HALO_RINGS = 3;
/** Volumetric shafts allocated: the largest preset that can be applied. */
export const MAX_POST_RAYS = 22;
/** Emissive anchors the chain will bloom at once. */
export const MAX_POST_ANCHORS = 48;
/** Luminance an emissive material must reach before it is allowed to bloom. */
export const BLOOM_EMISSIVE_THRESHOLD = 0.1;
/** Texel size of the procedural radial glow field. */
export const GLOW_TEXTURE_SIZE = 64;
/** Render order of the camera-locked screen pass: last, over every transparent. */
export const SCREEN_PASS_RENDER_ORDER = 9999;

/** Resolve a preset name (or an absent/unknown one) to its settings record. */
export function resolveQualitySettings(
  preset?: PostQualityPreset | null,
): PostQualitySettings {
  if (preset && preset in POST_QUALITY_SETTINGS) return POST_QUALITY_SETTINGS[preset];
  return POST_QUALITY_SETTINGS[DEFAULT_POST_QUALITY];
}

/* -------------------------------------------------------------------------- */
/* Emissive anchors                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One bright element the bloom body is anchored to, in world space.
 *
 * Anchors are **live handles**: the chain re-reads `radius`, `intensity` and
 * `color` on every frame, so a caller can animate an anchor in place — pulse a
 * lane bar, dim a failed gate — without re-registering the anchor set.
 */
export interface EmissiveAnchor {
  /** Stable identity (`object.name` when set, otherwise the uuid). */
  id: string;
  position: Vector3;
  color: Color;
  /** Half the largest bounding-box dimension, in world units. */
  radius: number;
  /** Brightness relative to the bloom threshold, clamped to 0.15..2. */
  intensity: number;
}

export interface EmissiveAnchorOptions {
  /** Emissive luminance a material must reach. Defaults to `BLOOM_EMISSIVE_THRESHOLD`. */
  threshold?: number;
  /** Anchors smaller than this are noise, not glow. Defaults to `0.35`. */
  minRadius?: number;
  /** Anchors larger than this are rigs and backdrops, not glows. Defaults to `12`. */
  maxRadius?: number;
  /** Cap on returned anchors, brightest first. Defaults to `MAX_POST_ANCHORS`. */
  maxAnchors?: number;
  /** Treat additive-blended meshes (hologram panels, columns, beams) as emissive. */
  includeAdditive?: boolean;
}

const LUMINANCE_WEIGHTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

function luminance(color: Color): number {
  return color.r * LUMINANCE_WEIGHTS.r + color.g * LUMINANCE_WEIGHTS.g + color.b * LUMINANCE_WEIGHTS.b;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Whether an object and every ancestor is visible. */
function isVisibleChain(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

/** The emissive contribution of one material, or `null` when it does not glow. */
function emissiveOf(
  material: Material | undefined,
  includeAdditive: boolean,
): { color: Color; brightness: number } | null {
  if (!material || material.visible === false) return null;

  const emissive = (material as { emissive?: unknown }).emissive;
  if (emissive instanceof Color) {
    const intensity = (material as { emissiveIntensity?: number }).emissiveIntensity ?? 1;
    return { color: emissive, brightness: luminance(emissive) * Math.abs(intensity) };
  }

  const color = (material as { color?: unknown }).color;
  if (includeAdditive && material.blending === AdditiveBlending && color instanceof Color) {
    return { color, brightness: luminance(color) };
  }
  return null;
}

/**
 * Collect the elements that are allowed to bloom.
 *
 * The rule is the art direction, verbatim: **only emissive elements glow**.
 * A material qualifies when its `emissive` colour reaches the luminance
 * threshold (scaled by `emissiveIntensity`), or — for additive hologram
 * geometry that has no `emissive` channel — when its `color` is bright enough.
 * Plain lit materials, backdrops and oversized rigs are rejected, so ambient
 * geometry never smears into haze.
 */
export function collectEmissiveAnchors(
  root: Object3D,
  options: EmissiveAnchorOptions = {},
): EmissiveAnchor[] {
  const threshold = options.threshold ?? BLOOM_EMISSIVE_THRESHOLD;
  const minRadius = options.minRadius ?? 0.35;
  const maxRadius = options.maxRadius ?? 12;
  const maxAnchors = options.maxAnchors ?? MAX_POST_ANCHORS;
  const includeAdditive = options.includeAdditive ?? true;

  root.updateMatrixWorld(true);

  const anchors: EmissiveAnchor[] = [];
  const visited = new Set<Object3D>();
  const box = new Box3();

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh || visited.has(mesh)) return;
    if (!isVisibleChain(mesh)) return;

    const material = mesh.material;
    const list = Array.isArray(material) ? material : [material];
    let best: { color: Color; brightness: number } | null = null;
    for (const entry of list) {
      const candidate = emissiveOf(entry, includeAdditive);
      if (!candidate) continue;
      if (!best || candidate.brightness > best.brightness) best = candidate;
    }
    if (!best || best.brightness < threshold) return;

    visited.add(mesh);
    box.setFromObject(mesh);
    if (box.isEmpty()) return;

    const size = box.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z) / 2;
    if (radius < minRadius || radius > maxRadius) return;

    anchors.push({
      id: mesh.name.length > 0 ? mesh.name : mesh.uuid,
      position: box.getCenter(new Vector3()),
      color: best.color.clone(),
      radius,
      intensity: clamp(best.brightness / 0.8, 0.15, 2),
    });
  });

  anchors.sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id));
  return anchors.slice(0, maxAnchors);
}

/**
 * Generate the radial glow field used by every halo sprite.
 *
 * White texels with a quadratic alpha falloff: the sprite material supplies the
 * colour, so one texture serves the whole factory floor.
 */
export function createGlowTexture(size: number = GLOW_TEXTURE_SIZE): DataTexture {
  const dimension = Math.max(8, Math.floor(size));
  const data = new Uint8Array(dimension * dimension * 4);
  const center = (dimension - 1) / 2;

  for (let y = 0; y < dimension; y += 1) {
    for (let x = 0; x < dimension; x += 1) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const radius = Math.min(1, Math.hypot(dx, dy));
      const falloff = Math.pow(1 - radius, 2.4);
      const index = (y * dimension + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(falloff * 255);
    }
  }

  const texture = new DataTexture(data, dimension, dimension, RGBAFormat, UnsignedByteType);
  texture.name = 'post-glow';
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/* -------------------------------------------------------------------------- */
/* Shaders                                                                    */
/* -------------------------------------------------------------------------- */

const RAY_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Volumetric shaft: bright at the emitter (`uv.y == 1`), fading to the tip. */
const RAY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    float along = pow(clamp(vUv.y, 0.0, 1.0), 1.7);
    float stripe = 0.78 + 0.22 * sin(vUv.x * 34.0 + uTime * 0.9);
    float breathe = 0.82 + 0.18 * sin(uTime * 0.55);
    gl_FragColor = vec4(uColor * uIntensity * along * stripe * breathe, 1.0);
  }
`;

/**
 * Screen pass: vignette, restrained lateral chromatic aberration and grain.
 *
 * The quad is composited with normal blending so the vignette can darken the
 * frame; the fringe and the grain are weighted averages, which keeps the deep
 * indigo backdrop near-black in the centre of the frame.
 */
const SCREEN_FRAGMENT_SHADER = /* glsl */ `
  uniform float uVignette;
  uniform float uAberration;
  uniform float uGrain;
  uniform float uTime;
  uniform float uAspect;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 centered = (vUv - 0.5) * 2.0;
    centered.x *= uAspect;
    float corner = length(vec2(uAspect, 1.0));
    float radius = clamp(length(centered) / corner, 0.0, 1.0);

    float vignette = uVignette * pow(smoothstep(0.34, 1.0, radius), 1.45);

    vec2 dir = normalize(centered + vec2(1e-4, 1e-4));
    float side = clamp(dot(dir, normalize(vec2(0.36, 0.93))), -1.0, 1.0);
    vec3 fringe = mix(vec3(0.16, 0.79, 1.0), vec3(1.0, 0.28, 0.52), side * 0.5 + 0.5);
    float ring = exp(-pow((radius - 0.88) / 0.16, 2.0));
    float fringeAlpha = clamp(uAberration * 90.0 * ring, 0.0, 0.5);

    float speckle = hash(vUv * (1.0 + floor(uTime * 2.0)));
    float grainAlpha = uGrain * speckle;

    float alpha = clamp(vignette + fringeAlpha + grainAlpha, 0.0, 1.0);
    vec3 rgb = (fringe * fringeAlpha + vec3(speckle) * grainAlpha) / max(alpha, 1e-5);
    gl_FragColor = vec4(rgb, alpha);
  }
`;

const SCREEN_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* -------------------------------------------------------------------------- */
/* God-ray fan geometry                                                       */
/* -------------------------------------------------------------------------- */

/** Where the god-ray fan originates, in world units. */
const RAY_ORIGIN = new Vector3(0, 16, 0);
/** Deterministic golden-angle fan: index x 2.3999… radians, never random. */
const GOLDEN_ANGLE = 2.399963229728653;
/** Shaft colours, cycled deterministically so the fan reads as volume, not a beam. */
const RAY_TINTS = [0x6ff4ff, 0xffd9a0, 0xff8fe4] as const;
/** World-space length of the shortest and longest shaft. */
const RAY_LENGTH_NEAR = 15;
const RAY_LENGTH_SPAN = 8;
/** Distance the screen pass quad floats in front of the camera. */
const SCREEN_PASS_DISTANCE = 0.5;
/** Overshoot so the aberration band is never clipped by the frame edge. */
const SCREEN_PASS_OVERSHOOT = 1.08;

/* -------------------------------------------------------------------------- */
/* Post chain                                                                 */
/* -------------------------------------------------------------------------- */

export interface PostChainOptions {
  /** Scene root the glow and ray groups attach to (usually `adapter.scene`). */
  host: Object3D;
  /** Camera the screen pass locks onto every frame. */
  camera: PerspectiveCamera;
  /** Starting quality tier. Defaults to `DEFAULT_POST_QUALITY`. */
  preset?: PostQualityPreset;
  /** Emissive elements allowed to bloom. Typically `collectEmissiveAnchors(...)`. */
  anchors?: readonly EmissiveAnchor[];
  /** Viewport size, used for the screen pass aspect before the first resize. */
  width?: number;
  height?: number;
}

export interface PostChain {
  /** Chain root; owns the glow group, the ray fan and the screen pass. */
  readonly root: Group;
  readonly preset: PostQualityPreset;
  readonly settings: PostQualitySettings;
  /** Anchors currently allowed to bloom. */
  readonly anchors: readonly EmissiveAnchor[];
  /** Halo sprites, one pool per anchor. */
  readonly glow: Group;
  /** Volumetric shafts, one pool for the whole fan. */
  readonly rays: Group;
  /** Camera-locked vignette / aberration / grain quad. */
  readonly screen: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly disposed: boolean;
  /** Halo sprites the active preset draws. */
  readonly visibleHalos: number;
  /** Shafts the active preset draws. */
  readonly visibleRays: number;
  /** Seconds of chain time elapsed; feeds every shader clock. */
  readonly time: number;
  setPreset(preset: PostQualityPreset): void;
  setAnchors(anchors: readonly EmissiveAnchor[]): void;
  setSize(width: number, height: number): void;
  /** Advance the chain and place the screen pass on the camera. Draw-time only. */
  update(deltaMs: number, elapsedMs?: number): void;
  dispose(): void;
}

interface HaloSlot {
  readonly sprite: Sprite;
  readonly material: SpriteMaterial;
}

/**
 * Build the post chain over a scene root.
 *
 * The chain allocates its halo pool for the anchors it is handed (up to
 * `MAX_POST_ANCHORS`) and its full `MAX_POST_RAYS` shaft pool once; every preset
 * is applied by toggling visibility, so quality changes are allocation-free and
 * `dispose()` releases a fixed set of geometries, materials and one texture.
 */
export function createPostChain(options: PostChainOptions): PostChain {
  const { host, camera } = options;

  let settings = resolveQualitySettings(options.preset);
  let anchors: readonly EmissiveAnchor[] = options.anchors ? [...options.anchors] : [];
  let anchorCapacity = 0;
  let disposed = false;
  let time = 0;
  let viewport = {
    width: Math.max(1, options.width ?? 1280),
    height: Math.max(1, options.height ?? 720),
  };

  const root = new Group();
  root.name = 'post-chain';
  host.add(root);

  const glow = new Group();
  glow.name = 'post-glow-halos';
  const rays = new Group();
  rays.name = 'post-god-rays';
  root.add(glow, rays);

  /* ------------------------------------------------------------ glow halos */
  const glowTexture = createGlowTexture();
  const haloSlots: HaloSlot[] = [];
  let visibleHalos = 0;

  function ensureHaloCapacity(required: number): void {
    if (required <= anchorCapacity) return;
    for (let index = anchorCapacity; index < required; index += 1) {
      for (let ring = 0; ring < MAX_POST_HALO_RINGS; ring += 1) {
        const material = new SpriteMaterial({
          map: glowTexture,
          color: 0x9ffbff,
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
          depthTest: true,
        });
        const sprite = new Sprite(material);
        sprite.name = `post-halo-${index}-${ring}`;
        sprite.visible = false;
        sprite.renderOrder = 1;
        glow.add(sprite);
        haloSlots.push({ sprite, material });
      }
    }
    anchorCapacity = required;
  }

  function syncHalos(): void {
    const pulseTime = time;
    let visible = 0;
    const slotCount = anchorCapacity * MAX_POST_HALO_RINGS;

    for (let anchorIndex = 0; anchorIndex < anchorCapacity; anchorIndex += 1) {
      const anchor = anchors[anchorIndex];
      for (let ring = 0; ring < MAX_POST_HALO_RINGS; ring += 1) {
        const slot = haloSlots[anchorIndex * MAX_POST_HALO_RINGS + ring];
        if (!slot) continue;
        const draw = anchor !== undefined && ring < settings.haloRings;
        slot.sprite.visible = draw;
        if (!draw || !anchor) continue;

        const phase = anchorIndex * 0.7 + ring * 1.3;
        const pulse = 1 + 0.08 * Math.sin(pulseTime * 1.7 + phase);
        const diameter = anchor.radius * settings.glowScale * (1 + ring * 0.55) * pulse;
        slot.sprite.position.copy(anchor.position);
        slot.sprite.scale.set(diameter, diameter, 1);
        slot.material.color.copy(anchor.color);
        slot.material.opacity = clamp(
          settings.glowOpacity * anchor.intensity * (1 - ring * 0.22) * (1 + 0.1 * Math.sin(pulseTime * 1.1 + phase)),
          0,
          0.85,
        );
        visible += 1;
      }
    }

    for (let index = slotCount; index < haloSlots.length; index += 1) {
      const spare = haloSlots[index];
      if (spare) spare.sprite.visible = false;
    }
    visibleHalos = visible;
  }

  /* ---------------------------------------------------------- god-ray fan */
  const rayGeometry = new CylinderGeometry(0.3, 1, 1, 12, 1, true);
  rayGeometry.name = 'post-ray-shaft';
  const rayMaterials: ShaderMaterial[] = [];
  const rayMeshes: Mesh<CylinderGeometry, ShaderMaterial>[] = [];
  let visibleRays = 0;

  {
    const up = new Vector3(0, 1, 0);
    const direction = new Vector3();
    const quaternion = new Quaternion();
    for (let index = 0; index < MAX_POST_RAYS; index += 1) {
      const angle = index * GOLDEN_ANGLE;
      const band = index % 3;
      // Tangent of the tilt away from vertical: inner shafts stand up straight,
      // outer shafts lean out, which reads as a volumetric burst rather than a
      // set of parallel beams.
      const tilt = 0.14 + band * 0.09 + (index / MAX_POST_RAYS) * 0.12;
      const length = RAY_LENGTH_NEAR + (index % 4) * (RAY_LENGTH_SPAN / 3);
      const tint = RAY_TINTS[index % RAY_TINTS.length] ?? RAY_TINTS[0];

      const material = new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(tint) },
          uIntensity: { value: settings.rayIntensity },
          uTime: { value: 0 },
        },
        vertexShader: RAY_VERTEX_SHADER,
        fragmentShader: RAY_FRAGMENT_SHADER,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        toneMapped: false,
      });

      direction
        .set(Math.cos(angle) * Math.sin(tilt), -Math.cos(tilt), Math.sin(angle) * Math.sin(tilt))
        .normalize();

      const mesh = new Mesh(rayGeometry, material);
      mesh.name = `post-ray-${index}`;
      // Local +Y maps to the emitter end of the shaft, so `uv.y == 1` is the
      // bright source and the geometry tapers toward the floor.
      quaternion.setFromUnitVectors(up, direction.clone().negate());
      mesh.quaternion.copy(quaternion);
      mesh.position.copy(RAY_ORIGIN).addScaledVector(direction, length / 2);
      mesh.scale.set(0.7 + band * 0.22, length, 0.7 + band * 0.22);
      mesh.visible = false;
      mesh.renderOrder = 2;
      rays.add(mesh);
      rayMaterials.push(material);
      rayMeshes.push(mesh);
    }
  }

  /** Typed view of a material's uniform record (three types them loosely). */
  function uniformsOf<T>(material: ShaderMaterial): T {
    return material.uniforms as unknown as T;
  }

  function syncRays(): void {
    let visible = 0;
    for (let index = 0; index < rayMeshes.length; index += 1) {
      const mesh = rayMeshes[index];
      const material = rayMaterials[index];
      if (!mesh || !material) continue;
      const draw = index < settings.rayCount;
      mesh.visible = draw;
      const uniforms = uniformsOf<{ uIntensity: IUniform<number> }>(material);
      uniforms.uIntensity.value = settings.rayIntensity;
      if (draw) visible += 1;
    }
    visibleRays = visible;
  }

  /* ------------------------------------------------------------ screen pass */
  const screenGeometry = new PlaneGeometry(1, 1);
  screenGeometry.name = 'post-screen-quad';
  const screenMaterial = new ShaderMaterial({
    uniforms: {
      uVignette: { value: settings.vignette },
      uAberration: { value: settings.aberration },
      uGrain: { value: settings.grain },
      uTime: { value: 0 },
      uAspect: { value: viewport.width / viewport.height },
    },
    vertexShader: SCREEN_VERTEX_SHADER,
    fragmentShader: SCREEN_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const screen = new Mesh(screenGeometry, screenMaterial);
  screen.name = 'post-screen-vignette';
  screen.renderOrder = SCREEN_PASS_RENDER_ORDER;
  screen.frustumCulled = false;
  root.add(screen);

  function placeScreen(): void {
    const aspect = camera.aspect > 0 ? camera.aspect : viewport.width / viewport.height;
    const height =
      2 * Math.tan(((camera.fov * Math.PI) / 180) / 2) * SCREEN_PASS_DISTANCE * SCREEN_PASS_OVERSHOOT;
    screen.position.copy(camera.position);
    screen.quaternion.copy(camera.quaternion);
    screen.translateZ(-SCREEN_PASS_DISTANCE);
    screen.scale.set(height * aspect, height, 1);
    uniformsOf<{ uAspect: IUniform<number> }>(screenMaterial).uAspect.value = aspect;
  }

  function applyPreset(next: PostQualityPreset): void {
    settings = resolveQualitySettings(next);
    syncHalos();
    syncRays();
    const uniforms = uniformsOf<{
      uVignette: IUniform<number>;
      uAberration: IUniform<number>;
      uGrain: IUniform<number>;
    }>(screenMaterial);
    uniforms.uVignette.value = settings.vignette;
    uniforms.uAberration.value = settings.aberration;
    uniforms.uGrain.value = settings.grain;
  }

  // Seed the chain in the requested tier.
  ensureHaloCapacity(anchors.length);
  applyPreset(settings.preset);
  placeScreen();

  return {
    root,
    get preset() {
      return settings.preset;
    },
    get settings() {
      return settings;
    },
    get anchors() {
      return anchors;
    },
    glow,
    rays,
    screen,
    get disposed() {
      return disposed;
    },
    get visibleHalos() {
      return visibleHalos;
    },
    get visibleRays() {
      return visibleRays;
    },
    get time() {
      return time;
    },
    setPreset(next: PostQualityPreset): void {
      if (disposed) return;
      applyPreset(next);
    },
    setAnchors(next: readonly EmissiveAnchor[]): void {
      if (disposed) return;
      anchors = [...next];
      ensureHaloCapacity(anchors.length);
      syncHalos();
    },
    setSize(width: number, height: number): void {
      viewport = { width: Math.max(1, width), height: Math.max(1, height) };
    },
    update(deltaMs: number, elapsedMs?: number): void {
      if (disposed) return;
      time = elapsedMs === undefined ? time + Math.max(0, deltaMs) / 1000 : Math.max(0, elapsedMs) / 1000;

      for (const material of rayMaterials) {
        uniformsOf<{ uTime: IUniform<number> }>(material).uTime.value = time;
      }
      uniformsOf<{ uTime: IUniform<number> }>(screenMaterial).uTime.value = time;
      syncHalos();
      placeScreen();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;

      for (const slot of haloSlots) slot.material.dispose();
      haloSlots.length = 0;
      glow.clear();

      for (const material of rayMaterials) material.dispose();
      rayMaterials.length = 0;
      rayMeshes.length = 0;
      rays.clear();
      rayGeometry.dispose();

      screenMaterial.dispose();
      screenGeometry.dispose();

      glowTexture.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
}
