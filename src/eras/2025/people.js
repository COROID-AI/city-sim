/**
 * people.js — 5 patrons in 2025 fashion:
 *   relaxed oversized fits, cropped wide jeans, sneakers, natural-textured
 *   hairstyles — one with a laptop + headphones, one with a smartwatch, one
 *   filming a latte with a phone on a mini-gimbal, one with a tote bag, plus
 *   earbuds in a case. Simple low-poly figures so the cast reads clearly.
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { C, mat, matte, emissive, box, cyl, sph } from './util.js';
import { laptop, smartwatch, earbudsCase } from './music.js';

const SKIN = C.skin;
const SKIN_ALT = C.skinAlt;

/** Shared compact figure builder: torso, legs, sneakers, head with hair. */
function figureBase(g, opts = {}) {
  const torso = opts.torso ?? C.cream;
  // Oversized torso (relaxed fit — slightly boxy).
  box(g, 0.34, 0.46, 0.2, mat(torso, { roughness: 0.75 }), 0, 1.0, 0);
  box(g, 0.38, 0.09, 0.22, mat(opts.shoulders ?? torso, { roughness: 0.7 }), 0, 1.22, 0);
  // Cropped wide legs (wide jeans).
  const legC = opts.legs ?? C.denim;
  box(g, 0.13, 0.56, 0.13, mat(legC, { roughness: 0.8 }), -0.08, 0.28, 0);
  box(g, 0.13, 0.56, 0.13, mat(legC, { roughness: 0.8 }), 0.08, 0.28, 0);
  // Chunky sneakers.
  box(g, 0.14, 0.06, 0.2, mat(opts.shoes ?? C.whitePale, { roughness: 0.5 }), -0.08, 0.03, 0.02);
  box(g, 0.14, 0.06, 0.2, mat(opts.shoes ?? C.whitePale, { roughness: 0.5 }), 0.08, 0.03, 0.02);
  // Head + natural-textured hair.
  sph(g, 0.095, mat(opts.skin ?? SKIN, { roughness: 0.7 }), 0, 1.42, 0, 0, 0, 0, 14);
  sph(g, 0.102, mat(opts.hair ?? C.hairBrown, { roughness: 0.9 }), 0, 1.51, 0, 0, 0, 0, 12);
  // Natural texture hint: a slightly larger top hair mass.
  if (opts.bigHair) {
    sph(g, 0.108, mat(opts.hair ?? C.hairBrown, { roughness: 0.9 }), 0, 1.56, 0, 0, 0, 0, 12);
  }
}

/** Relaxed-fit patron with a laptop + headphones. */
export function laptopPatron(opts = {}) {
  const g = new THREE.Group();
  figureBase(g, {
    torso: C.cream,
    shoulders: C.cream,
    legs: C.denimLight,
    hair: opts.hair ?? C.hairBlack,
    bigHair: true,
  });
  // Laptop in front.
  const lap = laptop(g, 0, 0.8, 0.22, 0);
  // Over-ear headphones around the neck.
  torusHeadphones(g, 0, 1.1, 0.1);
  // Smartwatch on the wrist.
  const watch = smartwatch(g, 0.2, 0.72, 0.12, 0);
  watch.rotation.x = Math.PI / 2;
  return g;
}

/** Patron with a smartwatch + earbuds case on the table. */
export function smartwatchPatron(opts = {}) {
  const g = new THREE.Group();
  figureBase(g, {
    torso: C.sage,
    shoulders: C.sage,
    legs: C.denim,
    hair: opts.hair ?? C.hairCopper,
  });
  // Smartwatch on the extended wrist.
  const watch = smartwatch(g, 0.2, 0.9, 0.1, 0);
  watch.rotation.x = Math.PI / 2;
  return g;
}

/** Patron filming a latte with a phone on a mini-gimbal. */
export function gimbalPatron(opts = {}) {
  const g = new THREE.Group();
  figureBase(g, {
    torso: C.terracotta,
    shoulders: C.terracotta,
    legs: C.denimLight,
    hair: opts.hair ?? C.hairBlond,
    bigHair: true,
  });
  // Mini-gimbal: a small handle + phone held up.
  const gimbal = new THREE.Group();
  cyl(gimbal, 0.012, 0.012, 0.14, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.07, 0, 0, 0, 0, 8);
  // Phone screen on top.
  box(gimbal, 0.05, 0.1, 0.004, matte(C.matteBlack, { roughness: 0.3 }), 0, 0.19, 0);
  box(gimbal, 0.042, 0.09, 0.002, emissive(0xbfe3ff, 1.8), 0, 0.19, 0.003);
  gimbal.position.set(0.22, 1.0, 0.15);
  gimbal.rotation.set(0.2, 0.4, 0.1);
  g.add(gimbal);
  return g;
}

