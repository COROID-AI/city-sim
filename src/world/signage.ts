/**
 * Storefront and advertising signage.
 *
 * Two responsibilities, deliberately split:
 *  1. {@link buildSignContent} derives a *pure data* drawing specification per
 *     era (copy, format, palette, glow/scroll behaviour, wrapped lines). This is
 *     what the content tests assert - no canvas required.
 *  2. {@link createStorefront} / {@link createAdBoard} turn that specification
 *     into three.js meshes, using emissive materials for the formats the bloom
 *     pass should catch (neon, ticker, LED, media facades) and matte painted
 *     panels for the pre-war ads.
 */

import * as THREE from 'three';
import type { AdSpec, EraDefinition, Hex, SignFormat, StorefrontSpec } from '../config/types';
import type { WorldKit } from './textures';

export interface SignDrawSpec {
  /** Copy pre-wrapped into lines as it should appear on the panel. */
  lines: string[];
  background: Hex;
  foreground: Hex;
  /** Neon / LED / ticker glow. */
  glow: boolean;
  /** Copy animates (ticker / media facade). */
  scroll: boolean;
  /** Painted border frame. */
  border: boolean;
}

export interface SignContent {
  id: string;
  source: 'storefront' | 'advertisement';
  text: string;
  format: SignFormat;
  placement: 'wall' | 'rooftop' | 'facade' | 'storefront' | 'freestanding';
  emissive: boolean;
  scrolling: boolean;
  colors: Hex[];
  /** Panel size in world units. */
  width: number;
  height: number;
  /** Emissive intensity hint for the mesh builder. */
  intensity: number;
  draw: SignDrawSpec;
}

const GLOWING: ReadonlySet<SignFormat> = new Set(['neon', 'ticker', 'led', 'media-facade']);
const PAINTED: ReadonlySet<SignFormat> = new Set(['painted', 'poster']);

function wrapCopy(text: string, maxChars = 22): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function intensityFor(format: SignFormat): number {
  switch (format) {
    case 'neon':
      return 2.1;
    case 'ticker':
      return 1.7;
    case 'led':
      return 2.4;
    case 'media-facade':
      return 2.8;
    default:
      return 0;
  }
}

function panelHeight(format: SignFormat, placement: SignContent['placement']): number {
  if (placement === 'rooftop') return 3.4;
  if (placement === 'facade') return 7.5;
  if (format === 'ticker') return 1.1;
  return 1.6;
}

function signFromStorefront(spec: StorefrontSpec): SignContent {
  const glow = GLOWING.has(spec.signFormat);
  return {
    id: `sign-${spec.id}`,
    source: 'storefront',
    text: spec.name,
    format: spec.signFormat,
    placement: 'storefront',
    emissive: glow,
    scrolling: spec.signFormat === 'ticker',
    colors: [spec.signColor, spec.awning],
    width: 7.4,
    height: 1.3,
    intensity: Math.max(1.5, intensityFor(spec.signFormat)),
    draw: {
      lines: wrapCopy(spec.name, 18),
      background: spec.awning,
      foreground: spec.signColor,
      glow,
      scroll: spec.signFormat === 'ticker',
      border: PAINTED.has(spec.signFormat),
    },
  };
}

function signFromAd(spec: AdSpec): SignContent {
  const glow = spec.emissive || GLOWING.has(spec.format);
  return {
    id: `ad-${spec.id}`,
    source: 'advertisement',
    text: spec.copy,
    format: spec.format,
    placement: spec.placement,
    emissive: glow,
    scrolling: spec.scrolling,
    colors: spec.colors,
    width: spec.placement === 'rooftop' ? 18 : spec.placement === 'facade' ? 9 : 12,
    height: panelHeight(spec.format, spec.placement),
    intensity: intensityFor(spec.format),
    draw: {
      lines: wrapCopy(spec.copy, spec.placement === 'rooftop' ? 20 : 16),
      background: spec.colors[0] ?? '#222222',
      foreground: spec.colors[1] ?? '#ffffff',
      glow,
      scroll: spec.scrolling,
      border: !glow,
    },
  };
}

/**
 * The complete, era-specific signage specification: storefront fascias plus the
 * block's advertisements. Never empty, and unique per era.
 */
export function buildSignContent(era: EraDefinition): SignContent[] {
  return [...era.storefronts.map(signFromStorefront), ...era.advertisements.map(signFromAd)];
}

/** Stable string used by tests to compare signage between eras. */
export function signageSignature(era: EraDefinition): string {
  return buildSignContent(era)
    .map((content) => `${content.id}|${content.text}|${content.format}|${content.draw.lines.join('/')}`)
    .join('::');
}

/* ------------------------------------------------------------- meshes ---- */

