/**
 * people.js — 5 patrons in 1960s attire:
 *   slim suit + skinny tie businessman reading the paper, shift-dress
 *   woman with beehive hair and a Polaroid, a leather-jacket teen,
 *   and two teens at the jukebox (one with a transistor radio).
 * Simple low-poly figures (torso + legs + head + accents) so the cast
 * reads clearly at café scale without high triangle counts.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';
import { C, mat, box, cyl, sph } from './util.js';

const SKIN = C.skin;
const SKIN_ALT = 0xc79b72;

/** Shared compact figure builder: torso, legs, shoes, head with hair. */
function figureBase(g, opts = {}) {
  const suit = opts.torso ?? C.navy;
  box(g, 0.3, 0.44, 0.18, mat(suit, { roughness: 0.7 }), 0, 1.0, 0);
  box(g, 0.36, 0.08, 0.2, mat(opts.shoulders ?? suit, { roughness: 0.6 }), 0, 1.2, 0);
  const legC = opts.legs ?? suit;
  box(g, 0.09, 0.6, 0.1, mat(legC, { roughness: 0.75 }), -0.07, 0.3, 0);
  box(g, 0.09, 0.6, 0.1, mat(legC, { roughness: 0.75 }), 0.07, 0.3, 0);
  box(g, 0.1, 0.05, 0.18, mat(opts.shoes ?? C.black, { roughness: 0.5 }), -0.07, 0.025, 0.02);
  box(g, 0.1, 0.05, 0.18, mat(opts.shoes ?? C.black, { roughness: 0.5 }), 0.07, 0.025, 0.02);
  // Head + hair (sitting above the shoulders).
  sph(g, 0.095, mat(opts.skin ?? SKIN, { roughness: 0.7 }), 0, 1.4, 0, 0, 0, 0, 14);
  sph(g, 0.103, mat(opts.hair ?? C.hairBrown, { roughness: 0.9 }), 0, 1.49, 0, 0, 0, 0, 12);
}

/** Canvas-textured open newspaper. */
function newspaperGroup() {
  const n = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 400;
  const cg = c.getContext('2d');
  cg.fillStyle = '#e7ddc6';
  cg.fillRect(0, 0, 300, 400);
  cg.fillStyle = '#241f18';
  cg.font = 'bold 34px Georgia, serif';
  cg.textAlign = 'center';
  cg.fillText('THE DAILY BUGLE', 150, 42);
  cg.font = '16px Arial, sans-serif';
  for (let i = 0; i < 14; i++) {
    cg.fillRect(30, 72 + i * 22, 190 + (i % 3) * 30, 5);
  }
  cg.fillStyle = '#241f18';
  cg.font = 'bold 22px Georgia, serif';
  cg.fillText('“Space Race Heats Up!”', 150, 386);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.34),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
  );
  face.position.z = 0.004;
  n.add(face);
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.34, 0.006),
    mat(C.creamPale, { roughness: 0.95 })
  );
  n.add(back);
  return n;
}

/** Slim-suit businessman with skinny tie, reading the newspaper. */
export function businessMan(opts = {}) {
  const g = new THREE.Group();
  figureBase(g, { torso: C.navy, shoulders: C.navy, hair: opts.hair ?? C.hairBrown });
  // White shirt + red skinny tie.
  box(g, 0.16, 0.26, 0.015, mat(C.white, { roughness: 0.7 }), 0, 0.94, 0.092);
  box(g, 0.028, 0.3, 0.015, mat(C.red, { roughness: 0.8 }), 0, 0.94, 0.1);
  // Newspaper held at mid-body.
  const paper = newspaperGroup();
  paper.position.set(0.2, 0.88, 0.12);
  paper.rotation.set(-0.15, 0.25, 0.05);
  g.add(paper);
  return g;
}

/** Shift-dress woman with bouffant/beehive hair + Polaroid. */
export function shiftDress(opts = {}) {
  const g = new THREE.Group();
  const dress = opts.dress ?? C.terracotta;
  // A-line dress body (slightly flared at the hem).
  box(g, 0.31, 0.42, 0.2, mat(dress, { roughness: 0.6 }), 0, 0.98, 0);
  box(g, 0.36, 0.09, 0.22, mat(dress, { roughness: 0.6 }), 0, 0.78, 0);
  // Stocking legs.
  box(g, 0.09, 0.56, 0.1, mat(SKIN_ALT, { roughness: 0.85 }), -0.06, 0.25, 0);
  box(g, 0.09, 0.56, 0.1, mat(SKIN_ALT, { roughness: 0.85 }), 0.06, 0.25, 0);
  // Pumps (red).
  box(g, 0.1, 0.045, 0.2, mat(0xd6523a, { roughness: 0.5 }), -0.06, 0.02, 0.02);
  box(g, 0.1, 0.045, 0.2, mat(0xd6523a, { roughness: 0.5 }), 0.06, 0.02, 0.02);
  // Head.
  sph(g, 0.09, mat(SKIN_ALT, { roughness: 0.7 }), 0, 1.42, 0, 0, 0, 0, 14);
  // Beehive hair — tall stacked ball.
  sph(g, 0.092, mat(C.hairGold, { roughness: 0.9 }), 0, 1.5, 0, 0, 0, 0, 12);
  sph(g, 0.052, mat(C.hairGold, { roughness: 0.9 }), 0, 1.57, 0.01, 0, 0, 0, 10);
  // Pearl necklace.
  for (let i = -3; i <= 3; i++) {
    sph(g, 0.008, mat(C.ivory, { roughness: 0.3, metalness: 0.1 }), i * 0.03, 1.26 - Math.abs(i) * 0.008, 0.1, 0, 0, 0, 8);
  }
  // Polaroid camera.
  if (opts.polaroid) {
    const cam = new THREE.Group();
    box(cam, 0.13, 0.09, 0.05, mat(C.black, { roughness: 0.5 }), 0, 0, 0);
    box(cam, 0.09, 0.03, 0.012, mat(C.chrome, { metalness: 0.8 }), 0, 0.045, 0.02);
    sph(cam, 0.025, mat(C.chrome, { metalness: 0.8 }), 0.06, 0, 0, 0, 0, 0, 10);
    cam.position.set(0.18, 0.72, 0.1);
    cam.rotation.z = 0.12;
    g.add(cam);
  }
  return g;
}

