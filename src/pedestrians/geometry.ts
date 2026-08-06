import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural pedestrian figure geometry.
 *
 * Every figure is assembled from simple box/sphere primitives that carry a
 * per-vertex `color` attribute. A figure is a shared "rig" of the same
 * topology and proportions for the whole crowd; era-specific outfit and
 * silhouette details (fedora/pillbox hats, dresses, long coats, shoulder
 * pads, big hair, hoodies, denim, masks, earbuds, handheld devices) are
 * expressed as optional flags on the style. Each outfit color scheme bakes a
 * distinct color set into a copy of the shared rig, and every instance of a
 * scheme is drawn via a single InstancedMesh — so a large crowd is cheap.
 */

export interface FigureDims {
  /** Overall standing height of the figure (feet to top of head). */
  height: number;
  /** Width of the torso across the chest. */
  torsoWidth: number;
  /** Y of the shoulder line (top of torso). */
  shoulderY: number;
  /** Y of the waist line (bottom of torso). */
  waistY: number;
  /** Radius of the head sphere. */
  headRadius: number;
}

/** Dimensional constants shared by every figure in the crowd. */
export const FIGURE_DIMS: FigureDims = {
  height: 1.7,
  torsoWidth: 0.44,
  shoulderY: 1.32,
  waistY: 0.8,
  headRadius: 0.13,
};

/** The Y of the head sphere center. */
export const HEAD_CENTER_Y = FIGURE_DIMS.shoulderY + 0.04 + FIGURE_DIMS.headRadius;

/**
 * One outfit color scheme. Each scheme is a per-instance color variation of
 * the shared rig geometry (same topology, different baked palette).
 */
export interface OutfitScheme {
  id: string;
  /** Torso / jacket / top color. */
  top: string;
  /** Legs / pants / skirt color. */
  bottom: string;
  /** Hat / accessory accent color. */
  accent: string;
  /** Shirt / collar / trim accent color. */
  trim: string;
}

export interface FigureStyle {
  id: string;
  label: string;
  /** Skin tone. */
  skin: string;
  /** Hair color. */
  hair: string;
  /** Outfit color schemes; each becomes a shared-rig geometry variant. */
  schemes: OutfitScheme[];
  /** 1945 fedora. */
  hat?: 'fedora' | 'pillbox';
  /** Flat worker cap (1945). */
  flatCap?: boolean;
  /** Baseball cap (2005+). */
  baseballCap?: boolean;
  /** Knit beanie (2025). */
  beanie?: boolean;
  /** Dress silhouette with a flared skirt (1945 / 1965). */
  dress?: boolean;
  /** Long overcoat reaching below the waist (1945). */
  coat?: boolean;
  /** Power shoulder pads (1985). */
  shoulderPads?: boolean;
  /** Voluminous 80s hair. */
  bigHair?: boolean;
  /** Hoodie with hood + pocket (2005+). */
  hoodie?: boolean;
  /** Denim pocket accent (1985 / 2005). */
  denim?: boolean;
  /** Face mask (2025). */
  mask?: boolean;
  /** Wireless earbuds (2025). */
  earbuds?: boolean;
  /** Handheld phone / device (2005+). */
  device?: boolean;
  /** Dark leather jacket styling (1985 punk). */
  leather?: boolean;
}

const SHOE = '#26282e';
const WHITE = '#e8e8e8';

function applyColor(g: THREE.BufferGeometry, color: string): void {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

function box(
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  applyColor(g, color);
  g.translate(x, y, z);
  return g;
}

function sphere(
  r: number,
  color: string,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 12, 10);
  applyColor(g, color);
  g.translate(x, y, z);
  return g;
}

/**
 * Build a merged figure geometry for one outfit scheme. The figure faces +Z,
 * stands on the ground at y = 0, and is roughly FIGURE_DIMS.height tall.
 */
