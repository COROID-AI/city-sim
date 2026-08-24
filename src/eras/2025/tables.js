/**
 * tables.js — 2025 contemporary café tables, chairs and tableware.
 *
 * A long communal wood slab table mixed with small round marble-effect
 * tables, designer stools and bentwood chairs, double-wall glass / speckled
 * stoneware cups, keep-cups, ceramic pour-over servers on trays, and matte
 * black cutlery.
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { C, mat, matte, metal, glassy, box, cyl, sph, torus, taperedLeg } from './util.js';
import { qrSticker } from './menu.js';

/**
 * Long communal oak slab table with a matte black frame and bentwood chairs.
 * `group`: parent; x/z: center; yaw: rotation.
 */
export function communalTable(group, x, z, yaw = 0) {
  const t = new THREE.Group();
  t.position.set(x, 0, z);
  t.rotation.y = yaw;

  // Slab top — light oak with a subtle grain texture.
  const topMat = mat(C.oak, { roughness: 0.5 });
  box(t, 1.8, 0.05, 0.8, topMat, 0, 0.74, 0);
  // Edged slab look.
  box(t, 1.84, 0.06, 0.84, mat(C.oakDark, { roughness: 0.5 }), 0, 0.725, 0);

  // Matte black angled legs (trestle style).
  const legMat = matte(C.matteBlack, { roughness: 0.4 });
  taperedLeg(t, -0.8, 0.7, -0.34, -0.6, 0.05, -0.34, 0.03, 0.035, legMat);
  taperedLeg(t, -0.8, 0.7, 0.34, -0.6, 0.05, 0.34, 0.03, 0.035, legMat);
  taperedLeg(t, 0.8, 0.7, -0.34, 0.6, 0.05, -0.34, 0.03, 0.035, legMat);
  taperedLeg(t, 0.8, 0.7, 0.34, 0.6, 0.05, 0.34, 0.03, 0.035, legMat);

  // Tableware + QR sticker.
  placeTableware(t, 'communal');
  qrSticker(t, 0.35, 0.77, 0.32, 0.1);

  // Bentwood chairs along the long sides.
  for (const [cx, cz, cyaw] of [
    [-0.6, 0.7, 0],
    [0.0, 0.7, 0],
    [0.6, 0.7, 0],
    [-0.6, -0.7, Math.PI],
    [0.0, -0.7, Math.PI],
    [0.6, -0.7, Math.PI],
  ]) {
    const ch = bentwoodChair();
    ch.position.set(cx, 0, cz);
    ch.rotation.y = cyaw;
    t.add(ch);
  }

  group.add(t);
  return t;
}

/** Small round marble-effect table with designer stools. */
export function roundTable(parent, x, z, yaw = 0) {
  const t = new THREE.Group();
  t.position.set(x, 0, z);
  t.rotation.y = yaw;

  // Marble-effect top (canvas speckle/vein texture).
  const marbleTex = canvasMarble();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.04, 32),
    new THREE.MeshStandardMaterial({ map: marbleTex, roughness: 0.35 })
  );
  top.position.y = 0.72;
  t.add(top);

  // Central matte black pedestal base.
  cyl(t, 0.035, 0.06, 0.68, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.36, 0, 0, 0, 0, 14);
  cyl(t, 0.14, 0.15, 0.03, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.015, 0, 0, 0, 0, 18);

  placeTableware(t, 'round');
  qrSticker(t, 0.15, 0.76, 0.28, 0.09);

  // Two designer stools.
  for (const [cx, cz, cyaw] of [[0, 0.6, 0], [0, -0.6, Math.PI]]) {
    const st = designerStool();
    st.position.set(cx, 0, cz);
    st.rotation.y = cyaw;
    t.add(st);
  }

  parent.add(t);
  return t;
}

/** Bentwood chair — curved back, light oak + matte black legs. */
export function bentwoodChair() {
  const g = new THREE.Group();
  // Seat.
  box(g, 0.42, 0.04, 0.42, mat(C.oakLight, { roughness: 0.5 }), 0, 0.46, 0);
  // Curved bentwood back (a torus arc standing behind).
  const back = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.02, 8, 18, Math.PI * 1.1),
    mat(C.oakLight, { roughness: 0.5 })
  );
  back.rotation.x = Math.PI / 2;
  back.position.set(0, 0.72, -0.14);
  g.add(back);
  // Back slats.
  box(g, 0.42, 0.06, 0.02, mat(C.oakLight, { roughness: 0.5 }), 0, 0.62, -0.2);
  box(g, 0.42, 0.06, 0.02, mat(C.oakLight, { roughness: 0.5 }), 0, 0.78, -0.16);
  // Matte black tapered legs.
  const legMat = matte(C.matteBlack, { roughness: 0.4 });
  for (const [lx, lz] of [[0.17, 0.17], [-0.17, 0.17], [0.17, -0.17], [-0.17, -0.17]]) {
    taperedLeg(g, lx * 0.8, 0.44, lz * 0.8, lx * 0.7, 0.04, lz * 0.7, 0.02, 0.025, legMat);
  }
  return g;
}

