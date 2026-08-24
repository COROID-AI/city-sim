/**
 * music.js — 2025 music source: a modern slab smartphone on a wireless
 * charging stand paired with a small smart speaker on a shelf — the era's
 * sound source (streaming from the phone to the speaker).
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { C, mat, matte, metal, emissive, box, cyl, sph } from './util.js';

/**
 * Smartphone on a wireless charging stand.
 * `g`: parent group; x/y/z: position; yaw: facing.
 */
export function phoneOnCharger(parent, x, y, z, yaw = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  // Wireless charging pad (matte black disc).
  cyl(g, 0.06, 0.06, 0.012, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.006, 0, 0, 0, 0, 18);
  // Charging stand foot.
  cyl(g, 0.03, 0.03, 0.02, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.02, 0, 0, 0, 0, 12);

  // Modern slab phone — thin rounded slab leaning on the stand.
  const phone = new THREE.Group();
  box(phone, 0.07, 0.145, 0.006, matte(C.matteBlack, { roughness: 0.3 }), 0, 0, 0);
  // Screen (glowing).
  const screen = box(phone, 0.062, 0.132, 0.003, emissive(0xbfe3ff, 1.8), 0, 0.001, 0.002);
  screen.name = 'smartphone-screen';
  // Camera bump (small square on the back).
  box(phone, 0.022, 0.022, 0.004, matte(C.matteBlack, { roughness: 0.3 }), 0.018, 0.03, -0.004);
  phone.position.set(0, 0.09, 0);
  phone.rotation.x = -0.5; // leaning back against the stand
  g.add(phone);

  parent.add(g);
  return g;
}

/**
 * Small smart speaker (cylindrical fabric-covered speaker with a glowing
 * ring light) on a shelf.
 */
export function smartSpeaker(parent, x, y, z, yaw = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  // Fabric-covered cylindrical body.
  cyl(g, 0.06, 0.06, 0.14, mat(0x3a3a40, { roughness: 0.9 }), 0, 0.07, 0, 0, 0, 0, 18);
  // Top control ring (glowing).
  cyl(g, 0.062, 0.062, 0.012, matte(C.matteBlack, { roughness: 0.3 }), 0, 0.146, 0, 0, 0, 0, 18);
  // Glowing status ring.
  torusRing(g, 0.045, 0.01, emissive(C.screen, 1.6), 0, 0.148, 0);
  // Small base.
  cyl(g, 0.065, 0.065, 0.01, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.005, 0, 0, 0, 0, 18);

  parent.add(g);
  return g;
}

function torusRing(g, r, tube, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 16), material);
  m.position.set(x, y, z);
  m.rotation.x = Math.PI / 2;
  g.add(m);
  return m;
}

/** Laptop on a table (2025 slim laptop). */
export function laptop(parent, x, y, z, yaw = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  // Base.
  box(g, 0.34, 0.012, 0.24, mat(0x8f959b, { roughness: 0.3, metalness: 0.6 }), 0, 0.006, 0);
  // Screen (open, slight angle).
  const screen = new THREE.Group();
  box(screen, 0.34, 0.23, 0.01, mat(0x8f959b, { roughness: 0.3, metalness: 0.6 }), 0, 0.115, 0);
  // Screen glow.
  box(screen, 0.32, 0.21, 0.003, emissive(0xd8e8ff, 1.4), 0, 0.115, 0.004);
  screen.position.set(0, 0.012, -0.115);
  screen.rotation.x = -0.25;
  g.add(screen);

  parent.add(g);
  return g;
}

/** Smartwatch on a wrist / resting — a small slab with glowing screen. */
export function smartwatch(parent, x, y, z, yaw = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  box(g, 0.036, 0.042, 0.008, matte(C.matteBlack, { roughness: 0.3 }), 0, 0, 0);
  box(g, 0.03, 0.036, 0.003, emissive(0xbfe3ff, 1.6), 0, 0, 0.004);
  // Band.
  box(g, 0.036, 0.012, 0.02, mat(C.denimLight, { roughness: 0.7 }), 0, -0.026, 0);
  box(g, 0.036, 0.012, 0.02, mat(C.denimLight, { roughness: 0.7 }), 0, 0.026, 0);
  parent.add(g);
  return g;
}

/** Earbuds in a charging case. */
export function earbudsCase(parent, x, y, z, yaw = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  box(g, 0.06, 0.02, 0.05, mat(C.whitePale, { roughness: 0.4 }), 0, 0, 0);
  // Lid line.
  box(g, 0.062, 0.003, 0.052, mat(0xcfd2d4, { roughness: 0.3 }), 0, 0.011, 0);
  parent.add(g);
  return g;
}