function panelMesh(
  kit: WorldKit,
  content: SignContent,
  width: number,
  height: number,
  emissive: boolean,
): { mesh: THREE.Mesh; accent: THREE.Mesh } {
  const [background, foreground] = content.colors;
  const material = emissive
    ? kit.library.neon(foreground ?? '#ffffff', content.intensity || 1.8)
    : kit.library.flat(foreground ?? '#e8e0cc', { roughness: 0.75 });
  const panel = new THREE.Mesh(kit.geometry.box(width, height, 0.22), material);
  panel.castShadow = false;

  const backingMaterial = kit.library.flat(background ?? '#222222', { roughness: 0.85 });
  const backing = new THREE.Mesh(kit.geometry.box(width + 0.25, height + 0.25, 0.14), backingMaterial);
  backing.position.z = -0.14;
  backing.castShadow = false;
  return { mesh: panel, accent: backing };
}

/**
 * A ground-floor shop front: recessed display window, fascia sign, awning or
 * straight canopy, door, stoop and a small hanging sign.
 */
export function createStorefront(
  kit: WorldKit,
  spec: StorefrontSpec,
  options: { position: THREE.Vector3; facing: 'x' | 'z'; facingSign: 1 | -1; width: number },
): THREE.Group {
  const group = new THREE.Group();
  group.name = `storefront:${spec.id}`;
  group.position.copy(options.position);
  group.rotation.y = options.facing === 'x' ? (options.facingSign === 1 ? Math.PI / 2 : -Math.PI / 2) : options.facingSign === 1 ? 0 : Math.PI;

  const width = options.width;
  const glow = GLOWING.has(spec.signFormat);

  // Window bay: dark, slightly reflective glazing.
  const glass = new THREE.Mesh(
    kit.geometry.box(width - 1.2, 2.6, 0.3),
    kit.library.glass(spec.glassTint, glow ? 0.62 : 0.5),
  );
  glass.position.set(0, 1.6, 0.16);
  group.add(glass);

  // Mullions / frame.
  const frameMaterial = kit.library.metal('#2f2f33', 0.45);
  for (const x of [-width / 2 + 0.4, 0, width / 2 - 0.4]) {
    const mullion = new THREE.Mesh(kit.geometry.box(0.16, 2.7, 0.34), frameMaterial);
    mullion.position.set(x, 1.6, 0.2);
    group.add(mullion);
  }
  const transom = new THREE.Mesh(kit.geometry.box(width - 1, 0.18, 0.34), frameMaterial);
  transom.position.set(0, 2.7, 0.2);
  group.add(transom);

  // Door.
  const door = new THREE.Mesh(kit.geometry.box(1.1, 2.4, 0.18), kit.library.flat(spec.awning, { roughness: 0.6 }));
  door.position.set(width / 2 - 1.4, 1.5, 0.3);
  group.add(door);

  // Fasica sign panel with the shop name.
  const content = signFromStorefront(spec);
  const { mesh: fascia, accent: fasciaBacking } = panelMesh(kit, content, Math.min(width - 1, 7.6), 1.15, glow);
  fascia.position.set(0, 3.45, 0.22);
  fasciaBacking.position.set(0, 3.45, 0.08);
  group.add(fascia, fasciaBacking);

  // Awning: sloped canopy with a scalloped leading edge.
  const awningMaterial = kit.library.surface(spec.awning, 'awning', [3, 1], 0.85);
  const awning = new THREE.Mesh(kit.geometry.box(width - 0.6, 0.16, 1.8), awningMaterial);
  awning.name = 'awning';
  awning.position.set(0, 2.95, 0.95);
  awning.rotation.x = -0.32;
  awning.castShadow = true;
  group.add(awning);
  const valance = new THREE.Mesh(kit.geometry.box(width - 0.6, 0.42, 0.12), awningMaterial);
  valance.name = 'awning-valance';
  valance.position.set(0, 2.62, 1.78);
  group.add(valance);
  // Support rods.
  for (const x of [-width / 2 + 0.8, width / 2 - 0.8]) {
    const rod = new THREE.Mesh(kit.geometry.box(0.08, 0.08, 1.9), frameMaterial);
    rod.position.set(x, 3.05, 0.95);
    rod.rotation.x = -0.32;
    group.add(rod);
  }

  // Window display: mannequins / crates / produce, period-coloured blocks.
  const displayMaterial = kit.library.flat(spec.signColor, { roughness: 0.9 });
  const displayCount = 3;
  for (let i = 0; i < displayCount; i += 1) {
    const item = new THREE.Mesh(
      kit.geometry.box(0.5, 0.8 + (i % 2) * 0.4, 0.4),
      i === 1 ? displayMaterial : kit.library.flat(spec.awning, { roughness: 0.95 }),
    );
    item.position.set(-width / 2 + 1.6 + i * 1.5, 1.1, 0.05);
    item.castShadow = true;
    group.add(item);
  }

  // Hanging blade sign.
  const bladeContent: SignContent = { ...content, width: 1.2, height: 2.2, draw: { ...content.draw, lines: content.draw.lines.slice(0, 2) } };
  const { mesh: blade } = panelMesh(kit, bladeContent, 0.16, 2, glow);
  blade.rotation.y = Math.PI / 2;
  blade.position.set(-width / 2 + 0.5, 4.1, 0.75);
  group.add(blade);
  const bracket = new THREE.Mesh(kit.geometry.box(0.7, 0.08, 0.08), frameMaterial);
  bracket.position.set(-width / 2 + 0.85, 5.15, 0.75);
  group.add(bracket);

  // Small concrete stoop.
  const stoop = new THREE.Mesh(kit.geometry.box(width - 0.4, 0.2, 1.1), kit.library.surface('#8f8b80', 'sidewalk', [2, 1]));
  stoop.position.set(0, 0.12, 0.7);
  group.add(stoop);

  group.userData.signFormat = spec.signFormat;
  group.userData.storefrontName = spec.name;
  return group;
}

