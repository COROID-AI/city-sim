import * as THREE from "three";

/**
 * Renderer, camera and placeholder scene for Chrono City.
 *
 * This module owns the WebGL foundation only: it configures the renderer
 * (ACES tone mapping + shadow maps), builds a lit placeholder city block so the
 * shell is verifiable before real geometry exists, and keeps viewport math in
 * pure functions that can be tested without a GL context. Scene assembly for
 * the eras, lots and landmarks is layered on top of `createCityScene`.
 */

/** Sky colour shared by the scene background and the distance fog. */
export const SKY_COLOR = 0x0d1626;
/** Asphalt/ground colour of the placeholder block. */
export const GROUND_COLOR = 0x151b26;
/** Road surface colour of the placeholder block. */
export const STREET_COLOR = 0x232c3d;
/** Device pixel ratio ceiling, so hi-dpi screens stay at a smooth frame rate. */
export const MAX_PIXEL_RATIO = 2;
/** Lower bound for the device pixel ratio, so tiny windows stay legible. */
export const MIN_PIXEL_RATIO = 0.5;
export const CAMERA_FOV = 55;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 800;
/** Default eye position; later navigation tasks re-frame this camera. */
export const CAMERA_POSITION = { x: 34, y: 26, z: 38 } as const;
/** Default look-at point: the middle of the block, slightly above ground. */
export const CAMERA_TARGET = { x: 0, y: 4, z: 0 } as const;
/** Side length of the placeholder block, in world units (metres). */
export const BLOCK_SIZE = 48;
/** Width of the two crossing placeholder streets. */
export const STREET_WIDTH = 6;
/** Tone mapping exposure tuned for the placeholder lighting rig. */
export const DEFAULT_TONE_MAPPING_EXPOSURE = 1.05;
/** Name of the root group holding the placeholder block. */
export const PLACEHOLDER_BLOCK_NAME = "placeholder-block";

/** Viewport geometry, already clamped for the current display. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly aspect: number;
}

/**
 * Minimal shape of the renderer settings this module owns.
 *
 * Typing the settings structurally (instead of requiring a live
 * `THREE.WebGLRenderer`) keeps {@link configureRenderer} testable in jsdom,
 * where no WebGL context can be created.
 */
export interface RendererSettingsTarget {
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  /** Typed as `string` because `WebGLRenderer.outputColorSpace` is declared that way. */
  outputColorSpace: string;
  shadowMap: {
    enabled: boolean;
    type: THREE.ShadowMapType;
  };
}

/** Renderer surface needed to apply a viewport size. */
export interface RendererLike extends RendererSettingsTarget {
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
}

/** Camera surface needed to apply a viewport size. */
export interface CameraLike {
  aspect: number;
  updateProjectionMatrix(): void;
}

/** Deterministic placeholder building footprint. */
export interface BuildingSpec {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly color: number;
}

/**
 * Placeholder towers arranged around the crossing streets.
 *
 * Every footprint stays outside the road corridors (`|x| >= 9` or `|z| >= 14`)
 * so the layout never needs collision checks and stays visually readable from
 * the default camera.
 */
export const PLACEHOLDER_BUILDINGS: readonly BuildingSpec[] = [
  { x: -13, z: -13, width: 12, depth: 10, height: 18, color: 0x3c4a63 },
  { x: -14, z: 12, width: 10, depth: 12, height: 12, color: 0x46536b },
  { x: 12, z: -14, width: 12, depth: 10, height: 26, color: 0x2f3b52 },
  { x: 13, z: 12, width: 11, depth: 11, height: 9, color: 0x515e78 },
  { x: 0, z: -18, width: 8, depth: 8, height: 6, color: 0x59667f },
  { x: 0, z: 18, width: 8, depth: 8, height: 7, color: 0x44506a },
];

/** Scene plus its placeholder block, so callers keep a handle on both. */
export interface CityScene {
  readonly scene: THREE.Scene;
  readonly block: THREE.Group;
}

export interface CityViewOptions {
  /** Canvas declared in `index.html`; the renderer never creates its own. */
  canvas: HTMLCanvasElement;
  /** Initial viewport, normally produced by {@link normalizeViewport}. */
  viewport: Viewport;
  /** MSAA toggle; enabled by default for crisp city edges. */
  antialias?: boolean;
  /** Overrides {@link DEFAULT_TONE_MAPPING_EXPOSURE}. */
  exposure?: number;
}

export interface CityView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Root group holding the placeholder block until scene assembly replaces it. */
  readonly block: THREE.Group;
  /** Viewport currently applied to the renderer and camera. */
  readonly viewport: Viewport;
  /** Simulated seconds advanced through {@link CityView.update}. */
  readonly elapsed: number;
  resize(viewport: Viewport): void;
  update(delta: number): void;
  render(): void;
  dispose(): void;
}

/**
 * Applies the renderer settings owned by the app: ACES filmic tone mapping for
 * the high-end look and shadow maps for the sun-lit block.
 */
export function configureRenderer(
  renderer: RendererSettingsTarget,
  options: { exposure?: number } = {},
): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = positiveOr(options.exposure, DEFAULT_TONE_MAPPING_EXPOSURE);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

/**
 * Clamps a raw window size and device pixel ratio into a renderable viewport.
 *
 * Guards against zero-sized windows (which would produce a `NaN` aspect ratio)
 * and against unbounded pixel ratios on hi-dpi displays.
 */
