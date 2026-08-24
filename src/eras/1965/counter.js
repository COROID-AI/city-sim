/**
 * counter.js — 1965 countertop equipment:
 *   chrome-and-bakelite Faema-style espresso machine with glass dome +
 *   steam wands, round-key electric cash register with receipt printer,
 *   glass cake stand, chrome sugar dispensers.
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { C, mat, metal, glassy as glass, box, cyl, sph, torus } from './util.js';

/** Lathe profile for the espresso machine's rounded dome/pedestal look. */
export function makeLathePoints(profile) {
  return profile.map(([x, y]) => new THREE.Vector2(x, y));
}

/** Chrome-and-bakelite espresso machine group (local, z-axis facing counter front). */
export function espressoMachine() {
  const g = new THREE.Group();

  // Base (bakelite body)
  const body = box(g, 0.44, 0.34, 0.62, mat(C.ivory, { roughness: 0.6 }), 0, 0.17, 0);
  // Chrome front band
  box(g, 0.46, 0.1, 0.04, metal(), 0, 0.1, 0.32);
  // Top chrome steam dome housing
  cyl(g, 0.11, 0.11, 0.16, metal(), 0, 0.42, 0.14, 0, 0, 0, 16);
  sph(g, 0.11, metal(), 0, 0.5, 0.14, 0, 0, 0, 16);

  // Glass dome over the top spout assembly
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    glass(0xcfe9f2, { opacity: 0.45 })
  );
  dome.position.set(0, 0.5, 0.14);
  dome.scale.y = 0.85;
  g.add(dome);

  // Group head + group gasket
  torus(g, 0.12, 0.022, metal(), 0, 0.34, 0.14, 0, 0, 0, 16, 8);

  // Steam wands — chrome tubes angled toward the front right.
  const wandMat = metal();
  const wand1 = cyl(g, 0.014, 0.014, 0.3, wandMat, 0.16, 0.24, 0.3, Math.PI / 2.4, 0, 0.6);
  const wand2 = cyl(g, 0.014, 0.014, 0.28, wandMat, -0.16, 0.24, 0.3, Math.PI / 2.4, 0, -0.6);
  sph(g, 0.02, metal(), 0.16, 0.10, 0.43, 0, 0, 0, 10);
  sph(g, 0.02, metal(), -0.16, 0.10, 0.43, 0, 0, 0, 10);

  // Portafilter: black bakelite handle + chrome basket
  cyl(g, 0.03, 0.03, 0.14, mat(C.black, { roughness: 0.7 }), 0, 0.16, -0.36, Math.PI / 2, 0, 0, 10);
  cyl(g, 0.04, 0.05, 0.03, metal(), 0, 0.16, -0.2, 0, 0, 0, 12);

  // Drip tray: chrome channel + slat top
  box(g, 0.4, 0.05, 0.34, metal(), 0, 0.025, 0);
  box(g, 0.38, 0.02, 0.32, mat(C.chromeDark, { roughness: 0.4, metalness: 0.9 }), 0, 0.05, 0);

  // Bakelite knobs + gauge
  sph(g, 0.025, mat(C.black), 0.2, 0.24, 0.28, 0, 0, 0, 10);
  sph(g, 0.025, mat(C.black), -0.2, 0.24, 0.28, 0, 0, 0, 10);
  const gauge = cyl(g, 0.045, 0.045, 0.02, mat(C.cream, { roughness: 0.4 }), 0, 0.26, 0.02, Math.PI / 2, 0, 0, 12);
  return g;
}

/** Electric cash register with round plastic keys + receipt printer. */
export function cashRegister() {
  const g = new THREE.Group();
  const body = box(g, 0.3, 0.24, 0.34, mat(C.cream, { roughness: 0.55 }), 0, 0.16, 0);
  const base = box(g, 0.32, 0.06, 0.38, mat(C.walnutDark, { roughness: 0.6 }), 0, 0.03, 0);
  const drawer = box(g, 0.3, 0.08, 0.34, mat(C.chromeDark, { metalness: 0.8, roughness: 0.4 }), 0, 0.1, 0);
  // Keys: 3 columns x 4 rows of round plastic keys.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const kx = -0.085 + c * 0.06;
      const ky = 0.26 + r * 0.05;
      const k = cyl(g, 0.022, 0.022, 0.02, mat([C.yellow, C.mint, C.coral][c % 3]), kx, ky, 0.13, 0, 0, 0, 10);
      sph(g, 0.022, mat([C.yellow, C.mint, C.coral][c % 3]), kx, ky + 0.012, 0.14, 0, 0, 0, 10);
    }
  }
  // Number display window (receipt printer + cash amounts)
  const window = box(g, 0.2, 0.07, 0.02, mat(C.chromeDark, { metalness: 0.8, roughness: 0.3 }), 0, 0.38, 0.14);
  // Receipt printer: paper slot + white curl
  const printer = box(g, 0.16, 0.06, 0.1, mat(C.cream, { roughness: 0.5 }), 0.14, 0.24, 0.06, 0, 0, 0.3);
  const paper = cyl(g, 0.025, 0.025, 0.05, mat(C.white, { roughness: 0.9 }), 0.18, 0.29, 0.2, Math.PI / 2, 0, 0, 6);
  // Lever
  cyl(g, 0.015, 0.015, 0.16, metal(), -0.2, 0.32, -0.08, Math.PI / 2, 0, 0, 8);
  return g;
}

/** Glass cake stand: dome, plate, brass stem. */
export function cakeStand() {
  const g = new THREE.Group();
  const plate = cyl(g, 0.13, 0.13, 0.02, glass(0xf4f7e8, { opacity: 0.6 }), 0, 0.19, 0, 0, 0, 0, 16);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    glass(0xdff2f5, { opacity: 0.4 })
  );
  dome.position.set(0, 0.19, 0);
  g.add(dome);
  const stem = cyl(g, 0.012, 0.012, 0.17, mat(C.gold, { metalness: 0.8, roughness: 0.3 }), 0, 0.085, 0, 0, 0, 0, 8);
  const base = cyl(g, 0.08, 0.08, 0.02, mat(C.gold, { metalness: 0.8, roughness: 0.3 }), 0, 0.012, 0, 0, 0, 0, 12);
  // Two tiny pastries on the plate
  sph(g, 0.035, mat(C.terracotta, { roughness: 0.7 }), -0.05, 0.22, 0, 0, 0, 0, 10);
  sph(g, 0.03, mat(0xe8d3a6, { roughness: 0.8 }), 0.05, 0.22, 0.02, 0, 0, 0, 10);
  return g;
}

/** Chrome sugar dispenser with bakelite top + spout. */
export function sugarDispenser() {
  const g = new THREE.Group();
  cyl(g, 0.045, 0.045, 0.13, metal(), 0, 0.07, 0, 0, 0, 0, 12);
  cyl(g, 0.05, 0.05, 0.015, metal(), 0, 0.137, 0, 0, 0, 0, 12);
  cyl(g, 0.02, 0.02, 0.03, mat(C.black), 0, 0.16, 0, 0, 0, 0, 8);
  sph(g, 0.012, mat(C.black), 0.02, 0.165, 0, 0, 0, 0.4, 8);
  return g;
}