export function buildFigureGeometry(
  style: FigureStyle,
  scheme: OutfitScheme,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const { torsoWidth, shoulderY, waistY, headRadius } = FIGURE_DIMS;
  const skin = style.skin;
  const hair = style.hair;
  const top = scheme.top;
  const bottom = scheme.bottom;
  const accent = scheme.accent;
  const trim = scheme.trim;
  const armX = torsoWidth / 2 + 0.055;
  const legX = 0.1;
  const shoeColor = style.leather ? '#1a1a1f' : SHOE;

  // Feet.
  for (const sx of [1, -1]) {
    parts.push(box(0.11, 0.07, 0.22, shoeColor, sx * legX, 0.035, 0.05));
  }

  // Legs (skin for dress silhouettes, since the skirt covers them).
  const legColor = style.dress ? skin : bottom;
  for (const sx of [1, -1]) {
    parts.push(box(0.13, 0.74, 0.13, legColor, sx * legX, 0.44, 0));
  }

  // Flared skirt + belt (dress silhouettes).
  if (style.dress) {
    parts.push(box(0.5, 0.42, 0.3, bottom, 0, 0.61, 0));
    parts.push(box(0.46, 0.05, 0.24, accent, 0, waistY - 0.02, 0));
  }

  // Torso.
  parts.push(box(torsoWidth, shoulderY - waistY, 0.2, top, 0, (waistY + shoulderY) / 2, 0));

  // Long overcoat extending below the waist (1945).
  if (style.coat) {
    parts.push(box(torsoWidth + 0.04, shoulderY - 0.58, 0.24, top, 0, (0.58 + shoulderY) / 2, 0));
    parts.push(box(torsoWidth + 0.02, 0.05, 0.26, accent, 0, 0.8, 0));
  }

  // Arms (long sleeves in the top color) and hands.
  for (const sx of [1, -1]) {
    parts.push(box(0.09, shoulderY - 0.8, 0.09, top, sx * armX, (0.8 + shoulderY) / 2, 0));
    parts.push(box(0.09, 0.08, 0.09, skin, sx * armX, 0.74, 0.03));
  }

  // Power shoulder pads (1985).
  if (style.shoulderPads) {
    for (const sx of [1, -1]) {
      parts.push(box(0.18, 0.07, 0.16, accent, sx * armX, shoulderY - 0.01, 0));
    }
  }

  // Hoodie hood + kangaroo pocket (2005+).
  if (style.hoodie) {
    parts.push(box(0.2, 0.16, 0.18, top, 0, HEAD_CENTER_Y - 0.02, -0.12));
    parts.push(box(0.2, 0.08, 0.06, trim, 0, waistY + 0.14, 0.11));
  }

  // Neck.
  parts.push(box(0.1, 0.08, 0.1, skin, 0, shoulderY + 0.04, 0));

  // Head.
  parts.push(sphere(headRadius, skin, 0, HEAD_CENTER_Y, 0));

  // Hair (voluminous for 1985).
  if (style.bigHair) {
    parts.push(box(0.24, 0.14, 0.24, hair, 0, HEAD_CENTER_Y + headRadius + 0.02, 0));
    parts.push(box(0.22, 0.06, 0.22, hair, 0, HEAD_CENTER_Y + headRadius + 0.1, 0));
  } else {
    parts.push(box(0.2, 0.09, 0.2, hair, 0, HEAD_CENTER_Y + headRadius - 0.015, 0));
  }

  // Hats.
  if (style.hat === 'fedora') {
    parts.push(box(0.36, 0.03, 0.36, accent, 0, HEAD_CENTER_Y + headRadius + 0.05, 0));
    parts.push(box(0.2, 0.12, 0.2, accent, 0, HEAD_CENTER_Y + headRadius + 0.12, 0));
    parts.push(box(0.22, 0.03, 0.22, trim, 0, HEAD_CENTER_Y + headRadius + 0.08, 0));
  } else if (style.hat === 'pillbox') {
    parts.push(box(0.24, 0.09, 0.24, accent, 0, HEAD_CENTER_Y + headRadius + 0.03, 0));
    parts.push(box(0.24, 0.03, 0.24, trim, 0, HEAD_CENTER_Y + headRadius + 0.07, 0));
  }
  if (style.flatCap) {
    parts.push(box(0.24, 0.05, 0.24, accent, 0, HEAD_CENTER_Y + headRadius - 0.01, 0));
    parts.push(box(0.2, 0.03, 0.14, accent, 0, HEAD_CENTER_Y + headRadius + 0.01, 0.1));
  }
  if (style.baseballCap) {
    parts.push(box(0.22, 0.08, 0.22, accent, 0, HEAD_CENTER_Y + headRadius - 0.005, 0));
    parts.push(box(0.2, 0.02, 0.14, accent, 0, HEAD_CENTER_Y + headRadius + 0.005, 0.13));
  }
  if (style.beanie) {
    parts.push(box(0.2, 0.12, 0.2, accent, 0, HEAD_CENTER_Y + headRadius + 0.02, 0));
  }

  // Denim pocket accent (1985 / 2005).
  if (style.denim) {
    parts.push(box(0.08, 0.06, 0.01, trim, 0.1, waistY - 0.05, 0.11));
  }

  // Face mask (2025).
  if (style.mask) {
    parts.push(box(0.14, 0.06, 0.06, accent, 0, HEAD_CENTER_Y - 0.02, headRadius + 0.01));
  }

  // Wireless earbuds (2025).
  if (style.earbuds) {
    for (const sx of [1, -1]) {
      parts.push(box(0.05, 0.04, 0.05, trim, sx * (headRadius + 0.01), HEAD_CENTER_Y, 0));
    }
  }

  // Handheld device + screen (2005+).
  if (style.device) {
    parts.push(box(0.05, 0.1, 0.02, trim, armX, 0.8, 0.1));
    parts.push(box(0.04, 0.06, 0.005, WHITE, armX, 0.81, 0.115));
  }

  const merged = mergeGeometries(parts, false);
  if (!merged) {
    // Defensive fallback (should never be reached).
    const fallback = new THREE.BoxGeometry(0.2, 1, 0.2);
    applyColor(fallback, top);
    return fallback;
  }
  return merged;
}