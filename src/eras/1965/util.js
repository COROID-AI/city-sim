/**
 * util.js — shared 1965 era helpers.
 *
 * Palette, material factories, primitive helpers and canvas-texture
 * generation. Everything is procedural (Three.js primitives + canvas
 * textures) so no external assets are required.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';

export const C = {
  walnut: 0x4e3823,
  walnutDark: 0x3a2b1c,
  teak: 0x7a5330,
  cream: 0xf4ecd8,
  creamPale: 0xfaf5e9,
  creamDark: 0xe4d9bf,
  mint: 0x8bc9b1,
  mintPale: 0xaad9c6,
  mintDark: 0x3f7f6b,
  teal: 0x235c50,
  terracotta: 0xc96f4a,
  terracottaDark: 0xa85433,
  gold: 0xd9a94f,
  chrome: 0xd0d7da,
  chromeDark: 0x8d969b,
  steel: 0xa7adb2,
  yellow: 0xe9bb4f,
  ivory: 0xe8e0ca,
  black: 0x14171c,
  white: 0xf2efe8,
  ink: 0x1c1f24,
  red: 0xc23b2e,
  coral: 0xcf6a52,
  navy: 0x223b5f,
  sky: 0x8cc9e0,
  amber: 0xffb74d,
  orange: 0xe2762e,
  skin: 0xd9b18a,
  hairBrown: 0x6a3c1f,
  hairDark: 0x24140d,
  hairGold: 0xe5c887,
  hairPlatinum: 0xecd8a4,
  blush: 0xe8a08a,
};

export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04, ...opts });
}

export function metal(color = C.chrome, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.95, ...opts });
}

export function glassy(color = 0xcfe9f2, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.12,
    metalness: 0.05,
    transparent: true,
    opacity: 0.55,
    ...opts,
  });
}

export function emissive(color = C.amber, intensity = 1.8) {
  return new THREE.MeshStandardMaterial({
    color: C.white,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.5,
  });
}

/** Build a CanvasTexture from a drawing callback. */
export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 6;
  if (opts.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  return tex;
}

export function box(g, w, h, d, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

export function cyl(g, rt, rb, h, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

export function sph(g, r, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

export function torus(
  g,
  r,
  tube,
  material,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  seg = 12,
  tubeSeg = 8,
  arc = Math.PI * 2
) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, tubeSeg, seg, arc), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

/** Chrome-and-teak 1965 table legs with an outward splay. */
export function splayedLeg(g, topX, topZ, botX, botZ, topY, legMat) {
  const pTop = new THREE.Vector3(topX, topY - 0.02, topZ);
  const pBot = new THREE.Vector3(botX, 0.05, botZ);
  const delta = pBot.clone().sub(pTop);
  const len = delta.length();
  delta.normalize();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, len, 6), legMat);
  m.position.copy(pTop).add(pBot).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta);
  g.add(m);
  sph(g, 0.03, legMat, botX, 0.03, botZ, 0, 0, 0, 8);
}