/** Leather-jacket teen leaning by the jukebox. */
export function leatherTeen(opts = {}) {
  const g = new THREE.Group();
  box(g, 0.34, 0.1, 0.2, mat(C.black, { roughness: 0.45, metalness: 0.1 }), 0, 1.18, 0);
  box(g, 0.28, 0.4, 0.18, mat(C.black, { roughness: 0.45, metalness: 0.1 }), 0, 0.96, 0);
  box(g, 0.12, 0.18, 0.02, mat(C.cream), 0, 0.86, 0.09);
  // Jeans + boots.
  box(g, 0.09, 0.58, 0.1, mat(C.navy, { roughness: 0.8 }), -0.07, 0.29, 0);
  box(g, 0.09, 0.58, 0.1, mat(C.navy, { roughness: 0.8 }), 0.07, 0.29, 0);
  box(g, 0.12, 0.06, 0.22, mat(C.black, { roughness: 0.4 }), -0.07, 0.03, 0.02);
  box(g, 0.12, 0.06, 0.22, mat(C.black, { roughness: 0.4 }), 0.07, 0.03, 0.02);
  // Head + dark pompadour.
  sph(g, 0.095, mat(SKIN, { roughness: 0.7 }), 0, 1.38, 0, 0, 0, 0, 14);
  sph(g, 0.105, mat(C.hairDark, { roughness: 0.9 }), 0, 1.47, 0, 0, 0, 0, 12);
  // Slight forward lean.
  g.rotation.x = opts.lean ?? 0.06;
  return g;
}

/** Generic teen figure (used for the two jukebox kids). */
export function teenFigure(opts = {}) {
  const g = new THREE.Group();
  box(g, 0.28, 0.36, 0.16, mat(opts.torso ?? C.sky, { roughness: 0.7 }), 0, 1.0, 0);
  box(g, 0.1, 0.5, 0.1, mat(C.navy, { roughness: 0.8 }), -0.06, 0.3, 0);
  box(g, 0.1, 0.5, 0.1, mat(C.navy, { roughness: 0.8 }), 0.06, 0.3, 0);
  box(g, 0.11, 0.05, 0.2, mat(C.white, { roughness: 0.5 }), -0.06, 0.03, 0.02);
  box(g, 0.11, 0.05, 0.2, mat(C.white, { roughness: 0.5 }), 0.06, 0.03, 0.02);
  sph(g, 0.09, mat(opts.skin ?? SKIN_ALT, { roughness: 0.7 }), 0, 1.38, 0, 0, 0, 0, 14);
  sph(g, 0.095, mat(opts.hair ?? C.hairBrown, { roughness: 0.9 }), 0, 1.47, 0, 0, 0, 0, 12);
  // Arms akimbo toward the jukebox.
  cyl(g, 0.022, 0.022, 0.26, mat(opts.skin ?? SKIN_ALT, { roughness: 0.8 }), 0.16, 0.98, 0.03, 0.55, 0, 0.85, 6);
  cyl(g, 0.022, 0.022, 0.26, mat(opts.skin ?? SKIN_ALT, { roughness: 0.8 }), -0.16, 0.98, 0.03, 0.55, 0, -0.85, 6);
  // Transistor radio (optional).
  if (opts.radio) {
    const r = new THREE.Group();
    box(r, 0.14, 0.08, 0.05, mat(C.chrome, { metalness: 0.8, roughness: 0.35 }), 0, 0, 0);
    box(r, 0.1, 0.035, 0.012, mat(C.black), 0, 0.01, 0.026);
    r.position.set(0.18, 0.78, 0.06);
    r.rotation.z = 0.1;
    g.add(r);
  }
  // Comb curl.
  if (opts.curl) {
    sph(g, 0.024, mat(C.hairDark, { roughness: 0.9 }), 0.06, 1.36, 0.004, 0, 0, 0, 8);
  }
  return g;
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
  g.name = 'people-1965';

  // 1. Businessman reading at the front window table (facing the counter).
  const man = businessMan();
  seatFigure(g, man, 1.5, 1.65, -2.4, 0.96);

  // 2. Shift-dress woman with Polaroid at the centre table.
  const woman = shiftDress({ polaroid: true });
  seatFigure(g, woman, -0.5, 0.55, 2.5, 0.94);

  // 3. Leather-jacket teen leaning by the jukebox.
  const leather = leatherTeen();
  leather.position.set(2.45, 0, -0.2);
  leather.rotation.y = Math.PI / 2 - 0.35; // facing +x toward the jukebox front
  g.add(leather);

  // 4. Teen with a transistor radio, fronting the jukebox.
  const rTeen = teenFigure({ radio: true, torso: C.terracotta, hair: C.hairBrown });
  seatFigure(g, rTeen, 2.0, 0.15, Math.PI / 2, 0.9);

  // 5. Teen girl with bouffant hair + curl, next to the records.
  const girl = teenFigure({ torso: C.mint, hair: C.hairGold, curl: true });
  seatFigure(g, girl, 2.15, -0.35, Math.PI / 2 + 0.3, 0.9);

  return g;
}