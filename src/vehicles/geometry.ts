import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural vehicle geometry builder.
 *
 * Every vehicle is assembled from simple box/cylinder primitives that carry a
 * per-vertex `color` attribute. The primitives are merged into a single
 * BufferGeometry per vehicle style, so all instances of a style share one
 * geometry and one material (rendered via InstancedMesh). Era-specific
 * silhouettes (rounded fenders, chrome bumpers, aero wedges, roof racks,
 * sensor pods, EV light bars, ride-share liveries) are expressed as optional
 * detail flags on the style.
 */

export interface VehicleDims {
  /** Length along the vehicle's forward (Z) axis. */
  length: number;
  /** Width along the vehicle's lateral (X) axis. */
  width: number;
  /** Height of the lower body slab. */
  bodyHeight: number;
  /** Height of the cabin / roof section. */
  cabinHeight: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Height of the lowest body surface above the ground. */
  groundClearance: number;
}

export interface VehicleStyle {
  id: string;
  label: string;
  bodyColor: string;
  accentColor?: string;
  dims: VehicleDims;
  /** Rounded fender bulges proud of the body (1945). */
  fenders?: boolean;
  /** Front/rear chrome bumpers (1965). */
  chromeBumpers?: boolean;
  /** Extended, sloped rear cabin (1985 hatchback). */
  hatchback?: boolean;
  /** Wedged aero nose (1985+). */
  wedge?: boolean;
  /** Rear spoiler (1985 sport). */
  spoiler?: boolean;
  /** Hood scoop (1965 muscle car). */
  hoodScoop?: boolean;
  /** Roof rack (wagon / SUV / minivan). */
  roofRack?: boolean;
  /** Roof sensor pod — the autonomous / robo-taxi nod (2025). */
  sensorPod?: boolean;
  /** Ride-share livery accent stripe (2025 fleet). */
  livery?: boolean;
  /** Full-width front light bar (2025 EV). */
  lightBar?: boolean;
}

const CHROME = '#d9dee4';
const TIRE = '#101216';
const DARK_TRIM = '#2a2d33';

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

/** A disc-shaped wheel, axis along X so it rolls along Z. */
function wheel(
  r: number,
  width: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, width, 20);
  applyColor(g, TIRE);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

export function buildVehicleGeometry(style: VehicleStyle): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const { dims } = style;
  const L = dims.length;
  const W = dims.width;
  const bodyBottom = dims.groundClearance;
  const bodyH = dims.bodyHeight;
  const bodyTop = bodyBottom + bodyH;
  const cabinH = dims.cabinHeight;
  const cabinTop = bodyTop + cabinH;
  const accent = style.accentColor ?? style.bodyColor;
  const wheelZ = L * 0.3;
  const wheelX = W * 0.5 - dims.wheelWidth * 0.45;

  // Main lower body slab.
  parts.push(box(W, bodyH, L, style.bodyColor, 0, bodyBottom + bodyH / 2, 0));

  // Cabin / roof section (two-tone accent when provided).
  const cabinL = L * (style.hatchback ? 0.62 : 0.55);
  const cabinZ = style.hatchback ? -L * 0.08 : -L * 0.04;
  parts.push(box(W * 0.8, cabinH, cabinL, accent, 0, bodyTop + cabinH / 2, cabinZ));

  // Four wheels.
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      parts.push(wheel(dims.wheelRadius, dims.wheelWidth, sx * wheelX, dims.wheelRadius, sz * wheelZ));
    }
  }

  // Rounded fenders (1945): bulges proud of the body over each wheel.
  if (style.fenders) {
    const fW = W * 0.24;
    const fH = bodyH * 0.8;
    const fL = L * 0.15;
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        parts.push(
          box(fW, fH, fL, style.bodyColor, sx * (W * 0.5 + fW * 0.18), bodyBottom + fH / 2, sz * wheelZ),
        );
      }
    }
  }

  // Chrome bumpers (1965).
  if (style.chromeBumpers) {
    const bw = W * 1.06;
    const bh = 0.14;
    const bl = 0.1;
    parts.push(box(bw, bh, bl, CHROME, 0, bodyBottom + 0.12, L / 2 + 0.05));
    parts.push(box(bw, bh, bl, CHROME, 0, bodyBottom + 0.12, -L / 2 - 0.05));
  }

  // Wedged aero nose (1985+).
  if (style.wedge) {
    parts.push(box(W * 0.92, bodyH * 0.5, L * 0.12, style.bodyColor, 0, bodyBottom + bodyH * 0.45, L / 2 - L * 0.02));
  }

  // Hood scoop (1965 muscle car).
  if (style.hoodScoop) {
    parts.push(box(W * 0.3, 0.07, L * 0.16, style.bodyColor, 0, bodyTop + 0.035, L * 0.18));
  }

  // Rear spoiler (1985 sport).
  if (style.spoiler) {
    parts.push(box(W * 0.9, 0.05, 0.12, style.bodyColor, 0, cabinTop - 0.02, -L * 0.4));
  }

  // Roof rack (wagon / SUV / minivan).
  if (style.roofRack) {
    parts.push(box(W * 0.62, 0.05, L * 0.32, DARK_TRIM, 0, cabinTop + 0.06, cabinZ));
  }

  // Roof sensor pod (2025 robo-taxi).
  if (style.sensorPod) {
    parts.push(box(W * 0.5, 0.1, L * 0.2, '#1a1d22', 0, cabinTop + 0.06, cabinZ));
    parts.push(box(W * 0.34, 0.06, L * 0.13, '#0a0c10', 0, cabinTop + 0.15, cabinZ));
  }

  // Ride-share livery accent stripe (2025 fleet).
  if (style.livery) {
    parts.push(box(W * 1.02, 0.06, L * 0.78, accent, 0, bodyBottom + bodyH * 0.55, 0));
  }

  // Full-width EV light bar (2025).
  if (style.lightBar) {
    parts.push(box(W * 0.88, 0.05, 0.03, '#dff4ff', 0, bodyTop - bodyH * 0.18, L / 2 + 0.005));
  }

  const merged = mergeGeometries(parts, false);
  if (!merged) {
    // Defensive fallback (should never be reached).
    const fallback = new THREE.BoxGeometry(1, 1, 1);
    applyColor(fallback, style.bodyColor);
    return fallback;
  }
  return merged;
}
