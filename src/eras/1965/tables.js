/**
 * tables.js — mid-century café tables, chairs and tableware.
 *
 * Tables: teak/laminate tops with slender chrome splayed legs.
 * Chairs: molded plastic bucket or vinyl-and-chrome.
 * Tableware: pastel melamine mugs, chrome-rimmed glasses, milkshake
 * glasses with straws, ashtrays, checkered napkin dispensers.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';
import { C, mat, metal, glassy, box, cyl, sph, torus, splayedLeg } from './util.js';

/**
 * Build a 1965 table set: round formica table + 2 chairs at a window table.
 * grouped: parent group; center: [x, z]; rotation: yaw.
 */
export function windowTable(group, x, z, yaw = 0, opts = {}) {
  const t = new THREE.Group();
  t.position.set(x, 0, z);
  t.rotation.y = yaw;

  // Table top — teak-rimmed formica (cream) disc.
  const topR = 0.4;
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(topR, topR, 0.035, 24),
    mat(C.cream, { roughness: 0.35 })
  );
  top.position.y = 0.72;
  t.add(top);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(topR + 0.012, topR + 0.012, 0.045, 24, 1, true),
    mat(C.teak, { roughness: 0.55 })
  );
  rim.position.y = 0.72;
  t.add(rim);

  // Chrome splayed legs.
  const legMat = metal();
  const legOff = topR * 0.62;
  splayedLeg(t, legOff, legOff, topR * 0.92, topR * 0.92, 0.72, legMat);
  splayedLeg(t, -legOff, legOff, -topR * 0.92, topR * 0.92, 0.72, legMat);
  splayedLeg(t, legOff, -legOff, topR * 0.92, -topR * 0.92, 0.72, legMat);
  splayedLeg(t, -legOff, -legOff, -topR * 0.92, -topR * 0.92, 0.72, legMat);

  placeTableware(t, opts.tableware ?? 'full');

  // Chairs at this table.
  for (const [cx, cz, cyaw] of [
    [0, topR + 0.34, 0],
    [0, -topR - 0.34, Math.PI],
  ]) {
    const ch = builtin();
    ch.position.set(cx, 0, cz);
    ch.rotation.y = cyaw;
    t.add(ch);
  }

  group.add(t);
  return t;
}

/** Round café table only (no chairs) — e.g. near the jukebox. */
export function roundTable(parent, x, z, topR = 0.38) {
  const t = new THREE.Group();
  t.position.set(x, 0, z);
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(topR, topR, 0.04, 36),
    mat(C.teak, { roughness: 0.5 })
  );
  top.position.y = 0.72;
  t.add(top);
  const edge = new THREE.Mesh(
    new THREE.CylinderGeometry(topR + 0.01, topR + 0.01, 0.04, 36, 1, true),
    mat(C.walnutDark, { roughness: 0.5 })
  );
  edge.position.y = 0.72;
  t.add(edge);
  const legMat = metal();
  const o = topR * 0.6;
  splayedLeg(t, o, o, topR * 0.9, topR * 0.9, 0.72, legMat);
  splayedLeg(t, -o, o, -topR * 0.9, topR * 0.9, 0.72, legMat);
  splayedLeg(t, o, -o, topR * 0.9, -topR * 0.9, 0.72, legMat);
  splayedLeg(t, -o, -o, -topR * 0.9, -topR * 0.9, 0.72, legMat);
  placeTableware(t, 'full');
  parent.add(t);
  return t;
}

/** Molded plastic or vinyl-and-chrome chair (molded single-piece look). */
export function builtin() {
  const g = new THREE.Group();
  // Seat shell (molded).
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.06, 0.42),
    mat(C.mintPale, { roughness: 0.55 })
  );
  seat.position.y = 0.44;
  g.add(seat);
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.46, 0.05),
    mat(C.mintPale, { roughness: 0.55 })
  );
  back.position.set(0, 0.68, -0.17);
  g.add(back);
  // Vinyl cushion stripe.
  const cushion = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.045, 0.36),
    mat(C.terracotta, { roughness: 0.7 })
  );
  cushion.position.y = 0.465;
  g.add(cushion);
  // Chrome legs, tapered.
  const lMat = metal();
  const legPos = [
    [0.15, 0.15],
    [-0.15, 0.15],
    [0.15, -0.15],
    [-0.15, -0.15],
  ];
  for (const [lx, lz] of legPos) {
    cyl(g, 0.015, 0.02, 0.44, lMat, lx * 0.8, 0.22, lz * 0.8, 0, 0, 0, 8);
    sph(g, 0.02, lMat, lx * 0.8, 0.008, lz * 0.8, 0, 0, 0, 8);
  }
  return g;
}

