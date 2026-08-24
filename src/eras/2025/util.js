/**
 * util.js — shared 2025 contemporary-café era helpers.
 *
 * Japandi palette (light oak, white walls, matte black accents), material
 * factories, primitive helpers and canvas-texture generation. Everything is
 * procedural (Three.js primitives + canvas textures) so no external assets
 * are required.
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';

export const C = {
  oak: 0xc9a97a,        // light oak
  oakLight: 0xd8c2a0,
  oakDark: 0xa9895c,
  white: 0xf5f2ea,      // warm white walls
  whitePale: 0xfaf8f1,
  matteBlack: 0x1c1c1e,
  matteBlackSoft: 0x2a2a2d,
  charcoal: 0x34343a,
  stoneware: 0xcfc9bd,  // speckled stoneware
  stonewareDark: 0xb5ad9e,
  marble: 0xe9e7e1,     // marble-effect
  marbleVein: 0xc9c5bb,
  leaf: 0x2f5d43,       // plant green
  leafLight: 0x3d7a52,
  leafDark: 0x1f3d2c,
  terracotta: 0xc97a5a,
  sage: 0xa8b59a,
  cream: 0xf0e9db,
  ink: 0x1a1a1c,
  paper: 0xf7f4ec,
  skin: 0xd9b18a,
  skinAlt: 0xc79b72,
  hairDark: 0x24140d,
  hairBrown: 0x6a4630,
  hairBlond: 0xd9b878,
  hairCopper: 0xa95c3a,
  hairBlack: 0x1c1a1a,
  denim: 0x3f5a78,
  denimLight: 0x5f7a98,
  oat: 0xe7dcc3,
  almond: 0xf0e6d2,
  oatMilk: 0xf4efe2,
  almondMilk: 0xf7f2e6,
  gold: 0xcaa86a,
  screen: 0x9fd8c8,     // touchscreen glow
  screenDark: 0x0f1618,
  latte: 0xc89a6a,
  matcha: 0x9bbf7a,
  coldBrew: 0x2a1a12,
};

export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04, ...opts });
}

export function matte(color = C.matteBlack, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15, ...opts });
}

export function metal(color = 0xbfc4c8, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.9, ...opts });
}

export function glassy(color = 0xeaf3f2, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.12,
    metalness: 0.05,
    transparent: true,
    opacity: 0.55,
    ...opts,
  });
}

export function emissive(color = 0xfff0e0, intensity = 1.6) {
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

/** Box helper: adds a mesh at local position to group g. */
export function box(g, w, h, d, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

/** Cylinder helper. */
export function cyl(g, rt, rb, h, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

/** Sphere helper. */
export function sph(g, r, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

/** Torus helper. */
export function torus(g, r, tube, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 12, tubeSeg = 8, arc = Math.PI * 2) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, tubeSeg, seg, arc), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

/**
 * A tapered leg from a top point toward a base point — used for the slab
 * table's matte black angled legs and stool legs.
 */
export function taperedLeg(g, topX, topY, topZ, botX, botY, botZ, topR, botR, legMat) {
  const pTop = new THREE.Vector3(topX, topY, topZ);
  const pBot = new THREE.Vector3(botX, botY, botZ);
  const delta = pBot.clone().sub(pTop);
  const len = delta.length();
  delta.normalize();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(topR, botR, len, 8), legMat);
  m.position.copy(pTop).add(pBot).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta);
  g.add(m);
  return m;
}