/**
 * Procedural canvas textures and the shared per-layer material library.
 *
 * All artwork is generated at runtime - there are no image assets. Every
 * texture factory accepts an injectable canvas factory and degrades to plain
 * colour materials when no 2D context is available (Node / vitest), so the world
 * generators can be exercised headlessly.
 */

import * as THREE from 'three';
import { RNG } from '../core/rng';
import type { EraDefinition, Hex } from '../config/types';

export type TextureKind =
  | 'brick'
  | 'brownstone'
  | 'stucco'
  | 'tile'
  | 'glass'
  | 'asphalt'
  | 'cobble'
  | 'sidewalk'
  | 'awning'
  | 'poster'
  | 'neon'
  | 'grime';

/** Minimal structural contract for a 2D canvas (keeps this file headless-safe). */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2D | null;
}

export type CanvasFactory = (width: number, height: number) => CanvasLike | null;

export interface TextureFactory {
  readonly available: boolean;
  get(kind: TextureKind, repeat?: [number, number]): THREE.Texture | null;
  dispose(): void;
}

/** Browser canvas factory; returns null when `document` is unavailable. */
export function defaultCanvasFactory(): CanvasFactory {
  return (width: number, height: number) => {
    const doc = (globalThis as unknown as { document?: Document }).document;
    if (!doc || typeof doc.createElement !== 'function') return null;
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as CanvasLike;
  };
}

function fillNoise(ctx: CanvasRenderingContext2D, rng: RNG, w: number, h: number, amount: number, alpha: number): void {
  for (let i = 0; i < amount; i += 1) {
    const value = Math.floor(rng.range(0, 255));
    ctx.fillStyle = `rgba(${value},${value},${value},${alpha})`;
    ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 3));
  }
}

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, rng: RNG) => void;

