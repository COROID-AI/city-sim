// @vitest-environment happy-dom
/**
 * Factory-floor world, camera rig and post-processing chain.
 *
 * Everything runs over the *shared* foundation contracts: the headless render
 * adapter (a real three.js scene and camera, no GPU) and `createSampleState`
 * fixture state. The tests assert observable behaviour — which elements are
 * allowed to bloom, what the floor installs on the scene, how a lane pylon or a
 * gate beacon is coded, where the camera ends up, whether two replays of the
 * same transition agree, what disposal releases — instead of implementation
 * counters.
 *
 * Runs under happy-dom so the pointer, wheel and page-level assertions are
 * real, while every rendering assertion still goes through the headless adapter.
 */

import { readFileSync } from 'node:fs';

import {
  AdditiveBlending,
  Color,
  DataTexture,
  FogExp2,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
} from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  CINEMATIC_INTERVAL_MS,
  SCENE_PREVIEW_CAMERA_STATES,
  SCENE_PREVIEW_QUALITY_PRESETS,
  bootScenePreview,
  createCinematicDirector,
  createScenePreview,
  describeCameraRig,
  describeWorld,
  wireScenePreviewControls,
} from '../dev-preview/scene';
import { createGame } from '../src/game/Game';
import {
  BLOOM_EMISSIVE_THRESHOLD,
  MAX_POST_HALO_RINGS,
  MAX_POST_RAYS,
  POST_QUALITY_PRESETS,
  POST_QUALITY_SETTINGS,
  SCREEN_PASS_RENDER_ORDER,
  collectEmissiveAnchors,
  createGlowTexture,
  createPostChain,
  resolveQualitySettings,
  type EmissiveAnchor,
  type PostChain,
} from '../src/render/effects';
import {
  CAMERA_DAMPING,
  CAMERA_LIMITS,
  CAMERA_SCREEN_STATES,
  CAMERA_STATES,
  MAX_CAMERA_STEP_MS,
  createCameraRig,
  createCameraRigSystem,
  poseOfState,
  sampleCameraTransition,
  transitionCurve,
  wrapAngle,
  type CameraStateName,
} from '../src/render/camera';
import { createHeadlessAdapter } from '../src/render/headless';
import {
  FLOOR_SIZE,
  GATE_COLORS,
  LANE_COLORS,
  WORLD_BACKDROP,
  WORLD_FOG,
  WORLD_NAMES,
  createWorld,
  createWorldSystem,
  type World,
} from '../src/render/scene';
import { createSampleState } from '../src/sim/fixtures';
import { applyDomainEvents, makeDomainEvent, type GameState } from '../src/sim/state';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const SAMPLE = createSampleState();

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`[test] missing index ${index}`);
  return value;
}

/** Compare two packed sRGB colours with room for a 1-bit linear round trip. */
function expectHexClose(actual: number, expected: number, tolerance = 2): void {
  const channels = (hex: number): number[] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const actualChannels = channels(actual);
  const expectedChannels = channels(expected);
  for (let index = 0; index < 3; index += 1) {
    expect(Math.abs(at(actualChannels, index) - at(expectedChannels, index))).toBeLessThanOrEqual(tolerance);
  }
}

function anchor(id: string, radius: number, intensity: number, color = 0x35f0ff): EmissiveAnchor {
  return { id, position: new Vector3(0, 1, 0), color: new Color(color), radius, intensity };
}

function mountChain(preset?: PostChain['preset'], anchors: readonly EmissiveAnchor[] = []): {
  adapter: ReturnType<typeof createHeadlessAdapter>;
  chain: PostChain;
} {
  const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
  const chain = createPostChain({
    host: adapter.scene,
    camera: adapter.camera,
    preset,
    anchors,
  });
  return { adapter, chain };
}

function mountWorld(state?: GameState | null): {
  adapter: ReturnType<typeof createHeadlessAdapter>;
  world: World;
} {
  const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
  const world = createWorld({ adapter, state: state ?? null });
  return { adapter, world };
}

/** Read the standard material of a named mesh in the world subtree. */
function materialOf(root: Object3D, name: string): MeshStandardMaterial {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`[test] missing world object "${name}"`);
  const material = (object as Mesh).material;
  if (Array.isArray(material)) throw new Error(`[test] "${name}" has an array material`);
  if (!(material instanceof MeshStandardMaterial)) {
    throw new Error(`[test] "${name}" is not a standard material`);
  }
  return material;
}

function uniformValue(material: ShaderMaterial, name: string): number {
  const uniform = material.uniforms[name];
  return uniform && typeof uniform.value === 'number' ? uniform.value : Number.NaN;
}

interface PoseSnapshot {
  focus: Vector3;
  azimuth: number;
  polar: number;
  distance: number;
  fov: number;
}

/* -------------------------------------------------------------------------- */
/* Quality presets                                                            */
/* -------------------------------------------------------------------------- */