/**
 * An advertising panel: painted brick wall ad, poster, neon tube board, roof
 * billboard, scrolling LED ticker or a full media facade.
 */
export function createAdBoard(
  kit: WorldKit,
  content: SignContent,
  options: { position: THREE.Vector3; rotationY?: number; width?: number; height?: number },
): THREE.Group {
  const group = new THREE.Group();
  group.name = `ad:${content.id}`;
  group.position.copy(options.position);
  group.rotation.y = options.rotationY ?? 0;

  const width = options.width ?? content.width;
  const height = options.height ?? content.height;
  const { mesh: panel, accent } = panelMesh(kit, content, width, height, content.emissive);
  group.add(panel, accent);

  const frameMaterial = kit.library.metal(content.format === 'media-facade' ? '#20242a' : '#3a3a3e', 0.5);

  if (PAINTED.has(content.format)) {
    // Painted brick ghost-sign: add weathering slats so it reads as layered paint.
    const weathering = kit.library.flat('#241f1a', { roughness: 1, transparent: true, opacity: 0.22 });
    for (let i = 0; i < 3; i += 1) {
      const streak = new THREE.Mesh(kit.geometry.box(width * 0.9, 0.2 + i * 0.1, 0.06), weathering);
      streak.position.set(0, -height / 3 + i * 0.5, 0.16);
      group.add(streak);
    }
  } else {
    // Tube / panel edging for the illuminated formats.
    const borderTop = new THREE.Mesh(kit.geometry.box(width + 0.3, 0.16, 0.2), frameMaterial);
    borderTop.position.set(0, height / 2 + 0.1, 0.1);
    const borderBottom = borderTop.clone();
    borderBottom.position.y = -height / 2 - 0.1;
    group.add(borderTop, borderBottom);
  }

  if (content.format === 'ticker' || content.format === 'media-facade') {
    // LED rows: thin emissive strips that the ambience animator scrolls.
    const rowCount = content.format === 'media-facade' ? 14 : 4;
    const rows: THREE.Mesh[] = [];
    for (let i = 0; i < rowCount; i += 1) {
      const row = new THREE.Mesh(
        kit.geometry.box(width * 0.94, height / rowCount * 0.34, 0.06),
        kit.library.neon(content.colors[1] ?? '#ffffff', 1.4 + (i % 3) * 0.3),
      );
      row.position.set(0, -height / 2 + (i + 0.5) * (height / rowCount), 0.16);
      row.castShadow = false;
      group.add(row);
      rows.push(row);
    }
    group.userData.tickerRows = rows;
  }

  if (content.placement === 'rooftop') {
    // Billboard gantry.
    for (const x of [-width / 2 + 1.2, width / 2 - 1.2]) {
      const leg = new THREE.Mesh(kit.geometry.box(0.24, 3.4, 0.24), frameMaterial);
      leg.position.set(x, -height / 2 - 1.6, -0.2);
      group.add(leg);
    }
    const brace = new THREE.Mesh(kit.geometry.box(width * 0.9, 0.18, 0.18), frameMaterial);
    brace.position.set(0, -height / 2 - 0.4, -0.2);
    group.add(brace);
  }

  if (content.placement === 'facade') {
    // Catwalk so media facades read as engineered surfaces.
    const catwalk = new THREE.Mesh(kit.geometry.box(width + 0.6, 0.14, 0.5), frameMaterial);
    catwalk.position.set(0, -height / 2 - 0.2, 0.28);
    group.add(catwalk);
  }

  group.userData.signFormat = content.format;
  group.userData.copy = content.text;
  group.userData.scrolling = content.scrolling;
  return group;
}
