/**
 * lights.js — 2025 contemporary café lighting props:
 *   hanging globe pendants and linear LED pendants over the tables.
 * Light sources are lightweight point / rect-area lights so the era stays fast.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';
import { C, mat, matte, metal, emissive, box, cyl, sph } from './util.js';

/** Hanging globe pendant — a translucent glass globe with a warm bulb. */
export function globePendant(group, x, y, z) {
  const g = new THREE.Group();

  // Cord.
  cyl(g, 0.006, 0.006, 1.4, mat(C.matteBlack, { roughness: 0.5 }), 0, 0.7, 0, 0, 0, 0, 8);
  // Ceiling canopy.
  cyl(g, 0.05, 0.06, 0.03, matte(C.matteBlack, { roughness: 0.4 }), 0, 1.42, 0, 0, 0, 0, 12);
  // Glass globe (translucent).
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xf7f3e8,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
      emissive: 0xffe6b8,
      emissiveIntensity: 0.6,
    })
  );
  globe.position.set(0, 0.05, 0);
  g.add(globe);
  // Warm bulb.
  sph(g, 0.05, emissive(0xffd9a0, 2), 0, 0.05, 0, 0, 0, 0, 12);

  g.position.set(x, y, z);
  group.add(g);

  const light = new THREE.PointLight(0xffd9a0, 4, 8, 2);
  light.position.set(x, y + 0.05, z);
  group.add(light);
  return g;
}

/** Linear LED pendant — a slim matte black bar with a glowing under-strip. */
export function linearPendant(group, x, y, z, len = 1.2) {
  const g = new THREE.Group();

  // Two suspension cords.
  for (const cx of [-len / 2 + 0.04, len / 2 - 0.04]) {
    cyl(g, 0.005, 0.005, 1.35, mat(C.matteBlack, { roughness: 0.5 }), cx, 0.68, 0, 0, 0, 0, 6);
  }
  // Ceiling mount bar.
  box(g, len, 0.02, 0.02, matte(C.matteBlack, { roughness: 0.4 }), 0, 1.4, 0);
  // LED housing bar.
  box(g, len, 0.06, 0.12, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.03, 0);
  // Glowing under-strip.
  box(g, len - 0.03, 0.015, 0.1, emissive(0xfff2da, 1.8), 0, 0.0, 0);

  g.position.set(x, y, z);
  group.add(g);

  const light = new THREE.PointLight(0xffe6c0, 3.4, 9, 2);
  light.position.set(x, y + 0.03, z);
  group.add(light);
  return g;
}

/** A soft wall pool of warm light (accent). */
export function wallGlow(group, x, y, z, color = 0xffd9a0, intensity = 1.4, dist = 4) {
  const light = new THREE.PointLight(color, intensity, dist, 2);
  light.position.set(x, y, z);
  group.add(light);
  return light;
}