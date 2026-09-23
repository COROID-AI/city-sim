/**
 * Chrono City — procedural material + canvas-texture library.
 *
 * Scope of these assertions (per the work order): draw-call sequences per
 * surface, seeded determinism (including composition with the `SceneContext`
 * seeded RNG), parameter-keyed cache identity, repeat wrapping and PBR
 * parameter clamping — not pixel-level appearance. The suite runs in the
 * DOM-capable Vitest environment (jsdom), so `CanvasTexture` is exercised
 * against a real canvas element.
 */

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  DEFAULT_SEED,
  SeededRandom,
  createSceneContext,
  type RandomSource,
  type SceneContext,
} from '../../src/core/sceneContext';
import {
  MAX_TEXTURE_SIZE,
  MIN_TEXTURE_SIZE,
  SURFACE_KINDS,
  TEXTURE_GENERATORS,
  createSurfaceRandom,
  generateSurfaceTexture,
  resolveTextureOptions,
  surfaceRandomSeed,
  textureKey,
  type SurfaceKind,
  type TexturePalette,
} from '../../src/materials/textureGenerators';
import {
  MATERIAL_LIBRARY_VERSION,
  MAX_EMISSIVE_INTENSITY,
  MaterialLibrary,
  SURFACE_MATERIAL_DEFAULTS,
  createMaterial,
  createMaterialLibrary,
  createMaterialLibraryFromScene,
  materialKey,
  resolveMaterialRequest,
  type MaterialRequest,
} from '../../src/materials/materialLibrary';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** One plausible palette per surface; content tasks supply their own. */
const PALETTES: Readonly<Record<SurfaceKind, TexturePalette>> = {
  brick: {
    base: '#8f5a45',
    accent: '#6d4030',
    joint: '#b9a894',
    grime: '#3a2a22',
    highlight: '#c98a6a',
  },
  stone: {
    base: '#9a978e',
    accent: '#7c786e',
    joint: '#5f5c55',
    grime: '#4a4740',
    highlight: '#c3c0b6',
  },
  stucco: {
    base: '#d8cfbb',
    accent: '#c2b79f',
    joint: '#a99e88',
    grime: '#6d6455',
    highlight: '#efe8d8',
  },
  corrugatedMetal: {
    base: '#9aa3a8',
    accent: '#b7c0c5',
    joint: '#6b7276',
    grime: '#7a4a2c',
    highlight: '#e2e8ea',
  },
  glassCurtainWall: {
    base: '#3c5a6e',
    accent: '#7fb0c9',
    joint: '#2b3540',
    grime: '#5a636b',
    highlight: '#dff1ff',
  },
  neon: {
    base: '#1b1a22',
    accent: '#ff3d7f',
    joint: '#2c2b35',
    grime: '#3f3d47',
    highlight: '#fff6fb',
    emissive: '#ff3d7f',
  },
  asphalt: {
    base: '#3a3b3d',
    accent: '#4a4c4e',
    joint: '#242527',
    grime: '#2a2b2c',
    highlight: '#8d8f90',
  },
  cobble: {
    base: '#8a8478',
    accent: '#6f6a5f',
    joint: '#544f46',
    grime: '#403c35',
    highlight: '#b6b0a2',
  },
  paintedSign: {
    base: '#d9c8a8',
    accent: '#8c2f2f',
    joint: '#5b5148',
    grime: '#6a6154',
    highlight: '#f3ead6',
    emissive: '#ffb35c',
  },
  fabric: {
    base: '#7a6a58',
    accent: '#4f6b7a',
    joint: '#4a3f33',
    grime: '#3b332a',
    highlight: '#a89478',
  },
};