describe('post-processing quality presets', () => {
  it('publishes four ascending cost tiers', () => {
    expect(POST_QUALITY_PRESETS).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(SCENE_PREVIEW_QUALITY_PRESETS).toEqual([...POST_QUALITY_PRESETS]);

    for (let index = 1; index < POST_QUALITY_PRESETS.length; index += 1) {
      const cheaper = POST_QUALITY_SETTINGS[at(POST_QUALITY_PRESETS, index - 1)];
      const richer = POST_QUALITY_SETTINGS[at(POST_QUALITY_PRESETS, index)];
      expect(richer.rayCount).toBeGreaterThan(cheaper.rayCount);
      expect(richer.glowOpacity).toBeGreaterThan(cheaper.glowOpacity);
      expect(richer.vignette).toBeGreaterThan(cheaper.vignette);
    }
  });

  it('keeps chromatic aberration restrained at every tier', () => {
    for (const preset of POST_QUALITY_PRESETS) {
      const settings = POST_QUALITY_SETTINGS[preset];
      expect(settings.aberration).toBeGreaterThanOrEqual(0);
      expect(settings.aberration).toBeLessThanOrEqual(0.003);
      expect(settings.haloRings).toBeLessThanOrEqual(MAX_POST_HALO_RINGS);
      expect(settings.rayCount).toBeLessThanOrEqual(MAX_POST_RAYS);
    }
    expect(POST_QUALITY_SETTINGS.low.aberration).toBe(0);
  });

  it('resolves an absent or unknown tier to the default', () => {
    expect(resolveQualitySettings().preset).toBe('high');
    expect(resolveQualitySettings(null).preset).toBe('high');
    expect(resolveQualitySettings('bogus' as PostChain['preset']).preset).toBe('high');
    expect(resolveQualitySettings('ultra')).toBe(POST_QUALITY_SETTINGS.ultra);
  });
});

/* -------------------------------------------------------------------------- */
/* Emissive anchors                                                           */
/* -------------------------------------------------------------------------- */

