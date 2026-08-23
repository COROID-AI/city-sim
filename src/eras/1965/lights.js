/**
 * lights.js — 1965 era lighting props.
 *
 * The shell rig provides ambient/hemisphere/base pendants. This era adds:
 *   - a hanging pendant sputnik lamp (metal arms + warm bulbs)
 *   - small wall sconces / glowing café lamp accents
 *   - a faint pool of warm light above the menu board / jukebox
 * All light sources are lightweight point lights so the era stays fast.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';
import { C, mat, metal, emissive, box, cyl, sph, torus } from './util.js';

/** Sputnik-style pendant: chrome arms radiating from a central hub. */
export function sputnikLamp(group, x, y, z) {
  const g = new THREE.Group();

  const hubR = 0.06;
  const hub = sph(g, hubR, mat(C.chrome, { metalness: 0.9, roughness: 0.25 }), 0, 0, 0, 0, 0, 0, 12);
  const armLen = 0.34;
  const armMat = metal();

  // 8 radiating arms.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    cyl(g, 0.008, 0.008, armLen, armMat, dx * (armLen / 2 + hubR), 0, dz * (armLen / 2 + hubR), Math.PI / 2, 0, -a, 6);
    // Bulb at each arm tip.
    sph(g, 0.026, emissive(0xffd9a0, 1.6), dx * (armLen + hubR), 0, dz * (armLen + hubR), 0, 0, 0, 10);
  }
  // Central cluster.
  sph(g, 0.03, emissive(0xffe2ae, 1.9), 0, 0, 0, 0, 0, 0, 10);

  // Tall brass stem + ceiling canopy.
  cyl(g, 0.012, 0.012, 1.6, mat(C.gold, { metalness: 0.85, roughness: 0.3 }), 0, 0.85, 0, 0, 0, 0, 8);
  cyl(g, 0.05, 0.06, 0.04, mat(C.gold, { metalness: 0.85, roughness: 0.3 }), 0, 1.7, 0, 0, 0, 0, 10);

  g.position.set(x, y,  z);
  group.add(g);

  // Warm pool of light under the pendant.
  const light = new THREE.PointLight(0xffd9a0, 5, 9, 2);
  light.position.set(x, y - 0.1, z);
  group.add(light);
  return g;
}

/** Glowing chrome-and-glass café lamp used near the jukebox / counter. */
export function cafeLamp(group, x, y, z, color = C.gold) {
  const g = new THREE.Group();
  // Base + stem.
  cyl(g, 0.07, 0.07, 0.025, mat(C.chrome, { metalness: 0.9, roughness: 0.3 }), 0, 0.012, 0, 0, 0, 0, 12);
  cyl(g, 0.015, 0.02, 0.22, mat(C.chrome, { metalness: 0.9, roughness: 0.3 }), 0, 0.15, 0, 0, 0, 0, 8);
  // Shade — translucent cream cone.
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.09, 0.24, 16, 1, false),
    mat(0xf7ecd6, { roughness: 0.6, transparent: true, opacity: 0.9 })
  );
  shade.position.set(0, 0.45, 0);
  shade.rotation.x = Math.PI;
  g.add(shade);
  // Bulb glow.
  const bulb = sph(g, 0.045, emissive(0xffe2ae, 2), 0, 0.42, 0, 0, 0, 0, 10);
  // Small table lamp: place on a surface, not a wall.
  g.position.set(x, y, z);
  group.add(g);
  const light = new THREE.PointLight(0xffdcae, 2.4, 6, 2);
  light.position.set(x, y + 0.5, z);
  group.add(light);
  return g;
}

/** Soft wall pool of light above the menu / counters. */
export function wallGlow(group, x, y, z, color = 0xffd9a0, intensity = 1.6, dist = 4) {
  const light = new THREE.PointLight(color, intensity, dist, 2);
  light.position.set(x, y, z);
  group.add(light);
  return light;
}