/** Patron with a tote bag + earbuds. */
export function totePatron(opts = {}) {
  const g = new THREE.Group();
  figureBase(g, {
    torso: C.oat,
    shoulders: C.oat,
    legs: C.denim,
    hair: opts.hair ?? C.hairBrown,
  });
  // Tote bag slung over the shoulder.
  const tote = new THREE.Group();
  // Bag body.
  box(tote, 0.22, 0.26, 0.08, mat(C.cream, { roughness: 0.8 }), 0, 0, 0);
  // Handles.
  const handleMat = mat(C.cream, { roughness: 0.8 });
  box(tote, 0.02, 0.12, 0.02, handleMat, -0.08, 0.2, 0);
  box(tote, 0.02, 0.12, 0.02, handleMat, 0.08, 0.2, 0);
  // Small wordmark decal.
  box(tote, 0.12, 0.02, 0.01, mat(C.terracotta, { roughness: 0.6 }), 0, 0.02, 0.041);
  tote.position.set(-0.22, 0.85, 0.0);
  tote.rotation.z = 0.15;
  g.add(tote);
  // Earbuds case on the table.
  const ec = earbudsCase(g, 0.18, 0.78, 0.2, 0.3);
  return g;
}

/** Patron with big natural-textured hair, sitting with a phone. */
export function phonePatron(opts = {}) {
  const g = new THREE.Group();
  figureBase(g, {
    torso: C.stoneware,
    shoulders: C.stoneware,
    legs: C.denimLight,
    hair: opts.hair ?? C.hairBlack,
    bigHair: true,
  });
  // Phone held in hand.
  const phone = new THREE.Group();
  box(phone, 0.05, 0.1, 0.004, matte(C.matteBlack, { roughness: 0.3 }), 0, 0, 0);
  box(phone, 0.042, 0.09, 0.002, emissive(0xbfe3ff, 1.7), 0, 0, 0.003);
  phone.position.set(0.2, 0.95, 0.1);
  phone.rotation.set(0.1, 0.3, 0.1);
  g.add(phone);
  return g;
}

/** Over-ear headphones around the neck. */
function torusHeadphones(g, x, y, z) {
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.09, 0.018, 8, 16, Math.PI),
    mat(C.matteBlack, { roughness: 0.5 })
  );
  band.position.set(x, y, z);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  // Ear cups.
  sph(g, 0.03, mat(C.matteBlack, { roughness: 0.5 }), x - 0.09, y, z, 0, 0, 0, 10);
  sph(g, 0.03, mat(C.matteBlack, { roughness: 0.5 }), x + 0.09, y, z, 0, 0, 0, 10);
}

/** Place a figure group into parent at x/z with yaw/scale. */
export function seatFigure(parent, person, x = 0, z = 0, yaw = 0, scale = 1) {
  person.position.set(x, 0, z);
  person.rotation.y = yaw;
  person.scale.setScalar(scale);
  parent.add(person);
  return person;
}

/** Build the full cast: 5 patrons. */
export function buildPeople() {
  const g = new THREE.Group();
  g.name = 'people-2025';

  // 1. Laptop + headphones patron at the communal table.
  const lap = laptopPatron();
  seatFigure(g, lap, -0.4, 1.15, -Math.PI / 2, 0.94);

  // 2. Smartwatch patron at the round table.
  const sw = smartwatchPatron();
  seatFigure(g, sw, 1.6, 0.55, 2.5, 0.94);

  // 3. Gimbal patron filming a latte by the window.
  const gim = gimbalPatron();
  seatFigure(g, gim, 1.3, 1.7, -2.2, 0.95);

  // 4. Tote-bag patron with earbuds, at the counter / standing.
  const tote = totePatron();
  tote.position.set(-2.2, 0, 0.4);
  tote.rotation.y = Math.PI / 2;
  g.add(tote);

  // 5. Phone patron with big natural hair at the communal table.
  const ph = phonePatron();
  seatFigure(g, ph, 0.4, 1.15, -Math.PI / 2, 0.94);

  return g;
}