describe('bloom threshold', () => {
  it('blooms only emissive elements', () => {
    const root = new Object3D();
    const lit = new Mesh(new PlaneGeometry(4, 4), new MeshStandardMaterial({ color: 0x223344 }));
    lit.name = 'lit';
    const dim = new Mesh(
      new PlaneGeometry(3, 3),
      new MeshStandardMaterial({
        emissive: 0xffffff,
        emissiveIntensity: BLOOM_EMISSIVE_THRESHOLD / 4,
      }),
    );
    dim.name = 'dim';
    const glow = new Mesh(
      new PlaneGeometry(6, 6),
      new MeshStandardMaterial({ emissive: 0x35f0ff, emissiveIntensity: 1.2 }),
    );
    glow.name = 'glow';
    root.add(lit, dim, glow);

    const anchors = collectEmissiveAnchors(root);
    expect(anchors.map((entry) => entry.id)).toEqual(['glow']);
    expect(at(anchors, 0).radius).toBeCloseTo(3, 5);
    expect(at(anchors, 0).intensity).toBeGreaterThan(1);
    expectHexClose(at(anchors, 0).color.getHex(), 0x35f0ff);
  });

  it('accepts additive hologram meshes and skips rigs and hidden meshes', () => {
    const root = new Object3D();
    const hologram = new Mesh(
      new PlaneGeometry(4, 4),
      new MeshBasicMaterial({ color: 0x35f0ff, blending: AdditiveBlending, transparent: true }),
    );
    hologram.name = 'holo';
    const rig = new Mesh(
      new PlaneGeometry(200, 4),
      new MeshBasicMaterial({ color: 0xffffff, blending: AdditiveBlending }),
    );
    rig.name = 'rig';
    const hidden = new Mesh(
      new PlaneGeometry(4, 4),
      new MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 2 }),
    );
    hidden.name = 'hidden';
    hidden.visible = false;
    const opaqueSlab = new Mesh(
      new PlaneGeometry(4, 4),
      new MeshStandardMaterial({ color: 0xffffff }),
    );
    opaqueSlab.name = 'slab';
    root.add(hologram, rig, hidden, opaqueSlab);

    expect(collectEmissiveAnchors(root).map((entry) => entry.id)).toEqual(['holo']);
    expect(collectEmissiveAnchors(root, { includeAdditive: false })).toEqual([]);
  });

  it('caps the anchor count and can be widened by the caller', () => {
    const root = new Object3D();
    for (let index = 0; index < 6; index += 1) {
      const mesh = new Mesh(
        new PlaneGeometry(2 + index * 0.1, 2),
        new MeshStandardMaterial({ emissive: 0x35f0ff, emissiveIntensity: 1 }),
      );
      mesh.name = `glow-${index}`;
      root.add(mesh);
    }
    expect(collectEmissiveAnchors(root, { maxAnchors: 3 })).toHaveLength(3);
    expect(collectEmissiveAnchors(root)).toHaveLength(6);
  });

  it('generates the halo field in memory', () => {
    const texture = createGlowTexture(16);
    expect(texture).toBeInstanceOf(DataTexture);
    const image = texture.image as { data: Uint8Array; width: number; height: number };
    expect(image.width).toBe(16);
    expect(image.height).toBe(16);
    expect(image.data.length).toBe(16 * 16 * 4);
    // Opaque at the centre, fully transparent at the corner: a radial falloff.
    expect(at(Array.from(image.data), (8 * 16 + 8) * 4 + 3)).toBeGreaterThan(200);
    expect(at(Array.from(image.data), 3)).toBe(0);
    texture.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Post chain                                                                 */
/* -------------------------------------------------------------------------- */

describe('post-processing chain', () => {
  it('instantiates on the shared adapter and reports the preset budget', () => {
    const anchors = [anchor('a', 1, 0.5), anchor('b', 2, 1)];
    const { adapter, chain } = mountChain('high', anchors);

    expect(adapter.scene.children).toContain(chain.root);
    expect(chain.settings).toEqual(POST_QUALITY_SETTINGS.high);
    expect(chain.visibleHalos).toBe(anchors.length * POST_QUALITY_SETTINGS.high.haloRings);
    expect(chain.visibleRays).toBe(POST_QUALITY_SETTINGS.high.rayCount);
    // One pool at the largest tier: presets only toggle visibility.
    expect(chain.rays.children).toHaveLength(MAX_POST_RAYS);
    chain.dispose();
  });

  it('anchors the bloom body on the emissive elements only', () => {
    const anchors = [anchor('a', 3, 1, 0xff2d6f), anchor('b', 1, 0.4)];
    const { chain } = mountChain('medium', anchors);
    const sprites = chain.glow.children.filter((child): child is Sprite => child instanceof Sprite);
    expect(sprites).toHaveLength(anchors.length * MAX_POST_HALO_RINGS);

    const rings = POST_QUALITY_SETTINGS.medium.haloRings;
    const visible = sprites.filter((sprite) => sprite.visible);
    expect(visible).toHaveLength(anchors.length * rings);

    const first = at(visible, 0);
    expect((first.material as SpriteMaterial).map).toBeInstanceOf(DataTexture);
    expectHexClose(new Color((first.material as SpriteMaterial).color).getHex(), 0xff2d6f);
    chain.dispose();
  });

  it('re-applies a tier without allocating, then follows live anchors', () => {
    const live = [anchor('a', 2, 1)];
    const { chain } = mountChain('low', live);
    const poolSize = chain.glow.children.length;

    chain.setPreset('ultra');
    expect(chain.visibleHalos).toBe(live.length * POST_QUALITY_SETTINGS.ultra.haloRings);
    expect(chain.visibleRays).toBe(MAX_POST_RAYS);
    expect(chain.glow.children).toHaveLength(poolSize);

    chain.setPreset('low');
    expect(chain.visibleHalos).toBe(live.length);
    expect(chain.visibleRays).toBe(POST_QUALITY_SETTINGS.low.rayCount);

    chain.update(16, 320);
    const sprite = at(
      chain.glow.children.filter((child): child is Sprite => child instanceof Sprite && child.visible),
      0,
    );
    const bright = (sprite.material as SpriteMaterial).opacity;
    expect(bright).toBeGreaterThan(0);

    // Anchors are live handles: dimming one dims its halo without re-registering.
    at(live, 0).intensity = 0;
    chain.update(16, 336);
    expect((sprite.material as SpriteMaterial).opacity).toBe(0);
    chain.dispose();
  });

  it('drives both pools from a deterministic clock', () => {
    const build = (): PostChain => mountChain('high', [anchor('a', 1, 1)]).chain;
    const first = build();
    const second = build();
    for (let index = 0; index < 12; index += 1) {
      first.update(16, 1000 + index * 16);
      second.update(16, 1000 + index * 16);
    }
    const samples = (chain: PostChain): number[] => {
      const sprite = at(
        chain.glow.children.filter((child): child is Sprite => child instanceof Sprite && child.visible),
        0,
      );
      const ray = at(chain.rays.children, 0) as Mesh<PlaneGeometry, ShaderMaterial>;
      return [
        chain.time,
        (sprite.material as SpriteMaterial).opacity,
        sprite.scale.x,
        uniformValue(chain.screen.material, 'uTime'),
        uniformValue(ray.material, 'uTime'),
      ];
    };
    expect(samples(second)).toEqual(samples(first));
    expect(samples(first)[0]).toBeCloseTo(1.176, 5);
    first.dispose();
    second.dispose();
  });

  it('locks the screen pass to the camera and covers the frustum', () => {
    const { adapter, chain } = mountChain('ultra', [anchor('a', 1, 1)]);
    const camera = adapter.camera;
    camera.position.set(12, 9, 18);
    camera.lookAt(0, 2, 0);
    camera.updateMatrixWorld(true);
    chain.update(16, 240);

    expect(chain.screen.material.depthTest).toBe(false);
    expect(chain.screen.material.transparent).toBe(true);
    expect(chain.screen.renderOrder).toBe(SCREEN_PASS_RENDER_ORDER);
    expect(chain.screen.position.distanceTo(camera.position)).toBeCloseTo(0.5, 5);

    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const toScreen = new Vector3().subVectors(chain.screen.position, camera.position).normalize();
    expect(toScreen.dot(forward)).toBeCloseTo(1, 5);

    const expectedHeight = 2 * Math.tan(((camera.fov * Math.PI) / 180) / 2) * 0.5 * 1.08;
    expect(chain.screen.scale.y).toBeCloseTo(expectedHeight, 6);
    expect(chain.screen.scale.x).toBeCloseTo(expectedHeight * camera.aspect, 6);
    expect(uniformValue(chain.screen.material, 'uAspect')).toBeCloseTo(camera.aspect, 6);
    chain.dispose();
  });

  it('releases every resource exactly once, idempotently', () => {
    const { adapter, chain } = mountChain('ultra', [anchor('a', 1, 1)]);
    const halo = at(
      chain.glow.children.filter((child): child is Sprite => child instanceof Sprite),
      0,
    );
    const haloMaterial = halo.material as SpriteMaterial;
    const haloTexture = haloMaterial.map;
    expect(haloTexture).toBeInstanceOf(DataTexture);
    const ray = at(chain.rays.children, 0) as Mesh<PlaneGeometry, ShaderMaterial>;

    const spies = [
      vi.spyOn(haloMaterial, 'dispose'),
      vi.spyOn(haloTexture as DataTexture, 'dispose'),
      vi.spyOn(ray.material, 'dispose'),
      vi.spyOn(ray.geometry, 'dispose'),
      vi.spyOn(chain.screen.material, 'dispose'),
      vi.spyOn(chain.screen.geometry, 'dispose'),
    ];

    chain.dispose();
    chain.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(chain.disposed).toBe(true);
    expect(chain.root.parent).toBeNull();
    expect(chain.glow.children).toHaveLength(0);
    expect(chain.rays.children).toHaveLength(0);
    expect(adapter.scene.children).not.toContain(chain.root);
  });
});

/* -------------------------------------------------------------------------- */
/* Factory floor world                                                        */
/* -------------------------------------------------------------------------- */

describe('holographic factory floor', () => {
  it('builds the neon floor over the shared scene', () => {
    const { adapter, world } = mountWorld(SAMPLE);

    expect(world.root.name).toBe(WORLD_NAMES.root);
    expect(adapter.scene.children).toContain(world.root);
    for (const name of [
      WORLD_NAMES.floor,
      WORLD_NAMES.grid,
      WORLD_NAMES.core,
      WORLD_NAMES.coreColumn,
      WORLD_NAMES.frame,
      WORLD_NAMES.lights,
      WORLD_NAMES.lanes,
      WORLD_NAMES.gates,
    ]) {
      expect(world.root.getObjectByName(name)).toBeTruthy();
    }

    // Emissive grid: an additive shader plane the size of the floor.
    expect(world.grid.material).toBeInstanceOf(ShaderMaterial);
    expect(world.grid.material.blending).toBe(AdditiveBlending);
    expect(world.grid.material.transparent).toBe(true);
    expect(world.grid.material.depthWrite).toBe(false);
    expect(world.grid.geometry.parameters.width).toBe(FLOOR_SIZE);
    expect(uniformValue(world.grid.material, 'uFogDensity')).toBe(WORLD_FOG.density);

    world.dispose();
  });

  it('installs visible depth fog and an indigo gradient backdrop', () => {
    const { adapter, world } = mountWorld(SAMPLE);
    const fog = adapter.scene.fog;
    expect(fog).toBeInstanceOf(FogExp2);
    expect((fog as FogExp2).density).toBe(WORLD_FOG.density);
    expectHexClose((fog as FogExp2).color.getHex(), WORLD_FOG.color);

    expect(adapter.scene.background).toBe(world.backdrop);
    const image = world.backdrop.image as { data: Uint8Array; width: number; height: number };
    expect(image.width).toBe(1);
    expect(image.height).toBeGreaterThan(64);

    const rowColor = (row: number): number => {
      const bytes = Array.from(image.data);
      return (
        (at(bytes, row * 4) << 16) | (at(bytes, row * 4 + 1) << 8) | at(bytes, row * 4 + 2)
      );
    };

    // Row 0 is the horizon band (#0b1026); the last row is the zenith (#05060f).
    expectHexClose(rowColor(0), WORLD_BACKDROP.horizon, 1);
    expectHexClose(rowColor(image.height - 1), WORLD_BACKDROP.zenith, 1);
    // A gradient, not a flat fill: the horizon band is brighter than the zenith.
    expect(rowColor(0)).toBeGreaterThan(rowColor(image.height - 1));

    world.dispose();
  });

  it('codes lane pylons by lane kind and gate beacons by gate status', () => {
    const { world } = mountWorld(SAMPLE);
    expect(world.laneCount).toBe(SAMPLE.lanes.order.length);
    expect(world.gateCount).toBe(SAMPLE.verification.order.length);

    const build = materialOf(world.root, 'lane-bar-lane-build');
    const discovery = materialOf(world.root, 'lane-bar-lane-discovery');
    expectHexClose(build.emissive.getHex(), LANE_COLORS.build);
    expectHexClose(discovery.emissive.getHex(), LANE_COLORS.discovery);
    // A lane with work in flight outshines an idle one.
    expect(build.emissiveIntensity).toBeGreaterThan(discovery.emissiveIntensity);

    const passed = materialOf(world.root, 'gate-beacon-gate-typecheck');
    const running = materialOf(world.root, 'gate-beacon-gate-boot-smoke');
    const pending = materialOf(world.root, 'gate-beacon-gate-fidelity');
    expectHexClose(passed.emissive.getHex(), GATE_COLORS.passed);
    expectHexClose(running.emissive.getHex(), GATE_COLORS.running);
    expectHexClose(pending.emissive.getHex(), GATE_COLORS.pending);
    expect(passed.opacity).toBeGreaterThan(pending.opacity);

    world.dispose();
  });

  it('feeds the live bloom anchors from the lane bars and gate beacons', () => {
    const { world } = mountWorld(SAMPLE);
    const anchorIds = world.post.anchors.map((entry) => entry.id);
    expect(anchorIds).toContain('lane-bar-lane-build');
    expect(anchorIds).toContain('gate-beacon-gate-typecheck');
    expect(anchorIds.some((id) => id.startsWith('grid-glow-'))).toBe(true);
    expect(world.post.visibleHalos).toBeGreaterThan(0);

    const build = materialOf(world.root, 'lane-bar-lane-build');
    const before = build.emissiveIntensity;
    world.update(16, 480);
    expect(build.emissiveIntensity).not.toBe(before);
    expect(world.post.anchors.some((entry) => entry.id === 'lane-bar-lane-build')).toBe(true);
    world.dispose();
  });

  it('re-codes a gate in place as the verification state moves', () => {
    const { world } = mountWorld(SAMPLE);
    const material = materialOf(world.root, 'gate-beacon-gate-typecheck');
    expectHexClose(material.emissive.getHex(), GATE_COLORS.passed);

    const failed = applyDomainEvents(SAMPLE, [
      makeDomainEvent(
        'verification/run',
        { gateId: 'gate-typecheck', status: 'failed', coverage: 0.42 },
        SAMPLE.mission.elapsedMs + 500,
      ),
    ]);
    world.applyState(failed);
    expectHexClose(material.emissive.getHex(), GATE_COLORS.failed);
    expect(world.state).toBe(failed);

    world.dispose();
  });

  it('rebuilds the actor rows when the plan shape changes', () => {
    const { world } = mountWorld(SAMPLE);
    expect(world.gateCount).toBe(4);

    const trimmed: GameState = {
      ...SAMPLE,
      verification: { ...SAMPLE.verification, order: SAMPLE.verification.order.slice(0, 2) },
    };
    world.applyState(trimmed);
    expect(world.gateCount).toBe(2);
    expect(world.root.getObjectByName('gate-beacon-gate-fidelity')).toBeUndefined();
    expect(world.root.getObjectByName('gate-beacon-gate-typecheck')).toBeTruthy();

    world.dispose();
  });

  it('animates the floor deterministically', () => {
    const run = (): number[] => {
      const { world } = mountWorld(SAMPLE);
      const samples: number[] = [];
      for (let index = 0; index < 24; index += 1) {
        world.update(16, (index + 1) * 16);
        samples.push(
          world.time,
          uniformValue(world.grid.material, 'uTime'),
          uniformValue(world.grid.material, 'uPulse'),
          materialOf(world.root, 'lane-bar-lane-build').emissiveIntensity,
        );
      }
      world.dispose();
      return samples;
    };

    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(at(first, 0)).toBeCloseTo(0.016, 6);
    expect(at(first, 2)).toBeGreaterThan(0);
  });

  it('restores the scene properties it borrowed and releases everything once', () => {
    const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
    const scene = adapter.scene;
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();

    const world = createWorld({ adapter, state: SAMPLE });
    const materials = new Set<Material>();
    const geometries = new Set<{ dispose: () => void }>();
    world.root.traverse((object) => {
      const mesh = object as Mesh;
      // Sprites carry three's shared internal geometry, which the library owns:
      // only meshes contribute geometry this module must release.
      if (mesh.isMesh && mesh.geometry) geometries.add(mesh.geometry);
      const material = mesh.material;
      if (material) {
        for (const entry of Array.isArray(material) ? material : [material]) materials.add(entry);
      }
    });
    expect(materials.size).toBeGreaterThan(10);

    const materialSpies = new Map(
      [...materials].map((material) => [material, vi.spyOn(material, 'dispose')] as const),
    );
    const geometrySpies = new Map(
      [...geometries].map((geometry) => [geometry, vi.spyOn(geometry, 'dispose')] as const),
    );
    const backdropSpy = vi.spyOn(world.backdrop, 'dispose');

    world.dispose();
    world.dispose();

    const offenders = (spies: Map<object, { mock: { calls: unknown[] } }>): string[] =>
      [...spies]
        .filter(([, spy]) => spy.mock.calls.length !== 1)
        .map(([target, spy]) => `${target.constructor.name} x${spy.mock.calls.length}`);

    expect(offenders(materialSpies)).toEqual([]);
    // Shared geometries are released exactly once too, not once per instance.
    expect(offenders(geometrySpies)).toEqual([]);
    expect(backdropSpy).toHaveBeenCalledTimes(1);
    expect(world.disposed).toBe(true);
    expect(world.post.disposed).toBe(true);
    expect(world.root.parent).toBeNull();
    expect(scene.children).toHaveLength(0);
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
  });

  it('runs over the shared adapter inside the game runtime and disposes once', () => {
    const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
    const rigSystem = createCameraRigSystem({ state: 'brief' });
    const worldSystem = createWorldSystem({ preset: 'medium' });
    const game = createGame({
      adapter,
      systems: [rigSystem, worldSystem],
      state: SAMPLE,
      seed: SAMPLE.seed,
      stepMs: 16,
    });

    game.advance(16 * 12);
    game.render();

    const world = worldSystem.world;
    const rig = rigSystem.rig;
    if (!world || !rig) throw new Error('[test] the runtime did not compose the world and the camera rig');
    expect(adapter.frameCount).toBeGreaterThan(0);
    expect(world.laneCount).toBe(SAMPLE.lanes.order.length);
    expect(world.gateCount).toBe(SAMPLE.verification.order.length);
    expect(world.post.preset).toBe('medium');
    expect(world.time).toBeGreaterThan(0);
    expect(world.state).toBe(game.state);

    // The rig drove the adapter camera to the brief framing.
    const expected = poseOfState('brief');
    const distance = new Vector3().subVectors(adapter.camera.position, rig.pose.focus).length();
    expect(distance).toBeCloseTo(expected.distance, 0);

    game.dispose();
    expect(world.disposed).toBe(true);
    expect(world.post.disposed).toBe(true);
    expect(adapter.disposed).toBe(true);
    expect(adapter.scene.children).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Camera rig                                                                 */
/* -------------------------------------------------------------------------- */

describe('camera rig', () => {
  it('names exactly the six mandated screen states', () => {
    expect([...CAMERA_STATES]).toEqual(['brief', 'plan', 'execute', 'verify', 'repair', 'release']);
    expect(SCENE_PREVIEW_CAMERA_STATES).toEqual([...CAMERA_STATES]);
    for (const name of CAMERA_STATES) {
      const definition = CAMERA_SCREEN_STATES[name];
      expect(definition.name).toBe(name);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.transitionMs).toBeGreaterThan(0);
      expect(definition.distance).toBeGreaterThanOrEqual(CAMERA_LIMITS.minDistance);
      expect(definition.distance).toBeLessThanOrEqual(CAMERA_LIMITS.maxDistance);
      expect(definition.polar).toBeGreaterThan(CAMERA_LIMITS.minPolar);
      expect(definition.polar).toBeLessThan(CAMERA_LIMITS.maxPolar);
      expect(definition.fov).toBeGreaterThanOrEqual(CAMERA_LIMITS.minFov);
      expect(definition.fov).toBeLessThanOrEqual(CAMERA_LIMITS.maxFov);
    }
  });

  it('frames every state from its definition on first apply', () => {
    for (const name of CAMERA_STATES) {
      const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
      const rig = createCameraRig({ camera, state: name, drift: false });
      const expected = poseOfState(name);

      expect(rig.state).toBe(name);
      expect(rig.mode).toBe('named');
      expect(rig.pose.distance).toBeCloseTo(expected.distance, 6);
      expect(rig.pose.azimuth).toBeCloseTo(expected.azimuth, 6);
      expect(rig.pose.focus.distanceTo(expected.focus)).toBeLessThan(1e-6);
      expect(camera.fov).toBeCloseTo(expected.fov, 6);

      const offset = new Vector3().subVectors(camera.position, expected.focus);
      expect(offset.length()).toBeCloseTo(expected.distance, 5);
      const polar = Math.acos(offset.y / offset.length());
      expect(polar).toBeCloseTo(expected.polar, 5);
      rig.dispose();
    }
  });

  it('orbits, pans and zooms inside the rig limits', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
    const rig = createCameraRig({ camera, state: 'brief', drift: false });

    rig.orbit(0.5, 0.2);
    expect(rig.mode).toBe('free');
    expect(rig.target.azimuth).toBeCloseTo(wrapAngle(CAMERA_SCREEN_STATES.brief.azimuth + 0.5), 6);
    expect(rig.target.polar).toBeCloseTo(CAMERA_SCREEN_STATES.brief.polar + 0.2, 6);

    rig.orbit(0, 10);
    expect(rig.target.polar).toBe(CAMERA_LIMITS.maxPolar);
    rig.orbit(0, -20);
    expect(rig.target.polar).toBe(CAMERA_LIMITS.minPolar);

    rig.zoom(4);
    expect(rig.target.distance).toBe(CAMERA_LIMITS.maxDistance);
    rig.zoom(0.001);
    expect(rig.target.distance).toBe(CAMERA_LIMITS.minDistance);

    // Panning uses the pose on screen, so 1 unit of delta is one viewport.
    const before = rig.target.focus.clone();
    const worldPerUnit = 2 * rig.pose.distance * Math.tan(((rig.pose.fov * Math.PI) / 180) / 2);
    rig.pan(0.25, -0.1);
    expect(rig.target.focus.distanceTo(before)).toBeCloseTo(Math.hypot(0.25, 0.1) * worldPerUnit, 3);

    // Damping closes on the free pose without overshooting.
    for (let index = 0; index < 200; index += 1) rig.update(16.6);
    expect(rig.pose.focus.distanceTo(rig.target.focus)).toBeLessThan(0.01);
    expect(rig.pose.distance).toBeCloseTo(CAMERA_LIMITS.minDistance, 2);
    expect(rig.pose.azimuth).toBeCloseTo(rig.target.azimuth, 4);
    rig.dispose();
  });

  it('never teleports on a long frame', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
    const rig = createCameraRig({ camera, state: 'brief', drift: false });
    rig.setState('release');
    const before = rig.pose.distance;
    rig.update(5_000);
    expect(Math.abs(rig.pose.distance - before)).toBeLessThan(20);
    expect(rig.transitionProgress).toBeLessThanOrEqual(1);
    expect(MAX_CAMERA_STEP_MS).toBeLessThan(5_000);
    rig.dispose();
  });

  it('samples cinematic transitions from a pure, deterministic curve', () => {
    const from = poseOfState('brief');
    const to = poseOfState('release');
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const first = sampleCameraTransition(from, to, t);
      const second = sampleCameraTransition(from, to, t);
      expect(second).toEqual(first);
    }

    const curve = transitionCurve('brief', 'verify', 6);
    expect(curve).toHaveLength(6);
    expect(at(curve, 0).distance).toBeCloseTo(CAMERA_SCREEN_STATES.brief.distance, 6);
    expect(at(curve, 0).focus.distanceTo(from.focus)).toBeLessThan(1e-6);
    expect(at(curve, 5).distance).toBeCloseTo(CAMERA_SCREEN_STATES.verify.distance, 6);
    expect(at(curve, 5).focus.z).toBeCloseTo(CAMERA_SCREEN_STATES.verify.focus[2], 6);
    // The curve arcs upward in the middle instead of sliding through the floor.
    const mid = at(curve, 3);
    const straight = (at(curve, 0).focus.y + at(curve, 5).focus.y) / 2;
    expect(mid.focus.y).toBeGreaterThan(straight);
    // Azimuth takes the shortest arc.
    expect(Math.abs(mid.azimuth - at(curve, 0).azimuth)).toBeLessThanOrEqual(Math.PI);
  });

  it('replays the same transition to the same sampled poses', () => {
    const play = (name: CameraStateName): number[] => {
      const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
      const rig = createCameraRig({ camera, state: 'brief', drift: false });
      rig.setState(name);
      const samples: number[] = [];
      for (let index = 0; index < 90; index += 1) {
        rig.update(16);
        samples.push(
          rig.pose.azimuth,
          rig.pose.polar,
          rig.pose.distance,
          rig.pose.fov,
          rig.pose.focus.x,
          rig.pose.focus.y,
          rig.pose.focus.z,
          rig.transitionProgress,
        );
      }
      rig.dispose();
      return samples;
    };

    for (const name of CAMERA_STATES) {
      const first = play(name);
      const second = play(name);
      expect(first).toHaveLength(90 * 8);
      expect(second).toEqual(first);
    }
  });

  it('lands on the destination pose and reports transition progress', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
    const rig = createCameraRig({ camera, state: 'brief', drift: false });
    expect(rig.transitionProgress).toBe(1);

    rig.setState('verify');
    expect(rig.transitioning).toBe(true);
    expect(rig.transitionProgress).toBe(0);
    expect(rig.mode).toBe('named');

    rig.update(CAMERA_DAMPING.angleMs);
    expect(rig.transitionProgress).toBeGreaterThan(0);
    expect(rig.transitionProgress).toBeLessThan(1);

    for (let index = 0; index < 400; index += 1) rig.update(16);
    expect(rig.transitioning).toBe(false);
    expect(rig.transitionProgress).toBe(1);

    const expected = poseOfState('verify');
    expect(rig.pose.distance).toBeCloseTo(expected.distance, 2);
    expect(rig.pose.focus.distanceTo(expected.focus)).toBeLessThan(0.02);
    expect(rig.pose.fov).toBeCloseTo(expected.fov, 2);
    expect(camera.fov).toBeCloseTo(expected.fov, 2);
    rig.dispose();
  });

  it('is interruptible by user input without snapping', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
    const rig = createCameraRig({ camera, state: 'brief', drift: false });
    rig.setState('release');
    for (let index = 0; index < 10; index += 1) rig.update(16);
    expect(rig.transitioning).toBe(true);

    const before: PoseSnapshot = {
      focus: rig.pose.focus.clone(),
      azimuth: rig.pose.azimuth,
      polar: rig.pose.polar,
      distance: rig.pose.distance,
      fov: rig.pose.fov,
    };

    rig.orbit(0.4, 0);
    expect(rig.transitioning).toBe(false);
    expect(rig.mode).toBe('free');
    expect(rig.state).toBe('release');

    rig.update(16);
    // Only the steered axis moves, and only by one damped step.
    expect(rig.pose.distance).toBeCloseTo(before.distance, 6);
    expect(rig.pose.polar).toBeCloseTo(before.polar, 6);
    expect(rig.pose.fov).toBeCloseTo(before.fov, 6);
    expect(rig.pose.focus.distanceTo(before.focus)).toBeLessThan(1e-6);
    const turned = Math.abs(wrapAngle(rig.pose.azimuth - before.azimuth));
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(0.4);
    rig.dispose();
  });

  it('drives from pointer, wheel and drag input, then releases its listeners', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
    const rig = createCameraRig({ camera, state: 'brief', element: host, drift: false });

    const azimuth = rig.target.azimuth;
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 60, bubbles: true }));
    expect(rig.mode).toBe('free');
    expect(rig.target.azimuth).not.toBe(azimuth);

    const distance = rig.target.distance;
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, cancelable: true }));
    expect(rig.target.distance).toBeGreaterThan(distance);

    const focus = rig.target.focus.clone();
    host.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 150, clientY: 60, shiftKey: true, bubbles: true }),
    );
    expect(rig.target.focus.equals(focus)).toBe(false);

    rig.dispose();
    const frozen = { distance: rig.target.distance, focus: rig.target.focus.clone() };
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, cancelable: true }));
    host.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 300, bubbles: true }));
    expect(rig.target.distance).toBe(frozen.distance);
    expect(rig.target.focus.equals(frozen.focus)).toBe(true);
    host.remove();
  });
});