/** Designer stool — round oak seat on a matte black tripod base. */
export function designerStool() {
  const g = new THREE.Group();
  cyl(g, 0.16, 0.16, 0.04, mat(C.oakLight, { roughness: 0.5 }), 0, 0.62, 0, 0, 0, 0, 20);
  const legMat = matte(C.matteBlack, { roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const tx = Math.cos(a) * 0.1;
    const tz = Math.sin(a) * 0.1;
    const bx = Math.cos(a) * 0.14;
    const bz = Math.sin(a) * 0.14;
    taperedLeg(g, tx, 0.6, tz, bx, 0.05, bz, 0.02, 0.03, legMat);
  }
  return g;
}

/**
 * Place tableware on a table group. Modes: 'communal' and 'round'.
 */
export function placeTableware(table, mode = 'communal') {
  if (mode === 'communal') {
    // Double-wall glass / speckled stoneware cups.
    doubleWallCup(table, -0.55, 0.775, 0.1);
    stonewareCup(table, -0.4, 0.775, -0.05);
    doubleWallCup(table, 0.55, 0.775, 0.1);
    stonewareCup(table, 0.4, 0.775, -0.05);
    // Ceramic pour-over server on a tray.
    pourOverServer(table, -0.1, 0.775, 0.2);
    // Keep-cup + bring-your-own mug.
    keepCup(table, 0.15, 0.775, -0.25);
    // Matte black cutlery.
    cutlery(table, -0.3, 0.778, 0.28);
    cutlery(table, 0.3, 0.778, 0.28);
    // Small plant pot accent.
    smallPlant(table, 0.0, 0.775, -0.2);
  } else {
    // Round table: smaller set.
    doubleWallCup(table, -0.18, 0.76, 0.05);
    stonewareCup(table, 0.05, 0.76, 0.12);
    keepCup(table, 0.18, 0.76, -0.1);
    cutlery(table, -0.05, 0.763, -0.2);
  }
}

function doubleWallCup(g, x, y, z) {
  const c = new THREE.Group();
  // Outer glass wall.
  cyl(c, 0.035, 0.028, 0.08, glassy(0xeaf3f2, { opacity: 0.5 }), 0, 0.04, 0, 0, 0, 0, 14);
  // Inner wall (double-wall gap).
  cyl(c, 0.027, 0.022, 0.075, glassy(0xf4f9f8, { opacity: 0.35 }), 0, 0.038, 0, 0, 0, 0, 14);
  c.position.set(x, y, z);
  g.add(c);
}

function stonewareCup(g, x, y, z) {
  const c = new THREE.Group();
  cyl(c, 0.038, 0.03, 0.075, mat(C.stoneware, { roughness: 0.5 }), 0, 0.037, 0, 0, 0, 0, 14);
  torus(c, 0.038, 0.008, mat(C.stoneware, { roughness: 0.5 }), 0, 0.075, 0, Math.PI / 2, 0, 0, 14, 6);
  c.position.set(x, y, z);
  g.add(c);
}

function keepCup(g, x, y, z) {
  const c = new THREE.Group();
  // Keep-cup — silicone band + lid.
  cyl(c, 0.04, 0.033, 0.09, mat(C.cream, { roughness: 0.5 }), 0, 0.045, 0, 0, 0, 0, 14);
  cyl(c, 0.041, 0.041, 0.03, mat(C.sage, { roughness: 0.6 }), 0, 0.085, 0, 0, 0, 0, 14);
  cyl(c, 0.045, 0.045, 0.01, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.095, 0, 0, 0, 0, 14);
  c.position.set(x, y, z);
  g.add(c);
}

function pourOverServer(g, x, y, z) {
  const c = new THREE.Group();
  // Small tray.
  cyl(c, 0.09, 0.09, 0.012, mat(C.oakLight, { roughness: 0.5 }), 0, 0.006, 0, 0, 0, 0, 20);
  // Ceramic server.
  cyl(c, 0.04, 0.028, 0.1, mat(C.stoneware, { roughness: 0.45 }), 0, 0.06, 0, 0, 0, 0, 14);
  torus(c, 0.028, 0.007, mat(C.stoneware, { roughness: 0.45 }), 0.035, 0.07, 0, 0, 0, 0, 10, 6, Math.PI * 0.9);
  c.position.set(x, y, z);
  g.add(c);
}

function cutlery(g, x, y, z) {
  // Matte black knife + fork laid flat.
  box(g, 0.03, 0.006, 0.16, matte(C.matteBlack, { roughness: 0.4 }), x, y, z, 0, 0, 0.12);
  box(g, 0.03, 0.006, 0.16, matte(C.matteBlack, { roughness: 0.4 }), x, y, z + 0.16, 0, 0, -0.1);
  // Fork tines hint.
  for (let i = 0; i < 4; i++) {
    box(g, 0.005, 0.005, 0.03, matte(C.matteBlack, { roughness: 0.4 }), x - 0.012 + i * 0.008, y, z + 0.16, 0, 0, 0);
  }
}

function smallPlant(g, x, y, z) {
  const p = new THREE.Group();
  cyl(p, 0.03, 0.022, 0.045, mat(C.terracotta, { roughness: 0.6 }), 0, 0.022, 0, 0, 0, 0, 12);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cyl(p, 0.006, 0.006, 0.09, mat(C.leaf, { roughness: 0.8 }), Math.cos(a) * 0.01, 0.07, Math.sin(a) * 0.01, 0.5, 0, a, 6);
  }
  p.position.set(x, y, z);
  g.add(p);
}

/** Marble-effect canvas texture — off-white with faint grey veins. */
export function canvasMarble() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e7e1';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(150,145,135,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    g.beginPath();
    const startX = Math.random() * 512;
    g.moveTo(startX, 0);
    for (let y = 0; y < 512; y += 24) {
      g.lineTo(startX + (Math.random() - 0.5) * 80, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}