const PAINTERS: Record<TextureKind, Painter> = {
  brick: (ctx, w, h, rng) => {
    ctx.fillStyle = '#7d5343';
    ctx.fillRect(0, 0, w, h);
    const rowHeight = h / 14;
    const brickWidth = w / 7;
    for (let row = 0; row < 14; row += 1) {
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let col = -1; col < 8; col += 1) {
        const x = col * brickWidth + offset;
        const y = row * rowHeight;
        const shade = Math.floor(rng.range(-18, 18));
        ctx.fillStyle = `rgb(${125 + shade},${78 + shade},${62 + shade})`;
        ctx.fillRect(x + 1.5, y + 1.5, brickWidth - 3, rowHeight - 3);
      }
    }
    fillNoise(ctx, rng, w, h, 900, 0.07);
  },
  brownstone: (ctx, w, h, rng) => {
    ctx.fillStyle = '#8a5f4a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i += 1) {
      const y = rng.range(0, h);
      ctx.fillStyle = `rgba(60,38,28,${rng.range(0.05, 0.2)})`;
      ctx.fillRect(0, y, w, rng.range(1, 3));
    }
    fillNoise(ctx, rng, w, h, 1200, 0.06);
  },
  stucco: (ctx, w, h, rng) => {
    ctx.fillStyle = '#cbbca1';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 600; i += 1) {
      ctx.fillStyle = `rgba(255,252,240,${rng.range(0.03, 0.14)})`;
      ctx.beginPath();
      ctx.arc(rng.range(0, w), rng.range(0, h), rng.range(1, 5), 0, Math.PI * 2);
      ctx.fill();
    }
    fillNoise(ctx, rng, w, h, 700, 0.05);
  },
  tile: (ctx, w, h, rng) => {
    ctx.fillStyle = '#8f4a34';
    ctx.fillRect(0, 0, w, h);
    const size = w / 8;
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const shade = Math.floor(rng.range(-20, 20));
        ctx.fillStyle = `rgb(${150 + shade},${78 + shade},${54 + shade})`;
        ctx.fillRect(x * size + 2, y * size + 2, size - 4, size - 4);
      }
    }
  },
  glass: (ctx, w, h, rng) => {
    ctx.fillStyle = '#20303f';
    ctx.fillRect(0, 0, w, h);
    const cols = 6;
    const rows = 10;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const lit = rng.chance(0.35);
        ctx.fillStyle = lit
          ? `rgba(${200 + Math.floor(rng.range(0, 55))},${190 + Math.floor(rng.range(0, 40))},${150 + Math.floor(rng.range(0, 60))},0.9)`
          : `rgba(${40 + Math.floor(rng.range(0, 30))},${58 + Math.floor(rng.range(0, 30))},${78 + Math.floor(rng.range(0, 30))},0.95)`;
        ctx.fillRect((c * w) / cols + 2, (r * h) / rows + 2, w / cols - 4, h / rows - 4);
      }
    }
    // Mullions.
    ctx.strokeStyle = 'rgba(28,34,42,0.95)';
    ctx.lineWidth = 3;
    for (let c = 1; c < cols; c += 1) {
      ctx.beginPath();
      ctx.moveTo((c * w) / cols, 0);
      ctx.lineTo((c * w) / cols, h);
      ctx.stroke();
    }
    for (let r = 1; r < rows; r += 1) {
      ctx.beginPath();
      ctx.moveTo(0, (r * h) / rows);
      ctx.lineTo(w, (r * h) / rows);
      ctx.stroke();
    }
  },
  asphalt: (ctx, w, h, rng) => {
    ctx.fillStyle = '#33353a';
    ctx.fillRect(0, 0, w, h);
    fillNoise(ctx, rng, w, h, 2600, 0.1);
    for (let i = 0; i < 22; i += 1) {
      ctx.fillStyle = `rgba(20,21,24,${rng.range(0.15, 0.4)})`;
      ctx.beginPath();
      ctx.ellipse(rng.range(0, w), rng.range(0, h), rng.range(6, 26), rng.range(4, 16), rng.range(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
  },
  cobble: (ctx, w, h, rng) => {
    ctx.fillStyle = '#4a463f';
    ctx.fillRect(0, 0, w, h);
    const stone = w / 12;
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const shade = Math.floor(rng.range(-22, 22));
        ctx.fillStyle = `rgb(${108 + shade},${102 + shade},${92 + shade})`;
        ctx.beginPath();
        ctx.roundRect
          ? ctx.roundRect(x * stone + 1.5, y * stone + 1.5 + rng.range(-1, 1), stone - 3, stone - 3, 3)
          : ctx.rect(x * stone + 1.5, y * stone + 1.5, stone - 3, stone - 3);
        ctx.fill();
      }
    }
    fillNoise(ctx, rng, w, h, 900, 0.08);
  },
  sidewalk: (ctx, w, h, rng) => {
    ctx.fillStyle = '#9a978c';
    ctx.fillRect(0, 0, w, h);
    const slabs = 4;
    ctx.strokeStyle = 'rgba(110,108,100,0.9)';
    ctx.lineWidth = 3;
    for (let i = 1; i < slabs; i += 1) {
      ctx.beginPath();
      ctx.moveTo((i * w) / slabs, 0);
      ctx.lineTo((i * w) / slabs, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i * h) / slabs);
      ctx.lineTo(w, (i * h) / slabs);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i += 1) {
      ctx.strokeStyle = `rgba(70,68,62,${rng.range(0.2, 0.5)})`;
      ctx.lineWidth = rng.range(1, 2.5);
      ctx.beginPath();
      ctx.moveTo(rng.range(0, w), rng.range(0, h));
      ctx.lineTo(rng.range(0, w), rng.range(0, h));
      ctx.stroke();
    }
    fillNoise(ctx, rng, w, h, 1400, 0.07);
  },
  awning: (ctx, w, h, rng) => {
    const stripes = 12;
    for (let i = 0; i < stripes; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#c2453f' : '#efe4cd';
      ctx.fillRect((i * w) / stripes, 0, w / stripes, h);
    }
    fillNoise(ctx, rng, w, h, 300, 0.05);
  },
  poster: (ctx, w, h, rng) => {
    ctx.fillStyle = '#e8dfc6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 10; i += 1) {
      ctx.fillStyle = `rgba(60,50,40,${rng.range(0.06, 0.16)})`;
      ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(20, 90), rng.range(6, 20));
    }
    ctx.strokeStyle = 'rgba(70,60,48,0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, w - 12, h - 12);
  },
  neon: (ctx, w, h, rng) => {
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i += 1) {
      ctx.fillStyle = `rgba(${Math.floor(rng.range(120, 255))},${Math.floor(rng.range(120, 255))},255,0.85)`;
      ctx.fillRect(0, (i * h) / 3 + h / 9, w, h / 9);
    }
  },
  grime: (ctx, w, h, rng) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 260; i += 1) {
      ctx.fillStyle = `rgba(28,24,20,${rng.range(0.02, 0.14)})`;
      ctx.beginPath();
      ctx.arc(rng.range(0, w), rng.range(0, h), rng.range(4, 26), 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

const TEXTURE_SIZE: Partial<Record<TextureKind, number>> = {
  brick: 256,
  brownstone: 256,
  stucco: 256,
  tile: 256,
  glass: 512,
  asphalt: 512,
  cobble: 512,
  sidewalk: 512,
  awning: 256,
  poster: 256,
  neon: 256,
  grime: 256,
};

/** Build the lazy, cached texture factory. */
export function createTextureFactory(canvasFactory: CanvasFactory | null = defaultCanvasFactory()): TextureFactory {
  const cache = new Map<string, THREE.Texture>();
  let available = canvasFactory !== null;

  const build = (kind: TextureKind, repeat: [number, number]): THREE.Texture | null => {
    if (!available || !canvasFactory) return null;
    const key = `${kind}:${repeat[0]}x${repeat[1]}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const size = TEXTURE_SIZE[kind] ?? 256;
    const canvas = canvasFactory(size, size);
    if (!canvas) {
      available = false;
      return null;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      available = false;
      return null;
    }
    const rng = new RNG(`texture:${kind}`);
    ctx.save();
    PAINTERS[kind](ctx, size, size, rng);
    ctx.restore();
    const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    cache.set(key, texture);
    return texture;
  };

  return {
    get available() {
      return available;
    },
    get: build,
    dispose() {
      for (const texture of cache.values()) texture.dispose();
      cache.clear();
    },
  };
}

export interface FlatMaterialOptions {
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

/**
 * Per-era material library. Materials are cached by their parameter tuple and
 * reused across every mesh of a layer, which keeps draw calls and GPU state
 * changes low (five fully detailed era layers live in memory at once).
 */
export class MaterialLibrary {
  private readonly cache = new Map<string, THREE.Material>();

  constructor(readonly textures: TextureFactory) {}

  private cached<T extends THREE.Material>(key: string, create: () => T): T {
    const existing = this.cache.get(key);
    if (existing) return existing as T;
    const material = create();
    material.name = key;
    this.cache.set(key, material);
    return material;
  }

  /** Textured facade material; falls back to flat colour when headless. */
  wall(color: Hex, kind?: TextureKind, repeat: [number, number] = [1, 1]): THREE.MeshStandardMaterial {
    const map = kind ? this.textures.get(kind, repeat) : null;
    return this.cached(`wall:${color}:${kind ?? 'none'}:${repeat[0]}x${repeat[1]}`, () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        map,
        roughness: 0.92,
        metalness: 0.03,
      }),
    );
  }

  /** Painted / plastered surface with no visible tiling pattern. */
  flat(color: Hex, options: FlatMaterialOptions = {}): THREE.MeshStandardMaterial {
    const {
      roughness = 0.8,
      metalness = 0.05,
      flatShading = false,
      transparent = false,
      opacity = 1,
      side = THREE.FrontSide,
    } = options;
    return this.cached(`flat:${color}:${roughness}:${metalness}:${flatShading}:${transparent}:${opacity}:${side}`, () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness,
        metalness,
        flatShading,
        transparent,
        opacity,
        side,
      }),
    );
  }

  /** Roadway / ground surface with an optional paving texture. */
  surface(color: Hex, kind: TextureKind, repeat: [number, number] = [1, 1], roughness = 0.95): THREE.MeshStandardMaterial {
    const map = this.textures.get(kind, repeat);
    return this.cached(`surface:${color}:${kind}:${repeat[0]}x${repeat[1]}:${roughness}`, () =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), map, roughness, metalness: 0.02 }),
    );
  }

  /** Architectural glass; gently transparent so facades read as glazed. */
  glass(color: Hex, opacity = 0.55): THREE.MeshPhysicalMaterial {
    return this.cached(`glass:${color}:${opacity}`, () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(color),
        roughness: 0.14,
        metalness: 0.32,
        transparent: opacity < 1,
        opacity,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
      }),
    );
  }

  metal(color: Hex, roughness = 0.36): THREE.MeshStandardMaterial {
    return this.cached(`metal:${color}:${roughness}`, () =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0.85 }),
    );
  }

  /** Emissive material - bloom picks these up. */
  neon(color: Hex, intensity = 1.6): THREE.MeshStandardMaterial {
    return this.cached(`neon:${color}:${intensity}`, () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        emissive: new THREE.Color(color),
        emissiveIntensity: intensity,
        roughness: 0.4,
        metalness: 0.1,
        toneMapped: true,
      }),
    );
  }

  /** Unlit material for lane markings, small decals and glass-free signage. */
  marking(color: Hex, opacity = 1): THREE.MeshBasicMaterial {
    return this.cached(`marking:${color}:${opacity}`, () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: opacity < 1,
        opacity,
      }),
    );
  }

  /** Fur / fabric - high roughness, no metalness. */
  cloth(color: Hex): THREE.MeshStandardMaterial {
    return this.cached(`cloth:${color}`, () =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 1, metalness: 0 }),
    );
  }

  skin(color: Hex): THREE.MeshStandardMaterial {
    return this.cached(`skin:${color}`, () =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.75, metalness: 0 }),
    );
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
    this.textures.dispose();
  }

  get size(): number {
    return this.cache.size;
  }
}

/** Everything a world generator needs, injected so tests can stay headless. */
export interface WorldKit {
  era: EraDefinition;
  rng: RNG;
  library: MaterialLibrary;
  /** Shared geometry cache (created per layer so dispose is cheap). */
  geometry: GeometryCache;
}

/** Caches primitive geometries per layer; five layers share nothing across eras. */
export class GeometryCache {
  private readonly cache = new Map<string, THREE.BufferGeometry>();

  get<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
    const existing = this.cache.get(key);
    if (existing) return existing as T;
    const geometry = create();
    this.cache.set(key, geometry);
    return geometry;
  }

  box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.get(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
  }

  cylinder(radiusTop: number, radiusBottom: number, height: number, radial = 12): THREE.CylinderGeometry {
    return this.get(`cyl:${radiusTop}:${radiusBottom}:${height}:${radial}`, () =>
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial),
    );
  }

  sphere(radius: number, widthSegments = 12, heightSegments = 8): THREE.SphereGeometry {
    return this.get(`sph:${radius}:${widthSegments}:${heightSegments}`, () =>
      new THREE.SphereGeometry(radius, widthSegments, heightSegments),
    );
  }

  plane(w: number, h: number): THREE.PlaneGeometry {
    return this.get(`plane:${w}:${h}`, () => new THREE.PlaneGeometry(w, h));
  }

  dispose(): void {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/** Create the injected generation kit for one era layer. */
export function createWorldKit(era: EraDefinition, options: { seed?: number | string; textures?: TextureFactory } = {}): WorldKit {
  const textures = options.textures ?? createTextureFactory();
  return {
    era,
    rng: new RNG(options.seed ?? `chrono-city:${era.year}`),
    library: new MaterialLibrary(textures),
    geometry: new GeometryCache(),
  };
}

/** Release a kit's GPU resources (called when an era layer is disposed). */
export function disposeWorldKit(kit: WorldKit): void {
  kit.geometry.dispose();
  kit.library.dispose();
}