/* -------------------------------------------------------------------------- */
/* Dev preview page                                                           */
/* -------------------------------------------------------------------------- */

describe('scene preview page', () => {
  it('cycles the six named states deterministically', () => {
    const order: CameraStateName[] = [];
    const target = {
      setState: (name: CameraStateName): void => {
        order.push(name);
      },
    };
    const director = createCinematicDirector(target, { intervalMs: 1_000 });
    expect(order).toEqual(['brief']);
    expect(director.enabled).toBe(false);
    expect(director.tick(500)).toBeNull();

    director.setEnabled(true);
    expect(director.tick(0)).toBeNull();
    expect(director.tick(400)).toBeNull();
    expect(director.tick(1_000)).toBe('plan');
    expect(director.tick(1_000)).toBeNull();
    expect(director.tick(5_000)).toBe('release');
    expect(director.tick(6_000)).toBe('brief');

    director.setEnabled(false);
    expect(director.tick(7_000)).toBeNull();
    director.reset('verify');
    expect(director.index).toBe(3);
    expect(order[order.length - 1]).toBe('verify');
    expect(CINEMATIC_INTERVAL_MS).toBe(5_200);
  });

  it('mounts the harness, drives quality and states, and disposes', () => {
    const host = document.createElement('div');
    const ticker = document.createElement('div');
    document.body.append(host, ticker);

    const preview = createScenePreview({
      host,
      ticker,
      autoStart: false,
      preset: 'high',
      state: 'brief',
      seed: SAMPLE.seed,
    });

    expect(preview.world.root.parent).toBe(preview.harness.adapter.scene);
    expect(preview.world.laneCount).toBe(SAMPLE.lanes.order.length);
    expect(preview.world.post.preset).toBe('high');
    expect(preview.rig.state).toBe('brief');

    preview.setState('execute');
    for (let index = 0; index < 40; index += 1) preview.harness.game.advance(16);
    expect(preview.rig.state).toBe('execute');
    expect(ticker.textContent).toContain('camera');

    preview.setQuality('low');
    expect(preview.world.post.preset).toBe('low');
    expect(preview.world.post.visibleRays).toBe(POST_QUALITY_SETTINGS.low.rayCount);

    const summary = preview.summary().join('\n');
    expect(summary).toContain('low');
    expect(summary).toContain('floor');
    expect(describeCameraRig(preview.rig).length).toBeGreaterThan(0);
    expect(describeWorld(preview.world).join('\n')).toContain('post');

    preview.dispose();
    expect(preview.harness.disposed).toBe(true);
    expect(preview.world.disposed).toBe(true);
    host.remove();
    ticker.remove();
  });

  it('boots the page handle, wires its buttons and clears the window handle', () => {
    const host = document.createElement('div');
    const ticker = document.createElement('div');
    document.body.append(host, ticker);
    host.innerHTML = `
      <button data-coroid-camera-state="brief"></button>
      <button data-coroid-camera-state="verify"></button>
      <button data-coroid-quality="low"></button>
      <button data-coroid-cinematic="true"></button>
    `;

    const preview = bootScenePreview({ host, ticker });
    expect(preview).not.toBeNull();
    expect(window.coroidScene).toBe(preview);
    if (!preview) throw new Error('[test] preview did not boot');

    // The cinematic run is on by default, so a state button must stop it.
    expect(preview.director.enabled).toBe(true);
    const verify = host.querySelector<HTMLButtonElement>('[data-coroid-camera-state="verify"]');
    verify?.click();
    expect(preview.rig.state).toBe('verify');
    expect(preview.director.enabled).toBe(false);
    expect(verify?.dataset.active).toBe('true');

    const low = host.querySelector<HTMLButtonElement>('[data-coroid-quality="low"]');
    low?.click();
    expect(preview.world.post.preset).toBe('low');
    expect(low?.getAttribute('aria-pressed')).toBe('true');

    const cinematic = host.querySelector<HTMLButtonElement>('[data-coroid-cinematic]');
    cinematic?.click();
    expect(preview.director.enabled).toBe(true);

    // Keyboard shortcuts mirror the buttons.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(preview.rig.state).toBe('execute');
    expect(preview.director.enabled).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
    expect(preview.director.enabled).toBe(true);

    wireScenePreviewControls(preview, document);
    preview.dispose();
    expect(window.coroidScene).toBeUndefined();
    host.remove();
    ticker.remove();
  });

  it('reports an offline rig and world without throwing', () => {
    expect(describeCameraRig(null)).toEqual(['camera    offline']);
    expect(describeWorld(null)).toEqual(['world     offline']);
  });

  it('imports no simulation module beyond the fixture', () => {
    const source = readFileSync('dev-preview/scene.ts', 'utf8');
    const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => at(match, 1));
    expect(specifiers.filter((specifier) => specifier.includes('/sim/'))).toEqual(['../src/sim/fixtures']);
    expect(source).not.toContain('Math.random');
  });

  it('keeps the camera curves and the world free of randomness', () => {
    for (const file of ['src/render/camera.ts', 'src/render/scene.ts', 'src/render/effects.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bMath\.random\s*\(/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Resource rules                                                             */
/* -------------------------------------------------------------------------- */

describe('resource rules', () => {
  it('reuses one geometry across the repeated floor props', () => {
    const { adapter, world } = mountWorld(SAMPLE);
    const machines = world.root.getObjectByName(WORLD_NAMES.machines);
    expect(machines).toBeTruthy();
    const geometries = new Set((machines?.children ?? []).map((child) => (child as Mesh).geometry));
    expect(machines?.children.length).toBeGreaterThan(1);
    expect(geometries.size).toBe(1);

    const towers = world.root.getObjectByName(WORLD_NAMES.towers);
    const towerGeometries = new Set((towers?.children ?? []).map((child) => (child as Mesh).geometry));
    expect(towerGeometries.size).toBe(2);

    world.dispose();
    expect(adapter.scene.children).toHaveLength(0);
  });

  it('mounts no external asset: every texture is generated in memory', () => {
    const { world } = mountWorld(SAMPLE);
    expect(world.backdrop).toBeInstanceOf(DataTexture);
    const sources: unknown[] = [];
    world.root.traverse((object) => {
      const material = (object as Mesh).material;
      for (const entry of Array.isArray(material) ? material : material ? [material] : []) {
        const map = (entry as { map?: unknown }).map;
        if (map) sources.push(map);
      }
    });
    for (const source of sources) expect(source).toBeInstanceOf(DataTexture);
    world.dispose();
  });

  it('tracks the viewport for the post chain', () => {
    const adapter = createHeadlessAdapter({ width: 800, height: 600 });
    const world = createWorld({ adapter });
    world.resize(1920, 1080);
    world.resize(1, 1);
    // A resize must survive degenerate boxes without throwing.
    expect(world.disposed).toBe(false);
    world.dispose();
    expect(adapter.scene.children).toHaveLength(0);
  });

  it('refuses to build over a disposed adapter', () => {
    const adapter = createHeadlessAdapter({ width: 640, height: 480 });
    adapter.dispose();
    expect(() => createWorld({ adapter })).toThrowError(/disposed/);
  });
});