/** Required op labels per surface — the layered detail reviewers look for. */
const REQUIRED_LABELS: Readonly<Record<SurfaceKind, readonly string[]>> = {
  brick: ['surface', 'mortar-bed', 'brick-row', 'brick', 'brick-bevel', 'brick-shadow', 'grime-streak', 'damp-band'],
  stone: ['joint-bed', 'stone-course', 'stone-block', 'stone-vein', 'stone-speck', 'stone-crack', 'weather-stain', 'grime-wash'],
  stucco: ['stucco-base', 'trowel-patch', 'trowel-swirl', 'stucco-grain', 'hairline-crack', 'dirt-band'],
  corrugatedMetal: ['metal-base', 'corrugation', 'rib', 'rib-crest', 'rib-valley', 'panel-seam', 'rivet', 'rust-patch', 'oxide-streak', 'dent'],
  glassCurtainWall: ['glazing-base', 'curtain-grid', 'pane-glass', 'pane-reflection', 'spandrel-band', 'pane-edge', 'mullion-v', 'mullion-h', 'sky-wash', 'dust-band'],
  neon: ['backing-plate', 'halo', 'panel-frame', 'glyph-bar', 'tube-glow', 'tube-core', 'electrode', 'bracket', 'underline-core', 'tube-gap'],
  asphalt: ['asphalt-base', 'aggregate', 'patch', 'crack', 'crack-branch', 'repair-seam', 'paint-dash', 'tar-blob'],
  cobble: ['cobble-bed', 'sett-layout', 'cobble-row', 'cobble', 'cobble-crown', 'cobble-shade', 'joint-grit', 'wear-polish', 'puddle'],
  paintedSign: ['sign-panel', 'panel-sheen', 'sign-layout', 'panel-frame', 'glyph-word', 'glyph-block', 'glyph-shadow', 'brush-stroke', 'paint-chip', 'paint-fade', 'paint-drip', 'bolt'],
  fabric: ['fabric-base', 'weave', 'warp-thread', 'weft-thread', 'weave-shadow', 'weave-sheen', 'plaid-band', 'plaid-band-edge', 'fray-patch', 'thread-fray', 'loose-thread', 'grime-wash'],
};

const TEXTURE_SIZE = 256;

function textureOptions(
  surface: SurfaceKind,
  overrides: Partial<MaterialRequest> = {},
): MaterialRequest & { surface: SurfaceKind; palette: TexturePalette } {
  return {
    surface,
    palette: PALETTES[surface],
    size: TEXTURE_SIZE,
    wear: 0.5,
    ...overrides,
  };
}

function opLabels(drawCalls: readonly string[]): string[] {
  return drawCalls.map((call) => call.slice(0, call.indexOf('(')));
}

function generate(surface: SurfaceKind, seed = 1234, overrides: Partial<MaterialRequest> = {}) {
  return generateSurfaceTexture(textureOptions(surface, overrides), new SeededRandom(seed));
}

/* ------------------------------------------------------------------ */
/* Scene context harness (stubbed renderer, no GPU)                    */
/* ------------------------------------------------------------------ */

interface TestScene {
  context: SceneContext;
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  dispose(): void;
}