export function normalizeViewport(
  width: number,
  height: number,
  pixelRatio: number = 1,
  maxPixelRatio: number = MAX_PIXEL_RATIO,
): Viewport {
  const safeWidth = Math.max(1, Math.round(Number.isFinite(width) ? width : 0));
  const safeHeight = Math.max(1, Math.round(Number.isFinite(height) ? height : 0));
  const ceiling =
    Number.isFinite(maxPixelRatio) && maxPixelRatio >= MIN_PIXEL_RATIO ? maxPixelRatio : MAX_PIXEL_RATIO;
  const requested = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;

  return {
    width: safeWidth,
    height: safeHeight,
    pixelRatio: Math.min(Math.max(requested, MIN_PIXEL_RATIO), ceiling),
    aspect: safeWidth / safeHeight,
  };
}

/** Pushes a viewport onto the renderer and camera (resize handling). */
export function applyRendererSize(
  renderer: RendererLike,
  camera: CameraLike,
  viewport: Viewport,
): void {
  renderer.setPixelRatio(viewport.pixelRatio);
  renderer.setSize(viewport.width, viewport.height, false);
  camera.aspect = viewport.aspect;
  camera.updateProjectionMatrix();
}

/** Builds the camera used by the block view. */
export function createCityCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
  camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);
  camera.name = "city-camera";
  return camera;
}

/**
 * Builds the lit placeholder block: ground plane, two crossing streets, evenly
 * sized towers with shadows, and a warm sun plus sky bounce.
 */
export function createPlaceholderBlock(): THREE.Group {
  const block = new THREE.Group();
  block.name = PLACEHOLDER_BLOCK_NAME;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE),
    new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 0.95, metalness: 0.02 }),
  );
  ground.name = "ground";
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  block.add(ground);

  const streetMaterial = new THREE.MeshStandardMaterial({
    color: STREET_COLOR,
    roughness: 0.7,
    metalness: 0.08,
  });

  const streetEastWest = new THREE.Mesh(
    new THREE.PlaneGeometry(BLOCK_SIZE, STREET_WIDTH),
    streetMaterial,
  );
  streetEastWest.name = "street-east-west";
  streetEastWest.rotation.x = -Math.PI / 2;
  streetEastWest.position.y = 0.02;
  streetEastWest.receiveShadow = true;
  block.add(streetEastWest);

  const streetNorthSouth = new THREE.Mesh(
    new THREE.PlaneGeometry(STREET_WIDTH, BLOCK_SIZE),
    streetMaterial,
  );
  streetNorthSouth.name = "street-north-south";
  streetNorthSouth.rotation.x = -Math.PI / 2;
  streetNorthSouth.position.y = 0.02;
  streetNorthSouth.receiveShadow = true;
  block.add(streetNorthSouth);

  PLACEHOLDER_BUILDINGS.forEach((spec, index) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width, spec.height, spec.depth),
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.82, metalness: 0.1 }),
    );
    mesh.name = `building-${index}`;
    mesh.position.set(spec.x, spec.height / 2, spec.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    block.add(mesh);
  });

  const skyBounce = new THREE.HemisphereLight(0x9dc4ff, 0x1b2233, 1.1);
  skyBounce.name = "sky-bounce";
  block.add(skyBounce);

  const sun = new THREE.DirectionalLight(0xffe3bd, 2.4);
  sun.name = "sun";
  sun.position.set(38, 56, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -BLOCK_SIZE;
  sun.shadow.camera.right = BLOCK_SIZE;
  sun.shadow.camera.top = BLOCK_SIZE;
  sun.shadow.camera.bottom = -BLOCK_SIZE;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  block.add(sun);
  block.add(sun.target);

  return block;
}

/** Builds the scene: sky background, distance fog and the placeholder block. */
export function createCityScene(): CityScene {
  const scene = new THREE.Scene();
  scene.name = "chrono-city";
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, BLOCK_SIZE * 1.4, BLOCK_SIZE * 5);

  const block = createPlaceholderBlock();
  scene.add(block);

  return { scene, block };
}

/**
 * Creates the WebGL view: renderer configured with ACES tone mapping and
 * shadows, scene with the placeholder block, and a camera framed on the block.
 *
 * Throws when the browser cannot provide a WebGL context; callers (see
 * `src/main.ts`) translate that into a visible failure state.
 */
export function createCityView(options: CityViewOptions): CityView {
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    antialias: options.antialias ?? true,
    powerPreference: "high-performance",
  });
  configureRenderer(renderer, { exposure: options.exposure });

  const { scene, block } = createCityScene();
  const camera = createCityCamera(options.viewport.aspect);

  let viewport = options.viewport;
  let elapsed = 0;

  applyRendererSize(renderer, camera, viewport);

  return {
    renderer,
    scene,
    camera,
    block,
    get viewport() {
      return viewport;
    },
    get elapsed() {
      return elapsed;
    },
    resize(next: Viewport) {
      viewport = next;
      applyRendererSize(renderer, camera, viewport);
    },
    update(delta: number) {
      // The placeholder block is static; later scene systems animate through
      // this clock (era transitions, traffic, day/night lighting).
      elapsed += Math.max(0, Number.isFinite(delta) ? delta : 0);
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      disposeObjectTree(scene);
      renderer.dispose();
    },
  };
}

/** Releases the GPU resources owned by an object tree. */
export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }
  material.dispose();
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