/** Alias matching util naming — the window table chairs use this. */
export function chair(parent, x = 0, z = 0, yaw = 0) {
  const g = builtin();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  if (parent) parent.add(g);
  return g;
}

/** Set tableware on a table group: mugs, glasses, milkshake, ashtray, napkin. */
export function placeTableware(table, mode = 'full') {
  // Melamine mugs.
  mug(table, -0.14, 0.765, 0.08, C.mint);
  mug(table, -0.02, 0.765, -0.12, C.terracotta);
  // Chrome-rimmed glass.
  glassCup(table, 0.12, 0.775, 0.14);
  // Milkshake glass + straw.
  milkshake(table, 0.18, 0.775, -0.17);
  // Ashtray (smoking-era detail).
  ashtray(table, 0.02, 0.76, 0.2);
  // Checkered napkin dispenser.
  napkinDispenser(table, -0.18, 0.772, -0.14);
}

function mug(g, x, y, z, color = C.mint) {
  const m = new THREE.Group();
  cyl(m, 0.045, 0.04, 0.09, mat(color, { roughness: 0.5 }), 0, 0.045, 0);
  const handle = torus(m, 0.03, 0.01, mat(color), 0.045, 0.05, 0, 0, 0, 0, 8, 8, Math.PI * 0.9);
  m.position.set(x, y, z);
  g.add(m);
}

function glassCup(g, x, y, z) {
  const m = new THREE.Group();
  cyl(m, 0.03, 0.02, 0.09, glassy(0xf8fbf4, { roughness: 0.2 }), 0, 0.045, 0);
  torus(m, 0.03, 0.005, metal(), 0, 0.088, 0, Math.PI / 2, 0, 0, 12, 6);
  m.position.set(x, y, z);
  g.add(m);
}

function milkshake(g, x, y, z) {
  const m = new THREE.Group();
  cyl(m, 0.032, 0.024, 0.16, mat(0xf3e3c8, { roughness: 0.4 }), 0, 0.08, 0, 0, 0, 0, 10);
  // straw
  cyl(m, 0.006, 0.006, 0.2, mat(C.coral, { roughness: 0.8 }), 0.01, 0.19, 0, 0.15, 0, 0, 6);
  // whipped top
  sph(m, 0.035, mat(C.white, { roughness: 0.9 }), 0, 0.17, 0, 0, 0, 0, 10);
  m.position.set(x, y, z);
  g.add(m);
}

function ashtray(g, x, y, z) {
  const m = new THREE.Group();
  cyl(m, 0.045, 0.035, 0.015, mat(0x9ec9c0, { roughness: 0.4 }), 0, 0.008, 0, 0, 0, 0, 14);
  cyl(m, 0.03, 0.03, 0.008, mat(0x6f9c95, { roughness: 0.6 }), 0, 0.016, 0, 0, 0, 0, 14);
  // 4 notches
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    box(m, 0.012, 0.006, 0.02, mat(0x6f9c95, { roughness: 0.6 }), Math.cos(a) * 0.032, 0.008, Math.sin(a) * 0.032, 0, 0, -a);
  }
  m.position.set(x, y, z);
  g.add(m);
}

function napkinDispenser(g, x, y, z) {
  const m = new THREE.Group();
  box(m, 0.11, 0.1, 0.09, mat(C.cream, { roughness: 0.5 }), 0, 0.05, 0);
  // checkered pattern strip
  box(m, 0.115, 0.02, 0.005, mat(C.mintDark, { roughness: 0.5 }), 0, 0.09, 0.043);
  box(m, 0.115, 0.02, 0.005, mat(C.mintDark, { roughness: 0.5 }), 0, 0.09, -0.043);
  // top slot + napkins
  box(m, 0.08, 0.012, 0.06, mat(C.white, { roughness: 0.9 }), 0, 0.102, 0);
  m.position.set(x, y, z);
  g.add(m);
}