function createTestScene(seed: number): TestScene {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  const overlayRoot = document.createElement('div');

  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    setAnimationLoop: () => {},
    dispose: () => {},
  } as unknown as THREE.WebGLRenderer;

  const context = createSceneContext({
    canvas,
    container,
    overlayRoot,
    seed,
    autoResize: false,
    createRenderer: () => stub,
  });

  return {
    context,
    canvas,
    container,
    dispose: () => {
      context.dispose();
      container.remove();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Generators                                                          */
/* ------------------------------------------------------------------ */

describe('texture generators', () => {
  it('registers a drawer for every documented surface kind', () => {
    expect(SURFACE_KINDS).toHaveLength(10);
    for (const surface of SURFACE_KINDS) {
      expect(typeof TEXTURE_GENERATORS[surface]).toBe('function');
    }
    expect(Object.keys(TEXTURE_GENERATORS).sort()).toEqual([...SURFACE_KINDS].sort());
  });

  it('rejects unknown surfaces with a descriptive error', () => {
    expect(() =>
      generateSurfaceTexture({
        surface: 'fur' as SurfaceKind,
        palette: PALETTES.brick,
        size: TEXTURE_SIZE,
      }),
    ).toThrow(/Unknown surface/);
  });

  it.each([...SURFACE_KINDS])('renders %s into a CanvasTexture', (surface) => {
    const generated = generate(surface);

    expect(generated.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(generated.width).toBe(TEXTURE_SIZE);
    expect(generated.height).toBe(TEXTURE_SIZE);
    expect(generated.canvas.width).toBe(TEXTURE_SIZE);
    expect(generated.texture).toBeInstanceOf(THREE.CanvasTexture);
    expect(generated.texture.image).toBe(generated.canvas);
    expect(generated.texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(generated.drawCalls.length).toBeGreaterThan(12);
    expect(generated.key).toBe(textureKey(textureOptions(surface)));
  });

  it('rasterises the draw list it records whenever a 2D context exists', () => {
    // jsdom only provides a 2D context when a native canvas binding is
    // installed; without one the generator still returns a valid CanvasTexture
    // over a correctly sized canvas and simply reports `rasterized: false`.
    const hasContext = document.createElement('canvas').getContext('2d') !== null;
    const generated = generate('brick');

    expect(generated.rasterized).toBe(hasContext);
    expect(generated.drawCalls.length).toBeGreaterThan(0);

    if (hasContext) {
      const pixels = generated.canvas
        .getContext('2d')
        ?.getImageData(0, 0, generated.width, generated.height);
      expect(pixels?.data.length).toBe(generated.width * generated.height * 4);
      expect([...new Set(pixels?.data ?? [])].length).toBeGreaterThan(1);
    }
  });

  it.each([...SURFACE_KINDS])('lays out the layered detail %s needs', (surface) => {
    const generated = generate(surface);
    const uniqueLabels = new Set(opLabels(generated.drawCalls));

    expect(generated.drawCalls[0]?.startsWith('surface(')).toBe(true);
    for (const label of REQUIRED_LABELS[surface]) {
      expect(uniqueLabels.has(label), `missing "${label}" op for ${surface}`).toBe(true);
    }
  });

  it('clamps every resolution into the bounded 256–1024 range', () => {
    const tiny = generate('stone', 5, { size: 32 });
    const huge = generate('stone', 5, { size: 4096 });
    const odd = generate('stone', 5, { size: 301 });
    const padded = generate('stone', 5, { size: 300 });

    expect(tiny.width).toBe(MIN_TEXTURE_SIZE);
    expect(huge.width).toBe(MAX_TEXTURE_SIZE);
    // 301 snaps down to the nearest multiple of four, so it keys like 300.
    expect(odd.width).toBe(300);
    expect(padded.key).toBe(odd.key);
  });

  it('clamps wear, scale and repeat and records them in the surface note', () => {
    const resolved = resolveTextureOptions({
      surface: 'fabric',
      palette: PALETTES.fabric,
      wear: 4,
      scale: 99,
      repeat: [-3, 0],
      size: TEXTURE_SIZE,
    });

    expect(resolved.wear).toBe(1);
    expect(resolved.scale).toBe(4);
    expect(resolved.repeat).toEqual([0.01, 0.01]);

    const generated = generateSurfaceTexture(resolved);
    expect(generated.texture.repeat.x).toBeCloseTo(0.01, 6);
    expect(generated.texture.repeat.y).toBeCloseTo(0.01, 6);
  });

  it('wraps and repeats so tiled facades line up', () => {
    const generated = generateSurfaceTexture({
      surface: 'cobble',
      palette: PALETTES.cobble,
      size: TEXTURE_SIZE,
      repeat: [3, 2],
    });

    expect(generated.texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(generated.texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(generated.texture.repeat.toArray()).toEqual([3, 2]);
    expect(generated.texture.userData.chronoKey).toBe(generated.key);
    expect(generated.texture.userData.chronoSurface).toBe('cobble');
  });

  it('is deterministic for a given seed and varies with a different seed', () => {
    for (const surface of SURFACE_KINDS) {
      const first = generate(surface, 4242);
      const second = generate(surface, 4242);
      const other = generate(surface, 99);

      expect(second.drawCalls).toEqual(first.drawCalls);
      expect(other.drawCalls).not.toEqual(first.drawCalls);
    }
  });

  it('derives a stable, key-specific sub-stream from the shared RNG seed', () => {
    const config = { surface: 'neon' as const, palette: PALETTES.neon, size: TEXTURE_SIZE };
    const key = textureKey(config);

    const fromSeed = generateSurfaceTexture(config, DEFAULT_SEED);
    const fromStream = generateSurfaceTexture(config, createSurfaceRandom(DEFAULT_SEED, key));
    const otherSeed = generateSurfaceTexture(config, DEFAULT_SEED + 1);

    expect(fromStream.drawCalls).toEqual(fromSeed.drawCalls);
    expect(otherSeed.drawCalls).not.toEqual(fromSeed.drawCalls);

    // The sub-stream is a pure function of (seed, key) and never depends on how
    // far a shared stream has already advanced.
    const shared = new SeededRandom(DEFAULT_SEED);
    for (let draw = 0; draw < 500; draw += 1) shared.next();
    expect(createSurfaceRandom(shared, key).seed).toBe(
      new SeededRandom(DEFAULT_SEED).fork(key).seed,
    );
    expect(surfaceRandomSeed(DEFAULT_SEED, key)).toBe(new SeededRandom(DEFAULT_SEED).fork(key).seed);
  });

  it('disposes its GPU texture exactly once', () => {
    const generated = generate('asphalt', 11);
    const spy = vi.spyOn(generated.texture, 'dispose');
    generated.dispose();
    generated.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* Material factory                                                    */
/* ------------------------------------------------------------------ */

describe('material factory', () => {
  it('builds a PBR material from palette, roughness, metalness and wear', () => {
    const library = createMaterialLibrary({ random: DEFAULT_SEED });
    const material = library.get(
      textureOptions('brick', { roughness: 0.8, metalness: 0.2, wear: 0.7 }),
    );

    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.roughness).toBeCloseTo(0.8, 6);
    expect(material.metalness).toBeCloseTo(0.2, 6);
    expect(material.color.getHexString()).toBe('ffffff');
    expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(material.emissiveIntensity).toBe(0);
    expect(material.emissiveMap).toBeNull();
    expect(material.side).toBe(THREE.FrontSide);
    expect(material.userData.chronoSurface).toBe('brick');
  });

  it('applies per-surface defaults when parameters are omitted', () => {
    const library = createMaterialLibrary({ random: DEFAULT_SEED });
    const metal = library.get(textureOptions('corrugatedMetal', { size: TEXTURE_SIZE }));

    expect(metal.roughness).toBeCloseTo(SURFACE_MATERIAL_DEFAULTS.corrugatedMetal.roughness, 6);
    expect(metal.metalness).toBeCloseTo(SURFACE_MATERIAL_DEFAULTS.corrugatedMetal.metalness, 6);
    expect(metal.map?.repeat.toArray()).toEqual([2, 1]);
  });

  it('clamps out-of-range PBR inputs instead of trusting callers', () => {
    const resolved = resolveMaterialRequest(
      textureOptions('stone', {
        roughness: 7,
        metalness: -4,
        opacity: 12,
        wear: -1,
        scale: 0,
      }),
    );

    expect(resolved.roughness).toBe(1);
    expect(resolved.metalness).toBe(0);
    expect(resolved.opacity).toBe(1);
    expect(resolved.textureOptions.wear).toBe(0);
    expect(resolved.textureOptions.scale).toBe(0.25);

    const transparent = resolveMaterialRequest(textureOptions('glassCurtainWall', { opacity: 0.4 }));
    expect(transparent.opacity).toBeCloseTo(0.4, 6);
    expect(transparent.transparent).toBe(true);
  });

  it('falls back to surface defaults for non-numeric input', () => {
    const resolved = resolveMaterialRequest(
      textureOptions('brick', { roughness: Number.NaN, metalness: Number.POSITIVE_INFINITY }),
    );

    expect(resolved.roughness).toBeCloseTo(SURFACE_MATERIAL_DEFAULTS.brick.roughness, 6);
    expect(resolved.metalness).toBeCloseTo(SURFACE_MATERIAL_DEFAULTS.brick.metalness, 6);
    expect(Number.isFinite(resolved.textureOptions.wear)).toBe(true);
  });

  it('maps emissive inputs and clamps the intensity', () => {
    const library = createMaterialLibrary({ random: DEFAULT_SEED });

    const neon = library.get(textureOptions('neon'));
    expect(neon.emissiveIntensity).toBeCloseTo(SURFACE_MATERIAL_DEFAULTS.neon.emissiveIntensity, 6);
    expect(neon.emissive.getHexString()).toBe('ff3d7f');
    expect(neon.emissiveMap).toBe(neon.map);

    const brighter = library.get(textureOptions('neon', { emissive: 3 }));
    expect(brighter.emissiveIntensity).toBe(MAX_EMISSIVE_INTENSITY);

    const capped = library.get(textureOptions('neon', { emissiveIntensity: 99 }));
    expect(capped.emissiveIntensity).toBe(MAX_EMISSIVE_INTENSITY);

    const recoloured = library.get(textureOptions('neon', { emissive: '#00ff88' }));
    expect(recoloured.emissive.getHexString()).toBe('00ff88');

    const unlit = library.get(textureOptions('neon', { emissive: 0 }));
    expect(unlit.emissiveIntensity).toBe(0);
    expect(unlit.emissiveMap).toBeNull();
  });

  it('falls back when a colour cannot be parsed', () => {
    const resolved = resolveMaterialRequest(
      textureOptions('paintedSign', { emissive: 'not-a-colour' }),
    );
    expect(resolved.emissive).toBe(PALETTES.paintedSign.emissive);
  });

  it('keys materials by resolved parameters, ignoring field order', () => {
    const left: MaterialRequest = {
      surface: 'stucco',
      palette: { base: '#d8cfbb', accent: '#c2b79f', grime: '#6d6455' },
      size: TEXTURE_SIZE,
      wear: 0.4,
      repeat: [1, 1],
    };
    const right: MaterialRequest = {
      repeat: 1,
      wear: 0.4,
      size: TEXTURE_SIZE,
      palette: { grime: '#6d6455', accent: '#c2b79f', base: '#d8cfbb' },
      surface: 'stucco',
    };
    const worn: MaterialRequest = { ...left, wear: 0.9 };

    expect(materialKey(left)).toBe(materialKey(right));
    expect(materialKey(worn)).not.toBe(materialKey(left));
    expect(resolveMaterialRequest(left).key).toBe(materialKey(left));
  });

  it('produces a one-shot material through createMaterial()', () => {
    const material = createMaterial(textureOptions('cobble'), new SeededRandom(3));
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
    material.dispose();
  });

  it('exposes its version and defaults table', () => {
    expect(MATERIAL_LIBRARY_VERSION).toBeGreaterThan(0);
    for (const surface of SURFACE_KINDS) {
      expect(SURFACE_MATERIAL_DEFAULTS[surface].roughness).toBeGreaterThanOrEqual(0);
      expect(SURFACE_MATERIAL_DEFAULTS[surface].roughness).toBeLessThanOrEqual(1);
      expect(SURFACE_MATERIAL_DEFAULTS[surface].metalness).toBeGreaterThanOrEqual(0);
      expect(SURFACE_MATERIAL_DEFAULTS[surface].metalness).toBeLessThanOrEqual(1);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

describe('material library cache', () => {
  it('reuses one material and one texture for repeated requests', () => {
    const library = createMaterialLibrary({ random: DEFAULT_SEED });
    const request = textureOptions('brick', { wear: 0.6 });

    const first = library.get(request);
    const second = library.get(request);

    expect(second).toBe(first);
    expect(library.textureKeys()).toHaveLength(1);
    expect(library.stats).toMatchObject({
      textures: 1,
      materials: 1,
      textureMisses: 1,
      textureHits: 0,
      materialMisses: 1,
      materialHits: 1,
    });
  });

  it('shares one texture across materials that differ only in PBR parameters', () => {
    const library = createMaterialLibrary({ random: DEFAULT_SEED });
    const rough = library.get(textureOptions('stone', { roughness: 0.95 }));
    const glossy = library.get(textureOptions('stone', { roughness: 0.2 }));

    expect(glossy).not.toBe(rough);
    expect(glossy.map).toBe(rough.map);
    expect(library.stats.textures).toBe(1);
    expect(library.stats.materials).toBe(2);
    expect(library.stats.textureMisses).toBe(1);
  });

  it('generates a new texture when the surface parameters change', () => {
    const library = createMaterialLibrary({ random: DEFAULT_SEED });

    library.get(textureOptions('brick', { wear: 0.1 }));
    library.get(textureOptions('brick', { wear: 0.9 }));
    library.get(textureOptions('brick', { size: 384 }));
    library.get(textureOptions('stone', { wear: 0.1 }));

    expect(library.stats.textureMisses).toBe(4);
    expect(library.textureKeys()).toHaveLength(4);
    expect(library.has(textureOptions('brick', { wear: 0.9 }))).toBe(true);
    expect(library.has('brick|nope')).toBe(false);
  });

  it('clamps before keying, so equivalent requests share a texture', () => {
    const library = createMaterialLibrary({ random: DEFAULT_SEED });
    const clamped = library.getTexture(textureOptions('fabric', { size: 32 }));
    const nominal = library.getTexture(textureOptions('fabric', { size: MIN_TEXTURE_SIZE }));

    expect(nominal).toBe(clamped);
    expect(library.stats.textureMisses).toBe(1);
    expect(library.stats.textureHits).toBe(1);
  });

  it('keeps generated textures deterministic across library instances', () => {
    const first = createMaterialLibrary({ random: DEFAULT_SEED });
    const second = createMaterialLibrary({ random: DEFAULT_SEED });
    const other = createMaterialLibrary({ random: DEFAULT_SEED + 1 });

    const options = textureOptions('glassCurtainWall', { wear: 0.45 });
    const drawCalls = first.getTexture(options).drawCalls;

    expect(second.getTexture(options).drawCalls).toEqual(drawCalls);
    expect(other.getTexture(options).drawCalls).not.toEqual(drawCalls);
  });

  it('disposes materials and textures, then stays usable', () => {
    const library = createMaterialLibrary({ random: DEFAULT_SEED });
    const texture = library.getTexture(textureOptions('asphalt'));
    const material = library.get(textureOptions('asphalt'));
    const textureSpy = vi.spyOn(texture.texture, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');

    library.dispose();

    expect(textureSpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(library.stats.textures).toBe(0);
    expect(library.stats.materials).toBe(0);

    const regenerated = library.get(textureOptions('asphalt'));
    expect(regenerated).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(regenerated.map).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('disposes a single texture together with the materials built on it', () => {
    const library = createMaterialLibrary({ random: DEFAULT_SEED });
    const material = library.get(textureOptions('neon'));
    const key = material.userData.chronoTextureKey as string;

    expect(library.disposeTexture(key)).toBe(true);
    expect(library.materialKeys()).toHaveLength(0);
    expect(library.textureKeys()).toHaveLength(0);
    expect(library.disposeTexture(key)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* SceneContext composition                                            */
/* ------------------------------------------------------------------ */

describe('SceneContext composition', () => {
  it('inherits the scene seed and is unaffected by other draws from the stream', () => {
    const busy = createTestScene(4242);
    const quiet = createTestScene(4242);
    const different = createTestScene(777);

    try {
      for (let draw = 0; draw < 750; draw += 1) busy.context.random.next();

      const configuration = textureOptions('brick', { wear: 0.55, repeat: [2, 2] });
      const busyLibrary = createMaterialLibraryFromScene(busy.context);
      const quietLibrary = createMaterialLibraryFromScene(quiet.context);
      const otherLibrary = createMaterialLibraryFromScene(different.context);

      expect(busyLibrary.seed).toBe(busy.context.random.seed);
      expect(busyLibrary.stats.textures).toBe(0);
      expect(quietLibrary.seed).toBe(busyLibrary.seed);

      const busyTexture = busyLibrary.getTexture(configuration);
      const quietTexture = quietLibrary.getTexture(configuration);
      const otherTexture = otherLibrary.getTexture(configuration);

      expect(busyTexture.key).toBe(quietTexture.key);
      expect(busyTexture.drawCalls).toEqual(quietTexture.drawCalls);
      expect(otherTexture.drawCalls).not.toEqual(busyTexture.drawCalls);

      // The library's wear pattern is exactly what the context seed produces.
      const expected = generateSurfaceTexture(
        configuration,
        (busy.context.random as RandomSource).seed,
      );
      expect(busyTexture.drawCalls).toEqual(expected.drawCalls);

      // Materials created this way are bound to the context-seeded texture.
      const material = busyLibrary.get(configuration);
      expect(material.map).toBe(busyTexture.texture);
      expect(material.userData.chronoTextureKey).toBe(busyTexture.key);
    } finally {
      busy.dispose();
      quiet.dispose();
      different.dispose();
    }
  });

  it('accepts a context-shaped seed source and a plain numeric seed', () => {
    const scene = createTestScene(2025);
    try {
      const fromScene = createMaterialLibraryFromScene(scene.context);
      const fromRandom = createMaterialLibrary({ random: scene.context.random });
      const fromSeed = createMaterialLibrary({ seed: scene.context.random.seed });

      expect(fromScene.seed).toBe(2025);
      expect(fromRandom.seed).toBe(fromScene.seed);
      expect(fromSeed.seed).toBe(fromScene.seed);

      const options = textureOptions('paintedSign', { wear: 0.8 });
      expect(fromRandom.getTexture(options).drawCalls).toEqual(
        fromScene.getTexture(options).drawCalls,
      );
      expect(fromSeed.getTexture(options).drawCalls).toEqual(
        fromScene.getTexture(options).drawCalls,
      );
    } finally {
      scene.dispose();
    }
  });

  it('uses one material instance for props that appear across the block', () => {
    const scene = createTestScene(1985);
    try {
      const library = createMaterialLibraryFromScene(scene.context);
      const facade = library.get(textureOptions('glassCurtainWall', { repeat: [3, 4] }));

      const props: THREE.MeshStandardMaterial[] = [];
      for (let index = 0; index < 25; index += 1) {
        props.push(library.get(textureOptions('glassCurtainWall', { repeat: [3, 4] })));
      }

      expect(props.every((material) => material === facade)).toBe(true);
      expect(library.stats).toMatchObject({
        textures: 1,
        materials: 1,
        materialMisses: 1,
        materialHits: 25,
        textureMisses: 1,
      });
    } finally {
      scene.dispose();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Library construction                                                */
/* ------------------------------------------------------------------ */

describe('MaterialLibrary construction', () => {
  it('defaults to the app seed and stays constructible without arguments', () => {
    const library = new MaterialLibrary();
    expect(library.seed).toBe(DEFAULT_SEED);
    expect(library.version).toBe(MATERIAL_LIBRARY_VERSION);
    expect(library.stats).toEqual({
      textures: 0,
      materials: 0,
      textureHits: 0,
      textureMisses: 0,
      materialHits: 0,
      materialMisses: 0,
    });
  });

  it('exposes the deterministic sub-stream it would use for a texture key', () => {
    const library = createMaterialLibrary({ seed: DEFAULT_SEED });
    const key = textureKey(textureOptions('fabric'));
    const fromLibrary = library.surfaceRandom(key).seed;
    expect(fromLibrary).toBe(new SeededRandom(DEFAULT_SEED).fork(key).seed);
  });
});
